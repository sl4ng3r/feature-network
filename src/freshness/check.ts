import { z } from 'zod';
import { NetworkError } from '../model/errors.js';
import type { Diagnostic } from '../model/types.js';
import { readCommittedChanges, readGitState } from '../project/git.js';
import type { Project } from '../project/root.js';
import { featureReferences, readSnapshot, type Snapshot, type StorageOptions } from '../storage/repository.js';
import { readRuntime } from '../storage/runtime.js';
import { inspectChange, inspectReference, matchingDecision, matchingUnmappedDecision, readDecisions } from './references.js';
import { readTurn, relevantChanges, workingPaths } from './session.js';

export interface ReferenceState {
  path: string;
  state: 'current' | 'changed' | 'missing' | 'unknown';
  hash: string | null;
  featureIds: string[];
}
export interface OpenDecision {
  path: string;
  featureIds: string[];
  reason: 'changed' | 'missing' | 'unknown' | 'unmapped' | 'decision_missing';
}
export interface CheckResult {
  mode: 'summary' | 'full';
  freshness: 'last_known' | 'fresh_technical_check';
  integrity: Snapshot['integrity'];
  networkRevision: string;
  references: ReferenceState[];
  unknownChanges: string[];
  unknownChangeDecisions: Array<{ path: string; state: 'open' | 'no_semantic_change' | 'missing_no_semantic_change' }>;
  preexistingChanges: string[];
  turnChanges: string[];
  turnAssumptions: 'valid' | 'invalidated' | 'not_recorded';
  changeCoverage: 'git' | 'unknown' | 'last_known';
  lastCheckedAt: string | null;
  openDecisions: OpenDecision[];
  diagnostics: Diagnostic[];
}
const baselineSchema = z.object({ networkRevision: z.string().regex(/^[a-f0-9]{64}$/), references: z.record(z.string(), z.string().regex(/^[a-f0-9]{64}$/)) });
function errorDiagnostic(error: unknown, fallback: string): Diagnostic {
  return { code: error instanceof NetworkError ? error.code : fallback, severity: 'warning', message: 'Local freshness evidence is unavailable; review coverage is unknown' };
}
/** Read-only technical check. It never runs semantic analysis, confirms, or writes a cache. */
export async function checkNetwork(project: Project, mode: 'summary' | 'full', sessionId?: string, options: StorageOptions = {}): Promise<CheckResult> {
  if (mode !== 'summary' && mode !== 'full') throw new NetworkError('invalid_check', 'Unknown check mode');
  const snapshot = await readSnapshot(project, options);
  const result: CheckResult = { mode, freshness: mode === 'summary' ? 'last_known' : 'fresh_technical_check', integrity: snapshot.integrity,
    networkRevision: snapshot.revision, references: [], unknownChanges: [], unknownChangeDecisions: [], preexistingChanges: [], turnChanges: [],
    turnAssumptions: 'not_recorded', changeCoverage: mode === 'summary' ? 'last_known' : 'unknown', lastCheckedAt: null,
    openDecisions: [], diagnostics: [...snapshot.diagnostics] };
  if (snapshot.integrity === 'pending_recovery' || snapshot.integrity === 'not_initialized') return result;
  const { decisions, ids } = await populateReferences(project, snapshot, mode, options, result);
  if (mode === 'summary') {
    const dates = result.references.filter(ref => ref.hash !== null && matchingDecision(decisions, snapshot, ref.path, ref.hash))
      .map(ref => decisions!.references[ref.path]!.decidedAt).sort();
    result.lastCheckedAt = dates.at(-1) ?? null;
    return result;
  }
  result.lastCheckedAt = new Date().toISOString();
  const git = await readGitState(project); result.diagnostics.push(...git.diagnostics); result.changeCoverage = git.status === 'available' ? 'git' : 'unknown';
  let changed = await relevantChanges(project, workingPaths(git), options);
  let turn = null;
  if (sessionId !== undefined) {
    try { turn = await readTurn(project, sessionId); } catch (error) { result.diagnostics.push(errorDiagnostic(error, 'invalid_session')); result.turnAssumptions = 'invalidated'; result.changeCoverage = 'unknown'; }
    if (turn === null && result.turnAssumptions !== 'invalidated') result.diagnostics.push({ code: 'turn_not_recorded', severity: 'warning', message: 'No starting turn state is available' });
  }
  if (turn) {
    result.preexistingChanges = await relevantChanges(project, turn.preexistingChanges, options);
    result.turnAssumptions = 'valid';
    if (git.status !== 'available' || turn.git.status !== 'available') { result.turnAssumptions = 'invalidated'; result.changeCoverage = 'unknown'; }
    if (turn.git.branch !== git.branch) {
      result.turnAssumptions = 'invalidated'; result.diagnostics.push({ code: 'branch_changed', severity: 'warning', message: 'Branch identity changed since turn start; prior assumptions require review' });
    }
    if (turn.networkRevision !== snapshot.revision) result.diagnostics.push({ code: 'turn_network_changed', severity: 'warning', message: 'Network changed since turn start; decisions require the current revision' });
    if (git.status === 'available' && turn.git.status === 'available' && turn.git.head !== git.head) {
      result.turnAssumptions = 'invalidated';
      result.diagnostics.push({ code: 'head_changed', severity: 'warning', message: 'Commit identity changed since turn start; committed changes are included' });
      if (git.head !== null) {
        const delta = await readCommittedChanges(project, turn.git.head, git.head); result.diagnostics.push(...delta.diagnostics);
        if (delta.status === 'available') changed = await relevantChanges(project, [...changed, ...delta.paths], options);
        else result.changeCoverage = 'unknown';
      } else result.changeCoverage = 'unknown';
    }
    for (const path of [...new Set([...changed, ...Object.keys(turn.observed)])].sort()) {
      if (!(await relevantChanges(project, [path], options)).length) continue;
      if (!Object.hasOwn(turn.observed, path)) { if (changed.includes(path)) result.turnChanges.push(path); continue; }
      const observation = await (ids.has(path) ? inspectReference : inspectChange)(project, path, options);
      if (observation.state === 'unknown') { if (observation.diagnostic) result.diagnostics.push(observation.diagnostic); result.changeCoverage = 'unknown'; }
      if (observation.hash !== turn.observed[path] || observation.state === 'unknown') result.turnChanges.push(path);
    }
  }
  const allChanged = new Set([...changed, ...result.turnChanges]);
  const priorObservations = new Map<string, Awaited<ReturnType<typeof inspectChange>>>();
  // Only explicitly reviewed unmapped paths are additionally inspected, including
  // a restored tracked file whose original bytes make Git look clean again.
  for (const path of await relevantChanges(project, Object.keys(decisions?.references ?? {}), options)) {
    if (ids.has(path)) continue;
    const observed = await inspectChange(project, path, options); priorObservations.set(path, observed);
    if (!matchingUnmappedDecision(decisions, snapshot, path, observed)) allChanged.add(path);
  }
  result.unknownChanges = [...allChanged].sort().filter(path => !ids.has(path));
  for (const path of result.unknownChanges) {
    let reviewed = false; let missing = false;
    if (decisions && Object.hasOwn(decisions.references, path)) {
      const observation = priorObservations.get(path) ?? await inspectChange(project, path, options);
      reviewed = matchingUnmappedDecision(decisions, snapshot, path, observation); missing = observation.state === 'missing';
      if (observation.diagnostic && !reviewed) result.diagnostics.push(observation.diagnostic);
    }
    result.unknownChangeDecisions.push({ path, state: reviewed ? missing ? 'missing_no_semantic_change' : 'no_semantic_change' : 'open' });
    if (!reviewed) result.openDecisions.push({ path, featureIds: [], reason: 'unmapped' });
  }
  // Git's disabled-filter warning is a real coverage boundary, never clean proof.
  if (result.diagnostics.some(d => d.code === 'git_filters_disabled')) result.changeCoverage = 'unknown';
  return result;
}

type ReferenceResult = Pick<CheckResult, 'references' | 'openDecisions' | 'diagnostics'>;
/** Shared baseline/decision policy for full checks and scoped query warnings. */
async function populateReferences(project: Project, snapshot: Snapshot, mode: 'summary' | 'full', options: StorageOptions, result: ReferenceResult, selected?: Set<string>) {
  let baselines: z.infer<typeof baselineSchema> | null = null;
  try {
    const value = await readRuntime<unknown>(project, 'baselines');
    if (value !== null) {
      const parsed = baselineSchema.safeParse(value);
      if (!parsed.success) throw new NetworkError('invalid_baselines', 'Stored reference baselines are invalid');
      if (parsed.data.networkRevision === snapshot.revision) baselines = parsed.data;
      else result.diagnostics.push({ code: 'stale_baselines', severity: 'warning', message: 'Reference baselines belong to a different network revision' });
    }
  } catch (error) { result.diagnostics.push(errorDiagnostic(error, 'invalid_baselines')); }
  let decisions = null;
  try { decisions = await readDecisions(project); } catch (error) { result.diagnostics.push(errorDiagnostic(error, 'invalid_decisions')); }
  const ids = new Map<string, Set<string>>();
  for (const feature of snapshot.features.filter(feature => !selected || selected.has(feature.id))) for (const ref of featureReferences(feature)) {
    const set = ids.get(ref.path) ?? new Set<string>(); set.add(feature.id); ids.set(ref.path, set);
  }
  for (const path of [...ids.keys()].sort()) {
    const baseline = baselines && Object.hasOwn(baselines.references, path) ? baselines.references[path] : undefined;
    const state: ReferenceState = { path, state: baseline ? 'current' : 'unknown', hash: baseline ?? null, featureIds: [...ids.get(path)!].sort() };
    if (mode === 'full') {
      const observed = await inspectReference(project, path, options); state.hash = observed.hash;
      state.state = observed.state === 'present' ? baseline ? observed.hash === baseline ? 'current' : 'changed' : 'unknown' : observed.state;
      if (observed.diagnostic) result.diagnostics.push(observed.diagnostic);
    }
    result.references.push(state);
    const reviewed = state.state === 'current' && state.hash !== null && matchingDecision(decisions, snapshot, path, state.hash);
    if (!reviewed) result.openDecisions.push({ path, featureIds: state.featureIds, reason: state.state === 'current' ? 'decision_missing' : state.state });
  }
  return { decisions, ids };
}
export interface FeatureFreshness { state: 'current' | 'changed' | 'missing' | 'unknown'; review: 'recorded' | 'open' }
/** Fresh technical observations only for the features the page can return.
 * This is not semantic analysis or a whole-project freshness assertion. */
export async function queryFreshness(project: Project, snapshot: Snapshot, featureIds: string[], options: StorageOptions): Promise<Record<string, FeatureFreshness>> {
  const selected = new Set(featureIds);
  const scoped = { ...snapshot, features: snapshot.features.filter(feature => selected.has(feature.id)) };
  const result: ReferenceResult = { references: [], openDecisions: [], diagnostics: [] };
  await populateReferences(project, snapshot, 'full', options, result, selected);
  const output: Record<string, FeatureFreshness> = {};
  for (const feature of scoped.features) {
    const refs = result.references.filter(ref => ref.featureIds.includes(feature.id));
    const state = (['missing', 'changed', 'unknown'] as const).find(state => refs.some(ref => ref.state === state)) ?? 'current';
    output[feature.id] = { state, review: result.openDecisions.some(decision => decision.featureIds.includes(feature.id)) ? 'open' : 'recorded' };
  }
  return output;
}

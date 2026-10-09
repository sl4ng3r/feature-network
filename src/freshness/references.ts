import { realpath } from 'node:fs/promises';
import { relative, resolve, sep } from 'node:path';
import { z } from 'zod';
import { NetworkError } from '../model/errors.js';
import type { Diagnostic, VerifiedReference } from '../model/types.js';
import { isAutomaticGeneratedPath, isSensitivePath, resolveProjectPath } from '../project/paths.js';
import type { Project } from '../project/root.js';
import { applyUpdate, assertMissingReference, featureReferences, readReferenceHash, readSnapshot, type Snapshot, type StorageOptions } from '../storage/repository.js';
import { readRuntime, runtimeRevision, writeRuntime } from '../storage/runtime.js';

export interface ReferenceObservation {
  path: string;
  state: 'present' | 'missing' | 'unknown';
  hash: string | null;
  diagnostic?: Diagnostic;
}
/** Technical fingerprint only; never implies a semantic review. */
export async function inspectReference(project: Project, path: string, options: StorageOptions = {}): Promise<ReferenceObservation> {
  try { return { path, state: 'present', hash: await readReferenceHash(project, path, options) }; }
  catch (error) {
    const missing = (error as NodeJS.ErrnoException).code === 'ENOENT';
    return { path, state: missing ? 'missing' : 'unknown', hash: null, diagnostic: {
      code: error instanceof NetworkError ? error.code : missing ? 'missing_reference' : 'unreadable_reference',
      severity: 'error', path, message: 'Referenced file could not be safely fingerprinted',
    } };
  }
}
/** Automatic dirty/unmapped observation: do not open obvious secrets or their aliases. */
export async function inspectChange(project: Project, path: string, options: StorageOptions = {}): Promise<ReferenceObservation> {
  let canonicalPath = path;
  try { canonicalPath = relative(project.root, await resolveProjectPath(project, path)).split(sep).join('/'); } catch { /* inspectReference returns the safe-path diagnostic */ }
  if (isSensitivePath(path) || isSensitivePath(canonicalPath)) return { path, state: 'unknown', hash: null,
    diagnostic: { code: 'sensitive_reference', severity: 'warning', path, message: 'Automatic observation excludes a potentially sensitive source' } };
  const observation = await inspectReference(project, path, options);
  if (observation.state !== 'missing') return observation;
  // A missing symlink target is not absence of the path itself.
  try { await assertMissingReference(project, path, options); return observation; }
  catch (error) { return { path, state: 'unknown', hash: null, diagnostic: {
    code: error instanceof NetworkError ? error.code : 'unreadable_reference', path, severity: 'warning',
    message: 'Source absence could not be safely established',
  } }; }
}

function inside(root: string, path: string) {
  const suffix = relative(root, path); return suffix === '' || (suffix !== '..' && !suffix.startsWith(`..${sep}`) && !suffix.startsWith(sep));
}
/** Exclude generated/runtime paths and canonical plugin aliases before source I/O. */
export async function isIgnoredChange(project: Project, path: string, options: StorageOptions = {}): Promise<boolean> {
  if (isAutomaticGeneratedPath(path)) return true;
  // Invalid/unresolvable Git paths remain visible as unknown, without opening them.
  let absolute: string;
  try { absolute = await resolveProjectPath(project, path); } catch { return false; }
  if (isAutomaticGeneratedPath(relative(project.root, absolute).split(sep).join('/'))) return true;
  for (const root of options.excludedReferenceRoots ?? []) {
    let canonical: string;
    try { canonical = await realpath(root); } catch { canonical = resolve(root); }
    if (inside(canonical, absolute)) return true;
  }
  return false;
}

const fingerprint = z.string().regex(/^[a-f0-9]{64}$/);
export const reviewObservationSchema = z.union([
  z.strictObject({ path: z.string().min(1), hash: fingerprint }),
  z.strictObject({ path: z.string().min(1), state: z.literal('missing') }),
]);
export type ReviewObservation = VerifiedReference | { path: string; state: 'missing' };
export const reviewDecisionSchema = z.strictObject({ networkRevision: fingerprint,
  outcome: z.enum(['updated', 'no_semantic_change']), reason: z.string().trim().min(1).max(8192) });
export type ReviewDecision = z.infer<typeof reviewDecisionSchema>;
const recordContext = { reviewedNetworkRevision: fingerprint, featureFingerprints: z.record(z.string(), fingerprint),
  reason: z.string().trim().min(1).max(8192), decidedAt: z.iso.datetime() };
const recordSchema = z.union([
  z.strictObject({ ...recordContext, hash: fingerprint, outcome: z.enum(['updated', 'no_semantic_change']) }),
  z.strictObject({ ...recordContext, state: z.literal('missing'), outcome: z.literal('no_semantic_change'),
    featureFingerprints: z.record(z.string(), fingerprint).refine(value => Object.keys(value).length === 0) }),
]);
const decisionsSchema = z.strictObject({ version: z.literal(1), references: z.record(z.string(), recordSchema) });
export type DecisionStore = z.infer<typeof decisionsSchema>;
export const decisionKey = 'freshness/decisions';
export async function readDecisions(project: Project): Promise<DecisionStore | null> {
  const value = await readRuntime<unknown>(project, decisionKey);
  if (value === null) return null;
  const parsed = decisionsSchema.safeParse(value);
  if (!parsed.success) throw new NetworkError('invalid_decisions', 'Stored review decisions are invalid');
  // CAS fingerprints must use the exact JSON value returned by readRuntime;
  // schema union parsing can reorder fields despite identical semantics.
  return value as DecisionStore;
}
export function relevantFeatureFingerprints(snapshot: Snapshot, path: string): Record<string, string> {
  return Object.fromEntries(snapshot.features.filter(feature => featureReferences(feature).some(ref => ref.path === path))
    .map(feature => `network-spec/${feature.id}.yaml`).sort().map(file => [file, snapshot.fingerprints[file]! ]));
}
export function matchingDecision(store: DecisionStore | null, snapshot: Snapshot, path: string, hash: string): boolean {
  const record = store && Object.hasOwn(store.references, path) ? store.references[path] : undefined;
  if (!record || !('hash' in record) || record.hash !== hash) return false;
  const current = relevantFeatureFingerprints(snapshot, path);
  const keys = Object.keys(current);
  // Unchanged features can carry a review through an unrelated targeted sync.
  return keys.length > 0 && keys.length === Object.keys(record.featureFingerprints).length
    && keys.every(key => current[key] === record.featureFingerprints[key]);
}
export function matchingUnmappedDecision(store: DecisionStore | null, snapshot: Snapshot, path: string, observation: ReferenceObservation): boolean {
  const record = store && Object.hasOwn(store.references, path) ? store.references[path] : undefined;
  if (!record || record.outcome !== 'no_semantic_change' || record.reviewedNetworkRevision !== snapshot.revision
    || Object.keys(record.featureFingerprints).length !== 0 || Object.keys(relevantFeatureFingerprints(snapshot, path)).length !== 0) return false;
  return 'state' in record ? observation.state === 'missing'
    : observation.state === 'present' && observation.hash === record.hash;
}
/** Write-path only: caller supplies the revision, observed hash/absence and semantic reasoning. */
export async function confirmReferences(project: Project, refs: ReviewObservation[], decision: ReviewDecision, options: StorageOptions = {}): Promise<void> {
  const parsed = reviewDecisionSchema.safeParse(decision); const observations = z.array(reviewObservationSchema).min(1).safeParse(refs);
  if (!parsed.success || !observations.success) throw new NetworkError('invalid_decision', 'Confirmation requires a revision-bound reason and explicit source observations');
  const snapshot = await readSnapshot(project, options);
  if (snapshot.integrity !== 'valid') throw new NetworkError(snapshot.integrity, 'Network must be valid before reference confirmation');
  if (snapshot.revision !== parsed.data.networkRevision) throw new NetworkError('conflict', 'Agent reviewed a different network revision');
  const paths = new Set(snapshot.features.flatMap(featureReferences).map(ref => ref.path));
  const unmapped = observations.data.filter(ref => !paths.has(ref.path));
  const missing = observations.data.filter((ref): ref is { path: string; state: 'missing' } => 'state' in ref);
  if ((unmapped.length || missing.length) && parsed.data.outcome !== 'no_semantic_change') throw new NetworkError('invalid_decision', 'Only no_semantic_change may acknowledge unmapped or missing sources');
  if (missing.some(ref => paths.has(ref.path))) throw new NetworkError('invalid_decision', 'Missing mapped references require network repair/removal first');
  const verifyUnmapped = async () => {
    for (const ref of unmapped) {
      if ('state' in ref) { await assertMissingReference(project, ref.path, options); continue; }
      if (await isIgnoredChange(project, ref.path, options)) throw new NetworkError('invalid_decision', 'Generated or runtime sources cannot receive review decisions', [ref.path]);
      const observed = await inspectChange(project, ref.path, options);
      if (observed.state !== 'present') throw new NetworkError(observed.diagnostic?.code ?? 'unverified_reference', 'Unmapped source cannot be safely verified', [ref.path]);
      if (observed.hash !== ref.hash) throw new NetworkError('conflict', 'Inspected unmapped source changed', [ref.path]);
    }
  };
  if (new Set(observations.data.map(ref => ref.path)).size !== observations.data.length) throw new NetworkError('invalid_decision', 'Reference decisions must be unique');
  await verifyUnmapped();
  const prior = await readDecisions(project);
  await applyUpdate(project, { expected: snapshot.fingerprints, expectedRevision: parsed.data.networkRevision,
    expectedMissingReferences: missing.map(ref => ref.path), upserts: [], deletes: [],
    verifiedReferences: observations.data.filter((ref): ref is VerifiedReference => 'hash' in ref && paths.has(ref.path)) }, options);
  await verifyUnmapped();
  const records = Object.fromEntries(observations.data.map(ref => [ref.path, {
    ...('state' in ref ? { state: 'missing' as const } : { hash: ref.hash }), reviewedNetworkRevision: parsed.data.networkRevision,
    featureFingerprints: relevantFeatureFingerprints(snapshot, ref.path), outcome: parsed.data.outcome,
    reason: parsed.data.reason, decidedAt: new Date().toISOString() }]));
  // Auxiliary evidence is conservative: a lost/stale publication leaves the review open.
  await writeRuntime(project, decisionKey, prior === null ? null : runtimeRevision(prior),
    { version: 1, references: { ...prior?.references, ...records } }, options);
}

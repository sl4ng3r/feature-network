import { Server, type CallToolResult, type Tool } from '@modelcontextprotocol/server';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { z } from 'zod';
import { NetworkError } from '../model/errors.js';
import type { Project } from '../project/root.js';
import { applyUpdate, readSnapshot, type StorageOptions, type UpdateRequest, featureReferences, readReferenceHash } from '../storage/repository.js';
import { buildIndex } from '../query/index.js';
import type { ContextRequest, ImpactRequest } from '../query/pagination.js';
import { queryContext } from '../query/search.js';
import { queryImpact } from '../query/impact.js';
import { checkNetwork } from '../freshness/check.js';
import { confirmReferences, inspectChange, isIgnoredChange, type ReviewObservation } from '../freshness/references.js';
import { bootstrap, type BootstrapResult, type BootstrapRequest } from '../bootstrap/state.js';
import { toolSchemas, type ToolName } from './tools.js';
// Parsed Zod optionals include undefined in their TypeScript type; JSON inputs cannot.
const clean = <T>(value: unknown): T => JSON.parse(JSON.stringify(value)) as T;
const bytes = (value: unknown) => Buffer.byteLength(JSON.stringify(value), 'utf8');
const packageAdvice = 'Retry with budget up to 64000; if still omitted, start with smaller maxFiles/maxBytes. Existing features are preserved.';
// Code-point truncation preserves Unicode and keeps readable previews short.
const preview = (value: unknown, limit = 32): string => typeof value === 'string'
  ? [...value.replace(/[\u0000-\u001f\u007f]/g, ' ')].slice(0, limit).join('') + ([...value].length > limit ? '…' : '') : '';
const object = (value: unknown): Record<string, unknown> => value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
function readable(value: Record<string, unknown>): string {
  let text: string;
  if (Array.isArray(value.items)) {
    const first = object(value.items[0]); const fragment = object(first.fragment);
    const detail = first.fragment ? `JSON fragment ${fragment.offset}/${fragment.total}`
      : first.section ? `section ${preview(first.section)}`
      : preview(first.summary);
    text = `${value.depth !== undefined ? 'Impact' : 'Context'}: ${value.items.length} shown${first.id ? `; ${preview(first.id)}${detail ? `: ${detail}` : ''}${first.status ? ` (${preview(first.status)})` : ''}` : ''}.`;
    text += value.nextCursor ? ` Continue with nextCursor; ${value.omitted} omitted.` : ' Complete.';
    if (value.incomplete) text += ' Integrity incomplete.';
    if (value.depthLimited) text += ' Depth limit reached.';
    if (typeof value.diagnosticsOmitted === 'number' && value.diagnosticsOmitted > 0) text += ` ${value.diagnosticsOmitted} diagnostics omitted.`;
  } else if (value.mode !== undefined) {
    const open = Array.isArray(value.openDecisions) ? value.openDecisions : []; const first = object(open[0]);
    text = `Check ${value.mode}: ${value.integrity}; ${value.freshness}; ${open.length} shown open${first.path ? ` (${preview(first.path)}: ${preview(first.reason)})` : ''}.`;
  } else if (value.runRevision !== undefined) {
    const progress = object(value.progress); const pack = object(value.package); const slices = Array.isArray(pack.slices) ? pack.slices : [];
    text = `Bootstrap: ${value.status}; ${value.basis}; `;
    text += typeof progress.analyzed === 'number' && typeof progress.files === 'number' ? `${progress.analyzed}/${progress.files} files analyzed.` : 'Progress unavailable in this projection.';
    text += value.packageOmitted ? ' Package omitted; retry larger budget or smaller maxFiles/maxBytes.'
      : slices.length ? ` Package: ${slices.length} slices (${preview(object(slices[0]).path)}).` : ' No active package.';
  } else if (value.semanticReview !== undefined) {
    text = `Update: revision ${preview(value.revision, 12)}; semantic review ${value.semanticReview}; ${value.recovered ? 'recovered transaction' : 'no recovery'}.`;
  } else text = 'FeatureNetwork result.';
  if (value.truncated && !value.nextCursor) {
    const omitted = object(value.omitted); const count = Object.values(omitted).reduce<number>((sum, n) => sum + (typeof n === 'number' ? n : 0), 0);
    text += ` Truncated; ${count} entries omitted; retry with a larger budget.`;
  }
  return text;
}
function result(value: object): CallToolResult { return { content: [{ type: 'text', text: readable(value as Record<string, unknown>) }], structuredContent: value as Record<string, unknown> }; }
// Measured boundary is COMPLETE CallToolResult JSON; JSON-RPC ID/envelope is transport.
const emptyWrapperReserve = bytes({ content: [{ type: 'text', text: '' }], structuredContent: {} }) - bytes({});
/** Re-evaluate the SAME snapshot with a monotonically increasing measured text reserve.
 * Eight attempts bound adapter work; unfit metadata always rejects without an empty cursor loop. */
function renderedQuery(query: (reserveBytes: number) => object, budget: number): CallToolResult {
  let reserveBytes = emptyWrapperReserve;
  for (let attempt = 0; attempt < 8; attempt++) {
    const value = query(reserveBytes); const response = result(value);
    if (bytes(response) <= budget) return response;
    reserveBytes = Math.max(reserveBytes + 1, bytes(response) - bytes(value));
  }
  throw new NetworkError('invalid_query', 'Budget cannot accommodate the rendered query');
}
function failure(error: unknown): CallToolResult {
  const code = error instanceof NetworkError && /^[a-z][a-z0-9_]{0,63}$/.test(error.code) ? error.code : 'internal_error';
  return { content: [{ type: 'text', text: `FeatureNetwork: ${code}.` }], structuredContent: { error: { code, message: 'Operation could not be completed; refresh inputs or review the reported state.' } }, isError: true };
}
/** Keep scalar truth and bounded list prefixes, with explicit omission counts. Never silently drop records. */
function bounded(value: Record<string, unknown>, budget: number): CallToolResult {
  if (bytes(result(value)) <= budget) return result(value);
  const projected: Record<string, unknown> = {}; const lists: [string, unknown[]][] = []; const records: [string, Record<string, unknown>][] = [];
  for (const [key, item] of Object.entries(value)) {
    if (Array.isArray(item)) { projected[key] = []; lists.push([key, item]); }
    else if (item !== null && typeof item === 'object') { projected[key] = {}; records.push([key, item as Record<string, unknown>]); }
    else projected[key] = item;
  }
  const omitted: Record<string, number> = Object.fromEntries([...lists.map(([key, list]) => [key, list.length]), ...records.map(([key, object]) => [key, Object.keys(object).length])]);
  projected.truncated = true; projected.omitted = omitted;
  if (bytes(result(projected)) > budget) throw new NetworkError('response_too_large', 'Budget cannot fit minimum result metadata');
  for (const [key, list] of lists) for (const item of list) {
    (projected[key] as unknown[]).push(item); omitted[key]!--;
    if (bytes(result(projected)) > budget) { (projected[key] as unknown[]).pop(); omitted[key]!++; break; }
  }
  for (const [key, object] of records) for (const [name, item] of Object.entries(object)) {
    (projected[key] as Record<string, unknown>)[name] = item; omitted[key]!--;
    if (bytes(result(projected)) > budget) { delete (projected[key] as Record<string, unknown>)[name]; omitted[key]!++; break; }
  }
  return result(projected);
}
function bootstrapProjection(value: BootstrapResult): Record<string, unknown> {
  return { status: value.status, coverage: value.coverage, basis: value.basis, runRevision: value.runRevision,
    networkRevision: value.state?.networkRevision ?? null, package: value.package,
    progress: value.state ? { files: value.state.files.length, analyzed: value.state.files.filter(f => f.status === 'analyzed').length,
      needsReview: value.state.files.filter(f => f.status === 'needs_review').length, relationalReviewComplete: value.state.relationalReviewComplete, ...value.state.counters } : null,
    diagnostics: value.diagnostics };
}
/** One immutable project binding per process; no root is accepted in tool arguments. */
export function createServer(project: Project, installedRoot = dirname(dirname(fileURLToPath(import.meta.url)))): Server {
  const bound = Object.freeze({ ...project });
  const options: StorageOptions = { excludedReferenceRoots: [installedRoot] };
  const server = new Server({ name: 'feature-network', version: '0.1.0' }, { capabilities: { tools: {} } });
  server.onerror = () => { process.stderr.write('FeatureNetwork: protocol_error.\n'); };
  server.setRequestHandler('tools/list', () => ({ tools: Object.entries(toolSchemas).map(([name, schema]) => ({ name,
    description: name === 'network_bootstrap' ? 'Metadata-only project inventory and explicit checkpoint CAS; sanitizedExamples are caller attestations, not secret-free proof.'
      : name === 'network_update' ? 'Guarded network changes followed by explicit source review decisions. Read fingerprints and revision from network_context first.'
      : name === 'network_context' ? 'Bounded feature context. JSON fragments use UTF-16 offsets; concatenate in offset order then JSON.parse. Named sections carry sectionIndex/sectionCount.'
      : name === 'network_check' ? 'Read-only last_known summary or fresh technical check. Does not perform semantic review.' : 'Explain evidenced and hypothetical impact paths; bounded revision-bound continuation.',
    inputSchema: clean<Tool['inputSchema']>({ ...z.toJSONSchema(schema, { io: 'input', unrepresentable: 'any' }), type: 'object' }), annotations: { readOnlyHint: name !== 'network_update' && name !== 'network_bootstrap', destructiveHint: name === 'network_update', idempotentHint: name !== 'network_update' && name !== 'network_bootstrap', openWorldHint: false } })) }));
  server.setRequestHandler('tools/call', async request => {
    try {
      const name = request.params.name;
      if (!Object.hasOwn(toolSchemas, name)) throw new NetworkError('unknown_tool', 'Unknown tool');
      const parsed = toolSchemas[name as ToolName].safeParse(request.params.arguments ?? {});
      if (!parsed.success) throw new NetworkError('invalid_input', 'Invalid tool input');
      let response: CallToolResult; let budget = 12000;
      switch (name as ToolName) {
        case 'network_context': {
          const input = toolSchemas.network_context.parse(parsed.data); budget = input.cursor?.parameters.budget ?? input.budget ?? 12000;
          const index = buildIndex(await readSnapshot(bound, options));
          response = renderedQuery(reserveBytes => queryContext(index, clean<ContextRequest>(input), { responseReserveBytes: reserveBytes, includeFingerprints: true }), budget); break;
        }
        case 'network_impact': {
          const input = toolSchemas.network_impact.parse(parsed.data); budget = input.cursor?.parameters.budget ?? input.budget ?? 12000;
          const index = buildIndex(await readSnapshot(bound, options));
          response = renderedQuery(reserveBytes => queryImpact(index, clean<ImpactRequest>(input), { responseReserveBytes: reserveBytes }), budget); break;
        }
        case 'network_check': {
          const input = toolSchemas.network_check.parse(parsed.data); budget = input.budget ?? 12000;
          const checked = await checkNetwork(bound, input.mode ?? 'summary', input.sessionId, options);
          const open = new Set(checked.openDecisions.map(d => d.path));
          checked.references.sort((a, b) => Number(open.has(b.path)) - Number(open.has(a.path)) || (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
          // Open evidence is emitted before confirmed references and optional diagnostics.
          response = bounded({ mode: checked.mode, freshness: checked.freshness, integrity: checked.integrity, networkRevision: checked.networkRevision, turnAssumptions: checked.turnAssumptions, changeCoverage: checked.changeCoverage, lastCheckedAt: checked.lastCheckedAt, openDecisions: checked.openDecisions, unknownChangeDecisions: checked.unknownChangeDecisions, unknownChanges: checked.unknownChanges, turnChanges: checked.turnChanges, references: checked.references, preexistingChanges: checked.preexistingChanges, diagnostics: checked.diagnostics }, budget); break;
        }
        case 'network_update': {
          const { decision, observations, budget: requestedBudget, ...input } = toolSchemas.network_update.parse(parsed.data); budget = requestedBudget ?? 12000;
          const reviewed: ReviewObservation[] = observations ?? input.verifiedReferences;
          if (!reviewed.length || new Set(reviewed.map(r => r.path)).size !== reviewed.length) throw new NetworkError('invalid_decision', 'A unique explicit review observation is required');
          if (reviewed.some(r => 'state' in r) && decision.outcome !== 'no_semantic_change') throw new NetworkError('invalid_decision', 'Missing observations require no_semantic_change');
          const existing = reviewed.filter((r): r is { path: string; hash: string } => 'hash' in r);
          if (input.verifiedReferences.some(ref => !existing.some(r => r.path === ref.path && r.hash === ref.hash))) throw new NetworkError('invalid_decision', 'Every verified source requires the same semantic observation');
          const missing = reviewed.filter((r): r is { path: string; state: 'missing' } => 'state' in r).map(r => r.path);
          if (missing.length && input.expectedRevision === undefined) throw new NetworkError('invalid_update', 'Missing observations require expectedRevision');
          bounded({ revision: '0'.repeat(64), fingerprints: {}, diagnostics: [], recovered: false, semanticReview: 'recorded' }, budget);
          const before = await readSnapshot(bound, options);
          const changedIds = new Set([...input.upserts.map(f => f.id), ...input.deletes]);
          const afterFeatures = [...before.features.filter(f => !changedIds.has(f.id)), ...input.upserts];
          const mapped = new Set(afterFeatures.flatMap(featureReferences).map(r => r.path));
          if (input.verifiedReferences.some(r => !mapped.has(r.path))) throw new NetworkError('invalid_update', 'Verified baselines are limited to actual network references; use observations for unmapped sources');
          if (decision.outcome === 'updated' && reviewed.some(r => !mapped.has(r.path))) throw new NetworkError('invalid_decision', 'Unmapped observations require no_semantic_change');
          for (const observation of existing) {
            if (!mapped.has(observation.path)) {
              if (await isIgnoredChange(bound, observation.path, options)) throw new NetworkError('invalid_decision', 'Generated or runtime sources cannot receive decisions');
              const observed = await inspectChange(bound, observation.path, options);
              if (observed.state !== 'present') throw new NetworkError(observed.diagnostic?.code ?? 'unverified_reference', 'Unmapped source cannot be safely observed');
            }
            if (await readReferenceHash(bound, observation.path, options) !== observation.hash) throw new NetworkError('conflict', 'Observed source changed');
          }
          const saved = await applyUpdate(bound, clean<UpdateRequest>({ ...input, expectedMissingReferences: [...new Set([...(input.expectedMissingReferences ?? []), ...missing])] }), options);
          await confirmReferences(bound, reviewed, { ...decision, networkRevision: saved.revision }, options);
          const changed = new Set(['network-spec/_meta.yaml', ...input.upserts.map(f => `network-spec/${f.id}.yaml`), ...input.deletes.map(id => `network-spec/${id}.yaml`)]);
          response = bounded({ ...saved, fingerprints: Object.fromEntries(Object.entries(saved.fingerprints).filter(([path]) => changed.has(path))), semanticReview: 'recorded' }, budget); break;
        }
        case 'network_bootstrap': {
          const { budget: requestedBudget, ...input } = toolSchemas.network_bootstrap.parse(parsed.data); budget = requestedBudget ?? 12000;
          if (input.action !== 'status' && bytes(result({ status: 'awaiting_relational_review', coverage: 'partial', basis: 'last_known', runRevision: '0'.repeat(64), networkRevision: '0'.repeat(64), package: null, packageOmitted: true, nextAction: packageAdvice, progress: {}, diagnostics: [], truncated: true, omitted: { progress: Number.MAX_SAFE_INTEGER, diagnostics: Number.MAX_SAFE_INTEGER } })) > budget) throw new NetworkError('response_too_large', 'Budget cannot fit minimum bootstrap receipt');
          const value = await bootstrap(bound, clean<BootstrapRequest>(input), options);
          const projection = bootstrapProjection(value);
          if (bytes(result(projection)) > budget && value.package !== null) {
            projection.package = null; projection.packageOmitted = true;
            projection.nextAction = packageAdvice;
          }
          response = bounded(projection, budget); break;
        }
      }
      const projected = server.projectCallToolResult(response!, undefined);
      if (bytes(projected) > budget) throw new NetworkError('response_too_large', 'Tool result exceeds requested response budget');
      return projected;
    } catch (error) { return server.projectCallToolResult(failure(error), undefined); }
  });
  return server;
}

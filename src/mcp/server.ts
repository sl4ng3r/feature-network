import { Server, type CallToolResult, type Tool } from '@modelcontextprotocol/server';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { z } from 'zod';
import { NetworkError } from '../model/errors.js';
import type { Project } from '../project/root.js';
import { applyUpdate, readSnapshot, type StorageOptions, type UpdateRequest, featureReferences, readReferenceHash } from '../storage/repository.js';
import { buildIndex, refreshIndex, type NetworkIndex } from '../query/index.js';
import type { ContextRequest, ImpactRequest } from '../query/pagination.js';
import { queryContext } from '../query/search.js';
import { queryImpact } from '../query/impact.js';
import { checkNetwork, queryFreshness } from '../freshness/check.js';
import { confirmReferences, inspectChange, isIgnoredChange, type ReviewObservation } from '../freshness/references.js';
import { bootstrap, type BootstrapResult, type BootstrapRequest } from '../bootstrap/state.js';
import { toolSchemas, type ToolName } from './tools.js';
import { connectedToolSchemas,handleConnectedTool,initializeConnected,maintenanceFailure } from './connected.js';
import { MaintenanceError } from '../memory/maintenance.js';
import { projectSchema } from '../project/schema-version.js';
import { readConnections } from '../project/connections.js';
import { withWorkMeter,type WorkMeter } from '../diagnostics/work.js';
function discoverySchema(name: ToolName): Tool['inputSchema'] {
 const legacy=z.toJSONSchema(toolSchemas[name],{io:'input',unrepresentable:'any'});
 if(name==='network_bootstrap')return clean<Tool['inputSchema']>({...legacy,type:'object'});
 const next=z.toJSONSchema(connectedToolSchemas[name],{io:'input',unrepresentable:'any'});
 const descriptions=name==='network_update'?Object.fromEntries(Object.entries((legacy as {properties?:Record<string,{description?:string}>}).properties??{}).filter(([,v])=>v.description).map(([k,v])=>[k,{description:v.description}])):{};
 return clean<Tool['inputSchema']>({type:'object',anyOf:[legacy,next],properties:descriptions});
}
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
    if (value.freshness) {
      const states = Object.values(object(value.freshness)).map(entry => object(entry));
      const warnings = [...new Set(states.filter(entry => entry.state !== 'current' || entry.review !== 'recorded').map(entry => entry.state === 'current' ? 'review open' : entry.state))];
      if (warnings.length) text += ` Freshness: ${warnings.join(', ')}.`;
    }
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
    const records = Array.isArray(value.records) ? value.records : [];
    const first = object(records[0]);
    if (first.path) text += ` ${preview(first.path)}: ${preview(first.reason)}.`;
    if (value.nextRecordCursor) text += ` Continue records with nextRecordCursor; ${value.recordsOmitted} omitted.`;
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
type RecordFilter = 'all' | 'needs_review' | 'excluded' | 'scope';
interface RecordCursor { revision: string; filter: RecordFilter; offset: number }
/** Record continuation is independent of analysis packages. Even files with no
 * readable slices and large configured scope lists remain reachable via status. */
function bootstrapResponse(value: BootstrapResult, budget: number, filter: RecordFilter = 'all', cursor?: RecordCursor): CallToolResult {
  if (cursor && (cursor.revision !== value.runRevision || cursor.filter !== filter)) throw new NetworkError('stale_cursor', 'Bootstrap inventory changed; restart record listing');
  const configured = value.state?.options;
  const records = filter === 'scope'
    ? [...(configured?.scope ?? []).map(path => ({ path, status: 'scope', reason: 'selected_scope' })), ...(configured?.exclusions ?? []).map(path => ({ path, status: 'excluded', reason: 'configured_exclusion' }))]
    : (value.state?.files ?? []).filter(file => (filter === 'all' ? ['needs_review', 'excluded'].includes(file.status) : file.status === filter))
      .sort((a, b) => Number(b.status === 'needs_review') - Number(a.status === 'needs_review') || a.path.localeCompare(b.path))
      .map(({ path, status, reason }) => ({ path, status, reason }));
  const offset = cursor?.offset ?? 0;
  if (offset > records.length) throw new NetworkError('invalid_cursor', 'Record offset is outside inventory');
  const projection = bootstrapProjection(value);
  projection.records = [];
  projection.recordsOmitted = records.length - offset;
  projection.selectedScope = { scope: configured?.scope ?? [], exclusions: configured?.exclusions ?? [], detailsFilter: 'scope' };
  const finalize = (next: number) => {
    projection.recordsOmitted = records.length - next;
    if (next < records.length) projection.nextRecordCursor = { revision: value.runRevision, filter, offset: next };
    else delete projection.nextRecordCursor;
  };
  finalize(offset);
  const fits = () => bytes(result(projection)) <= budget;
  // Package output remains primary when it fits; the records have their own
  // reachable status continuation, so neither output silently removes the other.
  if (!fits() && value.package !== null) {
    projection.package = null; projection.packageOmitted = true; projection.nextAction = packageAdvice;
  }
  if (!fits()) projection.selectedScope = { scopeCount: configured?.scope.length ?? 0, exclusionCount: configured?.exclusions.length ?? 0, detailsFilter: 'scope' };
  if (!fits()) {
    const reduced = bounded(projection, budget).structuredContent!;
    Object.assign(projection, reduced);
  }
  const returned = projection.records as unknown[];
  for (let i = offset; i < records.length; i++) {
    returned.push(records[i]); finalize(i + 1);
    if (!fits()) { returned.pop(); finalize(i); break; }
  }
  if (offset < records.length && !returned.length) {
    // Retry just the bounded record listing, without a package/progress payload.
    if (value.package !== null) { projection.package = null; projection.packageOmitted = true; }
    projection.progress = null;
    projection.selectedScope = { scopeCount: configured?.scope.length ?? 0, exclusionCount: configured?.exclusions.length ?? 0, detailsFilter: 'scope' };
    returned.push(records[offset]); finalize(offset + 1);
    if (!fits()) throw new NetworkError('response_too_large', 'Budget cannot fit one bootstrap record; retry a larger budget');
  }
  return result(projection);
}
/** A successful write always has a preflighted receipt even if one path/reason
 * cannot fit. Read-only status can then require a larger budget for that record. */
function bootstrapReceipt(value: BootstrapResult | null, budget: number): CallToolResult {
  const count = value ? value.state?.files.filter(file => ['needs_review', 'excluded'].includes(file.status)).length ?? 0 : Number.MAX_SAFE_INTEGER;
  const revision = value ? value.runRevision : '0'.repeat(64);
  const receipt = {
    status: value?.status ?? 'awaiting_relational_review', coverage: 'partial', basis: 'last_known',
    runRevision: revision, networkRevision: value ? value.state?.networkRevision ?? null : '0'.repeat(64),
    package: null, packageOmitted: value ? value.package !== null : true,
    progress: null, diagnostics: [], records: [], recordsOmitted: count,
    selectedScope: { scopeCount: value ? value.state?.options.scope.length ?? 0 : Number.MAX_SAFE_INTEGER,
      exclusionCount: value ? value.state?.options.exclusions.length ?? 0 : Number.MAX_SAFE_INTEGER, detailsFilter: 'scope' },
    ...(count ? { nextRecordCursor: { revision, filter: 'all', offset: 0 } } : {}),
    recordsRequireLargerBudget: true, truncated: true,
    omitted: { progress: value?.state || value === null ? 6 : 0, diagnostics: value ? value.diagnostics.length : Number.MAX_SAFE_INTEGER },
  };
  const response = result(receipt);
  if (bytes(response) > budget) throw new NetworkError('response_too_large', 'Budget cannot fit minimum bootstrap receipt');
  return response;
}
/** One immutable project binding per process; no root is accepted in tool arguments. */
export function createServer(project: Project, installedRoot = dirname(dirname(fileURLToPath(import.meta.url))), internal: {meter?:WorkMeter} = {}): Server {
  const bound = Object.freeze({ ...project });
  const options = { excludedReferenceRoots: [installedRoot], ...(internal.meter?{meter:internal.meter}:{}) };
  let previousIndex: NetworkIndex | undefined;
  const server = new Server({ name: 'feature-network', version: '0.1.0' }, { capabilities: { tools: {} } });
  server.onerror = () => { process.stderr.write('FeatureNetwork: protocol_error.\n'); };
  server.setRequestHandler('tools/list', () => ({ tools: Object.entries(toolSchemas).map(([name, schema]) => ({ name,
    description: name === 'network_bootstrap' ? 'Metadata-only project inventory and explicit checkpoint CAS; sanitizedExamples are caller attestations, not secret-free proof.'
      : name === 'network_update' ? 'Use two guarded writes: mapped upserts with verifiedReferences, updated decision and observations omitted; then unmapped test observations with empty upserts/verifiedReferences and no_semantic_change at a fresh returned revision. Explicit observations replaces the implicit verifiedReferences review list: nonempty, including every verified path/hash. Copy exact structured response tokens and actual source SHA-256 output; never truncate or reconstruct. For invalid_input inspect schemas/tokens; for invalid_decision repair observation composition, never bypass guards.'
      : name === 'network_context' ? 'Bounded feature context. JSON fragments use UTF-16 offsets; concatenate in offset order then JSON.parse. Named sections carry sectionIndex/sectionCount.'
      : name === 'network_check' ? 'Read-only last_known summary or fresh technical check. Does not perform semantic review.' : 'Use network_context first to resolve direct origin IDs, then query those roots, not all candidate dependents. Each origin is a zero-length seed path. When children point to parents, incoming finds dependents; use explicit direction both normally, depth 2. Explain evidenced and hypothetical paths; bounded revision-bound continuation with cursor only.',
    inputSchema: discoverySchema(name as ToolName), annotations: { readOnlyHint: name !== 'network_update' && name !== 'network_bootstrap', destructiveHint: name === 'network_update', idempotentHint: name !== 'network_update' && name !== 'network_bootstrap', openWorldHint: false } })) }));
  server.setRequestHandler('tools/call', request => withWorkMeter(internal.meter,async () => {
    try {
      const name = request.params.name;
      if (!Object.hasOwn(toolSchemas, name)) throw new NetworkError('unknown_tool', 'Unknown tool');
      const raw=request.params.arguments??{};
      let version:1|2|null=null;try{version=await projectSchema(bound);}catch{/* Legacy readers retain invalid-marker diagnostics. */}
      if(name!=='network_bootstrap'&&(version===2||(version===null&&object(raw).kind==='memory'))){
        const schema=connectedToolSchemas[name as keyof typeof connectedToolSchemas];
        if(!schema.safeParse(raw).success)throw new NetworkError('invalid_input','Invalid versioned tool input');
        const response=version===null?await initializeConnected(bound,raw,options):await handleConnectedTool(name as ToolName,raw,await readConnections(bound),options);
        return server.projectCallToolResult(response,undefined);
      }
      const parsed = toolSchemas[name as ToolName].safeParse(raw);
      if (!parsed.success) throw new NetworkError('invalid_input', 'Invalid tool input');
      let response: CallToolResult; let budget = 12000;
      switch (name as ToolName) {
        case 'network_context': {
          const input = toolSchemas.network_context.parse(parsed.data); budget = input.cursor?.parameters.budget ?? input.budget ?? 12000;
          const snapshot = await readSnapshot(bound, options);
          const index = previousIndex ? refreshIndex(previousIndex, snapshot) : buildIndex(snapshot);
          previousIndex = index;
          const preliminary = queryContext(index, clean<ContextRequest>(input));
          const freshness = await queryFreshness(bound, snapshot, preliminary.items.map(item => item.id), options);
          response = renderedQuery(reserveBytes => queryContext(index, clean<ContextRequest>(input), { responseReserveBytes: reserveBytes, includeFingerprints: true, freshness }), budget); break;
        }
        case 'network_impact': {
          const input = toolSchemas.network_impact.parse(parsed.data); budget = input.cursor?.parameters.budget ?? input.budget ?? 12000;
          const snapshot = await readSnapshot(bound, options);
          const index = previousIndex ? refreshIndex(previousIndex, snapshot) : buildIndex(snapshot);
          previousIndex = index;
          const preliminary = queryImpact(index, clean<ImpactRequest>(input));
          const freshness = await queryFreshness(bound, snapshot, preliminary.items.map(item => item.id), options);
          response = renderedQuery(reserveBytes => queryImpact(index, clean<ImpactRequest>(input), { responseReserveBytes: reserveBytes, freshness }), budget); break;
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
          const before = await readSnapshot(bound, options, true);
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
          if (input.action !== 'status') bootstrapReceipt(null, budget);
          const value = await bootstrap(bound, clean<BootstrapRequest>(input), options);
          const listing = input.action === 'status' ? input : undefined;
          try {
            response = bootstrapResponse(value, budget, listing?.recordFilter ?? listing?.recordCursor?.filter ?? 'all', listing?.recordCursor);
          } catch (error) {
            if (input.action === 'status' || !(error instanceof NetworkError) || error.code !== 'response_too_large') throw error;
            response = bootstrapReceipt(value, budget);
          }
          break;
        }
      }
      const projected = server.projectCallToolResult(response!, undefined);
      if (bytes(projected) > budget) throw new NetworkError('response_too_large', 'Tool result exceeds requested response budget');
      return projected;
    } catch (error) { return server.projectCallToolResult(error instanceof MaintenanceError?maintenanceFailure(error):failure(error), undefined); }
  }));
  return server;
}

import { z } from 'zod';
import { NetworkError } from '../model/errors.js';
import type { Project } from '../project/root.js';
import { digest, hasJournal, revision, stableCapture } from '../storage/journal.js';
import { featureReferences, readReferenceHash, readSnapshot, type Snapshot, type StorageOptions } from '../storage/repository.js';
import { readRuntime, runtimeRevision, writeRuntime } from '../storage/runtime.js';
import { inventory } from './inventory.js';
import { planBatches, type Batch } from './batches.js';
const hash = z.string().regex(/^[a-f0-9]{64}$/);
const integer = z.number().int().nonnegative();
const sliceSchema = z.strictObject({ startByte: integer, endByte: integer, startLine: integer.min(1), endLine: integer.min(1), bytes: integer.max(65536), hash });
const batchSchema = z.strictObject({ id: hash, slices: z.array(sliceSchema.extend({ path: z.string(), fileHash: hash })), plannedBytes: integer.max(65536) });
const fileSchema = z.strictObject({ path: z.string(), hash: hash.nullable(), slices: z.array(sliceSchema), status: z.enum(['pending', 'analyzed', 'excluded', 'needs_review']), reason: z.string().nullable(), sliceReviews: z.record(z.string(), z.strictObject({ outcome: z.enum(['analyzed', 'needs_review']), reason: z.string().min(1), featureIds: z.array(z.string()) })), featureFingerprints: z.record(z.string(), hash) });
const optionsSchema = z.strictObject({ maxFiles: integer.min(1).max(20), maxBytes: integer.min(4).max(65536), scope: z.array(z.string()), exclusions: z.array(z.string()), sanitizedExamples: z.array(z.strictObject({ path: z.string(), hash })) });
const runSchema = z.strictObject({ version: z.literal(1), projectId: hash, checkoutIdentity: hash, revision: integer, options: optionsSchema,
  files: z.array(fileSchema), activePackage: batchSchema.nullable(), relationalReviewComplete: z.boolean(), networkRevision: hash,
  counters: z.strictObject({ packages: integer, bytes: integer }) });
export type BootstrapState = z.infer<typeof runSchema>;
export interface SliceResult { path: string; startByte: number; endByte: number; featureIds: string[]; outcome: 'analyzed' | 'needs_review'; reason: string }
export type BootstrapRequest = { action: 'status' } | { action: 'start'; reconcile?: boolean; maxFiles?: number; maxBytes?: number; scope?: string[]; exclusions?: string[]; sanitizedExamples?: { path: string; hash: string }[] }
  | { action: 'next' } | { action: 'checkpoint'; expectedRunRevision: string; packageId: string | null; networkRevision: string;
    sources: { path: string; hash: string }[]; featureFingerprints: Record<string, string>; results: SliceResult[]; relationalReviewComplete?: boolean; reason?: string };
export interface BootstrapResult { status: 'not_started' | 'pending' | 'needs_review' | 'awaiting_relational_review' | 'completed' | 'unavailable' | 'invalid_checkpoint' | 'invalid_network' | 'pending_recovery' | 'reconciliation_required'; coverage: 'partial'; runRevision: string | null; state: BootstrapState | null; package: Batch | null; diagnostics: { code: string; message: string }[]; basis: 'last_known' }
const key = 'bootstrap/run';
const sliceKey = (s: { path: string; startByte: number; endByte: number }) => JSON.stringify([s.path, s.startByte, s.endByte]);
function conflict(message: string): never { throw new NetworkError('conflict', message); }
function result(state: BootstrapState | null, status?: BootstrapResult['status']): BootstrapResult {
  return { status: status ?? (state === null ? 'not_started' : state.files.some(f => f.status === 'needs_review') ? 'needs_review'
    : state.files.some(f => f.status === 'pending') ? 'pending' : state.relationalReviewComplete ? 'completed' : 'awaiting_relational_review'),
  coverage: 'partial', runRevision: state === null ? null : runtimeRevision(state), state, package: state?.activePackage ?? null, diagnostics: [], basis: 'last_known' };
}
function nextPackage(state: BootstrapState): Batch | null {
  return planBatches(state.files.map(f => ({ ...f, status: f.status === 'needs_review' && f.slices.length ? 'pending' : f.status,
    slices: f.slices.filter(s => f.sliceReviews[sliceKey({ ...s, path: f.path })]?.outcome !== 'analyzed') })), state.options.maxFiles, state.options.maxBytes)[0] ?? null;
}
function hardInvalid(snapshot: Snapshot): boolean {
  return snapshot.integrity === 'invalid' && snapshot.diagnostics.some(d => d.severity === 'error' && d.code !== 'missing_reference');
}
async function guard(project: Project, snapshot: Snapshot, sources: { path: string; hash: string }[], options: StorageOptions) {
  if (await hasJournal(project)) conflict('Pending recovery blocks bootstrap publication');
  if (revision(await stableCapture(project)) !== snapshot.revision) conflict('Network changed before checkpoint publication');
  for (const source of sources) if (await readReferenceHash(project, source.path, options) !== source.hash) conflict('Source changed before checkpoint publication');
}
/** Source analysis and network updates belong to the calling agent. This API stores metadata only. */
export async function bootstrap(project: Project, request: BootstrapRequest, storageOptions: StorageOptions = {}): Promise<BootstrapResult> {
  const snapshot = await readSnapshot(project, storageOptions);
  if (snapshot.integrity === 'pending_recovery') return result(null, 'pending_recovery');
  if (hardInvalid(snapshot)) return result(null, 'invalid_network');
  let state: BootstrapState | null;
  try {
    const raw = await readRuntime<unknown>(project, key);
    if (raw === null) state = null;
    else { runSchema.parse(raw); state = raw as BootstrapState; } // Preserve raw JSON key order for runtime CAS.
  } catch (error) { if (error instanceof NetworkError && error.code === 'unsafe_path') throw error; return result(null, 'invalid_checkpoint'); }
  const expected = state === null ? null : runtimeRevision(state); const projectId = digest(project.root);
  if (state && state.projectId !== projectId && !(request.action === 'start' && request.reconcile)) return result(state, 'reconciliation_required');
  if (request.action === 'status') return result(state, snapshot.integrity === 'invalid' ? 'invalid_network' : undefined);
  if (request.action === 'checkpoint') {
    if (!state || expected !== request.expectedRunRevision) conflict('Bootstrap run revision changed');
    if (snapshot.integrity === 'invalid') return result(state, 'invalid_network');
    if (snapshot.revision !== request.networkRevision) conflict('Network revision changed');
    const observed = await inventory(project, { ...state.options, ...storageOptions });
    if (observed.status === 'unavailable') return result(state, 'unavailable');
    if (observed.checkoutIdentity !== state.checkoutIdentity) return result(state, 'reconciliation_required');
    const batch = state.activePackage;
    if ((batch?.id ?? null) !== request.packageId) conflict('Only the active sequential package can be acknowledged');
    const next = structuredClone(state);
    const supplied = new Map(request.sources.map(s => [s.path, s.hash]));
    const expectedSources = new Map(batch?.slices.map(s => [s.path, s.fileHash]) ?? []);
    if (supplied.size !== request.sources.length || supplied.size !== expectedSources.size || [...expectedSources].some(([p, h]) => supplied.get(p) !== h)) conflict('Checkpoint source hashes do not match active package');
    for (const [id, fingerprint] of Object.entries(request.featureFingerprints)) {
      if (snapshot.fingerprints[`network-spec/${id}.yaml`] !== fingerprint || !snapshot.features.some(f => f.id === id)) conflict('Feature fingerprint was not saved');
    }
    const receipts = new Map(request.results.map(r => [sliceKey(r), r]));
    if (receipts.size !== request.results.length || receipts.size !== (batch?.slices.length ?? 0)) conflict('Checkpoint must cover precisely the active package');
    for (const slice of batch?.slices ?? []) {
      const receipt = receipts.get(sliceKey(slice));
      if (!receipt || !receipt.reason.trim() || !['analyzed', 'needs_review'].includes(receipt.outcome)) throw new NetworkError('invalid_checkpoint', 'Every slice requires an explicit analysis outcome and reason');
      if (snapshot.features.filter(f => featureReferences(f).some(r => r.path === slice.path)).some(f => !receipt.featureIds.includes(f.id))) conflict('Mapped source requires its saved feature associations');
      const current = observed.files.find(f => f.path === slice.path);
      if (!current || current.status !== 'pending' || current.hash !== slice.fileHash) conflict('Package source changed or became excluded');
      const file = next.files.find(f => f.path === slice.path)!;
      for (const id of receipt.featureIds) {
        if (!Object.hasOwn(request.featureFingerprints, id)) conflict('Feature association lacks saved fingerprint');
        file.featureFingerprints[id] = request.featureFingerprints[id]!;
      }
      file.sliceReviews[sliceKey(slice)] = { outcome: receipt.outcome, reason: receipt.reason, featureIds: receipt.featureIds };
      if (receipt.outcome === 'needs_review') { file.status = 'needs_review'; file.reason = receipt.reason; }
    }
    for (const file of next.files) if (['pending', 'needs_review'].includes(file.status) && file.slices.length && file.slices.every(s => file.sliceReviews[sliceKey({ ...s, path: file.path })]?.outcome === 'analyzed')) { file.status = 'analyzed'; file.reason = null; }
    if (request.relationalReviewComplete) {
      if (!request.reason?.trim() || next.files.some(f => !['analyzed', 'excluded'].includes(f.status))) throw new NetworkError('invalid_checkpoint', 'Cross-area completion requires all files resolved and a reason');
      if (snapshot.features.some(f => request.featureFingerprints[f.id] !== snapshot.fingerprints[`network-spec/${f.id}.yaml`])) conflict('Cross-area review must identify every saved feature');
      // A final inventory change is never hidden by acknowledgement of the last old package.
      if (observed.files.some(f => !next.files.some(old => old.path === f.path && old.hash === f.hash && (f.status !== 'pending' || old.status === 'analyzed')))) conflict('Inventory changed before relational completion');
      next.relationalReviewComplete = true;
    }
    next.activePackage = null; next.networkRevision = snapshot.revision; next.revision++;
    if (batch) { next.counters.packages++; next.counters.bytes += batch.plannedBytes; }
    const guardedSources = request.relationalReviewComplete ? next.files.filter(f => f.status === 'analyzed' && f.hash !== null).map(f => ({ path: f.path, hash: f.hash! })) : request.sources;
    await writeRuntime(project, key, expected, next, storageOptions, () => guard(project, snapshot, guardedSources, storageOptions));
    return result(next);
  }
  if (request.action === 'next' && !state) return result(null);
  const options = request.action === 'start' ? { maxFiles: request.maxFiles ?? state?.options.maxFiles ?? 20, maxBytes: request.maxBytes ?? state?.options.maxBytes ?? 65536, scope: request.scope ?? state?.options.scope ?? [], exclusions: request.exclusions ?? state?.options.exclusions ?? [], sanitizedExamples: request.sanitizedExamples ?? state?.options.sanitizedExamples ?? [] }
    : state!.options;
  if (!optionsSchema.safeParse(options).success) throw new NetworkError('invalid_checkpoint', 'Invalid inventory options or analysis limits');
  for (const path of [...options.scope, ...options.exclusions, ...options.sanitizedExamples.map(e => e.path)]) {
    if (!path || path.startsWith('/') || /[\\\u0000-\u001f]/.test(path) || path.split('/').some(p => !p || p === '..' || p === '.')) throw new NetworkError('unsafe_path', 'Inventory areas must be relative paths');
  }
  const observed = await inventory(project, { ...options, ...storageOptions });
  if (observed.status === 'unavailable') return { ...result(state, 'unavailable'), diagnostics: observed.diagnostics };
  const identityChanged = state !== null && (state.checkoutIdentity !== observed.checkoutIdentity || state.projectId !== projectId);
  if (identityChanged && !(request.action === 'start' && request.reconcile)) return result(state, 'reconciliation_required');
  const references = new Set(snapshot.features.flatMap(featureReferences).map(r => r.path));
  const files: BootstrapState['files'] = observed.files.map(file => {
    const old = !identityChanged && state?.files.find(f => f.path === file.path && f.hash === file.hash && f.hash !== null);
    const mapped = snapshot.features.filter(f => featureReferences(f).some(r => r.path === file.path));
    const valid = old && old.slices.length === file.slices.length && old.slices.every((s, i) => s.hash === file.slices[i]?.hash) && mapped.every(f => old.featureFingerprints[f.id] === snapshot.fingerprints[`network-spec/${f.id}.yaml`]) && Object.entries(old.featureFingerprints).every(([id, fingerprint]) => snapshot.fingerprints[`network-spec/${id}.yaml`] === fingerprint);
    if (file.reason === 'deleted' && !references.has(file.path)) file.status = 'excluded';
    return valid && file.status === 'pending' ? { ...old } : { ...file, sliceReviews: {}, featureFingerprints: {} };
  });
  for (const old of state?.files ?? []) if (!files.some(f => f.path === old.path)) files.push({ ...old, hash: null, slices: [], sliceReviews: {}, status: references.has(old.path) ? 'needs_review' : 'excluded', reason: 'deleted' });
  const next: BootstrapState = { version: 1, projectId, checkoutIdentity: observed.checkoutIdentity!, revision: state?.revision ?? 0, options, files,
    activePackage: null, networkRevision: snapshot.revision, relationalReviewComplete: state?.relationalReviewComplete ?? false, counters: state?.counters ?? { packages: 0, bytes: 0 } };
  if (identityChanged || !state || JSON.stringify(files) !== JSON.stringify(state.files) || snapshot.revision !== state.networkRevision || JSON.stringify(options) !== JSON.stringify(state.options)) next.relationalReviewComplete = false;
  next.activePackage = nextPackage(next);
  if (state && JSON.stringify(next) === JSON.stringify(state)) return result(state);
  next.revision++;
  await writeRuntime(project, key, expected, next, storageOptions, () => guard(project, snapshot, [], storageOptions));
  return result(next);
}

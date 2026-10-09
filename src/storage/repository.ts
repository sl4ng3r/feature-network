import { constants } from 'node:fs';
import { lstat, open, realpath } from 'node:fs/promises';
import { relative, resolve, sep } from 'node:path';
import { stringify } from 'yaml';
import { NetworkError } from '../model/errors.js';
import { parseFeature, parseMeta } from '../model/schema.js';
import type { Diagnostic, Feature, Fingerprint, Reference, VerifiedReference } from '../model/types.js';
import { resolveProjectPath } from '../project/paths.js';
import { readGitState } from '../project/git.js';
import type { Project } from '../project/root.js';
import { withProjectLock, isMissing, storagePath } from './lock.js';
import { atomicStorageWrite, digest, fingerprints, finishJournal, hasJournal, journalTarget, readJournal, readStorage, revision, saveJournal, stableCapture, type Contents, type Fingerprints } from './journal.js';

export interface StorageOptions { excludedReferenceRoots?: readonly string[] }
export interface Snapshot {
  revision: Fingerprint;
  features: Feature[];
  diagnostics: Diagnostic[];
  fingerprints: Fingerprints;
  integrity: 'valid' | 'invalid' | 'not_initialized' | 'pending_recovery';
}
export interface UpdateRequest {
  expected: Record<string, Fingerprint | null>;
  expectedRevision?: Fingerprint;
  upserts: Feature[];
  deletes: string[];
  verifiedReferences: VerifiedReference[];
  initialize?: boolean;
}
export interface UpdateResult { revision: Fingerprint; fingerprints: Fingerprints; diagnostics: Diagnostic[]; recovered: boolean }
export interface Baselines { networkRevision: Fingerprint; references: Record<string, Fingerprint> }
const marker = 'network-spec/_meta.yaml';
const featurePath = (id: string) => {
  if (!/^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/.test(id)) throw new NetworkError('invalid_update', 'Invalid feature ID', [id]);
  return `network-spec/${id}.yaml`;
};
export function featureReferences(feature: Feature): Reference[] {
  return [...feature.code, ...feature.evidence, ...feature.relations.flatMap(r => r.evidence), ...feature.hypotheses.flatMap(h => h.evidence)];
}
function inside(root: string, path: string): boolean {
  const suffix = relative(root, path); return suffix === '' || (!suffix.startsWith(`..${sep}`) && suffix !== '..' && !suffix.startsWith(sep));
}
/** Canonical exclusions are checked before opening source bytes, including aliases. */
export async function readReferenceHash(project: Project, path: string, options: StorageOptions): Promise<string> {
  const absolute = await resolveProjectPath(project, path);
  const excluded = [resolve(project.root, '.git'), project.networkDir, project.runtimeDir];
  for (const root of options.excludedReferenceRoots ?? []) {
    try { excluded.push(await realpath(root)); } catch (error) { if (!isMissing(error)) throw error; excluded.push(resolve(root)); }
  }
  const components = relative(project.root, absolute).split(sep);
  if (path.split('/').some(p => ['.git', '.feature-network', 'network-spec'].includes(p))
    || components.some(p => ['.git', '.feature-network', 'network-spec'].includes(p)) || excluded.some(root => inside(root, absolute))) {
    throw new NetworkError('unsafe_reference', 'Reference points into excluded metadata or plugin storage', [path]);
  }
  const file = await open(absolute, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    if (!(await file.stat()).isFile()) throw new NetworkError('unsafe_reference', 'Reference is not a regular file', [path]);
    return digest(await file.readFile());
  } finally { await file.close(); }
}
function diagnostic(error: unknown, path: string): Diagnostic {
  return { code: error instanceof NetworkError ? error.code : isMissing(error) ? 'missing_reference' : 'unreadable_reference',
    path, severity: 'error', message: error instanceof NetworkError ? error.message : 'Referenced file could not be read' };
}
function yamlText(bytes: Buffer): string {
  try { return new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bytes); }
  catch { throw new NetworkError('invalid_schema', 'YAML is not valid UTF-8'); }
}
async function validate(project: Project, contents: Contents, options: StorageOptions): Promise<{ features: Feature[]; diagnostics: Diagnostic[] }> {
  const features: Feature[] = []; const diagnostics: Diagnostic[] = [];
  try { if (contents[marker] === undefined) throw new NetworkError('not_initialized', 'Network marker is missing'); parseMeta(yamlText(contents[marker])); }
  catch (error) { diagnostics.push(diagnostic(error, marker)); }
  for (const path of Object.keys(contents).sort()) {
    if (path === marker) continue;
    try { features.push(parseFeature(yamlText(contents[path]!), path)); }
    catch (error) { diagnostics.push(diagnostic(error, path)); }
  }
  const ids = new Set(features.map(feature => feature.id)); const checked = new Set<string>();
  for (const feature of features) {
    for (const relation of feature.relations) {
      if (!ids.has(relation.to)) diagnostics.push({ code: 'missing_target', path: featurePath(feature.id), severity: 'error', message: `Relation target is absent: ${relation.to}` });
    }
    for (const reference of featureReferences(feature)) {
      if (checked.has(reference.path)) continue; checked.add(reference.path);
      try { await readReferenceHash(project, reference.path, options); } catch (error) { diagnostics.push(diagnostic(error, reference.path)); }
    }
  }
  return { features, diagnostics };
}
async function gitDiagnostics(project: Project): Promise<Diagnostic[]> {
  const git = await readGitState(project);
  const diagnostics = [...git.diagnostics];
  // ls-files covers unchanged tracked runtime files as well as dirty ones.
  // readGitState deliberately exposes only changed paths, so use fixed read-only index lookup.
  try {
    const { execFile } = await import('node:child_process'); const { promisify } = await import('node:util');
    const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.toUpperCase().startsWith('GIT_')));
    const { stdout } = await promisify(execFile)('git', ['--no-optional-locks', '-c', 'core.fsmonitor=false', '-C', project.root, 'ls-files', '-z', '--', '.feature-network/'], { env, timeout: 2000, maxBuffer: 1024 * 1024 });
    if (stdout.length) diagnostics.push({ code: 'tracked_runtime', severity: 'warning', message: 'Runtime data is tracked by Git; local ignore rules do not untrack existing files' });
  } catch {
    if (git.status === 'available') diagnostics.push({ code: 'runtime_tracking_unknown', severity: 'warning', message: 'Could not determine whether runtime data is tracked' });
  }
  return diagnostics;
}
function emptySnapshot(integrity: Snapshot['integrity'], code: string): Snapshot {
  return { revision: revision({}), features: [], diagnostics: [{ code, severity: 'error', message: code === 'pending_recovery' ? 'An interrupted transaction needs a write to recover' : 'Network is not initialized' }], fingerprints: {}, integrity };
}
export async function readSnapshot(project: Project, options: StorageOptions = {}): Promise<Snapshot> {
  // This read-only preflight does not create runtime directories for an uninitialized project.
  if (!(await hasJournal(project))) {
    try { await lstat(await storagePath(project, marker)); }
    catch (error) { if (isMissing(error)) return emptySnapshot('not_initialized', 'not_initialized'); throw error; }
  }
  const snapshot = await withProjectLock(project, async () => {
    if (await hasJournal(project)) return emptySnapshot('pending_recovery', 'pending_recovery');
    const contents = await stableCapture(project);
    return { ...emptySnapshot('valid', ''), revision: revision(contents), fingerprints: fingerprints(contents), contents };
  });
  // Expensive Git/reference work is outside the short snapshot lock.
  if (!('contents' in snapshot)) return snapshot;
  const validation = await validate(project, snapshot.contents, options);
  return { revision: snapshot.revision, fingerprints: snapshot.fingerprints, features: validation.features,
    diagnostics: [...validation.diagnostics, ...await gitDiagnostics(project)], integrity: validation.diagnostics.length ? 'invalid' : 'valid' };
}
async function verifiedHashes(project: Project, references: VerifiedReference[], options: StorageOptions): Promise<Record<string, string>> {
  const hashes: Record<string, string> = Object.create(null);
  for (const reference of references) {
    if (!/^[a-f0-9]{64}$/.test(reference.hash) || (Object.hasOwn(hashes, reference.path) && hashes[reference.path] !== reference.hash)) throw new NetworkError('invalid_update', 'Invalid reference hash', [reference.path]);
    if (await readReferenceHash(project, reference.path, options) !== reference.hash) throw new NetworkError('conflict', 'Verified reference changed', [reference.path]);
    hashes[reference.path] = reference.hash;
  }
  return hashes;
}
/** Internal shared write preflight. Caller must already hold the project lock. */
export async function recoverNetworkUnderLock(project: Project, options: StorageOptions = {}): Promise<boolean> {
  const pending = await readJournal(project);
  if (!pending) return false;
  const target = journalTarget(pending, await stableCapture(project));
  if ((await validate(project, target, options)).diagnostics.length) throw new NetworkError('pending_recovery', 'Recovered end state would not be valid');
  await finishJournal(project, pending);
  return true;
}
async function carryReferences(project: Project, beforeRevision: string, features: Feature[], options: StorageOptions): Promise<Record<string, string>> {
  const carried: Record<string, string> = Object.create(null);
  let prior: Baselines;
  try {
    const text = await readStorage(project, '.feature-network/baselines.json');
    if (text === null) return carried;
    prior = JSON.parse(text) as Baselines;
    if (prior.networkRevision !== beforeRevision || !prior.references || typeof prior.references !== 'object') return carried;
  } catch { return carried; } // Invalid or absent cache never confirms anything.
  const surviving = new Set(features.flatMap(featureReferences).map(reference => reference.path));
  for (const [path, hash] of Object.entries(prior.references)) {
    if (typeof hash !== 'string' || !/^[a-f0-9]{64}$/.test(hash) || !surviving.has(path)) continue;
    try { if (await readReferenceHash(project, path, options) === hash) carried[path] = hash; }
    catch { /* Missing, unsafe or unreadable references remain unconfirmed. */ }
  }
  return carried;
}
export async function applyUpdate(project: Project, request: UpdateRequest, options: StorageOptions = {}): Promise<UpdateResult> {
  const result = await withProjectLock(project, async () => {
    const recovered = await recoverNetworkUnderLock(project, options);
    const before = await stableCapture(project); const expected = fingerprints(before); const after = { ...before };
    if (request.expectedRevision !== undefined && request.expectedRevision !== revision(before)) {
      throw new NetworkError('conflict', 'Complete network revision changed since it was read');
    }
    const changes: Record<string, string | null> = {};
    for (const [path, hash] of Object.entries(request.expected)) {
      if (path !== marker && !/^network-spec\/[a-z][a-z0-9]*(?:-[a-z0-9]+)*\.yaml$/.test(path)) throw new NetworkError('invalid_update', 'Expected fingerprint path is invalid', [path]);
      if (hash !== null && !/^[a-f0-9]{64}$/.test(hash)) throw new NetworkError('invalid_update', 'Expected fingerprint is invalid', [path]);
      if ((expected[path] ?? null) !== hash) throw new NetworkError('conflict', 'Network file changed since it was read', [path]);
    }
    if (before[marker] === undefined) {
      if (!request.initialize || request.upserts.length === 0) throw new NetworkError('invalid_update', 'Initialization requires at least one feature');
      changes[marker] = 'schema: 1\ncoverage: partial\n';
    } else if (request.initialize) throw new NetworkError('conflict', 'Network is already initialized');
    for (const feature of request.upserts) {
      const path = featurePath(feature.id);
      if (Object.hasOwn(changes, path)) throw new NetworkError('invalid_update', 'Duplicate feature change', [path]);
      const text = stringify(feature); parseFeature(text, path); changes[path] = text;
    }
    for (const id of request.deletes) {
      const path = featurePath(id);
      if (Object.hasOwn(changes, path)) throw new NetworkError('invalid_update', 'Duplicate or overlapping feature changes', [path]);
      changes[path] = null;
    }
    for (const [path, text] of Object.entries(changes)) {
      if (!Object.hasOwn(request.expected, path)) throw new NetworkError('invalid_update', 'Every changed file requires its expected hash or null', [path]);
      if (text === null) delete after[path]; else after[path] = Buffer.from(text);
    }
    const validation = await validate(project, after, options);
    if (validation.diagnostics.length) throw new NetworkError('invalid_network', 'The complete resulting network is invalid', validation.diagnostics.flatMap(d => d.path ? [d.path] : []));
    const hashes = await verifiedHashes(project, request.verifiedReferences, options);
    for (const feature of request.upserts) for (const reference of featureReferences(feature)) {
      if (!Object.hasOwn(hashes, reference.path)) throw new NetworkError('unverified_reference', 'Updated features require hashes of every inspected reference', [reference.path]);
    }
    if (revision(await stableCapture(project)) !== revision(before)) throw new NetworkError('conflict', 'Network changed during validation');
    for (const path of Object.keys(changes)) if ((expected[path] ?? null) === (changes[path] === null ? null : digest(changes[path]!))) delete changes[path];
    if (Object.keys(changes).length) {
      const journal = { version: 1 as const, before: expected, changes };
      await saveJournal(project, journal); await finishJournal(project, journal);
    }
    // Recovering a journal never confirms reference analysis from the interrupted call.
    if (request.verifiedReferences.length) {
      await verifiedHashes(project, request.verifiedReferences, options);
      const carried = await carryReferences(project, revision(before), validation.features, options);
      const baseline: Baselines = { networkRevision: revision(after), references: { ...carried, ...hashes } };
      await atomicStorageWrite(project, '.feature-network/baselines.json', JSON.stringify(baseline), async () => {
        if (revision(await stableCapture(project)) !== revision(after)) throw new NetworkError('conflict', 'Network changed before baseline confirmation');
        await verifiedHashes(project, Object.entries(baseline.references).map(([path, hash]) => ({ path, hash })), options);
      });
    }
    return { revision: revision(after), fingerprints: fingerprints(after), recovered };
  });
  return { ...result, diagnostics: await gitDiagnostics(project) };
}

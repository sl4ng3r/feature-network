import { countWork } from '../diagnostics/work.js';
import { lstat, mkdir, open, readdir, rename, unlink } from 'node:fs/promises';
import { openRegular, regularSignature, type ByteCache } from './regular.js';
import { dirname } from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { z } from 'zod';
import { NetworkError } from '../model/errors.js';
import type { Project } from '../project/root.js';
import { isMissing, storagePath } from './lock.js';

// Every published storage document must remain readable by the same byte policy.
const storageByteLimit = 16 * 1024 * 1024;
export function assertStorageSize(text: string, path: string): void {
  if (Buffer.byteLength(text, 'utf8') > storageByteLimit) {
    throw new NetworkError('storage_too_large', 'Encoded storage document exceeds the 16 MiB limit', [path]);
  }
}

export type Contents = Record<string, Buffer>;
export type Fingerprints = Record<string, string>;
export const digest = (bytes: string | Uint8Array): string => { countWork('hashes'); return createHash('sha256').update(bytes).digest('hex'); };
export function fingerprints(contents: Contents): Fingerprints { return Object.fromEntries(Object.keys(contents).sort().map(path => [path, digest(contents[path]!)])); }
export const revision = (contents: Contents): string => digest(JSON.stringify(fingerprints(contents)));

/** Read only regular files, no symlink following at the open boundary. */
async function readStorageBytes(project: Project, path: string, limit = storageByteLimit, cache?: ByteCache): Promise<Buffer | null> {
  const absolute = await storagePath(project, path);
  let file;
  let signature: string | undefined;
  try {
    if (cache) {
      signature = await regularSignature(absolute);
      const previous = cache.get(path);
      if (previous?.signature === signature && previous.bytes.length <= limit) return previous.bytes;
    }
    file = await openRegular(absolute);
  }
  catch (error) { if (isMissing(error)) return null; throw error; }
  try {
    const info = await file.stat();
    if (!info.isFile()) throw new NetworkError('unsafe_path', 'Storage entry is not a regular file', [path]);
    if (info.size > limit) throw new NetworkError('invalid_schema', 'Storage entry exceeds its size limit', [path]);
    const bytes = await file.readFile();
    if (path.startsWith('network-spec/')) { countWork('documentReadOps'); countWork('documentBytes',bytes.byteLength); }
    if (bytes.byteLength > limit) throw new NetworkError('invalid_schema', 'Storage entry exceeds its size limit', [path]);
    if (cache && signature && await regularSignature(absolute) === signature) cache.set(path, { signature, bytes });
    return bytes;
  } finally { await file.close(); }
}

export async function readStorage(project: Project, path: string, limit = storageByteLimit): Promise<string | null> {
  const bytes = await readStorageBytes(project, path, limit);
  return bytes === null ? null : new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bytes);
}

async function syncParent(project: Project, path: string): Promise<void> {
  // Node/libuv read-only Windows directory handles cannot FlushFileBuffers.
  // File flush + rename is supported; directory durability is weaker there.
  // POSIX errors are never suppressed.
  if (process.platform === 'win32') return;
  const directory = await open(dirname(await storagePath(project, path)), 'r');
  try { await directory.sync(); } finally { await directory.close(); }
}

/** Temp in the destination directory, flushed before the single atomic replacement. */
export async function atomicStorageWrite(project: Project, path: string, text: string, beforeRename?: () => Promise<void>): Promise<void> {
  assertStorageSize(text, path); // Before temp creation, journal publication or destination replacement.
  const target = await storagePath(project, path);
  await mkdir(dirname(target), { recursive: true });
  const temp = `${path}.tmp-${randomUUID()}`;
  const file = await open(await storagePath(project, temp), 'wx', 0o600);
  try { await file.writeFile(text); await file.sync(); } finally { await file.close(); }
  try {
    if (beforeRename) await beforeRename();
    await rename(await storagePath(project, temp), await storagePath(project, path));
    countWork(path.startsWith('network-spec/') ? 'knowledgeWrites' : 'runtimeWrites');
    await syncParent(project, path);
  } finally { await unlink(await storagePath(project, temp)).catch(error => { if (!isMissing(error)) throw error; }); }
}

/** Only YAML is network data; transaction temp files and unrelated documentation are ignored. */
export async function captureNetwork(project: Project, cache?: ByteCache): Promise<Contents> {
  await storagePath(project, 'network-spec/_meta.yaml');
  let names: string[];
  try { names = (await readdir(project.networkDir)).filter(name => /\.ya?ml$/i.test(name)).sort(); }
  catch (error) { if (isMissing(error)) return {}; throw error; }
  try {
    await storagePath(project, 'network-spec/knowledge/.entry');
    countWork('metadataChecks');
    const extra = await readdir(project.networkDir + '/knowledge');
    names.push(...extra.filter(name => /\.ya?ml$/i.test(name)).sort().map(name => 'knowledge/' + name));
  } catch (error) { if (!isMissing(error)) throw error; }
  const contents: Contents = {};
  for (const name of names) {
    const path = `network-spec/${name}`;
    const text = await readStorageBytes(project, path, storageByteLimit, cache);
    if (text === null) throw new NetworkError('conflict', 'Network changed during capture', [path]);
    contents[path] = text;
  }
  return contents;
}

/** One initial attempt and at most two retries for non-cooperating external editors. */
export async function stableCapture(project: Project, cache?: ByteCache): Promise<Contents> {
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const first = await captureNetwork(project, cache); const second = await captureNetwork(project, cache);
      if (revision(first) === revision(second)) return second;
    } catch (error) { if (!(error instanceof NetworkError) || error.code !== 'conflict') throw error; }
  }
  throw new NetworkError('conflict', 'Network remained unstable during snapshot capture');
}

const networkPath = z.string().regex(/^network-spec\/(?:_meta|[a-z][a-z0-9]*(?:-[a-z0-9]+)*)\.yaml$/);
const networkPathV2 = z.string().regex(/^network-spec\/(?:_meta|(?:knowledge\/)?[a-z][a-z0-9]*(?:-[a-z0-9]+)*)\.yaml$/);
const journalV1 = z.strictObject({version:z.literal(1),before:z.record(z.string().regex(/^network-spec\/[^/]+\.ya?ml$/i),z.string().regex(/^[a-f0-9]{64}$/)),changes:z.record(networkPath,z.string().max(65536).nullable())});
const journalV2 = z.strictObject({version:z.literal(2),before:z.record(networkPathV2,z.string().regex(/^[a-f0-9]{64}$/)),changes:z.record(networkPathV2,z.string().max(65536).nullable())});
const journalSchema = z.discriminatedUnion('version',[journalV1,journalV2]);
export type Journal = z.infer<typeof journalSchema>;
const journalPath = '.feature-network/journal.json';
export async function hasJournal(project: Project): Promise<boolean> {
  try { await lstat(await storagePath(project, journalPath)); return true; }
  catch (error) { if (isMissing(error)) return false; throw error; }
}
export async function readJournal(project: Project): Promise<Journal | null> {
  try {
    const text = await readStorage(project, journalPath);
    if (text === null) return null;
    return journalSchema.parse(JSON.parse(text));
  } catch { throw new NetworkError('pending_recovery', 'Recovery journal is invalid; manual inspection is required'); }
}
export async function saveJournal(project: Project, journal: Journal): Promise<void> {
  journalSchema.parse(journal);
  if (await hasJournal(project)) throw new NetworkError('pending_recovery', 'An earlier transaction needs recovery');
  await atomicStorageWrite(project, journalPath, JSON.stringify(journal));
}

export function journalTarget(journal: Journal, current: Contents): Contents {
  const paths = new Set([...Object.keys(journal.before), ...Object.keys(journal.changes), ...Object.keys(current)]);
  for (const path of paths) {
    const actual = current[path] === undefined ? null : digest(current[path]!);
    const old = journal.before[path] ?? null;
    const changed = Object.hasOwn(journal.changes, path);
    const target = changed ? journal.changes[path] === null ? null : digest(journal.changes[path]!) : old;
    if (actual !== old && actual !== target) throw new NetworkError('pending_recovery', 'External change blocks the entire recovery', [path]);
  }
  const target = { ...current };
  for (const [path, text] of Object.entries(journal.changes)) { if (text === null) delete target[path]; else target[path] = Buffer.from(text); }
  return target;
}

/** Caller holds the lock and validates the entire resulting network before entering. */
export async function finishJournal(project: Project, journal: Journal, beforePublish?: () => Promise<void>): Promise<void> {
  // Check all files before *any* recovery mutation, then recheck before each I/O.
  let current = await stableCapture(project);
  const target = journalTarget(journal, current);
  for (const [path, text] of Object.entries(journal.changes).sort(([a], [b]) => a.localeCompare(b))) {
    current = await stableCapture(project); journalTarget(journal, current);
    if ((current[path] ? digest(current[path]!) : null) === (text === null ? null : digest(text))) continue;
    const unchanged = async () => {
      if (beforePublish) await beforePublish();
      const fresh = await stableCapture(project); journalTarget(journal, fresh);
      if (revision(fresh) !== revision(current)) throw new NetworkError('pending_recovery', 'External edit interrupted the transaction');
    };
    if (text === null) { await unchanged(); await unlink(await storagePath(project, path)); await syncParent(project, path); }
    else await atomicStorageWrite(project, path, text, unchanged);
  }
  if (revision(await stableCapture(project)) !== revision(target)) throw new NetworkError('pending_recovery', 'Transaction end state could not be confirmed');
  await unlink(await storagePath(project, journalPath));
  await syncParent(project, journalPath);
}

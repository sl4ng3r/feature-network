import { publishReadCache } from './read-cache.js';
import type { Project } from '../project/root.js';
import { NetworkError } from '../model/errors.js';
import { assertStorageSize, atomicStorageWrite, digest, hasJournal, readStorage, stableCapture } from './journal.js';
import { withProjectLock } from './lock.js';
import { recoverNetworkUnderLock, type StorageOptions } from './repository.js';

export interface RuntimeWriteOptions extends StorageOptions { allowRecovery?: boolean }

function valuePath(key: string, writable = false): string {
  if (key === 'baselines' && !writable) return '.feature-network/baselines.json';
  if (!/^[a-zA-Z0-9_-]+(?:\/[a-zA-Z0-9_-]+)*$/.test(key) || ['baselines', 'journal', 'lock'].includes(key.split('/')[0]!)) {
    throw new NetworkError('unsafe_path', 'Invalid or reserved runtime key', [key]);
  }
  return `.feature-network/values/${key}.json`;
}
function serialize(value: unknown): string {
  try {
    const text = JSON.stringify(value);
    if (text === undefined || text === 'null') throw new Error('Not a non-null JSON value');
    return text;
  } catch { throw new NetworkError('invalid_runtime', 'Runtime values must be non-null JSON'); }
}
async function existingValue(project: Project, path: string): Promise<{ text: string; value: unknown } | null> {
  try {
    const text = await readStorage(project, path);
    if (text === null) return null;
    const value: unknown = JSON.parse(text);
    if (value === null) throw new Error('Null is reserved for absent files');
    return { text, value };
  } catch (error) {
    if (error instanceof NetworkError && error.code === 'unsafe_path') throw error;
    throw new NetworkError('invalid_runtime', 'Runtime value is not valid non-null JSON', [path]);
  }
}
/** CAS token of a JSON value returned by readRuntime; null means no existing file. */
export const runtimeRevision = (value: unknown): string => digest(serialize(value));

/** Atomic rename makes a runtime value independently readable; no baseline confirmation here. */
export async function readRuntime<T>(project: Project, key: string): Promise<T | null> {
  const existing = await existingValue(project, valuePath(key));
  return existing === null ? null : existing.value as T;
}
export async function writeRuntime<T>(project: Project, key: string, expectedRevision: string | null, value: T, options: RuntimeWriteOptions = {}, validate?: () => Promise<void>): Promise<void> {
  const path = valuePath(key, true); const text = serialize(value);
  assertStorageSize(text, path); // Reject invalid requests before lock acquisition or pending recovery.
  await withProjectLock(project, async () => {
    if (options.allowRecovery === false && await hasJournal(project)) throw new NetworkError('pending_recovery', 'Hook bookkeeping cannot recover pending network writes');
    await recoverNetworkUnderLock(project, options);
    const existing = await existingValue(project, path);
    if ((existing === null ? null : runtimeRevision(existing.value)) !== expectedRevision) throw new NetworkError('conflict', 'Runtime revision changed', [key]);
    await atomicStorageWrite(project, path, text, async () => {
      // Trusted internal Core guard only; never supplied/evaluated from MCP or JSON.
      // Must not acquire locks, run Git, or invoke a model.
      if (validate) await validate();
      if (await readStorage(project, path) !== (existing?.text ?? null)) throw new NetworkError('conflict', 'Runtime changed before replacement', [key]);
    });
    await publishReadCache(project, await stableCapture(project), options);
  });
}

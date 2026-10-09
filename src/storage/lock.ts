import { readRegular } from './regular.js';
import { constants } from 'node:fs';
import { link, lstat, mkdir, open, unlink } from 'node:fs/promises';
import { hostname } from 'node:os';
import { join, relative, sep } from 'node:path';
import { randomUUID } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import { NetworkError } from '../model/errors.js';
import { resolveProjectPath } from '../project/paths.js';
import type { Project } from '../project/root.js';

export const isMissing = (error: unknown): boolean => (error as NodeJS.ErrnoException).code === 'ENOENT';
export const errorCode = (error: unknown): string | undefined => (error as NodeJS.ErrnoException).code;

/** Storage never follows even in-root symlinks: all actual writes stay in these two trees. */
export async function storagePath(project: Project, path: string): Promise<string> {
  if (!/^(network-spec|\.feature-network)\//.test(path)) throw new NetworkError('unsafe_path', 'Not a storage path', [path]);
  const absolute = await resolveProjectPath(project, path);
  if (relative(project.root, absolute).split(sep).join('/') !== path) throw new NetworkError('unsafe_path', 'Storage aliases are not allowed', [path]);
  let component = project.root;
  for (const part of path.split('/')) {
    component = join(component, part);
    try { if ((await lstat(component)).isSymbolicLink()) throw new NetworkError('unsafe_path', 'Storage symlink is not allowed', [path]); }
    catch (error) { if (!isMissing(error)) throw error; }
  }
  return absolute;
}

export async function ensureRuntime(project: Project): Promise<void> {
  await storagePath(project, '.feature-network/.gitignore');
  await mkdir(project.runtimeDir, { recursive: true });
  const ignore = await storagePath(project, '.feature-network/.gitignore');
  try {
    const file = await open(ignore, constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY | constants.O_NOFOLLOW, 0o600);
    try { await file.writeFile('*\n'); await file.sync(); } finally { await file.close(); }
  } catch (error) { if (errorCode(error) !== 'EEXIST') throw error; }
}

interface Owner { version: 1; pid: number; hostname: string; token: string }
async function ownerAt(project: Project, path: string): Promise<Owner | null> {
  try {
    const absolute = await storagePath(project, path);
    const info = await lstat(absolute);
    if (!info.isFile() || info.size > 4096) return null;
    const owner: unknown = JSON.parse((await readRegular(absolute)).toString('utf8'));
    if (typeof owner !== 'object' || owner === null) return null;
    const candidate = owner as Owner;
    return candidate.version === 1 && Number.isSafeInteger(candidate.pid) && candidate.pid > 0
      && typeof candidate.hostname === 'string' && typeof candidate.token === 'string' && /^[a-zA-Z0-9-]{1,64}$/.test(candidate.token) ? candidate : null;
  } catch { return null; }
}
function provenDead(owner: Owner): boolean {
  if (owner.hostname !== hostname()) return false;
  try { process.kill(owner.pid, 0); return false; }
  catch (error) { return errorCode(error) === 'ESRCH'; }
}

/** An owner-specific reclamation gate prevents two reapers deleting a new owner's lock.
 * Dead gate owners can themselves be reclaimed. Ambiguity or excessive nesting fails closed.
 */
async function reclaim(project: Project, path: string, candidatePath: string, depth = 0): Promise<void> {
  if (depth > 4) return;
  const owner = await ownerAt(project, path);
  if (!owner || !provenDead(owner)) return;
  const gate = `${path}.reap-${owner.token}`;
  const gateAbsolute = await storagePath(project, gate);
  try { await link(candidatePath, gateAbsolute); }
  catch (error) {
    if (errorCode(error) !== 'EEXIST') throw error;
    await reclaim(project, gate, candidatePath, depth + 1);
    return;
  }
  try {
    const current = await ownerAt(project, path);
    if (current?.token === owner.token && provenDead(current)) await unlink(await storagePath(project, path));
  } finally { await unlink(await storagePath(project, gate)).catch(error => { if (!isMissing(error)) throw error; }); }
}

/** Cooperative local-process exclusion; total acquisition wait is bounded to two seconds. */
export async function withProjectLock<T>(project: Project, action: () => Promise<T>): Promise<T> {
  await ensureRuntime(project);
  const owner: Owner = { version: 1, hostname: hostname(), pid: process.pid, token: randomUUID() };
  const candidate = `.feature-network/owner-${owner.token}`;
  const candidatePath = await storagePath(project, candidate);
  const file = await open(candidatePath, 'wx', 0o600);
  try { await file.writeFile(JSON.stringify(owner)); await file.sync(); } finally { await file.close(); }
  const deadline = performance.now() + 2000;
  let acquired = false;
  try {
    do {
      try { await link(candidatePath, await storagePath(project, '.feature-network/lock')); acquired = true; break; }
      catch (error) { if (errorCode(error) !== 'EEXIST') throw error; }
      await reclaim(project, '.feature-network/lock', candidatePath);
      const remaining = deadline - performance.now();
      if (remaining <= 0) break;
      await delay(Math.min(20, remaining));
    } while (performance.now() < deadline);
    if (!acquired) throw new NetworkError('lock_busy', 'Network lock owner is alive or cannot be proven dead');
    return await action();
  } finally {
    if (acquired) {
      const current = await ownerAt(project, '.feature-network/lock');
      if (current?.token === owner.token) await unlink(await storagePath(project, '.feature-network/lock'));
    }
    await unlink(await storagePath(project, candidate)).catch(error => { if (!isMissing(error)) throw error; });
  }
}

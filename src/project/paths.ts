import { lstat, readlink, realpath } from 'node:fs/promises';
import { basename, dirname, isAbsolute, join, relative, resolve, sep, win32 } from 'node:path';
import { NetworkError } from '../model/errors.js';
import type { Project } from './root.js';

function unsafe(path: string, message: string): never {
  throw new NetworkError('unsafe_path', message, [path]);
}

function isMissing(error: unknown): boolean {
  return (error as NodeJS.ErrnoException).code === 'ENOENT';
}

/** Uses a component boundary: /project-other is not inside /project. */
export function isPathContained(root: string, path: string): boolean {
  const suffix = relative(root, path);
  return suffix === '' || (!isAbsolute(suffix) && suffix !== '..' && !suffix.startsWith(`..${sep}`));
}

/** Missing storage is allowed before init; existing storage must be real directories. */
export async function assertStorageDirectories(root: string): Promise<void> {
  for (const directory of ['network-spec', '.feature-network']) {
    const path = join(root, directory);
    try {
      const info = await lstat(path);
      if (info.isSymbolicLink() || !info.isDirectory()) unsafe(path, 'Storage must be a directory, not a symlink');
    } catch (error) {
      if (!isMissing(error)) throw error;
    }
  }
}

async function canonicalTarget(root: string, target: string): Promise<string> {
  let ancestor = target;
  const missing: string[] = [];
  while (true) {
    try {
      const canonical = await realpath(ancestor);
      if (!isPathContained(root, canonical)) unsafe(target, 'Symlink target escapes the project');
      return join(canonical, ...missing);
    } catch (error) {
      if (!isMissing(error)) {
        if ((error as NodeJS.ErrnoException).code === 'ELOOP') unsafe(target, 'Symlink cycle');
        throw error;
      }
      const parent = dirname(ancestor);
      if (parent === ancestor) unsafe(target, 'Cannot establish a safe symlink ancestor');
      missing.unshift(basename(ancestor));
      ancestor = parent;
    }
  }
}

/** Resolve the existing ancestor of a missing path, checking every link target. */
async function walk(root: string, start: string, parts: string[], links = 0): Promise<string> {
  let current = start;
  for (let index = 0; index < parts.length; index++) {
    const part = parts[index]!;
    if (part === '' || part === '.') continue;
    if (part === '..') {
      current = dirname(current);
      if (!isPathContained(root, current)) unsafe(current, 'Symlink target escapes the project');
      continue;
    }
    const next = join(current, part);
    if (!isPathContained(root, next)) unsafe(next, 'Path escapes the project');
    let info;
    try { info = await lstat(next); }
    catch (error) {
      if (!isMissing(error)) throw error;
      // Continue lexically through missing components so any remaining .. is checked.
      current = next;
      continue;
    }
    if (info.isSymbolicLink()) {
      if (links >= 40) unsafe(next, 'Symlink cycle or excessive symlink depth');
      const target = await readlink(next);
      if (isAbsolute(target)) {
        // realpath handles platform aliases (/var -> /private/var on macOS) and
        // .. after symlinks; missing descendants retain their canonical ancestor.
        const canonical = await canonicalTarget(root, target);
        return walk(root, root, [...relative(root, canonical).split(sep), ...parts.slice(index + 1)], links + 1);
      }
      return walk(root, current, [...target.split(sep), ...parts.slice(index + 1)], links + 1);
    }
    if (index < parts.length - 1 && !info.isDirectory()) unsafe(next, 'A path ancestor is not a directory');
    current = next;
  }
  return current;
}

/** Safe missing paths are returned; callers diagnose existence independently. */
export async function resolveProjectPath(project: Project, path: string): Promise<string> {
  if (!path.trim() || isAbsolute(path) || win32.isAbsolute(path) || /^[A-Za-z]:/.test(path)
    || /[\\\u0000-\u001f\u007f]/.test(path)
    || path.split('/').some(part => part === '' || part === '.' || part === '..')) {
    unsafe(path, 'Expected a relative path without traversal');
  }
  // A root moved or replaced after binding must not redirect an existing Project.
  if (await realpath(project.root) !== project.root) unsafe(project.root, 'Bound project root changed');
  await assertStorageDirectories(project.root);
  const result = await walk(project.root, project.root, path.split('/'));
  if (!isPathContained(project.root, result)) unsafe(path, 'Resolved path escapes the project');
  return resolve(result);
}

export function isSensitivePath(path: string): boolean {
  const parts = path.split('/'); const name = parts.at(-1) ?? '';
  return parts.some(part => ['.aws', '.ssh'].includes(part))
    || ['.npmrc', '.netrc', 'id_rsa', 'id_ed25519', 'credentials.json'].includes(name)
    || /\.(pem|key|p12|pfx)$/i.test(name)
    || ((name === '.env' || name.startsWith('.env.')) && !/\.(example|sample|template)$/.test(name));
}
const ignoredParts = new Set(['.git', 'network-spec', '.feature-network', 'node_modules', 'dist', 'build', 'coverage', '.next', '.nuxt', '.cache', '.turbo']);
export const isAutomaticGeneratedPath = (path: string): boolean => path.split('/').some(part => ignoredParts.has(part));

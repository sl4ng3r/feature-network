import { lstat, realpath } from 'node:fs/promises';
import { relative, resolve, sep } from 'node:path';
import { NetworkError } from '../model/errors.js';
import type { Project } from '../project/root.js';
import type { StorageOptions } from './repository.js';
import { resolveProjectPath, isPathContained, isSensitivePath, isAutomaticGeneratedPath } from '../project/paths.js';
import { openRegular } from './regular.js';
import { digest } from './journal.js';
import { isMissing } from './lock.js';
import { countWork } from '../diagnostics/work.js';
/** Canonical exclusions are checked before opening source bytes, including aliases. */
export async function referencePath(project: Project, path: string, options: StorageOptions): Promise<string> {
  const absolute = await resolveProjectPath(project, path);
  const excluded = [resolve(project.root, '.git'), project.networkDir, project.runtimeDir];
  for (const root of options.excludedReferenceRoots ?? []) {
    try { excluded.push(await realpath(root)); } catch (error) { if (!isMissing(error)) throw error; excluded.push(resolve(root)); }
  }
  const components = relative(project.root, absolute).split(sep);
  if (path.split('/').some(p => ['.git', '.feature-network', 'network-spec'].includes(p))
    || components.some(p => ['.git', '.feature-network', 'network-spec'].includes(p)) || excluded.some(root => isPathContained(root, absolute))) {
    throw new NetworkError('unsafe_reference', 'Reference points into excluded metadata or plugin storage', [path]);
  }
  return absolute;
}
/** Same confinement and exclusions for existing bytes and absent observations. */
export async function readReferenceHash(project: Project, path: string, options: StorageOptions): Promise<string> {
  const absolute = await referencePath(project, path, options);
  const file = await openRegular(absolute, 'unsafe_reference');
  try {
    if (!(await file.stat()).isFile()) throw new NetworkError('unsafe_reference', 'Reference is not a regular file', [path]);
    const bytes=await file.readFile();countWork('sourceReadOps');countWork('sourceBytes',bytes.length);return digest(bytes);
  } finally { await file.close(); }
}
/** Absence is not a hash. Existing dangling symlinks/directories are never absence evidence. */
export async function assertMissingReference(project: Project, path: string, options: StorageOptions = {}): Promise<void> {
  const absolute = await referencePath(project, path, options);
  const canonical = relative(project.root, absolute).split(sep).join('/');
  if (isSensitivePath(path) || isSensitivePath(canonical)) throw new NetworkError('sensitive_reference', 'Automatic observation excludes a potentially sensitive source', [path]);
  if (isAutomaticGeneratedPath(path) || isAutomaticGeneratedPath(canonical)) throw new NetworkError('unsafe_reference', 'Automatic observation excludes generated sources', [path]);
  for (const candidate of new Set([resolve(project.root, path), absolute])) {
    try { await lstat(candidate); }
    catch (error) { if (isMissing(error)) continue; throw error; }
    throw new NetworkError('conflict', 'Expected missing source exists', [path]);
  }
}

import { readRegular } from '../storage/regular.js';
import { lstat, realpath, stat } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { NetworkError } from '../model/errors.js';
import { parseNetworkMeta } from '../model/documents.js';
import { assertStorageDirectories, resolveProjectPath } from './paths.js';

export interface Project {
  root: string;
  networkDir: string;
  runtimeDir: string;
  markerPath: string;
}

/** Bind an explicit root without discovering parents or creating any files. */
export async function openProject(root: string): Promise<Project> {
  if (!root.trim()) throw new NetworkError('ambiguous_root', 'An explicit project root is required');
  const canonical = await realpath(resolve(root));
  if (!(await stat(canonical)).isDirectory()) {
    throw new NetworkError('unsafe_path', 'Project root must be a directory', [root]);
  }
  await assertStorageDirectories(canonical);
  return Object.freeze({
    root: canonical,
    networkDir: join(canonical, 'network-spec'),
    runtimeDir: join(canonical, '.feature-network'),
    markerPath: join(canonical, 'network-spec', '_meta.yaml'),
  });
}

async function exists(path: string): Promise<boolean> {
  try { await lstat(path); return true; }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false;
    throw error;
  }
}

/** Hooks may discover ancestors only up to the nearest checkout boundary. */
export async function discoverHookProject(cwd: string): Promise<Project | null> {
  if (!cwd.trim()) throw new NetworkError('ambiguous_root', 'Hook cwd is required');
  let current = await realpath(resolve(cwd));
  if (!(await stat(current)).isDirectory()) throw new NetworkError('unsafe_path', 'Hook cwd must be a directory', [cwd]);
  const ancestors: string[] = [];
  let checkoutFound = false;
  while (true) {
    ancestors.push(current);
    if (await exists(join(current, '.git'))) { checkoutFound = true; break; }
    const parent = dirname(current);
    if (parent === current) break;
    current = parent;
  }
  if (!checkoutFound) return null;
  for (const root of ancestors) {
    if (!(await exists(join(root, 'network-spec')))) continue;
    const project = await openProject(root);
    if (!(await exists(project.markerPath))) continue;
    const info = await lstat(project.markerPath);
    if (info.isSymbolicLink() || !info.isFile()) {
      throw new NetworkError('unsafe_path', 'Network marker must be a regular file', [project.markerPath]);
    }
    const path = await resolveProjectPath(project, 'network-spec/_meta.yaml');
    parseNetworkMeta((await readRegular(path)).toString('utf8'));
    return project;
  }
  return null;
}

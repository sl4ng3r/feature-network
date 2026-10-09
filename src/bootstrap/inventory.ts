import { openRegular } from '../storage/regular.js';
import { lstat, realpath, stat } from 'node:fs/promises';
import { join, relative, resolve, sep } from 'node:path';
import type { Project } from '../project/root.js';
import { isAutomaticGeneratedPath, isPathContained, isSensitivePath, resolveProjectPath } from '../project/paths.js';
import { readGitInventory } from '../project/git.js';
import { digest } from '../storage/journal.js';
import type { StorageOptions } from '../storage/repository.js';
import { sliceText, type Slice } from './batches.js';
export type FileStatus = 'pending' | 'analyzed' | 'excluded' | 'needs_review';
export interface InventoryFile { path: string; hash: string | null; slices: Slice[]; status: FileStatus; reason: string | null }
export interface InventoryOptions extends StorageOptions { maxBytes?: number; scope?: string[]; exclusions?: string[]; sanitizedExamples?: { path: string; hash: string }[] }
export interface Inventory { status: 'available' | 'unavailable'; checkoutIdentity: string | null; files: InventoryFile[]; diagnostics: { code: string; message: string }[] }
const inside = (path: string, root: string) => path === root || path.startsWith(`${root}/`);
const example = (path: string) => /^\.env\.(example|sample|template)$/.test(path.split('/').at(-1)!);
const binaryName = (path: string) => /\.(png|jpe?g|gif|webp|ico|pdf|zip|gz|woff2?|ttf|mp[34]|sqlite|db|exe|dll|so|dylib)$/i.test(path);
/** Reads only explicit safe inventory candidates; no source contents leave this function. */
export async function inventory(project: Project, options: InventoryOptions = {}): Promise<Inventory> {
  const git = await readGitInventory(project);
  if (git.status === 'unavailable') return { status: 'unavailable', checkoutIdentity: null, files: [], diagnostics: git.diagnostics };
  const roots: string[] = [];
  for (const root of options.excludedReferenceRoots ?? []) { try { roots.push(await realpath(root)); } catch { roots.push(resolve(root)); } }
  const info = await stat(project.root);
  const checkoutIdentity = digest(JSON.stringify([project.root, info.dev, info.ino, git.gitDirectory, git.branch, git.branch === null ? git.head : null]));
  const files: InventoryFile[] = []; const nested = new Set(git.submodules);
  for (const raw of git.paths) {
    const path = raw.replace(/\/$/, ''); let reason: string | null = null; let status: FileStatus = 'excluded';
    let absolute: string;
    try { absolute = await resolveProjectPath(project, path); } catch { files.push({ path, hash: null, slices: [], status: 'needs_review', reason: 'unsafe_path' }); continue; }
    const canonical = relative(project.root, absolute).split(sep).join('/');
    if (isSensitivePath(path) || isSensitivePath(canonical)) reason = 'sensitive';
    else if (isAutomaticGeneratedPath(path) || isAutomaticGeneratedPath(canonical)) reason = 'generated';
    else if (roots.some(root => isPathContained(root, absolute))) reason = 'plugin';
    else if (options.scope?.length && !options.scope.some(root => inside(path, root))) reason = 'outside_scope';
    else if (options.exclusions?.some(root => inside(path, root))) reason = 'configured_exclusion';
    if (!reason) {
      for (const candidate of [path, canonical]) {
        const parts = candidate.split('/');
        for (let i = 1; i <= parts.length; i++) {
          const area = parts.slice(0, i).join('/');
          try { await lstat(join(project.root, area, '.git')); nested.add(area); } catch (error) { if (!['ENOENT', 'ENOTDIR'].includes((error as NodeJS.ErrnoException).code ?? '')) { reason = 'unreadable'; status = 'needs_review'; } }
        }
      }
      if ([...nested].some(area => inside(path, area) || inside(canonical, area))) reason = 'nested_repository';
    }
    if (!reason && (binaryName(path) || binaryName(canonical))) reason = 'binary';
    if (!reason && (example(path) || example(canonical)) && !options.sanitizedExamples?.some(e => e.path === path)) { reason = 'example_requires_attestation'; }
    if (reason) { files.push({ path, hash: null, slices: [], status, reason }); continue; }
    try {
      const handle = await openRegular(absolute);
      let bytes: Buffer;
      try { if (!(await handle.stat()).isFile()) throw new Error('not regular'); bytes = await handle.readFile(); } finally { await handle.close(); }
      if (bytes.includes(0)) { files.push({ path, hash: null, slices: [], status: 'excluded', reason: 'binary' }); continue; }
      const text = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bytes); const hash = digest(bytes);
      if ((example(path) || example(canonical)) && !options.sanitizedExamples?.some(e => e.path === path && e.hash === hash)) { files.push({ path, hash: null, slices: [], status: 'needs_review', reason: 'example_attestation_changed' }); continue; }
      files.push({ path, hash, slices: sliceText(text, options.maxBytes), status: 'pending', reason: null });
    } catch (error) { files.push({ path, hash: null, slices: [], status: 'needs_review', reason: (error as NodeJS.ErrnoException).code === 'ENOENT' ? 'deleted' : 'unreadable_or_non_utf8' }); }
  }
  for (const area of nested) if (!files.some(f => f.path === area)) files.push({ path: area, hash: null, slices: [], status: 'excluded', reason: 'nested_repository' });
  return { status: 'available', checkoutIdentity, files: files.sort((a, b) => a.path < b.path ? -1 : a.path > b.path ? 1 : 0), diagnostics: git.diagnostics };
}

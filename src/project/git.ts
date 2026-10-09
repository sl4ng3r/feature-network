import { execFile } from 'node:child_process';
import { realpath } from 'node:fs/promises';
import { promisify } from 'node:util';
import type { Diagnostic } from '../model/types.js';
import type { Project } from './root.js';

export interface GitState {
  status: 'available' | 'unavailable';
  head: string | null;
  staged: string[];
  unstaged: string[];
  untracked: string[];
  diagnostics: Diagnostic[];
}

const execute = promisify(execFile);
const nulPaths = (text: string): string[] => [...new Set(text.split('\0').filter(Boolean))].sort();

/** Fixed Git operations only; no shell and no repository hooks or external diff. */
export async function readGitState(project: Project): Promise<GitState> {
  const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith('GIT_')));
  env.GIT_TERMINAL_PROMPT = '0';
  const filterOverrides: string[] = [];
  const git = async (args: string[]): Promise<string> => {
    const result = await execute('git', [
      '--no-pager', '--no-optional-locks', '-c', 'core.fsmonitor=false', ...filterOverrides, '-C', project.root, ...args,
    ], { env, encoding: 'utf8', maxBuffer: 16 * 1024 * 1024, timeout: 10_000, windowsHide: true });
    return result.stdout;
  };
  try {
    if (await realpath(project.root) !== project.root) throw new Error('Bound project root changed');
    await git(['rev-parse', '--show-toplevel']);
    // Name-only diffs still apply clean/process filters. Read config names as
    // data, then suppress each driver rather than executing repository scripts.
    let filterNames = '';
    try {
      filterNames = await git(['config', '--null', '--name-only', '--get-regexp', '^filter\\..*\\.(clean|process|smudge|required)$']);
    } catch (error) {
      if ((error as { code?: number }).code !== 1) throw error;
    }
    const drivers = new Set(nulPaths(filterNames).map(key => key.slice(0, key.lastIndexOf('.'))));
    for (const driver of drivers) {
      for (const setting of ['clean=', 'smudge=', 'process=', 'required=false']) {
        filterOverrides.push('-c', `${driver}.${setting}`);
      }
    }
    const diagnostics: Diagnostic[] = drivers.size ? [{
      code: 'git_filters_disabled', severity: 'warning',
      message: 'Git filters were disabled; filtered files may be reported changed without content conversion',
    }] : [];
    let head: string | null;
    try { head = (await git(['rev-parse', '--verify', '--quiet', 'HEAD'])).trim(); }
    catch (error) {
      if ((error as { code?: number }).code !== 1) throw error;
      head = null; // Verified repository with an unborn HEAD.
    }
    const [staged, unstaged, untracked] = await Promise.all([
      git(['diff', '--cached', '--name-only', '--no-renames', '--no-ext-diff', '--no-textconv', '--relative', '-z', '--', '.']),
      git(['diff', '--name-only', '--no-renames', '--no-ext-diff', '--no-textconv', '--relative', '-z', '--', '.']),
      git(['ls-files', '--others', '--exclude-standard', '-z', '--', '.']),
    ]);
    return { status: 'available', head, staged: nulPaths(staged), unstaged: nulPaths(unstaged), untracked: nulPaths(untracked), diagnostics };
  } catch {
    // Empty arrays are placeholders, never evidence of a clean working tree.
    return { status: 'unavailable', head: null, staged: [], unstaged: [], untracked: [], diagnostics: [
      { code: 'git_unavailable', severity: 'warning', message: 'Git state could not be read; change coverage is unknown' },
    ] };
  }
}

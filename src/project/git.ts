import { execFile } from 'node:child_process';
import { realpath } from 'node:fs/promises';
import { promisify } from 'node:util';
import type { Diagnostic } from '../model/types.js';
import type { Project } from './root.js';

export interface GitState {
  status: 'available' | 'unavailable';
  head: string | null;
  branch: string | null;
  staged: string[];
  unstaged: string[];
  untracked: string[];
  diagnostics: Diagnostic[];
}

const execute = promisify(execFile);
function nulPaths(text: string): string[] {
  if (text === '') return [];
  if (!text.endsWith('\0')) throw new Error('Git output is not NUL-terminated');
  const records = text.slice(0, -1).split('\0');
  if (records.some(record => record === '')) throw new Error('Git output contains an empty record');
  return [...new Set(records)].sort();
}

/** Private safe invoker shared only by fixed exported operations. */
async function safeGit(project: Project) {
  const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.toUpperCase().startsWith('GIT_')));
  env.GIT_TERMINAL_PROMPT = '0';
  const configOverrides: Array<readonly [string, string]> = [['core.fsmonitor', 'false']];
  const git = async (args: string[]): Promise<string> => {
    // Keep configuration keys and values separate: -c key=value splits at
    // the first =, which is also valid inside a filter subsection name.
    const commandEnv: NodeJS.ProcessEnv = { ...env, GIT_CONFIG_COUNT: String(configOverrides.length) };
    configOverrides.forEach(([key, value], index) => {
      commandEnv[`GIT_CONFIG_KEY_${index}`] = key;
      commandEnv[`GIT_CONFIG_VALUE_${index}`] = value;
    });
    const result = await execute('git', [
      '--no-pager', '--no-optional-locks', '-C', project.root, ...args,
    ], { env: commandEnv, encoding: 'buffer', maxBuffer: 16 * 1024 * 1024, timeout: 10_000, windowsHide: true });
    // Invalid bytes must never become replacement characters in filter keys.
    return new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(result.stdout);
  };
  if (await realpath(project.root) !== project.root) throw new Error('Bound project root changed');
  await git(['rev-parse', '--show-toplevel']);
  // Name-only diffs still apply clean/process filters. Read config names as
  // data, then suppress each driver rather than executing repository scripts.
  // Git's locale-sensitive regex can omit keys containing invalid UTF-8.
  // Read all names losslessly before selecting filters, never raw values.
  const configNames = await git(['config', '--null', '--name-only', '--list']);
  const keys = nulPaths(configNames).filter(key => /^filter\.[\s\S]*\.(clean|process|smudge|required)$/.test(key));
  const drivers = new Set(keys.map(key => key.slice(0, key.lastIndexOf('.'))));
  for (const driver of drivers) {
    for (const [setting, value] of [['clean', ''], ['smudge', ''], ['process', ''], ['required', 'false']] as const) {
      configOverrides.push([`${driver}.${setting}`, value]);
    }
  }
  // Fail closed before content reads if Git cannot preserve/apply any key.
  // --get returns only the effective value; values are checked privately and
  // are never included in errors, diagnostics or logs.
  for (const [key, expected] of configOverrides) {
    if (await git(['config', '--null', '--get', key]) !== `${expected}\0`) {
      throw new Error('Git safety configuration could not be applied');
    }
  }
  const diagnostics: Diagnostic[] = drivers.size ? [{
    code: 'git_filters_disabled', severity: 'warning',
    message: 'Git filters were disabled; filtered files may be reported changed without content conversion',
  }] : [];
  return { git, diagnostics };
}

async function identity(git: (args: string[]) => Promise<string>) {
  let head: string | null;
  try { head = (await git(['rev-parse', '--verify', '--quiet', 'HEAD'])).trim(); }
  catch (error) {
    if ((error as { code?: number }).code !== 1) throw error;
    head = null; // Verified repository with an unborn HEAD.
  }
  let branch: string | null;
  try { branch = (await git(['symbolic-ref', '--quiet', 'HEAD'])).trim(); }
  catch (error) { if ((error as { code?: number }).code !== 1) throw error; branch = null; }
  return { head, branch };
}

/** Fixed Git operations only; no shell, repository hooks or external diff. */
export async function readGitState(project: Project): Promise<GitState> {
  try {
    const { git, diagnostics } = await safeGit(project);
    const before = await identity(git);
    const [staged, unstaged, untracked] = await Promise.all([
      git(['diff', '--cached', '--name-only', '--no-renames', '--no-ext-diff', '--no-textconv', '--relative', '-z', '--', '.']),
      git(['diff', '--name-only', '--no-renames', '--no-ext-diff', '--no-textconv', '--relative', '-z', '--', '.']),
      git(['ls-files', '--others', '--exclude-standard', '-z', '--', '.']),
    ]);
    const after = await identity(git);
    if (before.head !== after.head || before.branch !== after.branch) throw new Error('Git identity changed during read');
    return { status: 'available', ...before, staged: nulPaths(staged), unstaged: nulPaths(unstaged), untracked: nulPaths(untracked), diagnostics };
  } catch {
    // Empty arrays are placeholders, never evidence of a clean working tree.
    return { status: 'unavailable', head: null, branch: null, staged: [], unstaged: [], untracked: [], diagnostics: [
      { code: 'git_unavailable', severity: 'warning', message: 'Git state could not be read; change coverage is unknown' },
    ] };
  }
}

export interface CommittedChanges {
  status: 'available' | 'unavailable';
  paths: string[];
  diagnostics: Diagnostic[];
}
/** Net tracked paths between two observed commit IDs, confined to Project.root. */
export async function readCommittedChanges(project: Project, fromHead: string | null, toHead: string): Promise<CommittedChanges> {
  try {
    const commitId = /^(?:[a-f0-9]{40}|[a-f0-9]{64})$/;
    if (!commitId.test(toHead) || (fromHead !== null && !commitId.test(fromHead))) throw new Error('Invalid observed commit');
    const { git, diagnostics } = await safeGit(project);
    const output = fromHead === null
      ? await git(['ls-tree', '-r', '--name-only', '-z', toHead, '--', '.'])
      : await git(['diff', '--name-only', '--no-renames', '--no-ext-diff', '--no-textconv', '--relative', '-z', fromHead, toHead, '--', '.']);
    return { status: 'available', paths: nulPaths(output), diagnostics };
  } catch {
    return { status: 'unavailable', paths: [], diagnostics: [{ code: 'git_delta_unavailable', severity: 'warning', message: 'Committed change coverage could not be read' }] };
  }
}

export interface GitInventory {
  status: 'available' | 'unavailable'; head: string | null; branch: string | null;
  paths: string[]; submodules: string[]; gitDirectory: string | null; diagnostics: Diagnostic[];
}
/** Fixed inventory commands reuse the same proven filter/fsmonitor-safe invoker. */
export async function readGitInventory(project: Project): Promise<GitInventory> {
  try {
    const { git, diagnostics } = await safeGit(project); const before = await identity(git);
    const paths = nulPaths(await git(['ls-files', '--cached', '--others', '--exclude-standard', '-z', '--', '.']));
    const entries = nulPaths(await git(['ls-files', '--stage', '-z', '--', '.']));
    const submodules = entries.filter(entry => entry.startsWith('160000 ')).map(entry => entry.slice(entry.indexOf('\t') + 1));
    const gitDirectory = await realpath((await git(['rev-parse', '--absolute-git-dir'])).trim());
    const after = await identity(git);
    if (before.head !== after.head || before.branch !== after.branch) throw new Error('Identity changed');
    return { status: 'available', ...before, paths, submodules, gitDirectory, diagnostics };
  } catch { return { status: 'unavailable', head: null, branch: null, paths: [], submodules: [], gitDirectory: null,
    diagnostics: [{ code: 'git_inventory_unavailable', severity: 'warning', message: 'Git inventory unavailable; no filesystem fallback performed' }] }; }
}

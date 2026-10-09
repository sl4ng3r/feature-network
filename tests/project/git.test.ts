import { afterEach, describe, expect, it, vi } from 'vitest';
import { mkdir, writeFile, stat, rename, symlink, rm, readFile, chmod, appendFile } from 'node:fs/promises';
import { join } from 'node:path';
import { openProject } from '../../src/project/root.js';
import { readGitState } from '../../src/project/git.js';
import { cleanup, exec, repo, tree } from './helpers.js';

const roots: string[] = [];
afterEach(async () => { vi.unstubAllEnvs(); await Promise.all(roots.splice(0).map(cleanup)); });
async function fresh() { const root = await tree(); roots.push(root); return root; }

describe('git state', () => {
  it('reads_head_and_nul_safe_staged_unstaged_untracked_paths', async () => {
    const root = await fresh(); await repo(root);
    await writeFile(join(root, 'old Ü.ts'), 'before');
    await writeFile(join(root, 'edit.ts'), 'before');
    await writeFile(join(root, '.gitignore'), 'ignored\n');
    await exec('git', ['-C', root, 'add', '.']);
    await exec('git', ['-C', root, 'commit', '-qm', 'fixture']);
    const head = (await exec('git', ['-C', root, 'rev-parse', 'HEAD'])).stdout.trim();
    await exec('git', ['-C', root, 'mv', 'old Ü.ts', 'renamed Ü.ts']);
    await writeFile(join(root, 'edit.ts'), 'after');
    const newPath = 'new Ü file.ts';
    await writeFile(join(root, newPath), 'new');
    await writeFile(join(root, 'ignored'), 'ignored');
    const state = await readGitState(await openProject(root));
    expect(state.status).toBe('available'); expect(state.head).toBe(head);
    expect(state.staged).toEqual(['old Ü.ts', 'renamed Ü.ts']);
    expect(state.unstaged).toEqual(['edit.ts']);
    expect(state.untracked).toEqual([newPath]);
  });

  // Windows filesystem names cannot contain newline; keep the NUL parser regression on POSIX.
  it.skipIf(process.platform === 'win32')('preserves_newline_inside_NUL_delimited_path_POSIX_fixture', async () => {
    const root = await fresh(); await repo(root); await writeFile(join(root, 'new\nÜ file.ts'), 'new');
    expect((await readGitState(await openProject(root))).untracked).toEqual(['new\nÜ file.ts']);
  });

  it('reads_unborn_repository_and_scopes_to_nested_project', async () => {
    const root = await fresh(); await repo(root);
    await mkdir(join(root, 'inner')); await writeFile(join(root, 'outer.ts'), 'outside');
    await writeFile(join(root, 'inner/new.ts'), 'inside');
    const state = await readGitState(await openProject(join(root, 'inner')));
    expect(state.status).toBe('available'); expect(state.head).toBeNull();
    expect(state.untracked).toEqual(['new.ts']);
  });

  it('scopes_tracked_changes_to_selected_project_and_ignores_ambient_git_root', async () => {
    const root = await fresh(); await repo(root); await mkdir(join(root, 'inner'));
    await writeFile(join(root, 'outside.ts'), 'before'); await writeFile(join(root, 'inner/staged.ts'), 'before');
    await writeFile(join(root, 'inner/unstaged.ts'), 'before');
    await exec('git', ['-C', root, 'add', '.']); await exec('git', ['-C', root, 'commit', '-qm', 'fixture']);
    await writeFile(join(root, 'outside.ts'), 'outside change');
    await writeFile(join(root, 'inner/staged.ts'), 'staged change');
    await exec('git', ['-C', root, 'add', 'inner/staged.ts']);
    await writeFile(join(root, 'inner/unstaged.ts'), 'unstaged change');
    vi.stubEnv('GIT_DIR', join(await fresh(), 'foreign.git'));
    const state = await readGitState(await openProject(join(root, 'inner')));
    expect(state.status).toBe('available');
    expect(state.staged).toEqual(['staged.ts']); expect(state.unstaged).toEqual(['unstaged.ts']);
  });

  it('does_not_execute_git_path_as_shell', async () => {
    const outer = await fresh();
    const root = join(outer, 'repo; touch OWNED; $(touch INJECTED)');
    await mkdir(root); await repo(root);
    const state = await readGitState(await openProject(root));
    expect(state.status).toBe('available');
    await expect(stat(join(outer, 'OWNED'))).rejects.toMatchObject({ code: 'ENOENT' });
    await expect(stat(join(root, 'INJECTED'))).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('does_not_execute_repository_clean_filters', async () => {
    const root = await fresh(); await repo(root);
    await exec('git', ['-C', root, 'config', 'filter.fixture.clean', 'touch FILTER_RAN; cat']);
    await writeFile(join(root, '.gitattributes'), '*.txt filter=fixture\n');
    await writeFile(join(root, 'sample.txt'), 'before');
    await exec('git', ['-C', root, 'add', '.']);
    await exec('git', ['-C', root, 'commit', '-qm', 'fixture']);
    await rm(join(root, 'FILTER_RAN'), { force: true });
    await writeFile(join(root, 'sample.txt'), 'changed content');
    const state = await readGitState(await openProject(root));
    expect(state.status).toBe('available'); expect(state.unstaged).toEqual(['sample.txt']);
    expect(state.diagnostics).toContainEqual(expect.objectContaining({ code: 'git_filters_disabled', severity: 'warning' }));
    await expect(stat(join(root, 'FILTER_RAN'))).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it.each(['fixture', 'foo=bar', 'Foo.Bar=Ü', 'trailing=', 'real\uFFFD=driver', 'quote"=back\\slash'])('suppresses_the_complete_valid_filter_key: %s', async driver => {
    const root = await fresh(); await repo(root);
    await writeFile(join(root, '.gitattributes'), `*.txt filter=${driver}\n`);
    await writeFile(join(root, 'sample.txt'), 'before');
    await exec('git', ['-C', root, 'add', '.']); await exec('git', ['-C', root, 'commit', '-qm', 'fixture']);
    await exec('git', ['-C', root, 'config', `filter.${driver}.clean`, 'touch FILTER_RAN; cat']);
    await exec('git', ['-C', root, 'config', `filter.${driver}.required`, 'true']);
    const configBefore = await readFile(join(root, '.git/config'));
    await writeFile(join(root, 'sample.txt'), 'changed content');
    // Prove the attributes genuinely select the driver, including escaped names.
    await exec('git', ['-C', root, 'diff', '--name-only', '--', '.']);
    expect((await stat(join(root, 'FILTER_RAN'))).isFile()).toBe(true);
    await rm(join(root, 'FILTER_RAN'));
    const state = await readGitState(await openProject(root));
    expect(state.status).toBe('available'); expect(state.unstaged).toEqual(['sample.txt']);
    expect(state.diagnostics).toContainEqual(expect.objectContaining({ code: 'git_filters_disabled' }));
    await expect(stat(join(root, 'FILTER_RAN'))).rejects.toMatchObject({ code: 'ENOENT' });
    expect(await readFile(join(root, '.git/config'))).toEqual(configBefore);
  });

  it.each(['fixture', 'foo=bar'])('suppresses_process_filters_and_ambient_overrides: %s', async driver => {
    const root = await fresh(); await repo(root);
    await writeFile(join(root, '.gitattributes'), `*.txt filter=${driver}\n`);
    await writeFile(join(root, 'sample.txt'), 'before');
    await exec('git', ['-C', root, 'add', '.']); await exec('git', ['-C', root, 'commit', '-qm', 'fixture']);
    await exec('git', ['-C', root, 'config', `filter.${driver}.process`, 'touch PROCESS_RAN; exit 1']);
    await exec('git', ['-C', root, 'config', `filter.${driver}.required`, 'true']);
    await writeFile(join(root, 'sample.txt'), 'changed content');
    await exec('git', ['-C', root, 'diff', '--name-only', '--', '.']).catch(() => {});
    expect((await stat(join(root, 'PROCESS_RAN'))).isFile()).toBe(true);
    await rm(join(root, 'PROCESS_RAN'));
    const project = await openProject(root);
    vi.stubEnv('GIT_CONFIG_COUNT', '1'); vi.stubEnv('GIT_CONFIG_KEY_0', `filter.${driver}.clean`);
    vi.stubEnv('GIT_CONFIG_VALUE_0', 'touch AMBIENT_RAN; cat');
    const state = await readGitState(project);
    expect(state.status).toBe('available'); expect(state.unstaged).toEqual(['sample.txt']);
    expect(state.diagnostics).toContainEqual(expect.objectContaining({ code: 'git_filters_disabled' }));
    await expect(stat(join(root, 'PROCESS_RAN'))).rejects.toMatchObject({ code: 'ENOENT' });
    await expect(stat(join(root, 'AMBIENT_RAN'))).rejects.toMatchObject({ code: 'ENOENT' });
    expect(process.env.GIT_CONFIG_VALUE_0).toBe('touch AMBIENT_RAN; cat');
  });

  it.skipIf(process.platform === 'win32')('fails_closed_when_git_cannot_apply_separate_config_keys_and_values_POSIX_shebang', async () => {
    const root = await fresh(); await repo(root);
    await writeFile(join(root, '.gitattributes'), '*.txt filter=foo=bar\n');
    await writeFile(join(root, 'sample.txt'), 'before');
    await exec('git', ['-C', root, 'add', '.']); await exec('git', ['-C', root, 'commit', '-qm', 'fixture']);
    await exec('git', ['-C', root, 'config', 'filter.foo=bar.clean', 'touch FILTER_RAN; cat']);
    await exec('git', ['-C', root, 'config', 'core.fsmonitor', 'false']);
    await writeFile(join(root, 'sample.txt'), 'changed content');
    const realGit = (await exec('which', ['git'])).stdout.trim();
    const executables = join(await fresh(), 'executables'); await mkdir(executables);
    await writeFile(join(executables, 'git'), `#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith('GIT_CONFIG_')));
const result = spawnSync(${JSON.stringify(realGit)}, process.argv.slice(2), { env });
process.stdout.write(result.stdout ?? ''); process.stderr.write(result.stderr ?? '');
process.exit(result.status ?? 1);
`);
    await chmod(join(executables, 'git'), 0o755);
    vi.stubEnv('PATH', `${executables}:${process.env.PATH}`);
    const state = await readGitState(await openProject(root));
    await expect(stat(join(root, 'FILTER_RAN'))).rejects.toMatchObject({ code: 'ENOENT' });
    expect(state.status).toBe('unavailable');
    expect(state.diagnostics).toContainEqual(expect.objectContaining({ code: 'git_unavailable' }));
  });

  it('fails_closed_for_filter_keys_that_cannot_be_decoded_losslessly', async () => {
    const root = await fresh(); await repo(root);
    const invalidName = Buffer.from([0x66, 0x6f, 0x6f, 0xff, 0x62, 0x61, 0x72]);
    await writeFile(join(root, '.gitattributes'), Buffer.concat([Buffer.from('*.txt filter='), invalidName, Buffer.from('\n')]));
    await writeFile(join(root, 'sample.txt'), 'before');
    await exec('git', ['-C', root, 'add', '.']); await exec('git', ['-C', root, 'commit', '-qm', 'fixture']);
    await appendFile(join(root, '.git/config'), Buffer.concat([
      Buffer.from('\n[filter "'), invalidName,
      Buffer.from('"]\n clean = "touch FILTER_RAN; cat"\n required = true\n'),
    ]));
    await writeFile(join(root, 'sample.txt'), 'changed content');
    await exec('git', ['-C', root, 'diff', '--name-only', '--', '.']);
    expect((await stat(join(root, 'FILTER_RAN'))).isFile()).toBe(true);
    await rm(join(root, 'FILTER_RAN'));
    const state = await readGitState(await openProject(root));
    await expect(stat(join(root, 'FILTER_RAN'))).rejects.toMatchObject({ code: 'ENOENT' });
    expect(state.status).toBe('unavailable');
    expect(state.diagnostics).toContainEqual(expect.objectContaining({ code: 'git_unavailable' }));
  });

  it('does_not_follow_a_rebound_project_root', async () => {
    const root = await fresh(); await repo(root); const project = await openProject(root);
    const other = await fresh(); await repo(other); await writeFile(join(other, 'foreign.ts'), 'foreign');
    const moved = root + '-moved'; roots.push(moved); await rename(root, moved);
    await symlink(other, root);
    const state = await readGitState(project);
    expect(state.status).toBe('unavailable');
    expect(state.untracked).toEqual([]);
  });

  it('reports_unavailable_git', async () => {
    const root = await fresh(); await repo(root); const project = await openProject(root);
    vi.stubEnv('PATH', join(root, 'no executables'));
    const state = await readGitState(project);
    expect(state.status).toBe('unavailable');
    expect(state.staged).toEqual([]); expect(state.unstaged).toEqual([]); expect(state.untracked).toEqual([]);
    expect(state.diagnostics).toContainEqual(expect.objectContaining({ code: 'git_unavailable' }));
  });

  it('reports_non_repository_as_a_diagnostic_boundary', async () => {
    const state = await readGitState(await openProject(await fresh()));
    expect(state.status).toBe('unavailable');
    expect(state.diagnostics).toContainEqual(expect.objectContaining({ code: 'git_unavailable' }));
  });
});

it('committed_delta_is_relative_and_never_runs_malicious_filters', async () => {
  const { readCommittedChanges } = await import('../../src/project/git.js');
  const root = await fresh(); await repo(root); await mkdir(join(root, 'inner'));
  await writeFile(join(root, 'inner/.gitattributes'), '*.txt filter=foo=bar\n');
  await writeFile(join(root, 'inner/sample.txt'), 'before'); await writeFile(join(root, 'outside.ts'), 'before');
  await exec('git', ['-C', root, 'add', '.']); await exec('git', ['-C', root, 'commit', '-qm', 'before']);
  const before = (await exec('git', ['-C', root, 'rev-parse', 'HEAD'])).stdout.trim();
  await writeFile(join(root, 'inner/sample.txt'), 'after'); await writeFile(join(root, 'outside.ts'), 'after');
  await exec('git', ['-C', root, 'add', '.']); await exec('git', ['-C', root, 'commit', '-qm', 'after']);
  const after = (await exec('git', ['-C', root, 'rev-parse', 'HEAD'])).stdout.trim();
  await exec('git', ['-C', root, 'config', 'filter.foo=bar.clean', 'touch FILTER_RAN; cat']);
  await exec('git', ['-C', root, 'config', 'filter.foo=bar.process', 'touch PROCESS_RAN; exit 1']);
  await exec('git', ['-C', root, 'config', 'filter.foo=bar.required', 'true']);
  await writeFile(join(root, 'inner/sample.txt'), 'dirty');
  const delta = await readCommittedChanges(await openProject(join(root, 'inner')), before, after);
  expect(delta.status).toBe('available'); expect(delta.paths).toEqual(['sample.txt']);
  expect(delta.diagnostics).toContainEqual(expect.objectContaining({ code: 'git_filters_disabled' }));
  await expect(stat(join(root, 'FILTER_RAN'))).rejects.toMatchObject({ code: 'ENOENT' });
  await expect(stat(join(root, 'PROCESS_RAN'))).rejects.toMatchObject({ code: 'ENOENT' });
});

import { afterEach, describe, expect, it, vi } from 'vitest';
import { mkdir, writeFile, stat, rename, symlink, rm } from 'node:fs/promises';
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
    await writeFile(join(root, 'new\nÜ file.ts'), 'new');
    await writeFile(join(root, 'ignored'), 'ignored');
    const state = await readGitState(await openProject(root));
    expect(state.status).toBe('available'); expect(state.head).toBe(head);
    expect(state.staged).toEqual(['old Ü.ts', 'renamed Ü.ts']);
    expect(state.unstaged).toEqual(['edit.ts']);
    expect(state.untracked).toEqual(['new\nÜ file.ts']);
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

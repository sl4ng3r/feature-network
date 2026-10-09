import { afterEach, expect, test } from 'vitest';
import { mkdir, writeFile, symlink, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { inventory } from '../../src/bootstrap/inventory.js';
import { openProject } from '../../src/project/root.js';
import { cleanup, tree, repo, exec } from '../project/helpers.js';
import { hash } from '../freshness/fixture.js';
const roots: string[] = [];
afterEach(async () => { await Promise.all(roots.splice(0).map(cleanup)); });
async function setup() { const root = await tree(); roots.push(root); await repo(root); return openProject(root); }
test('excludes_secrets_dependencies_binary_subrepos', async () => {
  const p = await setup();
  for (const [path, text] of Object.entries({ 'src/a.ts': 'source', '.env': 'SECRET=hidden', 'node_modules/a.ts': 'dep', 'build/out.js': 'built', 'image.png': '\0binary', 'nested/a.ts': 'nested' })) { await mkdir(join(p.root, path, '..'), { recursive: true }); await writeFile(join(p.root, path), text); }
  await repo(join(p.root, 'nested')); await symlink('.env', join(p.root, 'alias.ts'));
  const result = await inventory(p);
  expect(result.status).toBe('available');
  expect(result.files.filter(f => f.status === 'pending').map(f => f.path)).toEqual(['src/a.ts']);
  expect(result.files.find(f => f.path === 'nested')).toMatchObject({ status: 'excluded', reason: 'nested_repository' });
  expect(JSON.stringify(result)).not.toContain('SECRET=hidden');
});
test('allows_sanitized_env_example_only_with_current_explicit_attestation', async () => {
  const p = await setup(); await writeFile(join(p.root, '.env.example'), 'PORT=3000\n');
  expect((await inventory(p)).files[0]).toMatchObject({ status: 'excluded', reason: 'example_requires_attestation' });
  expect((await inventory(p, { sanitizedExamples: [{ path: '.env.example', hash: hash('PORT=3000\n') }] })).files[0]).toMatchObject({ status: 'pending' });
  await writeFile(join(p.root, '.env.example'), 'TOKEN=private\n');
  expect((await inventory(p, { sanitizedExamples: [{ path: '.env.example', hash: hash('PORT=3000\n') }] })).files[0]).toMatchObject({ status: 'needs_review' });
});
test('git_unavailable_never_falls_back_to_full_scan', async () => {
  const root = await tree(); roots.push(root); await writeFile(join(root, 'a.ts'), 'a');
  expect(await inventory(await openProject(root))).toMatchObject({ status: 'unavailable', files: [] });
});
test('malicious_git_filters_are_not_executed', async () => {
  const p = await setup(); await writeFile(join(p.root, 'a.ts'), 'a'); await writeFile(join(p.root, '.gitattributes'), '*.ts filter=evil\n');
  await exec('git', ['-C', p.root, 'config', 'filter.evil.clean', 'touch filter-executed']);
  await exec('git', ['-C', p.root, 'config', 'core.fsmonitor', 'touch monitor-executed']);
  expect((await inventory(p)).status).toBe('available');
  await expect(readFile(join(p.root, 'filter-executed'))).rejects.toMatchObject({ code: 'ENOENT' });
  await expect(readFile(join(p.root, 'monitor-executed'))).rejects.toMatchObject({ code: 'ENOENT' });
});
test('actual_plugin_root_and_canonical_aliases_are_excluded', async () => {
  const p = await setup(); await mkdir(join(p.root, 'plugin')); await writeFile(join(p.root, 'plugin/core.ts'), 'private plugin'); await symlink('plugin/core.ts', join(p.root, 'alias.ts'));
  const result = await inventory(p, { excludedReferenceRoots: [join(p.root, 'plugin')] });
  expect(result.files.filter(f => f.status === 'pending')).toEqual([]); expect(result.files.find(f => f.path === 'alias.ts')?.reason).toBe('plugin');
});
test('tracked_submodule_is_an_explicit_excluded_area', async () => {
  const p = await setup(); await writeFile(join(p.root, 'a.ts'), 'a'); await exec('git', ['-C', p.root, 'add', 'a.ts']); await exec('git', ['-C', p.root, 'commit', '-qm', 'initial']);
  const head = (await exec('git', ['-C', p.root, 'rev-parse', 'HEAD'])).stdout.trim();
  await exec('git', ['-C', p.root, 'update-index', '--add', '--cacheinfo', `160000,${head},submodule`]);
  expect((await inventory(p)).files.find(f => f.path === 'submodule')).toMatchObject({ status: 'excluded', reason: 'nested_repository' });
});

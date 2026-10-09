import { afterEach, expect, test } from 'vitest';
import { mkdir, readFile, writeFile, readdir, symlink } from 'node:fs/promises';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { openProject } from '../../src/project/root.js';
import { applyUpdate, readSnapshot } from '../../src/storage/repository.js';
import { readRuntime, writeRuntime, runtimeRevision } from '../../src/storage/runtime.js';
import { cleanup, exec, repo, tree } from '../project/helpers.js';
import type { Feature } from '../../src/model/types.js';

const roots: string[] = [];
afterEach(async () => { await Promise.all(roots.splice(0).map(cleanup)); });
export const hash = (text: string) => createHash('sha256').update(text).digest('hex');
export const feature = (id = 'alpha', summary = 'Old'): Feature => ({ schema: 1, id, summary, key_points: [], code: [{ path: 'source.ts' }], evidence: [], relations: [], hypotheses: [] });
async function setup() {
  const root = await tree(); roots.push(root);
  await writeFile(join(root, 'source.ts'), 'source');
  return openProject(root);
}
const refs = [{ path: 'source.ts', hash: hash('source') }];
const initial = () => ({ expected: { 'network-spec/_meta.yaml': null, 'network-spec/alpha.yaml': null }, upserts: [feature()], deletes: [], verifiedReferences: refs, initialize: true });

test('uninitialized_read_does_not_create_paths', async () => {
  const project = await setup();
  expect((await readSnapshot(project)).integrity).toBe('not_initialized');
  expect(await readdir(project.root)).toEqual(['source.ts']);
});
test('initializes_marker_with_first_feature', async () => {
  const project = await setup();
  await applyUpdate(project, initial());
  const snapshot = await readSnapshot(project);
  expect(snapshot.integrity).toBe('valid');
  expect(snapshot.features.map(f => f.id)).toEqual(['alpha']);
  expect(await readFile(project.markerPath, 'utf8')).toContain('coverage: partial');
  expect(snapshot.fingerprints['network-spec/alpha.yaml']).toMatch(/^[0-9a-f]{64}$/);
});
test('empty_initialization_is_not_a_complete_network', async () => {
  const project = await setup();
  await expect(applyUpdate(project, { ...initial(), upserts: [] })).rejects.toMatchObject({ code: 'invalid_update' });
  expect((await readSnapshot(project)).integrity).toBe('not_initialized');
});
test('conflict_preserves_manual_edit', async () => {
  const project = await setup(); await applyUpdate(project, initial());
  const snapshot = await readSnapshot(project);
  const path = join(project.networkDir, 'alpha.yaml');
  const manual = (await readFile(path, 'utf8')) + '# manual text\n';
  await writeFile(path, manual);
  await expect(applyUpdate(project, { expected: snapshot.fingerprints, upserts: [feature('alpha', 'New')], deletes: [], verifiedReferences: refs })).rejects.toMatchObject({ code: 'conflict' });
  expect(await readFile(path, 'utf8')).toBe(manual);
});
test('validates_whole_end_state_including_remaining_invalid_files', async () => {
  const project = await setup(); await applyUpdate(project, initial());
  await writeFile(join(project.networkDir, 'broken.yaml'), 'schema: 99');
  const snapshot = await readSnapshot(project);
  expect(snapshot.integrity).toBe('invalid');
  expect(snapshot.diagnostics).toContainEqual(expect.objectContaining({ code: 'invalid_schema', path: 'network-spec/broken.yaml' }));
  await expect(applyUpdate(project, { expected: snapshot.fingerprints, upserts: [feature('alpha', 'New')], deletes: [], verifiedReferences: refs })).rejects.toMatchObject({ code: 'invalid_network' });
  expect((await readSnapshot(project)).features[0]?.summary).toBe('Old');
});
test('validates_missing_targets_and_all_reference_kinds_and_allows_joint_deletion', async () => {
  const project = await setup(); await applyUpdate(project, initial());
  const alpha = feature(); alpha.relations = [{ to: 'beta', type: 'reads', status: 'hypothesis', evidence: [] }];
  let snap = await readSnapshot(project);
  await expect(applyUpdate(project, { expected: snap.fingerprints, upserts: [alpha], deletes: [], verifiedReferences: refs })).rejects.toMatchObject({ code: 'invalid_network' });
  await applyUpdate(project, { expected: { ...snap.fingerprints, 'network-spec/beta.yaml': null }, upserts: [alpha, feature('beta')], deletes: [], verifiedReferences: refs });
  snap = await readSnapshot(project);
  await expect(applyUpdate(project, { expected: snap.fingerprints, upserts: [], deletes: ['beta'], verifiedReferences: [] })).rejects.toMatchObject({ code: 'invalid_network' });
  await applyUpdate(project, { expected: snap.fingerprints, upserts: [], deletes: ['alpha', 'beta'], verifiedReferences: [] });
  expect((await readSnapshot(project)).features).toEqual([]);
  const missing = feature(); missing.hypotheses = [{ text: 'Maybe', evidence: [{ path: 'missing.ts' }] }];
  await expect(applyUpdate(project, { expected: { 'network-spec/alpha.yaml': null }, upserts: [missing], deletes: [], verifiedReferences: refs })).rejects.toMatchObject({ code: 'invalid_network' });
});
test('requires_actual_reference_hashes_and_confirms_without_rewriting_yaml', async () => {
  const project = await setup();
  await expect(applyUpdate(project, { ...initial(), verifiedReferences: [] })).rejects.toMatchObject({ code: 'unverified_reference' });
  await expect(applyUpdate(project, { ...initial(), verifiedReferences: [{ path: 'source.ts', hash: hash('stale') }] })).rejects.toMatchObject({ code: 'conflict' });
  await applyUpdate(project, initial());
  const before = await readFile(join(project.networkDir, 'alpha.yaml'), 'utf8');
  await writeFile(join(project.root, 'source.ts'), 'changed');
  const snap = await readSnapshot(project);
  await applyUpdate(project, { expected: snap.fingerprints, upserts: [], deletes: [], verifiedReferences: [{ path: 'source.ts', hash: hash('changed') }] });
  expect(await readFile(join(project.networkDir, 'alpha.yaml'), 'utf8')).toBe(before);
  expect(await readRuntime(project, 'baselines')).toMatchObject({ networkRevision: snap.revision, references: { 'source.ts': hash('changed') } });
});
test('rejects_storage_and_git_references_including_symlink_aliases', async () => {
  const project = await setup(); await mkdir(join(project.root, '.git')); await writeFile(join(project.root, '.git/config'), 'private');
  await symlink('.git/config', join(project.root, 'alias.ts'));
  for (const path of ['.git/config', 'alias.ts', '.feature-network/lock', 'network-spec/_meta.yaml']) {
    const bad = feature(); bad.code = [{ path }];
    await expect(applyUpdate(project, { ...initial(), upserts: [bad] })).rejects.toMatchObject({ code: 'invalid_network' });
  }
  await mkdir(join(project.root, 'installed-plugin')); await writeFile(join(project.root, 'installed-plugin/core.ts'), 'plugin');
  const bad = feature(); bad.code = [{ path: 'installed-plugin/core.ts' }];
  await expect(applyUpdate(project, { ...initial(), upserts: [bad] }, { excludedReferenceRoots: [join(project.root, 'installed-plugin')] })).rejects.toMatchObject({ code: 'invalid_network' });
});
test('runtime_compare_and_swap_preserves_values_and_blocks_reserved_keys', async () => {
  const project = await setup();
  await writeRuntime(project, 'sessions/demo', null, { cursor: 1 });
  expect(await readRuntime(project, 'sessions/demo')).toEqual({ cursor: 1 });
  await expect(writeRuntime(project, 'sessions/demo', null, { cursor: 2 })).rejects.toMatchObject({ code: 'conflict' });
  await writeRuntime(project, 'sessions/demo', runtimeRevision({ cursor: 1 }), { cursor: 2 });
  expect(await readRuntime(project, 'sessions/demo')).toEqual({ cursor: 2 });
  for (const key of ['../source.ts', 'baselines', 'journal', 'lock', '/tmp/outside']) {
    await expect(writeRuntime(project, key, null, {})).rejects.toMatchObject({ code: 'unsafe_path' });
  }
});
test('runtime_is_git_ignored_without_changing_repo_config', async () => {
  const project = await setup(); await repo(project.root);
  const config = await readFile(join(project.root, '.git/config'), 'utf8');
  await writeRuntime(project, 'sessions/a', null, { okay: true });
  const ignored = await exec('git', ['-C', project.root, 'check-ignore', '.feature-network/values/sessions/a.json']);
  expect(ignored.stdout.trim()).toBe('.feature-network/values/sessions/a.json');
  expect(await readFile(join(project.root, '.git/config'), 'utf8')).toBe(config);
  await writeFile(join(project.runtimeDir, '.gitignore'), '# maintained manually\n');
  await writeRuntime(project, 'sessions/b', null, {});
  expect(await readFile(join(project.runtimeDir, '.gitignore'), 'utf8')).toBe('# maintained manually\n');
  await exec('git', ['-C', project.root, 'add', '-f', '.feature-network/values/sessions/a.json']);
  await applyUpdate(project, initial());
  expect((await readSnapshot(project)).diagnostics).toContainEqual(expect.objectContaining({ code: 'tracked_runtime', severity: 'warning' }));
});

test('invalid_utf8_network_bytes_are_visible_and_hashes_remain_byte_exact', async () => {
  const project = await setup(); await applyUpdate(project, initial());
  const bytes = Buffer.from([0xff, 0xfe, 0x0a]);
  await writeFile(join(project.networkDir, 'broken.yaml'), bytes);
  const snapshot = await readSnapshot(project);
  expect(snapshot.integrity).toBe('invalid');
  expect(snapshot.diagnostics).toContainEqual(expect.objectContaining({ code: 'invalid_schema', path: 'network-spec/broken.yaml' }));
  expect(snapshot.fingerprints['network-spec/broken.yaml']).toBe(createHash('sha256').update(bytes).digest('hex'));
  await applyUpdate(project, { expected: snapshot.fingerprints, upserts: [], deletes: ['broken'], verifiedReferences: [] });
  expect((await readSnapshot(project)).integrity).toBe('valid');
});

test('invalid_marker_encoding_is_reported_as_invalid_snapshot', async () => {
  const project = await setup(); await applyUpdate(project, initial());
  await writeFile(project.markerPath, Buffer.from([0xff]));
  expect((await readSnapshot(project)).diagnostics).toContainEqual(expect.objectContaining({ code: 'invalid_schema', path: 'network-spec/_meta.yaml' }));
});
test('runtime_revision_uses_the_json_value_returned_by_read', async () => {
  const project = await setup(); await writeRuntime(project, 'sessions/a', null, { cursor: 1 });
  await writeFile(join(project.runtimeDir, 'values/sessions/a.json'), '{ "cursor": 1 }\n');
  const value = await readRuntime(project, 'sessions/a');
  await writeRuntime(project, 'sessions/a', runtimeRevision(value), { cursor: 2 });
  expect(await readRuntime(project, 'sessions/a')).toEqual({ cursor: 2 });
  await expect(writeRuntime(project, 'sessions/b', null, Number.NaN)).rejects.toMatchObject({ code: 'invalid_runtime' });
});
test('repository_propagates_disabled_git_filter_limitations', async () => {
  const project = await setup(); await repo(project.root);
  await exec('git', ['-C', project.root, 'config', 'filter.demo.clean', 'cat']);
  await applyUpdate(project, initial());
  expect((await readSnapshot(project)).diagnostics).toContainEqual(expect.objectContaining({ code: 'git_filters_disabled', severity: 'warning' }));
});

test('targeted_confirmation_carries_only_unchanged_confirmed_references', async () => {
  const project = await setup();
  await writeFile(join(project.root, 'other.ts'), 'other');
  await writeFile(join(project.root, 'changed.ts'), 'original');
  const value = feature(); value.code.push({ path: 'other.ts' }, { path: 'changed.ts' });
  await applyUpdate(project, { ...initial(), upserts: [value], verifiedReferences: [...refs, { path: 'other.ts', hash: hash('other') }, { path: 'changed.ts', hash: hash('original') }] });
  await writeFile(join(project.root, 'source.ts'), 'newly inspected');
  await writeFile(join(project.root, 'changed.ts'), 'uninspected change');
  const snap = await readSnapshot(project);
  await applyUpdate(project, { expected: snap.fingerprints, upserts: [], deletes: [], verifiedReferences: [{ path: 'source.ts', hash: hash('newly inspected') }] });
  expect(await readRuntime(project, 'baselines')).toEqual({ networkRevision: snap.revision, references: { 'source.ts': hash('newly inspected'), 'other.ts': hash('other') } });
  await writeFile(join(project.networkDir, 'alpha.yaml'), (await readFile(join(project.networkDir, 'alpha.yaml'), 'utf8')) + '# manual\n');
  await applyUpdate(project, { expected: (await readSnapshot(project)).fingerprints, upserts: [], deletes: [], verifiedReferences: [{ path: 'source.ts', hash: hash('newly inspected') }] });
  expect(await readRuntime(project, 'baselines')).toMatchObject({ references: { 'source.ts': hash('newly inspected') } });
  expect((await readRuntime<any>(project, 'baselines')).references['other.ts']).toBeUndefined();
});

test('invalid_runtime_values_are_diagnosed_without_overwriting', async () => {
  const project = await setup(); await writeRuntime(project, 'sessions/a', null, { cursor: 1 });
  const path = join(project.runtimeDir, 'values/sessions/a.json');
  for (const invalid of [Buffer.from('null'), Buffer.from('{'), Buffer.from([0xff])]) {
    await writeFile(path, invalid);
    await expect(readRuntime(project, 'sessions/a')).rejects.toMatchObject({ code: 'invalid_runtime' });
    await expect(writeRuntime(project, 'sessions/a', null, {})).rejects.toMatchObject({ code: 'invalid_runtime' });
    expect(await readFile(path)).toEqual(invalid);
  }
});


test('oversized_runtime_write_preserves_existing_readable_value', async () => {
  const project = await setup(); const original = { cursor: 1 };
  await writeRuntime(project, 'sessions/bounded', null, original);
  await expect(writeRuntime(project, 'sessions/bounded', runtimeRevision(original), { text: 'a'.repeat(16 * 1024 * 1024) })).rejects.toMatchObject({ code: 'storage_too_large' });
  expect(await readRuntime(project, 'sessions/bounded')).toEqual(original);
  expect(await readdir(join(project.runtimeDir, 'values/sessions'))).toEqual(['bounded.json']);
});
test('runtime_size_boundary_counts_encoded_utf8_bytes_including_json', async () => {
  const project = await setup();
  // JSON wrapper {"text":""} is 11 bytes; each é is two UTF-8 bytes.
  const text = 'é'.repeat(8_388_602) + 'a';
  const exact = { text };
  expect(Buffer.byteLength(JSON.stringify(exact))).toBe(16_777_216);
  await writeRuntime(project, 'sessions/boundary', null, exact);
  expect((await readRuntime<{ text: string }>(project, 'sessions/boundary'))?.text === text).toBe(true);
  await expect(writeRuntime(project, 'sessions/boundary', runtimeRevision(exact), { text: text + 'a' })).rejects.toMatchObject({ code: 'storage_too_large' });
  expect((await readRuntime<{ text: string }>(project, 'sessions/boundary'))?.text === text).toBe(true);
});

test('expected_network_revision_detects_new_feature_added_after_agent_read', async () => {
  const project = await setup(); await applyUpdate(project, initial()); const snap = await readSnapshot(project);
  await writeFile(join(project.networkDir, 'beta.yaml'), await readFile(join(project.networkDir, 'alpha.yaml'), 'utf8').then(text => text.replace('id: alpha', 'id: beta')));
  const before = await readRuntime(project, 'baselines');
  await expect(applyUpdate(project, { expected: snap.fingerprints, expectedRevision: snap.revision, upserts: [], deletes: [], verifiedReferences: refs })).rejects.toMatchObject({ code: 'conflict' });
  expect(await readRuntime(project, 'baselines')).toEqual(before);
});

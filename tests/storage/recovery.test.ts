import { afterEach, expect, test } from 'vitest';
import { writeFile, readFile, rename, symlink, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { openProject } from '../../src/project/root.js';
import { applyUpdate, readSnapshot } from '../../src/storage/repository.js';
import { readRuntime } from '../../src/storage/runtime.js';
import { cleanup, tree } from '../project/helpers.js';
import { feature, initial, refs, worker, type Worker } from '../helpers/storage-worker.js';
const roots: string[] = []; const workers: Worker[] = [];
afterEach(async () => { for (const w of workers.splice(0)) { w.child.kill('SIGKILL'); await w.done; } await Promise.all(roots.splice(0).map(cleanup)); });
async function setup(init = true) { const root = await tree(); roots.push(root); await writeFile(join(root, 'source.ts'), 'source'); const p = await openProject(root); if (init) await applyUpdate(p, initial()); return p; }
async function crash(root: string, request: unknown, phase: string) {
  const w = worker(root, 'update', request, phase); workers.push(w);
  expect(await w.next()).toEqual({ stage: phase }); w.child.kill('SIGKILL'); expect((await w.done).signal).toBe('SIGKILL');
}
const empty = () => ({ expected: {}, upserts: [], deletes: [], verifiedReferences: [] });
for (const phase of ['before-rename', 'after-rename']) {
  test(`read_with_journal_does_not_recover_and_crash_recovers_on_next_write_${phase}`, async () => {
    const p = await setup(); const snap = await readSnapshot(p); const baseline = await readRuntime(p, 'baselines');
    await crash(p.root, { expected: snap.fingerprints, upserts: [feature('alpha', 'New'), feature('beta', 'New')], deletes: [], verifiedReferences: refs }, phase);
    const journal = await readFile(join(p.runtimeDir, 'journal.json'), 'utf8');
    const bytes = await Promise.all(['alpha', 'beta'].map(id => readFile(join(p.networkDir, `${id}.yaml`), 'utf8')));
    const reader = worker(p.root, 'read'); workers.push(reader); const result = await reader.next();
    expect(result.result.integrity).toBe('pending_recovery'); expect(result.result.features).toEqual([]);
    expect(await readFile(join(p.runtimeDir, 'journal.json'), 'utf8')).toBe(journal);
    expect(await Promise.all(['alpha', 'beta'].map(id => readFile(join(p.networkDir, `${id}.yaml`), 'utf8')))).toEqual(bytes);
    await applyUpdate(p, empty());
    const recovered = await readSnapshot(p); expect(recovered.integrity).toBe('valid');
    expect(recovered.features.map(f => f.summary)).toEqual(['New', 'New']);
    expect(await readRuntime(p, 'baselines')).toEqual(baseline);
    expect((baseline as any).networkRevision).not.toBe(recovered.revision);
  });
}
test('external_edit_blocks_all_recovery_including_untouched_files', async () => {
  const p = await setup(); const snap = await readSnapshot(p);
  await crash(p.root, { expected: snap.fingerprints, upserts: [feature('alpha', 'New')], deletes: [], verifiedReferences: refs }, 'before-rename');
  const alpha = await readFile(join(p.networkDir, 'alpha.yaml'), 'utf8');
  const manual = (await readFile(join(p.networkDir, 'beta.yaml'), 'utf8')) + '# manual\n';
  await writeFile(join(p.networkDir, 'beta.yaml'), manual);
  await expect(applyUpdate(p, empty())).rejects.toMatchObject({ code: 'pending_recovery' });
  const { writeRuntime } = await import('../../src/storage/runtime.js');
  await expect(writeRuntime(p, 'sessions/blocked', null, { cursor: 1 })).rejects.toMatchObject({ code: 'pending_recovery' });
  expect(await readRuntime(p, 'sessions/blocked')).toBeNull();
  expect(await readFile(join(p.networkDir, 'alpha.yaml'), 'utf8')).toBe(alpha);
  expect(await readFile(join(p.networkDir, 'beta.yaml'), 'utf8')).toBe(manual);
});
test('crash_before_baseline_does_not_confirm_references', async () => {
  const p = await setup(); const snap = await readSnapshot(p); const baseline = await readRuntime(p, 'baselines');
  await crash(p.root, { expected: snap.fingerprints, upserts: [feature('alpha', 'New')], deletes: [], verifiedReferences: refs }, 'before-baseline');
  const after = await readSnapshot(p); expect(after.integrity).toBe('valid');
  expect(after.features[0]?.summary).toBe('New');
  expect(await readRuntime(p, 'baselines')).toEqual(baseline);
  expect((baseline as any).networkRevision).not.toBe(after.revision);
});
test('marker_and_first_feature_recover_as_one_initialization', async () => {
  const p = await setup(false);
  await crash(p.root, initial(), 'after-rename');
  expect((await readSnapshot(p)).integrity).toBe('pending_recovery');
  await applyUpdate(p, empty());
  expect((await readSnapshot(p)).features.map(f => f.id)).toEqual(['alpha', 'beta']);
  expect(await readRuntime(p, 'baselines')).toBeNull();
});

test('rechecks_storage_directory_at_rename_boundary', async () => {
  const p = await setup(); const snap = await readSnapshot(p);
  const outside = await tree(); roots.push(outside);
  await writeFile(join(outside, 'alpha.yaml'), 'outside bytes');
  const w = worker(p.root, 'update', { expected: snap.fingerprints, upserts: [feature('alpha', 'New')], deletes: [], verifiedReferences: refs }, 'before-rename'); workers.push(w);
  expect(await w.next()).toEqual({ stage: 'before-rename' });
  await rename(p.networkDir, join(p.root, 'original-network'));
  await symlink(outside, p.networkDir);
  w.child.send('continue');
  expect((await w.next()).error.code).toBe('unsafe_path');
  expect(await readFile(join(outside, 'alpha.yaml'), 'utf8')).toBe('outside bytes');
  expect(await readdir(outside)).toEqual(['alpha.yaml']);
});
test('corrupt_journal_is_visible_and_never_overwrites_network', async () => {
  const p = await setup(); const bytes = await readFile(join(p.networkDir, 'alpha.yaml'), 'utf8');
  await writeFile(join(p.runtimeDir, 'journal.json'), Buffer.from([0xff, 0xfe]));
  expect((await readSnapshot(p)).integrity).toBe('pending_recovery');
  await expect(applyUpdate(p, empty())).rejects.toMatchObject({ code: 'pending_recovery' });
  expect(await readFile(join(p.networkDir, 'alpha.yaml'), 'utf8')).toBe(bytes);
});

test('next_runtime_write_recovers_network_without_confirming_analysis', async () => {
  const p = await setup(); const snap = await readSnapshot(p); const baseline = await readRuntime(p, 'baselines');
  await crash(p.root, { expected: snap.fingerprints, upserts: [feature('alpha', 'New')], deletes: [], verifiedReferences: refs }, 'after-rename');
  const { writeRuntime } = await import('../../src/storage/runtime.js');
  await writeRuntime(p, 'sessions/recovered', null, { cursor: 1 });
  expect((await readSnapshot(p)).integrity).toBe('valid');
  expect(await readRuntime(p, 'sessions/recovered')).toEqual({ cursor: 1 });
  expect(await readRuntime(p, 'baselines')).toEqual(baseline);
});

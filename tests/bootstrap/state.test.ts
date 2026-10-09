import { describe, afterEach, expect, test } from 'vitest';
import { readFile, writeFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { bootstrap, type BootstrapResult } from '../../src/bootstrap/state.js';
import { fixture, hash } from '../freshness/fixture.js';
import { tree, repo, cleanup, exec } from '../project/helpers.js';
import { openProject } from '../../src/project/root.js';
import { readSnapshot, applyUpdate } from '../../src/storage/repository.js';
import { readRuntime, writeRuntime } from '../../src/storage/runtime.js';

const roots: string[] = [];
afterEach(async () => { await Promise.all(roots.splice(0).map(cleanup)); });
function ack(result: BootstrapResult, networkRevision: string, featureFingerprints: Record<string, string> = {}) {
  return { action: 'checkpoint' as const, expectedRunRevision: result.runRevision!, packageId: result.package!.id, networkRevision,
    sources: [...new Map(result.package!.slices.map(s => [s.path, { path: s.path, hash: s.fileHash }])).values()], featureFingerprints,
    results: result.package!.slices.map(s => ({ path: s.path, startByte: s.startByte, endByte: s.endByte, featureIds: Object.keys(featureFingerprints), outcome: 'analyzed' as const, reason: 'Reviewed actual source and saved feature mapping' })) };
}
// Real filesystem/Git/process integration: finite hosted-runner budget; unit defaults stay unchanged.
describe('repository integration', { timeout: 20000 }, () => {
test('checkpoint_conflict_preserves_progress', async () => {
  const p = await fixture(roots); const next = await bootstrap(p, { action: 'start' }); const snap = await readSnapshot(p);
  const request = ack(next, snap.revision, { alpha: snap.fingerprints['network-spec/alpha.yaml']! });
  const saved = await bootstrap(p, request); expect(saved.state!.files.find(f => f.path === 'source.ts')?.status).toBe('analyzed');
  await expect(bootstrap(p, request)).rejects.toMatchObject({ code: 'conflict' });
  expect((await bootstrap(p, { action: 'status' })).runRevision).toBe(saved.runRevision);
}, 20000);
test('crash_after_update_leaves_package_pending', async () => {
  const p = await fixture(roots); const next = await bootstrap(p, { action: 'start' }); const snap = await readSnapshot(p);
  await applyUpdate(p, { expected: snap.fingerprints, upserts: [{ ...snap.features[0]!, summary: 'Saved before interruption' }], deletes: [], verifiedReferences: [{ path: 'source.ts', hash: hash('source') }] });
  const status = await bootstrap(p, { action: 'status' }); expect(status.package!.id).toBe(next.package!.id);
  expect(status.state!.files.find(f => f.path === 'source.ts')?.status).toBe('pending');
  await expect(bootstrap(p, ack(next, snap.revision, { alpha: snap.fingerprints['network-spec/alpha.yaml']! }))).rejects.toMatchObject({ code: 'conflict' });
}, 20000);
test('resume_requeues_changed_and_new_files', async () => {
  const p = await fixture(roots); const next = await bootstrap(p, { action: 'start' }); const snap = await readSnapshot(p);
  await bootstrap(p, ack(next, snap.revision, { alpha: snap.fingerprints['network-spec/alpha.yaml']! }));
  await writeFile(join(p.root, 'source.ts'), 'changed'); await writeFile(join(p.root, 'new.ts'), 'new');
  const resumed = await bootstrap(p, { action: 'next' });
  expect(resumed.package!.slices.map(s => s.path)).toEqual(['new.ts', 'source.ts']);
}, 20000);
test('completion_requires_cross_area_review_and_stays_partial', async () => {
  const p = await fixture(roots); const next = await bootstrap(p, { action: 'start' }); const snap = await readSnapshot(p);
  const done = await bootstrap(p, ack(next, snap.revision, { alpha: snap.fingerprints['network-spec/alpha.yaml']! }));
  expect(done.status).toBe('awaiting_relational_review');
  const complete = await bootstrap(p, { action: 'checkpoint', expectedRunRevision: done.runRevision!, packageId: null, sources: [], results: [], featureFingerprints: { alpha: snap.fingerprints['network-spec/alpha.yaml']! }, networkRevision: snap.revision, relationalReviewComplete: true, reason: 'Reviewed all captured areas and relationships' });
  expect(complete).toMatchObject({ status: 'completed', coverage: 'partial' });
  expect(await readFile(p.markerPath, 'utf8')).toContain('coverage: partial');
}, 20000);
test('empty_project_creates_no_fake_feature', async () => {
  const root = await tree(); roots.push(root); await repo(root); const p = await openProject(root);
  const result = await bootstrap(p, { action: 'start' }); expect(result.package).toBeNull();
  await expect(readFile(p.markerPath)).rejects.toMatchObject({ code: 'ENOENT' }); expect((await readSnapshot(p)).features).toEqual([]);
});
test('lost_cache_preserves_existing_features', async () => {
  const p = await fixture(roots); const original = await readFile(join(p.networkDir, 'alpha.yaml'));
  await bootstrap(p, { action: 'start' }); await rm(p.runtimeDir, { recursive: true }); await bootstrap(p, { action: 'start' });
  expect(await readFile(join(p.networkDir, 'alpha.yaml'))).toEqual(original);
});
test('branch_switch_requires_reconciliation', async () => {
  const p = await fixture(roots); await bootstrap(p, { action: 'start' }); await exec('git', ['-C', p.root, 'checkout', '-qb', 'alternate']);
  expect((await bootstrap(p, { action: 'next' })).status).toBe('reconciliation_required');
  expect((await bootstrap(p, { action: 'start', reconcile: true })).status).toBe('pending');
}, 20000);
test('deleted_mapped_source_is_needs_review_and_invalid_marker_blocks', async () => {
  const p = await fixture(roots); await bootstrap(p, { action: 'start' }); await rm(join(p.root, 'source.ts'));
  expect((await bootstrap(p, { action: 'next' })).state!.files.find(f => f.path === 'source.ts')?.status).toBe('needs_review');
  await writeFile(p.markerPath, 'broken: yes'); expect((await bootstrap(p, { action: 'status' })).status).toBe('invalid_network');
}, 20000);
test('status_does_not_modify_checkpoint_or_recover_journal', async () => {
  const p = await fixture(roots); await bootstrap(p, { action: 'start' }); const before = await readRuntime(p, 'bootstrap/run');
  await writeFile(join(p.runtimeDir, 'journal.json'), 'invalid journal');
  expect((await bootstrap(p, { action: 'status' })).status).toBe('pending_recovery');
  expect(await readRuntime(p, 'bootstrap/run')).toEqual(before);
});
test('source_hash_or_saved_feature_fingerprint_conflicts_keep_package_pending', async () => {
  const p = await fixture(roots); const next = await bootstrap(p, { action: 'start' }); const snap = await readSnapshot(p);
  await expect(bootstrap(p, ack(next, snap.revision, { alpha: '0'.repeat(64) }))).rejects.toMatchObject({ code: 'conflict' });
  await writeFile(join(p.root, 'source.ts'), 'changed');
  await expect(bootstrap(p, ack(next, snap.revision, { alpha: snap.fingerprints['network-spec/alpha.yaml']! }))).rejects.toMatchObject({ code: 'conflict' });
  expect((await bootstrap(p, { action: 'status' })).runRevision).toBe(next.runRevision);
}, 20000);
test('corrupt_runtime_cannot_claim_completion', async () => {
  const p = await fixture(roots); await writeRuntime(p, 'bootstrap/run', null, { relationalReviewComplete: true, files: [] });
  expect((await bootstrap(p, { action: 'status' })).status).toBe('invalid_checkpoint');
});
test('deleted_unmapped_source_is_resolved_without_invented_hash', async () => {
  const p = await fixture(roots); await writeFile(join(p.root, 'unmapped-source.ts'), 'aux'); await exec('git', ['-C', p.root, 'add', 'unmapped-source.ts']);
  await bootstrap(p, { action: 'start' }); await rm(join(p.root, 'unmapped-source.ts'));
  const result = await bootstrap(p, { action: 'next' });
  expect(result.state!.files.find(f => f.path === 'unmapped-source.ts')).toMatchObject({ hash: null, status: 'excluded', reason: 'deleted' });
});
test('mapped_source_cannot_be_acknowledged_without_its_saved_feature', async () => {
  const p = await fixture(roots); const next = await bootstrap(p, { action: 'start' }); const snap = await readSnapshot(p);
  await expect(bootstrap(p, ack(next, snap.revision))).rejects.toMatchObject({ code: 'conflict' });
});
test('adding_a_feature_to_analyzed_source_requeues_semantic_mapping', async () => {
  const p = await fixture(roots); const next = await bootstrap(p, { action: 'start' }); const snap = await readSnapshot(p);
  await bootstrap(p, ack(next, snap.revision, { alpha: snap.fingerprints['network-spec/alpha.yaml']! }));
  await applyUpdate(p, { expected: { 'network-spec/beta.yaml': null }, upserts: [{ ...snap.features[0]!, id: 'beta' }], deletes: [], verifiedReferences: [{ path: 'source.ts', hash: hash('source') }] });
  expect((await bootstrap(p, { action: 'next' })).package?.slices.map(s => s.path)).toEqual(['source.ts']);
}, 20000);
test('scope_and_small_package_limits_survive_resume', async () => {
  const p = await fixture(roots); await writeFile(join(p.root, 'other.ts'), 'not selected'); await writeFile(join(p.root, 'source.ts'), '😀'.repeat(100));
  const first = await bootstrap(p, { action: 'start', scope: ['source.ts'], maxBytes: 80, maxFiles: 1 });
  expect(first.package!.plannedBytes).toBe(80);
  const resumed = await bootstrap(p, { action: 'next' }); expect(resumed.package).toEqual(first.package);
  expect(resumed.state!.files.find(f => f.path === 'other.ts')?.status).toBe('excluded');
});
test('guarded_runtime_publication_checks_under_the_writer_lock', async () => {
  const p = await fixture(roots); const initial = await bootstrap(p, { action: 'start' });
  await expect(writeRuntime(p, 'bootstrap/run', initial.runRevision, initial.state, {}, async () => { throw new Error('guard rejected'); })).rejects.toThrow('guard rejected');
  expect((await bootstrap(p, { action: 'status' })).runRevision).toBe(initial.runRevision);
});
test('unicode_multipart_acknowledgements_do_not_repeat_completed_slices', async () => {
  const p = await fixture(roots); await writeFile(join(p.root, 'source.ts'), '😀'.repeat(40000));
  let next = await bootstrap(p, { action: 'start' }); const snap = await readSnapshot(p); const starts: number[] = [];
  for (let count = 0; count < 3; count++) {
    starts.push(next.package!.slices[0]!.startByte);
    await bootstrap(p, ack(next, snap.revision, { alpha: snap.fingerprints['network-spec/alpha.yaml']! }));
    next = await bootstrap(p, { action: 'next' });
  }
  expect(starts).toEqual([0, 65536, 131072]); expect(next.package).toBeNull();
  expect(next.state!.counters).toEqual({ packages: 3, bytes: 160000 });
}, 20000);
test('new_file_during_final_ack_blocks_relational_completion', async () => {
  const p = await fixture(roots); const first = await bootstrap(p, { action: 'start' }); const snap = await readSnapshot(p);
  await writeFile(join(p.root, 'new.ts'), 'new');
  await expect(bootstrap(p, { ...ack(first, snap.revision, { alpha: snap.fingerprints['network-spec/alpha.yaml']! }), relationalReviewComplete: true, reason: 'Reviewed all' })).rejects.toMatchObject({ code: 'conflict' });
  expect((await bootstrap(p, { action: 'status' })).runRevision).toBe(first.runRevision);
});
test('status_reports_invalid_network_when_a_completed_reference_disappears', async () => {
  const p = await fixture(roots); const first = await bootstrap(p, { action: 'start' }); const snap = await readSnapshot(p);
  await bootstrap(p, { ...ack(first, snap.revision, { alpha: snap.fingerprints['network-spec/alpha.yaml']! }), relationalReviewComplete: true, reason: 'Reviewed all' });
  await rm(join(p.root, 'source.ts'));
  expect((await bootstrap(p, { action: 'status' })).status).toBe('invalid_network');
});
test('stored_runtime_key_order_is_used_for_cas_and_status_does_not_rewrite', async () => {
  const p = await fixture(roots); const first = await bootstrap(p, { action: 'start' }); const path = join(p.runtimeDir, 'values/bootstrap/run.json');
  const raw = Object.fromEntries(Object.entries(first.state!).reverse()); await writeFile(path, JSON.stringify(raw));
  const status = await bootstrap(p, { action: 'status' }); const before = await readFile(path);
  expect(status.runRevision).not.toBe(first.runRevision); expect(await readFile(path)).toEqual(before);
  const snap = await readSnapshot(p); expect((await bootstrap(p, ack(status, snap.revision, { alpha: snap.fingerprints['network-spec/alpha.yaml']! }))).status).toBe('awaiting_relational_review');
});
test('explicit_needs_review_slice_can_be_resolved_by_a_later_analysis', async () => {
  const p = await fixture(roots); const first = await bootstrap(p, { action: 'start' }); const snap = await readSnapshot(p);
  const request = ack(first, snap.revision, { alpha: snap.fingerprints['network-spec/alpha.yaml']! });
  await bootstrap(p, { ...request, results: request.results.map(r => ({ ...r, outcome: 'needs_review' as const })) });
  const retry = await bootstrap(p, { action: 'next' });
  const done = await bootstrap(p, ack(retry, snap.revision, { alpha: snap.fingerprints['network-spec/alpha.yaml']! }));
  expect(done.status).toBe('awaiting_relational_review');
}, 20000);
test('checkpoint_persists_per_slice_analysis_outcome_and_reason_without_source_copies', async () => {
  const p = await fixture(roots); const first = await bootstrap(p, { action: 'start' }); const snap = await readSnapshot(p);
  const saved = await bootstrap(p, ack(first, snap.revision, { alpha: snap.fingerprints['network-spec/alpha.yaml']! }));
  const file = saved.state!.files.find(f => f.path === 'source.ts')!;
  expect(file).toMatchObject({ sliceReviews: { '["source.ts",0,6]': { outcome: 'analyzed', reason: 'Reviewed actual source and saved feature mapping', featureIds: ['alpha'] } } });
});
test('empty_checkpoint_cannot_carry_completed_review_to_a_changed_network', async () => {
  const p = await fixture(roots);
  const initial = await bootstrap(p, { action: 'start' }); const before = await readSnapshot(p);
  const completed = await bootstrap(p, { ...ack(initial, before.revision, { alpha: before.fingerprints['network-spec/alpha.yaml']! }), relationalReviewComplete: true, reason: 'Reviewed all original relationships' });
  expect(completed.status).toBe('completed');
  const featurePath = join(p.networkDir, 'alpha.yaml');
  const changedBytes = (await readFile(featurePath, 'utf8')).replace('summary: Source', 'summary: Manually revised source');
  await writeFile(featurePath, changedBytes);
  const changed = await readSnapshot(p); expect(changed.integrity).toBe('valid'); expect(changed.revision).not.toBe(before.revision);
  const checkpointBefore = await readRuntime(p, 'bootstrap/run');
  await expect(bootstrap(p, { action: 'checkpoint', expectedRunRevision: completed.runRevision!, packageId: null, networkRevision: changed.revision, sources: [], results: [], featureFingerprints: {} })).rejects.toMatchObject({ code: 'invalid_checkpoint' });
  expect(await readRuntime(p, 'bootstrap/run')).toEqual(checkpointBefore);
  expect(await readFile(featurePath, 'utf8')).toBe(changedBytes);
  expect((await bootstrap(p, { action: 'status' })).state?.networkRevision).toBe(before.revision);
  const renewed = await bootstrap(p, { action: 'checkpoint', expectedRunRevision: completed.runRevision!, packageId: null, networkRevision: changed.revision, sources: [], results: [], featureFingerprints: { alpha: changed.fingerprints['network-spec/alpha.yaml']! }, relationalReviewComplete: true, reason: 'Re-read manually revised feature and checked all cross-area relationships against unchanged sources' });
  expect(renewed).toMatchObject({ status: 'completed', coverage: 'partial', state: { networkRevision: changed.revision, relationalReviewComplete: true } });
  expect(await readFile(featurePath, 'utf8')).toBe(changedBytes);
  const status = await bootstrap(p, { action: 'status' }); expect(status.runRevision).toBe(renewed.runRevision);
  expect((await bootstrap(p, { action: 'status' })).runRevision).toBe(status.runRevision);
}, 20000);

});

import { describe, afterEach, expect, test } from 'vitest';
import { readFile, writeFile, rm, symlink, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { inspectReference, confirmReferences } from '../../src/freshness/references.js';
import { readSnapshot } from '../../src/storage/repository.js';
import { readRuntime } from '../../src/storage/runtime.js';
import { fixture, hash } from './fixture.js';
import { cleanup } from '../project/helpers.js';

const roots: string[] = [];
afterEach(async () => { await Promise.all(roots.splice(0).map(cleanup)); });
// Real filesystem/Git/process integration: finite hosted-runner budget; unit defaults stay unchanged.
describe('repository integration', { timeout: 20000 }, () => {
test('unchanged_semantics_can_confirm_without_yaml_write', async () => {
  const p = await fixture(roots); const path = join(p.networkDir, 'alpha.yaml'); const bytes = await readFile(path);
  await writeFile(join(p.root, 'source.ts'), 'source // comment'); const snap = await readSnapshot(p);
  await confirmReferences(p, [{ path: 'source.ts', hash: hash('source // comment') }], { networkRevision: snap.revision, outcome: 'no_semantic_change', reason: 'Read source; only a comment changed' });
  expect(await readFile(path)).toEqual(bytes);
  expect(await readRuntime(p, 'baselines')).toMatchObject({ references: { 'source.ts': hash('source // comment') } });
});
test('source_changed_after_agent_read_remains_unconfirmed', async () => {
  const p = await fixture(roots); const before = await readRuntime(p, 'baselines'); const snap = await readSnapshot(p);
  await writeFile(join(p.root, 'source.ts'), 'later source');
  await expect(confirmReferences(p, [{ path: 'source.ts', hash: hash('source') }], { networkRevision: snap.revision, outcome: 'updated', reason: 'Reviewed source' })).rejects.toMatchObject({ code: 'conflict' });
  expect(await readRuntime(p, 'baselines')).toEqual(before);
});
test('confirmation_requires_reason_and_agent_network_revision', async () => {
  const p = await fixture(roots); const snap = await readSnapshot(p); const refs = [{ path: 'source.ts', hash: hash('source') }];
  await expect(confirmReferences(p, refs, { networkRevision: snap.revision, outcome: 'no_semantic_change', reason: ' ' })).rejects.toMatchObject({ code: 'invalid_decision' });
  await writeFile(join(p.networkDir, 'alpha.yaml'), (await readFile(join(p.networkDir, 'alpha.yaml'), 'utf8')) + '# concurrent\n');
  await expect(confirmReferences(p, refs, { networkRevision: snap.revision, outcome: 'updated', reason: 'Reviewed earlier revision' })).rejects.toMatchObject({ code: 'conflict' });
});
test('missing_and_excluded_references_are_distinct_and_aliases_are_blocked', async () => {
  const p = await fixture(roots); await rm(join(p.root, 'source.ts'));
  expect(await inspectReference(p, 'source.ts')).toMatchObject({ state: 'missing', hash: null });
  await symlink('.git/config', join(p.root, 'alias.ts'));
  expect(await inspectReference(p, 'alias.ts')).toMatchObject({ state: 'unknown', diagnostic: { code: 'unsafe_reference' } });
  await mkdir(join(p.root, 'plugin')); await writeFile(join(p.root, 'plugin/core.ts'), 'plugin'); await symlink('plugin/core.ts', join(p.root, 'plugin-alias.ts'));
  expect(await inspectReference(p, 'plugin-alias.ts', { excludedReferenceRoots: [join(p.root, 'plugin')] })).toMatchObject({ state: 'unknown', diagnostic: { code: 'unsafe_reference' } });
});

test('review_for_unchanged_feature_survives_targeted_sync_of_another_feature', async () => {
  const { applyUpdate } = await import('../../src/storage/repository.js');
  const { checkNetwork } = await import('../../src/freshness/check.js');
  const p = await fixture(roots); const initial = await readSnapshot(p);
  await confirmReferences(p, [{ path: 'source.ts', hash: hash('source') }], { networkRevision: initial.revision, outcome: 'updated', reason: 'Reviewed alpha and source' });
  await writeFile(join(p.root, 'other.ts'), 'other'); const beta = { ...initial.features[0]!, id: 'beta', code: [{ path: 'other.ts' }] };
  const current = await readSnapshot(p);
  await applyUpdate(p, { expected: { ...current.fingerprints, 'network-spec/beta.yaml': null }, upserts: [beta], deletes: [], verifiedReferences: [{ path: 'other.ts', hash: hash('other') }] });
  const result = await checkNetwork(p, 'full');
  expect(result.openDecisions.some(d => d.path === 'source.ts')).toBe(false);
  expect(result.openDecisions).toContainEqual(expect.objectContaining({ path: 'other.ts', reason: 'decision_missing' }));
});
test('baseline_without_new_reason_after_feature_update_remains_open', async () => {
  const { applyUpdate } = await import('../../src/storage/repository.js');
  const { checkNetwork } = await import('../../src/freshness/check.js');
  const p = await fixture(roots); const initial = await readSnapshot(p);
  await confirmReferences(p, [{ path: 'source.ts', hash: hash('source') }], { networkRevision: initial.revision, outcome: 'updated', reason: 'Reviewed initial feature' });
  await applyUpdate(p, { expected: initial.fingerprints, upserts: [{ ...initial.features[0]!, summary: 'Changed description' }], deletes: [], verifiedReferences: [{ path: 'source.ts', hash: hash('source') }] });
  expect((await checkNetwork(p, 'full')).openDecisions).toContainEqual(expect.objectContaining({ path: 'source.ts', reason: 'decision_missing' }));
});

test('unmapped_no_semantic_change_is_hash_and_revision_bound_and_never_becomes_coverage', async () => {
  const { applyUpdate } = await import('../../src/storage/repository.js');
  const { checkNetwork } = await import('../../src/freshness/check.js');
  const p = await fixture(roots); await writeFile(join(p.root, 'notes.md'), 'notes'); const snap = await readSnapshot(p);
  await expect(confirmReferences(p, [{ path: 'notes.md', hash: hash('notes') }], { networkRevision: snap.revision, outcome: 'updated', reason: 'Reviewed notes' })).rejects.toMatchObject({ code: 'invalid_decision' });
  const baseline = await readRuntime(p, 'baselines');
  await confirmReferences(p, [{ path: 'notes.md', hash: hash('notes') }], { networkRevision: snap.revision, outcome: 'no_semantic_change', reason: 'Notes have no product behavior' });
  const stored = await readRuntime(p, 'freshness/decisions');
  for (let count = 0; count < 2; count++) {
    const result = await checkNetwork(p, 'full'); expect(result.unknownChanges).toEqual(['notes.md']);
    expect(result.unknownChangeDecisions).toEqual([{ path: 'notes.md', state: 'no_semantic_change' }]);
    expect(result.openDecisions.some(d => d.path === 'notes.md')).toBe(false);
  }
  expect(await readRuntime(p, 'baselines')).toEqual(baseline); expect(await readRuntime(p, 'freshness/decisions')).toEqual(stored);
  await writeFile(join(p.root, 'notes.md'), 'changed notes');
  expect((await checkNetwork(p, 'full')).openDecisions).toContainEqual(expect.objectContaining({ path: 'notes.md', reason: 'unmapped' }));
  await confirmReferences(p, [{ path: 'notes.md', hash: hash('changed notes') }], { networkRevision: snap.revision, outcome: 'no_semantic_change', reason: 'Reviewed changed notes' });
  const feature = { ...snap.features[0]!, code: [...snap.features[0]!.code, { path: 'notes.md' }] };
  await applyUpdate(p, { expected: snap.fingerprints, upserts: [feature], deletes: [], verifiedReferences: [{ path: 'source.ts', hash: hash('source') }, { path: 'notes.md', hash: hash('changed notes') }] });
  const mapped = await checkNetwork(p, 'full'); expect(mapped.unknownChanges).toEqual([]);
  expect(mapped.openDecisions).toContainEqual(expect.objectContaining({ path: 'notes.md', reason: 'decision_missing' }));
});
test('automatic_dirty_and_unmapped_observations_do_not_hash_secret_names_or_aliases', async () => {
  const { startTurn } = await import('../../src/freshness/session.js');
  const p = await fixture(roots); await writeFile(join(p.root, '.env'), 'LOCAL_TEST_ONLY=fixture'); await symlink('.env', join(p.root, 'secret-alias.ts'));
  const turn = await startTurn(p, 's'); expect(turn.observed['.env']).toBeNull(); expect(turn.observed['secret-alias.ts']).toBeNull();
  expect(turn.diagnostics).toContainEqual(expect.objectContaining({ code: 'sensitive_reference', path: '.env' }));
  const snap = await readSnapshot(p);
  await expect(confirmReferences(p, [{ path: '.env', hash: hash('LOCAL_TEST_ONLY=fixture') }], { networkRevision: snap.revision, outcome: 'no_semantic_change', reason: 'Unsafe source' })).rejects.toMatchObject({ code: 'sensitive_reference' });
});

test('tracked_unmapped_deletion_can_be_acknowledged_without_hash_and_recreation_reopens', async () => {
  const { commit } = await import('./fixture.js'); const { checkNetwork } = await import('../../src/freshness/check.js');
  const p = await fixture(roots); await writeFile(join(p.root, 'notes.md'), 'notes'); await commit(p.root); await rm(join(p.root, 'notes.md'));
  const snapshot = await readSnapshot(p); const before = await readRuntime(p, 'baselines'); const yaml = await readFile(join(p.networkDir, 'alpha.yaml'));
  await confirmReferences(p, [{ path: 'notes.md', state: 'missing' }], { networkRevision: snapshot.revision, outcome: 'no_semantic_change', reason: 'Reviewed deletion of notes; no product behavior changed' });
  const decisions = await readRuntime<any>(p, 'freshness/decisions');
  expect(decisions.references['notes.md']).toMatchObject({ state: 'missing', featureFingerprints: {} });
  expect(Object.hasOwn(decisions.references['notes.md'], 'hash')).toBe(false);
  for (let run = 0; run < 2; run++) {
    const result = await checkNetwork(p, 'full'); expect(result.unknownChanges).toEqual(['notes.md']);
    expect(result.unknownChangeDecisions).toEqual([{ path: 'notes.md', state: 'missing_no_semantic_change' }]);
    expect(result.openDecisions.some(d => d.path === 'notes.md')).toBe(false);
  }
  expect(await readRuntime(p, 'baselines')).toEqual(before); expect(await readFile(join(p.networkDir, 'alpha.yaml'))).toEqual(yaml);
  expect(await readRuntime(p, 'freshness/decisions')).toEqual(decisions);
  await writeFile(join(p.root, 'notes.md'), 'restored differently');
  const reopened = await checkNetwork(p, 'full'); expect(reopened.unknownChangeDecisions).toEqual([{ path: 'notes.md', state: 'open' }]);
  expect(reopened.openDecisions).toContainEqual(expect.objectContaining({ path: 'notes.md', reason: 'unmapped' }));
  await writeFile(join(p.root, 'notes.md'), 'notes'); // Original tracked bytes: Git is clean again.
  const cleanGitRestore = await checkNetwork(p, 'full');
  expect(cleanGitRestore.unknownChanges).toEqual(['notes.md']);
  expect(cleanGitRestore.unknownChangeDecisions).toEqual([{ path: 'notes.md', state: 'open' }]);
  await rm(join(p.root, 'notes.md')); await symlink('still-missing.md', join(p.root, 'notes.md'));
  expect((await checkNetwork(p, 'full')).unknownChangeDecisions).toEqual([{ path: 'notes.md', state: 'open' }]);
});
test('missing_acknowledgement_rejects_recreation_before_confirmation_without_writes', async () => {
  const p = await fixture(roots); const snapshot = await readSnapshot(p); const baseline = await readRuntime(p, 'baselines');
  await writeFile(join(p.root, 'notes.md'), 'recreated before confirm');
  await expect(confirmReferences(p, [{ path: 'notes.md', state: 'missing' }], { networkRevision: snapshot.revision, outcome: 'no_semantic_change', reason: 'Read absence earlier' })).rejects.toMatchObject({ code: 'conflict' });
  expect(await readRuntime(p, 'baselines')).toEqual(baseline); expect(await readRuntime(p, 'freshness/decisions')).toBeNull();
});
test('missing_acknowledgements_reject_mapped_secrets_install_aliases_and_dangling_links', async () => {
  const p = await fixture(roots); const snapshot = await readSnapshot(p); const decision = { networkRevision: snapshot.revision, outcome: 'no_semantic_change' as const, reason: 'Checked absent path' };
  await mkdir(join(p.root, 'plugin')); await symlink('plugin', join(p.root, 'plugin-alias')); await symlink('missing.ts', join(p.root, 'dangling.ts'));
  for (const path of ['.env', '../outside.ts', '.git/no-file', 'network-spec/no-file', '.feature-network/no-file', 'dist/no-file', 'plugin-alias/no-file', 'dangling.ts']) {
    await expect(confirmReferences(p, [{ path, state: 'missing' }], decision, { excludedReferenceRoots: [join(p.root, 'plugin')] })).rejects.toBeDefined();
  }
  await expect(confirmReferences(p, [{ path: 'notes.md', state: 'missing' }], { ...decision, outcome: 'updated' })).rejects.toMatchObject({ code: 'invalid_decision' });
  await rm(join(p.root, 'source.ts'));
  await expect(confirmReferences(p, [{ path: 'source.ts', state: 'missing' }], decision)).rejects.toBeDefined();
  expect(await readRuntime(p, 'freshness/decisions')).toBeNull();
});

});

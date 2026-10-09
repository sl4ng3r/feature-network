import { afterEach, expect, test } from 'vitest';
import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { cleanup } from '../../tests/project/helpers.js';
import { buildIndex } from '../../src/query/index.js';
import { queryImpact } from '../../src/query/impact.js';
import { applyUpdate } from '../../src/storage/repository.js';
import { confirmReferences } from '../../src/freshness/references.js';
import { checkNetwork } from '../../src/freshness/check.js';
import { demoProject, readSnapshot, coverageGaps, sourceHashes } from './helpers.js';
const roots: string[] = []; afterEach(async () => { await Promise.all(roots.splice(0).map(cleanup)); });
const fields = ['id', 'displayName', 'locale']; const check = 'Roundtrip id, displayName, locale through SQLite backup and restore.';
test('profile_impact_includes_backup_and_restore', async () => {
  const project = await demoProject(roots); const snap = await readSnapshot(project); expect(snap.integrity).toBe('valid');
  const result = queryImpact(buildIndex(snap), { ids: ['user-profile'] });
  expect(new Set(result.items.map(i => i.id))).toEqual(new Set(['user-profile', 'backup', 'restore']));
  expect(result.items.every(i => 'status' in i && i.status === 'evidenced')).toBe(true); expect(coverageGaps(snap, fields, check)).toEqual([]);
});
test('removed_field_is_no_longer_promised', async () => {
  const project = await demoProject(roots); const before = await readSnapshot(project);
  const changedFields = ['id']; const changedCheck = 'Roundtrip id through SQLite backup and restore.';
  // Explicit synthetic contract removal supplied by the agent, not inferred from code.
  const updated = before.features.map(f => ({ ...f, key_points: f.key_points.map(p => p.startsWith('Persistent fields:') ? 'Persistent fields: id.' : p), relations: f.relations.map(r => ({ ...r, check: changedCheck })) }));
  await applyUpdate(project, { expected: before.fingerprints, expectedRevision: before.revision, upserts: updated, deletes: [], verifiedReferences: await sourceHashes(project.root, before) });
  const after = await readSnapshot(project); expect(coverageGaps(after, changedFields, changedCheck)).toEqual([]);
  expect(after.features.every(f => !f.key_points.some(p => p.includes('displayName')))).toBe(true);
  expect(coverageGaps(before, changedFields, changedCheck)).not.toEqual([]);
});
test('contract_change_marks_restore_for_review', async () => {
  const project = await demoProject(roots); const snap = await readSnapshot(project);
  await confirmReferences(project, await sourceHashes(project.root, snap), { networkRevision: snap.revision, outcome: 'no_semantic_change', reason: 'Synthetic protocol review of the explicitly supplied contract and source references.' });
  expect((await checkNetwork(project, 'full')).openDecisions).toEqual([]);
  const path = join(project.root, 'src/profile.ts'); await writeFile(path, `${await readFile(path, 'utf8')}\n// Synthetic changed Sollcontract: timezone must roundtrip.\n`);
  const changed = await checkNetwork(project, 'full');
  expect(changed.openDecisions.some(d => d.path === 'src/profile.ts' && d.reason === 'changed' && d.featureIds.includes('restore'))).toBe(true);
  expect(queryImpact(buildIndex(snap), { ids: ['user-profile'] }).items.map(i => i.id)).toContain('restore');
  expect(coverageGaps(snap, [...fields, 'timezone'], 'Roundtrip id, displayName, locale, timezone through SQLite backup and restore.')).not.toEqual([]);
}, 20000);
test('stale_or_missing_relation_is_reported_as_coverage_gap', async () => {
  const project = await demoProject(roots); const snap = await readSnapshot(project);
  const stale = structuredClone(snap); stale.features.find(f => f.id === 'restore')!.relations.forEach(r => { r.check = 'Outdated displayName-only expectation.'; });
  expect(coverageGaps(stale, fields, check)).toContain('restore->backup: relation');
  const missing = structuredClone(snap); missing.features.find(f => f.id === 'restore')!.relations = [];
  expect(coverageGaps(missing, fields, check)).toContain('restore: unreachable');
  // Structurally valid snapshots alone do not establish semantic coverage.
  expect(missing.integrity).toBe('valid');
});

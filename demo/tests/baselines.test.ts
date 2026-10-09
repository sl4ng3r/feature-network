import { afterEach, expect, test } from 'vitest';
import { DatabaseSync } from 'node:sqlite';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import * as beforeProfile from '../scenarios/pre-locale/src/profile.js';
import * as beforeBackup from '../scenarios/pre-locale/src/backup.js';
import * as beforeRestore from '../scenarios/pre-locale/src/restore.js';
import * as emptyProfile from '../scenarios/empty-network/src/profile.js';
import * as emptyBackup from '../scenarios/empty-network/src/backup.js';
import * as emptyRestore from '../scenarios/empty-network/src/restore.js';
import { tree, cleanup } from '../../tests/project/helpers.js';
import { coverageGaps, demoProject, readSnapshot } from './helpers.js';
const roots: string[] = []; const databases: DatabaseSync[] = [];
afterEach(async () => { databases.splice(0).forEach(db => db.close()); await Promise.all(roots.splice(0).map(cleanup)); });
for (const [name, profile, backup, restore] of [['pre-locale', beforeProfile, beforeBackup, beforeRestore], ['empty-network', emptyProfile, emptyBackup, emptyRestore]] as const) {
  test(`${name}_is_an_executable_pre_extension_sqlite_baseline`, async () => {
    const root = await tree(); roots.push(root); const source = profile.openProfileDb(join(root, 'source.sqlite')); const target = profile.openProfileDb(join(root, 'target.sqlite')); databases.push(source, target);
    profile.saveProfile(source, { id: 'synthetic-before', displayName: 'Baseline Ada', sessionHint: 'transient' });
    const saved = backup.createBackup(source); expect(saved).toEqual({ formatVersion: 1, schemaVersion: 1, profiles: [{ id: 'synthetic-before', displayName: 'Baseline Ada' }] });
    restore.restoreBackup(target, JSON.parse(JSON.stringify(saved)));
    expect({ ...target.prepare('SELECT * FROM profiles').get() }).toEqual({ id: 'synthetic-before', displayName: 'Baseline Ada' });
    expect(target.prepare('PRAGMA table_info(profiles)').all().map(r => r.name)).not.toContain('locale');
  });
}
test('initialization_and_extension_baselines_share_identical_source_bytes', async () => {
  for (const name of ['profile', 'backup', 'restore', 'migrations']) expect(await readFile(`demo/scenarios/empty-network/src/${name}.ts`)).toEqual(await readFile(`demo/scenarios/pre-locale/src/${name}.ts`));
  const before = await demoProject(roots, 'pre-locale'); const snap = await readSnapshot(before);
  expect(snap.integrity).toBe('valid'); expect(coverageGaps(snap, ['id', 'displayName'], 'Roundtrip id, displayName through SQLite backup and restore.')).toEqual([]);
  expect(coverageGaps(snap, ['id', 'displayName', 'locale'], 'Roundtrip id, displayName, locale through SQLite backup and restore.')).not.toEqual([]);
});

import { describe, afterEach, expect, test } from 'vitest';
import { DatabaseSync } from 'node:sqlite';
import { join } from 'node:path';
import { tree, cleanup } from '../../tests/project/helpers.js';
import { openProfileDb, saveProfile } from '../src/profile.js';
import { createBackup } from '../src/backup.js';
import { restoreBackup } from '../src/restore.js';

const roots: string[] = []; const databases: DatabaseSync[] = [];
afterEach(async () => { databases.splice(0).forEach(db => db.close()); await Promise.all(roots.splice(0).map(cleanup)); });
async function database(name = 'profile.sqlite') { const root = await tree(); roots.push(root); const db = openProfileDb(join(root, name)); databases.push(db); return { db, path: join(root, name) }; }
function rows(db: DatabaseSync) { return db.prepare('SELECT * FROM profiles ORDER BY id').all().map(row => ({ ...row })); }
// Real filesystem/Git/process integration: finite hosted-runner budget; unit defaults stay unchanged.
describe('repository integration', { timeout: 20000 }, () => {
test('persistent_profile_roundtrip', async () => {
  const source = await database(); saveProfile(source.db, { id: 'synthetic-1', displayName: 'Demo Ada' });
  const backup = JSON.parse(JSON.stringify(createBackup(source.db))); expect(backup).toMatchObject({ formatVersion: 1, schemaVersion: 2 });
  const target = await database(); saveProfile(target.db, { id: 'old', displayName: 'Replaced' }); restoreBackup(target.db, backup);
  expect(rows(target.db)).toEqual([{ id: 'synthetic-1', displayName: 'Demo Ada', locale: 'en-US' }]);
  target.db.close(); databases.splice(databases.indexOf(target.db), 1); const reopened = openProfileDb(target.path); databases.push(reopened);
  expect(rows(reopened)).toEqual(rows(source.db));
});
test('session_hint_is_excluded', async () => {
  const { db } = await database(); saveProfile(db, { id: 'synthetic-1', displayName: 'Demo Ada', sessionHint: 'transient-only' });
  expect(rows(db)[0]).not.toHaveProperty('sessionHint'); expect(db.prepare('PRAGMA table_info(profiles)').all().map(r => r.name)).not.toContain('sessionHint');
  expect(JSON.stringify(createBackup(db))).not.toContain('transient-only');
});
test('migration_preserves_existing_profile', async () => {
  const root = await tree(); roots.push(root); const path = join(root, 'old.sqlite'); const old = new DatabaseSync(path);
  old.exec("CREATE TABLE profiles (id TEXT PRIMARY KEY NOT NULL, displayName TEXT NOT NULL) STRICT; PRAGMA user_version = 1;");
  old.prepare('INSERT INTO profiles VALUES (?, ?)').run('synthetic-old', 'Existing'); old.close();
  const db = openProfileDb(path); databases.push(db); expect(rows(db)[0]).toMatchObject({ id: 'synthetic-old', displayName: 'Existing' });
  expect(db.prepare('PRAGMA user_version').get()?.user_version).toBe(2);
  expect(rows(db)[0]?.locale).toBe('en-US');
});
test('invalid_restore_rolls_back', async () => {
  const { db } = await database(); saveProfile(db, { id: 'keep', displayName: 'Keep Me' }); const before = rows(db);
  // Duplicate IDs fail after DELETE and the first INSERT: this proves real transaction rollback.
  const duplicate = { formatVersion: 1, schemaVersion: 2, profiles: [{ id: 'duplicate', displayName: 'First', locale: 'en-US' }, { id: 'duplicate', displayName: 'Second', locale: 'de-DE' }] };
  expect(() => restoreBackup(db, duplicate)).toThrow('UNIQUE constraint failed'); expect(rows(db)).toEqual(before);
  for (const invalid of [{ ...duplicate, formatVersion: 99 }, { ...duplicate, profiles: [{ id: 'x' }] }, { ...duplicate, sessionHint: 'reject' }, { ...duplicate, schemaVersion: 1 }, { ...duplicate, profiles: [{ id: 'x', displayName: 'Synthetic', locale: 'de-DE', sessionHint: 'reject' }] }]) {
    expect(() => restoreBackup(db, invalid)).toThrow(); expect(rows(db)).toEqual(before);
  }
});

test('persistent_locale_roundtrip_reads_real_sqlite_rows', async () => {
  const source = await database(); saveProfile(source.db, { id: 'synthetic-locale', displayName: 'Demo Ada', locale: 'de-DE', sessionHint: 'discard-me' });
  expect(rows(source.db)[0]?.locale).toBe('de-DE');
  const serialized = JSON.parse(JSON.stringify(createBackup(source.db)));
  expect(serialized).toMatchObject({ formatVersion: 1, schemaVersion: 2, profiles: [{ id: 'synthetic-locale', displayName: 'Demo Ada', locale: 'de-DE' }] });
  const target = await database(); restoreBackup(target.db, serialized);
  expect(target.db.prepare('SELECT locale FROM profiles WHERE id = ?').get('synthetic-locale')?.locale).toBe('de-DE');
  expect(rows(target.db)).toEqual(rows(source.db));
});

test('unsupported_schema_is_rejected_without_data_changes', async () => {
  const root = await tree(); roots.push(root); const path = join(root, 'future.sqlite'); const future = new DatabaseSync(path);
  future.exec("CREATE TABLE sentinel (value TEXT); INSERT INTO sentinel VALUES ('synthetic keep'); PRAGMA user_version = 99;"); future.close();
  expect(() => openProfileDb(path)).toThrow('Unsupported profile schema version');
  const untouched = new DatabaseSync(path); databases.push(untouched);
  expect(untouched.prepare('SELECT value FROM sentinel').get()?.value).toBe('synthetic keep');
  expect(untouched.prepare('PRAGMA user_version').get()?.user_version).toBe(99);
});

});

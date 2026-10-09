// Positive control for the held-out oracle. Never copy this file into an agent fixture.
import { readFile, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';

const [appRaw, manifestRaw] = process.argv.slice(2);
if (!appRaw || !manifestRaw) throw new Error('usage: node known-good.mjs <app-directory> <external-manifest.json>');
const app = resolve(appRaw);
const manifest = JSON.parse(await readFile(resolve(manifestRaw), 'utf8'));
await writeFile(join(app, 'src/profile.mjs'), `import { DatabaseSync } from 'node:sqlite';

export function openDb(path) {
  const db = new DatabaseSync(path, { timeout: 2000 });
  const version = db.prepare('PRAGMA user_version').get().user_version;
  if (version < 0 || version > 2) { db.close(); throw new Error('Unsupported schema version'); }
  db.exec('BEGIN IMMEDIATE');
  try {
    if (version === 0) db.exec("CREATE TABLE profiles (id TEXT PRIMARY KEY NOT NULL, name TEXT NOT NULL, locale TEXT NOT NULL DEFAULT 'en-US') STRICT;");
    if (version === 1) db.exec("ALTER TABLE profiles ADD COLUMN locale TEXT NOT NULL DEFAULT 'en-US';");
    if (version < 2) db.exec('PRAGMA user_version = 2;');
    db.exec('COMMIT');
  } catch (error) { db.exec('ROLLBACK'); db.close(); throw error; }
  return db;
}

export function saveProfile(db, profile) {
  const locale = profile.locale ?? 'en-US';
  if (typeof profile.id !== 'string' || !profile.id || typeof profile.name !== 'string' || !profile.name || typeof locale !== 'string' || !locale) throw new Error('Invalid profile');
  db.prepare('INSERT INTO profiles (id, name, locale) VALUES (?, ?, ?) ON CONFLICT(id) DO UPDATE SET name = excluded.name, locale = excluded.locale').run(profile.id, profile.name, locale);
}

export function loadProfile(db, id) {
  return db.prepare('SELECT id, name, locale FROM profiles WHERE id = ?').get(id) ?? null;
}
`);
for (const id of manifest.related) {
  await writeFile(join(app, 'src/stages', `${id}.mjs`), `export function projectRecord(record) {
  return { id: record.id, name: record.name, view: '${id}', locale: record.locale };
}
`);
}

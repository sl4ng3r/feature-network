// Positive control only. Never copy this implementation into an agent fixture.
import { readFile, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';

const [appRaw, manifestRaw] = process.argv.slice(2);
if (!appRaw || !manifestRaw) throw new Error('usage: node fanout-known-good.mjs <app-directory> <external-manifest.json>');
const app = resolve(appRaw);
const manifest = JSON.parse(await readFile(resolve(manifestRaw), 'utf8'));
await writeFile(join(app, 'src/profile.mjs'), `import { DatabaseSync } from 'node:sqlite';

export function openDb(path) {
  const db = new DatabaseSync(path, { timeout: 2000 });
  const version = db.prepare('PRAGMA user_version').get().user_version;
  if (version < 0 || version > 2) { db.close(); throw new Error('Unsupported schema version'); }
  if (version < 2) {
    db.exec('BEGIN IMMEDIATE');
    try {
      if (version === 0) db.exec("CREATE TABLE profiles (id TEXT PRIMARY KEY NOT NULL, name TEXT NOT NULL, locale TEXT NOT NULL DEFAULT 'en-US') STRICT;");
      if (version === 1) db.exec("ALTER TABLE profiles ADD COLUMN locale TEXT NOT NULL DEFAULT 'en-US';");
      db.exec('PRAGMA user_version = 2;');
      db.exec('COMMIT');
    } catch (error) { db.exec('ROLLBACK'); db.close(); throw error; }
  }
  return db;
}

export function saveProfile(db, record) {
  const locale = record.locale ?? 'en-US';
  if (typeof record.id !== 'string' || !record.id || typeof record.name !== 'string' || !record.name ||
      typeof locale !== 'string' || !locale) throw new Error('Invalid profile');
  db.prepare('INSERT INTO profiles (id, name, locale) VALUES (?, ?, ?) ON CONFLICT(id) DO UPDATE SET name = excluded.name, locale = excluded.locale').run(record.id, record.name, locale);
}

export function loadProfile(db, id) {
  return db.prepare('SELECT id, name, locale FROM profiles WHERE id = ?').get(id) ?? null;
}
`);
for (const { id, kind } of manifest.related) {
  let body;
  switch (kind) {
    case 'api': body = `return { id: record.id, name: record.name, locale: record.locale, contract: '${id}' };`; break;
    case 'backup': body = `const payload = JSON.stringify({ version: 1, profile: { id: record.id, name: record.name, locale: record.locale } });\n  return { payload, restored: JSON.parse(payload).profile };`; break;
    case 'csv': body = `const quote = value => '"' + String(value).replaceAll('"', '""') + '"';\n  return 'id,name,locale\\n' + [record.id, record.name, record.locale].map(quote).join(',') + '\\n';`; break;
    case 'message': body = `return record.locale === 'de-DE' ? 'Profil ' + record.name + ' gespeichert (de-DE)' : 'Profile ' + record.name + ' saved (en-US)';`; break;
    case 'audit': body = `return { actorId: record.id, action: 'profile_changed', locale: record.locale, contract: '${id}' };`; break;
    case 'notification': body = `return { recipientId: record.id, subject: record.locale === 'de-DE' ? 'Profil aktualisiert' : 'Profile updated', body: record.locale === 'de-DE' ? 'Aktualisiert: ' + record.name : 'Updated: ' + record.name, locale: record.locale, contract: '${id}' };`; break;
    case 'cache': body = `return 'profile:' + encodeURIComponent(record.id) + ':' + encodeURIComponent(record.locale);`; break;
    case 'digest': body = `return { headline: record.first, actorId: record.second.actorId, locale: record.second.locale, contract: '${id}' };`; break;
    case 'bundle': body = `return { backup: record.first.payload, csv: record.second, locale: record.first.restored.locale, contract: '${id}' };`; break;
    default: throw new Error('Unknown kind');
  }
  const backupRestore = kind === 'backup' ? `\nimport { saveProfile } from '../profile.mjs';\nexport function restoreBackup(db, payload) {\n  const parsed = JSON.parse(payload);\n  if (parsed.version !== 1) throw new Error('Unsupported backup version');\n  saveProfile(db, parsed.profile);\n}\n` : '';
  await writeFile(join(app, 'src/contracts', `${id}.mjs`), `export function run(record) {\n  ${body}\n}\n${backupRestore}`);
}

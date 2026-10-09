import type { DatabaseSync } from 'node:sqlite';
export const SCHEMA_VERSION = 2;
export function migrate(db: DatabaseSync): void {
  db.exec('BEGIN IMMEDIATE');
  try {
    const version = db.prepare('PRAGMA user_version').get()!.user_version as number;
    if (version < 0 || version > SCHEMA_VERSION) throw new Error('Unsupported profile schema version');
    if (version === 0) db.exec('CREATE TABLE profiles (id TEXT PRIMARY KEY NOT NULL, displayName TEXT NOT NULL) STRICT; PRAGMA user_version = 1;');
    if (version < 2) db.exec("ALTER TABLE profiles ADD COLUMN locale TEXT NOT NULL DEFAULT 'en-US'; PRAGMA user_version = 2;");
    db.exec('COMMIT');
  } catch (error) { db.exec('ROLLBACK'); throw error; }
}

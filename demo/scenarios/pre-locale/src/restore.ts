import type { DatabaseSync } from 'node:sqlite';
import { backupSchema } from './backup.js';
export function restoreBackup(db: DatabaseSync, backup: unknown): void {
  const validated = backupSchema.parse(backup);
  db.exec('BEGIN IMMEDIATE');
  try {
    db.exec('DELETE FROM profiles');
    const insert = db.prepare('INSERT INTO profiles (id, displayName) VALUES (?, ?)');
    for (const profile of validated.profiles) insert.run(profile.id, profile.displayName);
    db.exec('COMMIT');
  } catch (error) { db.exec('ROLLBACK'); throw error; }
}

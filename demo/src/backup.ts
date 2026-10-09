import type { DatabaseSync } from 'node:sqlite';
import { z } from 'zod';
import { persistentProfileSchema } from './profile.js';
export const backupSchema = z.strictObject({ formatVersion: z.literal(1), schemaVersion: z.literal(2), profiles: z.array(persistentProfileSchema) });
export type Backup = z.infer<typeof backupSchema>;
export function createBackup(db: DatabaseSync): Backup {
  return backupSchema.parse({ formatVersion: 1, schemaVersion: 2, profiles: db.prepare('SELECT id, displayName, locale FROM profiles ORDER BY id').all() });
}

import { DatabaseSync } from 'node:sqlite';
import { z } from 'zod';
import { migrate } from './migrations.js';
export const persistentProfileSchema = z.strictObject({ id: z.string().min(1), displayName: z.string().min(1) });
const inputSchema = persistentProfileSchema.extend({ sessionHint: z.string().optional() });
export type Profile = z.infer<typeof inputSchema>;
export function openProfileDb(path: string): DatabaseSync {
  const db = new DatabaseSync(path, { timeout: 2000 });
  try { migrate(db); return db; } catch (error) { db.close(); throw error; }
}
export function saveProfile(db: DatabaseSync, profile: Profile): void {
  const { id, displayName } = inputSchema.parse(profile);
  db.prepare('INSERT INTO profiles (id, displayName) VALUES (?, ?) ON CONFLICT(id) DO UPDATE SET displayName = excluded.displayName').run(id, displayName);
}

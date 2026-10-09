import { DatabaseSync } from 'node:sqlite';
import { z } from 'zod';
import { migrate } from './migrations.js';
export const persistentProfileSchema = z.strictObject({ id: z.string().min(1), displayName: z.string().min(1), locale: z.string().min(1) });
const inputSchema = persistentProfileSchema.extend({ locale: z.string().min(1).default('en-US'), sessionHint: z.string().optional() });
export type Profile = z.input<typeof inputSchema>;
export function openProfileDb(path: string): DatabaseSync {
  const db = new DatabaseSync(path, { timeout: 2000 });
  try { migrate(db); return db; } catch (error) { db.close(); throw error; }
}
export function saveProfile(db: DatabaseSync, profile: Profile): void {
  const { id, displayName, locale } = inputSchema.parse(profile);
  db.prepare('INSERT INTO profiles (id, displayName, locale) VALUES (?, ?, ?) ON CONFLICT(id) DO UPDATE SET displayName = excluded.displayName, locale = excluded.locale').run(id, displayName, locale);
}

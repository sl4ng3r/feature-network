import { DatabaseSync } from 'node:sqlite';
import { createHash } from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const [appRaw, manifestRaw] = process.argv.slice(2);
if (!appRaw || !manifestRaw) {
  console.error('usage: node oracle.mjs <app-directory> <external-manifest.json>');
  process.exit(2);
}
const app = resolve(appRaw);
const manifest = JSON.parse(await readFile(resolve(manifestRaw), 'utf8'));
const parentsText = await readFile(join(app, 'src/parents.json'), 'utf8');
const parentHash = createHash('sha256').update(parentsText).digest('hex');
const parents = JSON.parse(parentsText);
const allIds = [...(manifest.related ?? []), ...(manifest.unrelated ?? [])];
if (manifest.format !== 1 || !Number.isSafeInteger(manifest.size) || manifest.size !== allIds.length ||
    !Array.isArray(manifest.related) || !Array.isArray(manifest.unrelated) ||
    new Set(allIds).size !== manifest.size || !allIds.every(id => typeof id === 'string') ||
    !isDeepStrictEqual(parents, manifest.parents) || parentHash !== manifest.parentsHash ||
    !isDeepStrictEqual(Object.keys(parents).sort(), [...allIds].sort())) throw new Error('invalid_manifest');
for (const id of allIds) {
  const expectedRoot = manifest.related.includes(id) ? 'profile' : 'seed';
  let cursor = id;
  for (let steps = 0; steps <= manifest.size; steps++) {
    cursor = parents[cursor];
    if (cursor === expectedRoot) break;
    if (typeof cursor !== 'string' || !allIds.includes(cursor)) throw new Error('invalid_manifest');
  }
  if (cursor !== expectedRoot) throw new Error('invalid_manifest');
}
const profile = await import(pathToFileURL(join(app, 'src/profile.mjs')).href);
const registry = await import(pathToFileURL(join(app, 'src/registry.mjs')).href);
if (!isDeepStrictEqual(registry.parents, parents)) throw new Error('registry_graph_changed');
const checks = [];
async function check(id, fn) {
  try {
    const reason = await fn();
    checks.push({ id, status: reason === null ? 'passed' : 'failed', reason });
  } catch (error) {
    checks.push({ id, status: 'failed', reason: error instanceof Error ? error.message : String(error) });
  }
}
const root = await mkdtemp(join(tmpdir(), 'fn-complexity-oracle-'));
try {
  const database = join(root, 'new.sqlite');
  const db = profile.openDb(database);
  try {
    profile.saveProfile(db, { id: 'u1', name: 'Alex', locale: 'de-DE', sessionHint: 'never-store' });
    profile.saveProfile(db, { id: 'u2', name: 'Caro', sessionHint: 'never-store' });
  } finally { db.close(); }
  const reopened = profile.openDb(database);
  try {
    const stored = reopened.prepare('SELECT * FROM profiles WHERE id = ?').get('u1');
    await check('sqlite_locale', () => stored?.locale === 'de-DE' ? null : 'Explicit locale is absent after reopen');
    const defaulted = reopened.prepare('SELECT * FROM profiles WHERE id = ?').get('u2');
    await check('default_locale', () => defaulted?.locale === 'en-US' ? null : 'Omitted locale does not default to en-US');
    await check('session_hint_transient', () => !Object.hasOwn(stored ?? {}, 'sessionHint') ? null : 'sessionHint was stored');
    await check('profile_projection', async () => {
      const result = await registry.project('profile', reopened, 'u1');
      return isDeepStrictEqual({ ...result }, { id: 'u1', name: 'Alex', locale: 'de-DE' }) ? null : 'Profile root changed shape or omitted locale';
    });
    for (const id of manifest.related) {
      await check(`profile_projection:${id}`, async () => {
        const result = await registry.project(id, reopened, 'u1');
        return isDeepStrictEqual(result, { id: 'u1', name: 'Alex', view: id, locale: 'de-DE' }) ? null : 'Published projection has wrong fields or dropped locale';
      });
    }
    for (const id of manifest.unrelated) {
      await check(`independent_projection:${id}`, async () => {
        const result = await registry.project(id, reopened, 'u1');
        return isDeepStrictEqual(result, { id: 'u-other', name: 'Independent record', view: id }) ? null : 'Independent projection changed or leaked private fields';
      });
    }
  } finally { reopened.close(); }

  const legacyPath = join(root, 'legacy.sqlite');
  const legacy = new DatabaseSync(legacyPath);
  try {
    legacy.exec("CREATE TABLE profiles (id TEXT PRIMARY KEY NOT NULL, name TEXT NOT NULL) STRICT; PRAGMA user_version = 1; INSERT INTO profiles (id, name) VALUES ('old', 'Existing');");
  } finally { legacy.close(); }
  await check('legacy_migration', () => {
    const upgraded = profile.openDb(legacyPath);
    try {
      const row = upgraded.prepare("SELECT * FROM profiles WHERE id = 'old'").get();
      const version = upgraded.prepare('PRAGMA user_version').get().user_version;
      return row?.locale === 'en-US' && version >= 2 ? null : 'Version-1 row or schema was not migrated';
    } finally { upgraded.close(); }
  });
} finally { await rm(root, { recursive: true, force: true }); }
if (checks.length !== manifest.size + 5) throw new Error('oracle_check_count_mismatch');
const failed = checks.filter(item => item.status === 'failed');
console.log(JSON.stringify({ format: 1, status: failed.length ? 'failed' : 'passed', passed: checks.length - failed.length, failed: failed.length, checks }, null, 2));
if (failed.length) process.exitCode = 1;

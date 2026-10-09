import { DatabaseSync } from 'node:sqlite';
import { createHash } from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

// Held out from the generated project. The agent sees its brief and baseline
// tests, while this oracle checks actual runtime outputs and migrated bytes.
const [appRaw, manifestRaw] = process.argv.slice(2);
if (!appRaw || !manifestRaw) {
  console.error('usage: node fanout-oracle.mjs <app-directory> <external-manifest.json>');
  process.exit(2);
}
const app = resolve(appRaw);
const manifest = JSON.parse(await readFile(resolve(manifestRaw), 'utf8'));
const graph = manifest.graph ?? {};
const graphText = JSON.stringify(graph, null, 2) + '\n';
const kindsByTier = {
  small: ['api', 'backup', 'csv', 'message', 'audit'],
  medium: ['api', 'backup', 'csv', 'message', 'audit', 'notification', 'cache'],
  large: ['api', 'backup', 'csv', 'message', 'audit', 'notification', 'cache', 'digest', 'bundle'],
};
const kinds = kindsByTier[manifest.tier];
const related = manifest.related;
const unrelated = manifest.unrelated;
const allIds = [...(related ?? []).map(item => item.id), ...(unrelated ?? [])];
if (manifest.format !== 1 || manifest.workload !== 'fanout' || !kinds ||
    !Number.isSafeInteger(manifest.size) || manifest.size < 6 || manifest.size > 256 ||
    !Number.isSafeInteger(manifest.relatedCount) || manifest.relatedCount !== related?.length || related.length < kinds.length ||
    !Number.isSafeInteger(manifest.seed) || manifest.seed < 0 || manifest.seed > 0xffffffff ||
    !Array.isArray(related) || !Array.isArray(unrelated) || manifest.size !== allIds.length ||
    !isDeepStrictEqual(manifest.contractKinds, kinds) ||
    new Set(allIds).size !== allIds.length ||
    !related.every((item, index) => typeof item.id === 'string' && item.kind === kinds[index % kinds.length]) ||
    !unrelated.every(id => typeof id === 'string') ||
    createHash('sha256').update(graphText).digest('hex') !== manifest.graphHash ||
    !isDeepStrictEqual(Object.keys(graph).sort(), [...allIds].sort()) ||
    !related.every(item => {
      if (item.kind === 'digest') return isDeepStrictEqual(graph[item.id], [related.find(other => other.kind === 'message')?.id, related.find(other => other.kind === 'audit')?.id]);
      if (item.kind === 'bundle') return isDeepStrictEqual(graph[item.id], [related.find(other => other.kind === 'backup')?.id, related.find(other => other.kind === 'csv')?.id]);
      return graph[item.id] === 'profile';
    }) ||
    !unrelated.every(id => graph[id] === 'seed')) throw new Error('invalid_manifest');

const profile = await import(pathToFileURL(join(app, 'src/profile.mjs')).href);
const registry = await import(pathToFileURL(join(app, 'src/registry.mjs')).href);
if (!isDeepStrictEqual(registry.graph, graph)) throw new Error('registry_graph_changed');
const checks = [];
async function check(id, fn) {
  try {
    const reason = await fn();
    checks.push({ id, status: reason === null ? 'passed' : 'failed', reason });
  } catch (error) {
    checks.push({ id, status: 'failed', reason: error instanceof Error ? error.message : String(error) });
  }
}
const exact = (actual, expected, reason) => isDeepStrictEqual(actual, expected) ? null : reason;
const expectedProfile = { id: 'u1', name: 'Alex, "A"', locale: 'de-DE' };
const expectedDefault = { id: 'u2', name: 'Caro', locale: 'en-US' };
function expectedContract(id, kind, record) {
  switch (kind) {
    case 'api': return { id: record.id, name: record.name, locale: record.locale, contract: id };
    case 'backup': return {
      payload: JSON.stringify({ version: 1, profile: { id: record.id, name: record.name, locale: record.locale } }),
      restored: { id: record.id, name: record.name, locale: record.locale },
    };
    case 'csv': {
      const quote = value => '"' + String(value).replaceAll('"', '""') + '"';
      return 'id,name,locale\n' + [record.id, record.name, record.locale].map(quote).join(',') + '\n';
    }
    case 'message': return record.locale === 'de-DE'
      ? `Profil ${record.name} gespeichert (de-DE)`
      : `Profile ${record.name} saved (en-US)`;
    case 'audit': return { actorId: record.id, action: 'profile_changed', locale: record.locale, contract: id };
    case 'notification': return { recipientId: record.id,
      subject: record.locale === 'de-DE' ? 'Profil aktualisiert' : 'Profile updated',
      body: record.locale === 'de-DE' ? `Aktualisiert: ${record.name}` : `Updated: ${record.name}`,
      locale: record.locale, contract: id };
    case 'cache': return `profile:${encodeURIComponent(record.id)}:${encodeURIComponent(record.locale)}`;
    case 'digest': {
      const message = expectedContract('', 'message', record);
      const audit = expectedContract('', 'audit', record);
      return { headline: message, actorId: audit.actorId, locale: audit.locale, contract: id };
    }
    case 'bundle': {
      const backup = expectedContract('', 'backup', record);
      const csv = expectedContract('', 'csv', record);
      return { backup: backup.payload, csv, locale: backup.restored.locale, contract: id };
    }
    default: throw new Error('Unknown kind');
  }
}
const root = await mkdtemp(join(tmpdir(), 'fn-fanout-oracle-'));
try {
  const path = join(root, 'fresh.sqlite');
  const db = profile.openDb(path);
  try {
    profile.saveProfile(db, { ...expectedProfile, sessionHint: 'never-store' });
    profile.saveProfile(db, { id: 'u2', name: 'Caro', sessionHint: 'never-store' });
  } finally { db.close(); }
  const reopened = profile.openDb(path);
  try {
    const stored = reopened.prepare("SELECT * FROM profiles WHERE id = 'u1'").get();
    const defaulted = reopened.prepare("SELECT * FROM profiles WHERE id = 'u2'").get();
    await check('sqlite_locale', () => exact({ ...stored }, expectedProfile, 'Profile fields changed or locale absent after reopen'));
    await check('default_locale', () => exact({ ...defaulted }, expectedDefault, 'Omitted locale does not default to en-US'));
    await check('session_hint_transient', () => !Object.hasOwn(stored ?? {}, 'sessionHint') ? null : 'Transient field was stored');
    await check('profile_root', () => exact({ ...profile.loadProfile(reopened, 'u1') }, expectedProfile, 'Profile root omitted locale'));
    for (const { id, kind } of related) {
      await check(`${kind}:${id}`, async () => {
        const explicit = await registry.runContract(id, reopened, 'u1');
        const fallback = await registry.runContract(id, reopened, 'u2');
        const reason = exact(explicit, expectedContract(id, kind, expectedProfile), 'Explicit-locale contract output or format is wrong');
        const fallbackReason = exact(fallback, expectedContract(id, kind, expectedDefault), 'Default-locale contract output or format is wrong');
        if (reason || fallbackReason || kind !== 'backup') return reason ?? fallbackReason;
        const restoredPath = join(root, `restored-${id}.sqlite`);
        const restoreDb = profile.openDb(restoredPath);
        let rejectedUnknownVersion = false;
        let unchangedAfterReject = false;
        try {
          const backup = await import(pathToFileURL(join(app, 'src/contracts', `${id}.mjs`)).href);
          backup.restoreBackup(restoreDb, explicit.payload);
          backup.restoreBackup(restoreDb, fallback.payload);
          const before = Buffer.from(restoreDb.serialize());
          try {
            backup.restoreBackup(restoreDb, JSON.stringify({ version: 99,
              profile: { id: 'u1', name: 'Tampered', locale: 'xx-XX' } }));
          } catch { rejectedUnknownVersion = true; }
          unchangedAfterReject = before.equals(Buffer.from(restoreDb.serialize()));
        } finally { restoreDb.close(); }
        if (!rejectedUnknownVersion) return 'Unknown backup version was accepted';
        if (!unchangedAfterReject) return 'Unknown backup version changed the database before rejection';
        const verified = profile.openDb(restoredPath);
        try {
          return exact({ ...verified.prepare("SELECT * FROM profiles WHERE id = 'u1'").get() }, expectedProfile,
            'Backup restore did not persist explicit locale') ??
            exact({ ...verified.prepare("SELECT * FROM profiles WHERE id = 'u2'").get() }, expectedDefault,
              'Backup restore did not persist default locale');
        } finally { verified.close(); }
      });
    }
    for (const id of unrelated) {
      await check(`independent:${id}`, async () => exact(await registry.runContract(id, reopened, 'u1'),
        { id: 'other', name: 'Independent', contract: id }, 'Independent source leaked private data or changed output'));
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
      return isDeepStrictEqual({ ...row }, { id: 'old', name: 'Existing', locale: 'en-US' }) && version === 2
        ? null : 'Version-1 data or schema was not migrated exactly';
    } finally { upgraded.close(); }
  });
} finally { await rm(root, { recursive: true, force: true }); }
if (checks.length !== manifest.size + 5) throw new Error('oracle_check_count_mismatch');
const failed = checks.filter(item => item.status === 'failed');
console.log(JSON.stringify({ format: 1, workload: 'fanout', status: failed.length ? 'failed' : 'passed',
  passed: checks.length - failed.length, failed: failed.length, checks }, null, 2));
if (failed.length) process.exitCode = 1;

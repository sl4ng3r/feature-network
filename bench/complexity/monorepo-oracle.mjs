import { DatabaseSync } from 'node:sqlite';
import { createHash } from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const [appRaw, manifestRaw] = process.argv.slice(2);
if (!appRaw || !manifestRaw) {
  console.error('usage: node monorepo-oracle.mjs <app-directory> <external-manifest.json>');
  process.exit(2);
}
const app = resolve(appRaw);
const manifest = JSON.parse(await readFile(resolve(manifestRaw), 'utf8'));
const hash = createHash('sha256').update(JSON.stringify({ flows: manifest.flows, distractors: manifest.distractors })).digest('hex');
if (manifest.format !== 1 || manifest.workload !== 'monorepo' || manifest.manifestHash !== hash ||
    manifest.flowCount !== manifest.flows?.length || manifest.distractorCount !== manifest.distractors?.length ||
    !Array.isArray(manifest.kinds) || manifest.kinds.length !== 9 ||
    !manifest.flows.every(flow => isDeepStrictEqual(Object.keys(flow.nodes), manifest.kinds))) throw new Error('invalid_manifest');

const checks = [];
async function check(id, run) {
  try {
    const reason = await run();
    checks.push({ id, status: reason == null ? 'passed' : 'failed', reason });
  } catch (error) {
    checks.push({ id, status: 'failed', reason: error instanceof Error ? error.message : String(error) });
  }
}
const exact = (actual, expected, reason) => isDeepStrictEqual(actual, expected) ? null : reason;
const explicit = { id: 'u1', name: 'Alex, "A"', locale: 'de-DE' };
const fallback = { id: 'u2', name: 'Caro', locale: 'en-US' };
const encoded = { id: 'u 3/x', name: 'Encoded', locale: 'de-DE' };
const quote = value => '"' + String(value).replaceAll('"', '""') + '"';
function expected(kind, id, record) {
  const message = record.locale === 'de-DE' ? `Profil ${record.name} gespeichert (de-DE)` : `Profile ${record.name} saved (en-US)`;
  const subject = record.locale === 'de-DE' ? 'Profil aktualisiert' : 'Profile updated';
  switch (kind) {
    case 'identity': case 'gate': return record;
    case 'api': return { ...record, contract: id };
    case 'backup': return { version: 1, profile: record };
    case 'csv': return `id,name,locale\n${[record.id, record.name, record.locale].map(quote).join(',')}\n`;
    case 'message': return message;
    case 'delivery': return { recipientId: record.id, subject, body: message, locale: record.locale };
    case 'audit': return { action: 'delivery_sent', actorId: record.id, subject, locale: record.locale };
    case 'cache': return `profile:${encodeURIComponent(record.id)}:${encodeURIComponent(record.locale)}`;
    default: throw new Error('unknown_kind');
  }
}
function compareContract(kind, actual, id, record) {
  if (kind === 'backup') {
    if (typeof actual !== 'string') return 'Backup is not a JSON string';
    return exact(JSON.parse(actual), expected(kind, id, record), 'Backup JSON payload mismatch');
  }
  return exact(actual, expected(kind, id, record), 'Contract output mismatch');
}
const root = await mkdtemp(join(tmpdir(), 'fn-monorepo-oracle-'));
try {
  const profile = await import(pathToFileURL(join(app, 'src/profile.mjs')).href);
  const path = join(root, 'fresh.sqlite');
  const db = profile.openDb(path);
  try {
    profile.saveProfile(db, { ...explicit, sessionHint: 'private' });
    profile.saveProfile(db, { id: fallback.id, name: fallback.name, sessionHint: 'private' });
    profile.saveProfile(db, { ...encoded, sessionHint: 'private' });
  } finally { db.close(); }
  const reopened = profile.openDb(path);
  try {
    await check('persisted', () => exact({ ...reopened.prepare("SELECT * FROM profiles WHERE id = 'u1'").get() }, explicit, 'Explicit locale did not survive reopen'));
    await check('default', () => exact({ ...reopened.prepare("SELECT * FROM profiles WHERE id = 'u2'").get() }, fallback, 'Omitted locale did not default'));
    await check('transient', () => !Object.hasOwn(reopened.prepare("SELECT * FROM profiles WHERE id = 'u1'").get() ?? {}, 'sessionHint') ? null : 'sessionHint persisted');
    for (const [index, flow] of manifest.flows.entries()) {
      const modules = Object.fromEntries(await Promise.all(manifest.kinds.map(async kind => [kind,
        await import(pathToFileURL(join(app, 'packages', manifest.packages[kind], `${flow.nodes[kind]}.mjs`)).href)])));
      for (const kind of manifest.kinds) {
        const id = flow.nodes[kind];
        await check(`flow${index}:${kind}:${id}`, () => compareContract(kind, modules[kind].run(reopened, explicit.id, true), id, explicit) ??
          compareContract(kind, modules[kind].run(reopened, fallback.id, true), id, fallback));
        if (kind !== 'identity') await check(`flow${index}:unauthorized:${kind}:${id}`, () => {
          try { modules[kind].run(reopened, explicit.id, false); return 'Unauthorized call returned data'; }
          catch (error) { return error instanceof Error && error.message === 'Forbidden' ? null : 'Unauthorized call did not throw Forbidden'; }
        });
      }
      await check(`flow${index}:cache-encoding:${flow.nodes.cache}`, () =>
        exact(modules.cache.run(reopened, encoded.id, true), expected('cache', flow.nodes.cache, encoded),
          'Cache key did not URL-encode the profile id'));
      await check(`flow${index}:restore`, () => {
        const restoreDb = profile.openDb(join(root, `restore-${index}.sqlite`));
        try {
          modules.backup.restoreBackup(restoreDb, modules.backup.run(reopened, explicit.id, true));
          modules.backup.restoreBackup(restoreDb, modules.backup.run(reopened, fallback.id, true));
          return exact({ ...restoreDb.prepare("SELECT * FROM profiles WHERE id = 'u1'").get() }, explicit, 'Backup restore lost locale') ??
            exact({ ...restoreDb.prepare("SELECT * FROM profiles WHERE id = 'u2'").get() }, fallback, 'Backup restore lost default');
        } finally { restoreDb.close(); }
      });
      await check(`flow${index}:backup-version`, () => {
        const restoreDb = profile.openDb(join(root, `reject-${index}.sqlite`));
        try {
          const before = Buffer.from(restoreDb.serialize());
          let rejected = false;
          try { modules.backup.restoreBackup(restoreDb, JSON.stringify({ version: 99, profile: { id: 'bad', name: 'Bad', locale: 'xx-XX' } })); }
          catch { rejected = true; }
          return rejected && before.equals(Buffer.from(restoreDb.serialize())) ? null : 'Unknown version wrote data or did not reject';
        } finally { restoreDb.close(); }
      });
    }
    for (const item of manifest.distractors) {
      await check(`independent:${item.id}`, async () => {
        const module = await import(pathToFileURL(join(app, 'packages', item.pkg, `${item.id}.mjs`)).href);
        return exact(module.run(reopened, explicit.id, true), { id: 'other', name: 'Independent', contract: item.id }, 'Independent output changed or private field leaked');
      });
    }
  } finally { reopened.close(); }
  const legacyPath = join(root, 'legacy.sqlite');
  const legacy = new DatabaseSync(legacyPath);
  try { legacy.exec("CREATE TABLE profiles (id TEXT PRIMARY KEY NOT NULL, name TEXT NOT NULL) STRICT; PRAGMA user_version = 1; INSERT INTO profiles VALUES ('old', 'Existing');"); }
  finally { legacy.close(); }
  await check('migration', () => {
    const upgraded = profile.openDb(legacyPath);
    try { return exact({ ...upgraded.prepare("SELECT * FROM profiles WHERE id = 'old'").get() },
      { id: 'old', name: 'Existing', locale: 'en-US' }, 'Version-1 row not migrated') ??
      (upgraded.prepare('PRAGMA user_version').get().user_version === 2 ? null : 'Schema version is not 2'); }
    finally { upgraded.close(); }
  });
} catch (error) {
  checks.push({ id: 'fatal', status: 'failed', reason: error instanceof Error ? error.message : String(error) });
} finally { await rm(root, { recursive: true, force: true }); }
const failed = checks.filter(item => item.status === 'failed');
const expectedChecks = 4 + manifest.flows.length * 20 + manifest.distractors.length;
const observedChecks = checks.filter(item => item.id !== 'fatal').length;
const notRun = Math.max(0, expectedChecks - observedChecks);
const complete = !checks.some(item => item.id === 'fatal') && observedChecks === expectedChecks;
const status = complete && failed.length === 0 ? 'passed' : 'failed';
console.log(JSON.stringify({ format: 1, workload: 'monorepo', status, complete, expectedChecks,
  observedChecks, notRun, passed: checks.filter(item => item.status === 'passed').length,
  failed: failed.length, checks }, null, 2));
if (status === 'failed') process.exitCode = 1;

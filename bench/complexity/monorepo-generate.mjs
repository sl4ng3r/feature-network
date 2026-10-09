import { createHash } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const kinds = ['identity', 'gate', 'api', 'backup', 'csv', 'message', 'delivery', 'audit', 'cache'];
const packages = { identity: 'identity', gate: 'access', api: 'api', backup: 'export', csv: 'export',
  message: 'notify', delivery: 'notify', audit: 'audit', cache: 'cache' };
const parents = { identity: ['profile'], gate: ['identity'], api: ['gate'], backup: ['gate'],
  csv: ['api'], message: ['gate'], delivery: ['message', 'gate'], audit: ['delivery', 'gate'], cache: ['api'] };

export function layout(flows, distractorCount, seed) {
  let state = seed >>> 0;
  const random = () => ((state = (Math.imul(state, 1664525) + 1013904223) >>> 0) / 0x100000000);
  const ids = Array.from({ length: flows * kinds.length + distractorCount }, (_, i) => `unit-${String(i).padStart(3, '0')}`);
  for (let i = ids.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [ids[i], ids[j]] = [ids[j], ids[i]];
  }
  const active = ids.slice(0, flows * kinds.length);
  const flowList = Array.from({ length: flows }, (_, index) => ({
    nodes: Object.fromEntries(kinds.map((kind, offset) => [kind, active[index * kinds.length + offset]])),
  }));
  const distractors = ids.slice(active.length).map((id, i) => ({ id,
    pkg: ['api', 'export', 'notify', 'audit', 'cache', 'access'][i % 6] }));
  return { format: 1, workload: 'monorepo', seed, flowCount: flows, distractorCount,
    flows: flowList, distractors, kinds, packages };
}

export function profileSource(golden) {
  return `import { DatabaseSync } from 'node:sqlite';

export function openDb(path) {
  const db = new DatabaseSync(path, { timeout: 2000 });
  const version = db.prepare('PRAGMA user_version').get().user_version;
  if (version === 0) {
    db.exec('BEGIN IMMEDIATE');
    try {
      db.exec("CREATE TABLE profiles (id TEXT PRIMARY KEY NOT NULL, name TEXT NOT NULL) STRICT; PRAGMA user_version = 1;");
      db.exec('COMMIT');
    } catch (error) { db.exec('ROLLBACK'); db.close(); throw error; }
  } else if (version !== 1${golden ? ' && version !== 2' : ''}) { db.close(); throw new Error('Unsupported schema version'); }
${golden ? `  if (version === 0 || version === 1) {
    db.exec('BEGIN IMMEDIATE');
    try { db.exec("ALTER TABLE profiles ADD COLUMN locale TEXT NOT NULL DEFAULT 'en-US'; PRAGMA user_version = 2;"); db.exec('COMMIT'); }
    catch (error) { db.exec('ROLLBACK'); db.close(); throw error; }
  }
` : ''}  return db;
}

export function saveProfile(db, record) {
  if (typeof record.id !== 'string' || !record.id || typeof record.name !== 'string' || !record.name) throw new Error('Invalid profile');
  db.prepare('INSERT INTO profiles (${golden ? 'id, name, locale' : 'id, name'}) VALUES (${golden ? '?, ?, ?' : '?, ?'}) ON CONFLICT(id) DO UPDATE SET name = excluded.name${golden ? ', locale = excluded.locale' : ''}')
    .run(record.id, record.name${golden ? ", record.locale ?? 'en-US'" : ''});
}

export function loadProfile(db, id) { return db.prepare('SELECT * FROM profiles WHERE id = ?').get(id) ?? null; }
`;
}

function importLine(flow, currentKind, dependency, binding) {
  if (dependency === 'profile') return `import { loadProfile } from '../../src/profile.mjs';`;
  const currentPkg = packages[currentKind];
  const depPkg = packages[dependency];
  const prefix = currentPkg === depPkg ? '.' : `../${depPkg}`;
  return `import { run as ${binding} } from '${prefix}/${flow.nodes[dependency]}.mjs';`;
}

export function nodeSource(flow, kind, golden) {
  const id = flow.nodes[kind];
  const imports = parents[kind].map((dependency, i) => importLine(flow, kind, dependency, `up${i}`)).join('\n');
  let body;
  switch (kind) {
    case 'identity': body = `const record = loadProfile(db, profileId);\n  if (!record) throw new Error('Missing profile');\n  return { id: record.id, name: record.name${golden ? ', locale: record.locale' : ''} };`; break;
    case 'gate': body = `if (authorized !== true) throw new Error('Forbidden');\n  return up0(db, profileId, authorized);`; break;
    case 'api': body = `const record = up0(db, profileId, authorized);\n  return { id: record.id, name: record.name${golden ? ', locale: record.locale' : ''}, contract: '${id}' };`; break;
    case 'backup': body = `const record = up0(db, profileId, authorized);\n  return JSON.stringify({ version: 1, profile: { id: record.id, name: record.name${golden ? ', locale: record.locale' : ''} } });`; break;
    case 'csv': body = `const record = up0(db, profileId, authorized);\n  const quote = value => '"' + String(value).replaceAll('"', '""') + '"';\n  return '${golden ? 'id,name,locale' : 'id,name'}\\n' + [record.id, record.name${golden ? ', record.locale' : ''}].map(quote).join(',') + '\\n';`; break;
    case 'message': body = `const record = up0(db, profileId, authorized);\n  return ${golden ? "record.locale === 'de-DE' ? 'Profil ' + record.name + ' gespeichert (de-DE)' : 'Profile ' + record.name + ' saved (en-US)'" : "'Profile ' + record.name + ' saved'"};`; break;
    case 'delivery': body = `const message = up0(db, profileId, authorized);\n  const record = up1(db, profileId, authorized);\n  return { recipientId: record.id, subject: ${golden ? "record.locale === 'de-DE' ? 'Profil aktualisiert' : 'Profile updated'" : "'Profile updated'"}, body: message${golden ? ', locale: record.locale' : ''} };`; break;
    case 'audit': body = `const sent = up0(db, profileId, authorized);\n  const record = up1(db, profileId, authorized);\n  return { action: 'delivery_sent', actorId: record.id, subject: sent.subject${golden ? ', locale: sent.locale' : ''} };`; break;
    case 'cache': body = `const record = up0(db, profileId, authorized);\n  return 'profile:' + encodeURIComponent(record.id)${golden ? " + ':' + encodeURIComponent(record.locale)" : ''};`; break;
    default: throw new Error('Unknown kind');
  }
  const restore = kind === 'backup' ? `\nimport { saveProfile } from '../../src/profile.mjs';
export function restoreBackup(db, payload) {
  const parsed = JSON.parse(payload);
  if (parsed.version !== 1) throw new Error('Unsupported backup version');
  saveProfile(db, parsed.profile);
}
` : '';
  return `${imports}\n\nexport function run(db, profileId, authorized) {\n  ${body}\n}\n${restore}`;
}

const [flowsRaw, distractorsRaw, seedRaw, outputRaw] = process.argv.slice(2);
if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  const flows = Number(flowsRaw), distractorCount = Number(distractorsRaw), seed = Number(seedRaw);
  if (!Number.isSafeInteger(flows) || flows < 1 || flows > 8 ||
      !Number.isSafeInteger(distractorCount) || distractorCount < 1 || distractorCount > 256 ||
      !Number.isSafeInteger(seed) || seed < 0 || seed > 0xffffffff || !outputRaw) {
    console.error('usage: node monorepo-generate.mjs <flows 1..8> <distractors 1..256> <seed uint32> <new-output-directory>');
    process.exit(2);
  }
  const root = resolve(outputRaw);
  await mkdir(root); // Never overwrite a prior agent trial.
  for (const path of ['src', 'test', 'network-spec', ...new Set(Object.values(packages)).values()].map(
    path => path === 'src' || path === 'test' || path === 'network-spec' ? path : `packages/${path}`)) {
    await mkdir(join(root, path), { recursive: true });
  }
  const put = (path, content) => writeFile(join(root, path), content, { flag: 'wx' });
  const manifest = layout(flows, distractorCount, seed);
  await put('package.json', JSON.stringify({ name: 'synthetic-cross-package-contracts', private: true,
    type: 'module', workspaces: ['packages/*'], scripts: { test: 'node --test test/*.test.mjs' },
    engines: { node: '>=24 <25' } }, null, 2) + '\n');
  for (const pkg of new Set(Object.values(packages))) await put(`packages/${pkg}/package.json`,
    JSON.stringify({ name: `@synthetic/${pkg}`, private: true, type: 'module', version: '1.0.0' }, null, 2) + '\n');
  await put('src/profile.mjs', profileSource(false));
  await put('src/separate.mjs', `export function separate() { return { id: 'other', name: 'Independent', locale: 'fr-FR', sessionHint: 'private-seed-value' }; }\n`);
  await put('README.md', '# Synthetic profile service\n\nRun `npm test`. Profile storage begins in `src/profile.mjs`; package entry points import their upstream modules directly.\n');
  for (const flow of manifest.flows) for (const kind of kinds) {
    await put(`packages/${packages[kind]}/${flow.nodes[kind]}.mjs`, nodeSource(flow, kind, false));
  }
  for (const item of manifest.distractors) {
    await put(`packages/${item.pkg}/${item.id}.mjs`, `import { separate } from '../../src/separate.mjs';\nexport function run() { const record = separate(); return { id: record.id, name: record.name, contract: '${item.id}' }; }\n`);
  }
  const sample = manifest.flows[0].nodes;
  await put('test/base.test.mjs', `import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openDb, saveProfile } from '../src/profile.mjs';
import { run as api } from '../packages/api/${sample.api}.mjs';
import { run as independent } from '../packages/${manifest.distractors[0].pkg}/${manifest.distractors[0].id}.mjs';

test('existing package entry points', () => {
  const root = mkdtempSync(join(tmpdir(), 'fn-monorepo-base-'));
  try {
    const db = openDb(join(root, 'data.sqlite'));
    try {
      saveProfile(db, { id: 'u1', name: 'Alex', sessionHint: 'transient' });
      assert.equal(api(db, 'u1', true).id, 'u1');
      assert.throws(() => api(db, 'u1', false), /Forbidden/);
      assert.deepEqual(independent(), { id: 'other', name: 'Independent', contract: '${manifest.distractors[0].id}' });
    } finally { db.close(); }
  } finally { rmSync(root, { recursive: true, force: true }); }
});
`);
  await put('network-spec/_meta.yaml', 'schema: 1\ncoverage: partial\nareas: [synthetic-cross-package-contracts]\n');
  const feature = (id, path, summary, related = []) => `schema: 1\nid: ${id}\nsummary: ${summary}\nkey_points:\n  - Verify exact package output and private-field boundary.\ncode:\n  - path: ${path}\n${related.length ? `relations:\n${related.map(parent => `  - to: ${parent}\n    type: reads\n    status: evidenced\n    evidence:\n      - path: ${path}\n    when: Upstream contract changes.\n    check: Recheck this package output.`).join('\n')}\n` : ''}`;
  await put('network-spec/profile.yaml', feature('profile', 'src/profile.mjs', 'SQLite profile data and migration.'));
  await put('network-spec/separate.yaml', feature('separate', 'src/separate.mjs', 'Unrelated source with private data.'));
  for (const flow of manifest.flows) for (const kind of kinds) {
    const id = flow.nodes[kind];
    await put(`network-spec/${id}.yaml`, feature(id, `packages/${packages[kind]}/${id}.mjs`,
      `${kind} package contract for a stored profile.`, parents[kind].map(parent => parent === 'profile' ? parent : flow.nodes[parent])));
  }
  for (const item of manifest.distractors) await put(`network-spec/${item.id}.yaml`, feature(item.id,
    `packages/${item.pkg}/${item.id}.mjs`, 'Independent lookalike package contract.', ['separate']));
  manifest.manifestHash = createHash('sha256').update(JSON.stringify({ flows: manifest.flows, distractors: manifest.distractors })).digest('hex');
  console.log(JSON.stringify(manifest));
}

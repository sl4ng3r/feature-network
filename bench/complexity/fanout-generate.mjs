import { createHash } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';

// Synthetic workload, not a claim about a real application's failure threshold.
// `size` counts contract modules, `related` counts profile dependants including
// indirect ones. Default tiers are size <=32, <=96, >96; an explicit final
// tier argument decouples semantic breadth from size for future experiments.
const [sizeRaw, relatedRaw, seedRaw, outputRaw, tierRaw] = process.argv.slice(2);
const size = Number(sizeRaw);
const relatedCount = Number(relatedRaw);
const seed = Number(seedRaw);
const tier = tierRaw ?? (size <= 32 ? 'small' : size <= 96 ? 'medium' : 'large');
const kindsByTier = {
  small: ['api', 'backup', 'csv', 'message', 'audit'],
  medium: ['api', 'backup', 'csv', 'message', 'audit', 'notification', 'cache'],
  large: ['api', 'backup', 'csv', 'message', 'audit', 'notification', 'cache', 'digest', 'bundle'],
};
const contractKinds = kindsByTier[tier];
if (!Number.isSafeInteger(size) || size < 6 || size > 256 ||
    !contractKinds || !Number.isSafeInteger(relatedCount) || relatedCount < contractKinds.length || relatedCount >= size ||
    !Number.isSafeInteger(seed) || seed < 0 || seed > 0xffffffff || !outputRaw) {
  console.error('usage: node fanout-generate.mjs <size 6..256> <related at least tier kind count, less than size> <seed uint32> <new-output-directory> [small|medium|large]');
  process.exit(2);
}
let state = seed >>> 0;
function random() { state = (Math.imul(state, 1664525) + 1013904223) >>> 0; return state / 0x100000000; }
const ids = Array.from({ length: size }, (_, i) => `unit-${String(i).padStart(3, '0')}`);
const shuffled = [...ids];
for (let i = shuffled.length - 1; i > 0; i--) {
  const j = Math.floor(random() * (i + 1));
  [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
}
const related = shuffled.slice(0, relatedCount).map((id, i) => ({ id, kind: contractKinds[i % contractKinds.length] }));
const unrelated = shuffled.slice(relatedCount);
const firstOfKind = Object.fromEntries(contractKinds.map(kind => [kind, related.find(item => item.kind === kind)?.id]));
const graph = Object.fromEntries([
  ...related.map(({ id, kind }) => [id, kind === 'digest' ? [firstOfKind.message, firstOfKind.audit]
    : kind === 'bundle' ? [firstOfKind.backup, firstOfKind.csv] : 'profile']),
  ...unrelated.map(id => [id, 'seed']),
]);
const graphText = JSON.stringify(graph, null, 2) + '\n';
const output = resolve(outputRaw);
await mkdir(output); // A repeated run must not overwrite an earlier agent result.
await Promise.all(['src', 'src/contracts', 'test', 'network-spec'].map(path => mkdir(join(output, path), { recursive: true })));
const put = (path, value) => writeFile(join(output, path), value, { flag: 'wx' });

await put('package.json', JSON.stringify({ name: 'synthetic-cross-contract-fanout', private: true, type: 'module', scripts: { test: 'node --test test/*.test.mjs' }, engines: { node: '>=24 <25' } }, null, 2) + '\n');
await put('src/profile.mjs', `import { DatabaseSync } from 'node:sqlite';

export function openDb(path) {
  const db = new DatabaseSync(path, { timeout: 2000 });
  const version = db.prepare('PRAGMA user_version').get().user_version;
  if (version === 0) {
    db.exec('BEGIN IMMEDIATE');
    try {
      db.exec('CREATE TABLE profiles (id TEXT PRIMARY KEY NOT NULL, name TEXT NOT NULL) STRICT; PRAGMA user_version = 1;');
      db.exec('COMMIT');
    } catch (error) { db.exec('ROLLBACK'); db.close(); throw error; }
  } else if (version !== 1) { db.close(); throw new Error('Unsupported schema version'); }
  return db;
}

export function saveProfile(db, record) {
  if (typeof record.id !== 'string' || !record.id || typeof record.name !== 'string' || !record.name) throw new Error('Invalid profile');
  db.prepare('INSERT INTO profiles (id, name) VALUES (?, ?) ON CONFLICT(id) DO UPDATE SET name = excluded.name').run(record.id, record.name);
}

export function loadProfile(db, id) {
  return db.prepare('SELECT id, name FROM profiles WHERE id = ?').get(id) ?? null;
}
`);
await put('src/registry.mjs', `import { loadProfile } from './profile.mjs';

export const graph = ${JSON.stringify(graph, null, 2)};
export async function runContract(id, db, profileId) {
  const source = graph[id];
  if (!source) throw new Error('Unknown contract: ' + id);
  const record = source === 'profile' ? loadProfile(db, profileId)
    : source === 'seed' ? { id: 'other', name: 'Independent', locale: 'fr-FR', sessionHint: 'private-seed-value' }
    : { first: await runContract(source[0], db, profileId), second: await runContract(source[1], db, profileId) };
  const contract = await import('./contracts/' + id + '.mjs');
  return contract.run(record);
}
`);

function contractBody(id, kind) {
  switch (kind) {
    case 'api': return `return { id: record.id, name: record.name, contract: '${id}' };`;
    case 'backup': return `const payload = JSON.stringify({ version: 1, profile: { id: record.id, name: record.name } });\n  return { payload, restored: JSON.parse(payload).profile };`;
    case 'csv': return `const quote = value => '"' + String(value).replaceAll('"', '""') + '"';\n  return 'id,name\\n' + [record.id, record.name].map(quote).join(',') + '\\n';`;
    case 'message': return `return 'Profile ' + record.name + ' saved';`;
    case 'audit': return `return { actorId: record.id, action: 'profile_changed', contract: '${id}' };`;
    case 'notification': return `return { recipientId: record.id, subject: 'Profile updated', body: 'Updated ' + record.name, contract: '${id}' };`;
    case 'cache': return `return 'profile:' + encodeURIComponent(record.id);`;
    case 'digest': return `return { headline: record.first, actorId: record.second.actorId, contract: '${id}' };`;
    case 'bundle': return `return { backup: record.first.payload, csv: record.second, contract: '${id}' };`;
    default: throw new Error('Unknown kind');
  }
}
for (const { id, kind } of related) {
  const backupRestore = kind === 'backup' ? `\nimport { saveProfile } from '../profile.mjs';\nexport function restoreBackup(db, payload) {\n  const parsed = JSON.parse(payload);\n  if (parsed.version !== 1) throw new Error('Unsupported backup version');\n  saveProfile(db, parsed.profile);\n}\n` : '';
  await put(`src/contracts/${id}.mjs`, `// Contract module.\nexport function run(record) {\n  ${contractBody(id, kind)}\n}\n${backupRestore}`);
}
for (const id of unrelated) {
  await put(`src/contracts/${id}.mjs`, `// Contract module.\nexport function run(record) {\n  const { id: recordId, name } = record;\n  return { id: recordId, name, contract: '${id}' };\n}\n`);
}
await put('test/base.test.mjs', `import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openDb, saveProfile } from '../src/profile.mjs';
import { runContract } from '../src/registry.mjs';

test('existing contracts execute and independent data stays private', async () => {
  const root = mkdtempSync(join(tmpdir(), 'fn-fanout-base-'));
  try {
    const db = openDb(join(root, 'profile.sqlite'));
    saveProfile(db, { id: 'u1', name: 'Alex', sessionHint: 'ephemeral' });
    assert.ok(await runContract('${related[0].id}', db, 'u1'));
    assert.deepEqual(await runContract('${unrelated[0]}', db, 'u1'), { id: 'other', name: 'Independent', contract: '${unrelated[0]}' });
    db.close();
  } finally { rmSync(root, { recursive: true, force: true }); }
});
`);
await put('network-spec/_meta.yaml', 'schema: 1\ncoverage: partial\nareas: [synthetic-cross-contract-fanout]\n');
await put('network-spec/profile.yaml', `schema: 1
id: profile
summary: Persists profile fields in SQLite for independent published contracts.
key_points:
  - Current schema stores id and name; schema changes require migration.
  - sessionHint is transient and must never be persisted or published.
code:
  - path: src/profile.mjs
  - path: src/registry.mjs
`);
await put('network-spec/seed.yaml', `schema: 1
id: seed
summary: Supplies independent lookalike records outside the persisted profile.
key_points:
  - Private locale and sessionHint must not leak into independent outputs.
code:
  - path: src/registry.mjs
`);
for (const id of ids) {
  const relation = graph[id];
  const kind = related.find(item => item.id === id)?.kind;
  const relationList = Array.isArray(relation) ? relation : [relation];
  const relationsYaml = relationList.map(parent => `  - to: ${parent}
    type: reads
    status: evidenced
    evidence:
      - path: src/contracts/${id}.mjs
      - path: src/registry.mjs
    when: Source contract changes.
    check: Run this contract and verify its exact output, format, and private-field boundary.`).join('\n');
  await put(`network-spec/${id}.yaml`, `schema: 1
id: ${id}
summary: ${kind ? `Published ${kind} contract for saved profiles.` : 'Independent lookalike contract for a separate source.'}
key_points:
  - ${kind ? `The ${kind} output ${Array.isArray(relation) ? 'combines two upstream contracts' : 'publishes fields from the persisted profile'} and has a stable format.` : 'Do not publish private fields from the independent source.'}
code:
  - path: src/contracts/${id}.mjs
  - path: src/registry.mjs
relations:
${relationsYaml}
`);
}
console.log(JSON.stringify({ format: 1, workload: 'fanout', tier, contractKinds, size, relatedCount, seed, related, unrelated, graph,
  graphHash: createHash('sha256').update(graphText).digest('hex') }));

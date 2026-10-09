import { mkdir, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { join, resolve } from 'node:path';

const [sizeRaw, relatedRaw, seedRaw, outputRaw] = process.argv.slice(2);
const size = Number(sizeRaw);
const relatedCount = Number(relatedRaw);
const seed = Number(seedRaw);
if (!Number.isSafeInteger(size) || size < 3 || size > 256 ||
    !Number.isSafeInteger(relatedCount) || relatedCount < 1 || relatedCount >= size ||
    !Number.isSafeInteger(seed) || seed < 0 || seed > 0xffffffff || !outputRaw) {
  console.error('usage: node generate.mjs <size 3..256> <related 1..size-1> <seed uint32> <new-output-directory>');
  process.exit(2);
}

let randomState = seed >>> 0;
function random() { randomState = (Math.imul(randomState, 1664525) + 1013904223) >>> 0; return randomState / 0x100000000; }
const ids = Array.from({ length: size }, (_, i) => `stage-${String(i).padStart(3, '0')}`);
const shuffled = [...ids];
for (let i = shuffled.length - 1; i > 0; i--) {
  const j = Math.floor(random() * (i + 1));
  [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
}
const related = shuffled.slice(0, relatedCount);
const unrelated = shuffled.slice(relatedCount);
const parents = {};
for (const [i, id] of related.entries()) parents[id] = i === 0 ? 'profile' : related[Math.floor((i - 1) / 2)];
for (const [i, id] of unrelated.entries()) parents[id] = i === 0 ? 'seed' : unrelated[Math.floor((i - 1) / 2)];
const output = resolve(outputRaw);
await mkdir(output); // Refuse to replace a prior result.
await Promise.all(['src', 'src/stages', 'test', 'network-spec'].map(path => mkdir(join(output, path), { recursive: true })));
const put = (path, value) => writeFile(join(output, path), value, { flag: 'wx' });

await put('package.json', JSON.stringify({ name: 'synthetic-profile-projections', private: true, type: 'module', scripts: { test: 'node --test test/*.test.mjs' }, engines: { node: '>=24 <25' } }, null, 2) + '\n');
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

export function saveProfile(db, profile) {
  if (typeof profile.id !== 'string' || !profile.id || typeof profile.name !== 'string' || !profile.name) throw new Error('Invalid profile');
  db.prepare('INSERT INTO profiles (id, name) VALUES (?, ?) ON CONFLICT(id) DO UPDATE SET name = excluded.name').run(profile.id, profile.name);
}

export function loadProfile(db, id) {
  return db.prepare('SELECT id, name FROM profiles WHERE id = ?').get(id) ?? null;
}
`);
const parentsText = JSON.stringify(parents, null, 2) + '\n';
await put('src/parents.json', parentsText);
await put('src/registry.mjs', `import { loadProfile } from './profile.mjs';

export const parents = ${JSON.stringify(parents, null, 2)};

export async function project(id, db, profileId) {
  if (id === 'profile') return loadProfile(db, profileId);
  if (id === 'seed') return { id: 'u-other', name: 'Independent record', locale: 'fr-FR', sessionHint: 'private-seed-value' };
  const parent = parents[id];
  if (!parent) throw new Error('Unknown projection: ' + id);
  const source = await project(parent, db, profileId);
  const { projectRecord } = await import('./stages/' + id + '.mjs');
  return projectRecord(source);
}
`);
for (const [index, id] of ids.entries()) {
  const bodies = [
    `return { id: record.id, name: record.name, view: '${id}' };`,
    `const { id: recordId, name } = record;\n  return { id: recordId, name, view: '${id}' };`,
    `const published = { id: record.id, name: record.name };\n  published.view = '${id}';\n  return published;`,
  ];
  await put(`src/stages/${id}.mjs`, `// Published projection ${id}. Its parent is selected by the registry.
export function projectRecord(record) {
  ${bodies[index % bodies.length]}
}
`);
}
await put('test/base.test.mjs', `import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openDb, saveProfile } from '../src/profile.mjs';
import { project } from '../src/registry.mjs';

test('existing name projection and transient session hint', async () => {
  const root = mkdtempSync(join(tmpdir(), 'fn-complexity-base-'));
  try {
    const db = openDb(join(root, 'profile.sqlite'));
    saveProfile(db, { id: 'u1', name: 'Alex', sessionHint: 'ephemeral' });
    const derived = await project('${related.at(-1)}', db, 'u1');
    assert.equal(derived.name, 'Alex');
    assert.equal(Object.hasOwn(derived, 'sessionHint'), false);
    assert.equal((await project('${unrelated.at(-1)}', db, 'u1')).name, 'Independent record');
    db.close();
  } finally { rmSync(root, { recursive: true, force: true }); }
});
`);
await put('network-spec/_meta.yaml', 'schema: 1\ncoverage: partial\nareas: [synthetic-profile-projections]\n');
await put('network-spec/profile.yaml', `schema: 1
id: profile
summary: Persists the user profile in SQLite; downstream published projections must retain persistent fields.
key_points:
  - Current schema stores id and name.
  - sessionHint is transient and must not be persisted or published.
code:
  - path: src/profile.mjs
  - path: src/registry.mjs
`);
await put('network-spec/seed.yaml', `schema: 1
id: seed
summary: Supplies unrelated records to independent projection chains.
key_points:
  - Independent records are never derived from saved profiles.
code:
  - path: src/registry.mjs
`);
for (const id of ids) {
  const parent = parents[id];
  await put(`network-spec/${id}.yaml`, `schema: 1
id: ${id}
summary: Published projection ${id}; reads the ${parent} output selected by the registry.
key_points:
  - ${related.includes(id) ? 'All persistent profile fields must survive this projection.' : 'This projection belongs to an independent record chain.'}
code:
  - path: src/stages/${id}.mjs
  - path: src/registry.mjs
relations:
  - to: ${parent}
    type: reads
    status: evidenced
    evidence:
      - path: src/stages/${id}.mjs
      - path: src/registry.mjs
    when: Parent output contract changes.
    check: Verify this published projection retains the fields required by its source.
`);
}
console.log(JSON.stringify({ format: 1, size, relatedCount, seed, related, unrelated, parents,
  parentsHash: createHash('sha256').update(parentsText).digest('hex') }));

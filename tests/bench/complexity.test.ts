import { afterEach, expect, test } from 'vitest';
import { Client } from '@modelcontextprotocol/client';
import { StdioClientTransport } from '@modelcontextprotocol/client/stdio';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const generator = resolve('bench/complexity/generate.mjs');
const oracle = resolve('bench/complexity/oracle.mjs');
const knownGood = resolve('bench/complexity/known-good.mjs');
const roots: string[] = [];
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }); });

function fixture(size = 24, related = 5, seed = 11) {
  const root = mkdtempSync(join(tmpdir(), 'fn-complexity-')); roots.push(root);
  const app = join(root, 'app');
  const manifest = JSON.parse(execFileSync(process.execPath, [generator, String(size), String(related), String(seed), app], { encoding: 'utf8' }));
  return { root, app, manifest };
}

test('deterministic fixture separates profile descendants from unrelated features', () => {
  const { app, manifest } = fixture();
  expect(manifest.format).toBe(1);
  expect(manifest.size).toBe(24);
  expect(manifest.related).toHaveLength(5);
  expect(new Set(manifest.related).size).toBe(5);
  expect(manifest.unrelated).toHaveLength(19);
  expect(readdirSync(join(app, 'src/stages')).filter(name => name.endsWith('.mjs'))).toHaveLength(24);
  expect(readdirSync(join(app, 'network-spec')).filter(name => name.endsWith('.yaml'))).toHaveLength(27);
  const parents = JSON.parse(readFileSync(join(app, 'src/parents.json'), 'utf8'));
  for (const id of manifest.related) {
    let cursor = id;
    for (let steps = 0; steps <= 5; steps++) {
      cursor = parents[cursor];
      if (cursor === 'profile') break;
      expect(manifest.related).toContain(cursor);
    }
    expect(cursor).toBe('profile');
  }
  for (const id of manifest.unrelated) expect(parents[id] === 'seed' || manifest.unrelated.includes(parents[id])).toBe(true);
  expect(execFileSync(process.execPath, ['--test', 'test/base.test.mjs'], { cwd: app, encoding: 'utf8' })).toContain('fail 0');
});

test('held-out oracle fails on the original app and never lives inside the generated project', () => {
  const { root, app, manifest } = fixture(12, 3, 7);
  const manifestPath = join(root, 'manifest.json');
  writeFileSync(manifestPath, JSON.stringify(manifest));
  expect(readdirSync(app)).not.toContain('manifest.json');
  const run = spawnSync(process.execPath, [oracle, app, manifestPath], { encoding: 'utf8' });
  expect(run.status).toBe(1);
  const result = JSON.parse(run.stdout);
  expect(result.status).toBe('failed');
  expect(result.checks).toHaveLength(17);
  expect(result.checks.some((check: { id: string; status: string }) => check.id === 'sqlite_locale' && check.status === 'failed')).toBe(true);
});

test.each([[12, 3, 11], [48, 8, 22], [192, 16, 33]])('known-good control passes all held-out checks at %i stages', (size, related, seed) => {
  const { root, app, manifest } = fixture(size, related, seed);
  const manifestPath = join(root, 'manifest.json'); writeFileSync(manifestPath, JSON.stringify(manifest));
  execFileSync(process.execPath, [knownGood, app, manifestPath], { encoding: 'utf8' });
  const run = spawnSync(process.execPath, [oracle, app, manifestPath], { encoding: 'utf8' });
  expect(run.status).toBe(0);
  const result = JSON.parse(run.stdout);
  expect(result.status).toBe('passed');
  expect(result.checks).toHaveLength(size + 5);
  expect(execFileSync(process.execPath, ['--test', 'test/base.test.mjs'], { cwd: app, encoding: 'utf8' })).toContain('fail 0');
});

test('blanket field spread fails because independent source records carry private locale and session data', () => {
  const { root, app, manifest } = fixture(12, 3, 11);
  const manifestPath = join(root, 'manifest.json'); writeFileSync(manifestPath, JSON.stringify(manifest));
  execFileSync(process.execPath, [knownGood, app, manifestPath]);
  for (const id of [...manifest.related, ...manifest.unrelated]) {
    writeFileSync(join(app, 'src/stages', `${id}.mjs`), `export function projectRecord(record) { return { ...record, view: '${id}' }; }\n`);
  }
  const run = spawnSync(process.execPath, [oracle, app, manifestPath], { encoding: 'utf8' });
  expect(run.status).toBe(1);
  const result = JSON.parse(run.stdout);
  expect(result.checks.some((check: { id: string; status: string }) => check.id.startsWith('independent_projection:') && check.status === 'failed')).toBe(true);
});

test('generated network is valid and impact reaches exactly the profile descendants', async () => {
  const { app, manifest } = fixture();
  const client = new Client({ name: 'complexity-test', version: '1' });
  const transport = new StdioClientTransport({ command: process.execPath, args: [resolve('plugin/dist/cli.mjs'), 'mcp', '--project-root', app], stderr: 'pipe' });
  try {
    await client.connect(transport);
    const result = await client.callTool({ name: 'network_impact', arguments: { query: 'profile', direction: 'both', depth: 8, detail: 'summary', limit: 20, budget: 20000 } });
    const data = result.structuredContent as { integrity: string; items: { id: string }[]; };
    expect(result.isError).not.toBe(true);
    expect(data.integrity).toBe('valid');
    expect(data.items.map(item => item.id).sort()).toEqual(['profile', ...manifest.related].sort());
  } finally { await client.close(); }
});

test('fixture size and output constraints reject invalid or overwritten cases', () => {
  const { app } = fixture();
  expect(spawnSync(process.execPath, [generator, '24', '5', '11', app], { encoding: 'utf8' }).status).not.toBe(0);
  expect(spawnSync(process.execPath, [generator, '2', '3', '11', join(tmpdir(), 'invalid-fn-case')], { encoding: 'utf8' }).status).not.toBe(0);
});

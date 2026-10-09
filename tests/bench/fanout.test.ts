import { describe, afterEach, expect, test } from 'vitest';
import { Client } from '@modelcontextprotocol/client';
import { StdioClientTransport } from '@modelcontextprotocol/client/stdio';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const generator = resolve('bench/complexity/fanout-generate.mjs');
const oracle = resolve('bench/complexity/fanout-oracle.mjs');
const knownGood = resolve('bench/complexity/fanout-known-good.mjs');
const roots: string[] = [];
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }); });

function fixture(size = 30, related = 10, seed = 11) {
  const root = mkdtempSync(join(tmpdir(), 'fn-fanout-')); roots.push(root);
  const app = join(root, 'app');
  const manifest = JSON.parse(execFileSync(process.execPath, [generator, String(size), String(related), String(seed), app], { encoding: 'utf8' }));
  const manifestPath = join(root, 'manifest.json');
  writeFileSync(manifestPath, JSON.stringify(manifest));
  return { root, app, manifest, manifestPath };
}

function oracleRun(app: string, manifestPath: string) {
  const run = spawnSync(process.execPath, [oracle, app, manifestPath], { encoding: 'utf8' });
  return { status: run.status, result: JSON.parse(run.stdout) as { status: string; checks: { id: string; status: string }[] } };
}

// Real generated-filesystem, SQLite/oracle-process and MCP integration.
describe('benchmark fixture integration', { timeout: 20000 }, () => {

test('deterministic generator creates five real contract families and separate independent lookalikes', () => {
  const first = fixture();
  const second = fixture();
  expect(first.manifest).toEqual(second.manifest);
  expect(first.manifest.related).toHaveLength(10);
  expect(first.manifest.unrelated).toHaveLength(20);
  expect(new Set(first.manifest.related.map((entry: { kind: string }) => entry.kind))).toEqual(new Set(['api', 'backup', 'csv', 'message', 'audit']));
  expect(first.manifest.tier).toBe('small');
  expect(first.manifest.contractKinds).toHaveLength(5);
  expect(readdirSync(join(first.app, 'src/contracts')).filter(name => name.endsWith('.mjs'))).toHaveLength(30);
  expect(readdirSync(join(first.app, 'src'))).not.toContain('graph.json');
  const relatedSource = readFileSync(join(first.app, 'src/contracts', `${first.manifest.related[0].id}.mjs`), 'utf8');
  const unrelatedSource = readFileSync(join(first.app, 'src/contracts', `${first.manifest.unrelated[0]}.mjs`), 'utf8');
  expect(relatedSource).not.toMatch(/Published|saved profiles/i);
  expect(unrelatedSource).not.toMatch(/Independent|private fields/i);
  expect(readdirSync(join(first.app, 'network-spec')).filter(name => name.endsWith('.yaml'))).toHaveLength(33);
  expect(execFileSync(process.execPath, ['--test', 'test/base.test.mjs'], { cwd: first.app, encoding: 'utf8' })).toContain('fail 0');
  expect(readdirSync(first.app)).not.toContain('manifest.json');
});

test.each([
  [64, 40, 55, 'medium', 7, 0],
  [128, 96, 66, 'large', 9, 2],
] as const)('%i-contract fixture has progressive semantic tier', (size, related, seed, tier, kindCount, indirectKinds) => {
  const { app, manifest } = fixture(size, related, seed);
  expect(manifest.tier).toBe(tier);
  expect(manifest.contractKinds).toHaveLength(kindCount);
  expect(new Set(manifest.related.map((item: { kind: string }) => item.kind)).size).toBe(kindCount);
  const indirect = manifest.related.filter((item: { kind: string }) => ['digest', 'bundle'].includes(item.kind));
  expect(new Set(indirect.map((item: { kind: string }) => item.kind)).size).toBe(indirectKinds);
  for (const item of indirect) {
    expect(manifest.graph[item.id]).toHaveLength(2);
    for (const parent of manifest.graph[item.id]) expect(manifest.related.some((candidate: { id: string }) => candidate.id === parent)).toBe(true);
    expect(readFileSync(join(app, 'network-spec', `${item.id}.yaml`), 'utf8')).toContain(`to: ${manifest.graph[item.id][0]}`);
  }
});

test.each([[64, 40, 55], [128, 96, 66]])('new contract families fail the prechange oracle at %i contracts', (size, related, seed) => {
  const { app, manifest, manifestPath } = fixture(size, related, seed);
  const run = oracleRun(app, manifestPath);
  expect(run.status).toBe(1);
  for (const kind of manifest.contractKinds) {
    expect(run.result.checks.some(check => check.id.startsWith(`${kind}:`) && check.status === 'failed')).toBe(true);
  }
});

test('external oracle rejects the original implementation across all five contracts', () => {
  const { app, manifestPath } = fixture(15, 5, 7);
  const run = oracleRun(app, manifestPath);
  expect(run.status).toBe(1);
  expect(run.result.status).toBe('failed');
  for (const kind of ['api', 'backup', 'csv', 'message', 'audit']) {
    expect(run.result.checks.some(check => check.id.startsWith(`${kind}:`) && check.status === 'failed')).toBe(true);
  }
  expect(run.result.checks.some(check => check.id === 'legacy_migration' && check.status === 'failed')).toBe(true);
});

test.each([[24, 12, 44], [64, 40, 55], [128, 96, 66]])('known-good passes strict external oracle for %i contracts', (size, related, seed) => {
  const { app, manifestPath } = fixture(size, related, seed);
  execFileSync(process.execPath, [knownGood, app, manifestPath]);
  const run = oracleRun(app, manifestPath);
  expect(run.status).toBe(0);
  expect(run.result.status).toBe('passed');
  expect(run.result.checks).toHaveLength(size + 5);
  expect(execFileSync(process.execPath, ['--test', 'test/base.test.mjs'], { cwd: app, encoding: 'utf8' })).toContain('fail 0');
});

test('blanket spread into independent contract leaks private source fields', () => {
  const { app, manifest, manifestPath } = fixture(15, 5, 7);
  execFileSync(process.execPath, [knownGood, app, manifestPath]);
  const id = manifest.unrelated[0];
  writeFileSync(join(app, 'src/contracts', `${id}.mjs`), `export function run(record) { return { ...record, contract: '${id}' }; }\n`);
  const run = oracleRun(app, manifestPath);
  expect(run.status).toBe(1);
  expect(run.result.checks.some(check => check.id === `independent:${id}` && check.status === 'failed')).toBe(true);
});

test('large indirect contracts fail independently after every upstream contract is fixed', () => {
  const { app, manifest, manifestPath } = fixture(128, 96, 66);
  execFileSync(process.execPath, [knownGood, app, manifestPath]);
  for (const kind of ['digest', 'bundle']) {
    const id = manifest.related.find((item: { kind: string }) => item.kind === kind).id;
    writeFileSync(join(app, 'src/contracts', `${id}.mjs`), `export function run(record) { return { contract: '${id}' }; }\n`);
  }
  const run = oracleRun(app, manifestPath);
  expect(run.status).toBe(1);
  for (const kind of ['digest', 'bundle']) {
    expect(run.result.checks.some(check => check.id.startsWith(`${kind}:`) && check.status === 'failed')).toBe(true);
  }
  expect(run.result.checks.some(check => check.id.startsWith('message:') && check.status === 'failed')).toBe(false);
  expect(run.result.checks.some(check => check.id.startsWith('backup:') && check.status === 'failed')).toBe(false);
});

test('backup restore rejects an unknown version before changing persisted rows', () => {
  const { app, manifest, manifestPath } = fixture(24, 12, 44);
  execFileSync(process.execPath, [knownGood, app, manifestPath]);
  const id = manifest.related.find((item: { kind: string }) => item.kind === 'backup').id;
  const path = join(app, 'src/contracts', `${id}.mjs`);
  const safe = readFileSync(path, 'utf8');
  expect(safe).toContain("if (parsed.version !== 1) throw new Error('Unsupported backup version');");
  writeFileSync(path, safe.replace(
    "if (parsed.version !== 1) throw new Error('Unsupported backup version');",
    "if (parsed.version !== 1) { saveProfile(db, parsed.profile); throw new Error('Unsupported backup version'); }",
  ));
  const run = oracleRun(app, manifestPath);
  expect(run.status).toBe(1);
  expect(run.result.checks.some(check => check.id === `backup:${id}` && check.status === 'failed')).toBe(true);
});

test.for([[24, 12, 44], [64, 40, 55], [128, 96, 66]])('network spec and impact are valid for %i contracts', async ([size, related, seed], { signal }) => {
  const { app, manifest } = fixture(size, related, seed);
  const client = new Client({ name: 'fanout-test', version: '1' });
  const transport = new StdioClientTransport({ command: process.execPath,
    args: [resolve('plugin/dist/cli.mjs'), 'mcp', '--project-root', app], stderr: 'pipe' });
  try {
    await client.connect(transport, { signal, timeout: 15000 });
    const result = await client.callTool({ name: 'network_impact', arguments: {
      ids: ['profile'], direction: 'both', depth: manifest.tier === 'large' ? 2 : 1,
      detail: 'summary', limit: 100, budget: 64000,
    } }, { signal, timeout: 15000 });
    const data = result.structuredContent as { integrity: string; items: { id: string }[] };
    expect(result.isError).not.toBe(true);
    expect(data.integrity).toBe('valid');
    expect(data.items.map(item => item.id).sort()).toEqual(['profile', ...manifest.related.map((item: { id: string }) => item.id)].sort());
  } finally { await client.close(); }
});

test('generator refuses invalid geometry and refuses to overwrite a fixture', () => {
  const { app } = fixture();
  expect(spawnSync(process.execPath, [generator, '30', '10', '11', app]).status).not.toBe(0);
  expect(spawnSync(process.execPath, [generator, '15', '4', '11', join(tmpdir(), 'fn-fanout-invalid')]).status).not.toBe(0);
  expect(readFileSync(join(app, 'network-spec/profile.yaml'), 'utf8')).toContain('id: profile');
});

});

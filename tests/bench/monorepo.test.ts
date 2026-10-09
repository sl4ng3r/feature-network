import { describe, afterEach, expect, test } from 'vitest';
import { Client } from '@modelcontextprotocol/client';
import { StdioClientTransport } from '@modelcontextprotocol/client/stdio';
import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const generator = resolve('bench/complexity/monorepo-generate.mjs');
const oracle = resolve('bench/complexity/monorepo-oracle.mjs');
const knownGood = resolve('bench/complexity/monorepo-known-good.mjs');
const roots: string[] = [];
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }); });

function fixture(flows = 2, distractors = 24, seed = 77) {
  const root = mkdtempSync(join(tmpdir(), 'fn-monorepo-')); roots.push(root);
  const app = join(root, 'app');
  const manifest = JSON.parse(execFileSync(process.execPath,
    [generator, String(flows), String(distractors), String(seed), app], { encoding: 'utf8' }));
  const manifestPath = join(root, 'manifest.json');
  writeFileSync(manifestPath, JSON.stringify(manifest));
  return { root, app, manifest, manifestPath };
}

function evaluate(app: string, manifestPath: string) {
  const run = spawnSync(process.execPath, [oracle, app, manifestPath], { encoding: 'utf8' });
  return { exit: run.status, report: JSON.parse(run.stdout) as {
    status: string; complete: boolean; expectedChecks: number; notRun: number;
    checks: { id: string; status: string }[];
  } };
}

// Real generated-filesystem, SQLite/oracle-process and MCP integration.
describe('benchmark fixture integration', { timeout: 20000 }, () => {

test('seeded layout is repeatable, sparse, and distributed without a central graph', () => {
  const a = fixture(); const b = fixture();
  expect(a.manifest).toEqual(b.manifest);
  expect(a.manifest.flows).toHaveLength(2);
  expect(a.manifest.distractors).toHaveLength(24);
  expect(Object.keys(a.manifest.flows[0].nodes)).toHaveLength(9);
  expect(existsSync(join(a.app, 'src/graph.json'))).toBe(false);
  expect(existsSync(join(a.app, 'src/registry.mjs'))).toBe(false);
  expect(JSON.parse(readFileSync(join(a.app, 'package.json'), 'utf8')).workspaces).toEqual(['packages/*']);
  expect(JSON.parse(readFileSync(join(a.app, 'packages/access/package.json'), 'utf8')).name).toBe('@synthetic/access');
  expect(readFileSync(join(a.app, 'packages', 'access', `${a.manifest.flows[0].nodes.gate}.mjs`), 'utf8'))
    .toContain('from');
  expect(readFileSync(join(a.app, 'network-spec', 'profile.yaml'), 'utf8')).toContain('src/profile.mjs');
  expect(execFileSync(process.execPath, ['--test', 'test/base.test.mjs'],
    { cwd: a.app, encoding: 'utf8' })).toContain('fail 0');
});

test('unchanged project fails held-out business, migration, and authorization checks', () => {
  const { app, manifestPath } = fixture();
  const { exit, report } = evaluate(app, manifestPath);
  expect(exit).toBe(1);
  expect(report.status).toBe('failed');
  expect(report.checks.some(item => item.id === 'migration' && item.status === 'failed')).toBe(true);
  expect(report.checks.some(item => item.id.includes('api') && item.status === 'failed')).toBe(true);
});

test('known-good solution passes every held-out check and original tests', () => {
  const { app, manifestPath } = fixture(2, 24, 77);
  execFileSync(process.execPath, [knownGood, app, manifestPath]);
  const { exit, report } = evaluate(app, manifestPath);
  expect(exit).toBe(0);
  expect(report.status).toBe('passed');
  expect(report.complete).toBe(true);
  expect(report.notRun).toBe(0);
  expect(report.checks).toHaveLength(report.expectedChecks);
  expect(report.checks.every(item => item.status === 'passed')).toBe(true);
  expect(execFileSync(process.execPath, ['--test', 'test/base.test.mjs'],
    { cwd: app, encoding: 'utf8' })).toContain('fail 0');
});

test('a wider seeded fixture retains the positive control', () => {
  const { app, manifestPath } = fixture(3, 60, 101);
  execFileSync(process.execPath, [knownGood, app, manifestPath]);
  expect(evaluate(app, manifestPath).exit).toBe(0);
});

test('oracle catches a security regression and independent source leakage', () => {
  const { app, manifest, manifestPath } = fixture(1, 10, 19);
  execFileSync(process.execPath, [knownGood, app, manifestPath]);
  const gatePath = join(app, 'packages', 'access', `${manifest.flows[0].nodes.gate}.mjs`);
  const safe = readFileSync(gatePath, 'utf8');
  writeFileSync(gatePath, safe.replace('if (authorized !== true) throw new Error(\'Forbidden\');', ''));
  expect(evaluate(app, manifestPath).report.checks.some(item => item.id.includes('unauthorized') && item.status === 'failed')).toBe(true);
  writeFileSync(gatePath, safe);
  const decoy = manifest.distractors[0];
  writeFileSync(join(app, 'packages', decoy.pkg, `${decoy.id}.mjs`),
    `import { separate } from '../../src/separate.mjs'; export function run() { return { ...separate(), contract: '${decoy.id}' }; }\n`);
  expect(evaluate(app, manifestPath).report.checks.some(item => item.id.includes('independent') && item.status === 'failed')).toBe(true);
});

test('oracle catches a distant audit regression after every upstream module is correct', () => {
  const { app, manifest, manifestPath } = fixture(2, 24, 77);
  execFileSync(process.execPath, [knownGood, app, manifestPath]);
  const id = manifest.flows[1].nodes.audit;
  const path = join(app, 'packages', 'audit', `${id}.mjs`);
  writeFileSync(path, readFileSync(path, 'utf8').replace(', locale: sent.locale', ''));
  const report = evaluate(app, manifestPath).report;
  expect(report.checks.some(item => item.id === `flow1:audit:${id}` && item.status === 'failed')).toBe(true);
  expect(report.checks.some(item => item.id === `flow0:audit:${manifest.flows[0].nodes.audit}` && item.status === 'failed')).toBe(false);
});

test('backup JSON object key order is not part of the public contract', () => {
  const { app, manifest, manifestPath } = fixture(1, 10, 19);
  execFileSync(process.execPath, [knownGood, app, manifestPath]);
  const id = manifest.flows[0].nodes.backup;
  const path = join(app, 'packages', 'export', `${id}.mjs`);
  const original = readFileSync(path, 'utf8');
  const changed = original.replace(
    'JSON.stringify({ version: 1, profile: { id: record.id, name: record.name, locale: record.locale } })',
    'JSON.stringify({ profile: { locale: record.locale, name: record.name, id: record.id }, version: 1 })');
  expect(changed).not.toBe(original);
  writeFileSync(path, changed);
  expect(evaluate(app, manifestPath).exit).toBe(0);
});

test('cache URL encoding is actually exercised by the held-out oracle', () => {
  const { app, manifest, manifestPath } = fixture(1, 10, 19);
  execFileSync(process.execPath, [knownGood, app, manifestPath]);
  const id = manifest.flows[0].nodes.cache;
  const path = join(app, 'packages', 'cache', `${id}.mjs`);
  const safe = readFileSync(path, 'utf8');
  writeFileSync(path, safe.replace('encodeURIComponent(record.id)', 'record.id'));
  const report = evaluate(app, manifestPath).report;
  expect(report.checks.some(item => item.id === `flow0:cache-encoding:${id}` && item.status === 'failed')).toBe(true);
});

test('fatal import reports missing checks rather than a complete denominator', () => {
  const { app, manifest, manifestPath } = fixture(1, 10, 19);
  execFileSync(process.execPath, [knownGood, app, manifestPath]);
  rmSync(join(app, 'packages', 'api', `${manifest.flows[0].nodes.api}.mjs`));
  const { exit, report } = evaluate(app, manifestPath);
  expect(exit).toBe(1);
  expect(report.status).toBe('failed');
  expect(report.complete).toBe(false);
  expect(report.notRun).toBeGreaterThan(0);
});

test('MCP impact reaches every related package through paths of at least five edges', async ({ signal }) => {
  const { app, manifest } = fixture();
  const client = new Client({ name: 'monorepo-test', version: '1' });
  const transport = new StdioClientTransport({ command: process.execPath,
    args: [resolve('plugin/dist/cli.mjs'), 'mcp', '--project-root', app], stderr: 'pipe' });
  try {
    await client.connect(transport, { signal, timeout: 15000 });
    const result = await client.callTool({ name: 'network_impact', arguments: {
      ids: ['profile'], direction: 'both', depth: 8, detail: 'summary', limit: 100, budget: 64000,
    } }, { signal, timeout: 15000 });
    const data = result.structuredContent as { integrity: string; items: { id: string }[] };
    expect(result.isError).not.toBe(true);
    expect(data.integrity).toBe('valid');
    expect(data.items.map(item => item.id).sort()).toEqual(['profile',
      ...manifest.flows.flatMap((flow: { nodes: Record<string, string> }) => Object.values(flow.nodes))].sort());
    expect(readFileSync(join(app, 'network-spec', `${manifest.flows[0].nodes.audit}.yaml`), 'utf8'))
      .toContain(`to: ${manifest.flows[0].nodes.delivery}`);
  } finally { await client.close(); }
});

test('generator refuses invalid geometry and overwrites', () => {
  const { app } = fixture();
  expect(spawnSync(process.execPath, [generator, '2', '24', '77', app]).status).not.toBe(0);
  expect(spawnSync(process.execPath, [generator, '0', '24', '77', join(tmpdir(), 'fn-monorepo-invalid')]).status).not.toBe(0);
});

});

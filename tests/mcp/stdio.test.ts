import { afterEach, beforeAll, expect, test } from 'vitest';
import { Client } from '@modelcontextprotocol/client';
import { StdioClientTransport } from '@modelcontextprotocol/client/stdio';
import { mkdtemp, readFile, readdir, writeFile, rm, copyFile, mkdir } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { fixture, hash } from '../freshness/fixture.js';
import { cleanup, exec, repo, tree } from '../project/helpers.js';
import { readSnapshot } from '../../src/storage/repository.js';
const roots: string[] = [];
const clients: Client[] = [];
const bundle = resolve('plugin/dist/cli.mjs');
beforeAll(async () => { await exec(process.execPath, ['scripts/build-plugin.mjs']); });
afterEach(async () => { await Promise.all(clients.splice(0).map(c => c.close())); await Promise.all(roots.splice(0).map(cleanup)); });
async function connect(root: string, file = bundle) {
  const client = new Client({ name: 'feature-network-tests', version: '1.0.0' }); clients.push(client);
  const transport = new StdioClientTransport({ command: process.execPath, args: [file, 'mcp', '--project-root', root], stderr: 'pipe' });
  let stderr = ''; transport.stderr?.on('data', chunk => { stderr += chunk.toString(); });
  try { await client.connect(transport); } catch (error) { throw new Error(`${String(error)} stderr: ${stderr}`); }
  return { client, stderr: () => stderr };
}
async function call(client: Client, name: string, args: Record<string, unknown> = {}) {
  return client.callTool({ name, arguments: args });
}
function data(result: Awaited<ReturnType<typeof call>>) { return result.structuredContent as Record<string, any>; }
// Catches a missing server/registration by observing the real SDK client's tool list.
test('lists_exactly_five_tools', async () => {
  const root = await tree(); roots.push(root);
  const { client } = await connect(root); const names = (await client.listTools()).tools.map(t => t.name).sort();
  expect(names).toEqual(['network_bootstrap', 'network_check', 'network_context', 'network_impact', 'network_update']);
});
test('uninitialized_reads_create_nothing_and_root_cannot_switch', async () => {
  const root = await tree(); roots.push(root); const { client } = await connect(root);
  expect(data(await call(client, 'network_context')).error.code).toBe('not_initialized');
  expect(data(await call(client, 'network_impact')).error.code).toBe('not_initialized');
  expect(data(await call(client, 'network_check')).integrity).toBe('not_initialized');
  expect(data(await call(client, 'network_bootstrap', { action: 'status' })).status).toBe('not_started');
  const rejected = await call(client, 'network_check', { projectRoot: '/should-not-bind' });
  expect(rejected.isError).toBe(true); expect(data(rejected).error.code).toBe('invalid_input');
  expect(await readdir(root)).toEqual([]);
});
test('bootstrap_before_marker_and_checkpoint_CAS_work', async () => {
  const root = await tree(); roots.push(root); await repo(root); await writeFile(join(root, 'source.ts'), 'source');
  const { client } = await connect(root); const first = data(await call(client, 'network_bootstrap', { action: 'start' }));
  expect(first.status).toBe('pending'); expect(first.package.slices[0]).toMatchObject({ path: 'source.ts', fileHash: hash('source'), startByte: 0, endByte: 6 });
  expect(JSON.stringify(first)).not.toContain('"text":"source"');
  const bad = await call(client, 'network_bootstrap', { action: 'checkpoint', expectedRunRevision: '0'.repeat(64), packageId: first.package.id, networkRevision: first.networkRevision, sources: [], featureFingerprints: {}, results: [] });
  expect(data(bad).error.code).toBe('conflict');
  expect(data(await call(client, 'network_bootstrap', { action: 'status' })).runRevision).toBe(first.runRevision);
  await expect(readFile(join(root, 'network-spec/_meta.yaml'))).rejects.toMatchObject({ code: 'ENOENT' });
});
test('invalid_input_returns_redacted_stable_code', async () => {
  const p = await fixture(roots); const { client, stderr } = await connect(p.root);
  for (const args of [{ budget: 511 }, { cursor: 'bad' }, { query: { secret: p.root } }, { callback: 'eval(secret)' }]) {
    const result = await call(client, 'network_context', args); expect(result.isError).toBe(true); expect(data(result).error.code).toBe('invalid_input');
    expect(JSON.stringify(result)).not.toContain(p.root); expect(JSON.stringify(result)).not.toContain('eval(secret)');
  }
  expect(stderr()).toBe('');
});
test('optimistic_update_conflicts_and_semantic_decisions_are_separate', async () => {
  const p = await fixture(roots); const { client } = await connect(p.root);
  const observed = data(await call(client, 'network_context', { ids: ['alpha'], detail: 'full' }));
  const snap = { revision: observed.revision, fingerprints: observed.fingerprints, features: observed.items };
  expect(data(await call(client, 'network_check', { mode: 'full' })).openDecisions).toContainEqual({ path: 'source.ts', featureIds: ['alpha'], reason: 'decision_missing' });
  const request = { expected: snap.fingerprints, expectedRevision: snap.revision, upserts: [{ ...snap.features[0], summary: 'Reviewed source' }], deletes: [], verifiedReferences: [{ path: 'source.ts', hash: hash('source') }], decision: { outcome: 'updated', reason: 'Read source and checked feature semantics' } };
  const saved = await call(client, 'network_update', request); expect(saved.isError).not.toBe(true); expect(data(saved).revision).not.toBe(snap.revision);
  expect(data(await call(client, 'network_check', { mode: 'full' })).openDecisions).toEqual([]);
  expect(data(await call(client, 'network_update', request)).error.code).toBe('conflict');
  await rm(join(p.runtimeDir, 'values/freshness/decisions.json'));
  expect(data(await call(client, 'network_check')).openDecisions[0].reason).toBe('decision_missing');
});
test('missing_observation_requires_repair_and_does_not_invent_baseline', async () => {
  const p = await fixture(roots); await writeFile(join(p.root, 'aux.ts'), 'aux'); await exec('git', ['-C', p.root, 'add', 'aux.ts']); await rm(join(p.root, 'aux.ts'));
  const snap = await readSnapshot(p); const { client } = await connect(p.root);
  const result = await call(client, 'network_update', { expected: {}, expectedRevision: snap.revision, upserts: [], deletes: [], verifiedReferences: [], observations: [{ path: 'aux.ts', state: 'missing' }], decision: { outcome: 'no_semantic_change', reason: 'Deleted helper has no feature semantics' } });
  expect(result.isError).not.toBe(true);
  expect(data(await call(client, 'network_check', { mode: 'full' })).unknownChangeDecisions).toContainEqual({ path: 'aux.ts', state: 'missing_no_semantic_change' });
  expect(JSON.parse(await readFile(join(p.runtimeDir, 'baselines.json'), 'utf8')).references).not.toHaveProperty('aux.ts');
});
test('complete_tool_result_budget_and_unicode_continuation', async () => {
  const p = await fixture(roots); const snap = await readSnapshot(p); const { client } = await connect(p.root);
  const saved = await call(client, 'network_update', { expected: snap.fingerprints, upserts: [{ ...snap.features[0], summary: '😀'.repeat(3000) }], deletes: [], verifiedReferences: [{ path: 'source.ts', hash: hash('source') }], decision: { outcome: 'updated', reason: 'Reviewed long feature summary' } }); expect(saved.isError).not.toBe(true);
  let cursor: unknown; let text = ''; let pages = 0;
  do {
    const result = await call(client, 'network_context', cursor ? { cursor } : { ids: ['alpha'], detail: 'full', budget: 900 });
    expect(result.isError).not.toBe(true); expect(Buffer.byteLength(JSON.stringify(result))).toBeLessThanOrEqual(900);
    const row = data(result).items[0]; expect(row.fragment.offset).toBe(text.length); text += row.fragment.text; cursor = data(result).nextCursor;
    expect(pages++).toBeLessThan(200);
  } while (cursor);
  expect(JSON.parse(text).summary).toBe('😀'.repeat(3000));
  const small = await call(client, 'network_context', { ids: ['alpha'], detail: 'full', budget: 512 });
  expect(Buffer.byteLength(JSON.stringify(small))).toBeLessThanOrEqual(512);
  expect(data(await call(client, 'network_impact', { budget: 512 }))).toHaveProperty('revision');
}, 30000);
test('pending_journal_is_not_recovered_by_reads', async () => {
  const p = await fixture(roots); const path = join(p.runtimeDir, 'journal.json'); await writeFile(path, 'unreadable journal'); const { client } = await connect(p.root);
  expect(data(await call(client, 'network_check', { mode: 'full' })).integrity).toBe('pending_recovery');
  expect(data(await call(client, 'network_context')).error.code).toBe('pending_recovery');
  expect(data(await call(client, 'network_bootstrap', { action: 'status' })).status).toBe('pending_recovery');
  expect(await readFile(path, 'utf8')).toBe('unreadable journal');
});
test('bundle_runs_offline_without_node_modules_and_stdout_is_only_protocol', async () => {
  const root = await tree(); roots.push(root); const install = await mkdtemp(join(tmpdir(), 'fn-plugin-')); roots.push(install);
  await mkdir(join(install, 'dist')); const file = join(install, 'dist/cli.mjs'); await copyFile(bundle, file);
  const { client, stderr } = await connect(root, file); expect((await client.listTools()).tools).toHaveLength(5); expect(stderr()).toBe('');
  const input = JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-11-25', capabilities: {}, clientInfo: { name: 'raw', version: '1' } } }) + '\n';
  const { spawn } = await import('node:child_process');
  const raw = await new Promise<string>((resolveOutput, reject) => { const child = spawn(process.execPath, [file, 'mcp', '--project-root', root]); let stdout = ''; child.stdout.on('data', chunk => { stdout += chunk; if (stdout.includes('\n')) child.kill(); }); child.on('error', reject); child.on('exit', () => resolveOutput(stdout)); child.stdin.end(input); });
  expect(raw.trim().split('\n').map(line => JSON.parse(line))).toEqual([expect.objectContaining({ jsonrpc: '2.0', id: 1, result: expect.any(Object) })]);
  const invalid = await exec(process.execPath, [file, 'mcp']).catch(error => error); expect(invalid.stdout).toBe(''); expect(invalid.stderr).toContain('project_root_required'); expect(invalid.stderr).not.toContain(root);
});

test('bootstrap_receipts_complete_only_with_explicit_relational_review', async () => {
  const p = await fixture(roots); const { client } = await connect(p.root);
  const current = data(await call(client, 'network_context', { ids: ['alpha'], detail: 'full' }));
  const first = data(await call(client, 'network_bootstrap', { action: 'start' }));
  const receipt = { action: 'checkpoint', expectedRunRevision: first.runRevision, packageId: first.package.id, networkRevision: current.revision, sources: [{ path: 'source.ts', hash: hash('source') }], featureFingerprints: { alpha: current.fingerprints['network-spec/alpha.yaml'] }, results: first.package.slices.map((s: any) => ({ path: s.path, startByte: s.startByte, endByte: s.endByte, featureIds: ['alpha'], outcome: 'analyzed', reason: 'Read slice and checked saved feature' })) };
  const ack = data(await call(client, 'network_bootstrap', receipt)); expect(ack.status).toBe('awaiting_relational_review');
  const final = { action: 'checkpoint', expectedRunRevision: ack.runRevision, packageId: null, networkRevision: current.revision, sources: [], featureFingerprints: { alpha: current.fingerprints['network-spec/alpha.yaml'] }, results: [] };
  expect(data(await call(client, 'network_bootstrap', final)).error.code).toBe('invalid_checkpoint');
  const done = data(await call(client, 'network_bootstrap', { ...final, relationalReviewComplete: true, reason: 'Reviewed all captured relationships' }));
  expect(done).toMatchObject({ status: 'completed', coverage: 'partial', progress: { relationalReviewComplete: true } });
});
test('installed_plugin_root_is_excluded_from_inventory_and_reference_writes', async () => {
  const root = await tree(); roots.push(root); await repo(root); await writeFile(join(root, 'source.ts'), 'source');
  const install = join(root, 'local-plugin'); await mkdir(join(install, 'dist'), { recursive: true }); const file = join(install, 'dist/cli.mjs'); await copyFile(bundle, file);
  const { client } = await connect(root, file);
  const first = data(await call(client, 'network_bootstrap', { action: 'start' })); expect(first.package.slices.map((s: any) => s.path)).toEqual(['source.ts']);
  const invalid = await call(client, 'network_update', { expected: { 'network-spec/_meta.yaml': null, 'network-spec/alpha.yaml': null }, initialize: true, upserts: [{ schema: 1, id: 'alpha', summary: 'Invalid plugin reference', key_points: [], code: [{ path: 'local-plugin/dist/cli.mjs' }] }], deletes: [], verifiedReferences: [{ path: 'local-plugin/dist/cli.mjs', hash: hash(await readFile(file, 'utf8')) }], decision: { outcome: 'updated', reason: 'Inspected bundled file' } });
  expect(data(invalid).error.code).toBe('unsafe_reference'); await expect(readFile(join(root, 'network-spec/_meta.yaml'))).rejects.toMatchObject({ code: 'ENOENT' });
});
test('too_small_bootstrap_write_receipt_is_rejected_before_runtime_creation', async () => {
  const root = await tree(); roots.push(root); await repo(root); await writeFile(join(root, 'source.ts'), 'source'); const { client } = await connect(root);
  const result = await call(client, 'network_bootstrap', { action: 'start', budget: 512 });
  expect(result.isError).toBe(true); expect(data(result).error.code).toBe('response_too_large');
  await expect(readdir(join(root, '.feature-network'))).rejects.toMatchObject({ code: 'ENOENT' });
});
test('source_hash_conflict_does_not_publish_network_or_decision', async () => {
  const p = await fixture(roots); const { client } = await connect(p.root); const current = data(await call(client, 'network_context', { ids: ['alpha'], detail: 'full' }));
  const saved = await call(client, 'network_update', { expected: current.fingerprints, expectedRevision: current.revision, upserts: [{ ...current.items[0], summary: 'Wrong source' }], deletes: [], verifiedReferences: [{ path: 'source.ts', hash: '0'.repeat(64) }], decision: { outcome: 'updated', reason: 'Claimed mismatching source' } });
  expect(data(saved).error.code).toBe('conflict'); expect(data(await call(client, 'network_context', { ids: ['alpha'] })).items[0].summary).toBe('Source');
});

test('bounded_bootstrap_package_can_be_replanned_without_feature_loss', async () => {
  const p = await fixture(roots); const original = await readFile(join(p.networkDir, 'alpha.yaml'));
  for (let i = 0; i < 15; i++) await writeFile(join(p.root, `extra-${String(i).padStart(2, '0')}.ts`), 'metadata only');
  const { client } = await connect(p.root);
  const small = await call(client, 'network_bootstrap', { action: 'start', budget: 1100 }); expect(Buffer.byteLength(JSON.stringify(small))).toBeLessThanOrEqual(1100);
  expect(data(small)).toMatchObject({ status: 'pending', package: null, packageOmitted: true }); expect(data(small).nextAction).toContain('smaller maxFiles'); expect(readable(small)).toContain('Package omitted'); expect(readable(small)).toContain('smaller maxFiles');
  const large = data(await call(client, 'network_bootstrap', { action: 'next', budget: 64000 })); expect(large.package.slices).toHaveLength(16); expect(large.progress.packages).toBe(0);
  const replanned = data(await call(client, 'network_bootstrap', { action: 'start', maxFiles: 1, budget: 1100 })); expect(replanned.package.slices).toHaveLength(1);
  expect(await readFile(join(p.networkDir, 'alpha.yaml'))).toEqual(original);
});
test('bounded_check_prioritizes_late_open_reference_over_confirmed_prefix', async () => {
  const p = await fixture(roots); const { client } = await connect(p.root); const current = data(await call(client, 'network_context', { ids: ['alpha'], detail: 'full' }));
  const upserts = []; const verifiedReferences = [{ path: 'source.ts', hash: hash('source') }]; const expected: Record<string, null> = {};
  for (let i = 0; i < 9; i++) { const id = `feature-${i}`; const path = `z-source-${i}.ts`; await writeFile(join(p.root, path), 'source'); upserts.push({ schema: 1, id, summary: `Feature ${i}`, key_points: [], code: [{ path }] }); expected[`network-spec/${id}.yaml`] = null; verifiedReferences.push({ path, hash: hash('source') }); }
  expect((await call(client, 'network_update', { expected, expectedRevision: current.revision, upserts, deletes: [], verifiedReferences, decision: { outcome: 'updated', reason: 'Reviewed all actual source references' } })).isError).not.toBe(true);
  await writeFile(join(p.root, 'z-source-8.ts'), 'changed');
  const limited = await call(client, 'network_check', { mode: 'full', budget: 1400 }); expect(limited.isError).not.toBe(true); expect(Buffer.byteLength(JSON.stringify(limited))).toBeLessThanOrEqual(1400);
  expect(data(limited).openDecisions[0]).toMatchObject({ path: 'z-source-8.ts', reason: 'changed' }); expect(data(limited).references[0]).toMatchObject({ path: 'z-source-8.ts', state: 'changed' }); expect(data(limited).truncated).toBe(true); expect(readable(limited)).toContain('z-source-8.ts'); expect(readable(limited)).toContain('changed'); expect(readable(limited)).toContain('omitted');
});

test('wrong_node_major_fails_with_readable_redacted_prerequisite', async () => {
  const root = await tree(); roots.push(root); const preloader = join(root, 'older-node.mjs'); await writeFile(preloader, "Object.defineProperty(process.versions, 'node', { value: '22.0.0' });");
  const rejected = await exec(process.execPath, ['--import', preloader, bundle, 'mcp', '--project-root', root]).catch(error => error);
  expect(rejected.code).toBe(1); expect(rejected.stdout).toBe(''); expect(rejected.stderr).toContain('node_24_required'); expect(rejected.stderr).toContain('Node.js 24 LTS'); expect(rejected.stderr).not.toContain(root);
});

function readable(result: Awaited<ReturnType<typeof call>>) { return result.content?.filter(block => block.type === 'text').map(block => block.text).join('\n') ?? ''; }
// A generic text block would hide all successful results from text-only clients.
test('successful_text_reflects_each_final_tool_result', async () => {
  const p = await fixture(roots); const { client } = await connect(p.root);
  const context = await call(client, 'network_context', { ids: ['alpha'], detail: 'full' }); expect(readable(context)).toContain('alpha'); expect(readable(context)).toContain('Source');
  const impact = await call(client, 'network_impact', { ids: ['alpha'] }); expect(readable(impact)).toContain('alpha'); expect(readable(impact)).toContain('evidenced');
  const checked = await call(client, 'network_check', { mode: 'full' }); expect(readable(checked)).toContain('source.ts'); expect(readable(checked)).toContain('decision_missing'); expect(readable(checked)).toContain('full');
  const started = await call(client, 'network_bootstrap', { action: 'start' }); expect(readable(started)).toContain('pending'); expect(readable(started)).toContain('source.ts'); expect(readable(started)).toContain('0/3');
  const current = data(context);
  const saved = await call(client, 'network_update', { expected: current.fingerprints, expectedRevision: current.revision, upserts: [{ ...current.items[0], summary: 'Reviewed source' }], deletes: [], verifiedReferences: [{ path: 'source.ts', hash: hash('source') }], decision: { outcome: 'updated', reason: 'Read source and reviewed semantics' } });
  expect(saved.isError).not.toBe(true); expect(readable(saved)).toContain(data(saved).revision.slice(0, 12)); expect(readable(saved)).toContain('recorded');
  const status = await call(client, 'network_bootstrap', { action: 'status' }); expect(readable(status)).toContain(data(status).status); expect(readable(status)).toContain('last_known');
});
test('rendered_unicode_and_cursor_text_fit_complete_budget', async () => {
  const p = await fixture(roots); const { client } = await connect(p.root); const current = data(await call(client, 'network_context', { ids: ['alpha'], detail: 'full' }));
  const saved = await call(client, 'network_update', { expected: current.fingerprints, upserts: [{ ...current.items[0], summary: '😀'.repeat(400) }], deletes: [], verifiedReferences: [{ path: 'source.ts', hash: hash('source') }], decision: { outcome: 'updated', reason: 'Reviewed Unicode summary' } }); expect(saved.isError).not.toBe(true);
  const summary = await call(client, 'network_context', { ids: ['alpha'], budget: 2400 }); expect(summary.isError).not.toBe(true); expect(readable(summary)).toContain('😀'); expect(Buffer.byteLength(JSON.stringify(summary))).toBeLessThanOrEqual(2400);
  let cursor: unknown; let pages = 0;
  do {
    const page = await call(client, 'network_context', cursor ? { cursor } : { ids: ['alpha'], detail: 'full', budget: 1000 });
    expect(page.isError).not.toBe(true); expect(Buffer.byteLength(JSON.stringify(page))).toBeLessThanOrEqual(1000); expect(readable(page)).toContain('alpha');
    cursor = data(page).nextCursor;
    if (cursor) { expect(readable(page)).toContain('nextCursor'); expect(readable(page)).toContain('omitted'); } else expect(readable(page)).toContain('Complete');
    expect(pages++).toBeLessThan(100);
  } while (cursor);
});

test('minimum_budgets_include_actual_check_bootstrap_update_text', async () => {
  const p = await fixture(roots); const { client } = await connect(p.root); const current = data(await call(client, 'network_context', { ids: ['alpha'], detail: 'full' }));
  const checked = await call(client, 'network_check', { budget: 512 }); expect(Buffer.byteLength(JSON.stringify(checked))).toBeLessThanOrEqual(512);
  if (!checked.isError) { expect(readable(checked)).toContain(data(checked).freshness); if (data(checked).truncated) expect(readable(checked)).toContain('omitted'); }
  const status = await call(client, 'network_bootstrap', { action: 'status', budget: 512 }); expect(status.isError).not.toBe(true); expect(Buffer.byteLength(JSON.stringify(status))).toBeLessThanOrEqual(512); expect(readable(status)).toContain('not_started');
  const saved = await call(client, 'network_update', { expected: {}, expectedRevision: current.revision, upserts: [], deletes: [], verifiedReferences: [{ path: 'source.ts', hash: hash('source') }], decision: { outcome: 'no_semantic_change', reason: 'Source remains semantically unchanged' }, budget: 512 });
  expect(saved.isError).not.toBe(true); expect(Buffer.byteLength(JSON.stringify(saved))).toBeLessThanOrEqual(512); expect(readable(saved)).toContain(data(saved).revision.slice(0, 12)); expect(readable(saved)).toContain('recorded'); if (data(saved).truncated) expect(readable(saved)).toContain('omitted');
});

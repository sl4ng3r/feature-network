import { describe, afterEach, expect, test } from 'vitest';
import { Client } from '@modelcontextprotocol/client';
import { StdioClientTransport } from '@modelcontextprotocol/client/stdio';
import { mkdtemp, readFile, readdir, writeFile, rm, copyFile, mkdir } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { pathToFileURL } from 'node:url';
import { fixture, hash } from '../freshness/fixture.js';
import { cleanup, exec, repo, tree } from '../project/helpers.js';
import { readSnapshot } from '../../src/storage/repository.js';

const roots: string[] = [];
const clients: Client[] = [];
const requestSignals = new WeakMap<Client, AbortSignal>();
const bundle = resolve('plugin/dist/cli.mjs');
afterEach(async () => { await Promise.all(clients.splice(0).map(c => c.close())); await Promise.all(roots.splice(0).map(cleanup)); });
async function connect(root: string, file = bundle, signal?: AbortSignal) {
  const client = new Client({ name: 'feature-network-tests', version: '1.0.0' }); clients.push(client);
  if (signal) requestSignals.set(client, signal);
  const transport = new StdioClientTransport({ command: process.execPath, args: [file, 'mcp', '--project-root', root], stderr: 'pipe' });
  let stderr = ''; transport.stderr?.on('data', chunk => { stderr += chunk.toString(); });
  try { await client.connect(transport, { ...(signal ? { signal } : {}), timeout: 15000 }); } catch (error) { throw new Error(`${String(error)} stderr: ${stderr}`); }
  return { client, stderr: () => stderr };
}
async function call(client: Client, name: string, args: Record<string, unknown> = {}) {
  const signal = requestSignals.get(client);
  return client.callTool({ name, arguments: args }, signal ? { signal } : undefined);
}
function data(result: Awaited<ReturnType<typeof call>>) { return result.structuredContent as Record<string, any>; }
// Catches a missing server/registration by observing the real SDK client's tool list.
// Real filesystem/Git/process integration: finite hosted-runner budget; unit defaults stay unchanged.
describe('repository integration', { timeout: 20000 }, () => {
test('lists_exactly_five_tools', async ({ signal }) => {
  const root = await tree(); roots.push(root);
  const { client } = await connect(root, bundle, signal); const names = (await client.listTools(undefined, { signal })).tools.map(t => t.name).sort();
  expect(names).toEqual(['network_bootstrap', 'network_check', 'network_context', 'network_impact', 'network_update']);
});
test('uninitialized_reads_create_nothing_and_root_cannot_switch', async ({ signal }) => {
  const root = await tree(); roots.push(root); const { client } = await connect(root, bundle, signal);
  expect(data(await call(client, 'network_context')).error.code).toBe('not_initialized');
  expect(data(await call(client, 'network_impact')).error.code).toBe('not_initialized');
  expect(data(await call(client, 'network_check')).integrity).toBe('not_initialized');
  expect(data(await call(client, 'network_bootstrap', { action: 'status' })).status).toBe('not_started');
  const rejected = await call(client, 'network_check', { projectRoot: '/should-not-bind' });
  expect(rejected.isError).toBe(true); expect(data(rejected).error.code).toBe('invalid_input');
  expect(await readdir(root)).toEqual([]);
});
test('bootstrap_before_marker_and_checkpoint_CAS_work', async ({ signal }) => {
  const root = await tree(); roots.push(root); await repo(root); await writeFile(join(root, 'source.ts'), 'source');
  const { client } = await connect(root, bundle, signal); const first = data(await call(client, 'network_bootstrap', { action: 'start' }));
  expect(first.status).toBe('pending'); expect(first.package.slices[0]).toMatchObject({ path: 'source.ts', fileHash: hash('source'), startByte: 0, endByte: 6 });
  expect(JSON.stringify(first)).not.toContain('"text":"source"');
  const bad = await call(client, 'network_bootstrap', { action: 'checkpoint', expectedRunRevision: '0'.repeat(64), packageId: first.package.id, networkRevision: first.networkRevision, sources: [], featureFingerprints: {}, results: [] });
  expect(data(bad).error.code).toBe('conflict');
  expect(data(await call(client, 'network_bootstrap', { action: 'status' })).runRevision).toBe(first.runRevision);
  await expect(readFile(join(root, 'network-spec/_meta.yaml'))).rejects.toMatchObject({ code: 'ENOENT' });
});
test('invalid_input_returns_redacted_stable_code', async ({ signal }) => {
  const p = await fixture(roots); const { client, stderr } = await connect(p.root, bundle, signal);
  for (const args of [{ budget: 511 }, { cursor: 'bad' }, { query: { secret: p.root } }, { callback: 'eval(secret)' }]) {
    const result = await call(client, 'network_context', args); expect(result.isError).toBe(true); expect(data(result).error.code).toBe('invalid_input');
    expect(JSON.stringify(result)).not.toContain(p.root); expect(JSON.stringify(result)).not.toContain('eval(secret)');
  }
  expect(stderr()).toBe('');
});
test('optimistic_update_conflicts_and_semantic_decisions_are_separate', async ({ signal }) => {
  const p = await fixture(roots); const { client } = await connect(p.root, bundle, signal);
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
test('missing_observation_requires_repair_and_does_not_invent_baseline', async ({ signal }) => {
  const p = await fixture(roots); await writeFile(join(p.root, 'unmapped-source.ts'), 'aux'); await exec('git', ['-C', p.root, 'add', 'unmapped-source.ts']); await rm(join(p.root, 'unmapped-source.ts'));
  const snap = await readSnapshot(p); const { client } = await connect(p.root, bundle, signal);
  const result = await call(client, 'network_update', { expected: {}, expectedRevision: snap.revision, upserts: [], deletes: [], verifiedReferences: [], observations: [{ path: 'unmapped-source.ts', state: 'missing' }], decision: { outcome: 'no_semantic_change', reason: 'Deleted helper has no feature semantics' } });
  expect(result.isError).not.toBe(true);
  expect(data(await call(client, 'network_check', { mode: 'full' })).unknownChangeDecisions).toContainEqual({ path: 'unmapped-source.ts', state: 'missing_no_semantic_change' });
  expect(JSON.parse(await readFile(join(p.runtimeDir, 'baselines.json'), 'utf8')).references).not.toHaveProperty('unmapped-source.ts');
});
test('complete_tool_result_budget_and_unicode_continuation', async ({ signal }) => {
  const p = await fixture(roots); const snap = await readSnapshot(p); const { client } = await connect(p.root, bundle, signal);
  const saved = await call(client, 'network_update', { expected: snap.fingerprints, upserts: [{ ...snap.features[0], summary: '😀'.repeat(3000) }], deletes: [], verifiedReferences: [{ path: 'source.ts', hash: hash('source') }], decision: { outcome: 'updated', reason: 'Reviewed long feature summary' } }); expect(saved.isError).not.toBe(true);
  let cursor: unknown; let text = ''; let pages = 0;
  do {
    const result = await call(client, 'network_context', cursor ? { cursor } : { ids: ['alpha'], detail: 'full', budget: 1100 });
    expect(result.isError).not.toBe(true); expect(Buffer.byteLength(JSON.stringify(result))).toBeLessThanOrEqual(1100);
    const row = data(result).items[0]; expect(row.fragment.offset).toBe(text.length); text += row.fragment.text; cursor = data(result).nextCursor;
    expect(pages++).toBeLessThan(200);
  } while (cursor);
  expect(JSON.parse(text).summary).toBe('😀'.repeat(3000));
  const small = await call(client, 'network_context', { ids: ['alpha'], detail: 'full', budget: 512 });
  expect(Buffer.byteLength(JSON.stringify(small))).toBeLessThanOrEqual(512);
  expect(data(await call(client, 'network_impact', { budget: 512 }))).toHaveProperty('revision');
// Up to 200 real SDK roundtrips revalidate Git/source state; bound the whole exchange separately.
}, 180000);
test('pending_journal_is_not_recovered_by_reads', async ({ signal }) => {
  const p = await fixture(roots); const path = join(p.runtimeDir, 'journal.json'); await writeFile(path, 'unreadable journal'); const { client } = await connect(p.root, bundle, signal);
  expect(data(await call(client, 'network_check', { mode: 'full' })).integrity).toBe('pending_recovery');
  expect(data(await call(client, 'network_context')).error.code).toBe('pending_recovery');
  expect(data(await call(client, 'network_bootstrap', { action: 'status' })).status).toBe('pending_recovery');
  expect(await readFile(path, 'utf8')).toBe('unreadable journal');
});
test('bundle_runs_offline_without_node_modules_and_stdout_is_only_protocol', async ({ signal }) => {
  const root = await tree(); roots.push(root); const install = await mkdtemp(join(tmpdir(), 'fn-plugin-')); roots.push(install);
  await mkdir(join(install, 'dist')); const file = join(install, 'dist/cli.mjs'); await copyFile(bundle, file);
  const { client, stderr } = await connect(root, file, signal); expect((await client.listTools(undefined, { signal })).tools).toHaveLength(5); expect(stderr()).toBe('');
  const input = JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-11-25', capabilities: {}, clientInfo: { name: 'raw', version: '1' } } }) + '\n';
  const { spawn } = await import('node:child_process');
  const raw = await new Promise<string>((resolveOutput, reject) => {
    const child = spawn(process.execPath, [file, 'mcp', '--project-root', root], { signal });
    let stdout = ''; let timedOut = false; let failure: Error | undefined;
    const timer = setTimeout(() => { timedOut = true; child.kill('SIGKILL'); }, 10000);
    child.stdout.on('data', chunk => { stdout += chunk; if (stdout.includes('\n')) child.kill(); });
    child.on('error', error => { failure = error; child.kill('SIGKILL'); }); child.stdin.on('error', () => {});
    child.on('close', () => { clearTimeout(timer); if (failure) reject(failure); else if (timedOut) reject(new Error('raw_mcp_protocol_timeout')); else resolveOutput(stdout); });
    child.stdin.end(input);
  });
  expect(raw.trim().split('\n').map(line => JSON.parse(line))).toEqual([expect.objectContaining({ jsonrpc: '2.0', id: 1, result: expect.any(Object) })]);
  const invalid = await exec(process.execPath, [file, 'mcp']).catch(error => error); expect(invalid.stdout).toBe(''); expect(invalid.stderr).toContain('project_root_required'); expect(invalid.stderr).not.toContain(root);
});

test('bootstrap_receipts_complete_only_with_explicit_relational_review', async ({ signal }) => {
  const p = await fixture(roots); const { client } = await connect(p.root, bundle, signal);
  const current = data(await call(client, 'network_context', { ids: ['alpha'], detail: 'full' }));
  const first = data(await call(client, 'network_bootstrap', { action: 'start' }));
  const receipt = { action: 'checkpoint', expectedRunRevision: first.runRevision, packageId: first.package.id, networkRevision: current.revision, sources: [{ path: 'source.ts', hash: hash('source') }], featureFingerprints: { alpha: current.fingerprints['network-spec/alpha.yaml'] }, results: first.package.slices.map((s: any) => ({ path: s.path, startByte: s.startByte, endByte: s.endByte, featureIds: ['alpha'], outcome: 'analyzed', reason: 'Read slice and checked saved feature' })) };
  const ack = data(await call(client, 'network_bootstrap', receipt)); expect(ack.status).toBe('awaiting_relational_review');
  const final = { action: 'checkpoint', expectedRunRevision: ack.runRevision, packageId: null, networkRevision: current.revision, sources: [], featureFingerprints: { alpha: current.fingerprints['network-spec/alpha.yaml'] }, results: [] };
  expect(data(await call(client, 'network_bootstrap', final)).error.code).toBe('invalid_checkpoint');
  const done = data(await call(client, 'network_bootstrap', { ...final, relationalReviewComplete: true, reason: 'Reviewed all captured relationships' }));
  expect(done).toMatchObject({ status: 'completed', coverage: 'partial', progress: { relationalReviewComplete: true } });
});
test('installed_plugin_root_is_excluded_from_inventory_and_reference_writes', async ({ signal }) => {
  const root = await tree(); roots.push(root); await repo(root); await writeFile(join(root, 'source.ts'), 'source');
  const install = join(root, 'local-plugin'); await mkdir(join(install, 'dist'), { recursive: true }); const file = join(install, 'dist/cli.mjs'); await copyFile(bundle, file);
  const { client } = await connect(root, file, signal);
  const first = data(await call(client, 'network_bootstrap', { action: 'start' })); expect(first.package.slices.map((s: any) => s.path)).toEqual(['source.ts']);
  const invalid = await call(client, 'network_update', { expected: { 'network-spec/_meta.yaml': null, 'network-spec/alpha.yaml': null }, initialize: true, upserts: [{ schema: 1, id: 'alpha', summary: 'Invalid plugin reference', key_points: [], code: [{ path: 'local-plugin/dist/cli.mjs' }] }], deletes: [], verifiedReferences: [{ path: 'local-plugin/dist/cli.mjs', hash: hash(await readFile(file, 'utf8')) }], decision: { outcome: 'updated', reason: 'Inspected bundled file' } });
  expect(data(invalid).error.code).toBe('unsafe_reference'); await expect(readFile(join(root, 'network-spec/_meta.yaml'))).rejects.toMatchObject({ code: 'ENOENT' });
});
test('too_small_bootstrap_write_receipt_is_rejected_before_runtime_creation', async ({ signal }) => {
  const root = await tree(); roots.push(root); await repo(root); await writeFile(join(root, 'source.ts'), 'source'); const { client } = await connect(root, bundle, signal);
  const result = await call(client, 'network_bootstrap', { action: 'start', budget: 512 });
  expect(result.isError).toBe(true); expect(data(result).error.code).toBe('response_too_large');
  await expect(readdir(join(root, '.feature-network'))).rejects.toMatchObject({ code: 'ENOENT' });
});
test('source_hash_conflict_does_not_publish_network_or_decision', async ({ signal }) => {
  const p = await fixture(roots); const { client } = await connect(p.root, bundle, signal); const current = data(await call(client, 'network_context', { ids: ['alpha'], detail: 'full' }));
  const saved = await call(client, 'network_update', { expected: current.fingerprints, expectedRevision: current.revision, upserts: [{ ...current.items[0], summary: 'Wrong source' }], deletes: [], verifiedReferences: [{ path: 'source.ts', hash: '0'.repeat(64) }], decision: { outcome: 'updated', reason: 'Claimed mismatching source' } });
  expect(data(saved).error.code).toBe('conflict'); expect(data(await call(client, 'network_context', { ids: ['alpha'] })).items[0].summary).toBe('Source');
});

test('bounded_bootstrap_package_can_be_replanned_without_feature_loss', async ({ signal }) => {
  const p = await fixture(roots); const original = await readFile(join(p.networkDir, 'alpha.yaml'));
  for (let i = 0; i < 15; i++) await writeFile(join(p.root, `extra-${String(i).padStart(2, '0')}.ts`), 'metadata only');
  const { client } = await connect(p.root, bundle, signal);
  const small = await call(client, 'network_bootstrap', { action: 'start', budget: 1100 }); expect(Buffer.byteLength(JSON.stringify(small))).toBeLessThanOrEqual(1100);
  expect(data(small)).toMatchObject({ status: 'pending', package: null, packageOmitted: true }); expect(data(small).nextAction).toContain('smaller maxFiles'); expect(readable(small)).toContain('Package omitted'); expect(readable(small)).toContain('smaller maxFiles');
  const large = data(await call(client, 'network_bootstrap', { action: 'next', budget: 64000 })); expect(large.package.slices).toHaveLength(16); expect(large.progress.packages).toBe(0);
  const replanned = data(await call(client, 'network_bootstrap', { action: 'start', maxFiles: 1, budget: 1800 })); expect(replanned.package.slices).toHaveLength(1);
  expect(await readFile(join(p.networkDir, 'alpha.yaml'))).toEqual(original);
});
test('bounded_check_prioritizes_late_open_reference_over_confirmed_prefix', async ({ signal }) => {
  const p = await fixture(roots); const { client } = await connect(p.root, bundle, signal); const current = data(await call(client, 'network_context', { ids: ['alpha'], detail: 'full' }));
  const upserts = []; const verifiedReferences = [{ path: 'source.ts', hash: hash('source') }]; const expected: Record<string, null> = {};
  for (let i = 0; i < 9; i++) { const id = `feature-${i}`; const path = `z-source-${i}.ts`; await writeFile(join(p.root, path), 'source'); upserts.push({ schema: 1, id, summary: `Feature ${i}`, key_points: [], code: [{ path }] }); expected[`network-spec/${id}.yaml`] = null; verifiedReferences.push({ path, hash: hash('source') }); }
  expect((await call(client, 'network_update', { expected, expectedRevision: current.revision, upserts, deletes: [], verifiedReferences, decision: { outcome: 'updated', reason: 'Reviewed all actual source references' } })).isError).not.toBe(true);
  await writeFile(join(p.root, 'z-source-8.ts'), 'changed');
  const limited = await call(client, 'network_check', { mode: 'full', budget: 1400 }); expect(limited.isError).not.toBe(true); expect(Buffer.byteLength(JSON.stringify(limited))).toBeLessThanOrEqual(1400);
  expect(data(limited).openDecisions[0]).toMatchObject({ path: 'z-source-8.ts', reason: 'changed' }); expect(data(limited).references[0]).toMatchObject({ path: 'z-source-8.ts', state: 'changed' }); expect(data(limited).truncated).toBe(true); expect(readable(limited)).toContain('z-source-8.ts'); expect(readable(limited)).toContain('changed'); expect(readable(limited)).toContain('omitted');
});

test('wrong_node_major_fails_with_readable_redacted_prerequisite', async ({ signal }) => {
  const root = await tree(); roots.push(root); const preloader = join(root, 'older-node Ü #.mjs'); await writeFile(preloader, "Object.defineProperty(process.versions, 'node', { value: '22.0.0' });");
  const rejected = await exec(process.execPath, ['--import', pathToFileURL(preloader).href, bundle, 'mcp', '--project-root', root], { signal, timeout: 15000 }).catch(error => error);
  expect(rejected.code).toBe(1); expect(rejected.stdout).toBe(''); expect(rejected.stderr).toContain('node_24_required'); expect(rejected.stderr).toContain('Node.js 24 LTS'); expect(rejected.stderr).not.toContain(root);
});

function readable(result: Awaited<ReturnType<typeof call>>) { return result.content?.filter(block => block.type === 'text').map(block => block.text).join('\n') ?? ''; }
// A generic text block would hide all successful results from text-only clients.
test('successful_text_reflects_each_final_tool_result', async ({ signal }) => {
  const p = await fixture(roots); const { client } = await connect(p.root, bundle, signal);
  const context = await call(client, 'network_context', { ids: ['alpha'], detail: 'full' }); expect(readable(context)).toContain('alpha'); expect(readable(context)).toContain('Source');
  const impact = await call(client, 'network_impact', { ids: ['alpha'] }); expect(readable(impact)).toContain('alpha'); expect(readable(impact)).toContain('evidenced');
  const checked = await call(client, 'network_check', { mode: 'full' }); expect(readable(checked)).toContain('source.ts'); expect(readable(checked)).toContain('decision_missing'); expect(readable(checked)).toContain('full');
  const started = await call(client, 'network_bootstrap', { action: 'start' }); expect(readable(started)).toContain('pending'); expect(readable(started)).toContain('source.ts'); expect(readable(started)).toContain('0/3');
  const current = data(context);
  const saved = await call(client, 'network_update', { expected: current.fingerprints, expectedRevision: current.revision, upserts: [{ ...current.items[0], summary: 'Reviewed source' }], deletes: [], verifiedReferences: [{ path: 'source.ts', hash: hash('source') }], decision: { outcome: 'updated', reason: 'Read source and reviewed semantics' } });
  expect(saved.isError).not.toBe(true); expect(readable(saved)).toContain(data(saved).revision.slice(0, 12)); expect(readable(saved)).toContain('recorded');
  const status = await call(client, 'network_bootstrap', { action: 'status' }); expect(readable(status)).toContain(data(status).status); expect(readable(status)).toContain('last_known');
});
test('rendered_unicode_and_cursor_text_fit_complete_budget', async ({ signal }) => {
  const p = await fixture(roots);
  // Hosted images register Git LFS globally; an unused driver must not add a
  // spurious coverage diagnostic that displaces the actual Unicode summary.
  await exec('git', ['-C', p.root, 'config', 'filter.unused.process', 'exit 1']);
  const { client } = await connect(p.root, bundle, signal); const current = data(await call(client, 'network_context', { ids: ['alpha'], detail: 'full' }));
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
}, 60000);

test('minimum_budgets_include_actual_check_bootstrap_update_text', async ({ signal }) => {
  const p = await fixture(roots); const { client } = await connect(p.root, bundle, signal); const current = data(await call(client, 'network_context', { ids: ['alpha'], detail: 'full' }));
  const checked = await call(client, 'network_check', { budget: 512 }); expect(Buffer.byteLength(JSON.stringify(checked))).toBeLessThanOrEqual(512);
  if (!checked.isError) { expect(readable(checked)).toContain(data(checked).freshness); if (data(checked).truncated) expect(readable(checked)).toContain('omitted'); }
  const status = await call(client, 'network_bootstrap', { action: 'status', budget: 512 }); expect(status.isError).not.toBe(true); expect(Buffer.byteLength(JSON.stringify(status))).toBeLessThanOrEqual(512); expect(readable(status)).toContain('not_started');
  const saved = await call(client, 'network_update', { expected: {}, expectedRevision: current.revision, upserts: [], deletes: [], verifiedReferences: [{ path: 'source.ts', hash: hash('source') }], decision: { outcome: 'no_semantic_change', reason: 'Source remains semantically unchanged' }, budget: 512 });
  expect(saved.isError).not.toBe(true); expect(Buffer.byteLength(JSON.stringify(saved))).toBeLessThanOrEqual(512); expect(readable(saved)).toContain(data(saved).revision.slice(0, 12)); expect(readable(saved)).toContain('recorded'); if (data(saved).truncated) expect(readable(saved)).toContain('omitted');
});

test('query_freshness_tracks_review_changed_source_and_cache_loss_on_real_tools', async ({ signal }) => {
  const p = await fixture(roots); const { client } = await connect(p.root, bundle, signal);
  const snap = await readSnapshot(p);
  expect((await call(client, 'network_update', { expected: {}, expectedRevision: snap.revision, upserts: [], deletes: [], verifiedReferences: [{path:'source.ts',hash:hash('source')}], decision:{outcome:'no_semantic_change',reason:'Inspected source'} })).isError).not.toBe(true);
  for (const tool of ['network_context', 'network_impact']) {
    const fresh = data(await call(client, tool, { ids:['alpha'] }));
    expect(fresh.freshness.alpha).toEqual({state:'current',review:'recorded'});
  }
  await writeFile(join(p.root,'source.ts'),'edited');
  for (const tool of ['network_context','network_impact']) {
    const changed = await call(client,tool,{ids:['alpha']});
    expect(data(changed).freshness.alpha).toEqual({state:'changed',review:'open'});
    expect(readable(changed)).toContain('changed');
  }
  await rm(p.runtimeDir,{recursive:true,force:true});
  const unknown = data(await call(client,'network_context',{ids:['alpha']}));
  expect(unknown.freshness.alpha).toEqual({state:'unknown',review:'open'});
  await expect(readFile(join(p.runtimeDir,'values/read-cache.json'))).rejects.toMatchObject({code:'ENOENT'});
}, 20000);
test('bootstrap_exposes_package_free_blockers_scope_and_revision_bound_record_pages', async ({ signal }) => {
  const root = await tree(); roots.push(root); await repo(root);
  await writeFile(join(root,'broken.txt'),Buffer.from([0xff])); await writeFile(join(root,'.env'),'secret');
  for(let i=0;i<18;i++)await writeFile(join(root,`excluded-${i}.txt`),'not emitted');
  const {client}=await connect(root, bundle, signal);
  const first = data(await call(client,'network_bootstrap',{action:'start',exclusions:Array.from({length:18},(_,i)=>`excluded-${i}.txt`),budget:64000}));
  expect(first.status).toBe('needs_review'); expect(first.package).toBeNull();
  expect(first.records).toContainEqual({path:'broken.txt',status:'needs_review',reason:'unreadable_or_non_utf8'});
  expect(first.records).toContainEqual({path:'.env',status:'excluded',reason:'sensitive'});
  expect(first.selectedScope.exclusions).toHaveLength(18);
  const seen:string[]=[]; let recordCursor:unknown;
  do {
    const response=await call(client,'network_bootstrap',{action:'status',recordFilter:'excluded',...(recordCursor?{recordCursor}:{}),budget:1600});
    expect(response.isError).not.toBe(true); expect(Buffer.byteLength(JSON.stringify(response))).toBeLessThanOrEqual(1600);
    const page=data(response); seen.push(...page.records.map((r:any)=>r.path)); recordCursor=page.nextRecordCursor;
    expect(page.recordsOmitted).toBe(19-seen.length);
  }while(recordCursor);
  expect(new Set(seen).size).toBe(19); expect(JSON.stringify(first)).not.toContain('secret');
});

test('bootstrap_nested_exclusions_scope_continuation_and_small_budget_are_explicit',async({signal})=>{
 const root=await tree();roots.push(root);await repo(root);await mkdir(join(root,'nested'));await repo(join(root,'nested'));
 await writeFile(join(root,'nested','source.ts'),'never read nested source');await writeFile(join(root,'source.ts'),'source');
 const {client}=await connect(root, bundle, signal);
 const start=data(await call(client,'network_bootstrap',{action:'start',scope:['source.ts'],budget:64000}));
 expect(start.records.some((record:any)=>record.path==='nested'&&record.status==='excluded')).toBe(true);
 expect(start.selectedScope.scope).toEqual(['source.ts']);
 const scope=data(await call(client,'network_bootstrap',{action:'status',recordFilter:'scope',budget:1400}));
 expect(scope.records).toEqual([{path:'source.ts',status:'scope',reason:'selected_scope'}]);
 const small=await call(client,'network_bootstrap',{action:'status',recordFilter:'excluded',budget:512});
 expect(Buffer.byteLength(JSON.stringify(small))).toBeLessThanOrEqual(512);
 expect(data(small).error.code).toBe('response_too_large');
 const stale=await call(client,'network_bootstrap',{action:'status',recordCursor:{revision:'0'.repeat(64),filter:'excluded',offset:0}});
 expect(data(stale).error.code).toBe('stale_cursor');
});

test('bootstrap_long_blocker_keeps_successful_write_receipt_and_reachable_reason',async({signal})=>{
 const root=await tree();roots.push(root);await repo(root);
 // Git for Windows directory enumeration opts into MAX_PATH support independently of Node.
 // Change only this synthetic repository, preserving the original long-path receipt workload.
 await exec('git',['-C',root,'config','--local','core.longpaths','true']);
 const folder=Array.from({length:4},(_,i)=>`${i}-${'a'.repeat(180)}`).join('/');
 await mkdir(join(root,folder),{recursive:true});await writeFile(join(root,folder,'.env'),'private synthetic content');
 const inventoried=await exec('git',['-C',root,'ls-files','--others','--exclude-standard','-z','--','.']);
 expect(inventoried.stdout.split('\0')).toContain(`${folder}/.env`);
 const {client}=await connect(root, bundle, signal);
 const response=await call(client,'network_bootstrap',{action:'start',budget:1100});
 expect(response.isError).not.toBe(true);expect(Buffer.byteLength(JSON.stringify(response))).toBeLessThanOrEqual(1100);
 const receipt=data(response);expect(receipt.recordsOmitted).toBe(1);expect(receipt.nextRecordCursor).toBeDefined();
 const full=data(await call(client,'network_bootstrap',{action:'status',recordCursor:receipt.nextRecordCursor,budget:64000}));
 expect(full.records).toEqual([{path:`${folder}/.env`,status:'excluded',reason:'sensitive'}]);
});

});

import { describe, afterEach, expect, test, vi } from 'vitest';
import { mkdir, readFile, rm, writeFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { checkNetwork } from '../../src/freshness/check.js';
import { startTurn } from '../../src/freshness/session.js';
import { readRuntime } from '../../src/storage/runtime.js';
import { openProject } from '../../src/project/root.js';
import { fixture } from './fixture.js';
import { cleanup, tree } from '../project/helpers.js';

const roots: string[] = [];
afterEach(async () => { vi.unstubAllEnvs(); await Promise.all(roots.splice(0).map(cleanup)); });
// Real filesystem/Git/process integration: finite hosted-runner budget; unit defaults stay unchanged.
describe('repository integration', { timeout: 20000 }, () => {
test('fresh_clone_starts_unknown', async () => {
  const p = await fixture(roots); await rm(join(p.runtimeDir, 'baselines.json'));
  const result = await checkNetwork(p, 'full'); expect(result.references).toContainEqual(expect.objectContaining({ path: 'source.ts', state: 'unknown' }));
  expect(result.openDecisions.map(d => d.path)).toEqual(['source.ts']);
});
test('full_check_does_not_confirm_hash_or_write_runtime', async () => {
  const p = await fixture(roots); const before = await readRuntime(p, 'baselines'); const runtime = await readdir(p.runtimeDir);
  await writeFile(join(p.root, 'source.ts'), 'changed'); const result = await checkNetwork(p, 'full');
  expect(result.references).toContainEqual(expect.objectContaining({ path: 'source.ts', state: 'changed' })); expect(result.lastCheckedAt).toMatch(/^\d{4}-/);
  expect(await readRuntime(p, 'baselines')).toEqual(before); expect(await readdir(p.runtimeDir)).toEqual(runtime);
});
test('summary_is_labelled_last_known', async () => {
  const p = await fixture(roots); await writeFile(join(p.root, 'source.ts'), 'changed');
  const result = await checkNetwork(p, 'summary'); expect(result.freshness).toBe('last_known'); expect(result.lastCheckedAt).toBeNull();
  expect(result.references).toContainEqual(expect.objectContaining({ path: 'source.ts', state: 'current' }));
});
test('ignores_runtime_and_build_outputs', async () => {
  const p = await fixture(roots); await startTurn(p, 's');
  for (const dir of ['dist', 'build', 'coverage', 'node_modules']) { await mkdir(join(p.root, dir)); await writeFile(join(p.root, dir, 'new.ts'), 'output'); }
  await writeFile(join(p.runtimeDir, 'private.json'), '{}'); await writeFile(join(p.root, 'new.ts'), 'actual');
  const result = await checkNetwork(p, 'full', 's'); expect(result.unknownChanges).toEqual(['new.ts']); expect(result.turnChanges).toEqual(['new.ts']);
});
test('git_failure_is_reported_without_clean_coverage', async () => {
  const p = await fixture(roots); await startTurn(p, 's'); vi.stubEnv('PATH', join(p.root, 'no executable'));
  const result = await checkNetwork(p, 'full', 's'); expect(result.changeCoverage).toBe('unknown'); expect(result.turnAssumptions).toBe('invalidated');
  expect(result.diagnostics).toContainEqual(expect.objectContaining({ code: 'git_unavailable' }));
});
test.each(['summary', 'full'] as const)('pending_recovery_blocks_%s_without_writes', async mode => {
  const p = await fixture(roots); const bytes = await readFile(join(p.networkDir, 'alpha.yaml')); await writeFile(join(p.runtimeDir, 'journal.json'), '{');
  const entries = await readdir(p.runtimeDir); const result = await checkNetwork(p, mode, 's');
  expect(result.integrity).toBe('pending_recovery'); expect(result.references).toEqual([]);
  expect((await startTurn(p, 's')).integrity).toBe('pending_recovery'); expect(await readdir(p.runtimeDir)).toEqual(entries);
  expect(await readFile(join(p.networkDir, 'alpha.yaml'))).toEqual(bytes); expect(await readFile(join(p.runtimeDir, 'journal.json'), 'utf8')).toBe('{');
});
test('uninitialized_reads_do_not_initialize_or_create_runtime', async () => {
  const root = await tree(); roots.push(root); const p = await openProject(root);
  expect((await checkNetwork(p, 'full')).integrity).toBe('not_initialized'); expect((await startTurn(p, 's')).integrity).toBe('not_initialized'); expect(await readdir(root)).toEqual([]);
});
test('missing_reference_is_reported_despite_invalid_snapshot', async () => {
  const p = await fixture(roots); await rm(join(p.root, 'source.ts')); const result = await checkNetwork(p, 'full');
  expect(result.integrity).toBe('invalid'); expect(result.references).toContainEqual(expect.objectContaining({ path: 'source.ts', state: 'missing' }));
});

test('corrupt_decision_cache_does_not_turn_matching_baseline_into_completed_review', async () => {
  const p = await fixture(roots); await mkdir(join(p.runtimeDir, 'values/freshness'), { recursive: true });
  await writeFile(join(p.runtimeDir, 'values/freshness/decisions.json'), '{}');
  const result = await checkNetwork(p, 'full');
  expect(result.openDecisions).toContainEqual(expect.objectContaining({ path: 'source.ts', reason: 'decision_missing' }));
  expect(result.diagnostics).toContainEqual(expect.objectContaining({ code: 'invalid_decisions' }));
});

});

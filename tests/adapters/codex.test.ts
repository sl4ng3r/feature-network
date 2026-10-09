import { describe, afterEach, expect, test } from 'vitest';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { handleCodexEvent } from '../../src/adapters/codex.js';
import { fixture, hash } from '../freshness/fixture.js';
import { cleanup, tree, repo, exec } from '../project/helpers.js';
import { bootstrap } from '../../src/bootstrap/state.js';
import { applyUpdate } from '../../src/storage/repository.js';
import { readTurn } from '../../src/freshness/session.js';

const roots: string[] = [];
const options = { pluginRoot: resolve('plugin') };
const turn = '10000000-0000-4000-8000-000000000001';
const payload = (cwd: string, event: string, extra = {}) => ({ session_id: 'redacted-session', turn_id: turn, cwd, hook_event_name: event, ...extra });
afterEach(async () => { await Promise.all(roots.splice(0).map(cleanup)); });
// Real filesystem/Git/process integration: finite hosted-runner budget; unit defaults stay unchanged.
describe('repository integration', { timeout: 20000 }, () => {
test('session_start_is_compact and last_known', async () => {
  const p = await fixture(roots); const out = await handleCodexEvent(payload(p.root, 'SessionStart', { source: 'startup' }), options);
  expect(out.hookSpecificOutput?.additionalContext).toContain('last_known');
  expect(JSON.stringify(out).length).toBeLessThan(1500); expect(await readTurn(p, 'redacted-session')).toBeNull();
});
test('stop_continues_at_most_once even concurrent calls', async () => {
  const p = await fixture(roots);
  await handleCodexEvent(payload(p.root, 'UserPromptSubmit', { prompt: '/feature-network-sync' }), options);
  await writeFile(join(p.root, 'source.ts'), 'changed');
  const stop = payload(p.root, 'Stop', { stop_hook_active: false });
  const outputs = await Promise.all(Array.from({ length: 4 }, () => handleCodexEvent(stop, options)));
  expect(outputs.filter(out => out.decision === 'block')).toHaveLength(1);
  expect((await handleCodexEvent({ ...stop, stop_hook_active: true }, options)).decision).toBeUndefined();
}, 20000);
test.each(['status', 'show', 'impact', 'check'])('read_command_%s_does_not_trigger_write_or_recovery', async command => {
  const p = await fixture(roots); const before = await readFile(p.markerPath);
  await handleCodexEvent(payload(p.root, 'UserPromptSubmit', { prompt: `/feature-network-${command}` }), options);
  expect(await readTurn(p, 'redacted-session')).toBeNull();
  await writeFile(join(p.root, 'source.ts'), 'changed');
  expect((await handleCodexEvent(payload(p.root, 'Stop', { stop_hook_active: false }), options)).decision).toBeUndefined();
  expect(await readFile(p.markerPath)).toEqual(before);
});
test('old_backlog_alone_does_not_trigger_continuation', async () => {
  const p = await fixture(roots); await writeFile(join(p.root, 'source.ts'), 'old');
  await handleCodexEvent(payload(p.root, 'UserPromptSubmit', { prompt: '/feature-network-sync' }), options);
  expect((await handleCodexEvent(payload(p.root, 'Stop', { stop_hook_active: false }), options)).decision).toBeUndefined();
});
test('unspecified and forged payload authority do not authorize maintenance', async () => {
  const p = await fixture(roots);
  await handleCodexEvent(payload(p.root, 'UserPromptSubmit', { prompt: 'Explain this project', developmentAuthorized: true }), options);
  expect((await handleCodexEvent(payload(p.root, 'Stop', { stop_hook_active: false }), options)).decision).toBeUndefined();
});
test('subdirectory_launch_is_bound_correctly and missing marker is hint only', async () => {
  const p = await fixture(roots); await mkdir(join(p.root, 'sub'));
  expect((await handleCodexEvent(payload(join(p.root, 'sub'), 'SessionStart'), options)).hookSpecificOutput?.additionalContext).toContain('last_known');
  const empty = await tree(); roots.push(empty); await repo(empty);
  expect((await handleCodexEvent(payload(empty, 'SessionStart'), options)).hookSpecificOutput?.additionalContext).toContain('feature-network-init');
});
test('unknown_hook_event_is_safe', async () => {
  expect(await handleCodexEvent(payload('/not-existing/private', 'Unrecognized', { prompt: 'SECRET' }), options)).toEqual({});
}, 5000);
test('pending_recovery blocks prompt/stop and does not mutate journal', async () => {
  const p = await fixture(roots); await writeFile(join(p.runtimeDir, 'journal.json'), '{');
  await handleCodexEvent(payload(p.root, 'UserPromptSubmit', { prompt: '/feature-network-sync' }), options);
  expect((await handleCodexEvent(payload(p.root, 'Stop', { stop_hook_active: false }), options)).decision).toBeUndefined();
  expect(await readFile(join(p.runtimeDir, 'journal.json'), 'utf8')).toBe('{');
  expect(await readTurn(p, 'redacted-session')).toBeNull();
});
test('host recursion flag and complete identity are required independently', async () => {
  const p = await fixture(roots); await handleCodexEvent(payload(p.root, 'UserPromptSubmit', { prompt: '/feature-network-sync' }), options);
  await writeFile(join(p.root, 'source.ts'), 'new');
  for (const extra of [{}, { stop_hook_active: true }, { stop_hook_active: false, turn_id: 'another' }, { stop_hook_active: false, session_id: '' }]) {
    expect((await handleCodexEvent(payload(p.root, 'Stop', extra), options)).decision).toBeUndefined();
  }
});
test('plugin_root_differs_from_project_root and is excluded from current changes', async () => {
  const p = await fixture(roots); const pluginRoot = join(p.root, 'installed-plugin'); await mkdir(pluginRoot);
  const trusted = { pluginRoot };
  await handleCodexEvent(payload(p.root, 'UserPromptSubmit', { prompt: '/feature-network-sync', pluginRoot: p.root }), trusted);
  await writeFile(join(pluginRoot, 'adapter.ts'), 'plugin change');
  expect((await handleCodexEvent(payload(p.root, 'Stop', { stop_hook_active: false }), trusted)).decision).toBeUndefined();
  await writeFile(join(p.root, 'source.ts'), 'real change');
  expect((await handleCodexEvent(payload(p.root, 'Stop', { stop_hook_active: false }), trusted)).decision).toBe('block');
}, 20000);
test('invalid_nearest_marker is blocked without parent fallback', async () => {
  const p = await fixture(roots); const child = join(p.root, 'child'); await mkdir(join(child, 'network-spec'), { recursive: true });
  await writeFile(join(child, 'network-spec/_meta.yaml'), 'invalid: true');
  const out = await handleCodexEvent(payload(child, 'SessionStart'), options);
  expect(out.hookSpecificOutput).toBeUndefined();
  expect(JSON.stringify(out)).not.toContain(p.root);
});

test('normal_turn_requires_actual_new_source_changes', async () => {
  const p = await fixture(roots);
  await handleCodexEvent(payload(p.root, 'UserPromptSubmit', { prompt: 'Implement the requested change' }), options);
  expect((await handleCodexEvent(payload(p.root, 'Stop', { stop_hook_active: false }), options)).decision).toBeUndefined();
  await writeFile(join(p.root, 'source.ts'), 'new behavior');
  expect((await handleCodexEvent(payload(p.root, 'Stop', { stop_hook_active: false }), options)).decision).toBe('block');
}, 20000);
test('concurrent_prompt_receipts_never_attach_wrong_core_turn', async () => {
  const p = await fixture(roots);
  await Promise.all(['host-turn-a', 'host-turn-b'].map(turn_id => handleCodexEvent(payload(p.root, 'UserPromptSubmit', { turn_id, prompt: '/feature-network-sync' }), options)));
  await writeFile(join(p.root, 'source.ts'), 'changed');
  const out = await Promise.all(['host-turn-a', 'host-turn-b'].map(turn_id => handleCodexEvent(payload(p.root, 'Stop', { turn_id, stop_hook_active: false }), options)));
  expect(out.filter(result => result.decision === 'block').length).toBeLessThanOrEqual(1);
});
test('a_later_read_turn_cannot_continue_an_earlier_authorized_turn', async () => {
  const p = await fixture(roots);
  await handleCodexEvent(payload(p.root, 'UserPromptSubmit', { prompt: '/feature-network-sync' }), options);
  await writeFile(join(p.root, 'source.ts'), 'changed');
  await handleCodexEvent(payload(p.root, 'UserPromptSubmit', { turn_id: 'new-read-turn', prompt: '/feature-network-check' }), options);
  expect((await handleCodexEvent(payload(p.root, 'Stop', { turn_id: 'new-read-turn', stop_hook_active: false }), options)).decision).toBeUndefined();
});

test('matching_technical_hash_without_reasoned_decision_stays_open_for_current_changes', async () => {
  const p = await fixture(roots);
  await handleCodexEvent(payload(p.root, 'UserPromptSubmit', { prompt: '/feature-network-sync' }), options);
  await writeFile(join(p.root, 'source.ts'), 'new');
  await applyUpdate(p, { expected: {}, upserts: [], deletes: [], verifiedReferences: [{ path: 'source.ts', hash: hash('new') }] });
  expect((await handleCodexEvent(payload(p.root, 'Stop', { stop_hook_active: false }), options)).decision).toBe('block');
}, 20000);
test('explicit_init_continuation_only_requests_bounded_bootstrap_not_product_edits', async () => {
  const p = await fixture(roots);
  await handleCodexEvent(payload(p.root, 'UserPromptSubmit', { prompt: '/feature-network-init' }), options);
  await bootstrap(p, { action: 'start' });
  const out = await handleCodexEvent(payload(p.root, 'Stop', { stop_hook_active: false }), options);
  expect(out.decision).toBe('block'); expect(out.reason).toContain('Do not modify product code');
  expect((await handleCodexEvent(payload(p.root, 'Stop', { stop_hook_active: false }), options)).decision).toBeUndefined();
}, 20000);

test('unused_host_filter_registration_keeps_new_source_turn_eligible', async () => {
  const p = await fixture(roots);
  await exec('git', ['-C', p.root, 'config', 'filter.unused.process', 'exit 1']);
  await handleCodexEvent(payload(p.root, 'UserPromptSubmit', { prompt: '/feature-network-sync' }), options);
  await writeFile(join(p.root, 'source.ts'), 'new source behavior');
  expect((await handleCodexEvent(payload(p.root, 'Stop', { stop_hook_active: false }), options)).decision).toBe('block');
}, 20000);

});

import { afterEach, expect, test } from 'vitest';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
// @ts-ignore Benchmark CLI is a standalone JavaScript module.
import { summarizeStudy, summarizeRun } from '../../bench/complexity/summarize.mjs';

const roots: string[] = [];
afterEach(async () => { await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true }))); });
async function fixture(events: unknown[], oracle: unknown = { format: 1, status: 'passed', passed: 2, failed: 0, checks: [{ id: 'a', status: 'passed' }, { id: 'b', status: 'passed' }] }) {
  const root = await mkdtemp(join(tmpdir(), 'fn-complexity-summary-')); roots.push(root);
  await writeFile(join(root, 'events.jsonl'), events.map(event => JSON.stringify(event)).join('\n') + '\n');
  await writeFile(join(root, 'oracle.json'), JSON.stringify(oracle));
  return { root, run: { level: 'small', arm: 'baseline', seed: 11, events: 'events.jsonl', oracle: 'oracle.json', cliExitCode: 0, wallMs: 123, baseTestStatus: 'passed' } };
}
const complete = (usage: unknown = { input_tokens: 100, cached_input_tokens: 60, output_tokens: 8 }) => [
  { type: 'thread.started', thread_id: 'thread-1' },
  { type: 'turn.started' },
  { type: 'item.started', item: { id: 'cmd-1', type: 'command_execution', command: 'npm test' } },
  { type: 'item.completed', item: { id: 'cmd-1', type: 'command_execution', command: 'npm test' } },
  { type: 'item.started', item: { id: 'tool-1', type: 'mcp_tool_call', server: 'feature-network', tool: 'network_impact' } },
  { type: 'item.completed', item: { id: 'tool-1', type: 'mcp_tool_call', server: 'feature-network', tool: 'network_impact' } },
  { type: 'turn.completed', usage },
];

test('counts unique observed invocations and uses only terminal host usage', async () => {
  const { root, run } = await fixture(complete());
  const result = await summarizeRun(run, root);
  expect(result.status).toBe('passed');
  expect(result.execution).toEqual({ cliExitCode: 0, wallMs: 123, turn: 'completed', eventLog: 'complete' });
  expect(result.usage).toEqual({ inputTokens: 100, cachedInputTokens: 60, outputTokens: 8, source: 'codex_cli_turn_completed' });
  expect(result.observed).toEqual({ toolInvocations: 2, mcpToolInvocations: 1, commandExecutions: 1, commandsByProgram: { npm: 1 } });
  expect(JSON.stringify(result)).not.toContain('npm test');
  expect(result.oracle.status).toBe('passed');
});

test('missing usage remains unknown and is not silently zero', async () => {
  const { root, run } = await fixture(complete({ input_tokens: 100, output_tokens: 8 }));
  const result = await summarizeRun(run, root);
  expect(result.status).toBe('passed');
  expect(result.usage).toEqual({ inputTokens: 100, cachedInputTokens: null, outputTokens: 8, source: 'codex_cli_turn_completed' });
  expect(result.diagnostics).toContain('incomplete_host_usage');
});

test('unfinished turn and absent exit evidence remain incomplete despite passing oracle', async () => {
  const { root, run } = await fixture(complete().slice(0, -1));
  expect((await summarizeRun(run, root)).status).toBe('incomplete');
  expect((await summarizeRun({ ...run, cliExitCode: null }, root)).execution.cliExitCode).toBeNull();
  expect((await summarizeRun({ ...run, cliExitCode: null }, root)).status).toBe('incomplete');
});

test('truncated JSONL invalidates completion and preserves only observed counts', async () => {
  const { root, run } = await fixture(complete());
  await writeFile(join(root, 'events.jsonl'), complete().map(event => JSON.stringify(event)).join('\n') + '\n{"type":');
  const result = await summarizeRun(run, root);
  expect(result.status).toBe('incomplete');
  expect(result.execution.eventLog).toBe('malformed');
  expect(result.observed.toolInvocations).toBe(2);
  expect(result.usage.inputTokens).toBeNull();
  expect(result.diagnostics).toContain('malformed_event_log');
});

test('explicit failed turn is a failure and has no usable terminal token total', async () => {
  const events: unknown[] = [...complete().slice(0, -1), { type: 'turn.failed', error: { message: 'interrupted' } }];
  const { root, run } = await fixture(events);
  const result = await summarizeRun({ ...run, cliExitCode: 1 }, root);
  expect(result.status).toBe('failed');
  expect(result.execution.turn).toBe('failed');
  expect(result.usage.inputTokens).toBeNull();
});

test('missing event log is incomplete even with a passing oracle and recorded exit zero', async () => {
  const { root, run } = await fixture(complete());
  const result = await summarizeRun({ ...run, events: 'missing.jsonl' }, root);
  expect(result.status).toBe('incomplete');
  expect(result.execution.eventLog).toBe('unavailable');
  expect(result.observed.toolInvocations).toBe(0);
});

test('oracle and base test failures are separate and both prevent success', async () => {
  const { root, run } = await fixture(complete(), { format: 1, status: 'failed', passed: 1, failed: 1, checks: [{ id: 'a', status: 'passed' }, { id: 'b', status: 'failed', reason: 'wrong locale' }] });
  const failedOracle = await summarizeRun(run, root);
  expect(failedOracle.status).toBe('failed');
  expect(failedOracle.oracle).toEqual({ status: 'failed', passed: 1, failed: 1, total: 2 });
  const failedBase = await summarizeRun({ ...run, baseTestStatus: 'failed' }, root);
  expect(failedBase.baseTestStatus).toBe('failed');
  expect(failedBase.status).toBe('failed');
});

test('unknown or malformed oracle cannot imply a pass', async () => {
  const { root, run } = await fixture(complete(), { status: 'passed' });
  const result = await summarizeRun(run, root);
  expect(result.status).toBe('incomplete');
  expect(result.oracle.status).toBe('unavailable');
});

test('study totals stay unknown if one run lacks a host token metric and never infer a threshold', async () => {
  const { root, run } = await fixture(complete());
  await writeFile(join(root, 'second.jsonl'), complete({ input_tokens: 90, output_tokens: 7 }).map(event => JSON.stringify(event)).join('\n') + '\n');
  const report = await summarizeStudy({ format: 1, runs: [run, { ...run, arm: 'feature-network', events: 'second.jsonl' }] }, root);
  expect(report.runs).toHaveLength(2);
  expect(report.totals.usage).toEqual({ inputTokens: 190, cachedInputTokens: null, outputTokens: 15 });
  expect(report.totals.status).toEqual({ passed: 2, failed: 0, incomplete: 0 });
  expect(report).not.toHaveProperty('threshold');
  expect(report.scope).toContain('Observed CLI events');
  expect(JSON.stringify(report)).not.toMatch(/exhaustive.*read/i);
});

test('CLI prints machine-readable JSON without changing inputs', async () => {
  const { root, run } = await fixture(complete());
  const manifest = join(root, 'runs.json'); await writeFile(manifest, JSON.stringify({ format: 1, runs: [run] }));
  const before = await readFile(join(root, 'events.jsonl'), 'utf8');
  const { execFileSync } = await import('node:child_process');
  const stdout = execFileSync(process.execPath, ['bench/complexity/summarize.mjs', '--runs', manifest], { cwd: process.cwd(), encoding: 'utf8' });
  expect(JSON.parse(stdout).runs[0].status).toBe('passed');
  expect(await readFile(join(root, 'events.jsonl'), 'utf8')).toBe(before);
});

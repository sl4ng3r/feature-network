/**
 * Conservative Codex CLI JSONL summary for the synthetic complexity study.
 *
 * Input: `node summarize.mjs --runs runs.json [--output report.json]`.
 * runs.json: {"format":1,"runs":[{"level":"small","arm":"baseline",
 * "seed":11,"events":"small/baseline.events.jsonl",
 * "oracle":"small/baseline.oracle.json","cliExitCode":0,"wallMs":1234,
 * "baseTestStatus":"passed"}]}.
 * Paths are relative to the manifest directory unless absolute. cliExitCode and
 * wallMs come from the runner's recorded process status; baseTestStatus must
 * come from an independent base-test process exit. Use null/"unavailable" when
 * evidence is missing. An oracle is valid only when all check counts agree.
 */
import { readFile, writeFile } from 'node:fs/promises';
import { basename, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const integer = value => Number.isSafeInteger(value) && value >= 0;
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);

function requireRun(run) {
  if (!object(run) || typeof run.level !== 'string' || !run.level ||
      !['baseline', 'feature-network'].includes(run.arm) || !integer(run.seed) ||
      typeof run.events !== 'string' || !run.events || typeof run.oracle !== 'string' || !run.oracle ||
      !(run.cliExitCode === null || integer(run.cliExitCode)) ||
      !(run.wallMs === null || integer(run.wallMs)) ||
      !['passed', 'failed', 'unavailable'].includes(run.baseTestStatus)) {
    throw new Error('invalid_run_manifest');
  }
}

function summarizeOracle(raw) {
  if (!object(raw) || raw.format !== 1 || !['passed', 'failed'].includes(raw.status) ||
      !integer(raw.passed) || !integer(raw.failed) || !Array.isArray(raw.checks) ||
      raw.checks.length !== raw.passed + raw.failed) return null;
  const ids = new Set();
  let passed = 0; let failed = 0;
  for (const check of raw.checks) {
    if (!object(check) || typeof check.id !== 'string' || !check.id || ids.has(check.id) ||
        !['passed', 'failed'].includes(check.status)) return null;
    ids.add(check.id);
    if (check.status === 'passed') passed++; else failed++;
  }
  if (passed !== raw.passed || failed !== raw.failed || (failed === 0) !== (raw.status === 'passed')) return null;
  return { status: raw.status, passed, failed, total: raw.checks.length };
}

function commandProgram(command) {
  if (typeof command !== 'string' || !command.trim()) return 'unknown';
  const first = command.trim().split(/\s+/u)[0];
  if (!first || /[;&|<>$`()]/u.test(first)) return 'other';
  const name = basename(first);
  return /^[\w.+-]{1,64}$/u.test(name) ? name : 'other';
}

function eventSummary(content) {
  const diagnostics = [];
  const lines = content.split('\n');
  let malformed = false; let completed = 0; let failed = 0; let usage = null;
  const invocations = new Map();
  for (let index = 0; index < lines.length; index++) {
    const line = lines[index].trim();
    if (!line) continue;
    let event;
    try { event = JSON.parse(line); } catch { malformed = true; continue; }
    if (!object(event) || typeof event.type !== 'string') { malformed = true; continue; }
    if (event.type === 'turn.completed') { completed++; usage = event.usage; }
    if (event.type === 'turn.failed') failed++;
    if (!['item.started', 'item.completed'].includes(event.type) || !object(event.item)) continue;
    const item = event.item;
    if (!['command_execution', 'mcp_tool_call'].includes(item.type)) continue;
    const key = typeof item.id === 'string' && item.id ? item.id : `${index}`;
    if (!invocations.has(key)) invocations.set(key, item);
  }
  if (malformed) diagnostics.push('malformed_event_log');
  if (completed > 1 || (completed && failed)) diagnostics.push('ambiguous_turn_termination');
  const turn = failed ? 'failed' : completed === 1 && !malformed ? 'completed' : 'incomplete';
  if (!completed && !failed) diagnostics.push('missing_terminal_turn');
  const metrics = object(usage) ? usage : {};
  const reliableUsage = turn === 'completed';
  const hostUsage = {
    inputTokens: reliableUsage && integer(metrics.input_tokens) ? metrics.input_tokens : null,
    cachedInputTokens: reliableUsage && integer(metrics.cached_input_tokens) ? metrics.cached_input_tokens : null,
    outputTokens: reliableUsage && integer(metrics.output_tokens) ? metrics.output_tokens : null,
    source: reliableUsage ? 'codex_cli_turn_completed' : null,
  };
  if (Object.values(hostUsage).slice(0, 3).some(value => value === null)) diagnostics.push('incomplete_host_usage');
  const commandsByProgram = {};
  let commandExecutions = 0; let mcpToolInvocations = 0;
  for (const item of invocations.values()) {
    if (item.type === 'command_execution') {
      commandExecutions++;
      const program = commandProgram(item.command);
      commandsByProgram[program] = (commandsByProgram[program] ?? 0) + 1;
    } else mcpToolInvocations++;
  }
  return { turn, eventLog: malformed ? 'malformed' : 'complete', usage: hostUsage,
    observed: { toolInvocations: invocations.size, mcpToolInvocations, commandExecutions, commandsByProgram }, diagnostics };
}

export async function summarizeRun(run, baseDirectory = process.cwd()) {
  requireRun(run);
  const diagnostics = [];
  let events;
  try { events = eventSummary(await readFile(resolve(baseDirectory, run.events), 'utf8')); }
  catch { events = { turn: 'incomplete', eventLog: 'unavailable', usage: { inputTokens: null, cachedInputTokens: null, outputTokens: null, source: null }, observed: { toolInvocations: 0, mcpToolInvocations: 0, commandExecutions: 0, commandsByProgram: {} }, diagnostics: ['event_log_unavailable', 'incomplete_host_usage'] }; }
  diagnostics.push(...events.diagnostics);
  let oracle = null;
  try { oracle = summarizeOracle(JSON.parse(await readFile(resolve(baseDirectory, run.oracle), 'utf8'))); }
  catch { /* Missing or malformed oracle is unavailable evidence. */ }
  if (!oracle) { oracle = { status: 'unavailable', passed: null, failed: null, total: null }; diagnostics.push('oracle_unavailable'); }
  if (run.cliExitCode === null) diagnostics.push('cli_exit_unavailable');
  if (run.wallMs === null) diagnostics.push('wall_time_unavailable');
  if (run.baseTestStatus === 'unavailable') diagnostics.push('base_test_unavailable');
  const executionComplete = events.turn === 'completed' && events.eventLog === 'complete' && run.cliExitCode === 0;
  const status = executionComplete && run.baseTestStatus === 'passed' && oracle.status === 'passed' ? 'passed' :
    run.cliExitCode !== null && run.cliExitCode !== 0 || events.turn === 'failed' ||
    executionComplete && (run.baseTestStatus === 'failed' || oracle.status === 'failed') ? 'failed' : 'incomplete';
  return {
    level: run.level, arm: run.arm, seed: run.seed, status,
    execution: { cliExitCode: run.cliExitCode, wallMs: run.wallMs, turn: events.turn, eventLog: events.eventLog },
    baseTestStatus: run.baseTestStatus, oracle, usage: events.usage, observed: events.observed, diagnostics,
  };
}

function sumKnown(runs, path) {
  const values = runs.map(run => path(run));
  return values.every(integer) ? values.reduce((sum, value) => sum + value, 0) : null;
}

export async function summarizeStudy(manifest, baseDirectory = process.cwd()) {
  if (!object(manifest) || manifest.format !== 1 || !Array.isArray(manifest.runs) || !manifest.runs.length) throw new Error('invalid_study_manifest');
  const keys = new Set();
  for (const run of manifest.runs) {
    requireRun(run);
    const key = JSON.stringify([run.level, run.arm, run.seed]);
    if (keys.has(key)) throw new Error('duplicate_study_run');
    keys.add(key);
  }
  const runs = await Promise.all(manifest.runs.map(run => summarizeRun(run, baseDirectory)));
  return {
    format: 1,
    scope: 'Observed CLI events and independently supplied process/base-test status plus checked oracle JSON. Tool counts are observed invocations; missing token metrics remain unknown. Single runs do not establish a complexity threshold.',
    runs,
    totals: {
      status: { passed: runs.filter(run => run.status === 'passed').length, failed: runs.filter(run => run.status === 'failed').length, incomplete: runs.filter(run => run.status === 'incomplete').length },
      usage: { inputTokens: sumKnown(runs, run => run.usage.inputTokens), cachedInputTokens: sumKnown(runs, run => run.usage.cachedInputTokens), outputTokens: sumKnown(runs, run => run.usage.outputTokens) },
      observed: { toolInvocations: sumKnown(runs, run => run.observed.toolInvocations), mcpToolInvocations: sumKnown(runs, run => run.observed.mcpToolInvocations), commandExecutions: sumKnown(runs, run => run.observed.commandExecutions) },
      wallMs: sumKnown(runs, run => run.execution.wallMs),
    },
  };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  if ((args.length !== 2 && args.length !== 4) || args[0] !== '--runs' || (args.length === 4 && args[2] !== '--output')) {
    console.error('usage: node summarize.mjs --runs runs.json [--output report.json]'); process.exitCode = 2;
  } else {
    try {
      const path = resolve(args[1]);
      const report = await summarizeStudy(JSON.parse(await readFile(path, 'utf8')), dirname(path));
      const json = JSON.stringify(report, null, 2) + '\n';
      if (args.length === 4) await writeFile(resolve(args[3]), json, { flag: 'wx' });
      else process.stdout.write(json);
    } catch (error) { console.error(error instanceof Error ? error.message : String(error)); process.exitCode = 1; }
  }
}

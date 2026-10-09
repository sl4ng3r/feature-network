import { afterEach, expect, test } from 'vitest';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { compareRuns, assessHost, writeComparisonReport } from '../../bench/comparison.js';
import { syntheticSnapshot, runCoreCase, summarize } from '../../bench/core.js';

const hash = 'a'.repeat(64);
const binding = { host: 'codex-desktop', hostVersion: 'test-version', providerVersion: 'test-provider', model: 'test-model', modelVersion: 'test-model-version', pluginVersion: '0.1.0', pluginSource: hash, sourceHash: hash, networkHash: hash, promptHash: hash, oracleHash: hash, node: 'v24.19.0' };
const phase = (wallMs: number | null = 10) => ({ wallMs });
function run(condition: 'baseline' | 'plugin', trial: number, task = 'profile-field') {
  return { kind: 'actual-agent-run', condition, trial, task, sessionId: `${task}-${condition}-${trial}`, freshSession: true, binding,
    costs: { initialization: phase(condition === 'plugin' ? 30 : 0), maintenance: phase(condition === 'plugin' ? 5 : 0), task: phase(20) },
    factual: { expected: ['sqlite', 'backup', 'restore'], observed: ['sqlite', 'backup', 'restore'], evidenceHash: hash },
    behavior: { status: 'passed', command: 'external SQLite roundtrip', evidenceHash: hash },
    graph: { status: condition === 'plugin' ? 'passed' : 'not_applicable', evidenceHash: condition === 'plugin' ? hash : null },
  };
}
function complete() { return ['profile-field', 'cosmetic', 'unmapped'].flatMap(task => [1, 2, 3].flatMap(trial => [run('baseline', trial, task), run('plugin', trial, task)])); }
const roots: string[] = [];
afterEach(async () => { await Promise.all(roots.splice(0).map(path => rm(path, { recursive: true, force: true }))); });

test('report_keeps_unavailable_tokens_null', () => {
  const report = compareRuns(complete());
  expect(report.runs[0]!.costs.task.measuredTokens).toBeNull();
  expect(report.runs[0]!.total.measuredTokens).toBeNull();
  expect(report.tasks[0]!.conditions.baseline.measuredTokens).toBeNull();
  expect(report.tasks[0]!.conditions.baseline.codeReads).toBeNull();
});
test('estimated_tokens_not_labelled_measured', () => {
  const runs: any[] = complete(); runs[0].costs.task.estimatedTokens = { value: 42, method: 'UTF-8 bytes / 4 heuristic' };
  const report = compareRuns(runs); expect(report.runs[0]!.costs.task.estimatedTokens!.value).toBe(42);
  expect(report.runs[0]!.costs.task.measuredTokens).toBeNull(); expect(report.runs[0]!.total.estimatedTokens).toBeNull();
});
test('initialization_cost_is_separate', () => {
  const report = compareRuns(complete(), { amortizeOverTasks: 10 }); const value = report.runs.find(r => r.condition === 'plugin')!;
  expect(value.costs.initialization.wallMs).toBe(30); expect(value.costs.maintenance.wallMs).toBe(5);
  expect(value.total.wallMs).toBe(55); expect(value.amortized.wallMs).toBe(28);
});
test('missing_phase_cost_stays_unknown_in_total_and_amortization', () => {
  const runs: any[] = complete(); runs[1].costs.initialization.wallMs = null;
  const report = compareRuns(runs); expect(report.runs[1]!.total.wallMs).toBeNull(); expect(report.runs[1]!.amortized.wallMs).toBeNull();
});
test('three_runs_per_condition_are_required', () => {
  const runs = complete().filter(r => !(r.task === 'cosmetic' && r.condition === 'plugin' && r.trial === 3));
  expect(compareRuns(runs).status).toBe('incomplete'); expect(compareRuns(runs).tasks.find(t => t.task === 'cosmetic')!.status).toBe('incomplete');
  expect(compareRuns(complete()).status).toBe('quality_passed');
});
test('worse_recall_is_not_success', () => {
  const runs = complete(); runs[1]!.factual.observed = ['sqlite']; const report = compareRuns(runs);
  expect(report.status).toBe('quality_failed'); expect(report.tasks[0]!.pairs[0]!.pluginRecall).toBeCloseTo(1 / 3);
  expect(report.tasks[0]!.pairs[0]!.qualityPassed).toBe(false);
});
test('unavailable_behavior_or_graph_is_pending_not_passed', () => {
  const runs: any[] = complete(); runs[1].behavior = { status: 'unavailable', command: null, evidenceHash: null };
  expect(compareRuns(runs).status).toBe('incomplete');
  runs[1] = run('plugin', 1); runs[1].graph = { status: 'unavailable', evidenceHash: null };
  expect(compareRuns(runs).status).toBe('incomplete');
});
test('source_network_prompt_oracle_model_and_host_bindings_must_match', () => {
  for (const key of ['sourceHash', 'networkHash', 'promptHash', 'oracleHash', 'model', 'modelVersion', 'host', 'hostVersion', 'providerVersion', 'pluginSource', 'node']) {
    const runs: any[] = complete(); runs[1].binding = { ...binding, [key]: key === 'host' ? 'copilot-cli' : key.endsWith('Hash') || key === 'pluginSource' ? 'b'.repeat(64) : 'different' };
    expect(() => compareRuns(runs)).toThrow(/binding_mismatch/);
  }
});
test('duplicate_trial_or_reused_session_is_rejected', () => {
  expect(() => compareRuns([...complete(), run('baseline', 1)])).toThrow(/duplicate_trial/);
  const runs = complete(); runs[1]!.sessionId = runs[0]!.sessionId; expect(() => compareRuns(runs)).toThrow(/reused_session/);
});
test('synthetic_oracles_are_not_actual_agent_runs', () => {
  const runs: any[] = complete(); runs[0].kind = 'synthetic-contract'; expect(() => compareRuns(runs)).toThrow();
});
test('measured_tokens_require_measurement_source_and_nonnegative_finite_values', () => {
  const runs: any[] = complete(); runs[0].costs.task.measuredTokens = 100;
  expect(() => compareRuns(runs)).toThrow(); runs[0].costs.task.tokenSource = 'provider usage export';
  expect(compareRuns(runs).runs[0]!.costs.task.measuredTokens).toBe(100);
  runs[0].costs.task.wallMs = -1; expect(() => compareRuns(runs)).toThrow();
});
test('empty_or_duplicate_factual_expectations_cannot_inflate_recall', () => {
  const runs = complete(); runs[0]!.factual.expected = []; expect(() => compareRuns(runs)).toThrow();
  runs[0]!.factual.expected = ['sqlite', 'sqlite']; expect(() => compareRuns(runs)).toThrow();
});
test('contract_tests_do_not_mark_host_live_pass', () => {
  const contract = { host: 'codex-desktop', check: 'mcp', kind: 'contract', status: 'passed', hostVersion: 'test', evidenceHash: hash };
  expect(assessHost('codex-desktop', 'test', [contract]).status).toBe('pending');
  const host = assessHost('codex-desktop', 'test', []);
  const live = host.required.map(check => ({ host: 'codex-desktop', check, kind: 'live', status: 'passed', hostVersion: 'test', evidenceHash: hash }));
  expect(assessHost('codex-desktop', 'test', live).status).toBe('passed');
  expect(assessHost('codex-desktop', 'different', live).status).toBe('pending');
  expect(host.required).toContain('native-six-command-menu'); expect(host.required).toContain('sync-repeat-no-yaml-write');
});
test('host_surfaces_are_distinct_and_missing_evidence_hash_is_not_live_proof', () => {
  expect(assessHost('copilot-cli', null, []).status).toBe('pending');
  expect(assessHost('copilot-app', null, []).status).toBe('pending');
  const host = assessHost('copilot-app', 'test', []);
  const evidence = host.required.map(check => ({ host: 'copilot-app', check, kind: 'live', status: 'passed', hostVersion: 'test', evidenceHash: null }));
  expect(assessHost('copilot-app', 'test', evidence).status).toBe('pending');
});
test('report_writer_persists_validated_records_without_overwriting', async () => {
  const root = await mkdtemp(join(tmpdir(), 'fn-bench-test-')); roots.push(root); const path = join(root, 'report.json');
  await writeComparisonReport(path, complete()); const stored = JSON.parse(await readFile(path, 'utf8'));
  expect(stored.status).toBe('quality_passed'); expect(stored.runs).toHaveLength(18);
  await expect(writeComparisonReport(path, [])).rejects.toThrow(/EEXIST/);
});
test('cyclic_synthetic_graph_is_bounded_and_reports_real_core_bytes', () => {
  const source = syntheticSnapshot(100); expect(source.features).toHaveLength(100);
  expect(source.features[99]!.relations.some(r => r.to === 'feature-00000')).toBe(true);
  const result = runCoreCase(100, { coldIterations: 2, warmupIterations: 2, warmIterations: 3, updateIterations: 2 });
  expect(result.graph.edges).toBe(300); expect(result.graph.directedDensity).toBeCloseTo(300 / (100 * 99));
  expect(result.cold.samplesMs).toHaveLength(2); expect(result.warm.samplesMs).toHaveLength(3); expect(result.refresh.samplesMs).toHaveLength(2);
  expect(result.output.encoding).toBe('UTF-8 JSON core context + impact results; not MCP envelopes');
  expect(result.output.contextBytes).toBeGreaterThan(0); expect(result.output.impactBytes).toBeGreaterThan(0);
  expect(result.output.impactItems).toBeLessThanOrEqual(20);
  expect(result.memory.gcAvailable).toBe(typeof globalThis.gc === 'function');
  expect(result.memory.scope).toContain('process'); expect(result.scope.excluded).toContain('filesystem/YAML loading');
});
test('latency_goal_uses_observed_warm_p95_without_flaky_timing_assertions', () => {
  expect(summarize([1, 2, 1000]).p95Ms).toBe(1000);
  expect(() => syntheticSnapshot(0)).toThrow(); expect(() => runCoreCase(100, { warmIterations: 0 })).toThrow();
});
test('facts_differing_between_conditions_and_nonfresh_sessions_are_rejected', () => {
  const runs: any[] = complete(); runs[1].factual.expected = ['sqlite']; expect(() => compareRuns(runs)).toThrow(/binding_mismatch/);
  runs[1] = run('plugin', 1); runs[1].freshSession = false; expect(() => compareRuns(runs)).toThrow();
});
test('unsupported_extra_claims_fail_quality_and_better_plugin_recall_can_pass', () => {
  const runs = complete(); runs[1]!.factual.observed.push('unverified-claim'); expect(compareRuns(runs).status).toBe('quality_failed');
  runs[1] = run('plugin', 1); runs[0]!.factual.observed = ['sqlite']; expect(compareRuns(runs).status).toBe('quality_passed');
});
test('host_failure_dominates_conflicting_pass_and_other_surface_cannot_satisfy_checks', () => {
  const host = assessHost('codex-desktop', 'test', []);
  const live = host.required.map(check => ({ host: 'codex-desktop', check, kind: 'live', status: 'passed', hostVersion: 'test', evidenceHash: hash }));
  expect(assessHost('codex-desktop', 'test', [...live, { ...live[0], status: 'failed' }]).status).toBe('failed');
  expect(assessHost('copilot-app', 'test', live).status).toBe('pending');
});
test('unknown_provider_or_model_version_keeps_comparison_incomplete', () => {
  for (const key of ['providerVersion', 'modelVersion']) {
    const runs: any[] = complete(); runs.forEach(run => { run.binding = { ...run.binding, [key]: null }; });
    expect(compareRuns(runs).status).toBe('incomplete');
  }
});
test('definitive_factual_or_behavior_failure_is_not_hidden_by_missing_other_evidence', () => {
  const runs: any[] = complete(); runs[1].factual.observed = ['sqlite']; runs[1].graph = { status: 'unavailable', evidenceHash: null };
  expect(compareRuns(runs).status).toBe('quality_failed');
  runs[1] = run('plugin', 1); runs[1].behavior.status = 'failed'; runs[1].graph = { status: 'unavailable', evidenceHash: null };
  expect(compareRuns(runs).status).toBe('quality_failed');
});

test('same_size_degree_contrast_runs_distinct_cyclic_workloads_and_real_budgets', () => {
  const options={coldIterations:1,warmupIterations:1,warmIterations:1,updateIterations:1};
  const sparse=runCoreCase(100,{...options,degree:2}); const dense=runCoreCase(100,{...options,degree:12});
  expect(sparse.graph.edges).toBe(200);expect(dense.graph.edges).toBe(1200);
  expect(dense.graph.directedDensity).toBeCloseTo(12/99);
  expect(dense.output.impactBytes).toBeLessThanOrEqual(12000);
  expect(syntheticSnapshot(100,12).features[99]!.relations).toHaveLength(12);
});

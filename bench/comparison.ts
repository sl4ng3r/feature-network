import { writeFile } from 'node:fs/promises';
import { z } from 'zod';

const text = z.string().trim().min(1);
const hash = z.string().regex(/^[a-f0-9]{64}$/);
const amount = z.number().finite().nonnegative();
const maybeAmount = amount.nullable().default(null);
const uniqueFacts = z.array(text).refine(items => new Set(items).size === items.length, 'Duplicate fact');
const phaseSchema = z.strictObject({
  wallMs: maybeAmount,
  measuredTokens: z.number().int().nonnegative().nullable().default(null),
  tokenSource: text.nullable().default(null),
  estimatedTokens: z.strictObject({ value: amount, method: text }).nullable().default(null),
  codeReads: z.strictObject({ files: z.number().int().nonnegative(), bytes: z.number().int().nonnegative(), source: text }).nullable().default(null),
}).refine(value => value.measuredTokens === null || value.tokenSource !== null, 'Measured tokens require a measurement source');
const bindingSchema = z.strictObject({
  host: z.enum(['codex-desktop', 'copilot-cli', 'copilot-app']), hostVersion: text, providerVersion: text.nullable(),
  model: text, modelVersion: text.nullable(), pluginVersion: text, pluginSource: hash,
  sourceHash: hash, networkHash: hash, promptHash: hash, oracleHash: hash, node: text,
});
const evidenceSchema = z.strictObject({ status: z.enum(['passed', 'failed', 'unavailable']), command: text.nullable(), evidenceHash: hash.nullable() })
  .refine(value => value.status === 'unavailable' || (value.command !== null && value.evidenceHash !== null), 'Behavior results require command and evidence');
const runSchema = z.strictObject({
  kind: z.literal('actual-agent-run'), task: z.enum(['profile-field', 'cosmetic', 'unmapped']), condition: z.enum(['baseline', 'plugin']),
  trial: z.number().int().positive(), sessionId: text, freshSession: z.literal(true), binding: bindingSchema,
  costs: z.strictObject({ initialization: phaseSchema, maintenance: phaseSchema, task: phaseSchema }),
  factual: z.strictObject({ expected: uniqueFacts.refine(items => items.length > 0, 'Expected facts required'), observed: uniqueFacts, evidenceHash: hash }),
  behavior: evidenceSchema,
  graph: z.strictObject({ status: z.enum(['passed', 'failed', 'unavailable', 'not_applicable']), evidenceHash: hash.nullable() })
    .refine(value => !['passed', 'failed'].includes(value.status) || value.evidenceHash !== null, 'Graph result requires evidence'),
}).refine(value => value.condition !== 'plugin' || value.graph.status !== 'not_applicable', 'Plugin graph oracle is required');
export type ComparisonRun = z.infer<typeof runSchema>;
type Phase = z.infer<typeof phaseSchema>;
const tasks = ['profile-field', 'cosmetic', 'unmapped'] as const;
const conditions = ['baseline', 'plugin'] as const;
function sum(values: (number | null)[]): number | null { return values.some(value => value === null) ? null : values.reduce<number>((a, b) => a + b!, 0); }
function mean(values: (number | null)[]): number | null { const total = sum(values); return !values.length || total === null ? null : total / values.length; }
function cost(phases: Phase[], divisor = 1) {
  return {
    wallMs: sum(phases.map((p, i) => p.wallMs === null ? null : p.wallMs / (i === 0 ? divisor : 1))),
    measuredTokens: sum(phases.map((p, i) => p.measuredTokens === null ? null : p.measuredTokens / (i === 0 ? divisor : 1))),
    estimatedTokens: sum(phases.map((p, i) => p.estimatedTokens === null ? null : p.estimatedTokens.value / (i === 0 ? divisor : 1))),
    codeReads: phases.every(p => p.codeReads !== null) ? { files: sum(phases.map((p, i) => p.codeReads!.files / (i === 0 ? divisor : 1))), bytes: sum(phases.map((p, i) => p.codeReads!.bytes / (i === 0 ? divisor : 1))) } : null,
  };
}
function recall(run: ComparisonRun): number { return run.factual.expected.filter(fact => run.factual.observed.includes(fact)).length / run.factual.expected.length; }
function behaviorKnown(run: ComparisonRun): boolean { return run.behavior.status !== 'unavailable' && (run.condition === 'baseline' || run.graph.status !== 'unavailable'); }
function quality(run: ComparisonRun): boolean { return recall(run) === 1 && run.factual.observed.every(fact => run.factual.expected.includes(fact)) && run.behavior.status === 'passed' && (run.condition === 'baseline' || run.graph.status === 'passed'); }
/** Validates operator-supplied evidence, never invokes an agent or claims evidence hashes prove truth. */
export function compareRuns(input: unknown, options: { amortizeOverTasks?: number } = {}) {
  const horizon = z.number().int().positive().parse(options.amortizeOverTasks ?? 1);
  const parsed = z.array(runSchema).parse(input); const keys = new Set<string>(); const sessions = new Set<string>();
  const environmentKeys = ['host', 'hostVersion', 'providerVersion', 'model', 'modelVersion', 'pluginVersion', 'pluginSource', 'node', 'sourceHash', 'networkHash'] as const;
  for (const run of parsed) {
    const key = `${run.task}:${run.condition}:${run.trial}`;
    if (keys.has(key)) throw new Error('duplicate_trial'); keys.add(key);
    if (sessions.has(run.sessionId)) throw new Error('reused_session'); sessions.add(run.sessionId);
    if (parsed[0] && environmentKeys.some(key => run.binding[key] !== parsed[0]!.binding[key])) throw new Error('binding_mismatch');
    const first = parsed.find(other => other.task === run.task)!;
    if (JSON.stringify(run.binding) !== JSON.stringify(first.binding) || JSON.stringify([...run.factual.expected].sort()) !== JSON.stringify([...first.factual.expected].sort())) throw new Error('binding_mismatch');
  }
  const runs = parsed.map(run => {
    const phases = [run.costs.initialization, run.costs.maintenance, run.costs.task];
    return { ...run, recall: recall(run), total: cost(phases), amortized: cost(phases, horizon) };
  });
  const taskReports = tasks.map(task => {
    const selected = runs.filter(run => run.task === task);
    const trials = [...new Set(selected.map(run => run.trial))].sort((a, b) => a - b);
    const pairs = trials.map(trial => {
      const baseline = selected.find(run => run.condition === 'baseline' && run.trial === trial);
      const plugin = selected.find(run => run.condition === 'plugin' && run.trial === trial);
      const failed = (plugin !== undefined && (plugin.recall < 1 || plugin.factual.observed.some(fact => !plugin.factual.expected.includes(fact)) || plugin.behavior.status === 'failed' || plugin.graph.status === 'failed')) || baseline?.behavior.status === 'failed';
      const known = baseline !== undefined && plugin !== undefined && behaviorKnown(baseline) && behaviorKnown(plugin);
      return { trial, baselineRecall: baseline?.recall ?? null, pluginRecall: plugin?.recall ?? null,
        qualityPassed: failed ? false : !known ? null : baseline.behavior.status === 'passed' && quality(plugin) && plugin.recall >= baseline.recall };
    });
    const metadataKnown = selected.every(run => run.binding.providerVersion !== null && run.binding.modelVersion !== null);
    const enough = metadataKnown && conditions.every(condition => selected.filter(run => run.condition === condition).length >= 3);
    const status = pairs.some(pair => pair.qualityPassed === false) ? 'quality_failed' : !enough || pairs.some(pair => pair.qualityPassed === null) ? 'incomplete' : 'quality_passed';
    const conditionReports = Object.fromEntries(conditions.map(condition => {
      const arm = selected.filter(run => run.condition === condition);
      return [condition, { runs: arm.length, wallMs: mean(arm.map(run => run.total.wallMs)), measuredTokens: mean(arm.map(run => run.total.measuredTokens)),
        estimatedTokens: mean(arm.map(run => run.total.estimatedTokens)), amortizedWallMs: mean(arm.map(run => run.amortized.wallMs)),
        codeReads: arm.length && arm.every(run => run.total.codeReads !== null) ? { files: mean(arm.map(run => run.total.codeReads!.files)), bytes: mean(arm.map(run => run.total.codeReads!.bytes)) } : null }];
    })) as Record<typeof conditions[number], { runs: number; wallMs: number | null; measuredTokens: number | null; estimatedTokens: number | null; amortizedWallMs: number | null; codeReads: { files: number | null; bytes: number | null } | null }>;
    return { task, status, pairs, conditions: conditionReports };
  });
  return { format: 1, kind: 'operator-supplied-agent-comparison', status: taskReports.some(t => t.status === 'quality_failed') ? 'quality_failed' : taskReports.some(t => t.status === 'incomplete') ? 'incomplete' : 'quality_passed',
    benefit: 'not_established_by_quality_status', amortizeOverTasks: horizon, runs, tasks: taskReports };
}
export async function writeComparisonReport(path: string, input: unknown, options: { amortizeOverTasks?: number } = {}): Promise<void> {
  const report = compareRuns(input, options); await writeFile(path, JSON.stringify(report, null, 2) + '\n', { flag: 'wx', mode: 0o600 });
}
const commonChecks = ['installation', 'mcp', 'skills', 'hooks', 'init-resume', 'profile-task', 'show-natural', 'show-ambiguous', 'show-overview', 'sync-shrink', 'sync-contract', 'sync-conflict', 'sync-repeat-no-yaml-write', 'manual-points-preserved'];
const hostSchema = bindingSchema.shape.host;
const hostEvidenceSchema = z.strictObject({ host: hostSchema, check: text, kind: z.enum(['contract', 'live']), status: z.enum(['passed', 'failed', 'pending']), hostVersion: text, evidenceHash: hash.nullable() });
/** Contract evidence and other host/version evidence cannot satisfy live checks. */
export function assessHost(hostInput: unknown, versionInput: unknown, input: unknown) {
  const host = hostSchema.parse(hostInput); const version = text.nullable().parse(versionInput); const evidence = z.array(hostEvidenceSchema).parse(input);
  const required = [...commonChecks, ...(host === 'codex-desktop' ? ['native-six-command-menu'] : [])];
  const live = evidence.filter(e => e.kind === 'live' && e.host === host && e.hostVersion === version && e.evidenceHash !== null);
  const missing = required.filter(check => !live.some(e => e.check === check && e.status === 'passed'));
  const failed = required.filter(check => live.some(e => e.check === check && e.status === 'failed'));
  return { host, version, status: failed.length ? 'failed' : missing.length ? 'pending' : 'passed', required, missing, failed, evidence };
}

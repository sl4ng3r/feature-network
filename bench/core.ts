import { createHash } from 'node:crypto';
import { performance } from 'node:perf_hooks';
import { arch, cpus, platform, release, totalmem } from 'node:os';
import { buildIndex, refreshIndex } from '../src/query/index.js';
import { queryContext } from '../src/query/search.js';
import { queryImpact } from '../src/query/impact.js';
import type { Snapshot } from '../src/storage/repository.js';

const hash = (value: string) => createHash('sha256').update(value).digest('hex');
const id = (i: number) => `feature-${String(i).padStart(5, '0')}`;
function positive(value: number): number { if (!Number.isInteger(value) || value < 1) throw new Error('positive_integer_required'); return value; }
/** Pure synthetic valid-shape graph. No filesystem, private source or semantic oracle. */
export function syntheticSnapshot(size: number): Snapshot {
  positive(size); if (size < 4) throw new Error('at_least_four_features_required');
  const features = Array.from({ length: size }, (_, i) => ({ schema: 1 as const, id: id(i), summary: `Synthetic profile group ${i % 10} feature ${i}`,
    key_points: ['Synthetic benchmark only.'], code: [{ path: `src/${id(i)}.ts` }], evidence: [], hypotheses: [],
    relations: [1, 2, 3].map(offset => ({ to: id((i + offset) % size), type: 'reads' as const, status: 'evidenced' as const, evidence: [{ path: `src/${id(i)}.ts` }] })),
  }));
  const fingerprints = Object.fromEntries([['network-spec/_meta.yaml', hash('schema: 1\ncoverage: partial\n')], ...features.map(f => [`network-spec/${f.id}.yaml`, hash(JSON.stringify(f))])]);
  return { features, revision: hash(JSON.stringify(fingerprints)), fingerprints, integrity: 'valid', diagnostics: [] };
}
export function summarize(samplesMs: number[]) {
  if (!samplesMs.length || samplesMs.some(value => !Number.isFinite(value) || value < 0)) throw new Error('invalid_samples');
  const sorted = [...samplesMs].sort((a, b) => a - b); const at = (q: number) => sorted[Math.ceil(sorted.length * q) - 1]!;
  return { samplesMs, minMs: sorted[0]!, medianMs: at(0.5), p95Ms: at(0.95), maxMs: sorted.at(-1)! };
}
function timed(fn: () => void): number { const start = performance.now(); fn(); return performance.now() - start; }
const workload = {
  context: { request: { query: 'synthetic profile', budget: 12000 }, effective: { detail: 'summary', limit: 20, includeFingerprints: false } },
  impact: { request: { ids: [id(0)], depth: 2, budget: 12000 }, effective: { detail: 'summary', direction: 'both', limit: 20 } },
};
const scope = {
  cold: 'loaded Snapshot -> index build + context and impact queries + UTF-8 JSON encoding; already running process, fresh index',
  warm: 'loaded index -> context and impact queries + UTF-8 JSON encoding',
  refresh: 'loaded old index + preconstructed changed Snapshot -> incremental index refresh only',
  excluded: ['filesystem/YAML loading', 'Git/reference hashing', 'storage write/journaling', 'process/plugin startup', 'MCP transport/envelope', 'hooks', 'agent/model latency'],
};
export function runCoreCase(size: number, options: { coldIterations?: number; warmupIterations?: number; warmIterations?: number; updateIterations?: number } = {}) {
  const counts = { cold: positive(options.coldIterations ?? 5), warmup: positive(options.warmupIterations ?? 10), warm: positive(options.warmIterations ?? 30), refresh: positive(options.updateIterations ?? 5) };
  const snapshot = syntheticSnapshot(size); const changed = structuredClone(snapshot);
  changed.features[0]!.summary = 'Changed synthetic profile benchmark';
  changed.fingerprints['network-spec/' + id(0) + '.yaml'] = hash(JSON.stringify(changed.features[0])); changed.revision = hash(JSON.stringify(changed.fingerprints));
  // Snapshot construction and hashes intentionally precede measurement. Observe a retained index separately.
  const gc = typeof globalThis.gc === 'function'; if (gc) globalThis.gc!(); const before = process.memoryUsage();
  const index = buildIndex(snapshot); if (gc) globalThis.gc!(); const retained = process.memoryUsage();
  let context = Buffer.alloc(0); let impact = Buffer.alloc(0); let contextItems = 0; let impactItems = 0;
  function query(current: ReturnType<typeof buildIndex>) {
    const a = queryContext(current, workload.context.request);
    const b = queryImpact(current, workload.impact.request);
    context = Buffer.from(JSON.stringify(a)); impact = Buffer.from(JSON.stringify(b)); contextItems = a.items.length; impactItems = b.items.length;
  }
  const cold = Array.from({ length: counts.cold }, () => timed(() => query(buildIndex(snapshot))));
  for (let i = 0; i < counts.warmup; i++) query(index);
  const warm = Array.from({ length: counts.warm }, () => timed(() => query(index)));
  let refreshed = index;
  const refresh = Array.from({ length: counts.refresh }, () => timed(() => { refreshed = refreshIndex(index, changed); }));
  if (refreshed.entries.get(id(0))!.feature.summary !== changed.features[0]!.summary || index.entries.get(id(0))!.feature.summary === changed.features[0]!.summary) throw new Error('refresh_semantics_failed');
  if (!contextItems || !impactItems || context.length > 12000 || impact.length > 12000) throw new Error('query_budget_failed');
  const afterWork = process.memoryUsage();
  return { graph: { features: size, edges: size * 3, edgesPerFeature: 3, directedDensity: 3 / (size - 1), topology: 'directed cyclic ring with +1,+2,+3 edges; no self edges', references: 'one distinct synthetic source path per feature; its three relation evidence references reuse that path; no files read' }, scope, workload,
    iterations: counts, cold: summarize(cold), warm: summarize(warm), refresh: summarize(refresh),
    memory: { scope: 'whole process bytes; retained delta after loaded synthetic snapshots, not isolated feature allocations or peak', gcAvailable: gc, gcPolicy: gc ? 'explicit GC before/after retaining one index; natural GC during timed loops' : 'no forced GC; before/after may include garbage',
      beforeIndex: before, retainedIndex: retained, retainedDelta: { heapUsed: retained.heapUsed - before.heapUsed, rss: retained.rss - before.rss }, afterWork },
    output: { encoding: 'UTF-8 JSON core context + impact results; not MCP envelopes', contextBytes: context.length, impactBytes: impact.length, combinedBytes: context.length + impact.length, contextItems, impactItems },
    warmGoal: size === 1000 ? { thresholdMs: 100, statistic: 'p95 of loaded-index context+impact+encoding', observedMs: summarize(warm).p95Ms, passed: summarize(warm).p95Ms <= 100 } : null,
  };
}
export function runCoreBenchmark() {
  if (!/^v24\./.test(process.version)) throw new Error('node_24_required');
  return { format: 1, kind: 'synthetic-core-benchmark', measuredAt: new Date().toISOString(),
    machine: { platform: platform(), release: release(), arch: arch(), cpu: cpus()[0]?.model ?? 'unavailable', logicalCpus: cpus().length, totalMemoryBytes: totalmem(), node: process.version },
    limitations: ['Local machine snapshot only; no cross-host or agent/token benefit claim.', 'Cold means fresh index in an already running process, not cold filesystem/plugin startup.', 'Retained memory deltas may be negative/noisy; no peak sampler or per-feature allocation claim.'],
    cases: [100, 1000, 10000].map(size => runCoreCase(size)),
  };
}

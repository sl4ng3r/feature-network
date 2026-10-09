# Benchmark and comparison protocol

Core benchmarks and synthetic SQLite/graph oracle tests are local evidence. They are not actual agent runs, native host acceptance or proof of token savings. No model API, cloud request, host installation or telemetry activation is performed by this harness.

## Run the core benchmark

Use Node.js 24 and the pinned development dependencies:

```sh
npm ci --ignore-scripts
npm run bench:core
# Machine-readable output, without npm's command banner:
npm run --silent bench:core > core-report.json
npm test -- tests/bench/report.test.ts
```

The command bundles `bench/core.ts` with the already installed development esbuild, runs a separate Node 24 process with `--expose-gc`, prints JSON and finally removes its ignored build directory. It does not require Git in an exported source archive. HEAD/tree are nullable metadata; an enclosing unrelated checkout is not attributed to an export. The exact executed bundle has a SHA-256 fingerprint; input paths/hashes are post-build observations, not a concurrency-proof source snapshot. A report from a dirty checkout must retain that fact. Bind a published measurement to a recorded staged-tree export and document any final documentation-only delta.

Each case has 100, 1,000 or 10,000 features and three directed evidenced edges per feature: offsets +1, +2 and +3 modulo graph size. This forms cycles without self-edges. Density is `edges / (features * (features - 1))`. The synthetic loaded Snapshot has valid-shape features and SHA-256 fingerprints; referenced files are invented relative names, never read. It is not a storage-validation or semantic-coverage benchmark.

| Metric | Included | Explicitly excluded |
| --- | --- | --- |
| Cold | Fresh index built from an already loaded Snapshot, context and impact queries, UTF-8 JSON encoding; already running process | Filesystem/YAML loading, process/plugin startup |
| Warm | Same loaded index, context and impact queries, UTF-8 JSON encoding | Filesystem, storage, Git, MCP, hooks, agent/model |
| Refresh | `refreshIndex` with the old index and a preconstructed changed Snapshot; one changed feature, actual replacement/preserved original checked | Snapshot creation/hashing, YAML writes, locks, journals, storage update |
| Output | Actual encoded core context and impact result bytes including their core metadata | Full MCP structuredContent/text/JSON-RPC wrappers and transport |

Each feature has one distinct synthetic `src/feature-NNNNN.ts` code reference; its three relation evidence references reuse that path. Context uses request `{ query: 'synthetic profile', budget: 12000 }`, effective summary detail/20 items/no fingerprint payload. Impact uses `{ ids: ['feature-00000'], depth: 2, budget: 12000 }`, effective summary detail/both directions/20 items. These actual request shapes and effective defaults are included in JSON. Context searches `synthetic profile`; impact starts at feature 0 with two relation steps. Each result uses a 12,000-byte budget and the actual default result limits. This one workload is deliberately fixed; it is not a claim about arbitrary query shapes, dense/high-degree graphs or whole-hook latency. JSON reports preserve all individual samples: five cold, ten untimed warmup, thirty warm and five refresh samples per size. p95/median use nearest-rank quantiles. No timing assertion runs in tests. The 100 ms goal at 1,000 features is applied to observed **warm p95** of these two loaded-index queries plus encoding and is reported as actual pass/fail; no sample is dropped or adjusted.

Whole-process `memoryUsage()` includes RSS, heap, external and array buffers. Loaded original/changed snapshots are created before the baseline. Explicit GC runs before and after retaining one index, outside timed loops; timed loops use natural GC. Retained heap/RSS deltas are observations, may be noisy/negative and are not isolated allocations, peaks or per-feature costs. `afterWork` may include garbage, cold indexes and the last refresh. Unit tests may lack exposed GC; that condition is reported rather than silently forced. The runner records OS release, architecture, CPU, logical CPUs, total RAM and Node version. Other applications/load/thermal state are not controlled. No cross-host performance claim follows from one machine.

## Future actual agent comparison

**Not run yet.** Obtain concrete permission for the isolated synthetic demo, native host installation/project setup/trust, fresh sessions and detailed demo-only telemetry first. Native hooks require Node 24 on the actual host PATH; a shell prefix or explicit MCP binary does not prove GUI hook availability. Detailed telemetry defaults off. Do not use employer/user repositories or invoke a separate model API.

Use at least **three fresh independent sessions per condition per task**: baseline and plugin for each of the following three tasks (at least eighteen task sessions). Copilot CLI, Copilot App and Codex Desktop are separate experiments, not pooled providers. Version/configure each host separately. Alternate/randomize condition order with a recorded seed; keep the exact task prompt, source, network, acceptance oracle, model, budget, Node runtime and normal tools fixed. Network/source hashes must match before any session action. A baseline has the same network files but no FeatureNetwork registration/skill/hook; ordinary source/network file reads are permitted equally. Existing session memories/conversation history, caches and carried agent checkpoints must not enter a fresh trial.

Start **both arms** from separate copies of `demo/scenarios/pre-locale/`, not the already extended `demo/src/`. Hash all four source and four network files before starting, initialize Git independently and preserve an immutable starting copy. Use the same dependency versions and test harness; dependency/setup time belongs in the declared cost phases. Track final diffs/source hashes and evidence hashes. Host provider/model version unavailable from the UI/export remains `null` and the experiment remains incomplete; never invent a version. Model identity must be recorded. A reused session, duplicate task/condition/trial, differing bindings or differing Soll facts is rejected by the report harness.

| Task | Identical request in both arms | Independent acceptance oracle |
| --- | --- | --- |
| `profile-field` | Persist `locale: 'de-DE'` through profile save, schema migration, JSON backup and restore; preserve transient `sessionHint` semantics | Execute candidate code against real on-disk SQLite; inspect rows after reopen and backup JSON fields/version; migrate a populated schema-1 DB; test rejected backup and transaction rollback. Separately assess network field lists, directed/evidenced relations, checks and impact reachability. |
| `cosmetic` | Change a specified user-facing summary/comment without changing persistent fields or backup/restore contracts | Real baseline SQLite roundtrip and schema/backup shape remain unchanged; exact requested text changes; a separate graph oracle checks no unjustified relation/field expansion and preserves manual points. |
| `unmapped` | Add the specified new isolated module/function in an initially unreferenced source path | Execute that new behavior and existing SQLite roundtrip; inspect the source independently; graph oracle distinguishes an appropriate newly documented feature from unsupported relations and confirms the initially unmapped warning/review. |

Preregister exact requested function/text and explicit Soll fact IDs/oracle bytes before trials. The profile acceptance must read **SQLite**, not merely YAML or a backup produced by the same incorrect implementation. Keep factual Soll/Ist, actual behavior-test result and graph-oracle result as separate observations. `demo/tests` demonstrates the existing synthetic oracles/protocols only; canned updates are never counted as actual agent runs. An independent evaluator must inspect real final artifacts. Hash equality and a successful bootstrap checkpoint do not establish fachliche Vollständigkeit.

Record code-read file/byte counts only from actual available host/tool evidence, with its source. A known log subset cannot be presented as exhaustive reads; if full coverage is unavailable, use `codeReads: null` and discuss the subset separately. Record provider-measured tokens only from actual usage export/host evidence with `tokenSource`; otherwise `measuredTokens: null`. An estimate must have its own value/method and never populates measured tokens. Wall time must use measured phase boundaries, not guesswork.

Costs have three explicit phases: `initialization` (including creating initial feature memory and relevant host/project setup), `maintenance` and `task`. Measure separately and sum all three for total. If a supplied pre-locale network avoids initial creation during a trial, record its creation cost as unavailable unless it was independently actually measured under the same binding; do not treat a prepared seed as free. Report actual init/restart/resume trials on `empty-network` separately, with source binding. No-plugin initialization can be an explicitly justified structural zero, never an unknown converted to zero. Declare allocations of one-time costs before comparing. Amortized cost is initialization/N + maintenance + task with a preregistered positive N; N is a scenario assumption, not an observed saving. A missing phase makes total and amortized cost unknown. Actual model usage may aggregate phases without a reliable split: preserve a separate raw total in local evidence; do not invent phase splits to satisfy this schema.

## Store evidence without manufacturing runs

`bench/comparison.ts` exports `compareRuns(input, { amortizeOverTasks })`, `writeComparisonReport(path, input, options)` and `assessHost(host, version, evidence)`. This is an operator-supplied record validator/aggregator, not a session launcher. Use the TypeScript development harness to call it after authorized measurements. Its strict schemas reject unknown fields; use the fields shown in `tests/bench/report.test.ts` as **test fixtures only**, not factual data. `writeComparisonReport` creates a new local UTF-8 JSON file with mode 0600, refuses existing files, preserves normalized per-run records, and never uploads anything.

Each record binds `kind: actual-agent-run`, task/condition/trial, a unique fresh session ID, host/provider/model/plugin versions, plugin source SHA, initial source/network SHA, prompt/oracle SHA and Node version. It stores costs, `factual.expected`/`observed` fact IDs with evidence hash, the actual behavior command/status/evidence hash and the separate graph oracle status/evidence hash. Baseline graph may be `not_applicable`; plugin graph cannot. Missing measurements normalize to null. Records with unknown provider/model version are kept but cannot complete the comparison. Expected/observed fact IDs must be unique and expected facts nonempty.

Per task, report every trial pair, recalls, quality decision and condition means. At least three runs in **each** arm and complete matching pairs are mandatory. A successful plugin outcome requires full factual recall with no unsupported extra claims, passing behavior/graph oracles, and recall at least as good as baseline; missing behavior/graph evidence is incomplete. Definitive failures stay failed even if other evidence is missing. Baseline lower recall can demonstrate a plugin quality advantage only when actual baseline behavior passes; cost benefit remains a separate conclusion. `quality_passed` explicitly does not establish a saving. Means/totals preserve unknown token/read/phase values; estimates remain separate. Raw prompts/transcripts, receipts, host paths and detailed logs stay in ignored local scratch and are not committed. Review/redact any actual report before selecting it for publication. Evidence hashes bind supplied artifacts; this validator cannot prove that an operator's claimed measurement is true.

With Node 24 native type stripping, normalized **already collected and authorized** JSON records can be saved without a new dependency or agent invocation:

```sh
node --input-type=module -e "import { writeComparisonReport } from './bench/comparison.ts'; import { readFile } from 'node:fs/promises'; await writeComparisonReport('comparison.json', JSON.parse(await readFile('authorized-runs.json', 'utf8')), { amortizeOverTasks: 10 });"
```

This command does not collect records or authorize their collection. The input file and detailed output belong in ignored scratch until reviewed/redacted. There is intentionally no committed sample pretending to be an actual run.

See [host matrix](host-matrix.md) for required live evidence and current limits. There are currently no actual comparison reports.

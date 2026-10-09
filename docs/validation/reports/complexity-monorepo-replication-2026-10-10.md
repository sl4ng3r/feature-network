# Cross-package replication: complete task success — 2026-10-10

[Machine-readable results](complexity-monorepo-replication-2026-10-10.json) · [Initial screening](complexity-monorepo-2026-10-09.md) · [YAML-only ablation](complexity-monorepo-yaml-ablation-2026-10-10.md) · [Protocol](../monorepo-study.md)

Date: 2026-10-10. Requested model: `gpt-6-luna`, low reasoning effort; effective provider revision unobserved. This is a synthetic single-Git-root monorepo, not a test across separate repositories.

## Frozen protocol and prechecks

Prompt SHA-256: `ef2ebcc8b93741d9faaf2525de49c4f547590cb39c6ec67577ba514d1596badc`; generator: `f3d40835be2d1aafb2517e881a1b33e995dd72cdc8749ba46bdec048e19fc311`; oracle: `b59be4f7266b996f9f4f7acd827fc115641e0bd2dc7ed6c82cb6d1cdeaba2dde`. These exactly match the original scale study. Eight fresh seed pairs used the exact same prompt and a 300-second cap per arm, with order alternating within each level. Raw agent event logs and results are outside the Git checkouts.

For every one of the eight new seeds, the initial base test passed and the held-out oracle failed; the generator-template positive control passed every oracle check. Direct MCP `network_impact` returned exactly 37 related IDs (four flows, two pages) or 73 (eight flows, four pages), with valid integrity and no unrelated IDs. The direct check used the frozen project-bound server before model runs.

## Primary outcome

A run succeeds only if the CLI finishes and emits `turn.completed`, current `npm test` passes, the frozen original base test passes on a post-run copy, and the held-out oracle is complete with every check passing. Partial checks, token counts, and wall time are diagnostics.

| Level | Code-only successes | FeatureNetwork successes | FN-only pairs | Code-only-only pairs | Both pass | Both fail |
|---|---:|---:|---:|---:|---:|---:|
| medium (5 pairs) | 4/5 | 4/5 | 1 | 1 | 3 | 0 |
| large (5 pairs) | 1/5 | 3/5 | 2 | 0 | 1 | 2 |

The five pairs per level include the prior screening seeds 344 and 444 from `docs/validation/reports/complexity-monorepo-2026-10-09.json`. The four new seeds per level are detailed below. On the medium level the arms tie. On the large level, FeatureNetwork wins two paired seeds, but two of five pairs fail in both arms and one succeeds in both. With only two discordant large pairs, the exact two-sided paired sign probability under equal outcomes is 0.5. This is a candidate pattern, not a demonstrated threshold or sales claim.

## New runs

`Pass` applies the full gate above. `Checks` are held-out oracle passes. `Network shell` counts completed shell commands referencing `network-spec`; it is a lower-bound observation of file access, not proof that the model used the graph correctly. `Changed related/unrelated` counts modified package contract modules. All 16 new runs finished without timeout; current and frozen tests passed in each.

| Level/seed | Arm | Pass | Checks | Failure category | Network shell | MCP calls | Changed related/unrelated | Input tokens | Wall s |
|---|---|---|---:|---|---:|---:|---:|---:|---:|
| medium 345 | Code | yes | 180/180 | — | 0 | 0 | 32/0 | 317,963 | 114.1 |
| medium 345 | FN | yes | 180/180 | — | 1 | 0 | 32/0 | 569,261 | 53.5 |
| medium 346 | FN | no | 179/180 | csv ×1 | 3 | 0 | 31/0 | 793,848 | 78.1 |
| medium 346 | Code | yes | 180/180 | — | 0 | 0 | 32/0 | 642,984 | 54.7 |
| medium 347 | Code | yes | 180/180 | — | 0 | 0 | 32/0 | 384,777 | 89.9 |
| medium 347 | FN | yes | 180/180 | — | 1 | 0 | 32/0 | 354,511 | 38.6 |
| medium 348 | FN | yes | 180/180 | — | 3 | 0 | 32/0 | 493,508 | 164.6 |
| medium 348 | Code | no | 176/180 | audit ×4 | 0 | 0 | 32/0 | 458,978 | 131.3 |
| large 445 | Code | no | 412/420 | audit ×8 | 0 | 0 | 72/0 | 626,279 | 114.1 |
| large 445 | FN | no | 412/420 | identity ×8 | 0 | 0 | 72/0 | 511,921 | 55.7 |
| large 446 | FN | yes | 420/420 | — | 2 | 0 | 64/0 | 495,654 | 56.2 |
| large 446 | Code | no | 412/420 | audit ×8 | 0 | 0 | 64/0 | 643,479 | 54.0 |
| large 447 | Code | no | 412/420 | audit ×8 | 0 | 0 | 64/0 | 708,025 | 50.4 |
| large 447 | FN | yes | 420/420 | — | 1 | 0 | 64/0 | 1,011,879 | 124.7 |
| large 448 | FN | yes | 420/420 | — | 1 | 0 | 64/0 | 1,149,619 | 201.8 |
| large 448 | Code | yes | 420/420 | — | 0 | 0 | 64/0 | 660,037 | 50.5 |

Across all eight new FeatureNetwork arms, the model made zero MCP calls. Seven arms had shell commands referencing `network-spec`; the failing large seed 445 had none. This pattern is consistent with an MCP discoverability gap, but does not isolate the reason for success or failure. Direct MCP calls in prechecks worked. The prior medium screening run did make two MCP calls, so a blanket statement that Luna cannot call MCP would be false.

The code-only arm missed all eight audit outputs in large seeds 445, 446 and 447; large seed 448 passed. FeatureNetwork missed all eight identity outputs in large seed 445, passed large seeds 446–448, and missed one CSV output in medium seed 346. Medium seed 348 code-only missed four audit outputs. All these errors escaped current and frozen ordinary tests and were found by the external oracle.

## Audit and limits

`report.json` contains each of the 16 runs' full oracle failure IDs, usage, changed-file counts, raw event SHA-256 and oracle-result SHA-256. The report builder recomputed every event/oracle hash, checked that each oracle emitted exactly its expected complete set of 180 or 420 checks, and checked the prompt/generator/oracle hashes against the frozen source protocol. Per-run raw evidence is under `<level>/<seed>/logs/<arm>/`; each fresh checkout is at `<level>/<seed>/<arm>/` within this scratch directory.

One protocol isolation anomaly is retained: the FeatureNetwork agent in large seed 446 wrote a temporary script outside the synthetic checkout and ran it to edit its checkout. This was an unregistered external temporary write. The command did not read another project, and no other new run's completed shell command referenced an external path. The run remains in the count; excluding it after seeing the outcome would bias the result.

The fixture's positive control uses source templates from its generator, so it is not independent implementation evidence. The agents could exploit repetitive file shapes and batch edits. The requested model flag does not independently verify the provider's effective model revision. The study does not measure network initialization and maintenance, real project tasks or separate Git repositories. Five seed pairs per level are sufficient only for this exploratory screen; a publishable quality claim needs more independent tasks, repeated pairs and uncertainty analysis.

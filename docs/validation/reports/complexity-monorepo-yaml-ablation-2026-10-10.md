# Post-screening YAML-only ablation — 2026-10-10

[Machine-readable results](complexity-monorepo-yaml-ablation-2026-10-10.json) · [Five-pair study](complexity-monorepo-replication-2026-10-10.md) · [Protocol](../monorepo-study.md)

Date: 2026-10-10. This third arm was designed **after** seeing the two-arm large-level result, then fixed to all five seeds before the ablation runs. It is exploratory. Requested model: GPT-6-Luna, low reasoning effort; effective provider revision is unverified.

## Protocol and audit

All five fresh eight-flow/256-distractor checkouts had the same generated file-byte tree as their respective configured FeatureNetwork starting states. Each retained `network-spec/` YAML and had **no MCP setting, skill or hook**. Prompt SHA-256: `ef2ebcc8b93741d9faaf2525de49c4f547590cb39c6ec67577ba514d1596badc`; generator: `f3d40835be2d1aafb2517e881a1b33e995dd72cdc8749ba46bdec048e19fc311`; oracle: `b59be4f7266b996f9f4f7acd827fc115641e0bd2dc7ed6c82cb6d1cdeaba2dde`. The prompt and file hashes match the preceding two-arm study.

Every initial base test passed, the unmodified fixture failed 91 held-out checks, and the generator-template positive control passed 420/420. All model runs used Node 24, `--ignore-user-config`, the same prompt, a 300-second cap, and raw event logs outside the checkout. Complete success requires CLI exit zero and `turn.completed`, current `npm test`, the frozen original base test on a post-run copy, and a complete held-out oracle at 420/420. Every emitted event-log and oracle-result SHA-256 in `report.json` was recomputed; each oracle result contained exactly 420 completed checks.

## Results

| Seed | Code-only | FN configured | YAML only | YAML checks | YAML failure | YAML shell references | YAML input tokens | YAML wall s |
|---:|---|---|---|---:|---|---:|---:|---:|
| 444 | fail | fail | pass | 420/420 | — | 0 | 1,000,038 | 138.3 |
| 445 | fail | fail | fail | 412/420 | audit ×8 | 0 | 533,967 | 51.2 |
| 446 | fail | pass | pass | 420/420 | — | 5 | 1,125,146 | 79.9 |
| 447 | fail | pass | pass | 420/420 | — | 13 | 1,414,316 | 212.6 |
| 448 | pass | pass | fail | 412/420 | audit ×8 | 1 | 478,654 | 104.7 |

Complete successes: **code-only 1/5, configured FeatureNetwork 3/5, YAML-only 3/5**. The configured and YAML-only arms have equal success counts but different seed outcomes: YAML-only succeeds on 444 where configured FN fails, while configured FN succeeds on 448 where YAML-only fails. Both configured FN and YAML-only made zero MCP tool calls on these large-level seeds. The YAML-only agent did not visibly access `network-spec` on 444 or 445; it accessed the files on 446–448. Therefore this comparison does not show an incremental benefit from the MCP interface. The 444 success without observed YAML access also shows substantial run-to-run variation.

All YAML-only runs completed without timeout; current and frozen tests passed. The held-out oracle caught all eight audit omissions on 445 and 448. Every YAML-only arm changed zero independent contract modules. No completed shell command in this arm referenced an external filesystem path.

## Interpretation limits

The first two arms ran earlier than this ablation. Its five seeds were fixed only after their results were known, so the three-arm comparison is not a simultaneous randomized experiment. The benchmark is a repetitive generated monorepo and its positive control is derived from generator templates. The effective model revision was not independently confirmed. This cannot establish a product quality threshold, a causal network or MCP effect, or performance across separate Git repositories. Raw events, stderr, ordinary tests, frozen tests and oracle outputs remain under `<seed>/logs/` in this scratch directory; per-run hashes, changed-module counts and token usage are in `report.json`.

# Synthetic cross-contract fanout sweep — 2026-10-09

[Machine-readable results](complexity-fanout-2026-10-09.json) · [Protocol and fixed assignment](../fanout-study.md) · [Earlier projection sweep](complexity-projections-2026-10-09.md)

Six independent Codex CLI `0.162.0-alpha.17.2` sessions edited fresh Node 24 SQLite fixtures. The requested model was `gpt-6-sol` at low reasoning effort; the event stream did not independently identify the effective model revision. Within each pair, the prompt, source and base tests were identical. The FeatureNetwork arm additionally received generated YAML and a project-bound MCP server. Each session had a 300-second wall limit. The code-only control was run first for the small and large pairs; the FeatureNetwork arm was first for the medium pair.

The task added a persisted profile locale and updated all published contracts while keeping independent lookalikes and transient session data isolated. The three levels increased affected locations and contract variety. The large fixture included runtime digest and bundle paths with two dependency edges. A held-out oracle checked SQLite reopen and migration, exact outputs for every contract, backup/restore persistence and unknown-version rejection without data mutation. A separate known-good implementation passed every level before agent runs. Initial fixtures failed the oracle. Base tests passed after every agent run.

| Contracts / affected | Arm | Held-out checks | Input tokens | Cached input | Output tokens | Wall time | MCP calls |
| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: |
| 24 / 12 | Code only | 29/29 | 227,832 | 208,000 | 2,110 | 35.0 s | 0 |
| 24 / 12 | FeatureNetwork | 29/29 | 314,853 | 294,016 | 3,466 | 50.8 s | 4 |
| 64 / 40 | Code only | 69/69 | 244,191 | 219,904 | 4,135 | 94.7 s | 0 |
| 64 / 40 | FeatureNetwork | 69/69 | 507,308 | 479,616 | 4,221 | 66.9 s | 26 |
| 128 / 96 | Code only | 133/133 | 340,711 | 313,600 | 3,808 | 49.9 s | 0 |
| 128 / 96 | FeatureNetwork | 133/133 | 442,768 | 413,696 | 4,286 | 61.9 s | 4 |

**Observed result:** Both arms passed at every tested level, so this sweep found no complexity threshold where code-only coding failed and FeatureNetwork succeeded. FeatureNetwork used more input tokens at all three levels. It was faster in the single medium pair and slower in the other two pairs. These one-run timings cannot establish a repeatable speed advantage. Most reported input tokens were cached; these figures are host token counts, not provider cost estimates. The FeatureNetwork sessions actually invoked its MCP tools: 4, 26 and 4 calls respectively.

Both arms edited exactly the affected contract files and the profile module, along with local test/documentation files. No generated network YAML was updated, so semantic upkeep and its cost remain untested. The registry in the application source exposes the dependency graph to both arms. The study therefore tests coordination of many heterogeneous edits despite an available code clue; it does not demonstrate a pure dependency-discovery advantage. Network creation/setup costs, native hooks, automatic maintenance, and an independent real application are outside this result. One run per arm and level is insufficient to estimate failure rates or claim a sales-page benefit.

An initial small code-only run was excluded because the measurement wrapper failed to record its process exit code. The fixture was reset to its original Git commit, and the run was repeated with the corrected wrapper before the paired FeatureNetwork run. The excluded event log remains in temporary scratch and is not part of the six-run summary. No result was excluded on the basis of quality or token use.

Generator, oracle, known-good implementation, prompt, and plugin-bundle SHA-256 are recorded in the machine-readable report. That report also records each raw event-log hash, execution status, changed-file count and observed MCP tool names. Full transcripts and individual evaluator outputs remain in local temporary scratch; the committed report contains no transcript text or local checkout paths.

For a useful next experiment, choose an independent application task with a less explicit dependency graph and deeper, condition-dependent business paths. Preregister the answer key and acceptance tests before running either arm, then repeat fresh paired seeds around any observed crossover. Include the effort of creating and maintaining the network. This is a proposed design, not a finding from the current sweep.

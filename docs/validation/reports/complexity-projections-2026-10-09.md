# Synthetic projection coding sweep — 2026-10-09

[Machine-readable summary](complexity-projections-2026-10-09.json) · [Preregistered pilot protocol](../complexity-study.md)

Six fresh Codex CLI `0.162.0-alpha.17.2` sessions edited independent Node 24 SQLite fixtures. The requested model was `gpt-6-sol` at low reasoning effort; the JSONL export did not independently confirm the effective model revision. Each level used one fixed seed, one code-only run and one run with a valid project-bound FeatureNetwork MCP server. The agent prompt was byte-identical within each pair. A held-out evaluator checked SQLite reopen and migration, every affected projection, independent projection shape, and transient-field exclusion. Ordinary base tests passed after every run. The plugin bundle SHA-256 was `ff2648e8f9f6a558452cd53d258f1e850088c3e3aa5c4ea1e25f28d7c74b0977`.

| Projection files / affected | Arm | Held-out checks | Input tokens | Cached input | Output tokens | Wall time | MCP calls |
| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: |
| 12 / 3 | Code only | 17/17 | 354,775 | 331,776 | 3,005 | 52.1 s | 0 |
| 12 / 3 | FeatureNetwork | 17/17 | 453,464 | 427,136 | 3,479 | 65.7 s | 6 |
| 48 / 8 | Code only | 53/53 | 302,367 | 284,416 | 3,252 | 49.6 s | 0 |
| 48 / 8 | FeatureNetwork | 53/53 | 792,026 | 756,608 | 4,645 | 140.4 s | 5 |
| 192 / 16 | Code only | 197/197 | 442,314 | 418,304 | 3,446 | 50.2 s | 0 |
| 192 / 16 | FeatureNetwork | 197/197 | 332,769 | 307,584 | 3,231 | 53.5 s | 4 |

Every run changed exactly its affected stage files and `src/profile.mjs`; no independent stage file changed. Each arm's initial source and base tests were identical, while only the FeatureNetwork arm had `network-spec/` and MCP registration. The generated network's impact response was valid, complete and matched all expected descendants at each level. The starting app failed the held-out locale oracle; a separate known-good implementation passed it at all three levels. Generator, oracle and prompt SHA-256: `ec4c39f39677987f875da287e8dbacfb3646a9106fee33452d990e48fdc18fcd`, `b67ecae08bb007409a6ef107b4eb21edb8a62caf748745cb9bf23ef61213feae`, `0cdc7ddb3eef72d1a58b91e15cc2267f2d8074c6c1a93d8872dea67a54ab07ba`.

**Result:** No failure boundary appeared in the tested range. The code-only agent completed all three tasks. The one-run token and time differences change direction across levels and cannot establish savings, a failure probability or a complexity threshold. Most reported input tokens were cached; no provider cost comparison was performed. The benchmark scales many similar projection contracts and does not yet model broad, heterogeneous business consequences. The generated network was supplied before the plugin runs, so its creation and later maintenance costs are unknown. Native hooks, automatic network upkeep and the desktop app were not tested. No network YAML was edited by these coding runs, so their functional passes do not establish that the project memory stayed semantically current.

Raw JSONL transcripts and individual evaluator outputs remain in local temporary scratch. The saved JSON summary contains no prompts, host paths or transcript text. The six raw event-log SHA-256 values in level/arm order are: `68722f6a60b93bc53246ea54f3e6ab0786ebee347fa4101530fb5ecf0f8be523`, `ca2ce83231fbe67929992ad1026ef459d8d1ff880bd679865d7dc54f40f28f72`, `9855c980222c1a472fb6364fd36e879306a8fe3765de86b60ed2b45da3a3436f`, `55516c337e7707ade3eb485b3196ff1c8909898308d1dfb5ee5c796c`, `9855a9e21eba644b7da1369dd7e01813b9938f3ac95ee994f9384b40bcf0da47`, `e6da7a32aaf8f9b37c22124c9de944823886715fd7d6a76a7f79c79dc0a3a75c`.

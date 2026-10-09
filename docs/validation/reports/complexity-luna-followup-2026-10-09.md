# Same-seed fanout follow-up: Luna variants and Sol — 2026-10-09

[Machine-readable results](complexity-luna-followup-2026-10-09.json) · [Fanout protocol](../fanout-study.md) · [Earlier Sol sweep](complexity-fanout-2026-10-09.md)

These are three separate, single-pair screenings of a synthetic Node/SQLite locale change. Each used the same task prompt, generator, held-out oracle and fresh seeds: Small has 24 contracts with 12 affected and 29 oracle checks; Medium 64/40/69; Large 128/96/133. Each arm had a fresh checkout and a 300-second cap. The code-only arm lacked `network-spec`; the FeatureNetwork arm received generated YAML and a configured project-bound MCP server. The agent could also inspect a dependency graph in the application's `src/registry.mjs` in **both** arms. The external oracle, along with ordinary base tests and a completed CLI turn, determined task success. The model names below are **requested** model settings; the event logs did not independently establish their effective provider revisions.

| Requested model | Level | Arm | Oracle | Input tokens (cached) | Output | Wall s | MCP calls |
| --- | --- | --- | ---: | ---: | ---: | ---: | ---: |
| GPT-6-Luna | Small | Code only | ungraded: graph guard | 972,218 (924,416) | 6,403 | 75.2 | 0 |
| GPT-6-Luna | Small | FeatureNetwork | 29/29 | 556,140 (518,656) | 5,322 | 56.3 | 1 |
| GPT-6-Luna | Medium | Code only | 67/69 | 514,960 (477,440) | 4,483 | 51.8 | 0 |
| GPT-6-Luna | Medium | FeatureNetwork | 63/69 | 364,175 (327,936) | 4,626 | 41.8 | 0 |
| GPT-6-Luna | Large | Code only | 94/133 | 2,479,761 (2,367,232) | 15,744 | 149.5 | 0 |
| GPT-6-Luna | Large | FeatureNetwork | 133/133 | 790,684 (732,160) | 10,669 | 96.9 | 0 |
| GPT-5.6-Luna | Small | Code only | 16/29 | 224,010 (195,584) | 5,625 | 48.2 | 0 |
| GPT-5.6-Luna | Small | FeatureNetwork | 29/29 | 288,720 (259,072) | 6,957 | 45.0 | 0 |
| GPT-5.6-Luna | Medium | Code only | 62/69 | 329,777 (302,336) | 7,268 | 59.4 | 0 |
| GPT-5.6-Luna | Medium | FeatureNetwork | 68/69 | 191,609 (169,984) | 4,235 | 90.5 | 0 |
| GPT-5.6-Luna | Large | Code only | 132/133 | 720,286 (668,672) | 7,707 | 171.0 | 0 |
| GPT-5.6-Luna | Large | FeatureNetwork | 133/133 | 787,303 (738,048) | 9,759 | 84.4 | 0 |
| GPT-6-Sol | Small | Code only | 29/29 | 354,623 (332,928) | 4,398 | 105.0 | 0 |
| GPT-6-Sol | Small | FeatureNetwork | 29/29 | 369,998 (348,160) | 3,446 | 51.3 | 4 |
| GPT-6-Sol | Medium | Code only | 69/69 | 549,113 (519,680) | 4,327 | 70.5 | 0 |
| GPT-6-Sol | Medium | FeatureNetwork | 69/69 | 379,854 (351,360) | 3,838 | 92.0 | 2 |
| GPT-6-Sol | Large | Code only | 133/133 | 291,647 (264,192) | 5,117 | 61.5 | 0 |
| GPT-6-Sol | Large | FeatureNetwork | 133/133 | 586,743 (551,296) | 4,774 | 67.1 | 9 |

All 18 CLI runs exited 0 and emitted a completed turn. Ordinary base tests passed in 17; the corrected GPT-6-Luna Small code-only run failed a base test. Its agent changed the registry dependency graph, so the held-out oracle stopped at `registry_graph_changed` before enumerating checks. This is a failed task with an unavailable oracle score, **not** 0/29. All other rows have the exact post-run oracle counts shown. The Luna screenings documented initial fixtures that passed base tests and failed the oracle, plus known-good controls that passed at each level.

## What the results support

In both corrected Luna series, FeatureNetwork was the only arm to pass every oracle check at Small and Large. Neither arm passed Medium. The GPT-6-Sol same-seed follow-up passed in **both** arms at all three levels. These observations do not show a complexity threshold where ordinary agent coding generally fails: there is one paired run per model and level, and Sol succeeded without FeatureNetwork even at Large. The prior Sol sweep on different seeds also passed in both arms.

The GPT-6-Luna FeatureNetwork arm used 42.8%, 29.3% and 68.1% fewer input tokens than code-only at Small, Medium and Large. GPT-5.6-Luna used 28.9% more, 41.9% fewer and 9.3% more; Sol used 4.3% more, 30.8% fewer and 101.2% more. These are host-reported counts with substantial cached input. A smaller count on a failed task, as at either Luna Medium, is not a successful-task saving. The single-run wall times also vary in direction. Provider prices, retries, network creation and maintenance were not measured, so neither a cost saving nor a model-substitution saving follows.

## Attribution and implementation limits

MCP use was uneven. Corrected GPT-6-Luna made one MCP call at Small and none at Medium or Large. GPT-5.6-Luna made **zero** observed MCP calls across all six runs; its Small and Large FeatureNetwork runs inspected YAML via shell, while its Medium run had no observed network-file access. Sol made 4, 2 and 9 MCP calls in its FeatureNetwork runs. The Luna results therefore cannot demonstrate an MCP benefit. Even where network memory was used, this two-arm design combines YAML documentation and the MCP interface; it does not isolate their effects.

The GPT-5.6-Luna Medium FeatureNetwork agent changed `src/profile.mjs` and centrally rewrote outputs in `src/registry.mjs`, but changed **none** of the 40 affected contract modules. The registry patch branches on output strings and object shapes. Its 68/69 result is valid for the oracle's published registry path, yet direct contract-module calls were outside that oracle. This is a brittle implementation and a poor example of dependency-guided per-contract maintenance. The source registry already exposed the graph to both arms, further limiting attribution to FeatureNetwork.

An earlier GPT-6-Luna series is retained as a **diagnostic pilot only**. Its runner put live event logs and stderr inside each agent checkout. The Small code-only agent read both during its own run (28/29 checks, 791,005 input tokens, 225.2 seconds), contaminating that pair's token, timing and possibly quality outcome. The files were visible in the other five pilot runs even though their observed commands did not directly read them. The pilot's six runs are excluded from the corrected comparison, not silently pooled or replaced. The corrected Luna studies and the Sol follow-up stored live logs and evaluator results outside the agent checkouts; observed command traces provide an audit of direct reads, not an operating-system proof of isolation.

The machine-readable file includes all 18 corrected runs, oracle status, host token fields, process status, observed command and MCP counts, and SHA-256 hashes of source event logs and available oracle JSON. It contains no local checkout paths or transcript text. The prompt, generator and oracle hashes match across the three follow-up studies. Independent applications, repeated fresh paired seeds, and a separate readable-YAML-without-MCP arm are needed before a reliability, threshold or sales-page claim.

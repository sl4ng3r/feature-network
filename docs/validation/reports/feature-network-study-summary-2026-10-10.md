# FeatureNetwork agent study: quality-first summary — 2026-10-10

## Tested outcome

Complete task success required a finished Codex CLI turn, passing ordinary tests and **every** held-out behavior check. In the seven-package SQLite study, the original base test was also run from a frozen copy after each new trial. Partial checks are diagnostic, not successful tasks. Every model name below is the **requested** CLI model; the event logs did not independently confirm the effective provider revision. All results use synthetic projects.

| Study | Code only | YAML only | YAML + MCP configured | Interpretation |
| --- | ---: | ---: | ---: | --- |
| Fanout, GPT-6-Luna, three single-seed levels | 0/3 | not tested | 2/3 | Both arms failed Medium; a single pair per level cannot establish a threshold. |
| Fanout, GPT-5.6-Luna, same three seeds | 0/3 | not tested | 2/3 | Configured arm passed Small and Large; it made zero MCP calls. |
| Fanout, GPT-6-Sol, same three seeds | 3/3 | not tested | 3/3 | GPT-6-Sol succeeded without network help at every level. |
| Seven packages, four flows, five GPT-6-Luna seed pairs | 4/5 | not tested | 4/5 | One exclusive win per arm; no quality advantage at this level. |
| Seven packages, eight flows, five GPT-6-Luna seeds | 1/5 | 3/5 | 3/5 | Configured and YAML-only arms have equal success counts but different winning seeds. |

Sources: [fanout model comparison](complexity-luna-followup-2026-10-09.md), [cross-package five-pair replication](complexity-monorepo-replication-2026-10-10.md), [YAML-only ablation](complexity-monorepo-yaml-ablation-2026-10-10.md). The cross-package fixture increases breadth to 328 generated modules and has a longest profile-to-audit path of five dependency edges; all seven packages remain in **one** Git repository. The original eight-flow screening seed counted as a failure in both arms despite 419/420 checks in the configured arm.

## What the evidence means

There is a **candidate quality signal** on the widest synthetic workload: 3/5 complete configured-arm successes versus 1/5 code-only. Five paired seeds are too few for a reliable failure rate or a general complexity crossover; only two large pairs favor the configured arm, and a two-sided paired sign test gives 0.5. YAML-only also reached 3/5, including one seed where the configured arm failed, and the ablation was designed after the initial two-arm results. The data do not isolate a causal network effect.

No configured FeatureNetwork arm in the eight-flow trials called MCP. In the four-flow screening pair, Luna called `network_impact` and `network_context` but both arms succeeded and the configured arm used more time and input tokens. In a separate explicit tool diagnostic Luna invoked MCP, but chose a broad query in the wrong graph direction; the returned 42 IDs contained no dependency paths. The server worked in a direct SDK impact query. The most concrete integration issue is **unreliable tool discovery and selection in natural coding tasks**: the benchmark registered MCP but did not install the native FeatureNetwork skill or hooks, and agents could read YAML directly. See the [MCP investigation](mcp-discovery-2026-10-09.md).

GPT-5.6-Luna was actually tested on the fanout seeds. It completed Small and Large only in the configured arm, but used more input tokens for those successful tasks than its code-only counterpart. The Medium configured run failed and did not visibly consult network files; its central registry rewrite also bypassed direct contract-module maintenance. GPT-6-Luna had the same 2/3 configured success count on those seeds, while GPT-6-Sol succeeded in both arms. These tiny samples do not establish that switching to GPT-5.6-Luna lowers total cost or preserves quality. Tokens and time remain secondary to complete success; creation and maintenance of the network were not measured.

## Safe public wording and next test

An evidence-consistent statement is: **“In an exploratory synthetic seven-package change, the FeatureNetwork-configured arm completed 3 of 5 widest tasks versus 1 of 5 without a network. A readable-YAML-only arm also completed 3 of 5; agents did not call MCP in those trials.”** Do not describe this as a proven reliability increase, general complexity threshold, token saving or MCP-specific benefit.

The next quality study should use an independently chosen real application, fixed acceptance tests, at least ten fresh paired seeds and three arms: code only, readable YAML, and the **actually installed** FeatureNetwork host integration with skill/hooks and MCP. Include network initialization and semantic upkeep work. A separate test across Git repositories needs a federation feature first: the current core binds one project root and resolves relations only among local feature IDs. The synthetic monorepo is an intermediate test, not a cross-repository implementation.

---
name: feature-network-impact
description: Use when the user explicitly requests feature-network-impact to inspect stored dependencies and possible effects for a feature or a broader topic.
disable-model-invocation: true
user-invocable: true
---

# Inspect stored impact paths

Resolve the user's description with `network_context` summaries, then call `network_impact` for the relevant feature IDs or paths. A broad topic such as the whole restore area can select a group; explain its scope without forcing one feature. Natural interpretation and selection belong to the host agent.

Normally use direction `both`, depth 2 and the default 20-feature/12,000-byte budget. Present the selected area, affected features and directed relationship paths. Separate `evidenced` paths with their recorded sources from `hypothesis` paths. State the actual depth, `depthLimited`, omissions, integrity restrictions and `coverage:partial`; stored relationships do not prove complete impact or current semantic correctness.

For truncated results, offer continuation and use `network_impact({cursor: result.nextCursor})` with no extra selectors or budget. `nextCursor` is the response field; `cursor` is the request field. Context continuation similarly uses `network_context({cursor: result.nextCursor})`. Collect all indexed named sections or concatenate JSON fragment text by UTF-16 offsets through `total` and parse before presenting complete details. Restart queries if the revision changes.

A no-hit result is a memory gap, not proof of no dependencies. Report `not_initialized` or `pending_recovery` transparently. This explicit command reads stored memory only: do not inspect source to infer new relations, update YAML, confirm hashes or decisions, recover journals, change checkpoints, or continue maintenance through completion hooks. Return after the impact report.

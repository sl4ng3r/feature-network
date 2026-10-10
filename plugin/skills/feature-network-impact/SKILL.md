---
name: feature-network-impact
description: Use when the user explicitly requests feature-network-impact to inspect stored dependencies and possible effects for a feature or a broader topic.
disable-model-invocation: true
user-invocable: true
---

# Inspect stored impact paths

Resolve the user's description with `network_context` summaries to identify the direct feature roots of the requested change or topic, then query those root IDs. For example: `network_impact({ids:["user-profile"],direction:"both",depth:2})`. Do not include all candidate dependents as origins: every selected origin has a zero-length seed path, so selecting all affected features can hide dependency paths. A broad topic may have multiple direct roots; explain that scope without forcing one feature. Natural interpretation and selection belong to the host agent.

When dependent children point to parents, `incoming` finds dependents; `outgoing` follows the dependencies of the selected roots. Normally use explicit direction `both`, depth 2 and the default 20-feature/12,000-byte budget. Present the selected area, affected features and directed relationship paths. Separate `evidenced` paths with their recorded sources from `hypothesis` paths. State the actual depth, `depthLimited`, omissions, integrity restrictions and `coverage:partial`; stored relationships do not prove complete impact or current semantic correctness.

For truncated results, offer continuation and use `network_impact({cursor: result.nextCursor})` with no extra selectors or budget. `nextCursor` is the response field; `cursor` is the request field. Context continuation similarly uses `network_context({cursor: result.nextCursor})`. Collect all indexed named sections or concatenate JSON fragment text by UTF-16 offsets through `total` and parse before presenting complete details. Restart queries if the revision changes.

A no-hit result is a memory gap, not proof of no dependencies. Report `not_initialized` or `pending_recovery` transparently. This explicit command reads stored memory only: do not inspect source to infer new relations, update YAML, confirm hashes or decisions, recover journals, change checkpoints, or continue maintenance through completion hooks. Return after the impact report.

Read the returned `freshness` entry for every displayed feature, including reassembled fragments. `freshnessScope:returned_features` and `freshnessBasis:technical_now_saved_review` mean freshly observed source hashes plus local saved review decisions for this page only. Show `changed`, `missing`, `unknown`, or `review:open` alongside the stored assertion; `integrity:valid` and `coverage:partial` do not clear these warnings. `current` with a recorded review does not prove semantic completeness. Preserve warnings across selection and impact steps, and never silently repair them during this read command.

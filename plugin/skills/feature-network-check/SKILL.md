---
name: feature-network-check
description: Use when the user explicitly requests feature-network-check for a fresh technical inspection of project memory and its recorded references.
disable-model-invocation: true
user-invocable: true
---

# Check technical memory state

For schema 2, full checks return fresh_snapshots, capped feature-source freshness and safe unmapped changes. Matching bytes do not imply recorded semantic review; review open remains explicit. Connected scope is optional, with UUID selections and visible omissions/limits. Reading maintenance operation progress is also read-only; neither mode recovers journals, adds connections nor learns from the current conversation.

Call `network_check` with `mode:"full"`. This performs a fresh technical check, including recorded references, and is read-only. Source/hash inspection by that tool is not semantic code analysis by the host agent.

Report integrity findings, changed or missing references, unknown/unmapped changes, open decisions and missing reason-cache entries. A deleted unmapped file remains a reported unknown change; check does not submit an absence observation or decide that its meaning is unchanged. Distinguish technical hash equality from semantic review: even current baselines do not close an absent or invalid decision. Present partial coverage and all visible limits.

If the bounded projection is truncated, show omitted counts and the findings actually returned. A larger supported budget, up to 64,000, may expose more findings; it does not guarantee a complete report. This tool has no query cursor. Report unavailable/not-initialized state or `pending_recovery` rather than recovering the journal.

Return the findings and, where useful, suggest an explicit targeted `feature-network-sync` request. Do not perform that sync, inspect source semantics, invent reasons, submit `network_update`, confirm baselines/decisions, rewrite YAML, start or checkpoint bootstrap, recover journals, or continue maintenance through completion hooks. Checking alone never changes confirmed review state.

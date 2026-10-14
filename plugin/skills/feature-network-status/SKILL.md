---
name: feature-network-status
description: Use when the user explicitly requests feature-network-status to see the project's saved memory state and open review items.
disable-model-invocation: true
user-invocable: true
---

# Show saved memory status

In schema 2, summary returns project revisions/integrity and saved review counts with basis last_known, without source reads. It does not claim fresh source state. An optional connected scope must remain within registered UUIDs and visible limits. Maintenance progress is readable through network_check maintenance, including after an interrupted publication; reading does not recover or confirm it.

For this explicit read-only command, call `network_check` with `mode:"summary"`. Explain its `last_known` basis: saved review and reference state is not a fresh source or semantic inspection. Present available status, partial coverage, open decisions, integrity limits and omitted counts. A current technical baseline alone does not establish a completed semantic review; missing decision cache leaves review open.

If initialization progress is relevant, `network_bootstrap` with `action:"status"` may show saved progress, also `last_known`; it does not refresh the inventory. Respect bounded projections and disclose omissions rather than presenting a complete inventory.

Report `not_initialized`, unavailable state or `pending_recovery` plainly. A pending journal requires a later authorized write path; status performs no recovery. Mention `feature-network-check` for an explicitly requested fresh technical check or `feature-network-sync` for targeted code review when useful, without executing either as part of status.

Return after the report. Perform no source analysis, feature or baseline updates, bootstrap start/next/checkpoint, or maintenance continuation, including completion hooks. No per-tool project root is accepted, and this command does not invoke a model API.

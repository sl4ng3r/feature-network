---
name: feature-network-show
description: Use when the user explicitly requests feature-network-show to inspect project memory by description, choose a feature, or browse an overview.
disable-model-invocation: true
user-invocable: true
---

# Show project memory by description

Schema 2 also returns knowledge rows. Distinguish ideas, explicit user requirements and source observations; show provenance and unresolved contradictions rather than treating them all as implemented code. Names are display labels; select rows with qualified features or knowledge references using their project UUID and local ID. Context defaults to last_known hints; request full detail only for the chosen items. Connected scope includes only explicitly registered projects and reports unavailable/limited scope.

Use `network_context`; this explicit command reads stored memory. Natural-language interpretation and conversational selection belong to the host agent, while the core provides deterministic token/path/ID lookup. The user needs no feature ID or code symbol.

Choose the display recipe matching the request:

- **No argument:** Show up to ten short feature summaries as a paginated overview. Include a visible continuation option and remaining/omitted count; never expand every feature by default.
- **Natural description:** Translate the description into useful context queries. Inspect the returned summaries to decide whether a feature is a grounded match. For a clear match, request `detail:"full"` for its selected ID and show its summary, key points, source references and relations.
- **Ambiguous description:** Show at most five numbered candidates with short distinguishing summaries, using `limit:5`. Explain that more candidates are available. Ask for a number or a more specific description, then fetch the selected feature's full details. Keep numbers attached to the displayed candidate list; never require the user to supply an internal ID.
- **Broad theme, such as the whole restore area:** Show the related group of summaries and explain their connections and boundaries. Offer narrower details or continuation without forcing an artificial single-feature choice.
- **No grounded match:** State the knowledge gap and suggest another description or an explicit init/sync request. Partial memory does not prove the underlying feature is absent. Do not invent content or analyze source code to fill the gap in this command.

Honor the default 20-feature/12,000-byte query bounds and show omissions, partial coverage, integrity limits and hypothetical relations. A detail may be a complete feature, indexed named sections, or explicit JSON fragments. Collect all sections; concatenate fragments in UTF-16 offset order through `total`, then parse. Continue with `network_context({cursor: result.nextCursor})`: `nextCursor` is the response field, `cursor` is the input field. Send no additional selectors or budget beside `cursor`. Restart if the revision changes. Do not display an incomplete fragment as a complete assertion.

Report missing initialization or `pending_recovery`; perform no recovery. Return after display/selection. Do not update YAML, baselines or checkpoints, start bootstrap, perform new semantic source analysis, or continue maintenance through hooks. This command has no conversation-search API, model API or per-tool root.

Read the returned `freshness` entry for every displayed feature, including reassembled fragments. `freshnessScope:returned_features` and `freshnessBasis:technical_now_saved_review` mean freshly observed source hashes plus local saved review decisions for this page only. Show `changed`, `missing`, `unknown`, or `review:open` alongside the stored assertion; `integrity:valid` and `coverage:partial` do not clear these warnings. `current` with a recorded review does not prove semantic completeness. Preserve warnings across selection and impact steps, and never silently repair them during this read command.

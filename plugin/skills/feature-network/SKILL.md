---
name: feature-network
description: Use when developing or fixing code in a project with FeatureNetwork memory, including changes affecting related features, tests, or persistent data.
disable-model-invocation: false
user-invocable: true
---

# FeatureNetwork during development

Keep project memory grounded in the code inspected by the current host agent. FeatureNetwork is independent of Superpowers; a user's Superpowers opt-in rule does not disable this skill. Use the existing five MCP tools and the host's normal source-reading, diff, and testing tools. The MCP process already binds its project; tool inputs have no root argument or model API.

1. **Context:** Query `network_context` by the user's description or actual changed paths. Read returned summaries before selecting full details. Treat `coverage: partial`, gaps, integrity problems and omissions as visible limits. A missing network is a gap: continue the authorized development task and offer the explicit `feature-network-init` entry when useful. Whole-project initialization belongs only to an explicit request.
2. **Impact:** Call `network_impact` for relevant features, normally depth 2. Distinguish evidenced paths from hypotheses and depth limits. Verify necessary source and tests yourself; matching hashes or relationships alone do not prove semantic correctness.
3. **Develop:** Follow the project's testing rules and inspect the targeted code. Identify actual current-turn changes separately from pre-existing work. A general conversation, an `unspecified` policy, a cached backlog or a clean check is insufficient authorization for automatic maintenance. Explicit `status`, `show`, `impact`, and `check` stay read-only, including completion hooks.
4. **Maintain:** After an actual development request with current changes, read only the relevant changed code and necessary dependencies. Refresh full feature details; preserve manual key points and other work. Make focused `network_update` requests, using returned feature fingerprints as the `expected` mapping (new path entry, for example `{"network-spec/new-feature.yaml":null}`; never `expected:null`) and the complete `expectedRevision`. Supply hashes of sources actually inspected. Use only `decision.outcome: "updated"` when memory changed or `"no_semantic_change"` when inspection supports no memory change, always with a concrete `reason`. No cosmetic YAML rewrite is needed for the latter. `verifiedReferences` confirms actual mapped sources; unmapped sources can be closed only with reasoned `no_semantic_change` in `observations`, never baselines. For actual absent sources use `{path,state:"missing"}` with `no_semantic_change`, complete revision and `expectedMissingReferences`; first repair any mapped missing reference in the network. An absent decision cache leaves review open even with current technical hashes.
5. **Check:** Run `network_check` with `mode:"full"` after targeted maintenance. It is read-only and never confirms decisions or recovers journals. Report unresolved items, partial coverage and technical versus semantic limits. On conflict or interruption, refresh context/check before retrying: a network write may have succeeded while semantic review remains open. Continue only the authorized work; leave unrelated backlog visible.

## Bounded responses

Use defaults of 20 features and 12,000 UTF-8 bytes. Consume complete features, all indexed named sections, or JSON fragments concatenated by UTF-16 offset to `total` and then parsed. Continue with `network_context({cursor: result.nextCursor})` or `network_impact({cursor: result.nextCursor})`: the response field is `nextCursor`, the input field is `cursor`. Send no other selectors or budget beside `cursor`; its public budget is already preserved. Requery after revision conflict. An incomplete projection is not a complete feature to overwrite. Increase budget only within the tools' documented limit when necessary.

Example: after adding a persistent profile field, inspect profile plus evidenced backup/restore paths, test their roundtrip, update only verified affected assertions, then report the final check and remaining gaps.

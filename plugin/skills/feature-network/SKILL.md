---
name: feature-network
description: Use when developing, inspecting code, or discussing project decisions and requirements in a project with FeatureNetwork memory.
disable-model-invocation: false
user-invocable: true
---

# FeatureNetwork during development

Keep project memory grounded in the code inspected by the current host agent. FeatureNetwork is independent of Superpowers; a user's Superpowers opt-in rule does not disable this skill. Use the existing five MCP tools and the host's normal source-reading, diff, and testing tools. The MCP process already binds its project; tool inputs have no root argument or model API.

## Schema 2: connected learning

Use this flow when context rows have `project` and `kind`. The numbered development flow and legacy write examples below apply to schema 1. They do not restrict schema-2 conversation learning when its actual local register enables it. Explicit status/show/impact/check and requests to only inspect remain read-only in both versions. Continue the original authorized coding/testing task; memory permissions do not withdraw it.

- Read short `network_context` summaries first. Hints are last_known and need no source scan. Select relevant `features:[{project,feature}]` or `knowledge:[{project,knowledge}]` for full detail; these use local IDs, not qualified row keys. Use `freshness:"returned_features"` to refresh selected network/source state before a write. Connected scope is explicit; impact defaults to registered projects, fresh consumer snapshots, direction both and depth 2. Resolve direct roots first. Report omitted/unreachable projects and hypotheses.
- Reuse analysis already needed for the task. A conversation can add an idea or explicit user requirement without a code diff or fake feature/source. An inference remains an inference; an observation from source review needs inspected evidence. Preserve manual points and prior statements. Contradictions and supersession remain explicit. Never archive raw prompts, secrets, or every passing remark.
- Group meaningful changes into one `kind:"memory"` update per target project. Supply complete schema-2 upserts, explicit path deletes, exact target `expectedRevision`, and `expected` fingerprints for only changed paths (new paths null). Use `purpose:{mode:"unspecified",explicitReadOnly:false,basis:"conversation"}` for discussions, basis analysis/development for inspected code, or mode sync for explicit synchronization. Actual learning configuration and target rights still govern the write. No semantic delta means no update or cosmetic date change.
- Conversation uses sources `[]` and no review. Code-backed changes use inspected qualified `sources:[{project,path,hash}]`. Optional `review:{outcome:"updated",reason:...}` confirms changed source-backed documents; unchanged code uses empty upserts/deletes/expected and explicit review `documentFingerprints:{uuid:{path:hash}}`, `revisions:{uuid:revision}`, outcome no_semantic_change and inspected sources. Unmapped sources use that outcome too. A missing source uses state missing, no invented hash. Source-backed reviews cannot be fabricated from conversation or matching bytes alone.
- Keep complete update/purpose/review intent until its receipt. `review:"open"` remains open. After interruption, read `network_check({maintenance:{operationId}})` and resupply the identical original update with operationId and current expectedOperationRevision. Manual divergence requires replanning, never blind overwrite. No cross-project atomicity is promised. Read-only checks never finish journals. Finish with focused findings and partial coverage; no forced continuation for conversation alone.

## Schema 1: existing development flow

1. **Context:** Query `network_context` by the user's description or actual changed paths. Read returned summaries before selecting full details. Treat `coverage: partial`, gaps, integrity problems and omissions as visible limits. A missing network is a gap: continue the authorized development task and offer the explicit `feature-network-init` entry when useful. Whole-project initialization belongs only to an explicit request.
2. **Impact:** Use `network_context` summaries to resolve the directly changed feature roots, then query their IDs with explicit direction, for example `network_impact({ids:["user-profile"],direction:"both",depth:2})`. Do not include all candidate dependents as origins: each selected origin has a zero-length seed path, which can hide the relationship paths you want to inspect. When dependent children point to parents, `incoming` finds dependents; normally use `both` and depth 2. Multiple directly changed roots are valid; explain their scope. Distinguish evidenced paths from hypotheses and depth limits. Verify necessary source and tests yourself; matching hashes or relationships alone do not prove semantic correctness.
   For a changed business state, follow the input, persisted state, effective decision and every affected view, including paths without a direct code import. Compare the meaning of controls, counters and status text with the stored state; a selected option, a saved assignment and effective access may differ. Follow each returned relation's `when` and `check`. If the graph omits a suspected view, inspect the relevant code and tests and report the memory gap; an absent edge is not evidence of no effect.
3. **Develop:** Follow the project's testing rules and inspect the targeted code. Identify actual current-turn changes separately from pre-existing work. A plain coding request remains the user's authorized development task even when command classification is `unspecified`; FeatureNetwork context does not withdraw original product-work authorization. Additional automatic memory maintenance requires that actual development request plus current-turn changes. A general conversation, `unspecified` classification alone, a cached backlog or a clean check is insufficient evidence. A memory-only Stop continuation reviews scoped memory and must not add product edits, auto-initialize the project or process old backlog. Explicit `status`, `show`, `impact`, and `check` stay read-only, including completion hooks.
   Test the applicable pending and active lifecycle states through the write path and affected read views. Keep security and entitlement decisions distinct from presentation state. A passing storage assertion alone does not establish that a later view communicates the same business meaning.
4. **Maintain:** After an actual development request with current changes, read only the relevant changed code and necessary dependencies. Refresh full feature details; preserve manual key points and other work. Make focused `network_update` requests, using returned feature fingerprints as the `expected` mapping (new path entry, for example `{"network-spec/new-feature.yaml":null}`; never `expected:null`) and the complete `expectedRevision`. Supply hashes of sources actually inspected. Use only `decision.outcome: "updated"` when memory changed or `"no_semantic_change"` when inspection supports no memory change, always with a concrete `reason`. No cosmetic YAML rewrite is needed for the latter. `verifiedReferences` confirms actual mapped sources; unmapped sources can be closed only with reasoned `no_semantic_change` in `observations`, never baselines. For actual absent sources use `{path,state:"missing"}` with `no_semantic_change`, complete revision and `expectedMissingReferences`; first repair any mapped missing reference in the network. An absent decision cache leaves review open even with current technical hashes. Compose mapped and unmapped reviews as the two guarded requests below.
5. **Check:** Run `network_check` with `mode:"full"` after targeted maintenance. It is read-only and never confirms decisions or recovers journals. Report unresolved items, partial coverage and technical versus semantic limits. On conflict or interruption, refresh context/check before retrying: a network write may have succeeded while semantic review remains open. Continue only the authorized work; leave unrelated backlog visible.

## Guarded review requests

For mapped feature changes and unmapped test changes, use two guarded writes. Put only actually mapped references in `verifiedReferences`; do not add a test as a network reference just to bypass this distinction. An explicit `observations` array replaces the implicit `verifiedReferences` observations: it must be nonempty and include every verified source's identical path and hash. Never send empty `observations` when relying on the fallback. An `updated` decision cannot include unmapped observations; review those separately with reasoned `no_semantic_change` only when source inspection supports that result.

Copy exact revision and fingerprint values from actual structured tool responses. Hash the exact source bytes you inspected with the host's SHA-256 tool; do not truncate, retype or reconstruct hashes. Never confirm unseen content. Before the example, set `featureId`, `mappedPath`, `mappedHash`, `unmappedTestPath` and `unmappedTestHash` from that inspection. Prepare `reviewedFeature` from the complete refreshed feature, retaining manual key points and changing only source-grounded assertions; partial coverage remains partial. Replace the example reasons with concrete findings from that review. The tool-call helpers below return `structuredContent` from successful responses; stop on any error.

```javascript
const context = await network_context({ids:[featureId],detail:"full"});
// Prepare reviewedFeature from this exact complete context response before writing;
// preserve manual points and re-review if an earlier preparation used another revision.
await network_update({
  expected:context.fingerprints,
  expectedRevision:context.revision,
  upserts:[reviewedFeature], deletes:[],
  verifiedReferences:[{path:mappedPath,hash:mappedHash}],
  decision:{outcome:"updated",reason:"Inspected mapped source and updated the affected feature assertions"}
  // observations intentionally omitted: verifiedReferences supplies the reviews.
});
const fresh = await network_context({ids:[featureId],detail:"full"});
await network_update({
  expected:{}, expectedRevision:fresh.revision,
  upserts:[], deletes:[], verifiedReferences:[],
  observations:[{path:unmappedTestPath,hash:unmappedTestHash}],
  decision:{outcome:"no_semantic_change",reason:"Inspected the unmapped test changes; they assert the mapped behavior without separate feature semantics"}
});
```

On `invalid_input`, inspect the advertised input schema and copy fresh exact tokens: revisions, fingerprints and source hashes must be complete 64-character lowercase SHA-256 values, and unknown fields are rejected. On `invalid_decision`, repair composition: omit `observations` for the mapped write, or include every verified path/hash in a nonempty explicit list; move unmapped tests to the separate `no_semantic_change` request. Do not change outcomes without supporting review or bypass a guard. On conflict or interruption, refresh context/check before retrying because network publication may have succeeded while semantic review remains open.

## Bounded responses

Use defaults of 20 features and 12,000 UTF-8 bytes. Consume complete features, all indexed named sections, or JSON fragments concatenated by UTF-16 offset to `total` and then parsed. Continue with `network_context({cursor: result.nextCursor})` or `network_impact({cursor: result.nextCursor})`: the response field is `nextCursor`, the input field is `cursor`. Send no other selectors or budget beside `cursor`; its public budget is already preserved. Requery after revision conflict. An incomplete projection is not a complete feature to overwrite. Increase budget only within the tools' documented limit when necessary.

Example: after adding a persistent profile field, inspect profile plus evidenced backup/restore paths, test their roundtrip, update only verified affected assertions, then report the final check and remaining gaps.

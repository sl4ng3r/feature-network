# Local STDIO MCP contract

Requires Node.js 24 LTS. Build with `npm ci` then `npm run build`. The generated `plugin/dist/cli.mjs` includes runtime dependencies; copying it to an installation's `dist/cli.mjs` does not require `node_modules` or network access. Start with:

```sh
node plugin/dist/cli.mjs mcp --project-root <existing-project-directory>
```

The process binds this canonical root once, including before a network marker exists. Tool arguments never select roots. STDOUT contains only MCP protocol messages; STDERR and tool failures use redacted stable codes. Actual plugin installation storage is excluded from all source-reference and inventory operations, including canonical aliases. No cloud, model API, authentication, or host installation is performed.

There are exactly five tools. Inputs are strict Zod objects: unknown properties are rejected with `invalid_input`. Full JSON input schemas are available through MCP `tools/list`.

- `network_context`: IDs, paths or natural query; default summary, optional full detail. Without a selector it returns a paginated overview. Responses carry the network `revision` and observed `fingerprints` for `_meta.yaml` and feature IDs actually represented on this page. These project-relative hashes are entries in the `network_update.expected` mapping; a new path uses a null entry, for example `{"network-spec/new-feature.yaml":null}`, never a whole `expected:null`.
- `network_impact`: context selectors plus direction (`both`, `incoming`, `outgoing`) and depth (default 2). Evidenced and hypothetical paths remain explicit, as does a depth boundary.
- `network_update`: `expected`, optional complete `expectedRevision`, feature `upserts`, feature-ID `deletes`, `verifiedReferences: [{path,hash}]`, a mandatory `decision: {outcome,reason}` with outcome exactly `updated` or `no_semantic_change` and a nonempty reason, and optional `initialize`. It applies guarded changes and verified actual source hashes, then records semantic decisions against the resulting revision. Optional `observations` supports existing `{path,hash}` or absent `{path,state:"missing"}` sources. Missing observations require `expectedRevision` and `no_semantic_change`, with network repair removing mapped missing references first. `expectedMissingReferences` guards actual absence under the same write lock. Verified baselines are restricted to actual network references; unmapped sources belong in `observations`. A lost decision cache leaves review open even when the technical baseline remains current. Network and decision publication are separate guarded writes; interruption/conflict after a successful network write can leave that network change applied and semantic review open. Refresh context/check before retrying.
- `network_check`: optional mode (`summary` by default, or `full`) and session ID. Summary is `last_known`; full performs a technical check. Both are read-only and never confirm semantic decisions or recover journals. Bounded projections prioritize open decisions and references requiring review, and disclose omitted entries.
- `network_bootstrap`: `start`, `next`, `checkpoint`, `status`. Responses expose `runRevision`, `networkRevision`, active `package`, compact `progress` and diagnostics rather than the entire persisted file state. Packages are metadata only: paths, actual hashes, line ranges and UTF-8 byte ranges, at most 20 slices and 65,536 planned bytes. `start` supports smaller `maxFiles`/`maxBytes`, scope, exclusions, reconcile, and `sanitizedExamples: [{path,hash}]`; the latter is an explicit caller attestation, not proof of secret-free contents. `status` is read-only `last_known`.

Checkpoint requests include the raw `runRevision` token as `expectedRunRevision`, active `packageId`, current `networkRevision`, exact package `sources`, saved `featureFingerprints` keyed by feature ID, and one explicit result/reason per slice. A null package checkpoint requires `relationalReviewComplete:true`, a reason and every current feature fingerprint. Technical completion retains `coverage:partial`. Source, network and CAS conflicts cannot acknowledge a package. Existing features survive restart/replanning. Trusted runtime validation callbacks remain internal core code and are never exposed through MCP.

Every tool accepts optional `budget` (512–64,000 UTF-8 bytes, default 12,000). The measured boundary is the complete JSON-serialized MCP `CallToolResult`, including `structuredContent`, one short readable text block and wrapper metadata. JSON-RPC transport IDs/envelopes are outside this boundary. The readable text summarizes only the final bounded projection: its first shown feature or finding, update revision/review receipt, or bootstrap status/progress/package. It explicitly names fragments/sections, continuation and omissions. Full payloads are not repeated as text. Query adapters reserve the actually rendered text with at most eight monotonic attempts against the same immutable index; they reject an unfit result instead of looping indefinitely. Query cursors are structured `{revision,kind,parameters,offset,fragment}` and retain the public requested budget. Internal wrapper reservation does not change the public minimum. Unfit metadata returns a bounded stable error rather than overflowing or producing an empty continuation loop.

Queries return complete feature objects, complete named sections (`section`, `sectionIndex`, `sectionCount`) or explicit JSON fragments (`format:"json"`, `offset`, `total`, `text`). Fragment offsets/lengths use UTF-16 code units and never split surrogate pairs. Concatenate fragment text in offset order until `total`, then `JSON.parse`; collect all indexed sections to reconstruct sectioned features. The response property is `nextCursor`; the request property is `cursor`. Continue with `network_context({cursor: result.nextCursor})` or `network_impact({cursor: result.nextCursor})`, with no additional selectors or budget; changed revisions or parameters reject the cursor.

Check/update/bootstrap projections disclose `truncated` and per-field `omitted` counts. A bootstrap package that cannot fit is wholly omitted (`package:null`, `packageOmitted:true`, `nextAction`) rather than partially exposed. Retry up to budget 64,000; if metadata still cannot fit, `start` with smaller `maxFiles`/`maxBytes` safely replans the existing run without feature deletion or acknowledging pending slices. Too-small write receipts are rejected before mutation. Read-only missing networks create no files.

These are local protocol and bundle tests, not live acceptance of Codex, Copilot CLI or Copilot App.

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

## Read caches and scoped freshness

Read snapshots share per-process byte/parsed caches bound to canonical project/storage paths, exclusion options and cache/schema version. File identity includes device, inode, mode, size, nanosecond mtime and ctime; same-length edits and restored mtimes invalidate it. Readers still take the short lock, check journals first, compare two captures and validate references/exclusions. Git diagnostics are still observed, not promoted from a stale cache. MCP consumers incrementally refresh the index and reuse unchanged entries. Fresh writer validation and semantic confirmation bypass these caches.

`.feature-network/read-cache.json` is disposable parsed YAML data. Its strict versioned envelope, project/options binding, complete network revision/fingerprints, per-file hashes/IDs and checksum are validated. Matching cached entries may survive unrelated file changes; each is admitted only against current source bytes/fingerprint. Only already-authorized network/runtime bookkeeping writers populate it under lock. Read tools and cache misses/corruption rebuild in memory without persisting or recovering. It contains no confirmed source baseline or semantic decision. It protects against accidental corruption, not a malicious same-user process forging a new cache and checksum.

Context and impact return `freshnessScope:"returned_features"`, `freshnessBasis:"technical_now_saved_review"`, and `freshness` keyed by IDs actually emitted. Each feature has aggregate `state` (`missing`, `changed`, `unknown`, or `current`, in that priority) and `review` (`open` or `recorded`). All its reference paths use the same policy as full check; only candidate page features receive fresh technical hash observations. A saved decision is matched against the complete network's feature associations even when the page is scoped. Missing/stale/corrupt baselines and decisions stay unknown/open. This is neither semantic analysis nor a whole-project/branch freshness assertion. The full check exposes individual path findings. Fragment pages repeat their feature warning and include every byte in the budget; small metadata-heavy requests can return controlled `invalid_query`.

Bootstrap `records` lists unresolved and excluded paths/reasons without source content, unresolved first. `selectedScope` exposes selected scope/exclusions, or counts plus `detailsFilter:"scope"` when compacted. A `status` request accepts `recordFilter` (`all`, `needs_review`, `excluded`, `scope`) and `recordCursor`. Continue using `nextRecordCursor`; its run revision, filter and offset bind the listing. `recordsOmitted` counts the exact remaining records for that filter, independent of omitted analysis packages. Even package-free invalid UTF-8 and nested repository exclusions remain reachable. Scope configuration is itself pageable with filter `scope`. Stale cursors and metadata/record budgets too small to progress produce controlled errors, never empty infinite continuation.

Storage rejects special entries before opening and uses POSIX nonblocking/no-follow reads plus handle-level regular-file validation. Normal file writes are flushed on all platforms. Parent-directory fsync runs on POSIX and errors propagate. Windows skips the unsupported directory flush, providing weaker directory-entry power-loss durability; journal/CAS recovery and regular-file flushes remain. Real Windows CI results are still required before claiming that platform verified.

For a mutating bootstrap call, a long individual record may require a larger status budget. The preflighted successful receipt then retains `runRevision`, exact `recordsOmitted`, `nextRecordCursor`, scope counts and explicit omitted fields; `recordsRequireLargerBudget:true` never acknowledges the unresolved file. Read status with that cursor at a larger budget.

## Connected schema-2 memory

Schema-1 inputs/results above remain supported. Schema 2 is an explicit opt-in via the reviewed local `upgrade` CLI; plugin updates never migrate a project. Exactly the same five tools serve both versions. Local connection configuration is separate from MCP inputs: no tool accepts a filesystem root, callback, registry edit or host installation. Project selectors use persistent UUIDs; plain feature IDs mean the active project.

`network_context` accepts `scope: active|connected`, `projects`, qualified `features: [{project,feature}]`, `knowledge: [{project,knowledge}]`, `knowledgeTypes`, and `freshness: last_known|returned_features`. Start with summaries (default); fetch `detail: full` for selected rows. Rows distinguish `kind: feature|knowledge`, `project`, `localId` and the qualified index key `id`. Knowledge statements separately name idea, requirement or observation, origin and evidence. Use the qualified `features` selector rather than copying an index key into plain `ids`.

Context hints default to `last_known`, without source reads; unchanged session snapshots may be reused. Impact defaults to fresh snapshots across selected registered projects and source checks only for returned features. Source owners can be other explicitly connected projects, including owners outside the selected network snapshots. `projectsExamined` counts network snapshots, while `sourceValidationScope` identifies the source-check scope. A missing/denied project or source remains unresolved/open. Neither snapshot validity nor matching bytes proves complete business coverage. Default project cap is 8, explicit cap 32; feature visits default to 1,000, explicit cap 10,000. Limits and unexamined projects/count uncertainty are visible. Impact requires direct origins, defaults to direction both and depth 2. Consumers' snapshots are refreshed too, so newly added incoming relationships are considered.

Connected cursors additionally bind the local register revision, participating project revisions and selections. Continue using only `cursor`; a changed participant or register invalidates continuation. Complete MCP JSON remains within the requested UTF-8 budget, including its fixed short text wrapper. Existing UTF-16 fragment reconstruction applies to connected rows and their `document` payloads as well.

Schema-2 `network_update` uses the explicit `kind: memory` input:

```json
{
  "kind": "memory",
  "targetProject": "11111111-1111-4111-8111-111111111111",
  "expectedRevision": "<complete target network SHA-256>",
  "expected": {"network-spec/knowledge/roles.yaml": null},
  "upserts": ["<complete schema-2 knowledge or feature document>"],
  "deletes": [],
  "sources": [],
  "purpose": {"mode":"unspecified","explicitReadOnly":false,"basis":"conversation"},
  "reason": "User explicitly discussed a common role model"
}
```

The example placeholders are explanatory, not executable inputs. Copy complete network tokens and only the changed paths' fingerprints from `projects[uuid]` context metadata. A new document has `null`. Complete strict schema-2 document objects belong in upserts. Preserve existing statements/manual key points and use explicit supersession/retraction; unlisted documents are never deletions. No-op/date-only proposals create no maintenance record. Learning must be enabled in the actual local register, or the purpose must be explicit init/sync; read-only purposes override it. A conversation needs no artificial code reference and cannot confirm source review. `basis: analysis|development|explicit_sync` may supply actually inspected qualified `{project,path,hash}` observations. Changed source-backed documents require those observations. Product code is never edited by this tool.

An optional `review` block contains outcome, reason and optional supporting document fingerprints/revisions. A mapped change can infer its changed source-backed target documents; explicit cross-project support uses `documentFingerprints: {uuid: {path: hash}}` and `revisions: {uuid: revision}`. A review-only request uses empty expected/upserts/deletes plus explicit documentFingerprints/revisions and sources; it confirms inspected unchanged code without inventing a YAML edit. Unmapped sources require `no_semantic_change`. Conversation-only documents cannot receive a source review. A receipt with `review: open` means no semantic confirmation was recorded.

Writes require at least 900 response bytes, checked before publication. Each call updates one target; no global transaction is claimed. Receipts contain `operationId`, `operationRevision`, `targetRevision`, publication state and review state. To resume, resupply the identical original update/purpose/review with the operation ID and freshly observed operation token. Already-published intended bytes are recognized without reapplying; manual divergence conflicts. Partial failures expose safe operation tokens and `publication: applied|unconfirmed`; never infer confirmation from target presence. `network_check({maintenance:{operationId}})` reads progress plus its current CAS revision. Omit operationId for paginated progress (`limit`, `cursor`); readers never recover pending journals. These records contain digests/revisions/phase IDs rather than prompt/source bodies.

`network_check` defaults to last-known metadata and recorded-review counts without source reads. `mode: full` checks fresh snapshots, capped feature-source state and safe unmapped Git changes. It returns explicit omitted counts, diagnostics, partial coverage and unresolved states. A result too large for the complete response is rejected; narrow project/visit limits or raise budget. It does no semantic review or recovery. A legacy `sessionId` is accepted for compatibility but does not turn connected checks into a reliable host-turn proof.

Schema-2 initialization is explicit `kind: memory`, `initialize: {id,name}`, purpose mode init, an unchanged empty network revision, null feature expectations and inspected real local sources. It requires a real first feature; a knowledge-only conversation cannot create a placeholder marker. It adds neither connections nor automatic learning. Bootstrap remains active-project-only, preserving all knowledge bytes and the full network revision while mapping only actual features and local code slices. Foreign-only feature sources do not become local inventory paths.

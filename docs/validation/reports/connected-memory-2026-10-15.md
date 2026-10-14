# Connected project memory: implementation and verification

The connected-memory specification and its efficiency addendum are implemented. Schema 2 adds persistent project identities, explicit local connections with independent source-read/memory-write rights, readable knowledge YAML, staged context/impact, source-bound semantic reviews and resumable per-target maintenance. Schema 1 retains its existing contracts. Installing a plugin neither upgrades project memory nor registers another checkout or enables learning.

## Independent review and corrections

One fresh-context gpt-6-astra reviewer examined `3a8f03e..b5da2d9` read-only against the plan/spec, ledger rulings and all five Review Focus cases. The initial verdict was not ready to merge: no Critical, four Important findings, and one reported Minor concerning measurement truth. The executor regraded the last issue Important because the I/O description could mislead the requested efficiency assessment. All five were addressed in one correction pass, with reproducing RED→GREEN regressions. There was no second review; tests verify the corrections. During final measurement the author also found an Important quadratic index-copy path (R6) and corrected it with a copy-volume regression in the same correction pass.

| Finding | Corrected behavior | Regression evidence |
| --- | --- | --- |
| R1: target-local source rights bypass | Mandatory target validation, verification and recovery retain the active connection policy. Denied sources produce permission_denied before reading their bytes. Review receipts cannot recover a concurrently appearing network journal. | Separate readSources:false/writeMemory:true publication/recovery tests; concurrent review-only journal regression, permitted-source count 1 instead of 2. |
| R2: hidden extra source checks | Freshness metadata is reserved before selecting work; the selected page remains fixed after actual warnings arrive. | Requested source-feature IDs equal final returned IDs on all pages, including MCP wrapper and Unicode fragments. |
| R3: false budget failures | The shared paginator measures the exact connected projection, without iterative outer-overhead guesses. | Budget sweep 3,000–6,000 and complete continuation; Unicode and legacy query suites. |
| R4: public restart recovery gaps | New CLI processes offer a read-only recovery preview bound to pending journal/identity/current bytes/sources. A new reviewed receipt resumes upgrade. Identical init intent can resume its matching empty-network transaction before or after marker publication. | Real SIGKILL workers at both stages, followed by new CLI/MCP processes; changed intents and stale upgrade receipts refused without overwriting. |
| R5: excessive I/O coverage description | Document read/byte counters explicitly cover network YAML only; unmeasured auxiliary document bytes remain null. | Report coverage/null-cost assertions. |
| R6: quadratic shared index copying (author finding) | Each affected token/path posting and incoming edge list is privately copied at most once per refresh; incoming removal is grouped by target. Earlier indexes remain immutable. | A 400-feature star reproduced 399,000 copied entries before the fix. Cold/bulk runs now meet a linear copy bound and preserve the earlier index. |

Corrections are in `d7f08d9`, `9b97894` and `76beb4d`. No deferred minor findings remain. Natural-language deduplication across independently selected statement IDs remains the active agent's responsibility; deterministic no-op handling does not establish model compliance.

## Verified scope

At source `76beb4d`, `npm test` completed with 658 passing tests and one Windows-specific skip across 68 files (142.29 seconds). Strict TypeScript checking, plugin build, package verification and `git diff --check` passed. Storage/process tests cover actual concurrent writers and SIGKILL recovery; the full suite includes the independent scripted acceptance scenario. These checks establish local automated behavior, not native host/model acceptance. The merged result is checked separately before push.

The matrix measures generated local repositories at 1/4/16 projects × 100/1,000 features per project × degree 2/12, five samples for each of six phases (360 actual samples). Every case passed the structural work assertions: warm hints had zero YAML parsing, source reads, index replacements and publications; one document edit replaced exactly one entity; grouped discussion published exactly one file in one completed transaction, with fresh validation of the owner project's source references; semantic review stayed open; identical repeated discussion published nothing. All sample statistics were recomputed from the retained observations.

The complete final matrix is bound to source `76beb4d` and exact executed bundle SHA-256 `e78bb2d93e778003f8bafa1d09092c9530452df98ae43c70146732ecc8b44c47`; its source input hashes accompany every retained raw report. The previous partial run was stopped and is not used as final evidence. Agent tokens, semantic analysis/model latency and auxiliary document bytes remain unmeasured/null. First load means fresh option-bound parsing/index caches in a running process, with uncontrolled OS page cache. It is not cold disk, host/plugin startup or MCP transport latency; p95 from five samples is a limited local observation. No savings, universal latency, cross-host or actual agent success claim follows.

Local median observations (all five samples and p95 values are retained in the raw report):

| Projects | Features/project | Degree | First load median ms | Warm hint median ms | Fresh impact median ms | Grouped maintenance median ms |
| ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| 1 | 100 | 2 | 41.7 | 1.4 | 77.6 | 491.9 |
| 1 | 100 | 12 | 62.4 | 1.4 | 103.5 | 584.2 |
| 1 | 1000 | 2 | 356.8 | 3.3 | 558.2 | 3954.4 |
| 1 | 1000 | 12 | 550.1 | 3.5 | 605.1 | 4560.3 |
| 4 | 100 | 2 | 164.5 | 3.2 | 282.0 | 484.9 |
| 4 | 100 | 12 | 249.4 | 3.5 | 301.9 | 549.9 |
| 4 | 1000 | 2 | 1532.3 | 8.4 | 2025.8 | 4085.0 |
| 4 | 1000 | 12 | 2402.9 | 9.0 | 2167.4 | 4753.2 |
| 16 | 100 | 2 | 663.7 | 10.7 | 863.1 | 498.6 |
| 16 | 100 | 12 | 1001.7 | 11.8 | 887.9 | 568.3 |
| 16 | 1000 | 2 | 6450.5 | 27.1 | 6540.7 | 4201.5 |
| 16 | 1000 | 12 | 10136.9 | 32.3 | 6702.1 | 4975.2 |

Warm lookup remains cheap in these fixtures; fresh connected checks and publication validation remain materially more expensive. The 16-project/1,000-feature cases took about 6.5–6.7 seconds for fresh impact; grouped maintenance of the 1,000-feature owner took about 4–5 seconds. This is a reason to retain staged reads, batching and no-op suppression, not to claim cost-free continuous learning.

The final raw JSON and assertion report are retained locally under ignored `.feature-network/validation/connected-memory-2026-10-15/`; reproduce the matrix with `npm run bench:connected` on Node 24. The measured source revision is `76beb4d034f5d94fcb1b3cedc8923b3fe96ed20e` (tree `0ac34037308295248d44bc4e8ca4b00405d373ae`), with a clean tracked tree during execution. Subsequent completion-document changes do not alter the measured runtime sources.

The independent scripted scenario uses an external oracle outside A/B/C candidate roots. It checks a provider contract, direct/indirect effects, privacy and denial presentation; the initial version and provider-only patch fail, while the scripted complete patch passes. Separate checks cover discussion-only requirements, no-code-change source review, incoming edges after warm hints, interrupted maintenance, unavailable consumers and preserved manual points. Scripted integration is not an actual coding-agent trial.

## Open external acceptance

Native Codex Desktop, Copilot CLI and Copilot App tests remain separate and pending for connected learning. No real host/project configuration was installed or changed, and no actual model task or telemetry run was launched. Cooperative filesystem locks do not claim hostile same-user OS atomicity. No release tag/artifact publication was performed. See the connected protocol and host matrix for the explicit acceptance requirements.

## Execution decisions carried from the ledger

Every execution ruling is retained below in its original order, including its cost if wrong. No deferred minor findings remain.

- Ruling: Native worktree is not writable in this sandbox; archived the unused native attachment and created a project-local ignored Git worktree — preserves isolation without repeated elevated file edits — cost if wrong: app attachment does not manage this fallback checkout; preserve it until integrated.

- Ruling: Offline npm ci lacks cached zod archive; copied the existing exact-lockfile node_modules and verified npm ls --depth=0 — no dependency versions changed, no downloads — cost if wrong: prior package contents are not a fresh npm-integrity install, so package checkout tests must still verify distribution.

- Task 1: Ruling: self/supersedes cycle validation across project-qualified statements requires the owner's marker UUID — validate these in Task 2 snapshot validation, not in a context-free document parser — cost if wrong: standalone parsing alone does not prove relational validity, consistent with existing parser/storage separation.

- Task 2: Ruling: recovery publishes the journal's end state before testing the caller's old full revision — the original no-op caller then gets conflict and must reread — preserves CAS rather than accepting a stale revision — cost if wrong: one retry after recovery, no lost data.

- Task 3: Ruling: a dynamic storage-validator import caused esbuild to defer shared Zod initialization before MCP SDK schemas (ZodLazy constructor error) — extracted source IO into storage/sources.ts and used a static acyclic validator dependency — actual SDK process now lists five tools — cost if wrong: shared legacy source validation may regress; final MCP/storage suites must stay green.

- Task 4: Ruling: cap registry at 128 entries in addition to 64 KiB — bounds eager local identity checks while each query still caps selected projects at 32 — cost if wrong: a larger future workspace needs an explicit raised registry policy; no silent omission.

- Task 6: Ruling: new schema-2 impact without direct origins is invalid rather than treating every known feature as an origin — avoids hiding relationship paths and needless graph-wide work; schema-1 calls retain their existing behavior — cost if wrong: an empty impact call needs a resolved feature/query before retry.

- Task 8: Ruling: explicit optional deletion paths extend prepareMemoryDelta's signature — absent proposals are not deletions and active user requirements cannot be deleted automatically — cost if wrong: callers must explicitly retract/supersede such requirements before removing their document.

- Task 8: Ruling: adding an idea to an existing knowledge topic only demands semantic source evidence for changed/new statements — unchanged historical observations are retained, full fresh end-state validation still runs and no review baseline is renewed — cost if wrong: callers must treat historical source claims as last_known until separately checked.

- Task 9: Ruling: expose a writer-only document recovery helper and return null for null deltas — interrupted schema-2 journals need authorized completion before intended-state comparison; no-op creates no progress record — cost if wrong: callers must reread after recovery conflicts and handle nullable receipts.

- Task 10: Ruling: bootstrap consumes an ephemeral schema-1 local-feature view of a full schema-2 snapshot — preserves existing inventory/checkpoint machinery and original full revision without persisting converted documents — cost if wrong: foreign-only references cannot map local inventory slices and must remain outside that local scope.

- Task 10: Ruling: connected mutations require at least 900 serialized-response bytes and full checks reject unfit complete projections — safe receipts and partial-failure tokens must fit before mutation; no silent data truncation — cost if wrong: callers need a larger budget or narrower explicit project/visit limits.

- Task 11: Ruling: schema-2 Codex uses a separate bounded technical turn record for at most 100 current Git change paths rather than hashing all clean graph references — preserves actual host source proof and avoids a source-wide prompt scan — cost if wrong: larger or unavailable scopes do not force continuation and rely on the explicit active skill workflow.

- Task 11: Ruling: Writing-Skills pressure/model runs are not performed — the approved plan and project instructions forbid actual agent runs without a separately authorized synthetic installation; contract/process tests cover mechanics only — cost if wrong: revised guidance's natural model acceptance remains pending, explicitly retained in the host matrix.

- Task 12: Ruling: first-load samples partition option-bound caches in one process instead of creating new processes/copying each fixture per sample — measures actual fresh parsing/index work while avoiding unnecessary fixture/process expense — cost if wrong: OS page cache and process startup remain uncontrolled/excluded; no cold-disk or host-latency claim is allowed.

- Task 12: Ruling: the task-done gate is the single final full-suite run after the targeted-tested code commit — the plan also forbids redundant expensive passing checks without changes — cost if wrong: any full-suite failure requires an additional fix commit before task completion; no merge/release occurs first.

- Final: Ruling: native host/model behavior remains pending — no concrete synthetic installation or actual agent-run authorization exists — cost if wrong: scripted evidence may not predict real host/model behavior.

- Final: Ruling: the reviewer deferred final matrix results while the unchanged benchmark was running — executor keeps the full matrix gate and will repeat after relevant fixes — cost if wrong: old bundle measurements cannot be claimed as final patched-code evidence.

- Final: Ruling: hostile operating-system mutation stays outside the cooperative-lock guarantee — ordinary revocation and source-right checks are required; no hostile-OS atomicity claim — cost if wrong: malicious same-user filesystem races remain outside these protections.

- Final: Ruling: no real installation/release/deployment occurs — scope excludes host installation, tags/releases and Docker/Deploy Cockpit — cost if wrong: this implementation still needs separate real-host activation and acceptance.

- Final: Ruling: semantic deduplication across independently chosen statement IDs stays with the active agent — the deterministic Core handles stable IDs/no-op normalization, not language understanding — cost if wrong: an agent choosing inconsistent IDs can retain redundant statements.

- Final: Ruling: restarted upgrade uses a new read-only recovery preview and receipt — the old opaque plan cannot survive a CLI restart, and journal identity/current partial bytes/intended target must be explicitly rebound — cost if wrong: recovery needs one additional reviewed preview instead of blindly accepting a stale pre-crash receipt. Identical initialization intent resumes directly and never confirms sources.

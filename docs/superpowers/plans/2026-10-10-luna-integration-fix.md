# Luna integration correction implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development. Steps use checkbox syntax.

**Goal:** Make installed FeatureNetwork support a natural coding request without revoking it, return meaningful impact paths, and verify real memory maintenance with Luna.
**Architecture:** Correct host/skill/tool instructions while preserving existing command policies, storage/CAS and query semantics. Validate in three fresh isolated native CLI fixtures with normal approvals and Node 24.
**Tech Stack:** TypeScript, Vitest, Node 24, native Codex app-server.
**Spec:** docs/superpowers/specs/2026-10-09-featurenetwork-v1-design.md and docs/validation/reports/codex-luna-full-plugin-2026-10-10.md; user authorized these diagnosed corrections and the natural-task retest.

## Global Constraints
- Preserve read-only commands, explicit-only init/sync, original developer authorization, no extra product edits during memory-only Stop continuation, current-turn gating, recursion bounds and excluded plugin sources.
- Node 24; no new dependencies, no query behavior changes or broadened maintenance authorization.
- Preserve previous failing evidence, baseline sources, partial coverage and manual points. No global installation, auth extraction, public tag or release upload. Merge/push main are already authorized.
- Full tests/typecheck/build/package checks and independent review before merge.

## Review Focus
- Normal coding request remains authorized through prompt-hook context; maintenance limits attach to extra memory work only.
- Explicit read commands stay read-only and Stop never starts old-backlog work.
- Impact starts from directly changed feature(s), not all candidate dependents; use IDs after context resolution, explicit both/incoming direction and pagination.
- Mutable MCP actions run only with normally reviewed bounded local permissions; no trust/sandbox bypass. Test shell effective Node version is checked.
- Natural-task success requires retained implementation and correct source-grounded YAML/reviews; successful tool calls or unchanged hashes alone do not prove completion.

### Task 1: Correct development and impact instructions
**Files:** src/adapters/codex.ts; plugin/skills/feature-network/SKILL.md; plugin/skills/feature-network-impact/SKILL.md; src/mcp/server.ts; focused tests/adapters, tests/commands, tests/mcp as appropriate.
**Interfaces:** Existing handleCodexEvent output and MCP tools/list metadata; no signature/schema/query/storage changes.
- [x] Add regression coverage and observe expected RED: real prompt hook preserves ordinary coding authorization; main and explicit impact instructions resolve direct roots via network_context and query root IDs, explicit direction, not all dependents. Metadata communicates origins and zero-length seed paths. Instruction-content checks are contract checks, not model acceptance; include real fixture impact demonstrating positive path and all-root empty-path contrast where existing tests do not cover it.
- [x] Implement minimal wording changes. Prompt hook explicitly continues the user's coding/testing task; its maintenance rule applies only to additional memory updates and does not withdraw product authorization. Main skill treats plain coding requests plus actual changes as ordinary authorized development even when classifier mode is unspecified; no automatic global init/backlog. Impact example: ids:[user-profile], direction:both, depth:2; dependent children point to parents so incoming finds dependents. Keep focused read command policy.
- [x] Run focused tests and full npm test, typecheck, build, verify:package; log RED/GREEN/full outputs under ignored releases/luna-fix-validation. Commit only own paths; report changes, tests, limitations. No subagents, global configs, model runs or push.

### Task 2: Natural Luna verification and integration
**Owner:** Controller operational validation; not an additional product implementation task.
**Files:** New diagnostic harness/evidence under ignored releases; redacted docs/validation report and host-matrix; AGENTS status only if needed.
- [x] Verify corrected built files and normally approve exact hooks in fresh isolated profiles; original natural German prompt unchanged. Preserve original source/test/YAML hashes and a manual assertion.
- [x] Fix diagnostic approval policy to on-request with normally scoped automatic review and fail closed for unauthorized external requests. Verify effective Node 24 in both host and actual agent shell; record permissions/preflight and successful actual MCP write rather than assume configuration is enough.
- [x] Run three fresh Luna natural tasks. Independently check locale SQLite/migration/backup/restore, retained original tests, graph paths, manual points, source grounded YAML and final open review decisions. Preserve failed trials and exact model/provider/artifact bindings; do not claim randomized comparison or host UI acceptance.
- [x] If a bounded further correction is needed, reproduce, update failing tests before code, review and repeat affected acceptance on fresh fixtures. Record limitations truthfully.
- [x] Independent whole-branch review; merge/push main, preserve previous release and prepare verified updated local package. Public release/tag needs a separate request.

## Execution evidence

Task1 commits `7b6b929` and bounded request-guidance follow-up `eca6f18` both received independent spec/quality approval. Follow-up schema edits add descriptions only. Final local verification:509passed/1Windows-only skip, typecheck/build/verify:package pass. Three final native Luna sessions used MCP and updated all3features with zero open decisions, preserved manual/partial memory; dependency paths2/3, strict coding checks4/5,4/5,5/5. Full coding acceptance remains1/3. Initial and intermediate failures were preserved. Supplemental accepted-version roundtrip and SQL rollback checks do not replace the frozen strict oracle. See final diagnostic report for exact bindings and limitations.

Integration completion requires final branch review, merge/push and independently checked fresh-checkout package; these completion actions are recorded in Git/local release receipts, not inferred from model turn completion.

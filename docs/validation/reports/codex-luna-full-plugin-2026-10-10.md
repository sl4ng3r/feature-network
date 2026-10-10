# Luna with the installed plugin — 2026-10-10

[Machine-readable evidence](codex-luna-full-plugin-2026-10-10.json). This is a three-session diagnostic of native Codex CLI app-server integration, not Desktop UI acceptance, Copilot acceptance, or a comparative benchmark.

## Setup and task

Three fresh Git checkouts of the synthetic pre-locale profile demo received identical source, baseline tests and YAML memory. Each isolated Codex profile contained all 21 files of the released native plugin, checked against the release manifest for source revision `705e729`. Archive SHA-256: `84fa6aa87493481f8d38c4dc69fed9bc2b998ef5fbd50883e059d94890fd8c1f`.

Native CLI `0.162.0-alpha.17.2` discovered seven enabled skills. The three exact plugin hook sources were reviewed and approved through normal `config/batchWrite` in each isolated profile; subsequent discovery reported them trusted. No hook-trust or sandbox bypass flag was used. Existing user plugin configuration was not modified. The agent read the actual main skill in all three sessions. Recorded lifecycle events show SessionStart, UserPromptSubmit and Stop executed in each session.

The normal German coding request asked for persistent `locale`, explicit `de-DE`, default `en-US` for new/old profiles, consistent existing profile operations, database reopen, preserved data/atomic validation and transient `sessionHint`. It requested test-first work but did not mention FeatureNetwork, MCP, any skill, backup or restore. The full prompt and hash are in the JSON record. Observed provider/model: `openai` / `gpt-6-luna`, low effort, fallback disabled. A separately versioned provider revision and random seed were unavailable.

## Observed results

| Trial | Natural MCP calls | Context/impact used | Returned impact paths | Locale task | Independent Node 24 checks |
| --- | ---: | --- | ---: | --- | --- |
| 1 | 3 | Yes | 0 | Refused before edits | 1/5 passed |
| 2 | 3 | Yes | 0 | Began tests/source edits, then reverted them | 1/5 passed |
| 3 | 7 | Yes | 0 | Began regression tests, then reverted them | 1/5 passed |

Every final source, YAML and original test file matched its initial hash. Git was clean in every resulting checkout. Existing baseline tests passed, but all three results failed the four locale-dependent checks. The independent evaluator checked real SQLite reopen/defaults, schema-1 migration/idempotency, JSON backup/restore, transaction rollback/invalid input and preservation of a future-schema sentinel. The unchanged negative control passed only the sentinel check; the known-good locale demo passed all five. Neither completed turns nor passing original baselines count as successful feature implementation.

All three agents explicitly attributed refusal or rollback to an apparent product-edit restriction. The UserPromptSubmit hook supplied:

> Source edits authorize only scoped memory maintenance; no additional product edits.

This was intended to limit extra work performed for memory maintenance. The observed agents treated it as overriding the original development request. Three repetitions establish a reproducible instruction-interpretation problem in this fixture; they do not identify every internal cause of earlier Luna decisions. Correcting the wording is a proposed follow-up, not an implemented or verified fix.

The server-only study's natural MCP selection gap was not observed here: all three sessions used MCP without an explicit tool request. However, each agent impact query selected all three features as origins, through broad text or an explicit three-ID list. Returned `path` arrays were consequently empty. Trial 2 read full relation records, and agents identified backup/restore as relevant, but none demonstrated targeted dependency traversal. An independent post-run SDK control using only `ids:["user-profile"]`, `direction:"incoming"`, depth 2 returned evidenced backup/restore paths. Those control calls are evaluator actions, not agent calls.

No successful memory update occurred. Trial 3 attempted a `no_semantic_change` update after reverting its tests. The host rejected it with `MCP tool call requires approval, but approval policy is never`; the core never received it. Four source reviews remained open. This is an additional harness permission limitation, not evidence of a storage defect or meaningful automatic-maintenance failure after completed development. Stop hooks completed without blocking because no source edits remained; forced upkeep after retained edits was not exercised.

## Limits and next verification

These are three identical-fixture fresh sessions, with trials 2 and 3 run concurrently. There is no code-only/YAML-only comparison, general success-rate estimate, cost-saving claim or proof that installation caused the change in MCP use. Raw events/evaluators stayed outside agent checkouts and were preserved under ignored `releases/luna-full-2026-10-10/`; public JSON binds hashes and redacts local paths. The evaluator was built during the first diagnostic and validated against negative/positive controls; this is not a preregistered study.

The app-server parent, actual hooks/MCP and independent checks used Node 24. Agent login shells selected system Node 25.9. Future trials must verify the agent shell runtime too and permit reviewed local MCP writes through normal approvals; `approvalPolicy:never` prevents that portion of acceptance.

Next verification should distinguish authorized product work from additional memory-only work in hook/skill instructions, teach single-origin impact selection, and repeat the same natural task on fresh fixtures with effective Node 24 and normal write approvals. Success requires retained functional implementation, relevant dependency paths, source-grounded memory updates, preserved manual statements and a final check. No proposed product changes were applied in this diagnostic.

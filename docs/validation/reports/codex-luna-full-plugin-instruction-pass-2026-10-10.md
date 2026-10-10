# First instruction correction — natural Luna diagnostic, 2026-10-10

[Machine-readable evidence](codex-luna-full-plugin-instruction-pass-2026-10-10.json). This intermediate diagnostic preserves the failures that triggered the subsequent request-guidance correction. It does not establish complete acceptance.

## Setup

Source/build revision `7b6b929f3d86ef43c6bf5a3707ed361781713eb5`; native Codex CLI `0.162.0-alpha.17.2`, actual `openai` / `gpt-6-luna`, low effort, fallback disabled. Three fresh synthetic Git projects each received the same 21-file native plugin, seven discovered skills and three exact normally trusted lifecycle hooks. The original natural coding prompt was unchanged and did not mention MCP, FeatureNetwork, backup or restore. A manually supplied profile key point was added to test preservation. All three isolated sessions were started in parallel; these are repeated diagnostic fixtures, not an A/B study.

Normal `on-request` approvals with `auto_review` were used, and only the bound project's `network_update` tool was preapproved. No trust or sandbox bypass was used. Actual MCP responses, including core `invalid_decision` errors and successful updates, establish that the earlier host permission block was removed. The native shell preflight and agent command outputs both show Node 24.19.0 with login shells disabled. Existing user configuration was untouched; temporary references to existing authentication were removed after execution without reading/copying credentials. Normal per-tool approval configuration is documented in [OpenAI's plugin configuration guide](https://developers.openai.com/plugins/build/plugins).

## Results

| Trial | Retained coding edits | Agent dependency paths | Successful memory calls | Final open decisions | Frozen strict oracle |
| --- | --- | ---: | ---: | ---: | --- |
| 1 | Yes | 2 | 1, test review only | 4 | 4/5 |
| 2 | Yes | 0, all three origins selected | 2, full scoped review | 0 | 4/5 |
| 3 | Yes | 2 | 0 | 5 | 4/5 |

The original coding restriction no longer caused refusal/rollback. Every run retained profile, migration, backup and restore changes and passed its own tests plus the evaluator's externally frozen original baseline. All manual key points and `coverage: partial` survived. Trial 2 retained the original test byte for byte and added another file; trials 1 and 3 extended/edited the original test file, so byte preservation is not claimed for them.

Trials 1/3 queried one direct `user-profile` origin and returned two evidenced dependency paths. Trial 2 still selected all three features, yielding empty seed paths. Evaluator SDK reads independently found both paths in all three projects; those are not model actions.

Trial 1 supplied only an unmapped test in `observations` while confirming mapped references and using `updated`. The explicit array replaces the implicit verified-reference observations, and unmapped observations require `no_semantic_change`; the guarded request was correctly rejected. Its subsequent test-only review succeeded but did not update YAML. Trial 3 included an unmapped test among verified baselines, retyped invalid hash strings and sent an empty overriding observations array. Its requests were rejected. Trial 2 initially supplied insufficient verified references but repaired its inputs during the single bounded Stop continuation: it updated all three feature records with locale facts/checks, confirmed four mapped source hashes, and separately closed the unmapped test with reasoned `no_semantic_change`. Its final independent full check reported zero open decisions. Stop continuation in trials 1/3 reported unresolved work honestly and terminated within the recursion guard.

## Strict oracle and diagnostic limits

All three results pass four of the five previously frozen strict checks. The JSON backup test fails because the candidate retains `schemaVersion: 1` while the demo's required locale contract uses `schemaVersion: 2`; `formatVersion` correctly stays 1. The oracle and its expected values were not changed. Consequently none of these trials passes the complete strict task acceptance.

Two explicitly supplementary post-run tests use each candidate's actual accepted backup version to distinguish real locale roundtrip and SQL rollback from a version-validation short circuit. Both pass in all three candidates: locale survives JSON restore/database reopen, and an accepted-version duplicate triggers a SQL constraint failure after deletion with prior rows restored. These diagnostics were added after observing the strict failures, do not replace the frozen oracle, and do not establish the required backup version. The frozen duplicate test alone would not prove a transaction was exercised when the candidate rejects schema version 2 before opening that transaction.

No Desktop UI, Copilot, complete coverage, randomized success-rate or token-saving claim follows. Raw events, source/test/YAML snapshots, package hashes and external evaluators are preserved under ignored `releases/luna-instruction-pass-2026-10-10/`. The model initially attempted incorrect skill paths and then recovered to the discovered installed skill; these observed command errors remain in evidence. A follow-up instruction change must explain the two scoped writes, overriding observations, exact hashes and request repair without weakening any guard.

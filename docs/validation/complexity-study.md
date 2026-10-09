# Synthetic coding complexity study (preregistered pilot)

## Question and limits

At what tested fixture size does a coding agent stop completing a profile-contract change without FeatureNetwork, and does FeatureNetwork still help at that size? A result is specific to this generated workload, Codex CLI/model/version, prompt and budget. Feature count alone is not a universal measure of application complexity. The generator is deliberately synthetic; external validity must be tested on independently chosen real applications before any sales claim.

The previous four-file read-only pilot found correct dependency recall in both arms and no code-read or token saving. This study instead requires source edits and a held-out behavior oracle. No prior pilot run is counted as a study trial.

## Fixed task and fixture

`bench/complexity/generate.mjs` creates a Node 24 SQLite app with one persisted profile, published projection chains, and independent chains with varied but similar code. A seeded shuffle places profile descendants among distractors. The profile field must survive **every** descendant and an existing version-1 database migration; unrelated chains carry private locale/session data that must not leak into published output. `sessionHint` stays transient. The agent sees ordinary base tests, but the locale oracle at `bench/complexity/oracle.mjs` is kept outside each agent checkout. A separate known-good implementation proves that the held-out oracle can pass at every planned level.

The initial screening levels are fixed before any coding-agent run:

| Level | Projection files | Profile descendants | Planned seed | Maximum relevant depth |
| --- | ---: | ---: | ---: | ---: |
| Small | 12 | 3 | 11 | 3 |
| Medium | 48 | 8 | 22 | 4 |
| Large | 192 | 16 | 33 | 5 |

These dimensions jointly scale code size, number of candidate files, required edits and graph depth; the first pilot cannot isolate their individual effects. The code-only arm has no `network-spec/`. The FeatureNetwork arm has the exact same source and tests plus the generated network and a project-bound MCP server. Both use the same prompt, Codex CLI, model, reasoning setting, Node 24 runtime and fresh independent Git checkout. Condition order alternates by level. Native plugin hooks and skills are not in this intervention, so the result tests explicit MCP assistance, not full native plugin behavior. This differs deliberately from the existing `benchmark-protocol.md` task comparison, which gives both arms network files to isolate the MCP interface. This study compares project memory plus interface against code-only work. The task prompt asks the agent to trace transitive dependencies without naming the relevant descendants.

Task prompt:

> Implement a persisted `locale` field for user profiles. An explicit locale such as `de-DE` must survive a database reopen and every published projection derived from a saved profile. Omitted locale and existing version-1 rows must become `en-US`. Keep `sessionHint` transient and leave independent record projections unchanged. Trace transitive dependencies through at least eight steps. Use a project dependency/impact tool before editing if one is available, following any result continuation; otherwise inspect the code. Update or add tests, run the available tests, and summarize the changes. Do not read files outside this synthetic project.

The oracle checks actual SQLite reopen, default, migration, every related and unrelated projection, and transient-field exclusion. A run passes only if all held-out checks pass and the ordinary base tests pass. Agent self-report and green self-written tests alone are insufficient. Other useful measurements are tool use, wrong or unnecessary edits, elapsed task time and host-reported input, cached-input and output tokens. Read-file counts from CLI command logs are recorded only as an observed subset, never as exhaustive reads.

## Screening and claim rule

Run one paired fresh session per level to find a candidate crossover. This screening can reveal an example failure or success, but cannot estimate a failure probability or establish a threshold. If baseline fails and FeatureNetwork passes at a level, repeat that level and the adjacent smaller level with at least five *new* paired seeds each, alternating condition order. A future publication claim requires a separate held-out task/application, at least ten fresh paired seeds around the claimed boundary, a reported success proportion with uncertainty intervals, all failures, model/host bindings, and the setup/initialization/maintenance costs. If no crossover appears within the tested levels, report that fact and do not extrapolate one. Tool startup/schema overhead and network creation cost must not disappear from any token or cost claim; unknown costs remain unknown.

The prepared network is an intervention with additional project knowledge. This comparison cannot by itself separate the benefit of feature documentation from the benefit of the MCP query interface. A later third arm with readable YAML but no MCP would answer that narrower question. No real user or employer code is used.

## Subsequent study families

The [fanout protocol](fanout-study.md) and [same-seed Luna/Sol report](reports/complexity-luna-followup-2026-10-09.md) test more published outputs and weaker requested models. The [cross-package protocol](monorepo-study.md), [screening](reports/complexity-monorepo-2026-10-09.md) and [five-pair replication](reports/complexity-monorepo-replication-2026-10-10.md) add seven npm workspaces and a five-edge dependency path within one Git repository. The [MCP discovery diagnostic](reports/mcp-discovery-2026-10-09.md) documents configured tools that Luna sometimes did not invoke. These later results retain the same synthetic-workload limits; they do not establish a general complexity threshold.

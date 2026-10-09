# Codex CLI synthetic demo diagnostic — 2026-10-09

This is a real host-provided MCP read diagnostic, **not complete v1 or Codex Desktop acceptance**. The [record](codex-cli-2026-10-09-smoke.json) contains source/version bindings, executed calls, usage and hashes of ignored local evidence. Private paths/configuration/prompts and raw logs are not published.

The native Codex CLI version check accompanying this diagnostic reported `0.162.0-alpha.17.2`; the separately inventoried Desktop bundle reported `26.1002.52244`. Plugin `0.1.0` from source `b5087e24fd098cd3f938e0eae97edcb4c32d391c` was installed via the native local marketplace route, with all 23 files matching the reviewed package. It remains globally disabled and enabled only for the authorized synthetic demo. A project-specific persisted trust entry was necessary: a session override was ignored. No hook trust bypass or global runtime/telemetry change was used.

The CLI prompt diagnostic supplied the main implicit skill. The six explicit-only command skills were not injected by the earlier CLI prompt, so that attempt stopped without tool calls. Native menu discovery and actual explicit invocation remain unverified.

| Actual successful call | Observed result |
| --- | --- |
| `network_context({limit:10})` | Three stored features: user-profile, backup, restore; no omitted items |
| `network_impact({ids:["user-profile"],direction:"both",depth:2,detail:"full"})` | Stored incoming backup read and restore write relationships, plus restore's backup read obligation |
| `network_check({mode:"full"})` | Valid integrity, fresh technical check; four open source review decisions |

Coverage was partial, all three feature freshness states were unknown and reviews remained open. The agent displayed these limits instead of claiming current semantic correctness. Four source files and four network YAML files were byte-identical to the original pre-locale demo afterward. Temporary cooperative snapshot locks left only `.feature-network/.gitignore`; no baseline, cache, session or checkpoint file remained.

The successful read session reported 107,122 input tokens, 101,504 cached input tokens, 1,111 output tokens and 304 reasoning output tokens. These are the host's reported categories; they are not a cost estimate or measured savings. The effective provider/model could not be established from returned session metadata and remains null. The configured model hint is insufficient evidence.

Direct Codex Desktop computer use was denied and no alternate GUI automation was attempted. Desktop menus, hook approval/lifecycle, GUI Node 24 PATH, actual bootstrap/sync, SQLite feature tasks, three-OS CI execution and both Copilot surfaces remain pending. No comparison against a non-plugin condition was performed.

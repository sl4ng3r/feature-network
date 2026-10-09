# Lifecycle adapters and reviewed project setup

Requires Node.js 24 LTS. `npm run build` creates offline, dependency-bundled `plugin/dist/cli.mjs` and `plugin/dist/hook.mjs`. Runtime never downloads packages or calls a model API. The CLI retains its five MCP tools and explicit immutable project binding.

```sh
node plugin/dist/cli.mjs mcp --project-root /path/to/project
node plugin/dist/cli.mjs hook --host codex < event.json
node plugin/dist/cli.mjs hook --host copilot --event sessionStart < event.json
node plugin/dist/cli.mjs setup --host codex --project-root /path/to/project --dry-run
node plugin/dist/cli.mjs setup --host copilot --project-root /path/to/project --dry-run
```

The hook-specific bundle accepts the same options without the `hook` word. Copilot events are exactly `sessionStart`, `userPromptSubmitted`, `agentStop`; they are supplied by configuration because the documented camelCase stdin has no event discriminator. Unknown/invalid payloads do nothing. Input is limited to 256 KiB, the process deadline is six seconds, and host definitions allow eight seconds. Errors expose fixed messages only. No raw prompts, source text, transcripts or configuration values are logged or persisted by hooks.

## State and authorization

Hooks discover the nearest valid `network-spec/_meta.yaml` inside the nearest Git checkout from payload `cwd`. An invalid nearest marker blocks discovery; a missing marker produces an initialization hint only. Hooks never initialize a network or analyze code. The actual bundle installation root, derived from the executable location, is excluded from all reference/freshness checks; a payload cannot override it.

Codex SessionStart emits a compact `last_known` summary. UserPromptSubmit classifies the explicit command. Status/show/impact/check perform no runtime writes, journal recovery or continuation. Other prompts may capture session bookkeeping: Core turn UUID, Git HEAD/branch, pre-existing paths and hashes. This alone grants no feature write or product-edit permission. A Stop requires the same host session/turn, a matching Core UUID, actual new source changes in that turn, and still-open review decisions for those paths. Matching technical hashes without reasoned decisions are insufficient. Old backlog is excluded. Branch switches or unavailable identity/evidence suppress continuation; committed current-turn changes remain detectable.

Explicit init can request one bounded pending bootstrap continuation for a captured turn; it cannot authorize product/database edits. If the marker did not exist at prompt time, there is no captured turn and therefore no forced first-init continuation. The explicit skill remains responsible for carrying out the request. No hook starts bootstrap on its own.

The host `stop_hook_active: false` guard and an atomic local receipt CAS jointly permit at most one Codex continuation, including concurrent hook processes. Concurrent prompt capture may conservatively lose continuation if its two stored identities no longer match; it cannot attach the wrong baseline. Runtime bookkeeping passes trusted `allowRecovery: false`, checked under the storage lock even if a journal appeared while waiting. Normal authorized Core writes retain their existing recovery behavior.

## Separate host evidence

| Surface | Implemented contract | Evidence still required |
| --- | --- | --- |
| Codex local Mac app | SessionStart/UserPromptSubmit/Stop shapes, Core/host identity binding and single continuation; portable plugin hooks use documented `PLUGIN_ROOT` | Installed app, trust review, native menu and real model behavior (Task 12) |
| Copilot CLI | SessionStart context and explicit Skill/MCP workflow; command prompt output correctly ignored | Actual CLI installation; documented stdin lacks a reliable turn ID, so agentStop returns no block decision |
| Copilot App | No inferred hook capability | Separate live investigation and acceptance (Task 12); CLI/cloud/VS Code documentation does not establish App support |

`plugin/com.github.copilot/hooks/hooks.json` is intentionally non-active (`hooks: {}`). Current primary documentation establishes plugin-root expansion for MCP but not the hook command context. Copilot lifecycle hooks require the concrete project setup proposal below to be reviewed and applied. Installing skills/MCP and enabling project lifecycle hooks are separate operations. This fallback is not full v1 live acceptance.

## Setup boundaries

Dry-run reads only these fixed project configuration targets:

- Codex: `.codex/hooks.json`, `.codex/config.toml`.
- Copilot: `.github/hooks/feature-network.json`, `.mcp.json`.

The preview gives exact absolute target paths, SHA-256 fingerprints of the original raw contents (`null` for absent), and **additions only**. It never prints unrelated configuration values. Runtime, plugin and project paths are generated from the local installation; never commit these local plans to a public package. Generated MCP commands carry one explicit root. Bash and PowerShell arguments are individually quoted. Bash commands are process-tested with spaces, apostrophes and metacharacters; PowerShell quoting has a contract test, not a Windows/PowerShell execution claim.

The trusted library API is `planSetup(host, projectRoot, existingRawConfig, {pluginRoot, nodePath})`. Planning is not installation consent. An integration may call `applySetup(plan)` only after concrete approval of that exact preview. The plan is an immutable, opaque, same-process capability; serialized/forged/mutated plans cannot authorize writes. The CLI intentionally exposes only dry-run, not apply or arbitrary config paths. It never modifies user/global/employer configuration, host trust settings or plugin installation state.

The apply operation checks every original content again, rejects changed sources/targets and symlink escape, stages files beside the targets, and publishes with per-file atomic rename. Temporary target locks reject competing setup without waiting or reclaiming ambiguous owners. Existing TOML bytes/comments are preserved by appending a parser-validated new section; JSON preserves unrelated settings/keys. An existing FeatureNetwork MCP entry is rejected for manual review rather than overwritten. Parser diagnostics are redacted. Configuration reads are limited to 1 MiB.

This is cooperative local filesystem protection, not a hostile-OS sandbox or a cross-file atomic transaction. A crash between the two renames can leave one reviewed addition applied and setup lock files; inspect the two fixed targets and locks before a fresh proposal. Normal app updates do not invoke setup or replace existing configuration. No project data is copied by setup.

## Sources and validation scope

Payload examples and retrieval/version bounds are in `tests/adapters/fixtures/README.md`. Primary documentation checked 2026-10-09:

- [Codex hooks](https://learn.chatgpt.com/docs/hooks) and [plugin packaging](https://developers.openai.com/plugins/build/plugins).
- [Copilot hooks](https://docs.github.com/en/copilot/reference/hooks-reference), [project MCP configuration](https://docs.github.com/en/copilot/how-tos/copilot-cli/customize-copilot/add-mcp-servers) and [plugin reference](https://docs.github.com/en/copilot/reference/copilot-cli-reference/cli-plugin-reference).
- [smol-toml 1.9.0 release](https://github.com/squirrelchat/smol-toml/releases/tag/v1.9.0), pinned and bundled for safe TOML validation, including its parser hardening.

`npm test -- tests/adapters tests/commands tests/freshness` validates contracts, safe temporary fixtures and real bundled processes. These tests do not install or accept any host integration.

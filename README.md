# FeatureNetwork

Local feature and decision memory for coding agents. Git-versioned YAML describes features, code references, ideas, user requirements and evidenced or hypothetical relations across explicitly connected local repositories. Five project-bound STDIO-MCP tools supply bounded context, impact queries, updates, freshness checks and resumable initialization. The running agent performs semantic analysis; FeatureNetwork calls no model API, cloud or telemetry service.

**Prerequisite: Node.js 24 LTS, installed separately.** The prebuilt `codex-plugin/` (Codex compatibility) and `plugin/` (Copilot portable) directories bundle their JavaScript dependencies and run offline without `npm`, TypeScript or `node_modules`. Docker Compose and Deploy Cockpit are intentionally outside this plugin's scope. License: MIT; bundled dependency notices accompany the artifact.

## Install and activate

Use the prebuilt plugin from a separately authorized release archive, extract it to a stable local location, and follow [installation](docs/installation.md). Local release preparation currently creates an unpublished archive; this repository does not claim a public release exists.

Both native distributions include seven skills and the same bundled core. Codex uses only `.codex-plugin/plugin.json` in its separate tree: a portable root manifest suppresses hook discovery in the tested CLI `0.162.0-alpha.17.2`. Copilot retains Agent Plugins 1.0 at `plugin/plugin.json`. Neither distribution activates a project-bound MCP server: an immutable project root must be selected explicitly. Activate MCP using a reviewed project setup preview and receipt. For Codex with the native plugin enabled:

```sh
node /path/to/codex-plugin/dist/cli.mjs setup --host codex --project-root /path/to/project --native-plugin --dry-run
# Review the additions, exact targets and receipt printed above. Then explicitly approve:
node /path/to/codex-plugin/dist/cli.mjs setup --host codex --project-root /path/to/project --native-plugin --approve-and-apply RECEIPT
```

Codex native mode writes only the project MCP entry; the native plugin supplies hooks, which require host trust review. It rejects exact duplicate FeatureNetwork project hooks. For Copilot CLI use `--host copilot` and omit `--native-plugin`: reviewed project setup supplies MCP and lifecycle hooks because the packaged Copilot hooks are deliberately non-active. Setup preserves unrelated configuration, rejects changed previews and never installs a host plugin or changes host trust settings.

Codex Mac app, Copilot CLI and the standalone [GitHub Copilot App](https://github.com/features/ai/github-app) require separate live acceptance. The App is the desktop product linked here; CLI behavior does not establish App behavior. Automated package/contract tests establish no native menu, actual model use or App capability. Copilot's documented hook payload has no reliable turn identity, so it cannot force automatic completion; the skill/MCP workflow must finish maintenance explicitly. This is a visible v1 integration gap.

## Commands

| Skill/command | Result |
| --- | --- |
| `feature-network-init` | Analyze an existing project in bounded, resumable packages |
| `feature-network-status` | Show last-known state and coverage limits |
| `feature-network-show` | Find features by natural description; choose ambiguous matches or page the overview |
| `feature-network-impact` | Explain bounded evidenced and hypothetical relation paths |
| `feature-network-check` | Report freshness/integrity findings without semantic analysis or writes |
| `feature-network-sync` | Review selected code and update feature memory with reasons |

The seventh skill, `feature-network`, supports everyday development. Explicit read commands never authorize synchronization. Native Codex `/feature-net` menu discovery and real command routing remain live checks.

## Connect local projects and learn during work

Schema 2 adds persistent project UUIDs and readable `network-spec/knowledge/*.yaml` documents. A reviewed local upgrade preserves existing features and manual points. Configure reachable checkouts and independent source-read/memory-write rights with the separate reviewed connections CLI. Learning is disabled without that configuration; updating/installing the plugin grants no roots or learning permission. See [upgrade and connection setup](docs/installation.md#reviewed-schema-2-upgrade).

With learning enabled, the active agent can retain meaningful discussion decisions and reuse analysis already needed for a coding task, even without a code diff. Ideas, requirements and source-backed observations keep distinct provenance. There is no background model or raw prompt archive. Context starts with bounded last-known summaries; impact refreshes registered consumer snapshots and checks sources only for returned features. Full write validation remains a separate measured cost. Identical findings cause no cosmetic rewrite. Each project update is guarded independently and can be resumed after interruption; it is not a global transaction. See [MCP contracts](docs/mcp.md#connected-schema-2-memory).

Automated core, SDK-process and package evidence is separate from actual model/host acceptance. Connected learning in native Codex Desktop, Copilot CLI and Copilot App remains pending live validation; no token savings or agent success claim follows from scripted tests.

## Data and updates

`network-spec/` is project-owned, Git-versioned YAML. `.feature-network/` holds ignored local sessions, caches and recovery journals. Updates replace only the plugin installation directory. Keep its path stable; preserve both project directories and existing host configuration. Setup is a separate explicit operation, never an automatic update step. If an existing FeatureNetwork MCP entry needs a new executable path, review that entry manually; setup refuses to overwrite it.

## Develop and prepare locally

```sh
npm ci --ignore-scripts
npm run typecheck
npm test
npm run build
npm run verify:package
npm run bench:core
# In a clean, tested checkout with the selected license:
npm run release:prepare -- --version 0.1.0
```

`release:prepare` writes an ignored local `releases/feature-network-0.1.0/` tree, deterministic `.tar.gz`, source/checksum manifest and validation report. Both prebuilt distributions, their matching native catalogs, and sources share the recorded Git revision and tree. It never pushes, tags, uploads or publishes. Existing output is refused. Missing licensing blocks release preparation while local builds remain possible.

CI defines Node 24 validation on Linux, macOS and Windows with read-only repository permissions and no publication workflow. An actual CI run is required to establish each platform's result; local macOS tests do not prove Windows or Linux support. See [contributing](CONTRIBUTING.md), [MCP contract](docs/mcp.md) and [adapter limits](docs/adapters.md).

Local synthetic core measurements and future agent-comparison boundaries are documented in [benchmark protocol](docs/validation/benchmark-protocol.md). The [host matrix](docs/validation/host-matrix.md) keeps all three native surfaces pending; this is not full v1 acceptance. Benchmarks measure loaded-Snapshot index construction, loaded-index queries/encoding and incremental index refresh, excluding filesystem, MCP and hook latency. An authorized [Codex CLI read diagnostic](docs/validation/reports/codex-cli-2026-10-09-smoke.md) now records actual MCP calls and reported usage; it establishes no token savings, comparative task quality or Desktop acceptance.

An [actual local core report](docs/validation/reports/core-2026-10-09-darwin-arm64.md) preserves the raw samples and fresh-export provenance; its 1,000-feature warm goal applies only to the recorded workload.

A later [degree-contrast report](docs/validation/reports/core-2026-10-09-degree-contrast-darwin-arm64.md) measures cyclic degree 2 and 12 at all three sizes and preserves all raw observations. It remains a loaded-Core measurement, with native host/Windows acceptance pending.

# FeatureNetwork

Local feature memory for coding agents. Git-versioned YAML describes features, code references and evidenced or hypothetical relations. Five project-bound STDIO-MCP tools supply bounded context, impact queries, updates, freshness checks and resumable initialization. The running agent performs semantic analysis; FeatureNetwork calls no model API, cloud or telemetry service.

**Prerequisite: Node.js 24 LTS, installed separately.** The prebuilt `plugin/` directory bundles its JavaScript dependencies and runs offline without `npm`, TypeScript or `node_modules`. Docker Compose and Deploy Cockpit are intentionally outside this plugin's scope. License: MIT; bundled dependency notices accompany the artifact.

## Install and activate

Use the prebuilt plugin from a separately authorized release archive, extract it to a stable local location, and follow [installation](docs/installation.md). Local release preparation currently creates an unpublished archive; this repository does not claim a public release exists.

Installing the native plugin loads seven skills. Its portable `mcp.json` intentionally has no active server: an immutable project root must be selected explicitly. Activate MCP using a reviewed project setup preview and receipt. For Codex with the native plugin enabled:

```sh
node /path/to/plugin/dist/cli.mjs setup --host codex --project-root /path/to/project --native-plugin --dry-run
# Review the additions, exact targets and receipt printed above. Then explicitly approve:
node /path/to/plugin/dist/cli.mjs setup --host codex --project-root /path/to/project --native-plugin --approve-and-apply RECEIPT
```

Codex native mode writes only the project MCP entry; the native plugin supplies hooks, which require host trust review. It rejects exact duplicate FeatureNetwork project hooks. For Copilot CLI use `--host copilot` and omit `--native-plugin`: reviewed project setup supplies MCP and lifecycle hooks because the packaged Copilot hooks are deliberately non-active. Setup preserves unrelated configuration, rejects changed previews and never installs a host plugin or changes host trust settings.

Codex Mac app, Copilot CLI and Copilot App require separate live acceptance. Automated package/contract tests establish no native menu, actual model use or App capability. Copilot's documented hook payload has no reliable turn identity, so it cannot force automatic completion; the skill/MCP workflow must finish maintenance explicitly. This is a visible v1 integration gap.

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

## Data and updates

`network-spec/` is project-owned, Git-versioned YAML. `.feature-network/` holds ignored local sessions, caches and recovery journals. Updates replace only the plugin installation directory. Keep its path stable; preserve both project directories and existing host configuration. Setup is a separate explicit operation, never an automatic update step. If an existing FeatureNetwork MCP entry needs a new executable path, review that entry manually; setup refuses to overwrite it.

## Develop and prepare locally

```sh
npm ci --ignore-scripts
npm run typecheck
npm test
npm run build
npm run verify:package
# In a clean, tested checkout with the selected license:
npm run release:prepare -- --version 0.1.0
```

`release:prepare` writes an ignored local `releases/feature-network-0.1.0/` tree, deterministic `.tar.gz`, source/checksum manifest and validation report. Sources and prebuilt plugin share the recorded Git revision and tree. It never pushes, tags, uploads or publishes. Existing output is refused. Missing licensing blocks release preparation while local builds remain possible.

CI defines Node 24 validation on Linux, macOS and Windows with read-only repository permissions and no publication workflow. An actual CI run is required to establish each platform's result; local macOS tests do not prove Windows or Linux support. See [contributing](CONTRIBUTING.md), [MCP contract](docs/mcp.md) and [adapter limits](docs/adapters.md).

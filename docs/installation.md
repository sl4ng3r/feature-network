# Installation and updates

## Preconditions and local artifact

Install Node.js **24 LTS** using your normal runtime manager and confirm `node --version` reports `v24.*`. Other major versions are rejected; FeatureNetwork never changes your global Node installation. Download an authorized prebuilt release archive, verify its supplied checksum, and extract it. A local maintainer can instead create the same layout with `npm run release:prepare -- --version 0.1.0` from a clean, validated checkout. Local preparation is not publication or live host acceptance.

The archive contains two prebuilt distributions, both native catalog templates, a buildable `source/`, and `release-manifest.json`. Use `codex-plugin/` for Codex and `plugin/` for GitHub Copilot CLI or the standalone [GitHub Copilot App](https://github.com/features/ai/github-app). Both distributions use the same compiled runtime, seven skills, and shared hook source; the build does not fork hook logic. Its `dist/cli.mjs` and `dist/hook.mjs` need no package download; `dist/third-party-notices.json` contains the actual bundled dependency licenses. Keep the full chosen plugin directory at a stable path. Plugin-root variables are used only in documented host contexts; there is no invented universal project-root variable.

## Native plugin discovery

The source tree supplies separate catalogs, because Codex and Copilot do not share a marketplace envelope:

- Codex: `.agents/plugins/marketplace.json`, local `source` object pointing at `./codex-plugin` relative to the marketplace root.
- Copilot CLI: `.github/plugin/marketplace.json`, source string `./plugin` relative to the repository root.

The release root already contains the catalogs at `.agents/plugins/marketplace.json` and `.github/plugin/marketplace.json` beside both distributions. Register that root directly. If moving files, preserve each catalog structure and review its relative source path. Copying a template over an existing catalog would discard other plugins: merge only its entry after review.

Codex's documented local marketplace route discovers `.agents/plugins/marketplace.json` at its marketplace root; add that local root with `codex plugin marketplace add /path/to/local-package`, then choose the plugin in the native install surface and review hook trust. Project enablement, if needed, uses `[plugins."feature-network@feature-network-local"]` with `enabled = true` in project `.codex/config.toml`; merge this manually without replacing existing settings. A host CLI command in this guide is a user action, not an installation performed by this package. App visibility/menu/trust behavior still needs live verification.

For Copilot CLI the documented direct local installation command is `copilot plugin install /path/to/plugin`; alternatively register the local marketplace root and install `feature-network@feature-network-local` using the host's `/plugin` flow. Do not infer Copilot App installation support from CLI instructions: that surface requires a separate live investigation.

Codex uses a deliberately separate compatibility distribution: `codex-plugin/.codex-plugin/plugin.json` declares `./skills` and `./hooks/hooks.json`; there is **no root `plugin.json`**. In the installed Codex CLI `0.162.0-alpha.17.2`, actual auth-free `hooks/list` diagnostics found no hooks for a portable manifest, including a legacy overlay, but discovered all three handlers for the legacy-only fixture as **untrusted**. This proves discovery for that version, not execution or Desktop approval. Host trust remains required. Future Codex versions require renewed live verification; never add a portable root manifest to this tree as a compatibility overlay.

Copilot retains the portable Agent Plugins 1.0 distribution at `plugin/`. Its schema-valid `mcp.json` is empty until reviewed project setup supplies one explicit canonical root. Codex has no active bundled MCP declaration either. Neither native installation chooses a project for MCP.

## Reviewed project setup

Run setup only for a project you explicitly intend to configure. The preview prints additions, fixed target paths, original raw-byte SHA-256 hashes, registration mode and one SHA-256 receipt. Unrelated configuration values stay private. Previewing grants no installation consent.

For Codex with the native plugin enabled, use MCP-only native mode:

```sh
node /path/to/codex-plugin/dist/cli.mjs setup --host codex --project-root /path/to/project --native-plugin --dry-run
node /path/to/codex-plugin/dist/cli.mjs setup --host codex --project-root /path/to/project --native-plugin --approve-and-apply RECEIPT
```

Review the first output, then substitute **that exact receipt** in the second command. Native mode writes only `.codex/config.toml`. It checks `.codex/hooks.json` for positively identified duplicate commands from the same bundle and refuses them; it never removes unrelated hooks. Use one hook registration route. A previously configured fallback must be reviewed and its exact FeatureNetwork entries removed by you before enabling the native route. Existing registrations from another installation path also require your review; the package does not guess ownership or silently disable them. Native hook trust remains a separate host decision.

For Copilot CLI use its concrete project fallback. The standalone GitHub Copilot App is the separate desktop target linked above; its native plugin install, MCP process, command picker, and lifecycle behavior require their own live checks. A CLI result does not establish those App results:

```sh
node /path/to/plugin/dist/cli.mjs setup --host copilot --project-root /path/to/project --dry-run
node /path/to/plugin/dist/cli.mjs setup --host copilot --project-root /path/to/project --approve-and-apply RECEIPT
```

This writes `.github/hooks/feature-network.json` and `.mcp.json`. `--native-plugin` is Codex-only and is rejected for Copilot. Copilot's bundled namespace hook file is non-active because hook-root expansion is not established by current primary docs. No reliable documented Copilot turn identity means agentStop cannot safely force continuation. Use the skill/MCP workflow to complete maintenance; automatic completion remains a gap.

For Codex **without a native plugin registration**, omitting `--native-plugin` proposes `.codex/hooks.json` and `.codex/config.toml` as the full project fallback. This configures tools/hooks only; make skills available using the host's documented skill install route. Do not combine this fallback with enabled native hooks.

Apply re-reads actual files, recreates the opaque same-process plan, compares the approved receipt, then checks bundle fingerprints, target hashes, path containment and cooperative per-target locks before publishing. It does not import serialized write plans, accept arbitrary target paths or support `--force`. A changed target, source, root, plugin path, mode or receipt requires a new preview. The receipt is local configuration approval; do not commit or distribute previews or receipts.

Two-file fallback publication is individually atomic, not a cross-file transaction. A crash between renames may leave one addition plus locks. Inspect both fixed targets and lock files before creating a new proposal. There is no blind repair or ambiguous lock reclaim. Host configuration must never be treated as project data for automatic updates.

## Test the project-bound process

This is a direct offline diagnostic, separate from host/menu acceptance (use `plugin/dist/cli.mjs` for Copilot):

```sh
node /path/to/codex-plugin/dist/cli.mjs mcp --project-root /path/to/project
```

The process uses STDIO JSON-RPC and waits for an MCP client; it is not an interactive chat. The five tools are `network_context`, `network_impact`, `network_update`, `network_check`, `network_bootstrap`. Tools cannot override the selected root. Package tests start the actual generated MCP command with a real client from an isolated prebuilt-only directory.

## Update and remove

Close the affected agent session, verify the new prebuilt checksum, then replace only the chosen `codex-plugin/` or `plugin/` installation directory at the same stable path. Preserve project `network-spec/`, `.feature-network/`, all manual configuration and existing setup entries. Native host refresh/restart and renewed hook trust may be required by the host. The package performs none of those actions automatically. Changed plugin/runtime paths require explicit configuration review; setup rejects existing FeatureNetwork MCP entries instead of replacing them. Re-run a dry-run only if you intend a new installation operation.

Remove the native plugin through its host UI/CLI. Project setup is separate: inspect and remove only the reviewed FeatureNetwork MCP/hook entries, preserving other providers. Feature memory belongs to the project and is retained unless you explicitly remove it.

## Primary documentation and evidence boundary

Schemas and documentation checked on 2026-10-09:

- [Agent Plugins manifest schema](https://agent-plugins.org/schemas/1.0.0/plugin.schema.json) and [MCP schema](https://agent-plugins.org/schemas/1.0.0/mcp.schema.json); snapshots in `tests/package/schemas/`.
- [OpenAI package/install documentation](https://developers.openai.com/plugins/build/plugins): portable manifest, OpenAI namespace, local catalogs and Codex hook variables/trust.
- [Standalone GitHub Copilot App](https://github.com/features/ai/github-app) and [App customization](https://docs.github.com/en/copilot/how-tos/github-copilot-app/customize-github-copilot-app): distinct desktop acceptance target.
- [GitHub Copilot plugin reference](https://docs.github.com/en/copilot/reference/copilot-cli-reference/cli-plugin-reference): portable discovery, Copilot namespace and different catalog format. MCP plugin-root expansion does not establish hook command expansion.

Contract tests, offline processes, checksum equality and schema validation do not prove semantic feature coverage, native menus, model instruction use or successful trust review. Three distinct host live checks remain required. The GitHub repository URL in metadata identifies the intended source; it does not claim publication has happened.

## Reviewed schema-2 upgrade (staged connected-memory development)

Schema 1 remains supported. Schema 2 and the future connected-memory workflow require an explicit upgrade; installing an updated plugin never upgrades project data or grants access to another checkout. At this development stage the upgrade API is implemented; the complete connected MCP workflow has its own integration checks.

With Node 24, choose one stable UUID for the project and reuse it in both commands:

```sh
node plugin/dist/cli.mjs upgrade --project-root <root> --project-id <uuid> --name <name> --dry-run
node plugin/dist/cli.mjs upgrade --project-root <root> --project-id <uuid> --name <name> --approve-and-apply <receipt>
```

Review the displayed files first. Changed YAML or sources invalidate the receipt. An interrupted publication uses the existing recovery journal; recovery may finish and then reject the old request revision, requiring a fresh preview. Feature IDs, manual key points and local relationships survive. No host configuration, connections, source baseline or learning permission is created by this operation. Older clients reject schema 2; there is no destructive automatic downgrade.

## Explicit local project selection

Create a local YAML selection with `schema: 1`, `learning: {enabled: true|false}` and `projects` entries containing a persistent UUID (`id`), local checkout `root`, `readSources` and `writeMemory` booleans. The active project is implicit and must not be duplicated. The file is limited to 64 KiB and 128 entries; individual queries have smaller declared work limits. Selection is not transitive. Missing registry means disabled automatic learning and no external access.

```sh
node plugin/dist/cli.mjs connections --project-root <root> --config-file <local-selection.yaml> --dry-run
node plugin/dist/cli.mjs connections --project-root <root> --config-file <local-selection.yaml> --approve-and-apply <receipt>
```

Only the active project's ignored `.feature-network/connections.yaml` is changed. Review the paths and rights; the receipt binds the candidate bytes, current registry and selected identities. Counterpart configuration, global settings and product files stay untouched. Replacing the registry or a selected identity invalidates outstanding access. This grants plugin-level scope only; host permissions still apply.

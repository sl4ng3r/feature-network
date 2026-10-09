# Installation and updates

## Preconditions and local artifact

Install Node.js **24 LTS** using your normal runtime manager and confirm `node --version` reports `v24.*`. Other major versions are rejected; FeatureNetwork never changes your global Node installation. Download an authorized prebuilt release archive, verify its supplied checksum, and extract it. A local maintainer can instead create the same layout with `npm run release:prepare -- --version 0.1.0` from a clean, validated checkout. Local preparation is not publication or live host acceptance.

The archive contains `plugin/`, a buildable `source/`, and `release-manifest.json`. Use the prebuilt plugin directly. Its `dist/cli.mjs` and `dist/hook.mjs` need no package download; `dist/third-party-notices.json` contains the actual bundled dependency licenses. Keep the full plugin directory at a stable path. Plugin-root variables are used only in documented host contexts; there is no invented universal project-root variable.

## Native plugin discovery

The source tree supplies separate catalogs, because Codex and Copilot do not share a marketplace envelope:

- Codex: `.agents/plugins/marketplace.json`, local `source` object pointing at `./plugin` relative to the marketplace root.
- Copilot CLI: `.github/plugin/marketplace.json`, source string `./plugin` relative to the repository root.

For a prebuilt installation in a directory you control, keep the source catalog directory structure and replace its `source.path` (Codex) or `source` (Copilot) with the **relative location of the extracted prebuilt plugin**. For example, a sibling layout `local-package/.agents/plugins/marketplace.json` and `local-package/plugin/` uses `./plugin`. Copying either template over an existing catalog would discard other plugins: merge only its entry after review.

Codex's documented local marketplace route discovers `.agents/plugins/marketplace.json` at its marketplace root; add that local root with `codex plugin marketplace add /path/to/local-package`, then choose the plugin in the native install surface and review hook trust. Project enablement, if needed, uses `[plugins."feature-network@feature-network-local"]` with `enabled = true` in project `.codex/config.toml`; merge this manually without replacing existing settings. A host CLI command in this guide is a user action, not an installation performed by this package. App visibility/menu/trust behavior still needs live verification.

For Copilot CLI the documented direct local installation command is `copilot plugin install /path/to/plugin`; alternatively register the local marketplace root and install `feature-network@feature-network-local` using the host's `/plugin` flow. Do not infer Copilot App installation support from CLI instructions: that surface requires a separate live investigation.

Native installation loads skills and, in Codex, portable hooks. It does **not** choose the project for MCP. `plugin/mcp.json` is a schema-valid empty template until reviewed project setup supplies one explicit canonical root.

## Reviewed project setup

Run setup only for a project you explicitly intend to configure. The preview prints additions, fixed target paths, original raw-byte SHA-256 hashes, registration mode and one SHA-256 receipt. Unrelated configuration values stay private. Previewing grants no installation consent.

For Codex with the native plugin enabled, use MCP-only native mode:

```sh
node /path/to/plugin/dist/cli.mjs setup --host codex --project-root /path/to/project --native-plugin --dry-run
node /path/to/plugin/dist/cli.mjs setup --host codex --project-root /path/to/project --native-plugin --approve-and-apply RECEIPT
```

Review the first output, then substitute **that exact receipt** in the second command. Native mode writes only `.codex/config.toml`. It checks `.codex/hooks.json` for positively identified duplicate commands from the same bundle and refuses them; it never removes unrelated hooks. Use one hook registration route. A previously configured fallback must be reviewed and its exact FeatureNetwork entries removed by you before enabling the native route. Existing registrations from another installation path also require your review; the package does not guess ownership or silently disable them. Native hook trust remains a separate host decision.

For Copilot CLI use its concrete project fallback:

```sh
node /path/to/plugin/dist/cli.mjs setup --host copilot --project-root /path/to/project --dry-run
node /path/to/plugin/dist/cli.mjs setup --host copilot --project-root /path/to/project --approve-and-apply RECEIPT
```

This writes `.github/hooks/feature-network.json` and `.mcp.json`. `--native-plugin` is Codex-only and is rejected for Copilot. Copilot's bundled namespace hook file is non-active because hook-root expansion is not established by current primary docs. No reliable documented Copilot turn identity means agentStop cannot safely force continuation. Use the skill/MCP workflow to complete maintenance; automatic completion remains a gap.

For Codex **without a native plugin registration**, omitting `--native-plugin` proposes `.codex/hooks.json` and `.codex/config.toml` as the full project fallback. This configures tools/hooks only; make skills available using the host's documented skill install route. Do not combine this fallback with enabled native hooks.

Apply re-reads actual files, recreates the opaque same-process plan, compares the approved receipt, then checks bundle fingerprints, target hashes, path containment and cooperative per-target locks before publishing. It does not import serialized write plans, accept arbitrary target paths or support `--force`. A changed target, source, root, plugin path, mode or receipt requires a new preview. The receipt is local configuration approval; do not commit or distribute previews or receipts.

Two-file fallback publication is individually atomic, not a cross-file transaction. A crash between renames may leave one addition plus locks. Inspect both fixed targets and lock files before creating a new proposal. There is no blind repair or ambiguous lock reclaim. Host configuration must never be treated as project data for automatic updates.

## Test the project-bound process

This is a direct offline diagnostic, separate from host/menu acceptance:

```sh
node /path/to/plugin/dist/cli.mjs mcp --project-root /path/to/project
```

The process uses STDIO JSON-RPC and waits for an MCP client; it is not an interactive chat. The five tools are `network_context`, `network_impact`, `network_update`, `network_check`, `network_bootstrap`. Tools cannot override the selected root. Package tests start the actual generated MCP command with a real client from an isolated prebuilt-only directory.

## Update and remove

Close the affected agent session, verify the new prebuilt checksum, then replace only the plugin directory at the same stable path. Preserve project `network-spec/`, `.feature-network/`, all manual configuration and existing setup entries. Native host refresh/restart and renewed hook trust may be required by the host. The package performs none of those actions automatically. Changed plugin/runtime paths require explicit configuration review; setup rejects existing FeatureNetwork MCP entries instead of replacing them. Re-run a dry-run only if you intend a new installation operation.

Remove the native plugin through its host UI/CLI. Project setup is separate: inspect and remove only the reviewed FeatureNetwork MCP/hook entries, preserving other providers. Feature memory belongs to the project and is retained unless you explicitly remove it.

## Primary documentation and evidence boundary

Schemas and documentation checked on 2026-10-09:

- [Agent Plugins manifest schema](https://agent-plugins.org/schemas/1.0.0/plugin.schema.json) and [MCP schema](https://agent-plugins.org/schemas/1.0.0/mcp.schema.json); snapshots in `tests/package/schemas/`.
- [OpenAI package/install documentation](https://developers.openai.com/plugins/build/plugins): portable manifest, OpenAI namespace, local catalogs and Codex hook variables/trust.
- [GitHub Copilot plugin reference](https://docs.github.com/en/copilot/reference/copilot-cli-reference/cli-plugin-reference): portable discovery, Copilot namespace and different catalog format. MCP plugin-root expansion does not establish hook command expansion.

Contract tests, offline processes, checksum equality and schema validation do not prove semantic feature coverage, native menus, model instruction use or successful trust review. Three distinct host live checks remain required. The GitHub repository URL in metadata identifies the intended source; it does not claim publication has happened.

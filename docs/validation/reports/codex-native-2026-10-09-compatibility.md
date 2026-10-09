# Codex compatibility installation — 2026-10-09

The final Codex distribution at runtime source revision `1b0c396` was inspected through native Codex CLI `0.162.0-alpha.17.2` in an auth-free temporary host and then installed via the native route for the previously authorized synthetic demo. All 21 installed files match the reviewed `codex-plugin/` bytes. The separate portable package contains 23 files and continues to provide the demo's unchanged project-bound MCP path.

Native service discovery in the actual demo finds seven enabled skills and three enabled plugin hooks (`sessionStart`, `userPromptSubmit`, `stop`), without load errors. All hooks remain **untrusted**: no hook trust state was forged, bypassed or approved, and this diagnostic executed no lifecycle hooks. The [record](codex-native-2026-10-09-compatibility.json) binds relative file hashes and filtered native results.

The plugin remains disabled globally and enabled only in the demo. The native installer temporarily enables its owned global entry; it was restored to disabled with validated TOML and an unrelated-configuration comparison. The demo's configuration hash still matches the original installation record. All eight source/network files remain unchanged. No global runtime/PATH change or app restart occurred.

The separate format is necessary because this native host ignores portable-manifest hooks. It preserves the portable Copilot package and common runtime/skills. Future Codex versions should be checked against both native discovery and actual lifecycle execution before changing this compatibility route.

Remaining host acceptance is explicit: normal hook trust review and actual lifecycle behavior, effective GUI Node 24 PATH, Desktop `/feature-net` menus, init/sync agent runs, both Copilot surfaces on the work computer and controlled model comparisons. Discovery and file equality do not establish those results.

# Hook contract fixtures

These are redacted examples instantiated from official payload schemas retrieved on 2026-10-09. They are not captured user sessions or host acceptance evidence. Fields contain synthetic public test data. Copilot's outer `event` is fixture metadata / the configured command argument, never a claimed stdin field.

- Codex release-behavior documentation: https://learn.chatgpt.com/docs/hooks (SessionStart, UserPromptSubmit, Stop, shared fields/output). Local executable version observed only with `--version`: `codex-cli 0.162.0-alpha.2`; no session/install invocation. Documents are rolling, unversioned; this is not a claim that the local version implements every field.
- Codex bundled hook paths/environment: https://developers.openai.com/plugins/build/plugins . `PLUGIN_ROOT` is documented for hooks. A host project-root interpolation variable is not assumed.
- Copilot CLI command-hook schemas and output consumption: https://docs.github.com/en/copilot/reference/hooks-reference . Configuration version `1`; runtime version not live verified. `sessionStart` consumes `additionalContext`, `userPromptSubmitted` command output is ignored, `agentStop` accepts `decision: block` / `reason` and receives `stop_hook_active`. CamelCase stdin has no event-name field and no documented turn identity.
- Copilot project config: https://docs.github.com/en/copilot/how-tos/copilot-cli/customize-copilot/add-mcp-servers and https://docs.github.com/en/copilot/concepts/agents/hooks . No user config changed.
- Copilot plugin environment: https://docs.github.com/en/copilot/reference/copilot-cli-reference/cli-plugin-reference .

Output shapes are tested separately: Codex `hookSpecificOutput` with event and `additionalContext`; Copilot SessionStart top-level `additionalContext`; Copilot command prompt `{}`; Codex Stop `decision`/`reason` only under guards. Copilot App capabilities and all installed-host acceptance remain unverified for Task 12. Do not infer App support from CLI/cloud/VS Code schemas.

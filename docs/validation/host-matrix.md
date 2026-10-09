# Host acceptance matrix

**v1 is not fully accepted.** Local automated contracts/offline bundled processes exist; no authorized native-host installation, actual model comparison or native UI acceptance has been performed for these three required surfaces. Pending checks are required evidence, not assumed passes. MIT has been selected; public push/tag/release remains separately unauthorized.

## Limited read-only inventory on 2026-10-09

| Target surface | Observed inventory | Still unknown |
| --- | --- | --- |
| Codex Desktop on Mac | `/Applications/ChatGPT.app` reports short version 26.1002.52244, build 13536. A separate earlier read-only Codex CLI check reported 0.162.0-alpha.2. | Actual target Desktop identity/provider/UI/plugin version and model session binding; neither an app bundle name nor the separate CLI version proves the requested Desktop integration. |
| GitHub Copilot CLI | `copilot` was not found on the inventory's default PATH. | Whether installed elsewhere, executable/version/provider, access and organization policy. PATH absence does not prove absence from the computer. |
| GitHub Copilot App | No top-level `/Applications` or user `Applications` app name matching Copilot was seen. | Actual app identity/version/plugin interface/provider and permission. This limited name inventory does not prove absence elsewhere. CLI support does not prove App support. |

This inventory did not launch a session, install anything, alter configuration/trust or collect detailed telemetry. There is no live observation of native menus or host MCP/hook execution. Shell use of an explicit Node 24 runtime is local test evidence only: native portable hooks use `node`, and Node 24 on the **GUI host PATH** is still an unverified prerequisite. No global Node/PATH change or app restart has been authorized.

## Required checks, each against its own actual host/version

| Check and required evidence | Codex Desktop | Copilot CLI | Copilot App |
| --- | --- | --- | --- |
| Installation/enablement: exact artifact hash, host/provider versions, preserved unrelated config, reviewed trust | Pending: concrete demo-only install/setup/trust authorization, then observe native install | Pending: locate/version host, access/policy and concrete install authorization | Pending: locate/version host, investigate supported install surface, access/policy and concrete authorization |
| MCP: host starts the generated project-bound STDIO process; exactly five tools; root cannot change | Pending actual host evidence | Pending actual host evidence | Pending actual host capability/evidence |
| Skills: all seven loaded, explicit commands route to correct policies and actual model follows them | Pending fresh authorized session | Pending fresh authorized session | Pending fresh authorized session/capability |
| Hooks: native/fallback registration, no duplicate handlers, actual lifecycle payloads, effective Node24 PATH and observed maintenance | Pending native trust/PATH and actual turn identity/stop/reentry checks | Pending concrete project setup; packaged hooks deliberately non-active; reliable turn ID unavailable | Pending App hook interface and payloads; CLI contract cannot substitute |
| Init/resume: actual agent bounded analysis on empty network, pause/checkpoint, source change reconciliation, resume, preserve existing/manual memory, partial coverage visible | Pending actual agent run | Pending actual agent run | Pending actual agent run |
| Profile task: SQLite persistence/migration/backup/restore independently tested plus separate graph Soll/Ist; actual session binding and costs | Pending actual task and evaluator artifacts | Pending actual task and evaluator artifacts | Pending actual task and evaluator artifacts |
| `show` natural language: no feature-ID/symbol knowledge required, relevant actual project result | Pending UI/session evidence | Pending UI/session evidence | Pending UI/session evidence |
| `show` ambiguity: user can choose among real alternatives | Pending UI/session evidence | Pending UI/session evidence | Pending UI/session evidence |
| `show` no argument: paginated readable overview and functional continuation | Pending UI/session evidence | Pending UI/session evidence | Pending UI/session evidence |
| `sync` shrink: source-supported removed statement actually removed; remaining obligations reviewed | Pending actual agent/source/network evidence | Pending actual agent/source/network evidence | Pending actual agent/source/network evidence |
| `sync` contract change: profile/backup/restore obligations/relations updated from actual targeted inspection | Pending actual evidence | Pending actual evidence | Pending actual evidence |
| `sync` conflict: mutate source/network after proposal, refuse stale write and review current bytes again | Pending actual evidence | Pending actual evidence | Pending actual evidence |
| `sync` repeat: identical acknowledged repeated state produces no YAML rewrite; byte/hash and write-event evidence | Pending actual evidence | Pending actual evidence | Pending actual evidence |
| Manual key points: explicit preserved manual assertion survives shrink, contract and repeated sync | Pending actual evidence | Pending actual evidence | Pending actual evidence |
| Native `/feature-net` discovery: all six `init/status/show/impact/check/sync` entries visible and invocable | Pending exact Desktop menu evidence for all six | Distinct host command interface; Codex menu requirement does not transfer | Distinct host interface investigation required |

Five-tool tests, schema checks, command metadata, mock payloads, direct bundled SDK/hook processes, core queries and synthetic demo protocol tests are **contract/local** evidence. They do not satisfy any live cell. The three-OS CI definition exists, but executed Linux/macOS/Windows CI evidence remains external/pending. The actual Windows PowerShell hook smoke test is skipped on the macOS development host; this is not Windows acceptance.

Copilot without a documented reliable turn identity uses informational stop and cannot safely force maintenance continuation. Its packaged hook file is intentionally non-active until reviewed fixed project setup. This known capability gap must remain in acceptance conclusions even after a future successful install. Do not mark automatic v1 completion satisfied merely because manual skill/MCP work succeeds. The App may have different constraints and must be investigated separately. The portable `mcp.json` is a valid empty template; native install alone does not choose a root or activate project MCP.

## Concrete prepared next step

An ignored local proposal contains an independent synthetic pre-locale Git demo, a copy of Task 11's reviewed prebuilt-only local package/catalog and an actual **dry-run** MCP-only Codex setup preview. It proposes one previously absent **demo** `.codex/config.toml`; unrelated user/employer configurations are outside it. That prior package has not been installed and final branch release preparation is separate. No SQLite user data, actual sessions or logs are included. The exact absolute local paths/receipt stay in scratch and are deliberately not published here.

Later authorization must cover that exact Codex local marketplace/plugin installation and demo project enablement, its reviewed MCP entry, native hook trust, fresh demo sessions and explicit **demo-only detailed telemetry**. Telemetry would collect version/model/session/task bindings, available tool/read/hook evidence, timing and actual provider usage; missing observations stay null. Raw synthetic prompts/session logs would remain ignored local evidence. No global telemetry enablement, employer/user project changes, separate model API or Copilot install is implied. Hook PATH remains a prerequisite; a separate concrete decision is needed before global runtime/PATH alterations. While permissions/hosts are missing, local benchmark/documentation work can finish, and all live cells remain pending.

## Evidence rules

Use `assessHost(host, version, evidence)` from `bench/comparison.ts` for supplied machine-readable checks. Each required live result must bind the exact host, observed version, named check, passed/failed status and non-null evidence hash. Contract results, other hosts/versions or missing hashes cannot pass. A conflicting matching failure dominates a matching pass. This validates record structure only, not the truth of an operator-supplied artifact. Provider/model/session/source bindings belong in the actual comparison records; versions unavailable from the host remain unknown, never inferred from a CLI or package schema.

After authorization, store actual UI/session/config/runtime artifacts locally, then redact private paths/prompts before committing selected summaries. For sync repeat, compare actual YAML byte hashes and available write events; an identical hash alone does not prove no rewrite. For costs and task quality use the independent protocol in [benchmark protocol](benchmark-protocol.md); three fresh trials per condition per task are mandatory. There are currently no actual comparison reports. Do not replace missing runs with Task 8's synthetic answers or call this matrix full v1 acceptance.

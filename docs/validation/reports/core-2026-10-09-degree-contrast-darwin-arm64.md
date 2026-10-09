# Local Core degree-contrast measurement — 2026-10-09

[Unmodified raw JSON with all samples](core-2026-10-09-degree-contrast-darwin-arm64.json). This new report preserves the previous [three-edge report](core-2026-10-09-darwin-arm64.md) and its provenance unchanged.

Actually measured at `2026-10-09T17:03:39.000Z` on Darwin 25.6.0, arm64, Apple M5 (10 logical CPUs, 16 GiB), Node.js v24.19.0. Two independently selected degrees (2 and 12) run at each size, with deterministic cyclic edges +1 through degree modulo size. Density is edges / (vertices × (vertices − 1)). No self-edges.

| Features | Degree | Edges | Directed density | Cold p95 ms | Warm p95 ms | Refresh p95 ms | Combined Core JSON bytes |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 100 | 2 | 200 | 0.02020202 | 2.354250 | 0.112375 | 0.224708 | 4984 |
| 100 | 12 | 1200 | 0.12121212 | 1.854334 | 0.331375 | 0.129000 | 7624 |
| 1000 | 2 | 2000 | 0.00200200 | 18.392750 | 0.269167 | 0.871292 | 4989 |
| 1000 | 12 | 12000 | 0.01201201 | 27.270167 | 0.466250 | 0.764084 | 7632 |
| 10000 | 2 | 20000 | 0.00020002 | 1864.754542 | 1.366834 | 19.365167 | 4994 |
| 10000 | 12 | 120000 | 0.00120012 | 2132.311875 | 1.596333 | 8.376500 | 7640 |

Cold means a fresh index from an already loaded synthetic Snapshot plus context/impact queries and UTF-8 JSON encoding in an already running process. Warm means the same loaded index and queries/encoding. Refresh measures replacement of one changed feature in a loaded index against a preconstructed Snapshot. These are **not** filesystem/YAML, Git/reference, MCP, hook, deployed-plugin, host or model latencies. Real MCP cache wiring now has consumer regression coverage, but this microbenchmark does not measure that path.

Every case retains five cold, ten untimed warmup, thirty warm and five refresh observations. No samples were removed or adjusted; quantiles are nearest-rank. Both recorded 1,000-feature warm-p95 observations meet the 100 ms goal for these specific workloads. The 10,000-feature cold cost remains roughly 1.86–2.13 seconds; neither this contrast nor that goal proves general or end-to-end performance. GC is exposed and used only before/after the retained-index measurement, with natural GC during timed loops. Whole-process memory figures (including noisy/possibly negative deltas) are retained in raw JSON; they are not isolated allocation or peak measurements. Machine load/thermal state is uncontrolled.

## Reproducible source binding

The measured source is a fresh `git archive` of staged tree **da201fac2360df13b6b045db33a8a184408f8d9c**, based on checkout HEAD **d6e1f60e2616c3ebd23bd5113b3cd8fcfb70477d**, frozen after the coordinated review fixes. It had no Git metadata or preexisting dependencies/build outputs. `npm ci --ignore-scripts`, `npm run typecheck`, `npm run build`, `npm test`, `npm run verify:package` all succeeded there before this `npm run --silent bench:core` invocation. Complete suite: **406 passed, 1 skipped**, 36 files, 44.54 s. The only skip is the actual Windows-only PowerShell hook test on macOS; Windows execution remains unverified. Package verification consumed 23 files and five actual bundled dependency license notices.

The report correctly leaves Git `sourceRevision`, `sourceTree` and `workingTreeDirty` null for the Git-free export. The recorded staged-tree identity above is operator-observed archive provenance. The raw report binds the executed bundle and 102 relative input-path SHA-256 observations (source/dependencies/runner); post-build inputs are not a concurrency-proof capture. The frozen export was not edited during the run.

- Raw report SHA-256: `d9696a0e26f8e71967d4eca68b27b6423fa115c828fd6bdac214c75e80df8073`.
- Executed benchmark bundle SHA-256: `1b2fdcf11fc893d3b7dc2946a6c546378e1c19c0eb7c14903d6c8ff377024c22`.
- After this verified tree, the only final tracked delta is this report, its raw JSON and a README link; no product/test/script/skill change. Final plugin runtime artifacts are checked byte-for-byte against the validated export.

Actual Codex Desktop, Copilot CLI and Copilot App acceptance, provider token savings, agent reading coverage and external Windows/Linux CI remain pending. Synthetic fixture/model contract tests do not supply that evidence. No actual host install, agent session, model API, telemetry or public release was performed.

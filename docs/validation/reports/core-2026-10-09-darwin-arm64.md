# Actual local core measurement, 2026-10-09

[Raw JSON](core-2026-10-09-darwin-arm64.json) preserves every sample, exact requests/defaults, whole-process memory observations, source input fingerprints and measurement conditions. This is a synthetic **core** run, not a host, filesystem, hook, MCP or agent/token comparison.

Measured at 2026-10-09T16:05:31.434Z by `npm run bench:core` from a fresh `git archive` export of explicitly staged source tree **6b8ebd54ec1cfde5e5d66f0259b862ce7b43eefe**, whose parent checkout HEAD was 0961ee0b5b193708ee554297ad7fcc4c45120121. The export initially had no node_modules or plugin/dist. `npm ci --ignore-scripts`, typecheck, full tests (390 passed + one Windows-only skip on macOS), build and package verification (23 files) completed successfully in that exact export before this run. These are local checks; external three-OS CI and all native-host live checks remain pending.

The exported source has no Git metadata, so its raw `sourceRevision`, `sourceTree` and `workingTreeDirty` are correctly **null**. The archive provenance above is separately observed by the validation operator, not invented by the runtime. Exact executed benchmark bundle SHA-256: `14e60f67ce12750ab0c1f130fb5ec027530b957650708c8c4c1c1c377cebba43`. Input hashes are post-build observations. After this validated tree, only this raw report, this provenance summary and the README report link were added; no product/test/benchmark/script change was made. Do not call the resulting final tree identical to the validated export.

Machine: Darwin kernel 25.6.0, arm64, Apple M5, 10 logical CPUs, 16 GiB RAM, Node v24.19.0. The separate measuring process used `--expose-gc`. Other machine load/temperature/app activity were not controlled. No cross-host performance claim follows.

| Features | Cold p95 ms | Warm p95 ms | Refresh p95 ms | Retained heap delta MiB | Core JSON bytes, combined |
| --- | --- | --- | --- | --- | --- |
| 100 | 2.340 | 0.166 | 0.191 | 0.42 | 6,390 |
| 1,000 | 19.258 | 0.234 | 0.816 | 3.69 | 6,397 |
| 10,000 | 1929.759 | 1.457 | 8.364 | 37.54 | 6,404 |

Cold includes a fresh index from the loaded Snapshot, both bounded queries and JSON encoding in an already running process. Warm includes loaded-index queries plus encoding. Refresh includes only incremental index refresh of one changed feature with preconstructed inputs. Core JSON bytes combine the two individually budgeted responses; they are not full MCP envelopes. The workload uses three cyclic outgoing edges per feature, summary context/impact output, context text `synthetic profile`, feature-0 impact in both directions to depth 2, default 20-item limits and 12,000 bytes per result. Requests/reference distribution are preserved in raw JSON and [protocol](../benchmark-protocol.md).

The 1,000-feature warm goal **passed** for this exact workload (observed p95 0.234 ms <= 100 ms). This says nothing about arbitrary queries, whole-hook/MCP/filesystem latency or model benefit. At 10,000 features the fresh loaded-Snapshot index/query/encoding p95 was **1,929.759 ms**; this remains a material initialization cost. All raw outliers stay in the report; no samples were dropped or timing assertions added to tests.

Retained heap deltas are whole-process observations after loaded snapshots with explicit GC before/after retaining one index. They are not peak/isolated/per-feature allocations; timed loops use natural GC and afterWork may contain garbage. No actual provider tokens, source-read counts or agent costs have been measured. No actual comparison reports exist. [Host matrix](../host-matrix.md) remains pending; v1 is not fully accepted.

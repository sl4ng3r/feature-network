# Synthetic SQLite demo

This local demo uses Node.js 24 LTS `node:sqlite` and synthetic profiles only. It has no cloud, authentication, Docker or deployment service. Install the repository development dependencies with `npm ci` and run `npm test -- demo/tests`; all demo tests are also included in normal `npm test` and `npm run typecheck`.

## Data contract

`openProfileDb(path)` opens a real SQLite file (caller supplies an existing parent directory) and runs transactional migrations. `saveProfile(db, profile)` writes `id`, `displayName` and `locale` using bound SQL parameters. `sessionHint` may be supplied but is never stored or backed up. Callers must close the returned database. Schema version is stored in SQLite `PRAGMA user_version`: version 1 stores id/displayName; version 2 adds locale and retains existing rows with `en-US`. Omitted locale on new saves also defaults to `en-US`. Future schema versions are rejected without migration. This is a small illustrative application, not a production migration framework.

`createBackup(db)` returns JSON with independent `formatVersion: 1`, `schemaVersion: 2` and a sorted `profiles` array. The final demo accepts only this exact backup contract; backups from schema 1 require explicit conversion and are rejected. `restoreBackup(db, backup)` validates unknown input strictly, rejects transient/unknown fields, then replaces all profiles in one transaction. Any SQL failure rolls back the deletion and preceding inserts. Restoring a valid backup deliberately replaces all profiles. The tests include a duplicate ID failing after the first insertion to verify actual SQLite rollback. JSON roundtrip tests read SQL rows and reopen the target file; graph relationships are never the persistence oracle.

## Independent network oracle

`network-spec/` is the supplied synthetic expected network for schema 2. Evidence points to the actual copied demo sources, not merely to other network files. Profile changes lead to backup/restore review, with explicit roundtrip checks. Paths are relative to the demo project root, so copy `src/` together with `network-spec/` before binding FeatureNetwork to that root.

`tests/impact.test.ts` exercises real storage/query/freshness APIs. Its `coverageGaps` helper compares an explicitly supplied Sollcontract against promised field lists, expected relations and impact reachability. Removed fields and stale/missing relations are prescribed synthetic expectations. The core does not infer field meaning, completeness or a restore implementation from YAML or hashes. A changed source hash opens a review; the separate expectation says what the agent should check. `tests/bootstrap-contract.test.ts` supplies predetermined feature answers to an empty project and demonstrates checkpoint/update/reconciliation protocol only. It is not a live Codex or Copilot agent acceptance test. Technical completion remains `coverage: partial`.

## Preserved comparison starting points

- `scenarios/empty-network/`: complete schema-1 product source, deliberately no `network-spec/`. Copy the directory to a fresh Git checkout to start a genuine `feature-network-init` agent run. Do not seed it from the final supplied network. The protocol test copies the same directory, but its canned answers do not demonstrate successful agent analysis.
- `scenarios/pre-locale/`: complete executable schema-1 source plus its schema-1 expected network. This source predates locale storage, migrations and backup/restore support. Baseline tests execute both snapshots against real SQLite and verify identical source bytes; `npm test -- demo/tests/baselines.test.ts` runs those checks.

For a future baseline/plugin agent comparison, make two independent copies of `scenarios/pre-locale/`, initialize Git independently, supply the same change request (persist `locale: 'de-DE'` through SQLite backup/restore), the same locale roundtrip acceptance test, dependencies and Node 24 runtime, and keep host/model/budget fixed. Enable FeatureNetwork only in the plugin arm. Both arms start from identical source/network bytes before the extension; do not start from the already extended `demo/src/`. The external acceptance oracle must inspect SQLite rows as well as the final network. Record host-specific live evidence separately; this repository does not claim that comparison has run. Candidate sources can be exercised by the repository Vitest harness using relative imports just as the preserved baselines are; no prebuilt SQLite database or private runtime data is distributed.

Node API reference: [Node 24 SQLite documentation](https://nodejs.org/download/release/latest-v24.x/docs/api/sqlite.html). Node 24.19.0 emitted no experimental SQLite warning during validation; no warning suppression flags or handlers are installed.

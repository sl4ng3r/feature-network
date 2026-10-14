# Connected Project Memory Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ein lesbares, projektübergreifend abfragbares YAML-Gedächtnis implementieren, das während Gesprächen und notwendigen Analysen lernt und seinen zusätzlichen Aufwand messbar begrenzt.

**Architecture:** Jedes Projekt behält sein versioniertes Wissen; ein explizites lokales Register bindet weitere Checkouts und deren Rechte. Schema 2 ergänzt Gesprächswissen und qualifizierte Ziele; gemeinsamer Index und Traversierung verwenden inkrementelle, ableitbare Daten. Gedächtnisschreiben, Quellenbestätigung und Produktarbeit bleiben getrennte Operationen mit revisionsgebundenen Quittungen.

**Tech Stack:** TypeScript strict, Node.js 24 LTS, vorhandene YAML-/Zod-/MCP-v2-Bibliotheken, Vitest, Git- und echte Prozessfixtures. Keine zusätzliche Laufzeitabhängigkeit, Datenbank oder Cloud.

**Spec:** `docs/superpowers/specs/2026-10-14-connected-project-memory-design.md`, einschließlich der nachträglich gewünschten Effizienzergänzung in Abschnitt 7.1.

**Status:** Plan und Effizienzergänzung sind durch die Nutzerwahl der direkten Umsetzung mit unabhängigem Abschlussreview freigegeben. Umsetzung ab 2026-10-14/15 im isolierten Branch `codex/connected-project-memory`; reale Installationen und Modellläufe sind weiterhin separat zu autorisieren.

## Global Constraints

- Voraussetzung für Entwicklung und Laufzeit: Node.js 24 LTS. Bei der Planung meldete die lokale Standardshell `v25.9.0`; vor Ausführung einen Node-24-Prozess und dessen tatsächlichen PATH für Kindprozesse nachweisen. Keine Produktprüfung unter Node 25 als Node-24-Nachweis ausgeben.
- Versioniertes Wissen liegt ausschließlich unter `network-spec/`, Gesprächswissen unter `network-spec/knowledge/`; lokale Verbindungen und Laufzeitwerte unter Git-ignoriertem `.feature-network/`.
- Fachliche Abdeckung bleibt `partial`. Quellhash, gültige Struktur, erfolgreiche Migration und vollständiger Index beweisen keine fachliche Vollständigkeit.
- Maximal 65.536 UTF-8-Bytes je YAML-Dokument; persistierte Runtime-/Journaldokumente bleiben auf 16 MiB begrenzt. Strikte Felder, keine Aliase, Anker, Tags oder doppelten Schlüssel.
- Normale Antworten: höchstens 20 Features, standardmäßig 12.000 UTF-8-Bytes einschließlich MCP-Result-Metadaten; Übersicht weiterhin zehn Einträge. Vorhandene explizite Ergebnislimits bis 100 und Bytebudgets 512–64.000 bleiben erhalten.
- Impacttiefe standardmäßig zwei Schritte; bestehende explizite Tiefen 0–8 bleiben erhalten. Standardmäßig acht Projekte und 1.000 besuchte Features; explizit höchstens 32 Projekte und 10.000 besuchte Features.
- Nur lokale ausgewählte Checkouts; keine automatischen Clone-/Fetch-/Checkout-/Git-Schreiboperationen, kein Hintergrunddienst und keine eigenen Modellaufrufe.
- Status/Show/Impact/Check und ausdrückliches „nur prüfen“ bleiben lesend. Ein schneller Hinweis ist `last_known`, keine frische Entwarnung.
- Quellenprüfung, vollständige Schreibvalidierung, Lock, CAS und Journal dürfen nicht zugunsten der Effizienz entfallen. Keine verschachtelten Projektlocks, kein globaler Atomaritätsanspruch.
- Ungeprüfte Gespräche bestätigen keine Codebaseline. Anforderungen brauchen attestierte Nutzerentscheidung; Agentenschlussfolgerungen bleiben erkennbar unbestätigt.
- Keine Rohprompts, Quellkopien, privaten Repositorydaten oder Geheimnisse in Wissen, Logs, Fixtures oder Paketen. Lokale Zähler enthalten ausschließlich Zahlen und technische Zustände.
- Schema-1-Kompatibilität, bestehende fünf MCP-Werkzeuge und getrennte Codex-/Copilot-Pakete bewahren. Keine stille Migration oder Rechteausweitung durch Updates.
- Keine reale Plugininstallation, Telemetrie oder tatsächliche Agentenläufe ohne konkreten synthetischen Installations-/Testauftrag. Codex Desktop, Copilot CLI und Copilot App getrennt abnehmen.
- Docker Compose und Deploy Cockpit sind ausdrücklich ausgenommen; keine Container starten oder Deploymentkonfiguration ergänzen.
- Vor Ausführung isolierten Worktree gemäß `using-git-worktrees` erstellen oder geeigneten bestehenden Worktree verwenden. Vorhandene Arbeiten bewahren; eigene explizite Pfade committen. Keine Releases oder Tags durch diesen Plan.

## Review Focus

1. **Neue eingehende Beziehung in zuvor warmem Cache:** Ein Anbieter-Impact muss den neu hinzugefügten Verbraucher finden; sonst muss die Antwort ihren ungeprüften Umfang nennen. Tests in Tasks 5, 6 und 12.
2. **Rücknahme einer Verbindung zwischen Planung und Schreiben:** Die alte Freigabe darf keinen neuen Zugriff auf den fremden Checkout erlauben. Registerbindung unmittelbar vor Zugriff/Veröffentlichung prüfen; Tests in Tasks 4 und 9. Keine feindliche-OS-Atomarität behaupten.
3. **Identische Gesprächsaussage in zwei Turns:** Kein zweites Wissensdokument und keine kosmetische Datumsänderung; eine widersprechende Nutzerentscheidung muss dagegen erhalten bleiben. Tests in Task 8.
4. **Zielupdate veröffentlicht, Fortschrittsquittung fehlt nach Prozessabbruch:** Wiederaufnahme darf weder blind erneut anwenden noch eine noch fehlende Quellenbestätigung erfinden. Tests mit echten Prozessen in Tasks 7 und 9.
5. **Große Verbundmetadaten bei kleinstem MCP-Budget:** Kontrollierte Ablehnung vor Mutation oder fortsetzbares Ergebnis; niemals unvollständige Quellenbestätigung, Endlosschleife oder zu große Erfolgsquittung. Tests in Tasks 6 und 10.

## Struktur, gemeinsame Typen und Reihenfolge

Ein Plan reicht, weil Schema, Bindung, Index und Pflege denselben Vertrag implementieren und voneinander abhängen. Jede Aufgabe liefert einen separat prüfbaren Baustein; erst Task 10 verbindet die neuen APIs mit allen MCP-Einstiegen. Vorher keine vollständige Benutzerfunktion bewerben.

| Dateien | Verantwortung | Task |
| --- | --- | --- |
| `src/model/v2.ts`, `src/model/documents.ts`, `src/model/identity.ts` | Strikte Schema-2-Dokumente, versionierte Parser, qualifizierte Schlüssel | 1 |
| `src/diagnostics/work.ts` | Nicht persistierte Arbeitszähler | 2 |
| `src/storage/documents.ts`, vorhandene Storage-Dateien | Versionierte Snapshots, kleine Änderungssätze, gemeinsamer Transaktionskern | 2 |
| `src/project/upgrade.ts`, `src/cli/upgrade.ts` | Explizites CAS-geschütztes Upgrade | 3 |
| `src/project/connections.ts`, `src/project/source-access.ts`, `src/cli/connections.ts` | Lokale Roots, Rechte und reviewfähige Einrichtung | 4 |
| `src/query/traversal.ts`, `src/query/connected-index.ts`, vorhandene Query-Dateien | Eine Graphtraversierung und qualifizierte inkrementelle Indizes | 5 |
| `src/query/connected.ts`, `src/query/connected-pagination.ts` | Gestufter Abruf, Scope und Revisionsmengen | 6 |
| `src/freshness/connected.ts` | Quellen-/Entitätsprüfbelege statt Gesprächsbaseline | 7 |
| `src/memory/policy.ts`, `src/memory/delta.ts` | Lernmodus, kleine gebündelte Wissensänderungen, No-op | 8 |
| `src/memory/maintenance.ts` | Ein Ziel pro Update, begrenzte Wiederaufnahme | 9 |
| `src/mcp/connected.ts`, bestehende Tools/Server/Bootstrap | Fünf MCP-Werkzeuge zusammensetzen | 10 |
| vorhandene Adapter, Setup, Skills, Paket-/Nutzerdokumentation | Lernmodus und Hostgrenzen sichtbar machen | 11 |
| `bench/connected.ts`, `scripts/bench-connected.mjs`, synthetisches Validierungsprotokoll | Tatsächlicher Aufwand und unabhängiges fachliches Soll | 12 |

Namensvertrag: `ProjectId` ist eine strikt validierte UUID. `FeatureV1` entspricht unverändert dem bisherigen `Feature`; `FeatureV2` und `KnowledgeDocument` sind neue getrennte Typen. Bestehende Parser und Storage-Einstiege bleiben v1-kompatible Fassaden; neue APIs verwenden `FeatureDocument = FeatureV1 | FeatureV2` und `EditableDocument = FeatureDocument | KnowledgeDocument`. Kein stilles Normalisieren von Schema-2-Dateien zurück zu Schema 1.

Gemeinsame neue Typen, in den jeweils genannten Aufgaben zu exportieren:

```ts
// Task 1: src/model/identity.ts und src/model/documents.ts
type FeatureRef = { project: ProjectId; feature: string };
type StatementRef = { project: ProjectId; knowledge: string; statement: string };
type SourceRef = { project?: ProjectId; path: string; symbol?: string };
type QualifiedSourceRef = SourceRef & { project: ProjectId };
type SourceObservation = { project: ProjectId; path: string; hash: string }
  | { project: ProjectId; path: string; state: 'missing' };
type RevisionSet = Readonly<Record<ProjectId, string>>;
type EditablePath = `network-spec/${string}.yaml`;
type NetworkPath = EditablePath; // Runtime validation restricts actual accepted paths.
// Task 2: src/storage/documents.ts
interface ProjectSnapshot {
  meta: MetaV1 | MetaV2 | null;
  features: FeatureDocument[]; knowledge: KnowledgeDocument[];
  revision: string; fingerprints: Record<string, string>;
  diagnostics: Diagnostic[]; integrity: Snapshot['integrity'];
  validation: { structure: 'checked'; sources: 'all' | 'none' };
}
interface DocumentUpdate {
  expectedRevision: string; expected: Record<EditablePath, string | null>;
  upserts: EditableDocument[]; deletes: EditablePath[];
  sources: SourceObservation[];
}
type SourceReader = (ref: QualifiedSourceRef) => Promise<SourceObservation>;
interface DocumentStorageOptions extends StorageOptions {
  sourceReader?: SourceReader; meter?: WorkMeter;
  beforePublish?: () => Promise<void>; // Trusted Core only, never MCP/JSON.
}
```

`MetaV1` ist ein neuer Alias des bestehenden `NetworkMeta`-Typs, `MetaV2` stammt aus Task 1; `Snapshot`, `Diagnostic`, `StorageOptions`, `UpdateResult`, `Project` und `Fingerprint` sind bestehende Typen. Ein `NetworkPath` wird zur Laufzeit ausschließlich als Marker, rootnahe Featuredatei oder direkte `knowledge/<slug>.yaml` akzeptiert. Öffentliche Updates ändern den Marker nicht; Upgrade und ausdrückliche Initialisierung besitzen separate interne Wege. `WorkMeter` wird aus Task 2 importiert; alle Signaturen ohne ausgeschriebenen Projekttyp verwenden `Project` beziehungsweise die im selben Block definierte Binding-/Snapshot-Art.

Testhilfe ab Task 2: `projectV2(roots: string[], name: string): Promise<ProjectFixture>` in `tests/helpers/connected.ts`, mit `{project: Project, id: ProjectId, root: string, snapshot(): Promise<ProjectSnapshot>}`. Sie erzeugt nur temporäre echte Git-Repositories und synthetische `src/source.ts`-/Featuredateien. Task 4 ergänzt `connectedFixture(roots, {projects?: number, learning?: boolean})`, das `{active: ProjectFixture, projects: ProjectFixture[], binding: ConnectionBinding, sourceReader: SourceReader}` liefert; der Standard enthält drei Projekte. `revokeConnectionOnDisk(active: ProjectFixture, id: ProjectId): Promise<void>` ist eine Testhilfe, die den expliziten Registereintrag entfernt. Weitere Werte in den Testausschnitten sind lokal arrangierte Fixtures, keine zusätzlich vorausgesetzten Produktfunktionen. Alle Tests räumen ihre Roots und Prozesse auf.

## Task 1: Versionierte YAML-Dokumente und eindeutige Identitäten

**Files:** Create `src/model/{v2,documents,identity}.ts`, `tests/model/{v2,documents,identity}.test.ts`; modify `src/model/{schema,types}.ts`; test existing `tests/model/schema.test.ts`.

**Interfaces:** Produces the model types above, `parseNetworkDocument(text: string, path: NetworkPath): NetworkDocument`, `parseNetworkMeta(text: string): MetaV1 | MetaV2`, `documentPath(doc: EditableDocument): EditablePath`, `featureKey(ref: FeatureRef): string`. `NetworkDocument` is a marker or editable document. Existing `parseFeature`/`parseMeta` stay schema-1 parsers; reuse the safe YAML loader rather than copying it.

- [x] **Step 1 – Failing tests:** Pin spec examples and exact 65.536-byte UTF-8 limit, strict fields, true calendar dates as strings, filename matching, aliases/tags/duplicates, qualified refs and unknown schemas. Add `requirement_needs_user_statement`, `inference_stays_unconfirmed`, `supersedes_rejects_self_and_local_cycles`, and key-collision tests. Example assertions:

  ```ts
  expect(parseNetworkDocument(ideaYaml, 'network-spec/knowledge/roles.yaml'))
    .toMatchObject({kind: 'knowledge', features: []});
  expect(() => parseNetworkDocument(fabricatedDecisionYaml, knowledgePath)).toThrow();
  expect(featureKey({project: projectA, feature: 'access'}))
    .not.toBe(featureKey({project: projectB, feature: 'access'}));
  ```

- [x] **Step 2 – Red:** `npm test -- tests/model`; new tests fail on missing parsers/schema; existing v1 expectations remain unchanged.
- [x] **Step 3 – Implement:** Define strict `featureV2Schema`, `knowledgeSchema`, `metaV2Schema`; reuse safe YAML decoding. Knowledge has stable statement IDs, `origin`, `type`, `state`, `evidence`, `contradicts`, `supersedes`; features/relations accept `knowledge: StatementRef[]`. Normalize optional lists. Use JSON tuple keys rather than ambiguous string concatenation. Cross-document supersession cycles are checked at snapshot level in Task 2; external unresolved targets remain diagnostics.
- [x] **Step 4 – Green:** `npm test -- tests/model` and `npm run typecheck` pass; no changes to existing v1 fixture expectations.
- [x] **Step 5 – Commit:** Stage only the listed model/test files; commit `feat: define versioned project and knowledge documents`.

## Task 2: Gemeinsamer sicherer Dokumentspeicher und Arbeitszähler

**Files:** Create `src/storage/documents.ts`, `src/diagnostics/work.ts`, `tests/storage/{documents,knowledge-recovery,work-counters}.test.ts`, `tests/helpers/connected.ts`; modify `src/storage/{repository,journal,read-cache}.ts`, `src/project/root.ts`; test existing Storage/Project suites.

**Interfaces:** Consumes Task 1. Produces `readProjectSnapshot(project, options?: DocumentStorageOptions & {sourceMode?: 'all'|'none'}): Promise<ProjectSnapshot>`, `applyDocumentUpdate(project, request: DocumentUpdate, options?: DocumentStorageOptions): Promise<UpdateResult>`, and trusted internal `commitNetworkDocuments(project, expectedRevision: string, changes: Record<NetworkPath, string|null>, options?: DocumentStorageOptions): Promise<UpdateResult>`. `createWorkMeter(): WorkMeter` returns numeric counters named `metadataChecks`, `documentReadOps`, `documentBytes`, `yamlParses`, `sourceReadOps`, `sourceBytes`, `hashes`, `visitedFeatures`, `indexReplacements`, `knowledgeWrites`, `runtimeWrites`.

- [x] **Step 1 – Failing tests:** Real nested knowledge create/read/update/delete; metadata-mode read does not open product sources; old `readSnapshot`/`applyUpdate` fixtures are unchanged. Pin mixed-version rejection, local missing-target error versus external unresolved warning, manual edit CAS, cross-document supersession cycles and knowledge/source path separation. Add real process kill with a schema-2 journal and malicious nested paths/symlinks/FIFOs. Efficiency assertions:

  ```ts
  expect(secondRead.yamlParses).toBe(0);
  expect(secondRead.sourceReadOps).toBe(0);
  expect(secondRead.knowledgeWrites).toBe(0);
  expect(metadataSnapshot.validation.sources).toBe('none');
  ```

- [x] **Step 2 – Red:** `npm test -- tests/storage tests/project`; failures must show the missing versioned storage behavior, not permissions or runtime mismatch.
- [x] **Step 3 – Implement:** Extract one transaction engine used by legacy and new APIs. Capture only existing root YAML plus direct `knowledge/*.yaml`; version-2 journals accept exactly these paths, while version-1 journals remain readable. Cache envelopes bind schema/cache version, canonical root, exclusions and exact document hashes. Full writes validate the complete end state freshly, verify all upsert source references against supplied observations, and never treat external availability warnings as structural errors. Metadata reads expose limited validation; legacy reads retain their previous full checks. `beforePublish` may recheck trusted bindings without nested locks/Git/model calls. Recovery never creates semantic confirmation.
- [x] **Step 4 – Green:** `npm test -- tests/storage tests/project tests/model` and `npm run typecheck` pass, including existing process concurrency/recovery tests. Counters observe actual I/O boundaries and are neither persisted nor logged automatically.
- [x] **Step 5 – Commit:** Stage the listed storage/model-integration tests and source files; commit `feat: store schema two memory with guarded document transactions`.

## Task 3: Explizites und wiederaufnehmbares Schema-Upgrade

**Files:** Create `src/project/upgrade.ts`, `src/cli/upgrade.ts`, `tests/project/upgrade.test.ts`; modify `src/cli.ts`, `docs/installation.md`.

**Interfaces:** `planUpgrade(project: Project, identity: {id: ProjectId; name: string}): Promise<UpgradePlan>`, `applyUpgrade(plan: UpgradePlan): Promise<UpdateResult>`, `applyApprovedUpgrade(project, identity, receipt: string): Promise<UpdateResult>`. `UpgradePlan` is frozen with public preview/receipt and private in-process authorization, following the existing setup pattern.

- [x] **Step 1 – Failing tests:** `upgrade_preserves_v1_content`, `upgrade_rejects_changed_sources`, `upgrade_receipt_binds_identity_and_checkout`, `upgrade_recovers_partial_publication`, `upgrade_does_not_connect_or_enable_learning`, `second_upgrade_is_noop`. Preserve manual key points, feature IDs and string relations. Assert a fresh unrelated schema-2 identity cannot reuse an old receipt.
- [x] **Step 2 – Red:** `npm test -- tests/project/upgrade.test.ts`; fail on the missing explicit upgrade path.
- [x] **Step 3 – Implement:** Preview marker identity and document schema changes, preserving all semantic fields. CLI syntax: `upgrade --project-root <root> --project-id <uuid> --name <name> --dry-run`, then the same identity arguments with `--approve-and-apply <receipt>`. Identity is supplied identically to both calls, avoiding a newly generated UUID invalidating every receipt. Apply through Task 2's guarded transaction engine. Reject missing explicit identity, changes since preview, unknown versions and unsafe paths; never modify connections/host config or silently downgrade.
- [x] **Step 4 – Green:** `npm test -- tests/project tests/storage/knowledge-recovery.test.ts` and `npm run typecheck` pass. CLI process fixtures run Node 24 in temporary roots only; document the new entry as staged functionality until Task 10 integration.
- [x] **Step 5 – Commit:** Commit the listed upgrade/CLI/docs files as `feat: add reviewed schema two upgrade`.

## Task 4: Ausdrückliche Verbindungen und sichere Quellenauflösung

**Files:** Create `src/project/{connections,source-access}.ts`, `src/cli/connections.ts`, `tests/project/{connections,source-access}.test.ts`; extend `tests/helpers/connected.ts`; modify `src/cli.ts`, `docs/installation.md`.

**Interfaces:** `readConnections(active: Project): Promise<ConnectionBinding>`, `assertConnection(binding, id: ProjectId, operation: 'read_memory'|'read_source'|'write_memory'): Promise<Project>`, `createSourceReader(binding, options: StorageOptions & {meter?: WorkMeter}): SourceReader`. `ConnectionBinding` contains active project/ID, `revision`, `learningEnabled`, selected entries and diagnostics. `planConnections(active, proposed: ConnectionsConfig): Promise<ConnectionsPlan>` / `applyConnections(plan): Promise<void>` use the same opaque preview pattern.

- [ ] **Step 1 – Failing tests:** Register file `{schema:1, learning:{enabled:boolean}, projects:[{id,root,readSources,writeMemory}]}`; absent file means disabled learning and no external access without creating files. Test wrong/duplicate UUID, worktrees, moved/missing root, symlink swap, sensitive aliases, excluded installed-plugin roots and no A→B→C permission expansion. Pin late revocation:

  ```ts
  await revokeConnectionOnDisk(f.active, f.projects[1]!.id);
  await expect(assertConnection(f.binding, f.projects[1]!.id, 'write_memory'))
    .rejects.toMatchObject({code: 'connection_changed'});
  ```

- [ ] **Step 2 – Red:** `npm test -- tests/project/connections.test.ts tests/project/source-access.test.ts` fails on missing binding/permission checks.
- [ ] **Step 3 – Implement:** Revalidate register bytes and selected canonical identity on each access; no root in MCP arguments. Register-/Markerprüfung uses safe regular-file reads, never another project's locking snapshot API inside a target lock. Source reading uses existing safe relative-path/exclusion logic in the bound project. Memory reads are allowed only for registered projects; source reads and writes have separate booleans. A schema-1 active project remains standalone until explicit upgrade. CLI `connections --project-root <root> --config-file <file> --dry-run`, then `--approve-and-apply <receipt>` rechecks candidate file hash and all bindings; changes only active `.feature-network/connections.yaml`. No global settings or edits to counterpart projects. Maximum register file size is 65.536 UTF-8 bytes, using the safe YAML loader.
- [ ] **Step 4 – Green:** `npm test -- tests/project tests/storage/final-boundaries.test.ts` and typecheck pass. A permissions-disabled project cannot be opened through a stale cached reader; same-user hostile filesystem races remain outside the guarantee.
- [ ] **Step 5 – Commit:** Commit explicit connection/source-access changes and docs as `feat: bind selected local projects with separate memory rights`.

## Task 5: Eine Traversierung und inkrementeller Verbundindex

**Files:** Create `src/query/{traversal,connected-index}.ts`, `tests/query/{traversal,connected-index}.test.ts`; modify `src/query/{index,impact}.ts`; use Task 4 fixtures.

**Interfaces:** Extract `traverseImpact(graph: ImpactGraph, roots: string[], options: TraversalOptions): TraversalResult` from existing `queryImpact` without changing its v1 output. `ImpactGraph` provides entries/outgoing/incoming keyed by unambiguous strings; options contain direction, depth, maxVisitedFeatures and optional meter. `buildConnectedIndex(snapshots: ReadonlyMap<ProjectId, ProjectSnapshot>, registerRevision: string, meter?: WorkMeter): ConnectedIndex`, `refreshConnectedIndex(previous, snapshots, registerRevision, meter?): ConnectedIndex` normalize feature identities and maintain knowledge search separately.

- [ ] **Step 1 – Failing tests:** A/B/C have the same local ID; incoming and outgoing paths, evidence-first shortest paths, hypothesis propagation and cycles must remain correct. Assert removing an edge removes its inverse posting; same-name knowledge never replaces a feature. Pin `maxVisitedFeatures` 1.000/10.000 and explicit depth bounds. One changed document replaces exactly one entity:

  ```ts
  expect(meter.indexReplacements).toBe(1);
  expect(after.entries.get(unchangedKey)).toBe(before.entries.get(unchangedKey));
  expect(after.incoming.get(providerKey)).toContainEqual(expect.objectContaining({from: consumerKey}));
  ```

- [ ] **Step 2 – Red:** `npm test -- tests/query`; new tests fail while existing direction/seed-path tests remain meaningful.
- [ ] **Step 3 – Implement:** Share a single traversal algorithm between old and connected APIs. Route keys include node, origin/status as required to preserve deterministic evidence paths. Stable project-first selection and adjacency ordering; no transitive path materialization. Update only changed document entries and postings using immutable snapshot fingerprints. A memory-only knowledge edit does not rebuild every feature. Retain unresolved external edges as findings, not invented nodes.
- [ ] **Step 4 – Green:** `npm test -- tests/query tests/storage` and typecheck pass. Counters distinguish selected result count, visited features, route states and index replacements; an unknown unexplored match count is never reported as zero.
- [ ] **Step 5 – Commit:** Commit graph/index files and tests as `feat: index connected memory with shared bounded impact traversal`.

## Task 6: Gestufter Abruf, aktuelle eingehende Kanten und Fortsetzung

**Files:** Create `src/query/{connected,connected-pagination}.ts`, `tests/query/{connected,connected-pagination}.test.ts`; extend existing pagination helpers only where shared serialization requires it.

**Interfaces:** `readConnectedContext(binding: ConnectionBinding, request: ConnectedContextRequest, options: ConnectedQueryOptions): Promise<ConnectedResult>`, `readConnectedImpact(binding, request: ConnectedImpactRequest, options: ConnectedQueryOptions): Promise<ConnectedResult>`. Requests add `scope: 'active'|'connected'`, `projects?: ProjectId[]`, `freshness: 'last_known'|'returned_features'`, `maxProjects`, `maxVisitedFeatures`, qualified `features?: FeatureRef[]`, `knowledgeTypes?: ('idea'|'requirement'|'observation')[]`, existing query/detail/budget/cursor parameters. `ConnectedFreshness` is `Record<string, {state:'current'|'changed'|'missing'|'unknown'; review:'recorded'|'open'; resolution:'resolved'|'not_connected'|'unavailable'|'ambiguous'|'missing'}>`, keyed by qualified feature key. `ConnectedQueryOptions` extends DocumentStorageOptions with the trusted optional `readFreshness(refs: FeatureRef[]): Promise<ConnectedFreshness>` provider. `ConnectedResult` carries qualified items, `projectsExamined`, `projectsUnexamined`, `basis:'last_known'|'fresh_snapshots'`, `sourceFreshnessBasis`, `sourceValidationScope`, revision set, limits and nextCursor. `ConnectedCursor` binds register revision, selected project set, every participating network revision, request parameters and offsets.

- [ ] **Step 1 – Failing tests:** Warm hint reuses index with zero YAML parses/source reads/writes. Add an incoming consumer edge after warming the provider; a fresh impact must find it. Default project cap is eight; 16 projects require explicit enlargement. Test small budget, Unicode fragment reconstruction, partial project availability and invalid cursor after registry change or newly changed selected project. Assert `last_known` never yields current all-project clearance.
- [ ] **Step 2 – Red:** `npm test -- tests/query/connected.test.ts tests/query/connected-pagination.test.ts`; failures identify missing scoped retrieval/cursor behavior.
- [ ] **Step 3 – Implement:** Hints load summaries from bound snapshots/index without dumping the whole graph. Fresh impact refreshes all selected eligible project network snapshots up to maxProjects, including possible consumers with no outgoing provider link. Metadata checks can remain proportional to the selected YAML set and are measured. Source freshness is a separate callback stage supplied by Task 7, not a full-source read in graph construction. Before that integration, tests supply a typed fixture provider; a missing provider with requested returned-feature checks yields `freshness_unavailable`, never a fabricated confirmation. Providers are internal functions, not MCP fields. Source-mode metadata validation is visible in all results. Enforce all work/output caps and complete JSON/MCP reserve accounting; share Unicode pagination mechanics rather than duplicating them.
- [ ] **Step 4 – Green:** `npm test -- tests/query` and typecheck pass. Pagination retains the entire result's considered project revisions so previously unseen changes cannot be hidden by page boundaries. Too-large cursor metadata yields a bounded error, never an empty continuation loop.
- [ ] **Step 5 – Commit:** Commit retrieval/pagination files and tests as `feat: add staged connected context with honest freshness bounds`.

## Task 7: Quellengebundene fachliche Prüfbelege

**Files:** Create `src/freshness/connected.ts`, `tests/freshness/connected.test.ts`; modify existing freshness code only to share safe observation/decision helpers, preserving the v1 mapped/unmapped contract.

**Interfaces:** `inspectConnectedSources(binding, refs: QualifiedSourceRef[], options: DocumentStorageOptions): Promise<SourceObservation[]>`, `recordConnectedReview(binding, receipt: ConnectedReview, options): Promise<void>`, `readConnectedFreshness(binding, refs: FeatureRef[], options): Promise<ConnectedFreshness>`. `ConnectedReview` contains target project, target network revision, source observations, involved document fingerprints, observed `RevisionSet`, outcome `updated|no_semantic_change` and reason. Use the ConnectedFreshness type from Task 6 and supply this function as that task's trusted provider; no duplicate freshness shape.

- [ ] **Step 1 – Failing tests:** Changed/missing/reappearing source, missing decision cache, uncommitted bytes, target fingerprint change and branch/checkout changes open the right review. Pin `conversation_never_confirms_source`, `unavailable_external_reference_does_not_corrupt_local_structure`, `published_yaml_without_review_receipt_stays_open`, `unrelated_knowledge_edit_preserves_recorded_feature_review`. Preserve explicit-observations override and mapped/unmapped separation for old MCP calls.
- [ ] **Step 2 – Red:** `npm test -- tests/freshness/connected.test.ts tests/freshness/references.test.ts` fails on the new cross-project review behavior.
- [ ] **Step 3 – Implement:** Recheck register/target revision and observed bytes through Task 4 before recording; under the target lock verify its document fingerprints without acquiring another project lock. Runtime record format is strict/versioned and bounded; supplied project revisions are observed context, not an atomic global commit. Schema-2 historical review matching uses the involved document fingerprints plus source observations, so an unrelated knowledge edit does not erase it or promote it to fresh. Preserve v1's full-network-baseline rules. A source change after verification is detected by the next fresh observation, never called impossible. Missing source has an absence observation, no synthetic hash. Deleted/corrupt receipts remain unknown/open; cache/index loss cannot confirm semantics.
- [ ] **Step 4 – Green:** `npm test -- tests/freshness tests/storage` and typecheck pass. `last_known` reads do not hash product sources; `returned_features` reads only selected entities' required sources, with measured counts.
- [ ] **Step 5 – Commit:** Commit review/freshness source and tests as `feat: bind connected semantic reviews to inspected source versions`.

## Task 8: Gesprächslernen, Analysewissen und gebündelte No-op-Pflege

**Files:** Create `src/memory/{policy,delta}.ts`, `tests/memory/{policy,delta}.test.ts`; modify `src/commands/policy.ts` only for shared explicit-mode rules.

**Interfaces:** `memoryPolicy(input: MemoryPolicyInput): MemoryPolicyResult`, with input `{enabled:boolean, mode:CommandMode, explicitReadOnly:boolean, basis:'conversation'|'analysis'|'development'|'explicit_sync'}` and result `{writeMemory:boolean, confirmSources:boolean, forceContinuation:boolean}`. Conversation never grants source confirmation or forced continuation. `prepareMemoryDelta(snapshot: ProjectSnapshot, proposed: EditableDocument[], sources: SourceObservation[], reason: string): PreparedDelta|null`; `PreparedDelta` contains a Task 2 `DocumentUpdate`, changed document paths and deterministic `changeDigest`.

- [ ] **Step 1 – Failing tests:** Enabled conversation can record an idea/explicit decision; analysis without code edits can record source-backed knowledge. Disabled mode and explicit read-only block automatic writes; status/show/impact/check remain read-only regardless of enabled/basis. Group multiple findings into one project delta; test stable IDs and unchanged manual content. Pin review focus 3:

  ```ts
  expect(prepareMemoryDelta(snapshotWithSameDecision, [sameDecision], [], reason)).toBeNull();
  expect(memoryPolicy({enabled: true, mode: 'check', explicitReadOnly: false,
    basis: 'analysis'}).writeMemory).toBe(false);
  expect(conversationPolicy.confirmSources).toBe(false);
  ```

- [ ] **Step 2 – Red:** `npm test -- tests/memory tests/commands/policy.test.ts`; no feature-edit implementation before the policy tests fail for the expected reason.
- [ ] **Step 3 – Implement:** Preserve explicit init/sync paths and product-work authorization. Policy fields are trusted orchestration context/agent attestations, not a cryptographic proof of user intent; arbitrary repository text cannot change configuration. Semantic deduplication is the agent's work: the Core compares stable IDs and normalized documents, never merges by text similarity alone. Suppress timestamp-only/format-only rewrites and return null before any maintenance receipt or knowledge write. Flush relevant findings at completed analysis sections and turn end, not every source read. A different decision uses supersedes and retains the old statement; reject silent overwrites masquerading as deduplication.
- [ ] **Step 4 – Green:** `npm test -- tests/memory tests/commands tests/model` and typecheck pass. Repetition test compares stored bytes and counters; no new YAML or hidden baseline updates.
- [ ] **Step 5 – Commit:** Commit policy/delta files and tests as `feat: learn from scoped conversations without redundant memory writes`.

## Task 9: Ein Ziel pro Schreibzugriff und ehrliche Wiederaufnahme

**Files:** Create `src/memory/maintenance.ts`, `tests/memory/{maintenance,maintenance-process}.test.ts`, `tests/helpers/maintenance-worker.ts`.

**Interfaces:** `applyMemoryDelta(binding: ConnectionBinding, target: ProjectId, delta: PreparedDelta, context: MaintenanceContext, options: DocumentStorageOptions): Promise<MaintenanceReceipt>`. Context includes policy input, optional `operationId` and expected operation revision; receipt contains operation ID/revision, target revision, `publication: 'applied'|'already_present'`, `review: 'recorded'|'open'` and bounded diagnostics. `readMaintenance(active: Project, operationId: string): Promise<MaintenanceProgress|null>` is read-only; `resumeMemoryDelta` has the same inputs as apply plus a required operation ID and fresh progress revision. Runtime key is `maintenance/<uuid>` under existing `values/` storage.

- [ ] **Step 1 – Failing tests:** Denied target writes, unknown UUID, altered register after preparation, concurrent deltas, manual edits and invalid progress. Kill a real worker after target publication but before active receipt, and again before semantic confirmation. Assert original YAML is never blindly overwritten, source reviews stay open until actually recorded and readMaintenance never performs recovery. Applying an empty/no-op delta creates no receipt.
- [ ] **Step 2 – Red:** `npm test -- tests/memory/maintenance.test.ts tests/memory/maintenance-process.test.ts` fails at the new coordinator boundary.
- [ ] **Step 3 – Implement:** Persist prepared progress under the active lock, release it, update exactly one bound target under its lock, release it, then record progress under the active lock. Recheck register/rights immediately before target publication using a trusted no-lock guard. Progress stores IDs, revisions and digests, no raw prompts, source contents or executable work. After interruption, resupplied identical intent and actual target fingerprints determine already-present state; any mismatch requires re-read/replanning. Target content present does not prove a review was recorded. Source confirmation from Task 7 is separate and may remain open. Serialize each operation by runtime CAS without claiming multi-repository atomicity.
- [ ] **Step 4 – Green:** `npm test -- tests/memory tests/storage/concurrency.test.ts tests/storage/recovery.test.ts` and typecheck pass. Assert no simultaneous project locks using the worker's bounded event trace; traces contain only synthetic phase IDs.
- [ ] **Step 5 – Commit:** Commit maintenance implementation/process fixtures as `feat: coordinate recoverable memory updates across selected projects`.

## Task 10: Fünf MCP-Werkzeuge und Schema-2-Bootstrap integrieren

**Files:** Create `src/mcp/connected.ts`, `tests/mcp/connected.test.ts`, `tests/bootstrap/knowledge.test.ts`; modify `src/mcp/{server,tools}.ts`, `src/bootstrap/{inventory,state}.ts`, `src/cli.ts`, `docs/mcp.md`.

**Interfaces:** `handleConnectedTool(name: ToolName, input: unknown, binding: ConnectionBinding, options: DocumentStorageOptions): Promise<CallToolResult>` composes Tasks 6–9. Add optional project/scope/qualified selectors to existing tools; strict legacy update shape is retained. Schema-2 memory updates use an explicit `kind:'memory'` discriminator containing target project, PreparedDelta's editable changes, purpose/basis and operation tokens; source review is an optional separate block. No rootpaths/callbacks/connection edits accepted. `network_bootstrap` keeps its existing action set and operates only on the active project.

- [ ] **Step 1 – Failing tests:** Separate real SDK server process still lists exactly five tools. Preserve all legacy requests and rejection of root switching. Pin knowledge-only conversation update with zero sources, analysis update requiring hashes, one registered external target, denied root and corrupted receipt. Context distinguishes ideas/requirements/code; check summary is last_known and full is fresh. Tests reject overflow before publication and reconstruct complete Unicode fragments. Bootstrap on schema 2 preserves all knowledge bytes and maps only actual features/code slices.
- [ ] **Step 2 – Red:** `npm test -- tests/mcp/connected.test.ts tests/bootstrap/knowledge.test.ts tests/mcp/stdio.test.ts`; new tests fail on missing tool routing/schemas.
- [ ] **Step 3 – Implement:** Read the active marker/register and dispatch versioned calls through the same shared algorithms. Plain ids still mean active-project IDs; cross-project callers use FeatureRef objects, never ambiguous display names. Defaults: context hints use last_known in the new path; impact uses fresh network snapshots and returned-feature source checks. Legacy v1 result shapes remain unchanged. Preflight complete serialized MCP receipts including min/max metadata before any write. Initialization remains explicit; schema-2 init creates a real first feature, never a placeholder for an idea. Adapt bootstrap to versioned snapshots while preserving its CAS/package/source protocol and knowledge documents.
- [ ] **Step 4 – Green:** `npm test -- tests/mcp tests/bootstrap tests/query tests/freshness tests/commands` and `npm run typecheck` pass. Run the complete `npm test` once after the integration; a failure or hang remains a failure/limitation, not an inferred pass from targeted tests.
- [ ] **Step 5 – Commit:** Commit integrated MCP/bootstrap contracts and docs as `feat: expose connected memory through the existing MCP tools`.

## Task 11: Lernmodus, Hostadapter, Skills und Paketverträge

**Files:** Modify `src/adapters/{codex,copilot,setup}.ts`, `src/cli.ts`, all relevant `plugin/skills/feature-network*/SKILL.md`, matching skill metadata only when required, `README.md`, `AGENTS.md`, `docs/{adapters,installation}.md`, `docs/validation/host-matrix.md`; extend `tests/adapters/{codex,copilot,setup,runtime,process}.test.ts`, `tests/commands/{policy,skills}.test.ts`, `tests/package/package.test.ts`.

**Interfaces:** Existing `handleCodexEvent`, `handleCopilotEvent`, `planSetup` retain their signatures; they use Task 4 bindings and Task 8 policy internally. Learning enable/disable is written only by the explicit connections/setup preview. Hook start/stop use bound host evidence for any existing forced continuation; conversation-only learning does not acquire a fabricated turn proof.

- [ ] **Step 1 – Failing tests:** Old installations do not enable learning or add roots after an update. A configured conversation/analysis can preserve new knowledge without a code diff through the active Skill/MCP workflow. Hook alone never interprets/persists raw prompt text or triggers full analysis. Read-only commands create no sessions/recovery/write continuation. Preserve Codex's one-continuation guards and Copilot's lack of a reliable turn-ID guarantee. Assert short hook guidance does not include full network/knowledge text or developer paths.
- [ ] **Step 2 – Red:** `npm test -- tests/adapters tests/commands tests/package/package.test.ts`; only new capability/contract cases should fail before implementation.
- [ ] **Step 3 – Implement:** Update skill guidance: summaries first, direct roots, incoming/outgoing consumers, scoped code reading, statement provenance, grouped delta, no-op and explicit unresolved findings. Preserve the original coding/testing task; memory permissions never withdraw product-work authorization. No full graph injection or prompt archives. Keep metadata-driven host menus and six existing user commands. Document reviewed upgrade/connections, last_known limitations, freshness costs and read/write boundaries. Update AGENTS to describe actual implemented stages; host matrix retains unexecuted native checks as open.
- [ ] **Step 4 – Green:** `npm test -- tests/adapters tests/commands tests/package/package.test.ts`, `npm run typecheck`, `npm run build`, `npm run verify:package` pass. Both plugin distributions contain identical runtime/skill sources and no real local registry or project memory. No real host is installed or restarted by these checks.
- [ ] **Step 5 – Commit:** Commit reviewed explicit adapter/skill/docs/test paths as `feat: integrate scoped connected learning into host workflows`.

## Task 12: Effizienz und fachliche Wirkung unabhängig nachweisen

**Files:** Create `bench/connected.ts`, `scripts/bench-connected.mjs`, `tests/bench/{connected,connected-report}.test.ts`, `tests/validation/connected-scenario.test.ts`, `docs/validation/connected-project-memory-protocol.md`; modify `package.json`, `docs/validation/benchmark-protocol.md`. Test fixtures remain synthetic temporary Git repositories. Do not commit a fabricated live report.

**Interfaces:** `runConnectedBenchmark(options: {projects: 1|4|16; featuresPerProject: 100|1000; degree: 2|12; samples: number}): Promise<ConnectedBenchmarkReport>`. Report includes actual source/bundle binding, effective limits, cache mode, every timing sample, median/p95, I/O/parse/hash/index/write counters, output bytes, observed memory, and missing-cost explanations. Add `npm run bench:connected` for the full declared matrix with five samples per declared phase; the unit suite uses one sample and the smallest declared fixture without timing thresholds. Reject nonpositive/noninteger samples. Existing comparison records keep measured tokens null unless real host evidence exists; five-sample p95 is a limited local observation, not a robust cross-host latency claim.

- [ ] **Step 1 – Failing tests:** Pin warm hint parse/source/write counts at zero; one document edit replaces one index entry; idea-only conversation has no additional analytical source reads and no baseline confirmation, while mandatory write-validation reads remain measured; grouped findings cause one authoritative project transaction. Fresh provider impact discovers a newly added incoming edge. A capped 16-project run names unexamined projects, while explicit maxProjects 16 includes all. Report rejects invented/negative samples and never labels omitted source/agent work as zero measured cost.
- [ ] **Step 2 – Red:** `npm test -- tests/bench/connected.test.ts tests/bench/connected-report.test.ts tests/validation/connected-scenario.test.ts` fails for the missing measured pipeline.
- [ ] **Step 3 – Implement:** Measure actual temporary filesystem loading, YAML/cache checks, index work and serialization; separate first load, warm hint, fresh impact, one document/source edit and grouped maintenance. Preserve existing loaded-core benchmark as a different measurement. Run matrix 1/4/16 × 100/1.000 × degree 2/12 with actual configured budgets and all samples. Source reads, metadatastats and schema/CAS checks are counted at real boundaries, not inferred from fixture size.
- [ ] **Step 4 – Validate quality:** Add an independent oracle fixture outside candidate roots with A-provider, B-consumer and C-indirect consumer. Test contract-change impact, discussion-only decision, no-code-change source analysis, interrupted maintenance, unavailable consumer and preserved manual point. Scenario tests are scripted integration evidence, not actual agent success. The native-host protocol defines frozen starts, fresh sessions, baseline/plugin arms, actual tool events and separate init/task/maintenance costs; leave live runs pending without the required concrete authorization. Primary pass requires every held-out behavior/graph check; token/time gains are secondary and unknown tokens stay null.
- [ ] **Step 5 – Final verification and commit:** Run `npm test`, `npm run typecheck`, `npm run build`, `npm run verify:package`, `npm run bench:connected`, and `git diff --check`. Record commands, exit status and actual report scope; do not rerun expensive successful checks without a change/failure. Commit the benchmark/protocol/meaningful final docs as `test: measure connected memory cost and independent behavioral coverage`. Publish no release, tag or unsupported performance claim.

## Plan-Selbstprüfung und Ausführungshandoff

Zuordnung zur Spezifikation: Abschnitte 1–3 → Tasks 1/4/10/11; Abschnitt 4 → Tasks 1–4; Abschnitt 5 → Tasks 1/2/7/8; Abschnitt 6 → Tasks 1/4–7; Abschnitt 7 und 7.1 → Tasks 2/5/6/8/12; Abschnitt 8 → Tasks 7–11; Abschnitt 9 → Tasks 2/4/7/9; Abschnitt 10 → Tasks 4/8/10/11; Abschnitt 11 → Tasks 1–3; Abschnitt 12 → alle Tasktests und Task 12; Abschnitt 13 → Global Constraints und diese Handoffgrenze.

Nutzerreview von Plan und Effizienzergänzung ist erfolgt; gewählt wurde Native mit unabhängigem Abschlussreview. Die Schnittstellenblöcke sind der Namensvertrag zwischen Tasks; bestehende Typ-/Exportsignaturen wurden aus den aktuellen Quellen abgeleitet. Das sind geplante APIs, keine Behauptung vorhandener Implementierung.

Nach Freigabe wählt der Nutzer eine Ausführungsmethode:

- **Native:** Derselbe Agent führt die Tasks mit ihren TDD-Prüfungen aus; anschließend unabhängiger Gesamtbranchreview. Weniger Kontextübergaben, dafür keine unabhängige Reviewinstanz nach jedem Task.
- **Mit Subagenten:** Je Task ein frischer Implementierer und Reviewer, anschließend Gesamtbranchreview. Mehr unabhängige Prüfung der Speicher-/Zugriffsgrenzen, mit zusätzlichem Kontext- und Reviewaufwand.

Empfehlung: Native Ausführung mit unabhängigem Abschlussreview, weil die zwölf Tasks stark auf denselben versionierten Schnittstellen aufbauen. Die sicherheitskritischen Tests sind verbindlich, unabhängig von der gewählten Methode. Eine abweichende Nutzerwahl hat Vorrang; vor Planreview und Methodenwahl wird kein Produktcode geändert.

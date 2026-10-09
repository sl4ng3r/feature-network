# FeatureNetwork v1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ein lokales Plugin mit fachlichem Feature-Gedächtnis, wiederaufnehmbarer Projektanalyse und sechs nutzbaren Befehlen für Codex Desktop, Copilot CLI und Copilot App liefern.

**Architecture:** Ein gemeinsamer TypeScript-Kern validiert YAML, schützt Projektreferenzen, führt Graphabfragen aus und verwaltet lokale Transaktionen sowie Analysefortschritt. STDIO-MCP und kleine Hook-Adapter verwenden denselben Kern. Die fachliche Interpretation erfolgt durch den bestehenden Hostagenten; der Kern ruft kein Modell auf.

**Tech Stack:** Node.js 24 LTS, TypeScript mit strikter Typprüfung, npm/Lockfile, `yaml`, Zod 4, offizielles MCP-SDK v2 (`@modelcontextprotocol/server`; Client nur für Tests), Vitest und esbuild für gebündelte ESM-Einstiege. Demo mit `node:sqlite`, ohne zusätzliche Datenbankabhängigkeit. Konkrete stabile Dependency-Versionen bei Umsetzung prüfen und im Lockfile festlegen. [Offizielles SDK: Pakete und v2](https://github.com/modelcontextprotocol/typescript-sdk).

**Spec:** [Freigegebene Designspezifikation](../specs/2026-10-09-featurenetwork-v1-design.md). Stand: schriftliche Freigabe und Abschlussprüfung am 2026-10-09. Der Plan wartet auf Review und Auswahl der Ausführungsmethode; keine Umsetzung ist begonnen.

## Global Constraints

- Zielumgebungen: OpenAI Codex in der lokalen Mac-App, GitHub Copilot CLI und GitHub Copilot App; getrennte Live-Nachweise.
- Docker Compose und Deploy Cockpit entfallen ausdrücklich vollständig.
- Runtime: Node.js 24 LTS; Node wird vorausgesetzt, JavaScript samt Laufzeitbibliotheken vorgebaut geliefert.
- `network-spec/`: eine YAML-Datei pro Feature plus `_meta.yaml`; `schema: 1`, `coverage: partial`.
- Pflichtfelder: `schema`, `id`, `summary`, `key_points`, `code`; Feature-ID entspricht Dateiname, mindestens eine zulässige bestehende Referenz.
- Relationstypen: `depends_on`, `reads`, `writes`; Status `evidenced` mit Quelle oder `hypothesis`.
- Standardabfragen: höchstens zwei Beziehungsschritte, zwanzig Features und 12.000 UTF-8-Bytes; Einschränkungen und Fortsetzung sichtbar.
- Initialisierung: höchstens zwanzig Dateien und 64 KiB vorgesehene Textmenge pro Paket, sequentiell, wiederaufnehmbar.
- Pro Feature höchstens 64 KiB; keine unbekannten Schemafelder, ausführbaren YAML-Tags oder unbegrenzten Aliasexpansionen.
- Schreibziele des Kerns nur `network-spec/` und `.feature-network/`; keine Produktcodeänderungen durch Initialisierung.
- `status`, `show`, `impact`, `check` verändern keine Feature-Dateien, bestätigten Baselines oder Analysecheckpoints; keine fachliche Codeanalyse durch diese Befehle.
- Keine eigene KI-API, Cloud oder Telemetrie; keine privaten Inhalte in Fixtures, Logs, Benchmarks oder Releases.
- Release erst mit ausgewählter Lizenz und konkreter Veröffentlichungsanweisung; `origin` ist `git@github.com:sl4ng3r/feature-network.git`.

## Review Focus

1. Projekte mit Leerzeichen, Unicode und Symlinks: keine falsche Rootbindung oder Shellausführung; Tests in Task 2 und 10.
2. Manuell beschädigtes YAML bei vorhandenem Cache: Diagnose sichtbar, keine Entwarnung oder stiller Datenverlust; Tests in Task 1, 3 und 4.
3. Absturz zwischen Feature-Schreibzugriff und Checkpoint: erhaltene Features, Paket erneut offen, keine falsche Fertigmeldung; Tests in Task 3 und 6.
4. Branchwechsel und Commit während einer Session: keine verlorenen Änderungen oder wiederverwendeten fremden Analysebestätigungen; Tests in Task 5 und 6.
5. Lesender Nutzerbefehl mit aktiven Stop-Hooks: kein Pflegezwang, kein Wiederherstellungsschreibzugriff und keine Hook-Schleife; Tests in Task 9 und 10.

## Dateien und Zuständigkeiten

Ein npm-Paket, keine Workspaces. Tests liegen nach Verantwortung unter `tests/`; alle Fixtures synthetisch, Dateisystemtests in temporären Verzeichnissen.

| Pfade | Verantwortung |
| --- | --- |
| `src/model/{schema,types,errors}.ts` | Datenvertrag, Fehlercodes und normalisierte Typen |
| `src/project/{root,paths,git}.ts` | Rootbindung, Pfadschutz und feste Git-Operationen |
| `src/storage/{repository,lock,journal,runtime}.ts` | Snapshots, atomare Updates, Recovery und lokale Zustände |
| `src/query/{index,search,impact,pagination}.ts` | Deterministische Auswahl, Graphpfade und Bytebudgets |
| `src/freshness/{references,session,check}.ts` | Bestätigte Baselines, Änderungsstand und Diagnose |
| `src/bootstrap/{inventory,batches,state}.ts` | Quelleninventar, Pakete und revisionsgebundener Fortschritt |
| `src/mcp/{tools,server}.ts`, `src/cli.ts` | Fünf MCP-Tools und Programmeinstieg |
| `src/commands/policy.ts` | Befehlsnamen und lesende/schreibende Ausführungspolitik |
| `src/adapters/{codex,copilot,hook-main,setup}.ts` | Hook-Verträge, Projektstart und überprüfbare Setup-Vorschläge |
| `plugin/` | Manifest, MCP, sieben Skills, Hookkonfigurationen und gebaute Einstiege |
| `demo/{src,tests,network-spec}/` | Profil, JSON-Backup, Restore und fachliches Sollnetzwerk |
| `scripts/{build-plugin,verify-package,release}.mjs` | Reproduzierbares Paket und Releasevorbereitung |
| `bench/{core,comparison}.ts`, `docs/validation/` | Messungen und klar bezeichnete Hostabnahmen |

## Task 1: Feature-Vertrag mit lauffähiger Testbasis

**Files:** Create `package.json`, `package-lock.json`, `tsconfig.json`, `vitest.config.ts`, `.node-version`, `.gitignore`, `src/model/{schema,types,errors}.ts`, `tests/model/schema.test.ts`, `tests/helpers/fixture.ts`. Modify `AGENTS.md` für tatsächlich verfügbare Befehle.

**Interfaces:** Produces `parseFeature(text: string, filename: string): Feature`, `parseMeta(text: string): NetworkMeta`, `NetworkError(code, message, paths)`. Exportiert `Reference {path, symbol?}`, `Relation {to, type, status, evidence, when?, check?}`, `Hypothesis {text, evidence}`, `Feature` und `NetworkMeta`. Optionale Listen werden normalisiert; Typen aus demselben Schema ableiten.

Gemeinsame primitive Verträge in `types.ts`: `Fingerprint = string` (SHA-256-Hex), `VerifiedReference {path: string, hash: Fingerprint}`, `Diagnostic {code: string, path?: string, message: string, severity: 'error' | 'warning'}`. Erweiterte Laufzeittypen werden im jeweils produzierenden Modul exportiert. `UpdateRequest.expected` ist `Record<string, Fingerprint | null>`, Upserts sind `Feature[]`, Löschungen Feature-IDs; Resultate geben neue Revision/Fingerprints und Diagnostics zurück.

- [ ] **Step 1:** Testbasis konfigurieren und folgende fehlschlagende Tests schreiben: `valid_backup_roundtrip`, `rejects_unknown_schema_and_fields`, `rejects_id_filename_mismatch`, `rejects_duplicate_yaml_keys_tags_aliases`, `rejects_over_65536_utf8_bytes`, `allows_empty_key_points`, `requires_evidence_for_evidenced_relation`. Kernaussagen: `parseFeature(valid, 'backup.yaml').id === 'backup'`; 65.537 Bytes und `schema: 2` ergeben `invalid_schema`.
- [ ] **Step 2:** `npm test -- tests/model/schema.test.ts` ausführen; erwartetes Rot entsteht durch fehlende Parserimplementierung, nicht fehlende Testwerkzeuge.
- [ ] **Step 3:** Strikte Datenvalidierung und begrenztes YAML-Parsing implementieren. Metadaten erlauben nur dokumentierte Abdeckungs-/Bereichshinweise. npm-Skripte `test`, `typecheck`, `build`, `verify:package`, `bench:core` definieren; Build-/Prüfskripte erst durch die zuständigen Tasks bereitstellen.
- [ ] **Step 4:** `npm test -- tests/model/schema.test.ts` und `npm run typecheck` müssen erfolgreich sein; Testfixture enthält keinerlei persönliche Daten.
- [ ] **Step 5:** Zusammenhängende Dateien committen: `feat: validate FeatureNetwork YAML contracts`.

## Task 2: Sichere Projektbindung und Referenzauflösung

**Files:** Create `src/project/{root,paths,git}.ts`, `tests/project/{root,paths,git}.test.ts`.

**Interfaces:** Consumes `Reference`, `NetworkError`. Produces `openProject(root: string): Promise<Project>`, `resolveProjectPath(project: Project, relative: string): Promise<string>`, `discoverHookProject(cwd: string): Promise<Project | null>`, `readGitState(project: Project): Promise<GitState>`. `Project` enthält kanonischen Root sowie daraus abgeleitete Netzwerk-/Laufzeitpfade. `GitState` enthält HEAD, staged/unstaged/untracked Pfade und einen ausdrücklichen Verfügbarkeitsstatus.

- [ ] **Step 1:** Tests `rejects_absolute_traversal_and_external_symlinks`, `rejects_symlinked_storage_directories`, `handles_unicode_spaces_and_missing_reference`, `finds_nearest_marker_without_crossing_checkout`, `rejects_ambiguous_roots`, `does_not_execute_git_path_as_shell`, `reports_unavailable_git`. Assertion: `../outside` und Symlink zu fremdem Root ergeben `unsafe_path`; fehlende zulässige Referenz wird als fehlend diagnostiziert, nicht als unsicherer Pfad.
- [ ] **Step 2:** `npm test -- tests/project` muss an fehlenden Funktionen scheitern.
- [ ] **Step 3:** Kanonischen Root und Eltern realpath/lstat prüfen, Windows-/POSIX-Pfade behandeln. Git ausschließlich via `spawn`/`execFile` mit Argumentarrays und erlaubten Operationen; NUL-getrennte Pfadlisten lesen. Fehlendes Git liefert eine diagnostische Grenze, keine erfundene leere Änderungsmenge. Vor Markerexistenz bleibt der explizite MCP-Root maßgeblich.
- [ ] **Step 4:** `npm test -- tests/project` und `npm run typecheck` erfolgreich; Testverzeichnisnamen enthalten Leerzeichen und Unicode.
- [ ] **Step 5:** Commit `feat: bind projects and protect filesystem references`.

## Task 3: Konsistente Snapshots und wiederherstellbare Updates

**Files:** Create `src/storage/{repository,lock,journal,runtime}.ts`, `tests/storage/{repository,concurrency,recovery}.test.ts`, `tests/helpers/storage-worker.ts`.

**Interfaces:** Consumes `Project`, Parser, Referenzauflösung. Produces `readSnapshot(project): Promise<Snapshot>`, `applyUpdate(project, request: UpdateRequest): Promise<UpdateResult>`, `readRuntime<T>(project, key): Promise<T | null>`, `writeRuntime<T>(project, key, expectedRevision, value): Promise<void>`. `Snapshot {revision, features, diagnostics, fingerprints, integrity}`; `UpdateRequest {expected, upserts, deletes, verifiedReferences, initialize?}`. Erwartete Fingerprints enthalten `null` für neue Dateien. `verifiedReferences` trägt Pfad und tatsächlich gelesenen Hash, keine bloße Prüfbehauptung.

- [ ] **Step 1:** Tests `conflict_preserves_manual_edit`, `validates_whole_end_state`, `initializes_marker_with_first_feature`, `invalid_file_is_visible`, `read_during_write_never_mixes_states`, `read_with_journal_does_not_recover`, `crash_recovers_on_next_write`, `external_edit_blocks_recovery`, `dead_owner_reclaimed_unknown_owner_not_removed`, `runtime_is_git_ignored_without_changing_repo_config`. Nach Crash dürfen Leser nur `pending_recovery` liefern; keine teilweise bestätigten Baselines.
- [ ] **Step 2:** `npm test -- tests/storage` muss rot sein; parallele Tests starten echte separate Node-Prozesse.
- [ ] **Step 3:** Gesamtzustand validieren, kurzen exklusiven Lock für Snapshotübernahme und Updates verwenden, bounded retries (zwei Einlesewiederholungen, Lockwartezeit höchstens zwei Sekunden). Owner anhand Prozess-/Hostidentität prüfen; unklar ergibt `lock_busy`. SHA-256 für Inhaltsstände. Journal mit Ausgangs-/Zielständen, Tempdateien und Rename; bestätigte Baselines nur nach überprüfter Featuretransaktion speichern. Crash davor lässt Baselines unbestätigt. Lokale `.gitignore` nur neu anlegen, bestehende bewahren; getrackte Laufzeitdaten melden. Manuelle Änderungen sind Konflikte, kein automatisches Löschen.
- [ ] **Step 4:** `npm test -- tests/storage tests/project tests/model` erfolgreich, inklusive gezielt injizierter Abstürze vor/nach Rename und vor Baselinespeicherung. Keine unbeschränkte Lockwarteschleife.
- [ ] **Step 5:** Commit `feat: persist network updates with conflict-safe recovery`.

## Task 4: Deterministische Suche, Impact und Fortsetzung

**Files:** Create `src/query/{index,search,impact,pagination}.ts`, `tests/query/{search,impact,pagination}.test.ts`.

**Interfaces:** Consumes `Snapshot`, Modelltypen. Produces `buildIndex(snapshot): NetworkIndex`, `refreshIndex(index, snapshot): NetworkIndex`, `queryContext(index, request: ContextRequest): ContextResult`, `queryImpact(index, request: ImpactRequest): ImpactResult`. Requests enthalten optionale IDs/Pfade/Query, Detailstufe, Bytebudget und Cursor; Impact zusätzlich Richtung/Tiefe/Limit. Resultate enthalten revision, diagnostics, integrity, items, truncated, omitted und optional nextCursor. Cursor bindet Offset und ursprüngliche Query an Snapshotrevision.

- [ ] **Step 1:** Tests `id_path_and_text_rank_stably`, `normalizes_unicode`, `queryless_overview_pages_ten`, `both_directions_find_backup_and_restore`, `cycles_terminate`, `hypothesis_path_stays_hypothesis`, `defaults_depth_two_limit_twenty_budget_12000`, `oversized_feature_has_visible_continuation`, `changed_revision_rejects_cursor`, `broken_feature_marks_incomplete_results`, `incremental_refresh_replaces_only_changed_features`, `manual_edit_invalidates_cached_index`. Assertion: Profiländerung erreicht Backup und Restore; jede Antwort bleibt innerhalb ihres UTF-8-Bytebudgets einschließlich Metadaten.
- [ ] **Step 2:** `npm test -- tests/query` muss rot sein.
- [ ] **Step 3:** Text-/Pfad-/Adjazenzindizes, stabile BFS mit Besuchsmenge und nachvollziehbaren Kantenpfaden implementieren. Belegte Wege vor Hypothesen, keine Zustandsaufwertung durch indirekten Pfad. Detailabschnitte in begrenzten Stücken; Cursor nach Standwechsel `stale_cursor`. Eingaben begrenzen: Tiefe 0–8, Limit 1–100, Antwortbudget 512–64.000 Bytes; zu kleine/unzulässige Werte liefern validierte Eingabefehler. Ungültige Netzwerkmarker blockieren Abfragen.
- [ ] **Step 4:** `npm test -- tests/query tests/storage` und `npm run typecheck` erfolgreich; keine unmarkierten Kürzungen.
- [ ] **Step 5:** Commit `feat: query feature context and explain change impact`.

## Task 5: Aktualität und Arbeitsdurchläufe

**Files:** Create `src/freshness/{references,session,check}.ts`, `tests/freshness/{references,session,check}.test.ts`.

**Interfaces:** Consumes Projekt-/Speicher-/Git-Verträge. Produces `startTurn(project, sessionId: string): Promise<TurnState>`, `checkNetwork(project, mode: 'summary' | 'full', sessionId?: string): Promise<CheckResult>`, `confirmReferences(project, refs: VerifiedReference[]): Promise<void>`. Bestätigungen laufen ausschließlich im schreibenden Pflegepfad. `CheckResult` enthält Fehler/Warnungen, bekannte Referenzzustände `changed|missing|unknown`, unbekannte Änderungsdateien, lastCheckedAt und offene Prüfentscheidungen.

- [ ] **Step 1:** Tests `fresh_clone_starts_unknown`, `full_check_does_not_confirm_hash`, `summary_is_labelled_last_known`, `committed_mid_turn_is_still_changed`, `preexisting_edits_are_separate`, `branch_switch_invalidates_turn_assumptions`, `unchanged_semantics_can_confirm_without_yaml_write`, `source_changed_after_agent_read_remains_unconfirmed`, `ignores_runtime_and_build_outputs`, `git_failure_is_reported`. Assertion: Prüfaufruf allein verändert keinen bestätigten Referenzhash; Bestätigung muss zum tatsächlich beobachteten Quellstand passen.
- [ ] **Step 2:** `npm test -- tests/freshness` muss rot sein.
- [ ] **Step 3:** Inhaltsfingerprints und Sessionanfangsstände getrennt halten. Git-Änderungen mit Referenzständen kombinieren, bereits committete Turnänderungen berücksichtigen. Laufzeit-/Buildausschlüsse prüfen; keine globale Codelektüre pro Prompt. Revisionsgebundene Prüfentscheidungen sind `updated` oder `no_semantic_change` mit begründeter Agentenentscheidung; allein gleiche Hashes bestätigen keine Vollständigkeit.
- [ ] **Step 4:** `npm test -- tests/freshness tests/storage` erfolgreich; reale temporäre Git-Repositories einschließlich Commits während einer Session verwenden.
- [ ] **Step 5:** Commit `feat: track reference freshness and session changes`.

## Task 6: Begrenzte, wiederaufnehmbare Initialisierung

**Files:** Create `src/bootstrap/{inventory,batches,state}.ts`, `tests/bootstrap/{inventory,batches,state}.test.ts`.

**Interfaces:** Consumes alle bisherigen Kernverträge. Produces `bootstrap(project, request: BootstrapRequest): Promise<BootstrapResult>` für Aktionen `start|next|checkpoint|status`. State enthält projectId, checkoutIdentity, revision, scope, exclusions, file/slice hashes, Status `pending|analyzed|excluded|needs_review`, Featurezuordnungen und relationalReviewComplete. Checkpoint enthält expectedRunRevision, Paket-ID, aktuelle Hashes und nachweislich gespeicherte Feature-Fingerprints.

- [ ] **Step 1:** Tests `excludes_secrets_dependencies_binary_subrepos`, `allows_sanitized_env_example`, `twenty_files_and_65536_bytes_max`, `slices_large_unicode_file_without_loss`, `resume_requeues_changed_and_new_files`, `checkpoint_conflict_preserves_progress`, `crash_after_update_leaves_package_pending`, `completion_requires_cross_area_review`, `empty_project_creates_no_fake_feature`, `lost_cache_preserves_existing_features`, `branch_switch_requires_reconciliation`. Assertion: `completed` ändert `coverage: partial` nicht.
- [ ] **Step 2:** `npm test -- tests/bootstrap` muss rot sein.
- [ ] **Step 3:** Git-Dateiinventar, explizite Ausschlüsse und persistierte Paketplanung implementieren. Git-unverfügbare Inventarisierung transparent als nicht verfügbar melden; nicht still vollständig melden oder ungefragt vollständig scannen. Ausschnitte mit Zeilenbereichen und UTF-8-Byteumfang aufbauen; bei extrem langen Zeilen sichere Bytebereiche zusätzlich ausweisen. Bereits gespeicherte Featureupdates vor Checkpoint abgleichen. Kein Quellcode im Checkpoint, keine Projektskriptausführung; nur Agent liest Quellen.
- [ ] **Step 4:** `npm test -- tests/bootstrap tests/freshness tests/storage` erfolgreich; alle wiederaufgenommenen Läufe erhalten stabile IDs und manuelle Kernpunkte.
- [ ] **Step 5:** Commit `feat: bootstrap project memory in resumable batches`.

## Task 7: Fünf Werkzeuge über echtes STDIO-MCP

**Files:** Create `src/mcp/{tools,server}.ts`, `src/cli.ts`, `tests/mcp/stdio.test.ts`, `scripts/build-plugin.mjs` (zunächst nur Core-/MCP-Bundle).

**Interfaces:** Consumes Tasks 1–6. Produces `createServer(project: Project)` und `runCli(argv: string[]): Promise<number>`. CLI-Aufruf `node plugin/dist/cli.mjs mcp --project-root <root>`; Root muss explizit gebunden sein. Tools genau `network_context`, `network_impact`, `network_update`, `network_check`, `network_bootstrap`, mit Zod-Eingaben gemäß bisherigen Interfaces.

- [ ] **Step 1:** Echten SDK-Client mit separatem Serverprozess testen: `lists_exactly_five_tools`, `invalid_input_returns_stable_code`, `uninitialized_reads_create_nothing`, `bootstrap_before_marker_works`, `optimistic_update_conflicts`, `stdout_contains_only_protocol`, `one_process_never_switches_root`. Assertion: Werkzeugliste entspricht exakt den fünf Namen, keine Diagnosezeilen im STDOUT.
- [ ] **Step 2:** `npm test -- tests/mcp/stdio.test.ts` muss wegen fehlendem Server rot sein.
- [ ] **Step 3:** SDK-v2-STDIO-Transport verwenden, strukturierte Resultate und kurze lesbare Texte aus derselben begrenzten Ergebnismenge liefern. Beide Darstellungen zusammen in das Antwortbudget einrechnen; ausführliche Daten nicht doppelt ausgeben. Schreibtools annotieren, Fehler sauber abbilden, STDERR redigieren. Node24-Voraussetzung verständlich prüfen. Bundle schließt Runtime-Dependencies ein.
- [ ] **Step 4:** `npm run build`, `npm test -- tests/mcp/stdio.test.ts`, `npm run typecheck` erfolgreich. Server aus einem temporären Verzeichnis ohne `node_modules` starten.
- [ ] **Step 5:** Commit `feat: expose FeatureNetwork through local STDIO MCP`.

## Task 8: Fachliche Demo mit Profil, Backup und Restore

**Files:** Create `demo/src/{profile,backup,restore,migrations}.ts`, `demo/tests/{roundtrip,impact,bootstrap-contract}.test.ts`, `demo/network-spec/{_meta,user-profile,backup,restore}.yaml`, `demo/README.md`.

**Interfaces:** Produces `openProfileDb(path: string)`, `saveProfile(db, profile)`, `createBackup(db): Backup`, `restoreBackup(db, backup): void`. Vertrag enthält persistente Felder `id`, `displayName`, später `locale`; flüchtiger `sessionHint` wird nie gespeichert oder gesichert. Migrationsversion explizit; JSON-Backup hat eigenes Formatversionfeld.

- [ ] **Step 1:** Tests `persistent_profile_roundtrip`, `session_hint_is_excluded`, `migration_preserves_existing_profile`, `invalid_restore_rolls_back`, `profile_impact_includes_backup_and_restore`, `removed_field_is_no_longer_promised`, `contract_change_marks_restore_for_review`, `stale_or_missing_relation_is_reported_as_coverage_gap` schreiben. Erweiterungsfall fordert zusätzlich: gespeicherte `locale: 'de-DE'` kommt nach Backup/Restore identisch zurück; Roundtrip-Orakel liest echte SQLite-Daten, nicht Graphkanten. Die letzten Fälle verwenden gezielt geänderte Sollverträge; sie behaupten keine automatisierte fachliche Modellinterpretation.
- [ ] **Step 2:** `npm test -- demo/tests` muss rot sein.
- [ ] **Step 3:** Minimale lokale Demo und Transaktionen implementieren; Test für neues Feld vor Feldimplementierung rot zeigen. Synthetisches Sollnetzwerk mit Quellen erstellen. Separaten leeren Ausgangsstand für echte agentengeführte Initialisierung erhalten; Vertragstest mit vorgegebenenen Antworten nur als Protokolltest kennzeichnen.
- [ ] **Step 4:** `npm test -- demo/tests tests/query tests/bootstrap` erfolgreich; Baseline-/Plugin-Agentenvergleich beginnt jeweils mit identischem Stand vor der Felderweiterung.
- [ ] **Step 5:** Commit `test: demonstrate profile backup and restore impact`.

## Task 9: Nutzerbefehle und automatische Pflege als Skills

**Files:** Create `src/commands/policy.ts`, `plugin/skills/feature-network/SKILL.md`, jeweils `plugin/skills/feature-network-{init,status,show,impact,check,sync}/SKILL.md`, `tests/commands/{policy,skills}.test.ts`, `tests/commands/fixtures/`.

**Interfaces:** Produces `classifyCommand(text: string): CommandMode`, `commandPolicy(mode): {analyzeCode: boolean, updateFeatures: boolean, continueForMaintenance: boolean}`. `CommandMode` ist einer der sechs Namen ohne Präfix oder `unspecified`. Nur führende explizite `/`-/`$`-Aufrufe werden erkannt, keine Befehlsnamen in zitiertem Quellcode. `unspecified` allein ist kein Pflegebeweis; der allgemeine Skill und aktuelle tatsächliche Codeänderungen steuern normale Entwicklungsaufträge. Skills konsumieren die fünf MCP-Tools, keine neue Tool-API. Conversation-level Suche bleibt beim Hostagenten.

- [ ] **Step 1:** Tests `six_named_commands_have_descriptions`, `read_commands_never_enable_maintenance_continuation`, `init_requires_explicit_request`, `check_and_sync_have_distinct_policies`. Anzeige-Testfälle definieren: natürliche Profilbeschreibung, fünf Kandidaten bei Mehrdeutigkeit, zehn Summaries ohne Argument, breites Restore-Thema, kein Treffer mit Wissenslückenhinweis; synthetische Skill-Transcript-Tests nicht als reale Sprachverstehensabnahme ausgeben.
- [ ] **Step 2:** `npm test -- tests/commands` muss rot sein.
- [ ] **Step 3:** Skills mit kurzem Frontmatter und abgestimmten Menübeschreibungen schreiben. Allgemeiner Skill: Context → Impact → notwendige Codeprüfung/TDD → gezielte Pflege → Check; `init` nur explizit und resumierbar. `show` löst Auswahl über Beschreibung/Nummer, keine erzwungene ID; `sync` liest nur ausgewählten/erkannten Änderungsbereich, bewahrt manuelle Arbeit. Native explizite-only Metadaten nutzen, soweit vom jeweiligen Host dokumentiert, zusätzlich Verhalten im Skill klar begrenzen.
- [ ] **Step 4:** `npm test -- tests/commands` erfolgreich; tatsächliche Modellzuordnung und Slash-UI erst in Task 12 prüfen.
- [ ] **Step 5:** Commit `feat: provide six commands and guided memory maintenance`.

## Task 10: Codex-/Copilot-Hooks und sichere Setup-Vorschläge

**Files:** Create `src/adapters/{codex,copilot,hook-main,setup}.ts`, `plugin/hooks/hooks.json`, `plugin/com.github.copilot/hooks/hooks.json`, `tests/adapters/{codex,copilot,setup}.test.ts`.

**Interfaces:** Consumes Kern und `CommandMode`. Produces `handleCodexEvent(payload): Promise<HostOutput>`, `handleCopilotEvent(payload): Promise<HostOutput>`, `planSetup(host, project, existingConfig): SetupPlan`. SetupPlan enthält Vorschau und erwartete Inhaltsfingerprints; `applySetup(plan)` schreibt ausschließlich konkret autorisierte Zielkonfigurationen. CLI-Einstiege `hook --host codex|copilot` mit JSON auf STDIN und `setup --host ... --project-root ... --dry-run`.

- [ ] **Step 1:** Dokumentierte echte Payloadformen als redigierte Fixtures: `session_start_is_compact`, `copilot_prompt_output_not_injected`, `stop_continues_at_most_once`, `read_command_does_not_trigger_write_or_recovery`, `old_backlog_alone_does_not_trigger_continuation`, `plugin_root_differs_from_project_root`, `subdirectory_launch_is_bound_correctly`, `quoted_paths_on_bash_and_powershell`, `setup_preserves_unrelated_config`, `config_changed_since_preview_conflicts`, `unknown_hook_event_is_safe`. Keine Verarbeitung unbekannter Ereignisse als pauschaler Stop.
- [ ] **Step 2:** `npm test -- tests/adapters` muss rot sein.
- [ ] **Step 3:** Codex SessionStart/UserPromptSubmit/Stop und Copilot sessionStart/userPromptSubmitted/agentStop getrennt normalisieren. Offene Pflege revisionsgebunden pro Session/Turn, Host-Rekursion plus lokaler Marker; maximal einmal weiterführen. Ohne Marker nur Hinweis, keine Vollanalyse. Hook-Fehler knapp melden und Agentenarbeit nicht durch unbegrenztes Warten blockieren. Setup zuerst reviewfähigen Vorschlag erzeugen; aktuelle Nutzer-/Arbeitgeberkonfiguration nicht ohne konkrete Installationsanweisung ändern.
- [ ] **Step 4:** `npm test -- tests/adapters tests/commands tests/freshness` und `npm run build` erfolgreich; Hookprozesse real mit gebündeltem Einstieg starten.
- [ ] **Step 5:** Commit `feat: adapt Codex and Copilot lifecycle hooks`.

## Task 11: Installierbares Paket, CI und Releasevorbereitung

**Files:** Create `plugin/{plugin.json,mcp.json}`, `.github/workflows/ci.yml`, `.github/plugin/marketplace.json`, `scripts/{verify-package,release}.mjs`, `README.md`, `CONTRIBUTING.md`, `docs/installation.md`, `tests/package/package.test.ts`. Modify `scripts/build-plugin.mjs`, `AGENTS.md`. `LICENSE` erst nach Nutzerwahl erstellen.

**Interfaces:** Produces `npm run build`, `npm run verify:package`, `npm run release:prepare -- --version 0.1.0`; letzte Operation erzeugt nur lokalen Releasebaum/Archiv und Prüfreport, keinen Push/Tag/Upload. Gebündelte Einstiege `plugin/dist/cli.mjs` und `plugin/dist/hook.mjs`; beide mit externem Node24. Marketplace-Kataloge nach aktuell geprüftem Hostschema, falls erforderlich getrennte Codex-/Copilot-Katalogdateien statt vorgetäuschter Gleichheit.

- [ ] **Step 1:** Tests `manifest_and_mcp_validate_against_official_schemas`, `all_skill_and_hook_paths_exist`, `offline_start_without_node_modules`, `same_sources_produce_same_artifacts`, `package_contains_no_developer_paths_runtime_or_private_fixtures`, `update_does_not_touch_project_data`, `missing_license_blocks_release_not_local_build` schreiben. Assertion: MCP-Transport ist STDIO mit explizit gebundenem Projektroot; keine persönliche Pfadangabe im Paket.
- [ ] **Step 2:** `npm test -- tests/package` muss rot sein.
- [ ] **Step 3:** Agent Plugins 1.0 und Hostnamespaces verwenden; erforderliche Root-Variablen nur nach dokumentiertem Vertrag einsetzen, sonst projektgebundenen Setup-Vorschlag. Build-Artefakte im Entwicklungszweig ignorieren; Releasevorbereitung stellt Quellen und gebautes Plugin desselben Stands zusammen, tatsächlicher Tag/Push separat. README mit Nodevoraussetzung, sechs Befehlen, Installations-/Update-/Build-/Testschritten. CI: Node24 auf macOS/Linux/Windows; Actions und Tooling bei Umsetzung aktuell verifizieren, minimale Rechte `contents: read`. Keine Veröffentlichungsworkflow-Automatik.
- [ ] **Step 4:** `npm ci`, `npm run typecheck`, `npm test`, `npm run build`, `npm run verify:package` aus frischem lokalen Checkout ausführen. Testbericht benennt OS und Nodepatch; fehlende externe CI-Ausführung bleibt offen. Releasevorbereitung ohne Lizenz liefert nachvollziehbaren Blocker.
- [ ] **Step 5:** Commit `build: package FeatureNetwork for Codex and Copilot`.

## Task 12: Messung und tatsächliche Hostabnahme

**Files:** Create `bench/{core,comparison}.ts`, `tests/bench/report.test.ts`, `docs/validation/{host-matrix,benchmark-protocol}.md`; dokumentierte Reports erst nach tatsächlichen Läufen hinzufügen.

**Interfaces:** `npm run bench:core` erzeugt JSON mit Graphgröße, Kantendichte, Cold-/Warmzeiten, Updatezeit, Speicher und Ausgabebytes. Vergleichsharness speichert Versionen/Aufgabe/Bedingung/Einzellauf, fachliches Soll/Ist, Verhaltenstests, Code-Lesezugriffe und getrennt gemessene beziehungsweise fehlende Tokens. Keine Modellaufrufe durch den Kern oder automatische Installation am Arbeitsrechner.

- [ ] **Step 1:** Tests `report_keeps_unavailable_tokens_null`, `estimated_tokens_not_labelled_measured`, `initialization_cost_is_separate`, `three_runs_per_condition_are_required`, `worse_recall_is_not_success`, `contract_tests_do_not_mark_host_live_pass`. Assertion: fehlende Hostmessung wird nicht zu null Kosten, nicht zu bestandenem Live-Test.
- [ ] **Step 2:** `npm test -- tests/bench/report.test.ts` muss rot sein.
- [ ] **Step 3:** Kernfälle mit 100/1.000/10.000 Features und Zyklen implementieren. 100 ms warm bei 1.000 Features als Prüfziel berichten, kein künstliches Schönrechnen. Vergleichsprotokoll: Profilfeld, kosmetische Änderung und unerfasste Änderung; jeweils mindestens drei Läufe je Baseline/Plugin mit identischem Startstand und frischer Session, Gesamtkosten inklusive Init/Pflege und amortisierter Sicht.
- [ ] **Step 4:** `npm test -- tests/bench/report.test.ts` und `npm run bench:core` ausführen; anschließend vollständige lokale Prüfung aus Task 11. Tatsächliche Agentenläufe erst mit konkret autorisierter Demo-Installation und vorhandenen Hosts ausführen; detaillierte Telemetrie explizit aktivieren, keine privaten Projekte verwenden.
- [ ] **Step 5:** Für Codex Desktop, Copilot CLI und Copilot App jeweils Version, Installation, MCP, Skills, Hooks, Init/Wiederaufnahme, Profilauftrag und `show`-Usability erfassen. Zusätzlich `sync` nach Featureverkleinerung und Vertragsänderung mit Konflikt-/Wiederholungsfall abnehmen: manuelle Kernpunkte bleiben erhalten, belegbar entfallene Aussagen werden entfernt und identische Wiederholung schreibt kein YAML. Codex `/feature-net` muss alle sechs Einträge anbieten. Fehlt Hostzugriff/Berechtigung, konkreten offenen Nachweis ausweisen; v1 mit offenen Pflichtnachweisen nicht als vollständig abgenommen ausgeben. Lizenzentscheidung vor öffentlichem Release einholen. Keine Nutzer-/Arbeitgeberkonfiguration ohne Installationsauftrag ändern.
- [ ] **Step 6:** Messharness und tatsächlich erhobene Reports committen: `test: benchmark memory usage and document host acceptance`.

## Reihenfolge, Nachweise und Planreview

Tasks 1–7 bilden einen benutzbaren lokalen Kern mit MCP; Task 8 liefert den unabhängigen fachlichen Prüfvertrag. Tasks 9–11 liefern die drei Hostintegrationen und Installationspakete. Task 12 beurteilt Nutzen und tatsächliche Oberflächen. Die Tasks hängen überwiegend über gemeinsame Typen und Speicherzustände zusammen und werden in dieser Reihenfolge umgesetzt; kein Teilumfang ersetzt die vereinbarten drei v1-Zielumgebungen.

| Spezifikationsbereich | Zuständige Tasks |
| --- | --- |
| Ziele/Umfang/Runtime | 1, 7, 11, 12 |
| Format/Hypothesen/Relationen | 1, 3, 4, 8 |
| Suche/Aktualität/Graph/Budgets | 4, 5 |
| MCP und Rootbindung | 2, 7, 10, 11 |
| Speicherung/Recovery/Pfadsicherheit | 2, 3, 5, 6 |
| Automatische Pflege und sechs Befehle | 9, 10, 12 |
| Codex und beide Copilot-Oberflächen | 10, 11, 12 |
| Git-Releases/Installation/Open Source | 11, 12 |
| Bestandsinitialisierung und Wiederaufnahme | 6, 7, 9, 12 |
| Demo/fachliche Erkennung/Performance | 8, 12 |

Selbstreview: Keine Produktumsetzung erfolgt; Typ-/Dateigrenzen und zuständige Tests sind festgelegt. Reale sprachliche Zuordnung, Hostoberflächen, tatsächliche Organisationsrichtlinien und Tokenmessungen bleiben reale Abnahmen, keine fingierten automatisierten Belege. Offene Lizenzwahl betrifft öffentliche Releases, nicht die Implementierung des lokalen Kerns.

Empfehlung für die Ausführung: **Native Umsetzung in dieser Session**, weil die zwölf Tasks eng auf gemeinsame Speicher- und Toolverträge aufbauen. Das hält die Übergabekosten niedrig; eine unabhängige Abschlussprüfung folgt nach Umsetzung. Alternative: frischer Implementierungs- und Reviewagent pro Task mit zusätzlichen Kontextkosten. Der Nutzer wählt nach Review dieses Plans; vorher keine Produktcodeänderungen, Dependencyinstallation oder Hostinstallation.

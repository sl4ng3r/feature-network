# FeatureNetwork

## Projektstatus und Architektur

Lokales Open-Source-Plugin für Coding-Agenten: TypeScript/Node.js-Kern, STDIO-MCP, Skill und kleine Hook-Adapter. Erste Zielumgebungen sind Codex in der lokalen Mac-App, GitHub Copilot CLI und GitHub Copilot App. Claude Code folgt später.

Maßgeblicher Entwurf: `docs/superpowers/specs/2026-10-09-featurenetwork-v1-design.md`, schriftlich vom Nutzer am 2026-10-09 freigegeben und abschließend geprüft. Implementierungsplan: `docs/superpowers/plans/2026-10-09-featurenetwork-v1.md`; die Umsetzung erfolgt nach Planreview und gewählter Ausführung in einem isolierten Worktree. Implementiert sind der YAML-Vertragskern (`src/model/`), sichere Projektbindung (`src/project/`) und konfliktgeschützte Speicherung (`src/storage/`) sowie deterministische Suche und erklärbare Impact-Abfragen (`src/query/`) und Aktualitäts-/Arbeitsdurchlaufprüfung (`src/freshness/`) mit automatisierten Tests. MCP, Hostadapter und vorgebautes Plugin-Paket folgen in den weiteren Tasks.

## Arbeitsregeln

- Superpowers nur verwenden, wenn der Nutzer es in der laufenden Session ausdrücklich erwähnt oder einen Pluginbefehl auswählt; keine automatische Aktivierung.
- Vorschläge kritisch bewerten; Tatsachen, Annahmen und noch ausstehende Live-Nachweise trennen.
- Produktcode testgetrieben umsetzen. Speicherung, parallele Zugriffe, Pfadsicherheit und Hostadapter gründlich automatisiert prüfen.
- Vor Änderungen Git-Status prüfen, vorhandene Arbeit bewahren und nur zusammenhängende eigene Änderungen committen. Keine leeren Commits, keine erfundenen Remotes.
- Zusammenhänge mit Quellen stützen; unbestätigte Aussagen als Hypothesen behandeln. Hashgleichheit und strukturelle Validität beweisen keine fachliche Vollständigkeit.
- Codex, Copilot CLI und Copilot App getrennt testen. Vertragstests ersetzen keine tatsächlichen Live-Nachweise.
- Keine privaten Repository-Inhalte oder Geheimnisse in Beispielnetzwerke, Logs oder Releases aufnehmen. Keine Agentenkonfigurationen oder Arbeitgeber-Projekte ohne konkrete Installationsanweisung verändern.

## Datenhaltung und Betrieb

`network-spec/` enthält Git-versionierte YAML-Dateien mit kurzer Summary, Kernpunkten, Codereferenzen und gerichteten Beziehungen. `.feature-network/` ist für Git-ignorierte lokale Caches, Sessiondaten und Wiederherstellungsjournale vorgesehen. Der Kern benötigt keine Datenbank, Cloud oder eigene KI-API. Die geplante Demo verwendet lokal SQLite.

V1 enthält den expliziten Skill-/Command-Einstieg `feature-network-init` zum Aufbau des Gedächtnisses ganzer Bestandsprojekte. Analyse erfolgt durch den laufenden Agenten in begrenzten Paketen; lokale Checkpoints ermöglichen Wiederaufnahme. Technisch abgeschlossene Inventarisierung beweist keine vollständige fachliche Coverage. Bestehende Features und manuelle Kernpunkte bewahren; keine Produktcode- oder Datenbankänderungen durch den Initialisierungsbefehl.

Freigegebene Nutzerbefehle: `feature-network-init`, `feature-network-status`, `feature-network-show`, `feature-network-impact`, `feature-network-check`, `feature-network-sync`. Alle sollen im nativen Codex-Slash-Menü über `/feature-net` auffindbar sein. `show` akzeptiert natürliche Beschreibungen, bietet bei Mehrdeutigkeit eine Auswahl und ohne Argument eine paginierte Übersicht; keine ID-/Symbolkenntnis erforderlich. `check` meldet Befunde, `sync` aktualisiert anhand gezielter Codeprüfung. Die automatische Pflege benötigt im Alltag keine manuellen Befehle.

Der Nutzer hat Docker Compose und Deploy Cockpit ausdrücklich vollständig ausgenommen. Auslieferung erfolgt als vorgebautes lokales Plugin-Paket für vorausgesetztes Node.js 24 LTS; normale Updates dürfen Projektdaten und vorhandene Hostkonfigurationen nicht überschreiben. Keine absoluten Entwicklerpfade im Produktpaket. Installation, Update, Build und Testbefehle werden mit der Implementierung dokumentiert.

Kern und Plugins sollen öffentlich als Open Source über Git verfügbar werden. Nutzer-Repository: `git@github.com:sl4ng3r/feature-network.git`, lokal als `origin` eingerichtet. Release-Tags enthalten ein geprüftes vorgebautes Plugin-Paket; README, Lizenz, Versionshinweise und Beitragshinweise gehören zur Auslieferung. Lizenzwahl und tatsächliche Veröffentlichung benötigen konkrete Nutzerangaben beziehungsweise eine Veröffentlichungsanweisung. Releases aus frischem Checkout prüfen; keine privaten Projekt- oder Laufzeitdaten ausliefern.

FeatureNetwork besitzt derzeit keine eigene Authentifizierung. Falls später eine Anwendung mit Login-Proxy-Integration entsteht, vor Planung und Umsetzung den vollständigen Vertrag unter `/Users/alexanderstroll/Proggen/ki-applikationen/login-proxy/docs/app-integration-contract.md` lesen und einhalten.

## Derzeit verfügbare Prüfungen

- `git status --short`: vorhandene Änderungen prüfen.
- `git diff --check`: Patch auf Whitespace-Fehler prüfen.
- `git log -5 --oneline`: jüngste lokale Commits prüfen.

Voraussetzung für Entwicklung und Laufzeit: Node.js 24 LTS (`.node-version`). Entwicklerabhängigkeiten mit `npm ci` installieren.

- `npm test`: vollständige derzeit verfügbare Vitest-Suite.
- `npm test -- tests/model/schema.test.ts`: YAML-Vertragsprüfung.
- `npm test -- tests/project`: Projektbindung, Pfadsicherheit und echte Git-Fixtures.
- `npm test -- tests/storage`: Snapshots, Runtime-CAS, echte parallele Node-Prozesse und SIGKILL-Wiederherstellung.
- `npm test -- tests/query tests/storage`: Suche, inkrementelle Indizes, konservative Beziehungspfade und revisionsgebundene Budget-Fortsetzung zusammen mit Storage.
- `npm test -- tests/freshness tests/storage`: Referenzaktualität, begründete Prüfentscheidungen, Arbeitsdurchläufe und Speicherkonflikte.
- `npm run typecheck`: strikte TypeScript-Prüfung ohne Ausgabe.

Die npm-Skripte `build`, `verify:package` und `bench:core` reservieren die Schnittstellen für spätere Tasks. Ihre Zieldateien existieren noch nicht; sie schlagen derzeit fehl und sind kein Build-, Paket- oder Performancenachweis. Es gibt noch keinen laufenden Dienst oder installierbares Plugin. Keine Live-Abnahme behaupten.

Der Parser begrenzt jedes YAML-Dokument auf 65.536 UTF-8-Bytes, verwirft unbekannte Felder, doppelte Schlüssel, Aliase, Anker und explizite Tags und normalisiert optionale Listen. `_meta.yaml` erlaubt ausschließlich `schema: 1`, `coverage: partial` und optionale `areas` als beschreibende Hinweise; diese beweisen keine vollständige Abdeckung. Referenzpfade werden syntaktisch geprüft; Dateiexistenz und projektbezogene Pfadsicherheit werden erst in den Speicher-/Projekttasks implementiert.

`src/project/` bindet explizite Roots ohne Dateianlage, kanonisiert sichere Referenzpfade (auch fehlende) und begrenzt Hook-Discovery auf den nächsten `.git`-Checkout. Symlink-Verzeichnisse für Speicherung und symlinkte Marker werden abgewiesen. Git-State verwendet feste Argumentlisten, NUL-getrennte Pfade und relative Projektpfade; fehlendes Git ergibt `status: unavailable` mit Diagnose statt einer Clean-State-Zusage. Repository-Filter und fsmonitor werden beim Lesen deaktiviert; gefilterte Dateien erhalten eine sichtbare Prüfgrenze. Referenzexistenz, ausgeschlossene fachliche Referenzbereiche und Schreibzielrichtlinien bleiben Aufgabe der Speicher-/Freshness-Verbraucher.

`src/storage/` übernimmt Snapshots unter kurzem exklusivem Lock und prüft höchstens drei Einleseversuche. Schreibzugriffe erwarten SHA-256-Fingerprints (neue Dateien: `null`) und validieren das gesamte resultierende Netzwerk. Offene Journale sind bei lesenden Aufrufen `pending_recovery`; erst der nächste Netzwerk- oder Runtime-Schreibzugriff darf sie unter Lock vervollständigen. Externe Abweichungen blockieren die gesamte Wiederherstellung. Lock-Akquisition wartet höchstens zwei Sekunden; nur vollständige lokale Owner-Identität und nachweislich beendete PID erlauben Rückgewinnung. Das ist kooperative Prozesskoordination, keine Sandbox gegen feindliche Betriebssystemzugriffe.

Persistierte Dokumente haben eine gemeinsame Lese-/Schreibgrenze von 16 MiB kodierten UTF-8-Bytes einschließlich JSON-/Journal-Overhead; `storage_too_large` wird vor der Veröffentlichung oder Ersetzung ausgelöst. Die strengere Feature-YAML-Grenze von 64 KiB bleibt bestehen.

Runtimewerte liegen unter `.feature-network/values/`; `runtimeRevision` berechnet den CAS-Token des zurückgegebenen JSON-Werts. `null` bedeutet fehlend und darf nicht gespeichert werden. `baselines` ist nur lesbar; ausschließlich `applyUpdate` bestätigt tatsächlich geprüfte Referenzhashes, auch ohne YAML-Änderungen. Baselines gelten nur zur zugehörigen Netzwerkrevision. Fortgeschriebene Referenzen müssen zuvor bestätigt, unverändert und im Endnetzwerk noch vorhanden sein. Jeder Host muss sein Plugin-Installationsverzeichnis als `excludedReferenceRoots` an Speicheraufrufe mit Referenzprüfung übergeben. `.git`, `network-spec` und `.feature-network` werden einschließlich kanonischer Aliase ausgeschlossen. Ein Prozessabbruch kann harmlose Owner-/Tempdateien hinterlassen; Wiederherstellung nutzt ausschließlich geprüfte Journalinhalte, kein blindes Aufräumen.

`src/query/` arbeitet rein im Speicher auf Storage-Snapshots. Ungültige Marker, fehlende Initialisierung und offene Wiederherstellung blockieren Abfragen; defekte Feature-Dateien bleiben mit eingeschränkter Integrität sichtbar. Antworten zählen sämtliche JSON-Metadaten zum UTF-8-Budget. Große Details werden als vollständige benannte Abschnitte oder explizite JSON-Fragmente mit UTF-16-Offsets und Gesamtlänge fortgesetzt; Surrogatpaare bleiben zusammen. Impact kennzeichnet belegte beziehungsweise hypothetische Wege und eine erreichte Tiefengrenze, ohne fachliche Vollständigkeit zu behaupten.

`src/freshness/` trennt technische Hashstände, begründete Agentenentscheidungen und Turnanfangsstände. `checkNetwork` schreibt nichts, startet keine fachliche Analyse und meldet offene Journale vor Runtimezugriff; Summary ist ausdrücklich `last_known`. `startTurn` ist ein schreibender Sessioneinstieg und erfasst ausschließlich Referenzen und vorhandene Änderungsdateien, einschließlich sicherer Fingerprints zur Trennung von Vorarbeit und neuen Änderungen. Branch-/Commitwechsel bleiben als Prüfgrenzen sichtbar; feste sichere Git-Operationen liefern auch bereits committete Turnänderungen.

`confirmReferences` verlangt Netzwerkrevision, Ergebnis `updated` oder `no_semantic_change` und eine Agentenbegründung. Vollständige Revisionsprüfung erfolgt über `applyUpdate.expectedRevision` unter Lock. Baselines werden nur für echte Netzwerkreferenzen bestätigt; zusätzliche lokale Entscheidungen binden Quellenhash und zugehörige Featurefingerprints. Fehlende/defekte Entscheidungen bleiben offen. Sichere nicht zugeordnete Dateien können ausschließlich mit begründetem `no_semantic_change` abgeschlossen werden und bleiben als unbekannte Änderungsdateien sichtbar. Automatische Fingerprints für Dirty-/Unmapped-Dateien schließen offensichtliche Geheimnisnamen und kanonische Aliasse aus; das ist keine allgemeine Erkennung geheimer Inhalte. Hostaufrufe müssen das tatsächliche Pluginverzeichnis als `excludedReferenceRoots` an alle Freshness-/Storage-Aufrufe weiterreichen.

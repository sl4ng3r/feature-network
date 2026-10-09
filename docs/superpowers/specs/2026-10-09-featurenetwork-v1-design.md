# FeatureNetwork v1 – Designspezifikation

Datum: 2026-10-09

Status: Schriftlicher Entwurf vom Nutzer am 2026-10-09 freigegeben; abschließende Spezifikationsprüfung durchgeführt. Freigabe gilt für die Implementierungsplanung; Produktcode folgt nach Planreview und Wahl der Ausführungsmethode.

Zielumgebungen: OpenAI Codex in der lokalen Mac-App, GitHub Copilot CLI und GitHub Copilot App.

## 1. Ziel und verbindliche Entscheidungen

FeatureNetwork ist ein lokales, Git-versioniertes fachliches Gedächtnis für Coding-Agenten. Es beschreibt Features, ihre wichtigsten Eigenschaften, relevante Codestellen und gerichtete fachliche Beziehungen. Der Agent soll vor einer Änderung gezielt Kontext erhalten und nach der Umsetzung das Netzwerk anhand von Code, Tests und bestehenden Anforderungen pflegen.

Der Nutzen muss messbar sein: weniger Kontext und wiederholte Code-Lesezugriffe bei mindestens gleicher fachlicher Vollständigkeit. Tokenersparnis und höhere Entwicklungsgeschwindigkeit sind Hypothesen, die durch Vergleiche zu prüfen sind.

Verbindliche Entscheidungen aus dem Gespräch:

- TypeScript/Node.js, gemeinsamer Kern und schlanke Agentenadapter.
- YAML-Dateien in `network-spec/`, jeweils eine Datei pro Feature.
- Eine kurze `summary`, darunter mehrere eigenständige `key_points` als Stichpunkte. Bei Erweiterung oder Verkleinerung eines Features werden diese gezielt angepasst.
- Gerichtete, typisierte Beziehungen mit optionalen Auslösern und Prüfhinweisen.
- MCP, Skill und Lifecycle-Hooks als Integration; im normalen Arbeitsablauf sind keine zusätzlichen Nutzerkommandos erforderlich.
- Codex sowie Copilot CLI und Copilot App gehören zur ersten Version. Claude Code folgt später.
- Docker Compose und Deploy Cockpit entfallen ausdrücklich vollständig.
- FeatureNetwork benötigt keinen eigenen Cloud-Dienst und keinen eigenen KI-API-Schlüssel.
- Kern und Plugins werden als Open Source über ein öffentliches Git-Repository für andere Nutzer bereitgestellt. Installation und Beiträge dürfen keine persönliche Entwicklerumgebung voraussetzen.
- V1 enthält einen expliziten Plugin-Einstieg `feature-network-init`, der das fachliche Gedächtnis für ein bestehendes Projekt schrittweise aus Code, Tests und vorhandener Dokumentation aufbaut und unterbrochene Analysen fortsetzt.
- Die sechs sichtbaren Nutzerbefehle sind `feature-network-init`, `feature-network-status`, `feature-network-show`, `feature-network-impact`, `feature-network-check` und `feature-network-sync`. Ihre Bedienung erfordert weder Feature-IDs noch Codesymbole.
- Testgetriebene Umsetzung, automatisierte Tests für fachliche Wirkung, Speicherung, Konsistenz und Integrationen.

FeatureNetwork selbst überträgt keine Repository-Inhalte an einen eigenen externen Dienst. Inhalte, die es dem gewählten Coding-Agenten liefert, unterliegen weiterhin dessen normalem Datenverarbeitungsmodell und den Regeln der Arbeitsumgebung.

## 2. Umfang der ersten Version

Die erste Version umfasst:

1. Laden, Validieren, Suchen und kontrolliertes Aktualisieren von Features.
2. Vorwärts-, Rückwärts- und indirekte Graphabfragen sowie konservative Impact-Analyse.
3. Erkennung struktureller Fehler, geänderter Referenzen und nicht erfasster Änderungsbereiche.
4. Einen lokalen MCP-Server und ein installierbares Plugin-Paket für die drei Zielumgebungen.
5. Einen expliziten, agentengeführten Initialisierungsbefehl für bestehende Projekte mit begrenzten Analysepaketen, Fortschrittsbericht, Wiederaufnahme und anschließender inkrementeller Erweiterung.
6. Eine kleine Demo mit Benutzerprofil, Backup und Restore samt automatisierten Tests.
7. Reproduzierbare Kernbenchmarks und einen Vergleichsablauf für Agenten mit und ohne Netzwerk.

Die schrittweise Inventarisierung eines ganzen Bestandsprojekts gehört nach der ergänzten Nutzeranforderung bereits zur ersten Version. Die erste Umsetzung verwendet den laufenden Agenten und sequentielle Analysepakete. Sprachspezifische AST-Analysen, parallele autonome Inventarisierungsagenten und weitere Optimierungen für sehr große Monorepos sind spätere Erweiterungen. Graphdatenbanken, Embeddings, allgemeine Codegraphen, eine Weboberfläche und ein eigenes Requirements-Management gehören nicht zur ersten Version.

Die Bibliothek und die Hook-Helfer müssen portable Dateipfade verwenden. Bash- und PowerShell-Einstiege delegieren an denselben Node-Code; keine Python- oder Unix-exklusiven Produktabhängigkeiten. macOS ist das unmittelbar verfügbare Live-Testziel. Linux und Windows werden als automatisierte Testziele vorgesehen. Ein konkreter Live-Nachweis auf dem Arbeitsrechner ist separat zu dokumentieren.

## 3. Architektur und Zuständigkeiten

| Einheit | Verantwortung | Abhängigkeiten |
| --- | --- | --- |
| Schema und Speicher | YAML prüfen, Referenzen schützen, Änderungen kontrolliert speichern | Dateisystem, YAML-Parser, Validierung |
| Netzwerkindex | Feature-, Text-, Dateizuordnungs- und Graphindizes | Validierte Feature-Daten |
| Abfragen und Impact | Relevante Features und erklärbare Beziehungspfade auswählen | Netzwerkindex |
| Aktualitätsprüfung | Referenzänderungen, offene Prüfungen und unbekannte Dateien erkennen | Dateisystem, lokale Laufzeitdaten, Git |
| Initialisierung | Dateiinventar, begrenzte Analysepakete, Fortschritt und Wiederaufnahme | Gemeinsamer Speicher, Dateisystem, Git; fachliche Analyse durch den Hostagenten |
| MCP | Kleine, strukturierte Werkzeuge bereitstellen | Gemeinsamer Kern, MCP-SDK |
| Skill | Fachliche Zuordnung, Codeprüfung und Pflegeablauf anleiten | MCP-Werkzeuge, Agentenfähigkeiten |
| Adapter | Hostereignisse und Rückgaben normalisieren | Kern und jeweilige Hook-Verträge |

Die fachliche Interpretation übernimmt der bereits laufende Coding-Agent. Der Kern verwendet keine Modellaufrufe. MCP und Hooks enthalten keine eigene, abweichende Graphlogik.

Runtime: Node.js 24 LTS, verbindlich in Paketmetadaten und CI festgelegt; die konkrete geprüfte Patchversion wird im Release dokumentiert. Node wird auf dem Nutzerrechner vorausgesetzt und nicht im Plugin gebündelt. Der vorgebaute JavaScript-Kern enthält seine Laufzeitbibliotheken; fehlendes oder inkompatibles Node führt zu einer verständlichen Installationsmeldung ohne automatischen Download. Dependencies beschränken sich auf einen YAML-Parser, Schema-Validierung und das offizielle TypeScript-MCP-SDK, soweit erforderlich. Für Tests wird ein schlanker Runner verwendet. Der Kern benötigt keine Datenbank. [Node.js: Release-Status](https://nodejs.org/en/about/previous-releases)

## 4. Ablage und Feature-Format

```text
network-spec/
  _meta.yaml
  user-profile.yaml
  backup.yaml
  restore.yaml
.feature-network/       # Lokale Laufzeitdaten; Git-ignoriert
```

`_meta.yaml` ist der explizite Netzwerkmarker und enthält `schema: 1` sowie die deklarierte Abdeckung. In v1 ist die fachliche Abdeckung stets `partial`: Auch ein abgeschlossener Initialisierungslauf beweist nicht, dass alle Features und Beziehungen korrekt erkannt wurden. Der technische Analysestatus wird separat geführt. Beschreibungen der bereits untersuchten Bereiche sind optionale Hinweise, keine Vollständigkeitsbeweise.

Beim ersten schreibenden Laufzeitaufruf wird `.feature-network/.gitignore` mit `*` angelegt, sofern keine eigene Ignore-Datei vorhanden ist. Damit bleiben lokale Zustände ohne Änderung der Repository- oder globalen Git-Konfiguration ignoriert. Bestehende Ignore-Regeln werden bewahrt; sind Laufzeitdateien bereits getrackt oder entgegen den Regeln sichtbar, wird dies gemeldet und nicht durch automatisches Untracking behoben.

Feature-IDs sind stabil, innerhalb eines Netzwerks eindeutig und entsprechen dem Dateinamen ohne `.yaml`. Erlaubt sind Kleinbuchstaben, Ziffern und einfache Bindestriche, beginnend mit einem Buchstaben. Eine geänderte Summary ändert die ID nicht. Die reservierte Datei `_meta.yaml` ist kein Feature.

Beispiel für den geplanten Vertrag der Demo:

```yaml
schema: 1
id: backup
summary: Sichert persistente Benutzerdaten zur Wiederherstellung.

key_points:
  - Enthält alle persistenten Benutzerprofilfelder.
  - Temporäre Sitzungseigenschaften werden nicht gesichert.
  - Neue Profilfelder müssen einen Backup-/Restore-Rundlauf bestehen.

code:
  - path: src/backup.ts
    symbol: createBackup

evidence:
  - path: tests/backup.test.ts
    symbol: includesProfileFields

relations:
  - to: user-profile
    type: reads
    status: evidenced
    evidence:
      - path: src/backup.ts
        symbol: createBackup
    when: Persistente Profilfelder ändern sich.
    check: Vollständigkeit der Sicherung und Wiederherstellung prüfen.
```

Pflichtfelder sind `schema`, `id`, `summary`, `key_points` und `code`. `key_points` darf bei einem erst erfassten Feature leer sein; das wird als Wissenslücke angezeigt. Ein Feature benötigt mindestens eine bestehende Code- oder fachliche Dokumentreferenz. `evidence`, `relations` und `hypotheses` sind optional und werden intern als leere Listen normalisiert.

`summary` benennt Zweck und Funktion in einem kurzen Satz. `key_points` enthält einzelne Aussagen zu Verhalten, Grenzen oder Bedingungen. Es gibt keine starre Zahl von Punkten. Wiederholungen und lange technische Implementierungsdetails sind zu vermeiden. Wichtige Information wird nicht allein wegen eines Tokenbudgets aus der Quelldatei entfernt.

`code` bezeichnet relevante Implementierung oder bestehende fachliche Dokumentation. `evidence` benennt Quellen, die die Aussagen stützen. Referenzen enthalten einen relativen `path` und optional einen `symbol` als Suchanker. Zeilennummern sind kein Identitätsmerkmal. Der Kern prüft Dateiexistenz und Pfadsicherheit. Ein angegebener Symbolname ist ein Navigationshinweis; v1 garantiert keine sprachübergreifende Symbolauflösung und meldet diese Prüfgrenze ausdrücklich.

Unbestätigte Aussagen stehen separat unter `hypotheses`, jeweils als Objekt mit `text` und optional `evidence`. Sie werden nicht in verbindliche Kernpunkte umgewandelt, nur weil sie im Netzwerk stehen. Vor Übernahme muss der Agent sie anhand konkreter Quellen prüfen. Bestehende Anforderungen und beobachtetes Verhalten dürfen nicht miteinander verwechselt werden: Im Konfliktfall wird die Abweichung gemeldet.

Unbekannte Schema-Versionen oder Felder führen bei Tool-Schreibzugriffen zu einer konkreten Validierungsfehlermeldung; sie werden nicht stillschweigend gelöscht. V1 verwendet keine automatischen Formatmigrationen.

Beim Lesen werden ungültige Dateien mit Pfad und Fehlercode gemeldet und nicht in den gültigen Index übernommen. Alle darauf beruhenden Ergebnisse kennzeichnen die eingeschränkte strukturelle Integrität ausdrücklich; eine leere Treffermenge ist dann keine Entwarnung. Ein ungültiger Netzwerkmarker verhindert normale Abfragen. Schreibzugriffe erfordern einen gültigen Gesamtendzustand; ein expliziter Reparaturänderungssatz darf ungültige Dateien ersetzen, aber keine fremden Inhalte still entfernen.

## 5. Beziehungen und Impact-Semantik

Die erste Version unterstützt drei Relationstypen:

| Typ | Bedeutung der Kante `A → B` |
| --- | --- |
| `depends_on` | A benötigt eine fachliche Leistung oder einen Vertrag von B |
| `reads` | A liest oder interpretiert fachliche Daten von B |
| `writes` | A erzeugt oder verändert fachliche Daten von B |

Beispiele: Backup `reads` Benutzerprofil; Restore `reads` Backup; Restore `writes` Benutzerprofil. Beziehungen werden einmal gespeichert. Inverse Kanten entstehen ausschließlich im Index.

`status` ist `evidenced` oder `hypothesis`. Für `evidenced` ist mindestens eine Quellenreferenz erforderlich. Das bedeutet mit Quellen gestützt, nicht vollständig bewiesen. `when` und `check` sind optionale fachliche Hinweise. Der Kern interpretiert sie nicht als ausführbare Regeln oder zuverlässig auswertbare natürliche Sprache.

Impact beginnt bei expliziten Feature-IDs, Suchtreffern oder geänderten bekannten Dateien. Er untersucht konservativ eingehende und ausgehende Kanten. Damit werden sowohl Verbraucher eines geänderten Vertrags als auch möglicherweise veränderte Datenziele berücksichtigt. Diese Auswahl bedeutet möglicherweise betroffen, nicht zwingend fehlerhaft.

Standardmäßig werden höchstens zwei Beziehungsschritte und zwanzig Features ausgegeben. Tiefe und Ergebnismenge sind begrenzt konfigurierbar. Ein Ergebnis enthält Ausgangsfeature, Beziehungspfad, Richtung, Status und vorhandene Prüfhinweise. Zyklen werden durch eine Besuchsmenge beendet. Hypothesenpfade bleiben als solche markiert und werden gegenüber belegten Pfaden nachgeordnet; kein indirekter Pfad macht eine unsichere Kante zu einer bestätigten Aussage.

Ausgabebeschränkungen sind immer sichtbar: `truncated`, ausgelassene Anzahl und Hinweise zum Nachladen. Ein Ergebnisbudget von standardmäßig 12.000 UTF-8-Bytes begrenzt Kontextantworten. Erreicht ein einzelnes Feature das Budget, wird ein kleiner Ausschnitt mit einem expliziten Fortsetzungsverweis geliefert; es gibt keine stillen Textkürzungen. Dieses Bytebudget ist kein exakter Tokenwert.

## 6. Suche, Indizes und Aktualität

Der Kern baut im Speicher auf:

- ID → Feature.
- Token → Feature-IDs aus ID, Summary und Kernpunkten.
- Relativer Referenzpfad → Feature-IDs, einschließlich Belegreferenzen.
- Feature-ID → ausgehende und eingehende Kanten.

Die Suche verwendet Unicode-normalisierte, kleingeschriebene Begriffe und eine deterministische Rangfolge: explizite IDs vor Begriffstreffern, konkrete Pfadzuordnungen vor schwachen Texttreffern. Gleichstände werden stabil nach ID sortiert. V1 benötigt weder Embeddings noch einen Thesaurus.

Eine freie Nutzeranfrage kann fachlich relevante Begriffe auslassen oder anders benennen. Der Skill lässt den bereits laufenden Agenten passende Suchbegriffe und Feature-IDs bestimmen. Bei einem Entwicklungsauftrag werden schwache Treffer durch gezielte Codeprüfung ergänzt. Der reine Anzeigebefehl `show` bleibt dagegen beim vorhandenen Netzwerk und meldet fehlende beziehungsweise mehrdeutige Treffer. Keine Treffer bedeuten unbekannte Abdeckung, nicht keine Auswirkungen. Neue und nicht zugeordnete Dateien werden separat angezeigt.

Feature-Dateien werden bei Erstzugriff geladen. Änderungen werden über lokale Fingerprints erkannt und nur für betroffene Dateien neu eingelesen; die Indizes werden entsprechend ersetzt. Vor Schreibzugriffen wird der tatsächliche Inhalt erneut geprüft. Hooks verwenden einen ableitbaren lokalen Cache, um wiederholtes Parsing in kurzen Prozessen zu vermeiden. Ein fehlender oder ungültiger Cache wird neu aufgebaut.

Fingerprints referenzierter Dateien werden in Git-ignorierten Laufzeitdaten gespeichert. Sie unterscheiden `changed`, `missing` und `unknown`; ein neuer Rechner ohne Baseline startet mit `unknown`. Ein unveränderter Hash bestätigt keine fachliche Vollständigkeit. Eine Prüfung kann bei unverändertem fachlichem Ergebnis die Baseline aktualisieren, ohne die Feature-Datei künstlich zu ändern.

Für Änderungsprüfungen wird bei Session-Start beziehungsweise beim ersten Zugriff der Arbeitsstand erfasst. Der spätere Vergleich berücksichtigt auch Änderungen, die im Verlauf bereits committed wurden. Staged, unstaged und nicht ignorierte neue Dateien werden einbezogen. Bereits vorhandene Änderungen werden separat ausgewiesen und nicht automatisch dem aktuellen Auftrag zugerechnet. Laufzeitdaten, Git-internes Material und Build-Artefakte lösen keine fachliche Neuanalyse aus.

Git-Befehle werden mit Argumentlisten und festen erlaubten Operationen aufgerufen. Der Kern scannt nicht bei jedem Prompt den gesamten Quellcode und führt keine Repository-Skripte aus.

## 7. MCP-Vertrag

Der Server läuft lokal über STDIO. Diagnoseausgaben gehen an STDERR; STDOUT bleibt dem MCP-Protokoll vorbehalten.

| Werkzeug | Eingabe | Ergebnis |
| --- | --- | --- |
| `network_context` | Optionale Anfrage, IDs und Pfade, Detailstufe, Budget und Seitenoffset | Rangfolge, Summaries oder Kernpunkte, Coverage- und Aktualitätshinweise; ohne Suchargumente eine paginierte Übersicht |
| `network_impact` | Ausgangs-IDs/Pfade, Richtung, Tiefe und Budget | Potenziell betroffene Features mit erklärbaren Pfaden |
| `network_update` | Erwarteter Stand, Upserts/Löschungen und überprüfte Referenzstände | Validierter Änderungssatz oder Konflikt; keine versteckten Commits |
| `network_check` | Modus `summary` oder `full`, optionaler Session-/Änderungsbezug | Im Summary-Modus gespeicherte Zähler und bekannte offene Prüfungen; im Full-Modus zusätzlich frische Struktur-/Referenzprüfung und unbekannte Änderungsdateien |
| `network_bootstrap` | Aktion `start`, `next`, `checkpoint` oder `status`; optionale Bereichseingrenzung und Analysegrenzen | Dateiinventar, nächste begrenzte Analyseaufgabe oder gespeicherter Fortschritt; keine eigene Modellanalyse |

`network_context` liefert zunächst IDs und Summaries; für ausgewählte Features werden Kernpunkte und Referenzen nachgeladen. Das Werkzeug bietet zusätzlich die Möglichkeit, einzelne umfangreiche Ergebnisse mit einem Offset fortzusetzen.

Fortsetzungsverweise enthalten neben dem Offset den Fingerprint des zugrunde liegenden Netzwerkstands und die ursprünglichen Abfrageparameter. Hat sich das Netzwerk inzwischen verändert, wird `stale_cursor` zurückgegeben und die Abfrage neu begonnen. Seiten aus unterschiedlichen Ständen dürfen nicht unbemerkt vermischt werden.

Alle Werkzeuge liefern strukturierte Resultate und kurze lesbare Erläuterungen. Fehler erhalten stabile Codes wie `invalid_schema`, `missing_target`, `unsafe_path`, `write_conflict` und `pending_recovery`. Unsicherheit, fehlender Kontext und truncation sind Ergebniszustände, keine generischen internen Fehler.

Ein MCP-Prozess ist an genau einen explizit konfigurierten Projektroot gebunden. Hook-Prozesse verwenden das vom Host übergebene `cwd` und bestimmen den nächsten gültigen Netzwerkroot innerhalb des aktuellen Git-Checkouts. Mehrdeutige Roots führen zu einem Hinweis statt zur Auswahl eines fremden Projekts. Installationspfad des Plugins, Projektroot und beschreibbare Laufzeitdaten sind getrennte Orte. Bei einem Projekt ohne Netzwerkmarker melden lesende Werkzeuge `not_initialized`. Der agentengeführte Einstieg erzeugt `_meta.yaml` zusammen mit dem ersten Feature über einen expliziten Initialisierungsmodus von `network_update`; normale Kontextabfragen legen keine Dateien an.

## 8. Speicherung und parallele Arbeit

Agenten übergeben die beim Lesen erhaltenen Inhaltsfingerprints für alle veränderten Feature-Dateien. Schreiben erfordert Übereinstimmung mit dem tatsächlichen aktuellen Stand. Bei Konflikt wird nichts überschrieben; der Agent liest erneut ein und entscheidet über die Zusammenführung.

Der Kern validiert den gesamten geplanten Endzustand, insbesondere neue oder gelöschte Beziehungsziele. Ein gemeinsam bearbeiteter Änderungssatz wird unter einem kurzen exklusiven Netzwerkschreiblock ausgeführt. Laufzeitdaten bleiben nach Projekt und Session getrennt.

Dateien werden zuerst temporär geschrieben. Ein kleines lokales Journal hält erwartete Ausgangsfingerprints und neue Inhalte fest. Einzelne Ersetzungen erfolgen per atomarem Rename. Vor dem nächsten schreibenden Zugriff wird ein unterbrochener Änderungssatz unter Lock vervollständigt, sofern alle Dateien noch entweder dem erwarteten Ausgangs- oder Zielstand entsprechen. Bei zwischenzeitlicher manueller Änderung wird `pending_recovery` gemeldet und nichts blind überschrieben. Rein lesende Nutzerbefehle melden eine offene Transaktion, statt selbst eine schreibende Wiederherstellung auszuführen oder einen inkonsistenten Zustand als gültig auszugeben.

Manuelle Bearbeitung der YAML-Dateien bleibt möglich. Sie nimmt nicht am Tool-Lock teil; unerwartete Veränderungen müssen deshalb beim Speichern beziehungsweise bei Wiederherstellung als Konflikt behandelt werden. Der Kern verspricht keine atomare Transaktion für externe Editoren oder Git-Operationen.

Tool-Leser übernehmen ihren Netzwerksnapshot unter demselben kurzen Lock, prüfen das Journal und geben den Lock vor Graphabfrage oder Codeprüfung wieder frei. Dadurch kann kein Tool-Schreibvorgang zwischen Journalprüfung und Snapshotübernahme einen Mischstand erzeugen. Bei externen Änderungen während des Einlesens wird der Snapshot verworfen und begrenzt erneut gelesen; bleibt er instabil, wird ein Konflikt gemeldet. Ein Lock darf nur bei nachweislich beendetem Besitzer zurückgewonnen werden; bei unklarem Besitzer gilt ein begrenzter Wartezeitraum mit `lock_busy`, kein blindes Entfernen.

## 9. Automatischer Arbeitsablauf

1. Der Nutzer beschreibt seine Änderung wie bisher.
2. Der Agent erhält einen kurzen Hinweis auf FeatureNetwork und fragt passenden Kontext ab.
3. Relevante Beziehungspfade liefern mögliche Auswirkungen und gezielte Code-/Testreferenzen.
4. Der Agent prüft die tatsächlichen Codestellen, implementiert testgetrieben und testet die fachlichen Auswirkungen.
5. Der Agent passt Summary, Kernpunkte, Referenzen und Beziehungen anhand des Ergebnisses an und bestätigt überprüfte Referenzstände.
6. Die Abschlussprüfung erkennt offene Netzwerkprüfungen. Falls der Host es unterstützt, fordert sie höchstens einmal pro Arbeitsdurchlauf zur Nacharbeit auf.
7. Bleiben Probleme offen, werden sie konkret ausgewiesen. Ein strukturell gültiges Netzwerk wird nicht als fachlich vollständig bezeichnet.

Eine unveränderte Feature-Datei kann nach einer nachvollziehbaren Prüfung korrekt sein. Der Agent muss keine kosmetischen Netzwerkänderungen erzeugen. Änderungen ohne fachlichen Effekt werden mit einer begründeten Prüfentscheidung abgehandelt; Dateiendung oder Kommentaränderung allein beweisen nicht zuverlässig Harmlosigkeit.

Die automatische Pflege ist ein angeleiteter und überprüfter Agentenablauf. Hooks können fehlende Pflege erkennen, aber keine fachliche Interpretation garantieren. Lesende Aufträge ohne Codeänderungen lösen keine Schreibpflicht aus.

## 10. Plugin-Paket und Hostadapter

Das Release enthält einen gemeinsamen vorgebauten Node-Kern und MCP-Server, portable Skills/MCP-Konfiguration sowie kleine Hostadapter. Nutzer müssen beim Agentenstart weder TypeScript kompilieren noch Pakete aus dem Internet nachladen.

### Sichtbare Nutzerbefehle und Bedienung

Alle Nutzerbefehle verwenden das Präfix `feature-network-`. Das Plugin registriert sie als benannte Skills mit kurzen verständlichen Metadaten und ergänzt nötige Hostspezifika in den Adaptern. In der lokalen Codex-Mac-App sollen sie nach Eingabe von `/feature-net` gemeinsam im nativen Vorschlagsmenü erscheinen. Die Befehle sind zusätzliche Einstiegsmöglichkeiten für Kontrolle und Transparenz; normale Entwicklungsaufträge verwenden die Kontextabfrage und Netzwerkpflege weiterhin automatisch.

| Nutzerbefehl | Kurzbeschreibung für das Vorschlagsmenü | Verhalten und MCP-Zuordnung |
| --- | --- | --- |
| `/feature-network-init` | Fachliches Gedächtnis aus dem Projekt aufbauen oder fortsetzen. | Explizite Codeanalyse in begrenzten Paketen über `network_bootstrap`, Speicherung über `network_update`; keine Produktcodeänderungen. |
| `/feature-network-status` | Überblick über Gedächtnis, Analysefortschritt und offene Prüfungen anzeigen. | `network_check` im Modus `summary` und `network_bootstrap status`; keine neue Codeanalyse oder Fortschrittsänderung. |
| `/feature-network-show` | Gespeichertes Wissen zu einem Feature anzeigen — beschreiben oder aus der Übersicht auswählen. | `network_context` für Suche, Übersicht und Details; keine Codeanalyse oder Netzwerkaktualisierung. |
| `/feature-network-impact` | Mögliche Auswirkungen einer beschriebenen Änderung untersuchen. | Natürliche Beschreibung über `network_context` zuordnen, danach `network_impact`; Ergebnis mit Beziehungspfaden und Prüfhinweisen, keine Umsetzung oder Aktualisierung. |
| `/feature-network-check` | Gedächtnis auf Konsistenz und mögliche Veralterung prüfen. | `network_check` im Modus `full`; meldet Befunde ohne Reparatur, Feature-Schreibzugriff oder fachliche Neubestätigung. |
| `/feature-network-sync` | Gedächtnis gezielt mit geändertem Code abgleichen und aktualisieren. | Frische Prüfung, gezielte Codelektüre durch den Agenten, anschließend `network_update`; kein impliziter vollständiger Neuaufbau. |

Status und Anzeige dürfen wegwerfbare Leseindizes nutzen, verändern aber keine Feature-Dateien, Analysecheckpoints oder bestätigten Referenzbaselines. `status` bezeichnet gespeicherte Aktualitätshinweise als zuletzt bekannt; es behauptet keine frisch geprüfte Codeaktualität. `check` darf technische Prüfergebnisse speichern, aber keine zuvor geänderte Referenz ohne fachliche Prüfung als bestätigt markieren. Eine schreibende Wiederherstellung offener Transaktionen wird nicht heimlich durch einen lesenden Nutzerbefehl ausgeführt: Solche Befehle melden stattdessen `pending_recovery`.

`sync` bearbeitet standardmäßig die gegenüber vorhandenen Prüfständen geänderten Referenzen und aktuell unbekannten Änderungsdateien; eine natürlich beschriebene Eingrenzung kann den Bereich verkleinern. Dateien ohne verlässliche Baseline bleiben als unklar markiert und werden nur im ausdrücklich ausgewählten Bereich analysiert. Fachliche Erweiterung, Präzisierung oder Verkleinerung kann Kernpunkte und Beziehungen verändern. Unveränderte fachliche Ergebnisse erzeugen keine kosmetischen YAML-Änderungen. Die bestehende Konfliktprüfung und das Bewahren manueller Arbeit gelten uneingeschränkt.

### Feature-Anzeige ohne technische Vorkenntnisse

Der Nutzer muss keine Feature-ID oder Codesymbole kennen. Die folgenden Eingaben sind gleichberechtigte Einstiegsmöglichkeiten:

```text
/feature-network-show Benutzerprofil
/feature-network-show alles zur Wiederherstellung
/feature-network-show
```

Der laufende Agent übersetzt natürliche Beschreibungen in Suchbegriffe für das gespeicherte Netzwerk. Eine exakte Feature-ID ist ein optionaler direkter Treffer; ein Code-Symbol ist keine notwendige Eingabe. Der Agent darf Angaben aus dem vorhandenen Gespräch zur Suchzuordnung verwenden, aber kein nicht gespeichertes Feature als gefunden darstellen.

- **Eindeutiger passender Treffer:** Das Feature direkt mit Summary, Kernpunkten, Referenzen und Beziehungen anzeigen. Hypothesen und bekannte Aktualitätsgrenzen bleiben sichtbar.
- **Mehrdeutige Suche:** Höchstens fünf passende Kandidaten mit verständlicher Summary zur Auswahl anbieten. Die Antwort des Nutzers kann sich auf Beschreibung oder Auswahlnummer beziehen. Bei größeren Treffermengen die Suche eingrenzen oder weitere Kandidaten nachladen; keine willkürliche Auswahl.
- **Ohne Suchargument:** Eine kompakte Übersicht mit höchstens zehn IDs und Summaries pro Seite zeigen. Details werden erst nach Auswahl geladen. Bei leerem Netzwerk auf den Initialisierungsbefehl verweisen.
- **Breite thematische Anfrage:** Mehrere passende Features dürfen als kompakte Übersicht erscheinen; vollständige Detailtexte erst gezielt nachladen. Eine thematische Anfrage muss nicht künstlich auf ein einziges Feature reduziert werden.
- **Kein belastbarer Treffer:** Die Wissenslücke erklären und zu einer anderen Beschreibung beziehungsweise `init` oder `sync` führen. `show` beginnt keine automatische Codeanalyse und erfindet keine Inhalte.

Das Plugin baut keinen eigenen Auswahl-Editor. Vorschlagsmenü und Befehlserkennung kommen vom Host; Feature-Auswahl und Eingrenzung können im normalen Gespräch erfolgen. Es gibt in v1 keine zusätzlichen Befehle zum manuellen Anlegen, Löschen oder Fortsetzen einzelner Features. `init` übernimmt Wiederaufnahme; Hilfe und Beispiele stehen in den Befehlsbeschreibungen und der README.

Die benannten Befehls-Skills beschreiben ihren expliziten Nutzereinstieg; nur der allgemeine Pflege-Skill ist für automatische Entwicklungsaufträge vorgesehen. Insbesondere darf ein bloßer Treffer auf die Beschreibung von `init` keine Vollanalyse starten. Rein lesende Nutzerbefehle bleiben auch bei aktiven Abschluss-Hooks lesend und lösen keine Nacharbeit zur Netzwerkpflege aus.

Bevorzugte Struktur:

```text
plugin/
  plugin.json
  mcp.json
  skills/feature-network/SKILL.md
  skills/feature-network-init/SKILL.md
  skills/feature-network-status/SKILL.md
  skills/feature-network-show/SKILL.md
  skills/feature-network-impact/SKILL.md
  skills/feature-network-check/SKILL.md
  skills/feature-network-sync/SKILL.md
  dist/
  hooks/hooks.json
  com.github.copilot/hooks/hooks.json
```

Das Manifest verwendet Agent Plugins 1.0. OpenAI-spezifische Einstellungen stehen in `extensions.com.openai`; Copilot-Hooks liegen im Copilot-Namespace. Die reale STDIO-Projektbindung und Variablenexpansion werden je Host getestet. Falls ein Client keine zuverlässige projektabhängige MCP-Bindung aus einem global installierten Paket unterstützt, erzeugt der lokale Setup-Helfer eine explizite Projektkonfiguration. Er erhält bestehende Einstellungen und benötigt keine täglichen Nutzerkommandos. Projektwurzeln werden nicht als persönliche absolute Pfade in das veröffentlichte Paket eingebaut.

### Öffentliche Open-Source-Verteilung über Git

Das öffentliche Repository enthält den gemeinsamen Kern, die Hostadapter, Tests, eine ausschließlich synthetische Demo und die zum Bauen benötigten Paketmetadaten einschließlich Lockfile. Eine `README.md` beschreibt Zweck, Voraussetzungen, unterstützte Hosts und konkrete Installations-, Update-, Build- und Testbefehle. Kompakte Hinweise für Beiträge erklären lokale Prüfung und Änderungen an Schema oder Hostverträgen.

Vor der ersten öffentlichen Veröffentlichung wird eine vom Projekteigentümer ausgewählte Open-Source-Lizenz als `LICENSE` aufgenommen und in Paket- sowie Plugin-Metadaten konsistent angegeben. Die konkrete Lizenz wird separat festgelegt; diese Spezifikation trifft keine eigenmächtige Lizenzentscheidung. Lizenzen mitgelieferter Abhängigkeiten werden berücksichtigt.

Releases verwenden semantische Versionen und Git-Tags nach dem Muster `v0.1.0`. Ein Release-Tag enthält neben den Quellen das vollständig gebaute `plugin/`-Verzeichnis. Damit starten Installationen aus diesem Git-Stand ohne TypeScript-Kompilierung oder Paketdownload beim Agentenstart. Zusätzlich wird dasselbe Plugin als Release-Archiv angeboten. Der Entwicklungszweig enthält die Quellen und einen dokumentierten lokalen Buildablauf; er wird nicht als fertig gebautes Release beworben.

Die Release-Prüfung baut aus einem frischen Checkout mit festgelegter Node-Version und Lockfile, validiert Paket und Marketplace-Katalog und testet die Installation aus dem tatsächlichen Release-Verzeichnis beziehungsweise Archiv. Gebaute Dateien müssen den Quellen desselben Tags entsprechen. Das Paket enthält weder lokale Projektpfade noch private Netzwerke oder Laufzeitdaten. Versionshinweise benennen Änderungen, kompatible Hostversionen und erforderliche Schema- oder Hook-Anpassungen.

Copilot erhält eine dokumentierte Git-/Marketplace-Installation; Codex zunächst den dokumentierten lokalen Installationsweg nach Bezug aus Git oder dem Release-Archiv. Ein öffentlicher Git-Release setzt keine Aufnahme in die Plugin-Verzeichnisse der Anbieter voraus. Die Hostregeln für Vertrauen und Organisationsrichtlinien bleiben wirksam.

Die öffentliche Bereitstellung ist ein Produktziel. Das vom Nutzer angelegte Repository ist [sl4ng3r/feature-network](https://github.com/sl4ng3r/feature-network); lokal ist `git@github.com:sl4ng3r/feature-network.git` als `origin` eingerichtet. Lizenzwahl und ein tatsächlicher Push beziehungsweise öffentlicher Release bleiben an die entsprechende Nutzeranweisung gebunden.

### Codex in der lokalen Mac-App

`SessionStart` gibt einen kurzen Ablaufhinweis. `UserPromptSubmit` kann gezielten Kontext bereitstellen. `Stop` prüft offene Arbeit und fordert bei Bedarf einmal eine Fortsetzung an. Die Rekursionssicherung berücksichtigt die vom Host gemeldete Fortsetzung sowie den lokalen Sessionstand.

Das Paket wird zunächst lokal/manuell installiert. OpenAI dokumentiert Lifecycle-Hooks für manuell installierte Desktop-Plugins; solche Pakete sind derzeit nicht für das öffentliche Plugin-Verzeichnis zugelassen. Hook-Definitionen benötigen eine explizite Host-Vertrauensprüfung; ein Plugin-Update kann eine erneute Prüfung auslösen. FeatureNetwork umgeht diese Host-Regeln nicht. [OpenAI: Plugin-Paket und Hooks](https://developers.openai.com/plugins/build/plugins), [Codex: Hook-Vertrag](https://learn.chatgpt.com/docs/hooks)

### GitHub Copilot CLI

`sessionStart` liefert einen kurzen Skill-/MCP-Hinweis, `userPromptSubmitted` erfasst den Beginn des Arbeitsdurchlaufs, und `agentStop` prüft ausstehende Pflege. Ein normaler Command-Hook für `userPromptSubmitted` kann laut Referenz keinen Kontext oder geänderten Prompt zurückliefern. Der Adapter verlässt sich deshalb auf Skill/MCP und den Session-Start; keine vorgetäuschte Prompt-Injektion. Die Abschlussfortsetzung ist auf eine begrenzt. [GitHub: Hook-Vertrag](https://docs.github.com/en/copilot/reference/hooks-reference)

Die CLI kann ein Plugin aus einem lokalen Verzeichnis installieren. Das Paket folgt den dokumentierten festen Pfaden für Skills, MCP und Copilot-Hooks. [GitHub: Plugin-Referenz](https://docs.github.com/en/copilot/reference/copilot-cli-reference/cli-plugin-reference)

### GitHub Copilot App

Die App ist ein eigenständiges Abnahmeziel: Plugin-Discovery, MCP-Start, Skill-Laden und tatsächlich verfügbare Hook-Ereignisse werden separat geprüft. Die App dokumentiert Plugins und übernimmt für Repository oder CLI konfigurierte Skills/MCP-Server. Ein kleiner mitgelieferter Marketplace-Katalog dient der App-Installation; Repository-URL und Installationsweg werden mit dem realen Release dokumentiert, ohne einen Git-Remote zu erfinden. [GitHub: Anpassung der Copilot App](https://docs.github.com/en/copilot/how-tos/github-copilot-app/customize-github-copilot-app)

Ein erfolgreicher CLI-Test gilt nicht als erfolgreicher App-Test. Sollte eine konkrete App-Version einzelne Hooks nicht anbieten, wird der erreichbare Funktionsumfang ausgewiesen; Skill und MCP bleiben nutzbar, aber die fehlende automatische Abschlussprüfung wird nicht als implementiert gemeldet. Beide Copilot-Oberflächen bleiben verbindliche Lieferziele, auch wenn ein externer Live-Test noch aussteht.

Organisationsrichtlinien können Plugin-/Hook-Nutzung beschränken. Installation respektiert diese Regeln. Weder Arbeitgeber-Repositories noch globale Nutzerkonfigurationen werden ohne eine passende konkrete Installationsanweisung verändert.

## 11. Initialisierungsbefehl für bestehende Projekte

### Nutzereinstieg

Das Plugin liefert einen ausdrücklich aufrufbaren Skill namens `feature-network-init`. Sein Auftrag ist, das fachliche Netzwerk des aktuellen Projekts aus Code, Tests und vorhandener Dokumentation aufzubauen. Er ist von der automatisch verwendeten Pflege des bereits vorhandenen Netzwerks getrennt. Ein umfassender Projektlauf beginnt nur durch diesen expliziten Nutzerauftrag, nicht bei jedem normalen Entwicklungswunsch.

Für Copilot CLI ist `/feature-network-init` der vorgesehene Aufruf eines benannten Skills. In der lokalen Codex-Mac-App soll der aktivierte Plugin-Skill im nativen Slash-Menü erscheinen: Nach Eingabe von `/feature-net` wird `feature-network-init` mit einer kurzen verständlichen Beschreibung als auswählbarer Treffer angeboten. Auswahl und Ausführung starten denselben Initialisierungsablauf. OpenAI dokumentiert aktivierte Skills im Slash-Menü und Filterung durch Weitertippen. `$feature-network-init` beziehungsweise die Skill-Auswahl bleiben zusätzliche native Einstiegsmöglichkeiten, insbesondere auf anderen Codex-Oberflächen. [GitHub: Skill-Aufruf in der CLI](https://docs.github.com/en/copilot/how-tos/copilot-cli/customize-copilot/add-skills), [OpenAI: Desktop-Slash-Menü](https://learn.chatgpt.com/docs/reference/slash-commands), [OpenAI: Skill-Aufruf](https://learn.chatgpt.com/docs/build-skills)

Der Name `feature-network-init` und das gemeinsame Präfix `feature-network-` sind verbindlich. Die Vorschlagsliste selbst gehört zur Oberfläche des Hosts; FeatureNetwork liefert die registrierten Skills samt Metadaten. Das Plugin implementiert keinen eigenen Editor oder eigenen Autocomplete-Dienst. Ein expliziter Initialisierungsaufruf darf nicht allein durch Auswahl eines Vorschlags vorzeitig starten. Die normale automatische Pflege bleibt ohne manuelle Befehle nutzbar.

Auch in der Copilot App muss dieser Einstieg explizit nutzbar sein. Die konkrete Darstellung im Command-Picker wird im App-Live-Test geprüft; die Dokumentation der eingebauten App-Slash-Commands allein belegt keine Registrierung unseres eigenen Befehls. Der benannte Skill bleibt über eine ausdrückliche Anfrage zum Aufbau des Gedächtnisses aufrufbar. Die reale App-Anleitung nennt den geprüften Einstieg. [GitHub: App-Slash-Commands](https://docs.github.com/en/copilot/reference/github-copilot-app-reference/slash-commands)

### Schrittweiser Aufbau

1. **Inventar:** Der Kern erfasst Git-verwaltete und nicht ignorierte neue Dateien im aktuellen Projekt. Abhängigkeiten, generierte Builddateien, binäre Assets, Git-Metadaten, Laufzeitdaten und sensible Dateien wie lokale `.env`-Dateien werden ausgeschlossen. Konfigurierbare Bereichseingrenzungen und Ausschlüsse werden gespeichert und im Bericht ausgewiesen. Eine `.env.example` darf als bereinigte Konfigurationsdokumentation berücksichtigt werden. Eingebettete Repositories und Submodule werden als eigenständige, zunächst ausgelassene Bereiche gemeldet.
2. **Orientierung:** Der Agent liest die vorhandene Architektur- und Projektdokumentation sowie relevante Einstiegspunkte. Er identifiziert fachliche Bereiche als Kandidaten. Eine Verzeichnisstruktur allein ist kein Nachweis für ein Feature und erzeugt keine endgültigen fachlichen Aussagen.
3. **Analysepakete:** Der Kern gibt dem Agenten deterministisch sortierte, begrenzte Dateipakete. Der Standard ist höchstens zwanzig Dateien und insgesamt höchstens 64 KiB an vorgesehener Textmenge je Paket; umfangreiche Dateien werden in wiederaufnehmbare Ausschnitte geteilt. Der Kern liefert Pfade und Umfang, die Codelektüre erfolgt durch die normalen Werkzeuge des Agenten. Es wird kein vollständiger Repository-Inhalt in eine einzige MCP-Antwort geladen.
4. **Feature-Erfassung:** Der Agent verfolgt konkrete fachliche Abläufe und erfasst Features mit Summary, Kernpunkten, Codereferenzen und nachvollziehbaren Quellen. Fachlich zusammengehörige Dateien können einem Feature zugeordnet werden; technische Hilfsdateien benötigen kein künstliches eigenes Feature.
5. **Beziehungen:** Belegte Zusammenhänge werden erfasst, unsichere als Hypothesen markiert. Ein zusätzlicher Abgleich untersucht Beziehungen zwischen den erfassten Bereichen anhand der kompakten Zwischenergebnisse und gezielter Codelektüre. Ziele müssen bereits vorhanden sein oder im selben validierten Änderungssatz angelegt werden.
6. **Checkpoint:** Nach jedem Paket werden Features über `network_update` geschrieben und anschließend der zugehörige Fortschritt bestätigt. Der Fortschritt enthält Pfade/Ausschnitte, Inhaltsfingerprints, Bearbeitungsstatus und referenzierte Feature-IDs, keine Kopien des gesamten Quellcodes. Ein Feature-Schreibkonflikt darf nicht als erledigtes Analysepaket verbucht werden.
7. **Abschluss:** Der Kern prüft Netzwerkkonsistenz und Inventarstand. Der Agent berichtet erfasste Features und Beziehungen, abgearbeitete und ausgelassene Bereiche, Hypothesen, offene Prüfungen und Analysekosten. Nicht erklärbare oder unlesbare Dateien werden als offene Prüfungen geführt, statt still als analysiert zu gelten.

### Fortschritt, Wiederaufnahme und bestehendes Wissen

Der Laufzustand liegt in `.feature-network/` und ist durch Schema-/Projektzuordnung und Dateifingerprints an den untersuchten Stand gebunden. Ein erneuter Aufruf setzt standardmäßig den vorhandenen Lauf fort und stellt inzwischen geänderte oder neue Dateien wieder in die Warteschlange. Ein Wechsel von Checkout oder Projektroot darf nicht den Fortschritt eines fremden Projekts übernehmen.

`network_bootstrap start` darf im explizit konfigurierten Projektroot bereits vor Existenz des Netzwerkmarkers das lokale Inventar und den Laufzustand anlegen. Der Marker entsteht mit dem ersten validierten Feature. Ein leeres beziehungsweise vollständig ausgeschlossenes Projekt liefert einen entsprechenden Bericht, ohne ein erfundenes Feature zu erzeugen. Checkpoints enthalten eine erwartete Laufrevision; konkurrierende Bestätigungen desselben Pakets führen zum Konflikt statt zu verlorenem Fortschritt.

Die Datei-/Ausschnittstatus sind `pending`, `analyzed`, `excluded` und `needs_review`. Ein Lauf ist technisch `completed`, wenn im gewählten Inventar keine offenen Pakete oder Prüfungen verbleiben und der bereichsübergreifende Beziehungsabgleich erfolgt ist. Das ist eine Aussage über den Bearbeitungsfortschritt, keine Garantie fachlicher Vollständigkeit; `coverage: partial` bleibt bestehen. Entfernte Dateien werden erkannt und betroffene Referenzen zur Überprüfung markiert.

V1 verarbeitet Analysepakete sequentiell. Bei Unterbrechung bleiben bereits validierte Feature-Dateien erhalten. Nach verlorenen lokalen Checkpoints darf der Agent das Inventar neu aufbauen und bestehende Features erneut abgleichen; er löscht das Netzwerk nicht. Wiederholte Läufe müssen bei unverändertem Ergebnis ohne künstliche YAML-Änderungen auskommen. Manuelle Kernpunkte und stabile IDs werden bewahrt; Entfernung oder Zusammenführung erfordert einen nachvollziehbaren fachlichen Abgleich.

Der Befehl verändert die Feature-Dateien und seinen lokalen Fortschritt. Produktcode, Datenbanken, globale Agenteneinstellungen und Git-Commits werden durch die Initialisierung nicht verändert. Der Agent führt unbekannte Projektskripte nicht allein zur Inventarisierung aus.

### Aufwand und Grenzen

Der erstmalige Aufbau benötigt echte Codeanalyse durch den laufenden Coding-Agenten und kann bei großen Projekten erhebliche Tokens und Zeit kosten. Er nutzt die bestehende Agentensession und benötigt keine zusätzliche KI-API. Fortschritt und Paketgrenzen verhindern einen unkontrollierten Kontextaufbau; sie machen die fachliche Erkennung nicht deterministisch.

Die Initialisierung enthält gespeicherte Zähler für bearbeitete Pakete und Textumfang. Vom Host verfügbare Token-/Zeitwerte werden separat ausgewiesen. Bei Hostlimits stoppt der Lauf mit gespeichertem Fortschritt und klarer Wiederaufnahmeanweisung. Es gibt keine unendliche Hook-Fortsetzung und keine automatische Vollanalyse bei späteren kosmetischen Änderungen.

## 12. Sicherheit und Datenhaltung

- Referenzen und Schreibziele werden gegen den kanonischen Projektroot geprüft; absolute Pfade, Traversal und entweichende Symlinks werden abgewiesen. Git-Metadaten, Laufzeitjournale und Plugin-Installationsverzeichnisse sind keine zulässigen fachlichen Codereferenzen.
- YAML wird als Daten behandelt. Benutzerdefinierte Tags, ausführbare Inhalte, unbegrenzte Aliasexpansion und unkontrollierte Dateigrößen sind nicht zugelassen. Pro Feature gilt eine technische Obergrenze von 64 KiB mit klarer Fehlermeldung.
- Im normalen Kontext-/Pflegeablauf öffnet der Kern nur ausdrücklich referenzierte Dateien zur Existenz-/Fingerprint-Prüfung. Beim expliziten Initialisierungslauf darf er die ausgewählten zulässigen Inventardateien zusätzlich für Umfang und Fingerprints prüfen; sensible und ausgeschlossene Dateien werden nicht gelesen. Er lädt keine Inhalte aus Geheimnisdateien automatisch in Modellkontexte. Netzwerktexte gelten als Repository-Daten und dürfen keine ausführbaren Anweisungen ersetzen.
- Schreibzugriffe bleiben auf `network-spec/` und `.feature-network/` beschränkt. Produktcode wird vom Agenten mit dessen normalen Werkzeugen geändert.
- Default-Logs enthalten Fehlercodes, Zähler und technische Laufzeiten, keine Prompts, Quellcodeinhalte oder Zugangsdaten. Benchmarks mit detaillierter Host-Telemetrie werden explizit aktiviert.
- Das Netzwerk ist Git-versioniert; lokale Caches sind wegwerfbar. Journale für offene Änderungen sind wiederherstellungsrelevante Laufzeitdaten und werden vor Cachebereinigung geschützt.
- Normale Plugin-Updates verändern keine Projekt-Feature-Dateien und überschreiben keine bestehenden Hostkonfigurationen.

## 13. Test- und Abnahmekonzept

### Kern und Speicherung

Automatisierte Tests prüfen gültige/ungültige YAML-Dateien, unbekannte Versionen, doppelte IDs, nicht existierende Ziele, Relationstypen, Hypothesen, Budgetgrenzen, stabile Sortierung, Zyklen, inverse und indirekte Pfade. Tests prüfen außerdem manuelle Änderungen, referenzierte Dateilöschung, neue unbekannte Dateien und Cache-Neuaufbau.

Schreibtests enthalten parallele Prozesse, veraltete erwartete Stände, gültige gemeinsame Lösch-/Umbenennungssätze und unterbrochene Journaltransaktionen. Pfadtests enthalten Traversal und Symlinks außerhalb des Projektroots. MCP-Tests starten einen echten STDIO-Prozess und prüfen Protokoll, Werkzeuge, Fehler und Trennung der Logausgabe.

Zusätzliche Grenztests prüfen ungültige Dateien im bestehenden Netzwerk, paralleles Lesen während einer Transaktion, externe Änderungen während der Snapshotübernahme, belegbar verwaiste beziehungsweise unklare Locks und Fortsetzungsverweise nach einer Netzwerkänderung. Ergebnisse dürfen weder defekte Daten verschweigen noch Stände vermischen.

### Fachliche Demo

Die Demo besitzt ein kleines persistentes Profilmodell, JSON-Sicherung und Wiederherstellung. Eine SQLite-Datei liegt lokal im Demo-Datenverzeichnis; sie dient ausschließlich der Demo und ist keine Speicherabhängigkeit von FeatureNetwork. Automatische Demo-Schemamigrationen werden getestet.

Der zentrale Auftrag ergänzt ein persistentes Profilfeld. Der Test muss sowohl die Impact-Hinweise auf Backup und Restore als auch einen tatsächlichen Sicherungs-/Wiederherstellungsrundlauf mit dem neuen Wert prüfen. Weitere Fälle verkleinern ein Feature, ändern einen Vertrag und lassen einen Zusammenhang zunächst unvollständig oder veraltet. Erforderliche fachliche Abhängigkeiten werden aus den Demo-Verträgen und Verhaltenstests bestimmt, nicht allein aus der im Test erzeugten Graphstruktur.

### Initialisierung

Automatisierte Tests prüfen Dateiinventar und Ausschlüsse, paketweise Verarbeitung und Ausschnittgrenzen, Checkpoints, Unterbrechung/Wiederaufnahme, geänderte und neue Dateien während eines Laufs, Schreibkonflikte und idempotente erneute Aufrufe. Bestehende manuelle Kernpunkte und Feature-IDs dürfen nicht still überschrieben oder gelöscht werden. Technisch abgeschlossene Inventarisierung und fachliche Coverage werden getrennt geprüft.

Ein agentengeführter Abnahmelauf beginnt mit der Demo ohne `network-spec/` und muss Profil, Backup und Restore mit nutzbaren Zusammenhängen erfassen. Der Sollvergleich stammt aus den fachlichen Demo-Verträgen. Reine Tests mit vorgegebenen Modellantworten beweisen nur das Protokoll und die Fortschrittsverwaltung, nicht die Qualität echter Codeanalyse.

### Hostadapter

Automatisierte Vertragstests prüfen echte dokumentierte Payloadformen, Ausgaben, Hostunterschiede, Projektbindung, Shell-Quoting, Start aus Unterverzeichnissen und maximale einmalige Fortsetzung. Pakettests prüfen Manifeste, mitgelieferte ausführbare Dateien und fehlende Runtime-Abhängigkeiten.

### Nutzerbefehle

Automatisierte Tests prüfen die Registrierung und vollständigen Metadaten aller sechs Befehle sowie ihre MCP-Zuordnung. Die Anzeige wird mit natürlichen Begriffen ohne Kenntnis einer ID, exakten IDs, leeren Suchargumenten, thematischen Mehrfachtreffern, Mehrdeutigkeit, fehlenden Treffern und paginierten Übersichten geprüft. Eindeutigkeit der rein deterministischen Trefferzuordnung und Qualität einer tatsächlichen agentengeführten sprachlichen Zuordnung werden getrennt beurteilt.

Für `status`, `show`, `impact` und `check` prüfen Tests, dass Feature-Dateien, bestätigte Referenzstände und Checkpoints unverändert bleiben und keine Codeanalyse startet. `check` darf Fingerprints zur Feststellung der Veralterung lesen; das ist keine fachliche Analyse. Ein offenes Schreibjournal führt in diesen Befehlen zu einem transparenten Hinweis. `sync` erhält eigene Tests für zielgerichtete Analyse, Erhalt manueller Kernpunkte, Konflikte, Entfernung belegbar entfallener Aussagen und unveränderte Wiederholung.

### Live-Abnahme der Befehle

Für jede der drei Zielumgebungen wird ein separater Nachweis geführt: Version, Installation, MCP-Erreichbarkeit, Skill-Aktivierung, Hook-Auslösung, expliziter Initialisierungsaufruf einschließlich Wiederaufnahme und Profil-/Backup-/Restore-Auftrag. Automatisierte Adaptertests werden als solche bezeichnet. Live-Nachweise bleiben offen, bis sie in der jeweiligen Oberfläche tatsächlich erbracht wurden; fehlende Umgebung oder Berechtigung wird als konkrete Einschränkung dokumentiert.

Für die lokale Codex-Mac-App umfasst der Live-Test außerdem: Plugin installieren und aktivieren, `/feature-net` im Composer eingeben, alle sechs Befehlseinträge mit verständlicher Beschreibung finden und auswählen, den Auftrag absenden und den tatsächlichen Ablauf nachweisen. Für `show` werden insbesondere natürliche Suche, mehrdeutige Auswahl und die Übersicht ohne Argument getestet. Ein bestandener MCP- oder Skill-Dateitest allein belegt keine erfolgreiche Auffindbarkeit im Slash-Menü. Für Copilot CLI und App werden Vorschlagsliste und Aufrufmodell ebenfalls in der tatsächlichen Oberfläche geprüft.

## 14. Performance und Vergleich

Kernbenchmarks laufen mit 100, 1.000 und 10.000 Features, unterschiedlichen Kantendichten und Zyklen. Gemessen werden kalter Start, warmer Kontext-/Impact-Zugriff, inkrementelles Update, Laufzeitverteilung, Speicherbedarf und ausgegebene Bytes. Initialer Richtwert ist eine warme Abfrage unter 100 ms bei 1.000 Features auf dem dokumentierten Referenzrechner; dieser Wert ist ein Prüfziel, keine zugesagte oder bereits gemessene Leistung.

Der Agentenvergleich nutzt identische Repository-Ausgangsstände, Aufgaben, Agenten-/Modellversionen und vergleichbare Testbedingungen. Mindestens drei Durchläufe je Bedingung und Aufgabe werden ausgewertet. Aufgaben umfassen den zentralen Profilfall, eine kosmetische Änderung und eine bisher nicht erfasste fachliche Änderung. Baseline und FeatureNetwork starten in frischen Sessions; individuelle Resultate und Streuung werden veröffentlicht.

Gemessen werden fachlich notwendige und tatsächlich erkannte Abhängigkeiten, übersehene Wirkungen, unnötige Hinweise, bestandene Verhaltenstests, Code-Lesezugriffe, gesamte Laufzeit sowie Tokenwerte, soweit der Host sie nachvollziehbar bereitstellt. Verbrauchte Modelltokens, geschätzte Kontexttokens, Ausgabebytes und gegebenenfalls zwischengespeicherte Tokens werden getrennt ausgewiesen. Nicht verfügbare Messwerte bleiben nicht verfügbar; sie werden nicht durch unmarkierte Schätzungen ersetzt.

Initialisierung und Pflege sind eigene Kostenpositionen. Die Auswertung zeigt sowohl den ersten Auftrag als auch wiederholte Nutzung mit amortisierten Initialisierungskosten. Weniger Token bei schlechterer fachlicher Erkennung ist kein erfolgreicher Produktnachweis. Negative oder uneindeutige Ergebnisse werden berichtet.

## 15. Liefergegenstände und nächste Freigabe

Die Umsetzung liefert Quellcode, automatisierte Tests, Demo, Benchmark-Harness, ein vorgebautes installierbares Plugin-Paket mit Marketplace-Katalog, Installations-/Updatehinweise und eine kompakte Projekt-`AGENTS.md`. Zur öffentlichen Git-Verteilung gehören README, Beitragshinweise, die vom Nutzer ausgewählte Lizenz und ein geprüftes Verfahren für versionierte Git-/Archiv-Releases. Das Release dokumentiert tatsächlich geprüfte Host- und Node-Versionen und trennt automatisierte Tests von Live-Nachweisen.

Diese Spezifikation wird zuerst schriftlich geprüft. Nach Freigabe folgt ein eigener Implementierungsplan mit testgetriebenen Arbeitsschritten und einer Auswahl der Ausführungsmethode. Produktcode, Dependencies, Plugin-Installation und Änderungen an Agentenkonfigurationen beginnen erst nach diesem Planungsschritt.

## 16. Selbstprüfung der Spezifikation

- Nutzerentscheidungen einschließlich Summary/Kernpunkten, Copilot CLI/App und Docker-Ausnahme sind übernommen.
- Fachliche Aussagen, Hypothesen, Aktualität und Coverage sind getrennt.
- Graphrichtung, Traversierung, Budgets, Schreibkonflikte und Wiederherstellung sind festgelegt.
- Copilot-Prompt-Hooks werden nicht wie Codex-Prompt-Hooks behandelt; App-Support wird separat geprüft.
- Initialisierung ganzer Bestandsprojekte gehört zu v1; Bearbeitungsstatus, Wiederaufnahme und Grenzen der fachlichen Coverage sind ausdrücklich getrennt. Weitergehende AST-/Parallelisierungsoptimierungen folgen später.
- Öffentliche Git-Verteilung, Release-Pakete und Installationen durch andere Nutzer sind vorgesehen; tatsächliche Veröffentlichung und Lizenzwahl sind separate Schritte.
- Die sechs freigegebenen Nutzerbefehle, ihre lesenden beziehungsweise schreibenden Wirkungen und die Feature-Anzeige ohne ID-/Symbolkenntnis sind festgelegt.
- Abschließender Check: Verhalten bei ungültigen Bestandsdaten, konsistente Lesesnapshots und standgebundene Pagination sind präzisiert; Node-Voraussetzung und Nutzer-Repository sind konkretisiert. Host-Live-Nachweise, Leistungsnachweis und Lizenzwahl bleiben ausgewiesene spätere Abnahmen.
- Es gibt keine Platzhalter für das Kernverhalten und keine Behauptung bereits bestandener Produkt- oder Live-Tests.

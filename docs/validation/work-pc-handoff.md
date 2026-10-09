# Copilot CLI und GitHub Copilot App: Test auf dem Arbeitsrechner

Gemeint ist die eigenständige [GitHub Copilot App](https://github.com/features/ai/github-app), nicht die Copilot-Erweiterung einer IDE. Beide Copilot-Oberflächen stehen laut Nutzer nur auf seinem Arbeitsrechner zur Verfügung. Die folgenden Schritte sind eine vorbereitete Abnahme; sie wurden dort noch nicht ausgeführt.

## Paket und isoliertes Demoprojekt

1. Das lokal vorbereitete Archiv `feature-network-0.1.0.tar.gz` samt zugehörigem `release-report.json` übertragen. Den SHA-256 des Archivs mit `archiveSha256` aus diesem Bericht vergleichen, dann in einen eigenen stabilen Ordner entpacken. Die Vorbereitung ist keine Veröffentlichung eines GitHub-Releases.
2. `node --version` muss `v24.*` liefern. Das Paket verändert die globale Node-Installation nicht. Copilot CLI und App-Version jeweils separat notieren.
3. Für Copilot den vorgebauten Ordner **`plugin/`** verwenden. **`codex-plugin/`** ist die getrennte Codex-Auslieferung. Das Plugin benötigt kein `npm install`.
4. `source/demo/scenarios/pre-locale/` in einen neuen, unabhängigen Demoordner kopieren. Darin `git init`, `git add .` und `git commit -m "Synthetic FeatureNetwork demo"` ausführen. Ausschließlich dieses synthetische Projekt für den ersten Test verwenden. Persönliche oder Arbeitgeber-Repositories bleiben unberührt.

## Copilot CLI

`PLUGIN` und `DEMO` unten durch die vollständigen Pfade des entpackten portablen Plugins und des neuen Demoordners ersetzen; keine Pfadvariablen des Hosts voraussetzen.

```sh
copilot --version
copilot plugin install "PLUGIN"
node "PLUGIN/dist/cli.mjs" setup --host copilot --project-root "DEMO" --dry-run
```

Die Vorschau zeigt die festen Zielpfade `.mcp.json` und `.github/hooks/feature-network.json`, die Ergänzungen und einen SHA-256-Receipt. Nach Prüfung genau diesen Receipt übernehmen:

```sh
node "PLUGIN/dist/cli.mjs" setup --host copilot --project-root "DEMO" --approve-and-apply RECEIPT
```

Eine bestehende Registrierung führt zu einem Konflikt und wird nicht überschrieben. Keine `--force`-Option und keine manuelle Ersetzung fremder Konfiguration verwenden. Im Demoordner eine neue Copilot-Sitzung starten; installierte Skills, MCP-Werkzeuge und deren Freigaben im tatsächlichen Host prüfen.

## Eigenständige GitHub Copilot App

Den neuen Demoordner in der App öffnen. Unter **Customize → Skills** und **Customize → MCP** die verfügbare Integration prüfen. GitHub dokumentiert, dass Skills und MCP-Konfiguration aus Repository beziehungsweise CLI auch in der App verfügbar sind. Das ist eine dokumentierte Route, noch kein Live-Nachweis auf diesem Rechner. [GitHub-Anleitung](https://docs.github.com/en/copilot/how-tos/github-copilot-app/customize-github-copilot-app)

**Customize → Plugins** zeigt installierbare Marketplace-Plugins. Für einen zusätzlichen Marketplace beschreibt GitHub eine GitHub-Repository- oder Git-URL. Die bloße Source-Repository-URL von FeatureNetwork ist aktuell kein zugesagter vorgebauter Installationskanal: generierte Laufzeitdateien werden nicht in Git eingecheckt, und ein öffentliches Release wurde noch nicht veröffentlicht. Deshalb zunächst die lokale CLI-Installation und die App-Skill-/MCP-Erkennung prüfen. Falls sie in der tatsächlichen App-Version fehlen, den Befund festhalten; keine Unterstützung aus dem CLI-Ergebnis ableiten.

## Kurzer Funktionstest in beiden Oberflächen

Jeweils eine frische Sitzung verwenden und Befunde getrennt festhalten:

- **Erkennung:** Hauptskill und sechs explizite Befehle `feature-network-init/status/show/impact/check/sync`; fünf MCP-Werkzeuge `network_context/impact/update/check/bootstrap`. Die native Aufrufmethode des Hosts verwenden und notieren; ein Codex-Slash-Menü ist keine Zusage für Copilot.
- **Lesen:** `show` ohne Argument, anschließend „Zeige das Benutzerprofil“. Übersicht beziehungsweise passende Feature-Details müssen ohne interne ID-Kenntnis erscheinen; teilweise Abdeckung und unbekannte Aktualität dürfen nicht verschwinden. `impact` für das Benutzerprofil muss eingehende Backup-/Restore-Beziehungen berücksichtigen.
- **Prüfen:** `check` meldet offene Entscheidungen, ändert aber keine Netzwerk-YAML. Die vier Demo-Quelldateien bleiben ebenfalls unverändert.
- **Pflegen:** Nur in einer zweiten Demokopie den Auftrag aus `source/demo/README.md` verwenden: `locale: 'de-DE'` durch SQLite-Speicherung, Migration und Backup/Restore erhalten. Zuerst betroffene Beziehungen prüfen; nach der Änderung Summary, Kernpunkte und Beziehungen anhand des Codes aktualisieren. Wiederholtes `sync` soll identische YAML bewahren. Dies ist ein Funktionstest, kein gemessener Vergleich gegen einen Lauf ohne Plugin.
- **Initialisieren:** In einer weiteren Demokopie nur `network-spec/` entfernen und `init` aufrufen. Begrenzte Analyse, sichtbare Teilabdeckung und Wiederaufnahme prüfen. Vorhandene manuelle Aussagen später beim erneuten Lauf bewahren. `init` selbst darf keinen Produktcode oder Datenbankinhalt ändern.

Copilot liefert aktuell keinen verlässlich dokumentierten Turn-Identifier für die erzwungene Stop-Fortsetzung. Der Adapter informiert am Ende; die Pflege muss durch den Skill/MCP-Ablauf abgeschlossen werden. Eine erfolgreiche manuelle Aktualisierung beweist daher keine automatisch erzwungene Pflege. App-Hook-Ereignisse separat beobachten.

## Ergebnis zurückmelden

Benötigt werden CLI-Version, App-Version, Betriebssystem, verwendete Paketrevision und Archivhash sowie pro Oberfläche Erkennung, Lesen, Pflege und Initialisierung: bestanden, fehlgeschlagen oder nicht geprüft. Bei einem Fehler genügt zunächst die konkrete Meldung und der fehlgeschlagene Schritt. Keine Tokens, komplette Konfiguration oder Inhalte von Arbeitgeber-Projekten weitergeben.

Die ausführliche [Host-Matrix](host-matrix.md) und das [Vergleichsprotokoll](benchmark-protocol.md) bleiben maßgeblich für vollständige Abnahme und spätere Aussagen zu Qualität oder Tokenersparnis.

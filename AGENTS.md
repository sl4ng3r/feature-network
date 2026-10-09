# FeatureNetwork

## Projektstatus und Architektur

Lokales Open-Source-Plugin für Coding-Agenten: TypeScript/Node.js-Kern, STDIO-MCP, Skill und kleine Hook-Adapter. Erste Zielumgebungen sind Codex in der lokalen Mac-App, GitHub Copilot CLI und GitHub Copilot App. Claude Code folgt später.

Maßgeblicher Entwurf: `docs/superpowers/specs/2026-10-09-featurenetwork-v1-design.md`. Aktuell besteht das Projekt nur aus Entwurfsdokumentation; Produktcode, Build und Tests sind noch nicht vorhanden. Vor Implementierung sind schriftliche Spezifikationsfreigabe und Implementierungsplanung gemäß dem ausgewählten Brainstorming-Workflow erforderlich.

## Arbeitsregeln

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

Der Nutzer hat Docker Compose und Deploy Cockpit ausdrücklich vollständig ausgenommen. Auslieferung erfolgt als vorgebautes lokales Plugin-Paket; normale Updates dürfen Projektdaten und vorhandene Hostkonfigurationen nicht überschreiben. Keine absoluten Entwicklerpfade im Produktpaket. Node-Version, Installation, Update, Build und Testbefehle werden mit der Implementierung dokumentiert.

Kern und Plugins sollen öffentlich als Open Source über Git verfügbar werden. Release-Tags enthalten ein geprüftes vorgebautes Plugin-Paket; README, Lizenz, Versionshinweise und Beitragshinweise gehören zur Auslieferung. Lizenzwahl, Remote und tatsächliche Veröffentlichung benötigen konkrete Nutzerangaben beziehungsweise eine Veröffentlichungsanweisung. Releases aus frischem Checkout prüfen; keine privaten Projekt- oder Laufzeitdaten ausliefern.

FeatureNetwork besitzt derzeit keine eigene Authentifizierung. Falls später eine Anwendung mit Login-Proxy-Integration entsteht, vor Planung und Umsetzung den vollständigen Vertrag unter `/Users/alexanderstroll/Proggen/ki-applikationen/login-proxy/docs/app-integration-contract.md` lesen und einhalten.

## Derzeit verfügbare Prüfungen

- `git status --short`: vorhandene Änderungen prüfen.
- `git diff --check`: Patch auf Whitespace-Fehler prüfen.
- `git log -5 --oneline`: jüngste lokale Commits prüfen.

Es gibt aktuell keine ausführbaren Produkt-, Build- oder Testbefehle. Entwurfsprüfung nicht als bestandenen Produkttest melden.

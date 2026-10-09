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

Der Nutzer hat Docker Compose und Deploy Cockpit ausdrücklich vollständig ausgenommen. Auslieferung erfolgt als vorgebautes lokales Plugin-Paket; normale Updates dürfen Projektdaten und vorhandene Hostkonfigurationen nicht überschreiben. Keine absoluten Entwicklerpfade im Produktpaket. Node-Version, Installation, Update, Build und Testbefehle werden mit der Implementierung dokumentiert.

FeatureNetwork besitzt derzeit keine eigene Authentifizierung. Falls später eine Anwendung mit Login-Proxy-Integration entsteht, vor Planung und Umsetzung den vollständigen Vertrag unter `/Users/alexanderstroll/Proggen/ki-applikationen/login-proxy/docs/app-integration-contract.md` lesen und einhalten.

## Derzeit verfügbare Prüfungen

- `git status --short`: vorhandene Änderungen prüfen.
- `git diff --check`: Patch auf Whitespace-Fehler prüfen.
- `git log -5 --oneline`: jüngste lokale Commits prüfen.

Es gibt aktuell keine ausführbaren Produkt-, Build- oder Testbefehle. Entwurfsprüfung nicht als bestandenen Produkttest melden.

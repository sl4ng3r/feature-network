# FeatureNetwork – verbundenes Projektgedächtnis

Datum: 2026-10-14

Status: Die Richtung und die Arbeitsgrenzen wurden im Gespräch freigegeben. Dieser schriftliche Entwurf steht zur Nutzerprüfung; er ist noch keine Freigabe zur Implementierungsplanung oder Umsetzung. Produktcode und bestehende Projektinstallationen bleiben unverändert.

## 1. Ziel und vereinbarte Entscheidungen

FeatureNetwork soll bei der Arbeit an einer Anwendung relevante Auswirkungen in anderen Anwendungen erkennen helfen. Das Gedächtnis wächst während normaler Gespräche, Entscheidungen und ohnehin notwendiger Codeanalysen. Gespeichertes Wissen bleibt lesbar, versioniert und gezielt korrigierbar.

Vereinbart sind:

- Jedes Projekt besitzt sein eigenes YAML-Gedächtnis unter `network-spec/`.
- Eine lokale Verbindung ausdrücklich ausgewählter Repositories ermöglicht gemeinsame Suche und projektübergreifende Beziehungspfade.
- Die erste Ausbaustufe verwendet vorhandene lokale Checkouts. Erreichbare entfernte Repositories sind eine spätere Erweiterung; es gibt kein automatisches Klonen, Fetching oder Wechseln des Checkouts.
- Der Agent darf auftragsbezogen in verbundenen Projekten lesen und deren Gedächtnis aktualisieren. Dies erlaubt keine zusätzlichen Produktcodeänderungen, Commits, Installationen oder Konfigurationsänderungen in diesen Projekten.
- Gespräche, beschlossene Anforderungen, Schlussfolgerungen und beobachtetes Verhalten werden unterscheidbar gespeichert. Wiederholung beweist keine Richtigkeit.
- Erkenntnisse werden verdichtet; vollständige Prompts, Gesprächsverläufe und Quellcodekopien werden nicht als Gedächtnis archiviert.
- Ein gemeinsamer Index ist ableitbar und lokal. Eine zentrale Wissensdatenbank, Cloud oder eigene Modell-API ist nicht erforderlich.
- Konflikte, fehlende Projekte und veraltete Prüfstände bleiben sichtbar. Fachliche Abdeckung bleibt `partial`.

Erfolg bedeutet: Ein Agent findet einen relevanten Verbraucher in einem anderen Repository, erklärt die Beziehung, prüft gezielt notwendige Quellen und erhält diese Erkenntnis für spätere Aufträge. Ein technisch vollständiger Index allein erfüllt dieses Ziel nicht.

## 2. Ausgangspunkt und notwendige Vertragsänderungen

Der bestehende Kern hat projektgebundene MCP-Prozesse, lokale Feature-IDs, projektinterne Referenzen, einmal gespeicherte gerichtete Beziehungen, abgeleitete Gegenrichtungen, Bytebudgets und konfliktgeschützte Schreibzugriffe. Diese Eigenschaften werden weiterverwendet.

Folgende bestehende Grenzen müssen ausdrücklich geändert werden:

1. Schema 1 kennt keine stabile Projektidentität oder externen Beziehungsziele.
2. Ein Feature benötigt gegenwärtig eine bestehende Code- oder Dokumentreferenz. Eine noch nicht umgesetzte Gesprächsidee darf deshalb nicht als erfundenes Feature eingetragen werden.
3. Automatische Pflege erfordert bisher einen Entwicklungsauftrag mit tatsächlichen Änderungen. Künftig können auch auftragsbezogene Gespräche und Analysen ohne Produktänderung neue Gedächtnisinhalte erzeugen.
4. Der MCP-Prozess bleibt an sein aktives Projekt gebunden, erhält aber über eine ausdrücklich konfigurierte lokale Verbindung Zugriff auf weitere Projekte. Toolargumente dürfen keine beliebigen Dateisystemroots hinzufügen.
5. Externe Zielverfügbarkeit muss unabhängig von lokaler struktureller Gültigkeit sein. Ein fehlender Verbraucher darf das gesamte lokale Netzwerk nicht blockieren.

Diese Spezifikation beschreibt die Erweiterung; sie behauptet keine bereits vorhandene Multi-Repository- oder Host-Live-Funktion.

## 3. Architektur und Verantwortlichkeiten

| Einheit | Verantwortung |
| --- | --- |
| Projektbindung und Verbindungsregister | Freigegebene lokale Roots, Identität, Auswahl eines Checkouts und Zugriffsumfang prüfen |
| Projektspeicher | Eigene Features, Gesprächserkenntnisse, Revisionen, CAS und Wiederherstellung verwalten |
| Gemeinsamer Index | Qualifizierte Identitäten, Suchbegriffe und ein-/ausgehende Beziehungen zusammenführen |
| Aktualitätsprüfung | Quellenstände, Auflösungsfehler und offene fachliche Prüfungen unterscheiden |
| Agentenablauf | Aussagen einordnen, erforderliche Quellen lesen und kleine begründete Änderungen erstellen |
| MCP und Hostadapter | Begrenzte Werkzeuge und tatsächlich verfügbare Hostereignisse bereitstellen |

Der Kern interpretiert keine natürliche Sprache und ruft kein Modell auf. Er prüft strukturierte Angaben und technische Voraussetzungen. Der laufende Agent verantwortet die fachliche Interpretation; dessen Angaben sind keine kryptografischen Beweise.

## 4. Ablage, Identitäten und Verbindungen

```text
anwendung/
  network-spec/
    _meta.yaml
    zugangskontrolle.yaml
    knowledge/
      rollenmodell.yaml
  .feature-network/
    connections.yaml
    ... lokale Indizes, Prüfstände und Journale
```

Bestehende Feature-Dateien bleiben direkt unter `network-spec/`. `knowledge/` enthält eigenständige Gesprächs- und Analyseerkenntnisse. Lokale Laufzeitdaten bleiben Git-ignoriert. Nur bekannte Dateitypen und Verzeichnisse werden eingelesen; keine beliebige rekursive YAML-Discovery.

### 4.1 Stabile Projektidentität

Schema 2 erweitert den Marker um eine einmal vergebene UUID und einen veränderbaren Anzeigenamen:

```yaml
schema: 2
coverage: partial
project:
  id: 7d25d9c4-73ba-4e7e-b1ee-f2ffef731f34
  name: Beispiel-Verbraucher
areas: []
```

Feature-IDs bleiben die vorhandenen lesbaren Slugs. Die technische Identität eines Features ist das Paar aus Projekt-UUID und Feature-ID. Wissensdokumente haben zusätzlich die Art `knowledge`, sodass gleichnamige Dokumente keine Feature-IDs verdrängen. Anzeigenamen sind Suchhilfen, keine Schlüssel.

Umbenennen eines Repositorys oder Featuresummaries ändert keine Identität. Mehrere Worktrees desselben Projekts haben dieselbe Projekt-UUID, jedoch verschiedene lokale Bindungen. Ein absichtlich unabhängiger Fork braucht eine neue Projekt-UUID; dies erfolgt ausdrücklich und nicht automatisch.

### 4.2 Lokales Verbindungsregister

Das aktive Projekt verwendet `.feature-network/connections.yaml`. Es ordnet freigegebene Projekt-UUIDs genau einem ausgewählten kanonischen Checkout zu und enthält getrennte Rechte für Quellenlesen und Gedächtnisschreiben. Das aktive Projekt ist implizit bekannt. Lokale Pfade dürfen hier absolut sein, gelangen aber nicht in versionierte Wissensdateien oder Pluginpakete.

Verbindungen werden einmal konkret eingerichtet. Ein Dialog oder eine YAML-Beziehung allein registriert kein fremdes Verzeichnis. Fehlende Einträge bewirken keinen Scan von Nachbarverzeichnissen. Rechte gelten nur für die ausgewählten Checkouts und sind bei jeder Operation erneut zu berücksichtigen; ein geänderter Registerstand macht vorbereitete Schreibaufträge und Fortsetzungen ungültig.

Das Register gilt für den vom aktiven Projekt gestarteten Prozess. Eine Verbindung A → B erzeugt keine Konfiguration in B und keine automatische transitive Freigabe zu C. Ein Prozess in B benötigt seine eigene ausdrückliche Auswahl, um A zu lesen. Gemeinsame Indizes enthalten nur den jeweiligen freigegebenen Verbund.

Stimmt die UUID am Ziel nicht mit dem Register überein, wird das Projekt blockiert. Zwei gleichzeitig ausgewählte Roots derselben UUID sind mehrdeutig; es wird nicht anhand von Pfad, Änderungsdatum oder Branch geraten. Fehlende und nicht lesbare Roots werden gemeldet.

## 5. Wissensmodell

### 5.1 Features und Gesprächswissen haben unterschiedliche Aufgaben

Ein Feature beschreibt beobachtete Implementierung mit kurzer `summary`, veränderlichen `key_points`, Code-/Dokumentreferenzen und Beziehungen. Der bestehende Quellenanspruch bleibt erhalten. Nicht geprüfte Vermutungen stehen unter `hypotheses`.

Ein Wissensdokument enthält kurze eigenständige Aussagen zu einem Thema. Es kann ohne vorhandenes Feature und ohne Codebeleg existieren, benötigt jedoch eine Herkunft. Die Typen sind:

| Typ | Bedeutung |
| --- | --- |
| `idea` | Vorschlag, Wunsch oder noch unbestätigte Möglichkeit |
| `requirement` | Vom Nutzer ausdrücklich beschlossene Anforderung |
| `observation` | Aus einer Analyse gewonnene fachliche Erkenntnis |

Der Lebenszyklus einer Aussage ist unabhängig davon `active`, `superseded` oder `retracted`. Eine Anforderung bleibt eine Anforderung, wenn sie implementiert wurde. Ihre Übereinstimmung mit dem Code ist ein separater Prüfstand, kein Wechsel des Aussage-Typs.

Beispiel eines Wissensdokuments:

```yaml
schema: 2
kind: knowledge
id: rollenmodell
summary: Entscheidungen und Erkenntnisse zum gemeinsamen Rollenmodell.
features: []
statements:
  - id: gemeinsame-rollen
    type: requirement
    state: active
    text: Verbundene Anwendungen sollen dieselbe Bedeutung der Rollen verwenden.
    origin:
      kind: user_statement
      recorded_on: '2026-10-14'
      context: Im Architekturgespräch ausdrücklich als Anforderung beschlossen.
    evidence: []
    contradicts: []
    supersedes: []
```

Dateiname und Dokument-ID müssen übereinstimmen; Aussage-IDs sind innerhalb des Dokuments stabil und eindeutig. `features` enthält qualifizierte Featureverweise. `contradicts` und `supersedes` enthalten qualifizierte Verweise auf einzelne Aussagen mit Projekt-ID, Dokument-ID und Aussage-ID. Die Listen sind optional und werden leer normalisiert. Selbstverweise und Zyklen in `supersedes` sind ungültig.

`origin.kind` ist `user_statement`, `agent_inference` oder `source_review`; `recorded_on` ist ein Kalenderdatum als Zeichenkette. `context` beschreibt den relevanten Anlass knapp ohne Promptkopie. Für `source_review` muss `evidence` mindestens eine tatsächlich gelesene Quellenreferenz enthalten. Referenzen sind projektqualifiziert oder beziehen sich ohne Projektangabe auf den Eigentümer des Dokuments; Pfade bleiben relativ zum jeweiligen Projekt. Eine `requirement` benötigt `user_statement`; eine `observation` benötigt `source_review` oder bleibt bei `agent_inference` ausdrücklich eine unbestätigte Schlussfolgerung.

Die Verweisformen sind einheitlich: Feature `{project, feature}`, Wissensdokument `{project, knowledge}`, einzelne Aussage `{project, knowledge, statement}` und Quelle `{project?, path, symbol?}`. Die Projektangabe ist nur bei einer Quellenreferenz optional. `features` verwendet Featureverweise; `contradicts` und `supersedes` verwenden Aussageverweise. Schema-2-Features und Beziehungen erhalten eine optionale Liste `knowledge` mit Aussageverweisen, um Entscheidungen ohne Textkopie zuzuordnen. Diese logischen Verweise sind keine Dateipfade in `network-spec/` und umgehen dessen Ausschluss als Codequelle nicht.

Unklare Gesprächsaussagen werden als Idee oder Schlussfolgerung gespeichert, nicht als vermeintlicher Nutzerbeschluss. Gesprächsherkunft wird vom Agenten attestiert; ein Datum oder eine Hostkennung kann den tatsächlichen Beschluss nicht technisch beweisen. Rohprompts, Zugangsdaten, personenbezogene Nebeninformationen und interne Hostpfade werden nicht übernommen. Namenfilter sind keine allgemeine Geheimniserkennung.

Neue Wissensdokumente brauchen weder Platzhalter-Code noch eine erfundene Featurezuordnung. Umgesetztes Wissen wird mit Features verknüpft, ohne die ursprüngliche Entscheidung zu löschen oder als Codebeweis umzudeuten. Wichtige Implementierungszusammenhänge werden in den Features gepflegt; das Wissensdokument wird kein zweiter vollständiger Featuretext.

### 5.2 Eigentümerschaft und Widersprüche

Eine Aussage wird im fachlich zuständigen Projekt gespeichert. Andere Projekte verweisen darauf. Eine gemeinsame Anforderung wird beim Eigentümer ihres Vertrags geführt; ist die Zuständigkeit noch unklar, bleibt sie im aktiven Projekt als Idee mit ungeklärter Zuordnung. Es wird kein zentrales Vertragsprojekt automatisch angelegt.

Wiederholte Aussagen werden anhand stabiler Zuordnung und gezielter fachlicher Prüfung zusammengeführt. Textähnlichkeit oder gleicher Wortlaut in verschiedenen Projekten reichen für eine automatische Zusammenführung nicht aus. Korrekturen erhalten bestehende manuelle Inhalte und nutzen CAS.

Eine klare neue Nutzerentscheidung darf eine frühere Anforderung ersetzen, mit Verweis über `supersedes`. Eine Agentenvermutung oder widersprechender Code darf eine Nutzeranforderung nicht automatisch zurücknehmen. Die Abweichung wird als Beobachtung mit Bezug auf die Anforderung festgehalten. Veraltete Prüfstände und offene Widersprüche sind getrennte Zustände. Die Aussagen und ihre Herkunft bleiben nachvollziehbar; die vollständige Änderungshistorie liegt in Git, nicht in endlosen Textanhängen.

## 6. Projektübergreifende Beziehungen

Eine gerichtete Beziehung steht genau einmal beim Feature, von dem sie ausgeht. Der bestehende Vertrag `depends_on`, `reads`, `writes` bleibt bestehen. Externe Ziele verwenden ein Objekt:

```yaml
relations:
  - to:
      project: 883f5826-2d8f-4e2a-a5e9-34a943993b68
      feature: app-berechtigung
    type: depends_on
    status: evidenced
    evidence:
      - path: src/access.ts
        symbol: checkApplicationAccess
    when: Bedeutung oder Format der übertragenen Berechtigung ändert sich.
    check: Zugriffsauswertung und zugehörige Vertragstests prüfen.
```

Für lokale Ziele bleibt die vorhandene Stringform zulässig. Externe Referenzen identifizieren Projekte über UUID, nicht über Ordnernamen, Remote-URLs oder Anzeigenamen. Quellen ohne Projektangabe gehören dem speichernden Projekt. Eine optional projektqualifizierte Belegreferenz erlaubt tatsächlich geprüfte Quellen eines verbundenen Projekts. Gesprächswissen kann über qualifizierte Wissensverweise ergänzt werden; es ersetzt keine Quellenreferenz einer `evidenced`-Kante.

`evidenced` bedeutet quellenbasiert gestützt, nicht vollständig geprüft oder nachweislich fehlerfrei. Ein gelesener Aufruf im Verbraucher kann eine Abhängigkeit belegen, ohne die aktuelle Implementierung des Anbieters zu bestätigen. `when` und `check` bleiben Hinweise für den Agenten; der Kern führt sie nicht als Regeln aus.

Strukturell ungültige externe IDs sind Fehler. Ein gültiger, aber nicht erreichbarer, nicht freigegebener oder inzwischen gelöschter externer Zielknoten ist eine Auflösungslücke. Die lokale Beziehung bleibt lesbar und kann gespeichert werden, ohne einen fremden Platzhalter anzulegen. Fehlende lokale Ziele bleiben strukturelle Fehler. Zielumbenennungen werden nicht automatisch geraten oder in unzugänglichen Projekten umgeschrieben.

Der gemeinsame Index leitet eingehende Kanten ab. Fehlt das Repository eines Verbrauchers im ausgewählten Verbund, kann dessen Abhängigkeit nicht entdeckt werden. Antworten nennen deshalb den untersuchten Projektumfang; keine Treffer sind keine globale Entwarnung.

## 7. Gemeinsame Suche, Index und Effizienz

Das versionierte Wissen wird nicht zentral dupliziert. Der gemeinsame Index hält nur abgeleitete Such-/Graphdaten und benötigte Projektsnapshots. Die erste Umsetzung verwendet die vorhandenen In-Memory-Indizes; ein persistierter Index bleibt ein wegwerfbarer Cache.

- Schlüssel sind Projekt-ID plus Entitätsart und lokale ID.
- Features, Wissensaussagen, Dateien und Begriffe erhalten getrennte Zuordnungen. Anforderungen oder Ideen erscheinen erkennbar als solche und werden nicht als implementierte Features ausgegeben.
- Ausgehende und eingehende Adjazenzlisten ermöglichen begrenzte Traversierung. Es werden keine vollständigen transitiven Beziehungspfade dauerhaft gespeichert.
- Änderungen an einem Projektsnapshot aktualisieren dessen betroffene Einträge und Kanten. Nicht betroffene Projekte werden nicht erneut fachlich analysiert.
- Quellenhashes werden nur für die im aktuellen Auftrag benötigten beziehungsweise geänderten Quellen frisch geprüft. Ein normaler Prompt löst keine vollständige Quellinventarisierung aller Projekte aus.
- Normale Antworten verwenden weiterhin höchstens 20 Features und standardmäßig 12.000 UTF-8-Bytes inklusive Metadaten; Wissensantworten teilen dieses Budget. Die anfängliche Impacttiefe bleibt zwei Schritte.
- Zusätzlich begrenzt jede Verbundabfrage die tatsächliche Arbeit: standardmäßig acht Projekte und 1.000 besuchte Features, explizit einstellbar bis 32 Projekte und 10.000 besuchte Features. Auswahl und Traversierung sind deterministisch, zuerst das aktive Projekt, danach explizite Ziele und übrige Projekt-UUIDs in stabiler Reihenfolge. Nicht untersuchte Bereiche werden als solche gemeldet; ihre unbekannte Treffermenge wird nicht als exakte Auslassungszahl erfunden.
- Projekt-, Knoten-, Tiefen- und Bytebegrenzungen sowie ausgelassene Einträge werden ausdrücklich genannt. Seiten binden Registerrevision und die vollständige beteiligte Snapshot-Revisionsmenge; ein veränderter beteiligter Stand ergibt `stale_cursor`.
- Ohne festgelegten Projektfilter startet die Suche im aktiven Projekt; bei entsprechender Anfrage oder Beziehungen werden freigegebene Projekte gezielt einbezogen. Eine explizite Verbundsuche ist möglich und meldet nicht geladene oder begrenzte Bereiche.

Ohne bestehende Beziehung darf der Agent anhand einer konkreten Analysehypothese gezielt in freigegebenen Projekten suchen. Das ist keine automatische Vollanalyse. Verworfenes Cachematerial entfernt keine versionierte Erkenntnis und bestätigt keine Quelle.

Es gibt noch keine belastbare Größen- oder Latenzzusage. Benchmarks müssen Kaltstart, warme Abfrage und einzelne Aktualisierung getrennt messen; das bisherige geladene Core-Mikrobenchmark ist kein Nachweis für Dateisystem-, Verbund- oder Hostkosten.

## 8. Automatisches Lernen und auftragsbezogene Arbeit

Der normale Ablauf lautet:

1. Auftrag und betroffene Themen erfassen; vorhandenes Wissen begrenzt laden.
2. Neue Ideen, ausdrückliche Entscheidungen und Analyseerkenntnisse unterscheiden.
3. Nur notwendige Quellen im aktiven und in freigegebenen Projekten lesen. Beim Auftreten einer Abhängigkeit deren Verbraucher, Vertrag und erforderliche Prüfungen verfolgen.
4. Erkenntnisse während der Arbeit in kleinen begründeten Änderungssätzen speichern, sobald ihre Bedeutung feststeht. Der Agent muss dafür nicht auf eine Produktcodeänderung oder das Turnende warten.
5. Nach der Umsetzung tatsächliches Verhalten und Testergebnisse abgleichen. Fehlgeschlagene oder nicht ausgeführte Tests sind kein positiver Prüfbeleg.
6. Betroffene Prüfungen und widersprechende Aussagen sichtbar halten. Den Nutzer kompakt über wesentliche neue Verknüpfungen und verbleibende Lücken informieren.

Dies geschieht innerhalb aktiver Agentenarbeit. Ohne laufenden Agenten erfolgt keine dauernde Analyse; es gibt keinen neuen Hintergrunddienst und keine geplante Überwachung.

Explizite `status`, `show`, `impact` und `check` sowie Nutzeranweisungen wie „nur prüfen“ bleiben lesend. Ein Gespräch über das Gedächtnis hebt einen ausdrücklich lesenden Auftrag nicht auf. Allgemeine Projektgespräche mit relevanten neuen Erkenntnissen und normale Codeanalysen dürfen nach Einrichtung des Lernmodus dagegen Gedächtnisänderungen erzeugen. Nicht jeder Prompt enthält speicherwürdige Information.

Das Gedächtnisschreiben ist von Produktarbeit und technischer Bestätigung getrennt: Eine neue Idee braucht keinen Quellenhash. Eine Codebeobachtung benötigt tatsächlich geprüfte Quellen. Eine neue Gesprächsanforderung darf keine Quellenbaselines bestätigen oder offene technische Prüfungen schließen.

Eine externe Analyse darf Erkenntnisse im zuständigen verbundenen Projekt speichern, sofern dessen Registereintrag Gedächtnisschreiben erlaubt. Außerhalb des Auftrags liegender Altbestand wird nicht beiläufig abgearbeitet. Ein fremdes Projekt ohne Marker wird nicht automatisch initialisiert. Neue Projekte und umfassende Bestandsaufnahmen verwenden weiterhin den expliziten Init-/Setup-Ablauf.

## 9. Prüfstände, Checkouts und Konfliktsicherheit

Jeder Projektsnapshot hat eine eigene Netzwerkrevision. Fachliche Prüfbelege binden die tatsächlich gelesenen relativen Quellenpfade und Inhaltshashes sowie die zugehörigen Feature-/Aussagefingerprints. Branch und HEAD liefern Kontext, ersetzen aber die Quellenhashes nicht; uncommittierte Änderungen zählen zum gelesenen Stand.

Technische Zustände und fachliche Ergebnisse bleiben getrennt:

- Quellen: unverändert, geändert, fehlend oder unbekannt.
- Externe Ziele: aufgelöst, nicht verbunden, nicht erreichbar, mehrdeutig oder fehlend.
- Fachliche Prüfung: mit Begründung aufgezeichnet oder offen; Widersprüche bleiben eigens sichtbar.

Die eingeschränkte Verfügbarkeit externer Quellen oder Wissensverweise wird ebenfalls als Prüf-/Auflösungslücke behandelt, nicht als Beschädigung aller lokalen Dokumente. Eine neue Quellenbestätigung verlangt trotzdem einen tatsächlich verbundenen, lesbaren und geprüften Stand. Lokale strukturelle Fehler und die bestehenden Schutzregeln für lokale Quellen werden dadurch nicht gelockert.

Ein Hashwechsel öffnet die betroffene Prüfung; ein unveränderter Hash beweist keine fachliche Vollständigkeit. Nach Verlust lokaler Prüfstände gilt `unknown`, nicht „aktuell“. Ein Branchwechsel invalidiert betroffene Turn-/Fortsetzungsbindungen; unveränderte Erkenntnisse werden nicht gelöscht. Ein anderer ausgewählter Checkout erfordert neue Bindung und Prüfung.

Schreiben erfolgt je Zielprojekt mit vorhandenem Lock, vollständiger erwarteter Netzwerkrevision und Dokumentfingerprints. Neue Gesprächsdokumente verwenden dieselben Speicher- und Journalgarantien. Manuelle Änderungen dürfen nicht blind überschrieben werden. Konflikte erfordern frisches Einlesen und gezielte Zusammenführung.

Es gibt keine atomare Transaktion über mehrere Repositories und keine verschachtelten Projektlocks. Ein auftragsbezogener Pflegevorgang führt die einzelnen Projektänderungen mit getrennten Quittungen aus. Ein lokaler CAS-geschützter Fortschrittsbeleg beim aktiven Projekt hält Ziel-IDs, erwartete Revisionen, Änderungsfingerprints und abgeschlossene Teiloperationen fest; er enthält keinen Gesprächsrohtext. Nach einem Abbruch wird jeder Zielstand zuerst neu geprüft. Wiederaufnahme bestätigt keine nicht ausgeführte Änderung und überschreibt keine zwischenzeitliche Arbeit.

Projektübergreifende Belege beziehen sich auf eine ausgewiesene Revisionsmenge, nicht auf einen garantiert gleichzeitig vorhandenen globalen Stand. Abhängige Quellen werden vor der jeweiligen Bestätigung erneut geprüft; bereits beobachtete Abweichungen blockieren sie. Eine spätere Änderung in einem anderen Projekt kann wegen fehlender globaler Transaktion trotzdem unmittelbar folgen. Die nächste frische Abfrage muss diese Abweichung sichtbar machen. Das Ergebnis behauptet keine stärkere Gleichzeitigkeit.

Lesende Befehle führen weder Projektjournale noch ausstehende Verbundschreibvorgänge fort. Unvollständige Operationen erscheinen als offene Befunde. Das bloße spätere Öffnen eines anderen Projekts startet keine verdeckte Warteschlange für Änderungen.

## 10. Werkzeuge, Hostgrenzen und Sicherheit

Die vorhandenen fünf MCP-Werkzeuge werden erweitert; es entsteht kein paralleler Satz mit abweichender Graphlogik:

| Werkzeug | Erweiterung |
| --- | --- |
| `network_context` | Projektfilter, Wissensartfilter, qualifizierte Treffer und Herkunft |
| `network_impact` | Projektübergreifende Pfade, untersuchter Verbund und Auflösungslücken |
| `network_update` | Ein explizites registriertes Zielprojekt je Aufruf, Feature-/Wissensänderungen, revisionsgebundene Prüfbelege |
| `network_check` | Lokale oder verbundene Prüfung; keine semantische Neubestätigung |
| `network_bootstrap` | Weiterhin expliziter projektbezogener Bestandsaufbau; Wissensdokumente bewahren |

Ohne Projektangabe bleibt das aktive Projekt Ziel. Ein Update akzeptiert keine neuen Rootpfade, Registeränderungen, ausführbaren Prüffunktionen oder automatischen Git-Operationen. Der Agent kann ein selbst behauptetes Herkunftsfeld nicht als Hostberechtigung verwenden.

Der automatische Lernmodus wird bei expliziter Projekteinrichtung eingerichtet und ist sichtbar abschaltbar. Die bestehenden reinen Lesebefehle behalten Vorrang. Bestehende Installationen erhalten weder neue Projektzugriffe noch Gesprächsschreibrechte durch ein Paketupdate. Hookereignisse allein interpretieren keine Gespräche. Wo der Host keine verlässliche Turnbindung bereitstellt, verantwortet der aktive Skill die Pflege; erzwungene Abschlussfortsetzung wird dort nicht zugesagt.

Bestehende Pfadsicherheit und Grenzen gelten in jedem gebundenen Projekt: keine Traversals oder Symlinkflucht, keine Spezialdateien, keine Referenzen in Git-/Runtime-/Pluginverzeichnisse und dieselben sensiblen Ausschlüsse. Gedächtnisschreibrechte betreffen ausschließlich `network-spec/` und erforderliche lokale Runtimewerte, keine Hostkonfiguration oder Produktquellen.

Repositoryinhalte und gespeicherte Texte sind untrusted Daten. Sie dürfen weder neue Zugriffe autorisieren noch Agentenregeln, Nutzerentscheidungen oder Installationsfreigaben ersetzen. Ein Verbund erteilt keine Betriebssystemberechtigungen und umgeht keine Host-Sandbox. Quellzugriff durch den Agenten bleibt zusätzlich an dessen tatsächlich verfügbare Werkzeuge und Projektregeln gebunden.

Codex Desktop, Copilot CLI und Copilot App bleiben getrennte Live-Abnahmeziele. Diese Spezifikation verspricht keine ungetesteten Hookfähigkeiten. Keine realen Repositories oder Installationen werden allein durch diesen Entwurf verbunden.

## 11. Schemawechsel und Kompatibilität

Schema 1 bleibt lesbar und für seine bisherigen lokalen Operationen unverändert nutzbar. Ohne persistierte Projekt-ID kann es nicht verlässlich als externes Ziel dienen. Projektübergreifende Nutzung und Gesprächsdokumente benötigen Schema 2.

Ein expliziter lokaler Upgrade-Schritt zeigt vorab alle Änderungen: Marker mit neuer Projekt-ID, `schema: 2` in vorhandenen Featuredateien und unveränderte fachliche Inhalte. IDs, lokale Stringziele und manuelle Kernpunkte bleiben erhalten. Die Veröffentlichung erfolgt mit den bestehenden Journal-/CAS-Garantien. Ein Schema-2-Netzwerk enthält nur Schema-2-Dokumente; unbekannte Versionen bleiben Fehler.

Der Upgrade-Schritt ist idempotent, prüft vorliegende Änderungen und kann unterbrochen wiederaufgenommen werden. Er fügt keine Verbindungen oder Hosteinträge hinzu. Keine Paketaktualisierung migriert Projektdaten automatisch. Ein alter Client weist Schema 2 sichtbar zurück; ein Downgrade darf neue Wissensdokumente nicht still entfernen.

Die bisherigen Grenzen gelten weiter: maximal 65.536 UTF-8-Bytes je YAML-Dokument, keine Aliase, Anker, Tags, doppelten Schlüssel oder unbekannten Felder; persistierte Runtime-/Journaldokumente bleiben auf 16 MiB begrenzt. Ein übergroßes Wissensdokument wird gezielt nach Themen geteilt, ohne stillen Inhaltsverlust. Das datierte `recorded_on` muss beim YAML-Lesen als Zeichenkette erhalten bleiben.

## 12. Tests und Abnahmekriterien

Die Umsetzung erfolgt testgetrieben. Kritische automatisierte Prüfungen sind:

1. **Schema und Upgrade:** bestehende Schema-1-Fixtures bleiben unverändert gültig; Schema 2, strikte Typen, Gespräch ohne Code, ungültige Herkunft, Referenzformen, Größenlimits, Upgrade-CAS und Abbruchwiederherstellung.
2. **Bindung:** Umbenennung, falsche/duplizierte UUID, mehrere Worktrees, fehlende Roots, Rechteentzug, Registeränderung zwischen Lesen und Schreiben, Symlink-/Pfadausbruch und nicht registrierte Toolziele.
3. **Graph:** identische Feature-IDs in verschiedenen Projekten, eingehende/ausgehende und indirekte Pfade über mindestens drei getrennte Git-Repositories, Zyklen, fehlende externe und lokale Ziele, Hypothesen und sichtbare Umfangsgrenzen.
4. **Lernen:** Nutzeridee wird keine Anforderung; ausdrückliche Anforderung wird gespeichert; Agentenvermutung wird kein Nutzerbeschluss; Analyse ohne Produktänderung erzeugt belegte Erkenntnis; ein Gespräch bestätigt keine Codebaseline; Wiederholung erzeugt keine redundante Aussage.
5. **Widersprüche:** beschlossene Anforderung und abweichender Code bleiben beide sichtbar; neue ausdrückliche Entscheidung ersetzt nachvollziehbar die alte; manuelle Kernpunkte bleiben erhalten.
6. **Speicherung:** echte konkurrierende Prozesse, manuelle Änderungen, Prozessabbruch zwischen zwei Projektupdates, beschädigter Fortschrittsbeleg und sichere Wiederaufnahme ohne doppelte oder verlorene Änderung. Kein globaler Atomaritätsanspruch.
7. **Aktualität:** geänderte, gelöschte und wiederangelegte Quellen; Branch-/Checkoutwechsel; uncommittierte Quellen; gelöschter Cache und Prüfstand; externe Änderung während einer Abfrage; `stale_cursor` bei geänderter Revisionsmenge.
8. **Lesende Grenzen:** Status/Show/Impact/Check und „nur prüfen“ erzeugen weder Gedächtnisänderung noch Recovery oder Folgepflege. Ein nicht initialisiertes Fremdprojekt wird nicht automatisch eingerichtet.
9. **MCP und Paket:** echte STDIO-Prozesse, qualifizierte Werkzeuge, vollständige Antwortbudgets, Offline-Bundles, sensible Ausschlüsse, keine Entwicklerpfade und keine Registrierung durch untrusted Inhalte.

Eine synthetische Live-Aufgabe verwendet getrennte lokale Anbieter-/Verbraucher-Repositories: Ein Vertrag wird geändert; ein Verbraucher hat nur eine fachliche, nicht durch einen gemeinsamen Import erkennbare Abhängigkeit. Der Agent soll den Verbraucher finden, die Folgen anhand der Quellen prüfen, berechtigte Gedächtnisse aktualisieren und unzugängliche Verbraucher ausdrücklich als Lücke behandeln. Die Prüfaufgabe enthält auch eine Analyse ohne Codeänderung und eine noch nicht umgesetzte Nutzerentscheidung.

Ein unabhängiges Sollorakel bleibt außerhalb der Agentencheckouts. Vollständige fachliche Abnahme und Fehlerarten sind primär; Tokens, Laufzeit, Indexgröße und zusätzlicher Pflegeaufwand werden getrennt ausgewiesen. Synthetische Ergebnisse begründen keine allgemeine Genauigkeitszusage.

Zusätzlich werden Kaltstart, warme Verbundabfrage und inkrementelle Änderung bei wachsender Projekt-/Featurezahl und unterschiedlichem Verknüpfungsgrad gemessen. Dabei sind tatsächlich gelesene Dateien, Bytes und aktualisierte Indexeinträge zu erfassen. Es darf keine versteckte vollständige Quellcodeanalyse pro Prompt geben. Lokale Tests ersetzen keine getrennten Host-Live-Nachweise oder externe CI-Ergebnisse.

## 13. Umfang und nächste Schritte

Die Erweiterung ist ein zusammenhängender Architekturvertrag. Die spätere Planung muss ihn in unabhängig prüfbare Schritte teilen: Schema/Upgrade, Bindung, gemeinsamer Index, revisionsgebundene Pflege und Hostintegration. Gesprächswissen und Verbundfähigkeit werden nicht als bereits vorhandene Funktion beworben, wenn erst ein Teil umgesetzt ist.

Ausgeschlossen sind automatische Fernzugriffe, Cloud-Synchronisation, ein permanenter Lernprozess ohne Agenten, Embeddings, Graphdatenbanken, Weboberfläche, automatische Produktänderungen in anderen Projekten und vollständige Gesprächsarchive. Docker Compose und Deploy Cockpit bleiben ausdrücklich ausgenommen.

Nach Nutzerprüfung dieses Dokuments folgt ein separater schriftlicher Implementierungsplan. Erst nach dessen Prüfung und Wahl der Ausführungsmethode beginnt die Umsetzung. Ein Release oder eine tatsächliche Projektinstallation benötigt weiterhin den jeweiligen konkreten Auftrag.

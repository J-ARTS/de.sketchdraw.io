# de.sketchdraw.io

Projekt für sketchdraw.io (deutsche Version).

## Vision und Projektziel

Diese Vision ist das verbindliche Zielbild für Produkt-, Architektur- und Implementierungsentscheidungen. Sie beschreibt die angestrebten Fähigkeiten, nicht den bereits umgesetzten Funktionsumfang.

Ein offener, plattformübergreifender Visual Workspace, in dem Menschen und autonome KI-Agenten gemeinsam Ideen, Softwarearchitekturen und Cloud-Infrastrukturen entwerfen, visualisieren, diskutieren und kontinuierlich weiterentwickeln – intuitiv wie Excalidraw, strukturiert wie Code und kollaborativ über dezentrale P2P-Verbindungen.

Leitgedanke: *Everything you can draw, an agent can understand. Everything an agent can create, a human can edit.*

### Was wir bauen

Eine Desktop-Anwendung für Windows, Linux und macOS auf Basis von **Electron, Vue 3 und TypeScript**. Sechs Kernfähigkeiten:

1. **Infinite Whiteboard** – Freies Zeichnen, Texte, Bilder, Shapes, Verbindungen und Container; intuitive Bedienung ähnlich Excalidraw.
2. **Architecture & Cloud Diagrams** – Strukturierte Architekturdiagramme mit AWS-, Azure-, GCP- und generischen Komponenten. Eigene Component Sets, Widgets, Metadaten und Dokumentationslinks sind erweiterbar.
3. **Diagram as Code** – Jedes Diagramm hat eine menschenlesbare, editierbare Syntax ähnlich Mermaid. Canvas und Quelltext sind bidirektional synchronisiert und Git-freundlich.
4. **Agent-Native Integration** – Externe Agenten wie Claude Code, OpenAI Codex und Google Antigravity können über MCP und Skills Diagramme verstehen, erstellen, analysieren, verändern und pflegen.
5. **Strict P2P Collaboration** – Gemeinsame Echtzeitbearbeitung über verschlüsselte Peer-to-Peer-Verbindungen, ohne zentrale Dokumentenspeicherung, Signaling- oder Relay-Server. Direkte Internetverbindungen sind unter diesen Bedingungen nicht in allen Netzwerken garantiert.
6. **Open Interoperability** – Import und Export von draw.io-Diagrammen, SVG und weiteren offenen Formaten, mit möglichst verlustarmer Konvertierung.

Für lokale Desktop-Dokumente ist der Agentenzugriff eine automatisch verwaltete Produktfähigkeit: Es gibt keinen Freigabe-Tab. Ein einmalig eingerichteter lokaler MCP-Client erhält Lese- und Schreibzugriff auf das aktuell geöffnete lokale Dokument; Dokumentwechsel und Neustart rotieren die private Verbindung automatisch. Browser- und P2P-Gastdokumente erhalten ohne eigene Dokumentautorität keinen lokalen MCP-Zugriff.

Entscheidungen und Implementierungen müssen sich an dieser Vision messen lassen (z. B. keine zentralen Server für Dokumente oder Signaling; Diagramme immer auch als Text lesbar und editierbar).

## Projektstand

- Architektur, Sprints, gemeinsame Verträge, Build-/Testkonfiguration und installierbare Abhängigkeiten sind vorhanden. Die sechs Produktbereiche sowie die drei nativen Installer sind implementiert und auf den Zielplattformen geprüft. Release v0.1.1 ist mit drei geprüften Installern veröffentlicht; konkrete Nachweise und der Aufgabenstatus werden in GitHub gepflegt. Der aktuelle bestätigte Stand steht in GitHub und `agent-state/work-ledger.json`.
- Stack: Electron, Vue 3, TypeScript. Bestehende Skripte: `npm run dev:browser`, `npm run dev:electron`, `npm run typecheck`, `npm run test:unit`, `npm run test:ui`, `npm run test:electron`, `npm run build`, `npm run package`. Vor Ausführung Voraussetzungen/Dateieinstiege prüfen; fehlende Implementierung bleibt eine benannte Integrationslücke.
- Build-Lifecycle-Prüfungen laufen separat über `node --test tests/unit/*.test.mjs`; Python-Graphify-Prüfungen über `python3 -m unittest discover -s tools/tests -v`. Ein existierender Testbefehl ist kein bestandener Test.

## Konventionen

- Antworten und Kommunikation auf Deutsch; Code, Bezeichner und Commit-Messages auf Englisch.
- Bestehenden Code-Stil und Namensgebung beibehalten.
- Änderungen auf die jeweilige Aufgabe beschränken und vorhandene Änderungen des Nutzers erhalten.
- Für Codeänderungen die passenden vorhandenen Prüfungen ausführen und nicht ausführbare Prüfungen offen benennen.

## Verantwortlichkeiten und Scrum-Zusammenarbeit

Die Zusammenarbeit von Claude Code, Google Antigravity und OpenAI Codex folgt dieser verbindlichen Rollenverteilung:

| Agent | Verantwortungsbereich | Zugehörige Fachlabels |
| --- | --- | --- |
| **OpenAI Codex** | Architektur, Scrum-Koordination der Zusammenarbeit aller drei Agenten und Gesamtverantwortung für Testing | `architecture`, `testing` |
| **Claude Code** | Frontend-Design und Frontend-Implementierung: UI/UX, Vue-Komponenten, Styling, Interaktionen, Accessibility und zugehörige Frontend-Tests gemäß `CLAUDE.md` | `ui` |
| **Google Antigravity** | Entwurf und Implementierung von Geschäfts- und Anwendungslogik, APIs und Integrationsschnittstellen, Identity and Access Management sowie Infrastruktur, CI/CD und Deployment innerhalb der vereinbarten Architektur | `logic`, `interface`, `iam`, `devops` |

### Verantwortung von Codex

- **Architektur:** Systemstruktur, Modulgrenzen, übergreifende technische Entscheidungen und Architekturprüfungen verantworten. Schnittstellenverträge gemeinsam mit Antigravity und Claude Code abstimmen; die Implementierung der Schnittstellen liegt bei Antigravity, ihre Frontend-Anbindung bei Claude Code. Entscheidungen und Auswirkungen auf die Produktvision im Issue dokumentieren.
- **Scrum-Koordination:** Die Zusammenarbeit von Claude Code, Antigravity und Codex organisieren. Auf Grundlage der Nutzerziele und Prioritäten das Backlog strukturieren, Sprintziele und Arbeitspakete planen, Zuständigkeiten und Abhängigkeiten klären, Fortschritt und Blockaden verfolgen sowie Reviews und Retrospektiven koordinieren. Akzeptanzkriterien und die Definition of Done im jeweiligen Issue festhalten.
- **Testing:** Teststrategie, angemessene Testabdeckung, Integrationstests, End-to-End-Tests und Regressionstests verantworten. Bereichsspezifische Tests der implementierenden Agenten koordinieren und ihre Nachweise prüfen. Testergebnisse, verbleibende Prüflücken und den geprüften Stand in GitHub dokumentieren; der Ticketabschluss richtet sich nach den unten definierten Abschlussbedingungen.

### Zusammenarbeit und Übergaben

- Codex koordiniert den Gesamtstatus; jede Aufgabe erhält im Issue einen verantwortlichen Agenten, einen abgegrenzten Umfang, Akzeptanzkriterien und passende Fachlabels. Bereichsübergreifende Aufgaben in verknüpfte Teilaufgaben mit klarer Zuständigkeit aufteilen.
- Claude Code und Antigravity implementieren ihre Bereiche und liefern die dazugehörigen Tests und Prüfnachweise. Codex trägt die Gesamtverantwortung für Testing; das entbindet die implementierenden Agenten nicht von der Prüfung ihrer eigenen Änderungen.
- Claude Code trifft UI/UX- und Gestaltungsentscheidungen innerhalb der vereinbarten Architektur eigenständig und dokumentiert sie im Issue; Auswirkungen auf gemeinsame Verträge oder Architekturgrenzen werden mit Codex und den betroffenen Agenten abgestimmt.
- Vor Änderungen an gemeinsamen Dateien, Schnittstellen oder Architekturgrenzen Zuständigkeit und Auswirkungen im Issue abstimmen. Parallele Arbeit auf getrennte Bereiche begrenzen und fremde Änderungen erhalten.
- Bei Übergaben erledigte Änderungen, Datei-/Branch-/Commit-/PR-Referenzen, Testergebnisse, offene Punkte, Blocker und den nächsten konkreten Schritt im Issue kommentieren. Der übernehmende Agent liest den aktuellen Stand vor der Fortsetzung.
- Codex führt die Ergebnisse zusammen, prüft die Architekturkonformität und die Testnachweise gegen die Akzeptanzkriterien und hält den Gesamtstatus aktuell. Offene Befunde werden dem zuständigen Agenten als verknüpfte Aufgabe zurückgegeben.
- Für die laufende Umsetzung hat der Nutzer am 17.10.2026 Codex ausdrücklich zur vorübergehenden Übernahme offener Implementierung und Release-Korrekturen autorisiert, solange externe Kontingente die anderen Agenten begrenzen. Die reguläre Rollenverteilung bleibt bestehen. Zuständiger Agent und tatsächlich ausführendes Tool werden getrennt in Issue und Arbeitsledger erfasst. Auf zusätzlichen Nutzerwunsch wurden auch Claude-Modelle über Antigravity verwendet; erneute Limits werden als solche dokumentiert.

### Bedenken und Architektur-Research

- Claude Code und Antigravity sollen Architekturentwürfe und ihre Aufgaben kritisch prüfen und konkrete Bedenken früh äußern: betroffene Anforderung, Fehlerfall, Auswirkung, Alternative und vorgeschlagene Prüfung. Ein fehlender Einwand ist keine bestätigte Freigabe.
- Codex nimmt jeden materiellen Einwand mit Quellen-/Ticketreferenz in `docs/concerns.md` auf, untersucht ihn im Architektur-Research und dokumentiert Entscheidung, Begründung, Verantwortlichen und erforderlichen Prüfnachweis. Offene oder verworfene Einwände bleiben nachvollziehbar.
- Vor paralleler Implementierung gemeinsame Verträge abgleichen. Externe Berichte in `docs/reviews/` referenzieren; interne Codex-Reviews nicht als Beiträge von Claude Code oder Antigravity ausgeben. Tatsächlich verwendetes Werkzeug, Modell und Modus erfassen.

## Verbindlicher GitHub-Issue-Workflow

Repository: `J-ARTS/de.sketchdraw.io`

Tickets: https://github.com/J-ARTS/de.sketchdraw.io/issues

- Jede Aufgabe und jeder Bug muss als GitHub-Issue erfasst sein. Vor Beginn der Umsetzung nach einem passenden bestehenden Issue suchen und dieses weiterführen; andernfalls ein Issue anlegen. Einzelne Arbeitsschritte derselben Aufgabe gehören in dessen Checkliste und Kommentare.
- Auch außerhalb des aktuellen Umfangs entdeckte Bugs als eigene Issues mit dem Ursprungsticket verlinken. Ihre Erfassung erweitert nicht automatisch den Umsetzungsumfang.
- Ein Issue enthält Ziel bzw. Fehlerbeschreibung, Umfang, überprüfbare Akzeptanzkriterien und passende Labels. Bugs zusätzlich mit Reproduktionsschritten, erwartetem und tatsächlichem Verhalten sowie relevanter Umgebung dokumentieren.
- Das Issue bei Arbeitsbeginn, wesentlichen Fortschritten, Entscheidungen, Blockaden, Testergebnissen, Übergaben und Abschluss kommentieren. Kommentare sollen konkrete Ergebnisse und nächste Schritte enthalten.
- Branches, Commits und Pull Requests dem Issue zuordnen. Bei neuen Branches das Muster `codex/<issue-nummer>-<kurzbeschreibung>` verwenden; Issue-Referenzen in Commit-Messages und PR-Beschreibungen aufnehmen.
- Ist GitHub vorübergehend nicht erreichbar, fehlende Issue-Anlagen und Updates lokal festhalten und die Synchronisation als ausstehend melden. Nach Wiederherstellung zuerst nach bereits angelegten Einträgen suchen, dann nachtragen; einen unbestätigten Schreibvorgang nicht blind wiederholen.

### Fachlabels

Jedes Ticket erhält mindestens eines der folgenden Labels; bei mehreren betroffenen Bereichen mehrere vergeben. Vorhandene Labels wiederverwenden und fehlende anlegen. Unabhängige Labels anderer Beteiligter erhalten.

| Label | Verwendung |
| --- | --- |
| `ui` | Visuelle Gestaltung, Layout, Komponenten und Nutzerinteraktion |
| `architecture` | Systemstruktur, Modulgrenzen und technische Grundentscheidungen |
| `logic` | Geschäftslogik, Berechnungen und Anwendungsverhalten |
| `interface` | APIs, Datenverträge und Integrationsschnittstellen |
| `devops` | Infrastruktur, Konfiguration, CI/CD und Deployment |
| `testing` | Tests, Testinfrastruktur, Abdeckung und Qualitätssicherung |
| `iam` | Identity and Access Management: Anmeldung, Identitäten, Rollen und Berechtigungen |

Für Bugs zusätzlich `bug`, für neue Funktionen `enhancement` und für Dokumentationsaufgaben `documentation` verwenden. `testing` beschreibt einen betroffenen Aufgabenbereich; die Pflicht zur Prüfung und Ergebnisdokumentation gilt für alle Tickets.

### Aktuellen Arbeitsstand pflegen

GitHub ist die maßgebliche, dauerhafte Quelle für den Aufgabenstatus. Chatverlauf oder lokaler Agentenspeicher allein reichen nicht aus.

- Im Issue-Text einen Abschnitt `Aktueller Arbeitsstand` pflegen: Status, verantwortlicher Agent oder Bearbeiter, zuletzt bestätigtes Ergebnis, offene Checkliste, Blocker und Abhängigkeiten, relevante Datei-/Branch-/Commit-/PR-/Artefaktreferenzen sowie ein konkreter nächster Schritt. Lokale, noch nicht veröffentlichte Änderungen ausdrücklich kennzeichnen.
- Bei jeder wesentlichen Änderung sowohl diesen Überblick aktualisieren als auch einen neuen Kommentar für die Historie hinterlassen. Frühere Ergebnisse nicht rückwirkend umschreiben; Korrekturen nachvollziehbar ergänzen.
- Vor Wiederaufnahme oder Übergabe Issue-Text, Status, Labels, aktuelle Kommentare und verknüpfte Änderungen lesen. Den tatsächlichen Datei- und Git-Stand abgleichen, bevor auf früheren Ergebnissen aufgebaut wird.
- Vor dem Aktualisieren des Issue-Texts den neuesten Stand lesen und Beiträge anderer Beteiligter erhalten. Bei widersprüchlichem Stand erst abgleichen, nicht mit einem älteren Snapshot überschreiben.
- Bei paralleler Arbeit Zuständigkeiten, betroffene Ressourcen und Teilaufgaben im Issue dokumentieren. Delegierte Arbeit vor dem Start mit Rolle, begrenztem Umfang und erwartetem Ergebnis erfassen; aktive, blockierte und abgeschlossene Teilaufgaben unterscheiden. Ergebnisse erst nach Prüfung als bestätigt übernehmen.
- Eine verantwortliche Instanz koordiniert den Gesamtstatus und den Abschluss des Issues. Subagenten melden ihre Teilaufgaben zurück und schließen das gemeinsame Ticket nicht selbstständig.
- Vor dem Beenden einer Sitzung oder einer Übergabe muss das Issue ohne den bisherigen Chat fortsetzbar sein. Offene Arbeit, ausstehende Synchronisation, fehlgeschlagene Prüfungen und der nächste Schritt dürfen nicht nur im Chat stehen.

| Arbeitsstatus | GitHub-Zustand und Statuslabel |
| --- | --- |
| Geplant | Offen, ohne aktives Statuslabel |
| In Arbeit | Offen, `status: in-progress` |
| Blockiert | Offen, `status: blocked`; Ursache und Bedingung zur Fortsetzung dokumentieren |
| Review / Integration ausstehend | Offen, `status: review` |
| Erledigt | Geschlossen als abgeschlossen; aktive Statuslabels entfernen |

Es gilt höchstens eines der drei Statuslabels gleichzeitig. Bei Statuswechseln nur die bisherigen Statuslabels entfernen, nicht die Fachlabels. Eine Blockade oder das Ende einer Sitzung ist kein Abschluss. Ein Issue erst schließen, wenn die Akzeptanzkriterien erfüllt, die erforderlichen Prüfungen dokumentiert und Repository-Änderungen im Zielbranch integriert sind. Diese Abschlussbedingung erteilt für sich genommen keine Erlaubnis zum Committen, Pushen oder Mergen. Bei Rückfällen wieder öffnen oder einen verknüpften Folgefehler erfassen. Verworfene Aufgaben oder Duplikate mit Begründung schließen, ohne sie als erfolgreich umgesetzt auszugeben.

### Abschlussreife Tickets direkt in GitHub schließen

- Nach wesentlichen Fortschritten, bestätigten Prüfungen und der Integration sowie vor Sitzungsende die offenen GitHub-Issues des bearbeiteten Projektumfangs aktiv auf Abschlussreife prüfen.
- Sind Akzeptanzkriterien erfüllt, erforderliche Prüfungen dokumentiert und Änderungen im Zielbranch integriert, das Ticket ohne weitere Aufforderung **direkt in GitHub als abgeschlossen schließen** (`state: closed`, `state_reason: completed` bzw. `gh issue close --reason completed`). Der tatsächliche GitHub-Zustand ist maßgeblich; eine lokale Markierung oder Chatnachricht ersetzt den Abschluss nicht.
- Vor dem Schließen den neuesten Issue-Stand lesen, den Abschnitt `Aktueller Arbeitsstand` aktualisieren und einen Abschlusskommentar mit Ergebnis, Testnachweisen und Commit-/PR-/Artefaktreferenzen hinterlassen. Aktive Statuslabels entfernen, Fachlabels erhalten und den bestätigten Abschluss im Arbeitsledger und Graphify nachführen. Codex koordiniert gemeinsame Tickets; Subagenten melden ihre Abnahme zurück.
- Fehlen Abschlussbedingungen, das Ticket offen halten und den konkreten fehlenden Nachweis, Blocker oder nächsten Schritt dokumentieren. Veraltete Statusangaben nach dem Abgleich berichtigen.

### Fortschritt und Testergebnisse als Kommentare

Jeder Testbericht nennt die geprüfte Änderung bzw. Revision, die Prüfung oder den ausgeführten Befehl, die relevante Umgebung, das tatsächliche Ergebnis und verfügbare Belege. Bestandene, fehlgeschlagene und nicht ausgeführte Prüfungen getrennt ausweisen. Nicht ausgeführte Prüfungen mit Grund und verbleibender Prüflücke dokumentieren; ein gestarteter oder geplanter Test ist kein bestandener Test. Nach relevanten Änderungen betroffene Prüfungen erneut ausführen; frühere Ergebnisse gelten nur für ihren geprüften Stand. Für reine Dokumentationsänderungen passende Inhalts- und Formatprüfungen festhalten.

Folgende Kommentarstruktur als Vorlage verwenden; nicht zutreffende Punkte kurz kennzeichnen:

```markdown
## Update
- Status:
- Fortschritt / Entscheidungen:
- Betroffene Änderungen / Referenzen:

## Prüfungen
- Geprüfter Stand und Umgebung:
- Prüfung / Befehl:
- Ergebnis: bestanden | fehlgeschlagen | nicht ausgeführt (Grund)
- Beleg / Artefakt:

## Fortsetzung
- Offene Punkte / Blocker:
- Nächster konkreter Schritt:
```

Keine Zugangsdaten oder vertraulichen Inhalte in Issues, Kommentare oder Testausgaben übernehmen. Ungeprüfte Annahmen klar von bestätigten Ergebnissen trennen.

## EvoCodeGraph Skill Routing

Use the global EvoCodeGraph skills automatically when a task matches their scope:

- Use `evo-codegraph` for self-improving multimodal knowledge graphs, GraphRAG/codebase graph architecture, and graph-based coding-assistant benchmarks.
- Use `evo-agent-state-management` for agent run state, subagent run state, resource state, result artifacts, resume cursors, official-score guards, and memory promotion policy.
- Use `evo-subgraph-maintenance` for graph-of-graphs design, subgraph namespaces, cross-graph edges, context packets, and promotion/validation rules.
- Use `evo-self-evolving-skills` for governed skill, workflow, retrieval, memory-policy, or benchmark-harness evolution from trajectories, failures, verifier feedback, or research evidence.

Keep official benchmark claims guarded unless official prediction artifacts and official harness results exist.

## graphify

Die folgenden Regeln gelten, wenn ein Wissensgraph unter `graphify-out/` vorhanden ist. Befehle setzen ein verfügbares `graphify`-CLI voraus.

- Wenn `graphify-out/graph.json` existiert, bei Fragen zur Codebasis zuerst `graphify query "<question>"` verwenden.
- Für Beziehungen `graphify path "<A>" "<B>"` und für einzelne Konzepte `graphify explain "<concept>"` verwenden.
- Wenn `graphify-out/wiki/index.md` existiert, diese Datei zur übergreifenden Navigation verwenden.
- `graphify-out/GRAPH_REPORT.md` nur für übergreifende Architekturprüfungen lesen oder wenn die gezielten Abfragen nicht genügend Kontext liefern.
- Nach Codeänderungen bei eingerichtetem Graphify `graphify update .` ausführen, um den Graphen aktuell zu halten.
- Fehlt der Graph oder das CLI, die relevanten Projektdateien direkt untersuchen und die Einschränkung bei Bedarf benennen.

### Tickets, Werkzeuge und Arbeitsaufwand verknüpfen

- `agent-state/work-ledger.json` enthält die nachvollziehbare Zuordnung von GitHub-Tickets zu verantwortlichen Werkzeugen/Agenten, konkreten Runs, Ergebnissen, Bedenken und Aufwand. GitHub bleibt die maßgebliche Quelle für den Aufgabenstatus; den lokalen Stand mit den bestätigten Ticketänderungen abgleichen.
- Geplante Story Points und beobachteten Ist-Aufwand getrennt führen. Zeiten, Tokens und Kosten nur aus tatsächlichen Messungen übernehmen; unbekannte Werte bleiben `null`. Ein mehrere Tickets betreffender Run wird insgesamt nur einmal gezählt, nicht jedem Ticket vollständig zugeschlagen.
- Nach Änderungen am Ledger und nach `graphify update .` die Verknüpfungen mit `python3 tools/graphify-links.py` wiederherstellen und mit `python3 tools/graphify-links.py --check` prüfen. Graph-Schreibvorgänge nacheinander ausführen.
- Übergaben müssen Ticket, Run-ID, Werkzeug/Modell, Status, Artefakte, Testergebnisse und nächsten Schritt verbinden. Einen geplanten oder gestarteten Run niemals als erfolgreich abgeschlossen ausgeben. Details und Abfragen: `docs/graphify-traceability.md`.

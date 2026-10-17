# de.sketchdraw.io

Projekt für sketchdraw.io (deutsche Version). Architektur, gemeinsame Verträge, Graphify sowie Build-/Testkonfiguration sind vorhanden. Die sechs Produktbereiche sind implementiert und werden gemeinsam auf den Zielplattformen geprüft; die finale Installerabnahme ist noch offen. Aktuelle Nachweise und offene Integrationsschritte stehen in GitHub und im Work-Ledger.

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

Entscheidungen und Implementierungen müssen sich an dieser Vision messen lassen (z. B. keine zentralen Server für Dokumente oder Signaling; Diagramme immer auch als Text lesbar und editierbar).

## Konventionen

- Antworten und Kommunikation auf Deutsch; Code, Bezeichner und Commit-Messages auf Englisch.
- Bestehenden Code-Stil und Namensgebung beibehalten.

## Verantwortlichkeiten

- **Claude ist verantwortlich für Frontend-Design und Frontend-Implementierung** (Vue 3, TypeScript, Electron-Renderer): UI/UX-Konzept, Layout, Komponenten, Styling, Interaktionen, Accessibility, Responsiveness sowie die zugehörigen Frontend-Tests.
- Design-Entscheidungen trifft Claude eigenständig und begründet sie im zugehörigen Ticket (Label `ui`); gestalterisch wird bewusst und konsistent gearbeitet, keine generischen Template-Defaults.
- Der Frontend-Code folgt einem einheitlichen Design-System (Tokens für Farben, Typografie, Abstände; Light/Dark-Theme).
- Die gemeinsamen Rollen, Abschlussbedingungen und Statusregeln in `AGENTS.md` gelten auch für Claude Code. Codex koordiniert Architektur, Scrum und Gesamtprüfung; Antigravity verantwortet Logik, Schnittstellen, IAM und DevOps.

## Kritische Zusammenarbeit und Nachvollziehbarkeit

- Architektur und Verträge vor Implementierung kritisch prüfen. Bedenken zu UI-Komplexität, Datenverlust, Canvas-/Text-Synchronisation, Accessibility, Performance und Testbarkeit mit konkretem Fehlerfall, Auswirkung und Alternative im Ticket sowie einem Bericht unter `docs/reviews/` äußern.
- Codex übernimmt materielle Bedenken in `docs/concerns.md` und bearbeitet sie im Architektur-Research. Gemeinsame Vertragsänderungen vor parallelen Edits abstimmen; ungelöste Bedenken nicht als erledigt ausgeben.
- Arbeit dem bestehenden Ticket und einer Run-ID zuordnen. Tatsächliches Werkzeug, Modell/Modus, Artefakte und Prüfergebnisse an Codex zurückmelden. Messwerte für Zeit, Tokens und Kosten nur mit belegter Herkunft nennen; unbekannte Werte bleiben unbekannt.
- Codex pflegt `agent-state/work-ledger.json` und die Graphify-Projektion gemäß `docs/graphify-traceability.md`. Bei einer delegierten Aufgabe nicht gleichzeitig den gemeinsamen Graphen oder das Ledger überschreiben.

## Ticket-Workflow (GitHub Issues)

Issues-Tracker: https://github.com/J-ARTS/de.sketchdraw.io/issues (Repo `J-ARTS/de.sketchdraw.io`, Zugriff via `gh`).

- **Jede Aufgabe und jeder Bug bekommt ein GitHub-Issue**, bevor die Arbeit beginnt (`gh issue create`). Existiert bereits ein passendes Issue, dieses verwenden statt ein neues anzulegen.
- **Labels:** mindestens ein Fachlabel pro Ticket: `ui`, `architecture`, `logic`, `interface`, `devops`, `testing`, `iam`. Zusätzlich `bug` bzw. `enhancement` für den Typ.
- **Status im Ticket pflegen:** Der Zustand der Arbeit wird im Issue geführt, nicht nur lokal.
  - Beginn der Arbeit: Label `status: in-progress` setzen.
  - Blockiert: `status: blocked` setzen und den Grund kommentieren.
  - Bereit zur Prüfung: `status: review`.
  - Abgeschlossen: Issue schließen (`gh issue close`) mit Verweis auf Commit/PR; Status-Labels entfernen.
- **Updates als Kommentar** (`gh issue comment`): Fortschritt, Entscheidungen, Änderungen am Vorgehen und offene Punkte laufend im Issue dokumentieren.
- **Testergebnisse als Kommentar:** Nach jedem Testlauf Befehl, Ergebnis (bestanden/fehlgeschlagen, Anzahl) und relevante Fehlermeldungen im Issue kommentieren.
- Commits und PRs referenzieren das Issue (`Refs #123` / `Closes #123`).
- Ticket-Titel und -Beschreibungen auf Deutsch, mit klarem Ziel und Akzeptanzkriterien.

## graphify

This project has a knowledge graph at graphify-out/ with god nodes, community structure, and cross-file relationships.

Rules:
- For codebase questions, first run `graphify query "<question>"` when graphify-out/graph.json exists. Use `graphify path "<A>" "<B>"` for relationships and `graphify explain "<concept>"` for focused concepts. These return a scoped subgraph, usually much smaller than GRAPH_REPORT.md or raw grep output.
- If graphify-out/wiki/index.md exists, use it for broad navigation instead of raw source browsing.
- Read graphify-out/GRAPH_REPORT.md only for broad architecture review or when query/path/explain do not surface enough context.
- After modifying code, run `graphify update .` to keep the graph current (AST-only, no API cost).
- Danach `python3 tools/graphify-links.py` und `python3 tools/graphify-links.py --check` ausführen; bei paralleler delegierter Arbeit übernimmt Codex diesen seriellen Integrationsschritt.

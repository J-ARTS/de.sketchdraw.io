# MCP und Skill: Praxistest und Nachbesserung

Issue #176, Claude Code, 13.11.2026. Auftrag des Nutzers: prüfen, ob MCP und Skill funktionieren, die Implementierung bewerten, die Verbesserungen umsetzen und mit Sonnet-Subagenten testen.

## Ausgangsbefund

Geprüft gegen die gebaute Desktop-App (`0d50898`, Linux, xvfb, unprivilegiert, Sandbox aktiv) mit dem offiziellen SDK-Client.

| Nr. | Fehlerfall | Auswirkung |
| --- | --- | --- |
| 1 | Leseergebnisse standen nur in `structuredContent`; der Textblock war ein Platzhalter. | Clients, die ihrem Modell nur den Text geben, erhielten keine Daten. |
| 2 | Das Schema von `command` war leer; Ablehnungen lauteten immer „Change was rejected by the shared document authority.“ | Sieben von neun plausiblen Befehlen scheiterten ohne Hinweis. Die Domain-Issues gingen im Catch-Zweig von `src/session/authority.ts` verloren. |
| 3 | Vier Lesetools und zwei Schreibtools hatten jeweils denselben Beschreibungstext; keine Server-Anweisungen. | Kein Anhaltspunkt für die Werkzeugwahl. |
| 4 | Der Adapter verband nach einem Dokumentwechsel neu und sendete auch Schreibaufrufe erneut; Revisionen beginnen je Dokument bei 0. | Ein Umbenennen mit `expectedRevision: 0` landete im neu geöffneten Dokument. |
| 5 | Mehr als zwei gleichzeitige Aufrufe endeten mit `BUSY`. | Vier von sechs parallelen Lesezugriffen schlugen fehl. |
| 6 | Verbindungen verlangten vollständige Geometrie. | Die häufigste Aufgabe bei Architekturdiagrammen war nur mit Rechenarbeit lösbar. |
| 7 | Agentenänderungen sind für den Menschen nicht rückgängig zu machen (CL-03, gewollt). | Kein Schutz gegen ein fehlerhaftes `apply_code`. Offen. |
| 8 | 300 Elemente: `read_document` 93 481 Zeichen, `read_code` 83 649 Zeichen; kein Filter. | Hoher Kontextverbrauch. Offen. |

Skill: formal gültig, aber in keinem Skill-Verzeichnis eines Clients und nicht im Installer; ohne Befehlskatalog, Elementfelder und Verbindungsrezept.

## Umsetzung

Vertrag: Abschnitt „Agentenergonomie“ in `docs/contracts-mcp.md`. `DocumentAuthority`, `WriteOutcome`, Host und Authentifizierung sind unverändert.

- `src/mcp/tooling.ts`: Ergebnis als JSON im Textblock, Warteschlange, Schreibsperre nach Dokumentwechsel.
- `src/mcp/guide.ts`: Server-Anweisungen und je Werkzeug eine eigene Beschreibung.
- `src/agent-access/schema.ts`: flaches, beschriebenes Schema für `command` ohne Unions.
- `src/agent-access/agent-commands.ts`: Vervollständigung schlanker `add`-Elemente über `createElement`, berechnete Verbindungsgeometrie, Erklärung einer Ablehnung über einen Probelauf von `applyCommand`.
- `src/agent-access/renderer-handler.ts`: Einbindung; Suchtreffer nennen `fromElementId`/`toElementId`; Analyse listet Seiten mit ID und meldet fehlende Beschriftung nicht mehr für Verbindungen und Pfade.
- `src/codec/index.ts`: Kopfzeilen-Meldungen nennen `sketchdraw 2`.
- `skills/sketchdraw-desktop/SKILL.md`: neu geschrieben.

Abweichungen, die Codex bewerten sollte:

1. Einfache Formen eines Agenten erhalten zentrierten Text. Der Code-Pfad behält `SCRIPT_V1_DEFAULT_STYLE` (linksbündig), die Oberfläche zeichnet zentriert; damit gibt es weiterhin unterschiedliche Standardstile.
2. Die Erklärung einer Ablehnung wendet den Befehl ein zweites Mal ohne Commit an. Das kostet nur im Fehlerfall Zeit, ist aber eine zweite Auswertung neben der Authority.
3. Auch ein abgelehnter Aufruf verbraucht seine `commandId` (Journal unverändert). Die Meldung sagt das jetzt; das Verhalten wurde nicht geändert.
4. Die Änderung liegt im Bereich Schnittstellen (regulär Antigravity) und wurde auf Nutzeranweisung von Claude Code umgesetzt; ein unabhängiger Review steht aus.

## Test mit Subagenten

Fünf Subagenten (Modell Sonnet 5.5) arbeiteten gegen laufende Instanzen der gebauten App. Eine temporäre Brücke (nicht eingecheckt) reichte ihnen nur weiter, was ein MCP-Client seinem Modell zeigt: Server-Anweisungen, Tool-Liste mit Schemas und den Textblock jeder Antwort. Quelltext und Dokumentation waren ihnen untersagt; ein Subagent durfte zusätzlich den Skill lesen. Jedes Ergebnis wurde anschließend unabhängig über den Dokumentzustand der App und teils per Screenshot geprüft, nicht aus dem Bericht übernommen.

| Subagent | Aufgabe | Aufrufe / Fehler | Geprüftes Ergebnis |
| --- | --- | --- | --- |
| Blind, Neuaufbau | Architekturdiagramm mit Container, vier Boxen, Datenbank, vier Verbindungen, Notiz; danach Umfärben, Umbenennen, Verschieben | 4 / 0 | Alle elf Elemente korrekt, alle Verbindungen gebunden. |
| Mit Skill, Bearbeiten | Zehn Änderungen an einem bestehenden Diagramm, darunter Löschen mit Verbindung, zweite Seite, atomare Doppeländerung, provozierter Revisionskonflikt | 12 / 1 (provoziert) | Alle Änderungen vorhanden, unberührte Elemente unverändert, keine lose Verbindung. |
| Blind, Störfälle | Gleichzeitige Nutzeränderung, Wiederholung, Dokumentwechsel, acht parallele Lesezugriffe, fehlerhafte Eingaben, Text mit eingebetteter Anweisung | 30 / 10 (alle provoziert) | Kein Schreibzugriff im falschen Dokument; acht von acht parallelen Lesezugriffen erfolgreich; jede Fehlermeldung nannte die Ursache. |
| Blind, Code und Größe | Änderungen nur über Diagrammcode; zweite Seite mit 30 Boxen und 25 Verbindungen; Suche und Einfärben | 13 / 2 | 55 Elemente in einem Aufruf; genau elf Boxen eingefärbt. Eine Verbindung im Code gelang erst mit von Hand berechneter Geometrie. |
| Blind, Bestätigung des Endstands | Ablauf mit zwei Seiten, Löschen mit Verbindungen ohne Volllesen, Wiederholung, Dokumentwechsel | 18 / 7 | Aufgabe gelöst; vier Fehler gingen auf zwei Lücken zurück (siehe unten), einer war provoziert. |

Aus den Berichten übernommen: Verbindungsenden in Suchtreffern, eigener Text für eine Wiederholung, Standardgrößen und Seitenregel in Anweisungen und Schema, Seitenliste in der Analyse, deutlichere Meldung bei verbrauchter `commandId`, Hinweis, dass der Code-Pfad keine Verbindungen berechnet. Die beiden Lücken des Bestätigungslaufs (Seiten-ID nicht auffindbar, verbrauchte `commandId` nach Ablehnung) wurden danach behoben; dieser letzte Stand ist durch Unit- und Integrationstests belegt, aber nicht durch einen weiteren Subagentenlauf.

Nicht übernommen und offen: IDs der angelegten Elemente im Schreibergebnis, Seiten- und Feldfilter für große Dokumente, berechnete Verbindungen im Code-Pfad, einheitliche Form für Schemafehler der SDK-Schicht, Bedeutung von `retryable`.

## Prüfungen

Cloud-Linux, Node 22, Stand vor dem Commit.

- `npm run typecheck`: bestanden.
- `npx vitest run`: 892 von 892 in 103 Dateien; davon 44 in `tests/unit/mcp` und `tests/unit/mcp-review-boundaries.spec.ts` (neu: `agent-commands.spec.ts`, `tooling.spec.ts`, drei Fälle in `backend.spec.ts` über echten Host, Renderer-Handler und gebauten stdio-Adapter).
- `node --test tests/unit/*.test.mjs`: 69 von 69.
- `npx playwright test --project=electron` (xvfb, unprivilegiert, Sandbox aktiv): 11 von 11.
- `npx playwright test --project=ui`: 189 von 190 auf dem Stand vor den letzten Textänderungen; der eine Fehlschlag (`whiteboard.spec.ts`, Rendern aller Grundformen) trat auf, während parallel eine App-Instanz mit Subagent lief, und bestand im Einzellauf (15 von 15). Auf dem Endstand lief davon nur `agent-access.spec.ts` (2 von 2); die vollständige Suite läuft in der CI.
- Nicht geprüft: echte Clients (Claude Code, Codex, Antigravity), Windows und macOS von Hand, Laufzeitkosten. Zeit, Tokens und Kosten der Subagenten: unbekannt bis auf die vom Werkzeug gemeldeten Tokenzahlen je Lauf (rund 93 000 bis 101 000).

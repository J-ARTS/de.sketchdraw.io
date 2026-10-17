# Sprintplan und Abnahme

Gesamtziel: [#4](https://github.com/J-ARTS/de.sketchdraw.io/issues/4). S0–S5 sind implementiert und anhand der [vollständigen nativen CI](https://github.com/J-ARTS/de.sketchdraw.io/actions/runs/39046419226) geprüft. [Release v0.1.1](https://github.com/J-ARTS/de.sketchdraw.io/releases/tag/v0.1.1) enthält genau drei native Installer; ihre öffentlichen Downloads stimmen mit den geprüften CI-Dateien überein. Der wiederholte Publish-Lauf bestätigt das identische Release ohne Änderungen. Konkrete Ergebnisse, historische Fehlversuche und Grenzen stehen im [konsolidierten Nachweis](reviews/release-validation.md). Der aktuelle Ticketabschluss wird direkt in GitHub und im Arbeitsledger gepflegt.

Der Nutzer hat die vorübergehende Implementierungsübernahme durch Codex freigegeben. Echte Claude-Code-, Antigravity-Gemini- und zusätzlich angeforderte Antigravity-Claude-Läufe erreichten ihre Kontingente; gelieferte Beiträge bleiben ihnen zugeordnet. Die regulären Verantwortlichkeiten bleiben bestehen; tatsächliche Ausführung und unbekannte Aufwandswerte sind getrennt im Arbeitsledger erfasst.

| Sprint | Ergebnis | Tickets | Federführung | Abhängigkeit |
| --- | --- | --- | --- | --- |
| S0 | Research, Architektur, Verträge und überprüfbare Orchestrierung | #5, #6, #7 | Codex; Bedenken von Claude Code und Antigravity | keine |
| S1 | Startbare App, Dokument-Engine, benutzbares Whiteboard | #8, #9, #10 | Antigravity: Hülle/Engine; Claude Code: UI | Verträge aus S0 |
| S2 | Cloud-Katalog und bidirektionaler Diagrammcode | #11 | Antigravity: Parser/Katalog; Claude Code: Code-/Katalog-UI | Engine und Whiteboard |
| S3 | Offene Formate und echte externe Agentenbearbeitung | #12, #13 | Antigravity: Adapter/MCP; Claude Code: Import-/Agenten-UI | validierte Commands |
| S4 | Verschlüsselte direkte Zusammenarbeit und Rollen | #14 | Antigravity: Transport/IAM; Claude Code: Pairing/Presence | Daten-/Commandverträge, Sicherheitsreview |
| S5 | Vollständige Integration, Plattformnachweise und tatsächliches Release mit drei Installern | #15, #24 | Codex; Fehlerkorrekturen bei jeweiligem Owner | S1–S4 |

## Abnahmematrix

| Anforderung | Unit-/Integrationsevidenz | UI-/Systemevidenz |
| --- | --- | --- |
| Freies Zeichnen, Text, Bilder, Shapes, Connector, Container | Geometrie, Referenzen, Commands, Assetvalidierung | Jede Elementart erstellen, bearbeiten, speichern und wieder öffnen |
| Pan/Zoom, Auswahl, Resize, Undo/Redo | Koordinatenumrechnung, Transaktionshistorie | Maus-/Keyboard-Interaktionen und Gesten an mehreren Zoomstufen |
| AWS/Azure/GCP/generisch, eigene Sets/Widgets/Metadaten/Links | Katalogschema und Roundtrips | Komponente einfügen, Set importieren, Metadaten bearbeiten |
| Diagram as Code | Parser/Formatter, stabile IDs, ungültige Eingaben, Revisionen | Code→Canvas und Canvas→Code; Fehlerentwurf bleibt erhalten |
| draw.io und SVG | Reale Format-Fixtures, Kompression, Sicherheit, Verlustberichte | Import, sichtbare Warnung, Export, Wiederimport |
| MCP/Skills | Echter stdio Client, Zugriff/Revisionen, Toolfehler | Agentenänderung erscheint und lässt sich menschlich editieren |
| Strict P2P und IAM | Pairing, Rollenprüfung, Konflikte, Duplikate | Zwei echte Peers, Viewer-Angriff, Reconnect, Offline-Fehlerpfad |
| Desktop Windows/Linux/macOS | Typecheck/Build/Packaging je Plattform | Electron-Smoke, native Dateidialoge/Persistenz; nur tatsächlich ausgeführte Plattformen als geprüft ausweisen |
| Finale Release-Assets | Tag-/Versions-/Revisionsgleichheit, genau drei Assets, Wiederholung ohne Fremdüberschreiben | Windows x64 NSIS `.exe`, macOS arm64/M1 `.dmg`, Linux x64 `.deb`: echte Paket-/Startprüfung auf passender Plattform vor Veröffentlichung |
| Einfaches zugängliches Design | Komponentenzustände | Screenshots, Tastatur/Fokus, Kontrast, 1280×800 und kompakteres Fenster, Light/Dark |
| Ticket-/Tool-/Aufwand-Graph | Referenzintegrität, null-Metriken, eindeutige Run-Summen | graphify query/path und synchronisierter Ticketstand |

## Definition of Done

Ein Arbeitspaket ist erst implementiert und geprüft, wenn Akzeptanzkriterien durch reale Ergebnisse belegt sind, zugehörige Fehlerpfade geprüft wurden, unabhängige Befunde bearbeitet sind und Issue/Run/Artefakte aktuell sind. Lokale Umsetzung bleibt bis Integration offen. Das Gesamtziel verlangt sämtliche Zeilen der Matrix; ein grüner Smoke-Test ersetzt keine Fähigkeitsprüfung.

## Agentenkoordination

- Claude Code: `src/renderer/`, zugehörige UI-Tests, Designresearch und eigener Bedenkenbericht.
- Antigravity: `src/domain/`, `src/codec/`, `src/catalog/`, `src/interop/`, `src/mcp/`, `src/collaboration/`, `electron/`, Paket-/Buildkonfiguration und eigener Bedenkenbericht.
- Codex: gemeinsame Architekturverträge, Teststrategie, unabhängige Integrations-/UI-Prüfung, Sprintsteuerung, Graphify und Bedenkenentscheidungen.
- Gemeinsame Verträge vor gleichzeitigen Edits fixieren. Dateibesitz ist auf den jeweiligen Auftrag begrenzt, keine pauschale Sperre.
- Modelle und Modi aus tatsächlichen Tool-/UI-Nachweisen erfassen. Ausgeführte Arbeit nie einem lediglich geplanten Modell zuschreiben.
- Die Tabelle nennt reguläre Owner; die nutzerautorisierte temporäre Codex-Übernahme wird pro Issue und Run zusätzlich erfasst. Unbekannte Laufzeit-, Token- und Kostenwerte bleiben unbekannt.

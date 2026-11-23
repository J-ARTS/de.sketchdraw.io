# Mermaid-Diagramme über den Mermaid-Renderer (#279)

Stand 23.11.2026. Umsetzung: Claude Code.

## Was umgesetzt ist

- **Import:** Flowcharts (`flowchart`, `graph`) und Sequenzdiagramme (`sequenceDiagram`) werden wie bisher zu Formen. Jede andere Diagrammart zeichnet Mermaid selbst (`src/renderer/lib/mermaid-render.ts`). Das Ergebnis ist ein Bild (PNG) auf der Zeichenfläche, das seinen Code trägt (Metadaten `mermaid:code`).
- **Code-Panel:** Ein solches Bild zeigt seinen Code. Geänderter Code wird mit „Neu zeichnen" (oder Strg/⌘+Enter) übernommen; das Bild behält Platz und Breite. Kann Mermaid den Code nicht lesen, bleibt das Bild unverändert und das Panel zeigt, was Mermaid gemeldet hat. Gezeichnet wird auf Anforderung, nicht bei jedem Tastendruck: Jede Zeichnung legt ein neues Bild im Dokument ab.
- **Export:** SVG und draw.io enthalten das Bild (wie jedes Bild). Der Mermaid-Export bietet das Bild als eigenes Diagramm an und schreibt seinen Code; ein unveränderter eigener Export kommt als ganzes Dokument zurück.

## Ergebnis mit den Beispielen von mermaid.js.org

Die Seite https://mermaid.js.org/syntax/all-examples.html zeigt 81 Beispiele in 34 Diagrammarten (Paket `@mermaid-js/examples` 2.1.0). Alle 81 liegen unter `tests/fixtures/mermaid-examples/all/`.

| | Anzahl | Ergebnis |
| --- | --- | --- |
| Flowchart, Sequenzdiagramm | 7 | bearbeitbare Formen |
| alle übrigen Arten | 74 | von Mermaid gezeichnet, als Bild mit Code |
| nicht importierbar | 0 | |

ZenUML ist nicht unter den Beispielen; Mermaid zeichnet es nur mit einem Zusatzpaket, das nicht gebündelt ist. Solcher Code meldet den Grund, den Mermaid nennt.

## Layout: ELK ist nicht dabei

Mermaid 12 verwendet als Voreinstellung das Layout ELK (`elkjs`). `elkjs` steht unter **EPL-2.0 oder GPL-3.0-or-later**. Ob eine solche Bibliothek in den Installern von Sketchdraw (eigene Endnutzer-Lizenz) mitgeliefert werden soll, ist eine Entscheidung des Owners, keine technische. Bis dahin gilt:

- Der Build ersetzt `elkjs` durch einen Platzhalter (`src/renderer/lib/stubs/elk.ts`, Alias in `vite.config.ts`); im gebauten Programm ist kein ELK-Code.
- Mermaid zeichnet mit seinem eigenen Layout (`layout: 'dagre'`), dem Layout der Versionen vor 12. Alle 74 Beispiele werden damit gezeichnet.
- Code, der ausdrücklich ELK verlangt (`layout: elk`), wird nicht gezeichnet und sagt das.

Folge: Flächen- und Kantenführung von Klassen-, Zustands- und ER-Diagrammen entsprechen dem klassischen Mermaid, nicht dem neuen Standard von mermaid.live. Soll ELK mitgeliefert werden, genügt es, den Alias und die Layout-Einstellung zu entfernen und die Lizenzhinweise zu ergänzen.

## Sicherheit

- Mermaid läuft im Renderer (Sandbox, keine Node-Integration) mit `securityLevel: 'strict'`: HTML in Beschriftungen wird als Text behandelt, Klick-Aktionen sind abgeschaltet.
- Die Zeichnung wird als Bild geladen (`<img>` mit Daten-Adresse) und auf eine Zeichenfläche gerastert. In einem Bild laufen keine Skripte und es wird nichts nachgeladen; ins Dokument gelangen nur Pixel.
- **Content Security Policy:** unverändert (`script-src 'self'`, `style-src 'self' 'unsafe-inline'`, `img-src 'self' data: blob:`). Mermaid braucht kein `eval`; die Stilangaben in der Zeichnung fallen unter die bereits erlaubten Inline-Stile. Der Browser-Test zeichnet alle 74 Beispiele unter dieser Policy und prüft, dass nichts blockiert wurde; der Electron-Test tut dasselbe im gebauten Programm mit einem Klassendiagramm.
- Grenzen: Code bis 50 000 Zeichen (Mermaids eigene Grenze), Bild bis 8 MB (Grenze für Bilder im Dokument). Darüber wird nicht importiert und der Grund genannt.
- `npm audit --omit=dev`: 0 Schwachstellen (23.11.2026).

## Paketgröße

Gemessen am gebauten Renderer (`dist/assets`, unkomprimiert):

| | Code | Source Maps |
| --- | --- | --- |
| vor #279 | 8,4 MB | 13,3 MB |
| mit Mermaid, ohne weitere Maßnahme | 13,6 MB | 31,4 MB |
| mit Mermaid, wie ausgeliefert | 12,2 MB | 13,5 MB |

Die Installer packen `dist` vollständig. Deshalb liefert der Build für reine Bibliotheks-Teile (Mermaid und was es nachlädt) keine Source Maps mehr mit (`dropLibrarySourceMaps` in `vite.config.ts`); die Maps des eigenen Codes bleiben. Zuwachs damit: etwa 4 MB unkomprimiert statt 23 MB. Mermaid wird erst geladen, wenn ein solches Diagramm importiert oder neu gezeichnet wird; der Start der App lädt es nicht. Die Größe der Installer selbst ist hier nicht gemessen (kein Installer-Build in dieser Umgebung).

## Lizenzen

`THIRD_PARTY_NOTICES.md` nennt `mermaid` 12.3.0 (MIT) und die Lizenzen der 116 Pakete, die es mitbringt (MIT, ISC, BSD-3-Clause, Apache-2.0, MPL-2.0 OR Apache-2.0, Unlicense), und dass `elkjs` nicht ausgeliefert wird.

## Grenzen und offene Punkte

1. **Ein Bild, keine Formen.** Teile des Diagramms lassen sich nicht einzeln verschieben oder verbinden. Echte Formen für einzelne Arten (Klassen-, Zustands-, ER-Diagramm) wären eigene Tickets.
2. **Weißer Grund.** Das Bild hat einen weißen Hintergrund und Mermaids helles Farbschema, auch im dunklen Modus der App.
3. **Schrift.** Ein gerastertes Bild kann die Schriften der App nicht laden; Mermaid zeichnet mit Helvetica/Arial bzw. der Systemschrift. Die Schrift kann sich zwischen Betriebssystemen leicht unterscheiden.
4. **Alte Bilder bleiben im Dokument.** Jede Neuzeichnung fügt ein Bild hinzu; das vorherige bleibt für „Rückgängig" erhalten und wird nicht entfernt (das gilt für alle Bilder im Dokument, nicht nur für diese).
5. **P2P und MCP.** Gäste und Agenten sehen Bild und Code. Ändert ein Agent den Code über MCP, wird das Bild nicht neu gezeichnet; das geschieht erst, wenn jemand in der App „Neu zeichnen" wählt.
6. **Flowcharts, die der eigene Leser nicht versteht,** melden weiterhin ihren Fehler und fallen nicht auf Mermaid zurück.

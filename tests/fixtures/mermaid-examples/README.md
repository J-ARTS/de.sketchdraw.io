# Mermaid-Beispiele

Die Flowchart- und Sequenzdiagramm-Beispiele von https://mermaid.js.org/syntax/all-examples.html (Mermaid, MIT-Lizenz),
abgerufen am 22.11.2026; die Nummer im Dateinamen ist die Position auf der Seite. `tests/unit/renderer/mermaid-import.spec.ts`
prüft, dass jedes davon als bearbeitbares Diagramm importiert wird.

## `all/`: alle 81 Beispiele der Seite

Die Seite wird aus dem Paket `@mermaid-js/examples` erzeugt (MIT). `all/` enthält die 81 Beispiele aus Version 2.1.0
dieses Pakets, 34 Diagrammarten, als Text aus der Paketdatei gelesen (nicht ausgeführt); Dateiname: Diagrammart,
laufende Nummer, Titel. Die sieben Flowchart- und Sequenz-Beispiele darin sind dieselben wie oben.

- `tests/unit/renderer/mermaid-image.spec.ts` prüft, dass Flowcharts und Sequenzdiagramme zu Formen werden und jede
  andere Art an Mermaid geht (#279).
- `tests/ui/mermaid-image.spec.ts` lässt Mermaid alle 74 übrigen Beispiele in der App zeichnen.


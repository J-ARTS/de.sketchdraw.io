# Interop-Fixtures

`native.drawio` und `native.svg` sind am 17.10.2026 von Codex handgeschriebene, unabhängige Fremdformat-Referenzen. Sie wurden nicht mit dem Sketchdraw-Exporter erzeugt und nicht aus einer draw.io-/Browser-Oberfläche exportiert. Die komprimierte Variante wird im Test direkt aus dem unabhängigen mxGraphModel mit raw DEFLATE gebildet.

Die Tests fixieren Geometrie, Unicode, Container/Portkoordinaten, Connectoranker, Transformreihenfolge, lokale use-Expansion sowie Kurven. Diese Herkunft ist kein Nachweis einer bestandenen Fremdprogrammabnahme. Tatsächlich in diagrams.net geöffnete/geänderte Dateien und eine unabhängige Browserdarstellung sind noch durch die Gesamtintegration nachzutragen.

`external/drawio-library-icons.drawio` ist am 22.11.2026 von Claude Code von Hand nachgebaut (#280): Zellen in der Schreibweise von draw.io, die Icons der draw.io-Bibliotheken nur beim Namen nennen (Azure `img/lib/azure2/…`, Kubernetes `mxgraph.kubernetes.icon2` mit `prIcon`), dazu ein unbekanntes Azure-Icon, ein Clipart, ein Bild von einer Web-Adresse und zwei Verbindungen. Die Datei stammt nicht aus draw.io und enthält keine Inhalte aus einer Datei des Owners.

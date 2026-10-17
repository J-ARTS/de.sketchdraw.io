# Echte Fremdprogrammprüfung, 17.10.2026

Alle Inhalte sind eigene synthetische Prüfdaten ohne private Informationen. `generate-external.mjs` erzeugt die Ausgangsdokumente mit den tatsächlichen Sketchdraw-Exportfunktionen. Die Rohdateien aus `app.diagrams.net` wurden durch dessen sichtbare Oberfläche exportiert und unverändert aus Downloads hierher kopiert.

| Datei | Herkunft |
| --- | --- |
| `synthetic.sketchdraw.json` | Synthetisches Schema-1-Ausgangsdokument. |
| `sketchdraw-export.svg`, `sketchdraw-export.drawio` | Aktuelle echte Adapterausgaben; draw.io enthält die korrigierte sichtbare Containerprojektion. |
| `sketchdraw-export-before-container-fix.drawio` | Tatsächliche erste Adapterausgabe mit unsichtbarem `group`-Container, als Vorherbeleg erhalten. |
| `diagrams-net-edited.drawio` | Echter komprimierter XML-Download aus diagrams.net 32.5.4 nach sichtbarer Änderung „Input label only“ → „Edited in diagrams.net“, noch vor Containerkorrektur. |
| `diagrams-net-container-fixed.drawio` | Zweiter echter komprimierter Download nach Laden des korrigierten Exports. |
| `diagrams-net-loaded.jpg`, `diagrams-net-edited.jpg` | Vorherdarstellung und echte Textbearbeitung. |
| `diagrams-net-container-fixed.jpg` | Erneut geprüfter Container mit Rahmen, Füllung und Beschriftung oben. |
| `chromium-svg.jpg` | Direkte SVG-Darstellung in Google Chrome 155.0.8059.82. |

Der Import in diagrams.net erfolgte über **Extras → Diagramm bearbeiten**, mit dem unveränderten `mxGraphModel` aus der exportierten `.drawio`-Datei. Der Browser-Uploadweg **Datei → Öffnen von → Gerät** lieferte keinen nutzbaren Dateiauswahldialog. Die Downloadereignis-Beobachtung lief ebenfalls in ein Timeout; die tatsächlich erzeugten Downloads waren lokal vorhanden und wurden anhand des gewählten Namens geprüft. Dies ist echte Format-/Darstellungs-/Editierbarkeitsprüfung, kein Nachweis eines bestandenen Browser-Dateiauswahldialogs.

Details und Prüfbefehle: `docs/reviews/codex-interop-external-acceptance.md`. Diese Unterordner-Fixtures sind von den ausdrücklich handgeschriebenen Referenzen im Elternordner zu unterscheiden.

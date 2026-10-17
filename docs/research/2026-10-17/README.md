# UI-Recherche: Evidenzindex, 17.10.2026

Issue [#5](https://github.com/J-ARTS/de.sketchdraw.io/issues/5), Run `codex-research-001`. Erfasser: interne Codex-Unterstützung. Auswertung: [Designresearch](../../design-research.md).

Die JPEGs sind unveränderte Screenshots eigener öffentlicher Browser-Tabs im Codex In-app Browser auf macOS, jeweils **1280 × 720 Pixel**. Sie zeigen die in dieser Sitzung tatsächlich sichtbare UI und keine nachgebauten Mockups. Datum: 17.10.2026, Aufnahmezeitraum etwa 14:15–14:18 Europe/Berlin laut lokalen Dateizeitstempeln. Keine Kontoanmeldung, keine Nutzerdiagramme, keine Freigabe, keine Dateiablage in einem Fremdprodukt. Fremde Produktgestaltung dient ausschließlich als Recherchebeleg.

## Aufnahmen und Abläufe

| Datei | Quelle | Sichtbarer Zustand / Ablauf |
| --- | --- | --- |
| [excalidraw-start.jpg](excalidraw-start.jpg) | [Excalidraw](https://excalidraw.com/) | Leere Anfangsansicht; Werkzeugleiste, Speicherhinweis und Canvas-Aktionen. |
| [excalidraw-rectangle-tool.jpg](excalidraw-rectangle-tool.jpg) | Excalidraw | Klick auf Rechteck; linke Eigenschaften sichtbar; kein Shape erzeugt. |
| [excalidraw-library.jpg](excalidraw-library.jpg) | Excalidraw | Bibliothek geöffnet; Leerzustand und Schließen/Offenlassen. |
| [excalidraw-collaboration.jpg](excalidraw-collaboration.jpg) | Excalidraw | Zusammenarbeitsdialog geöffnet; keine Sitzung gestartet oder Link exportiert. Escape schließt und stellt Fokus am Auslöser wieder her. |
| [azure-start.jpg](azure-start.jpg) | [Azure Diagrams](https://azurediagrams.com/) | Einstieg mit Beispielen und leerer Arbeitsfläche. |
| [azure-canvas.jpg](azure-canvas.jpg) | Azure Diagrams | Neue leere Arbeitsfläche; permanenter linker Dienstekatalog. |
| [azure-search.jpg](azure-search.jpg) | Azure Diagrams | Suche nach `storage`; ein Serviceeintrag mit Hauptbezeichnung und Untertitel. Klick auf den Text zeigte keine sichtbare Änderung. |
| [azure-search-empty.jpg](azure-search-empty.jpg) | Azure Diagrams | Suche nach `sketchdraw-nomatch-001`; leere Ergebnisfläche ohne erklärenden Text. |
| [diagrams-start.jpg](diagrams-start.jpg) | [diagrams.net](https://app.diagrams.net/) | Leeres unbenanntes Dokument mit Bibliothek links und Formatbereich rechts. |
| [diagrams-libraries.jpg](diagrams-libraries.jpg) | diagrams.net | Mehr-Shapes-Dialog; anschließend abgebrochen, keine Auswahl gespeichert. |
| [diagrams-mermaid.jpg](diagrams-mermaid.jpg) | diagrams.net | Anordnen → Einfügen → Mermaid; Vorgabetext, Diagramm/Bild und Vorschau. |
| [diagrams-mermaid-error.jpg](diagrams-mermaid-error.jpg) | diagrams.net | Vorschau mit `not-a-diagram`: Fehlerdialog; Entwurf bleibt danach erhalten. Nichts in das Diagramm eingefügt. |
| [diagrams-mermaid-close-confirm.jpg](diagrams-mermaid-close-confirm.jpg) | diagrams.net | Versuch, den veränderten Codeentwurf zu schließen, löst Rückfrage aus; Rückfrage abgebrochen. |

Zusätzliche Beobachtung ohne gesondertes Bild: Die Mermaid-Vorschau für `graph TD` mit nachfolgendem `A -->` zeigte A als einzelne Form und keinen Fehler. Daraus folgt kein Nachweis strenger Parservalidierung. Nach Bestätigung des Fehlers zum unbekannten Diagrammtyp blieb der eingegebene Text sichtbar. Die Bestätigung zum Verwerfen wurde nicht ausgeführt.

## Quellen und Grenzen

Alle Quellenzugriffe: 17.10.2026. Livebeobachtungen sind durch die obigen Bilder und die beschriebene Folge begrenzt. Accessibility-Bäume wurden zur Bedienung und Prüfung der sichtbaren Namen verwendet; sie sind kein vollständiger Screenreader-/WCAG-Nachweis. Keine Buildnummern, Transportdetails, Renderperformance oder Vollständigkeit der Fremdprodukte geprüft.

- [draw.io: Editor themes](https://www.drawio.com/docs/manual/editor/appearance/) ergänzt die live beobachtete Standardansicht um dokumentierte alternative Layouts; keine davon live umgeschaltet.
- [draw.io: Mermaid](https://www.drawio.com/docs/manual/mermaid/) und [Insert Mermaid code](https://www.drawio.com/docs/manual/insert/insert-mermaid/) beschreiben die erneute Codebearbeitung widersprüchlich. Kein vollständiger Roundtrip der Referenz durchgeführt; keine pauschale Behauptung dazu.
- W3C-Grundlagen für die vorgeschlagene Testmatrix: [Keyboard](https://www.w3.org/WAI/WCAG22/Understanding/keyboard.html), [Dragging Movements](https://www.w3.org/WAI/WCAG22/Understanding/dragging-movements.html), [Target Size](https://www.w3.org/WAI/WCAG22/Understanding/target-size-minimum.html), [Focus Not Obscured](https://www.w3.org/WAI/WCAG22/Understanding/focus-not-obscured-minimum.html).

## Integrität

Die zugehörige Datei [screenshots.sha256](screenshots.sha256) enthält SHA-256-Prüfsummen aller 13 JPEGs. Die Dateien bleiben lokal und uncommittet, bis der Koordinator die Repository-Integration vornimmt. Der Index belegt Research, keine abgeschlossene Sketchdraw-Implementierung.

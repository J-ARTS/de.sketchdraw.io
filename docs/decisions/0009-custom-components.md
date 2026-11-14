# ADR 0009 — Eigene Komponenten als gespeicherte Auswahl im Editor

Status: angenommen und umgesetzt ([#188](https://github.com/J-ARTS/de.sketchdraw.io/issues/188)). Nutzerwunsch vom 14.11.2026.

## Entscheidung

1. **Eine eigene Komponente ist eine gespeicherte Auswahl.** Sie hält die markierten Elemente im geprüften Zwischenablage-Format `sketchdraw.elements` (`src/renderer/state/element-clipboard.ts`): mehrere Elemente, Kinder von Containern, Verbinder zwischen den gespeicherten Elementen, Bilder und benötigte Komponentensets. Einfügen ist ein Einfügen aus der Zwischenablage (`planElementPaste`): neue IDs, aktive Seite, ein Schritt im Rückgängig-Verlauf. `ComponentDefinition` beschreibt nur ein einzelnes Symbol und bleibt den Katalogsets vorbehalten.
2. **Die Bibliothek gehört zum Gerät, nicht zum Dokument.** Sie liegt in `localStorage` unter `sketchdraw.custom-components.v1` (`{ version: 1, components: [{ id, name, payload }] }`), wie die Formenleiste, und steht in jedem Dokument bereit. Eingefügte Komponenten sind gewöhnliche Elemente; ein Dokument hängt nie an der Bibliothek, und Diagrammcode, P2P-Sitzungen und MCP bleiben unberührt.
3. **Gespeicherter Text gilt als fremd.** Beim Laden wird jeder Eintrag wie Zwischenablage-Text geprüft (`parseElementClipboard`); beschädigte, doppelte und namenlose Einträge entfallen. Beim Speichern läuft dieselbe Prüfung, damit nichts abgelegt wird, das ein Neustart verwerfen würde.
4. **Grenzen:** höchstens 200 Komponenten, 512 KiB je Komponente, 4 MiB für die Bibliothek, Namen einzeilig mit höchstens 60 Zeichen. Überschreitungen und ein abgelehnter Speicherzugriff werden als Fehlermeldung gezeigt; der Zustand bleibt dann unverändert.
5. **Bedienung.** „Als Komponente speichern“ steht im Mehr-Menü der Auswahlleiste (Elementaktionen). Es gibt keinen Namensdialog: Die Komponente entsteht sofort mit einem abgeleiteten Namen (Beschriftung eines einzelnen Elements, sonst „Komponente N“), die Bibliothek öffnet sich im Reiter „Eigene“, und der Name steht im Bearbeitungsmodus. Der Reiter zeigt Vorschau-Kacheln; Klick fügt in der Mitte ein, Ziehen an der Zielstelle, Stift benennt um, Papierkorb löscht nach Rückfrage in der Kachel.

## Bedenken und Folgen

- `localStorage` wird nicht gesichert und nicht zwischen Geräten geteilt; wer die App-Daten löscht, verliert die Bibliothek. Export und Import der Bibliothek sind nicht umgesetzt.
- Löschen läuft nicht über den Dokument-Verlauf und lässt sich nicht mit Strg+Z zurücknehmen. Deshalb die Rückfrage.
- Agenten sehen die Bibliothek nicht. Wer Komponenten für Agenten braucht, legt sie in einem Dokument ab.
- Mehrere Fenster teilen sich die Bibliothek; ein Fenster lädt sie über das `storage`-Ereignis neu, wenn ein anderes sie ändert. Zwei gleichzeitige Änderungen können sich dabei überschreiben (letzter Schreiber gewinnt).

## Code

`src/renderer/lib/custom-components.ts` (Speicher, Prüfung, Zustand), `src/renderer/components/CustomComponentsTab.vue` (Reiter), `ShapeLibraryPanel.vue` (Reiterleiste), `SelectionToolbar.vue` (Aktion), `WhiteboardCanvas.vue` (Ablegen), Store-Aktionen `saveSelectionAsComponent` und `insertCustomComponent`.

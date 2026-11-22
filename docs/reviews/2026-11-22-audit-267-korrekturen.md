# Korrekturen zum Audit #267 (Stand 22.11.2026)

Werkzeug: Claude Code (Cloud-Sitzung), Modell `claude-fable-5-2`. Ausgangsstand `01482d1`. Zeit-, Token- und
Kostenwerte sind nicht erfasst und bleiben unbekannt.

Dieser Bericht hält fest, welche Befunde des Audits nachvollzogen wurden, was geändert wurde und welche
Vertragsänderungen dabei außerhalb des Frontends liegen. Die Einzelnachweise stehen in den Tickets.

## Nachvollzogen und behoben

| Ticket | Ursache | Änderung |
| --- | --- | --- |
| #270 | `updateTask` schickte Titel und Beschreibung nie an Jira; der nächste Abruf überschrieb sie. Zusätzlich wies `boundedString` jede mehrzeilige Beschreibung ab (Zeilenumbruch galt als Steuerzeichen), auch beim Anlegen. | `UpdateJiraIssueInput` hat `title` und `description`; der Store sendet sie nur, wenn sie sich geändert haben. Mehrzeilige Beschreibungen sind erlaubt. Das Formular sagt bei Jira-Aufgaben, dass die Beschreibung als einfacher Text übertragen wird. |
| #273 | Das Statusfeld des Formulars rief `updateTask` sofort auf. | Der Status ist Teil des Formularentwurfs; gespeichert werden nur Felder, die im Formular geändert wurden. |
| #268 | `hasDraft` kannte Link- und Autoränderungen eines Textentwurfs nicht, `applyText` schon. | Beide lesen `textEditChanges`. |
| #272 | Der Import vergleicht die sichtbare Darstellung mit der des heutigen Exporters; #259/#254/#258 haben diese Darstellung geändert, ohne die Version zu erhöhen. | Versionen der Darstellung je Format (`CURRENT_PROJECTION`): SVG 2, draw.io 3, Mermaid 2. Die Darstellungen des Release bleiben für den Vergleich zeichenbar. Release-Dateien liegen als Fixtures vor. |
| #218 | Die Dienste wurden bei `before-quit` abgebaut, das bei jedem Versuch feuert; ein bestätigtes Beenden wurde nach dem Schließen des Fensters nicht fortgesetzt. | `QuitLifecycle`: Abbau bei `will-quit`, Fortsetzung nach `closed`, Abbrechen verwirft den Wunsch. |
| #269 | Die Seitenzwischenablage trug keine Komponentendefinitionen; die Prüfung wies die Seite ab. | Definitionen reisen mit (`componentSets`, optional, Version bleibt 1); Einfügen ergänzt fehlende Sets in einem Schritt. |
| #274 | `pastePage` prüfte das Zieldokument nach dem Lesen der Zwischenablage nicht erneut. | Sitzung vor und nach dem Lesen vergleichen; veraltete Ergebnisse verwerfen. |
| #275 | Fokus über `aria-label="Folienname"` gesucht; Name nur per Doppelklick. | Fokus über die Feldreferenz; der Name ist eine normale Schaltfläche „… umbenennen“; Enter/Escape geben den Fokus zurück. |
| #260 | Komponenten standen in draw.io als Rechteck mit Namen. | Komponenten stehen als SVG-Bild ihrer Karte in der Datei (dieselbe Zeichnung wie im SVG-Export); der Name bleibt verdeckter Zellenwert. |
| #261 | Der Mermaid-Export kannte nur `flowchart` und machte aus jedem Element einen Knoten. | Sequenzdiagramme werden als `sequenceDiagram` geschrieben (Code des Code-Panels); der Flowchart enthält nur, was ein Flowchart zeigen kann. |

## Vertragsänderungen außerhalb des Frontends (zur Abnahme durch Antigravity/Codex)

1. **Jira** (`src/domain/plugins.ts`, `electron/plugin-service.ts`): `updateJiraIssue` schreibt `summary` und
   `description`. Die Beschreibung ersetzt den Jira-Text als einfacher Text (ADF-Absätze). Formatierungen, Tabellen und
   Bilder einer in Jira gepflegten Beschreibung gehen dabei verloren. Deshalb wird nur bei tatsächlicher Änderung
   gesendet. Alternative, falls das nicht gewünscht ist: Beschreibung für Jira-Aufgaben schreibschützen.
2. **Austauschformate** (`src/interop/common.ts`, `export.ts`, `mermaid.ts`): Jede Änderung der sichtbaren Darstellung
   braucht ab jetzt eine neue Versionsnummer und einen Fixture-Ordner des Release, sonst werden vorhandene Dateien als
   „veraltet“ behandelt. Eine ältere App liest Dateien mit höherer Nummer wie bisher über die sichtbare Darstellung.
3. **draw.io**: Komponenten sind Bilder; ihr Text ist in draw.io nicht bearbeitbar. Der eigene Import baut aus
   `sketchdrawComponent` wieder eine Komponente, sofern der Typ zur eingebauten Bibliothek gehört; eigene Bibliotheken
   kommen ohne eingebettetes Dokument als Rechteck zurück.
4. **Hauptprozess** (`electron/quit-lifecycle.ts`, `electron/main.ts`): geänderte Reihenfolge beim Beenden.

## Offene Punkte

- #218: Unter Linux nativ geprüft (Abbrechen → Plugin- und Update-Dienst antworten weiter → erneutes Beenden →
  Prozess endet). Der Ablauf „Abbrechen → weiterarbeiten → Cmd+Q“ mit einem echten macOS-Fenster ist nicht geprüft.
- #270: Kein Test gegen einen echten Jira-Mandanten; geprüft sind Store, Dienst (HTTP-Attrappe) und Formular.
- #260: Tabellen, Haftnotizen, Anmerkungen und Web-Einbettungen bleiben Annäherungen mit draw.io-eigenen Formen.
- #261: Ein BPMN-Ablauf wird als allgemeiner Flowchart geschrieben, nicht mit den Klassen des Code-Panels.
- Die Hinweisliste und das Bestätigungskästchen im Import/Export-Dialog sind auf Wunsch des Eigentümers entfernt
  (#276). Damit zeigt der Dialog `EMBEDDED_MODEL_STALE` nicht mehr als eigene Zeile; die Zusammenfassung nennt weiterhin,
  ob ein eigener Roundtrip, eine unterstützte Teilmenge oder eine Annäherung vorliegt.

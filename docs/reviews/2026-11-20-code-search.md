# Suchen und Ersetzen im Code-Feld (#245)

Stand: 2026-11-20 · Autor: Claude (Frontend) · Ticket: #245

## Entscheidung

- Das Code-Feld bleibt ein gewöhnliches `<textarea>`. Die Suche liegt in drei Schichten: Regeln als reine Funktionen (`src/renderer/lib/text-search.ts`), Zustand und Feldzugriff (`composables/use-text-search.ts`), Anzeige (`molecules/FindReplaceBar.vue`). Dadurch lässt sich dieselbe Leiste an weitere mehrzeilige Felder hängen.
- Treffer werden in einer Ebene über dem Text markiert (transparente Schrift, gleiche Schriftmaße, per `transform` mitgescrollt). Das setzt voraus, dass das Feld nicht umbricht (`wrap="off"`) und eine feste Zeilenhöhe hat.
- Ersetzungen laufen über `document.execCommand('insertText')` im Feld. So erreicht die Änderung den Besitzer als normales `input`-Ereignis (Canvas-Synchronisation unverändert) und der Rückgängig-Verlauf des Feldes bleibt erhalten. Wo der Befehl nichts ändert, wird der Text direkt gesetzt und ein `input`-Ereignis ausgelöst.

## Bedenken

1. **Reguläre Ausdrücke können den Renderer blockieren.**
   Fehlerfall: ein Ausdruck mit katastrophalem Backtracking (`(a+)+$`) auf einem langen Code.
   Auswirkung: Die Oberfläche steht, bis die Suche fertig ist; Daten gehen nicht verloren, weil die Suche nichts schreibt.
   Alternative: Suche in einem Worker mit Zeitlimit. Für die kurzen Texte eines Diagramms nicht umgesetzt; bei einer Ausweitung auf große Texte nötig.
2. **`execCommand` ist als veraltet markiert.**
   Auswirkung: Fällt der Befehl in einer künftigen Chromium-Version weg, greift der direkte Weg; dann geht nur der Rückgängig-Verlauf des Feldes für Ersetzungen verloren, nicht die Funktion.
3. **Markierungsebene und Umbruch.**
   Fehlerfall: Die Leiste wird an ein umbrechendes Feld gehängt.
   Auswirkung: Markierungen stehen nicht mehr auf dem Text. Für solche Felder muss die Ebene die Breite des Feldes übernehmen und gleich umbrechen.

## Nicht umgesetzt (gegenüber der IDE-Vorlage)

Suchverlauf, mehrzeilige Eingabe (Zeilenumbrüche gehen im Regex-Modus über `\n`), Filter („nur in Auswahl", Kommentare) und „Ausschließen" einzelner Treffer.

## Prüfung

- Unit: `tests/unit/renderer/text-search.spec.ts` (Suche, ganze Wörter, Regex, Gruppen, Schreibweise, Obergrenze).
- UI: `tests/ui/code-search.spec.ts` (Strg+F, Strg+R, Optionen, Ersetzen/Alle ersetzen, Canvas folgt, Rückgängig, Dark/EN, axe).

# UI-Code-Review des Renderers

Stand: 18.10.2026. Reviewer und ausführendes Tool: Claude Code (Rolle UI). Bezug: Audit [#75](https://github.com/J-ARTS/de.sketchdraw.io/issues/75), Tickets #76–#88.

## Ergebnis

Code-Review aller Vue-Komponenten und Stylesheets unter `src/renderer` mit anschließender Prüfung im lokalen Browser-Build. Die sieben Audit-Befunde #76–#82 sind bestätigt. Zusätzlich wurden sechs neue Befunde gefunden: fünf sind behoben (#83–#87), einer ist als offenes Ticket erfasst (#88).

| Ticket | Befund | Ursache | Korrektur |
| --- | --- | --- | --- |
| #76 | Kopf bei 320 px überlagert | Dokumentkarte und Arbeitsbereich-Leiste unabhängig absolut positioniert | Gemeinsames Grid `.top-chrome`; bis 640 px wandern Objekte, Hilfe und Design ins Arbeitsbereich-Menü |
| #77 | Eigenschaftenleiste verdeckt Formenleiste | z-index 20 über 12 | Seitenpanels auf Ebene 22, über Eigenschaftenleiste und Kommentar-Pins |
| #78 | Überlauf ohne Hinweis | `overflow-x: auto` ohne Affordanz, Scrollbar ausgeblendet | `useHorizontalOverflow`: Pfeil-Buttons mit eigenem Platz, Mausrad horizontal, Fokus und aktives Werkzeug werden vollständig eingeblendet |
| #79 | Plugin-Dialog lässt Fokus entkommen | Eigener `role="dialog"` ohne Fokusmodell | Natives `<dialog>` mit `showModal()`, Tab-Schleife, Fokusrückgabe |
| #80 | Aufgaben-Dialog ohne Fokus/Escape | wie #79 | wie #79, Anfangsfokus im Titel, Rückgabe an die Karte |
| #81 | Aufgaben-Dialog abgeschnitten | Keine Höhenbegrenzung, Backdrop unter der Kopfzeile | Top Layer, `max-height` mit internem Scrollbereich, umbrechende Aktionszeile |
| #82 | Kommentarmenü ohne Tastaturmuster | Nur ARIA-Rollen | Menübutton-Muster wie im Dateimenü (Pfeile, Home/End, Escape, Tab, Klick außerhalb) |
| #83 | Undefinierte Tokens, Kontrastfehler | `--surface-hover`, `--shadow-1/2/3`, `--text-secondary`, `--canvas-bg`, `--font-ui` existieren nicht; Weiß auf hellem Dark-Mode-Akzent (≈ 2,2:1); Kommentarmenü fest dunkel | Vorhandene Tokens, `--accent-contrast`, Menü-Tokens; Unit-Test prüft alle `var(--…)` |
| #84 | Kopfleisten verdecken Hauptleiste und Panels | Feste Insets (330/230 px) und feste Panel-Oberkanten | Grid (siehe #76) und Token `--panel-top` für alle Seitenpanels und Kommentar-Popover |
| #85 | „Folien“ auf der Minimap, Zoomleiste ragt über 320 px | `bottom: 76px` ignoriert Minimaphöhe | `bottom: 150px`; kompakte Abstände bis 360 px |
| #86 | Popover außerhalb des Viewports | `maxHeight 0` wurde als „unbegrenzt“ behandelt | Ausweichplatzierung auf die Seite der Leiste mit mehr Platz |
| #87 | Suchfelder ohne Fokusindikator | `outline: 0` ohne Ersatz | `:focus-within`-Rahmen mit `--focus-ring` |
| #88 | Kommentar-Editor unter Meldungen | Untere Begrenzung ignoriert Meldungsstapel | Offen (nicht Teil dieser Korrektur) |

## Gestaltungsentscheidungen

- **Kopfbereich als Grid:** Drei Spalten `minmax(max-content, 1fr) minmax(0, auto) minmax(max-content, 1fr)`. Die Werkzeugleiste bleibt zentriert, solange Platz ist, und schrumpft sonst – unabhängig von Titel- oder Seitennamenlänge. Bis 1040 px liegt sie wie bisher in Zeile 2 (84–140 px).
- **Kompakter Kopf bis 640 px:** Statt einer dritten Kopfzeile wandern seltene Aktionen ins vorhandene Arbeitsbereich-Menü; die Leistenhöhe `--chrome-height` bleibt überall 56 px.
- **Überlauf statt Umbruch:** Ein Umbruch hätte bei 320 px vier Leistenzeilen erzeugt. Die Pfeil-Buttons belegen eigenen Platz, damit sie nie ein Werkzeug verdecken; sie sind reine Zeiger-Affordanz (`aria-hidden`, `tabindex="-1"`), Tastaturnutzer navigieren mit den vorhandenen Pfeiltasten.
- **Native Dialoge:** Konsistent mit Hilfe-, Speichern- und Web-Embed-Dialog. Escape im Aufgaben-Dialog verwirft den ungespeicherten Entwurf wie „Schließen“; gespeicherte Daten bleiben unberührt.

## Bedenken und Folgearbeit

- **Werkzeugleiste zu breit:** 22 Einträge benötigen 1165 px; bei 1440 px sind 861 px verfügbar. Die Leiste ist jetzt vollständig erreichbar, ein Teil liegt aber hinter dem Pfeil. Empfehlung: Priority+-Menü „Weitere Werkzeuge“ für selten genutzte Werkzeuge (Web-Embed, Laserpointer, Frame, Container) nach Nutzungsdaten.
- **Meldungen ohne Zeitlimit:** Auch Hinweis-Meldungen bleiben bis zum Schließen stehen und können Bedienelemente überdecken (#88).
- **Graphify:** `graphify update .` verweigerte das Überschreiben (Claude-Lauf: 3919 statt 4059 Knoten; abschließender Codex-Lauf nach den kombinierten Änderungen: 3947 statt 4059 Knoten). Die Schutzschranke gegen fehlende Chunk-Dateien wurde nicht umgangen; `tools/graphify-links.py --check` ist gültig.

## Prüfungen

Geprüfter Stand: lokale, noch nicht committete Änderungen auf `main` (Basis `f079849`), macOS, Chromium (Playwright) und Electron 44.

| Prüfung | Ergebnis |
| --- | --- |
| `npm run typecheck` | bestanden |
| `npm run test:unit` | bestanden, 48 Dateien / 378 Tests (neu: `tests/unit/renderer/design-tokens.spec.ts`) |
| `npm run test:ui` | bestanden, 74/74 (neu: `tests/ui/layout-review.spec.ts`, 13 Tests, dreimal stabil) |
| `npm run test:electron` | bestanden, 6/6 (inklusive Renderer-, Electron- und MCP-Build) |
| `node --test tests/unit/*.test.mjs` | bestanden, 59/59 |
| Gegenprobe #86 ohne Fix | Test schlägt erwartungsgemäß fehl (Popover bei y = −648) |
| Manuelle Browserprüfung | 320×568, 480×320, 480×720, 1024×768, 1280×800, 1440×900, 1600×900; Light und Dark |

Nicht geprüft: echte VoiceOver-/NVDA-/JAWS-Sitzungen, Windows- und Linux-Sichtprüfung, Nutzerstudien.

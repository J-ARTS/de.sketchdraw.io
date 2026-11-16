# #210 Confluence-Live: UI-Integration in den Design-System-Stand

- Ticket: J-ARTS/de.sketchdraw.io#210
- Worktree: `/Users/jeremyteichmann/.codex/worktrees/210-confluence-integration/de.sketchdraw.io` (Branch `codex/210-confluence-integration`, Basis `c572671`)
- Werkzeug / Modell: Claude Code, Claude Fable 5.2 (`claude-fable-5-2`), tatsächliche Umsetzung, kein simuliertes Review
- Zeitraum: 15.11.2026 abends bis 16.11.2026 kurz nach Mitternacht (Ortszeit des Rechners)
- Zeit, Tokens, Kosten: nicht gemessen, unbekannt
- Kein Commit, kein Push, keine GitHub-, Ledger- oder Graph-Änderung, kein `test:electron`, keine echte Confluence-Abnahme

## Ergebnis in Kürze

Beide UI-Deltas aus `/tmp/sketchdraw-210-integration-reference/` sind auf den aktuellen Design-System-Stand übertragen. Typecheck, Unit-Tests, Storybook-Build und die gezielten UI-Tests sind grün.

**Wichtigster Befund für Root:** Auf Port 5173 läuft ein Dev-Server eines anderen Checkouts. `npm run test:ui` verwendet ihn stillschweigend (`reuseExistingServer`), prüft also fremden Code. Mein erster UI-Lauf war deshalb ungültig; die gültigen Läufe liefen auf Port 5183 gegen einen Server dieses Worktrees. Details unter „Bedenken".

## Geänderte Dateien (nur diese sieben stammen von mir)

| Datei | Änderung |
| --- | --- |
| `src/renderer/design-system/pages/WorkspacePage.vue` | `behindModal()` und die Bedingung in `keydown` wörtlich aus `App.vue.patch`. Template, Layout, Importe unverändert. `src/renderer/App.vue` nicht angefasst. |
| `src/renderer/design-system/organisms/PluginSettings.vue` | Alle #210-Teile aus `PluginSettings.vue.patch`: `intlLocale`, `liveLink`/`canLinkLive`/Statustexte, Fokus-Halten (`shell`, `rememberFocus`, `keepFocus`, Watcher), `linkLive`/`unlinkLive`, `@focusin`, `tabindex="-1"`, Marketplace-Zeile, Abschnitt „Diagramm live in Confluence", Suchzeile und Ergebnisliste, CSS-Zeile. Alias-Importe und vorhandene `AppButton` erhalten. |
| `src/renderer/design-system/organisms/panels.stories.ts` | Vier Stories: nicht verknüpft, live verknüpft, Fehler, Pause. |
| `src/renderer/design-system/storybook/plugin-bridge.ts` (neu) | Erfundene Desktop-Bridge und Seed für diese Stories; nur synthetische Daten (`example.atlassian.net`, erfundene Seiten). |
| `src/renderer/design-system/storybook/with-whiteboard.ts` | Optionaler zweiter Parameter `options?: () => CreateStoreOptions`; bestehende Aufrufe unverändert. |
| `tests/unit/renderer/design-system.spec.ts` | `RAW_BASELINE['sd-btn']` von 15 auf 13 gesenkt (verschärft, nicht geweitet). |
| `docs/design-system/README.md` | Standzeile: 57 `AppButton` (nachgezählt), Altbestand 13 Textschaltflächen. |

`docs/design-system/manifest.md`: mit `npm run design-system:manifest` neu erzeugt, inhaltlich unverändert (keine Props, Events oder Slots geändert).

Nicht von mir: die von Root kopierten Backend-, Domain-, Store-, i18n- und Testdateien sowie `tests/electron/confluence-fixture.ts` und `tests/electron/confluence-live.spec.ts`, die während meiner Arbeit im Worktree erschienen sind. Ich habe keine davon verändert.

## Abweichungen von der Referenz (bewusst, wegen der Atom-Regel)

- **Neue und berührte Textschaltflächen sind `AppButton`:** „Jetzt synchronisieren" (`intent="primary"`), „In Confluence öffnen", „Verknüpfung lösen" (`intent="danger"`), „Live verknüpfen", „Einbinden", „Suchen" (`type="submit"`, weil `AppButton` sonst `type="button"` setzt und das Formular nicht mehr absenden würde).
- **„Verknüpfung lösen" sieht anders aus:** In der Referenz war es ein stiller `text-button danger`, jetzt eine umrandete rote Schaltfläche. Sie bleibt rechts ausgerichtet (`.live-actions .live-unlink` statt `.live-actions .text-button`).
- **Suchfeld ist `AppTextField`** (`type="search"`, `data-testid`, `placeholder`, `aria-label` fallen auf das native `input` durch). Es trägt zusätzlich `sd-input`; die Dialog-Regel `.search-row input` gewinnt, das Feld sieht aus wie die übrigen Felder des Dialogs.
- **`AppFieldLabel` nicht verwendet:** Das #210-Delta enthält keine neue sichtbare Feldbeschriftung; das Suchfeld behält sein `aria-label`.
- **Fokusvertrag ohne Komponenten-Refs:** Gemerkt wird das native Element aus dem `focusin`-Ereignis, Ziele werden per `data-testid` im Dialog gesucht. `closeButton` bleibt ein Ref auf eine rohe Schaltfläche (nicht berührt).
- **Unberührt gelassen:** die übrigen 10 rohen `sd-btn` und die rohen Formularfelder in `PluginSettings.vue` (Altbestand außerhalb des Deltas).

## Prüfungen

Geprüfter Stand: Worktree wie oben, uncommitted. Umgebung: macOS (Darwin 23.6.0), Chromium über Playwright 1.64.1.

| Prüfung | Befehl | Ergebnis |
| --- | --- | --- |
| Typecheck vor den Änderungen | `npm run typecheck` | bestanden |
| Typecheck nach den Änderungen und erneut am Ende | `npm run typecheck` | bestanden |
| Manifest | `npm run design-system:manifest` | geschrieben, kein Diff |
| Unit-Tests inkl. Design-System-Regeln | `npm run test:unit` | bestanden: 121 Dateien, 1255 Tests |
| Storybook | `npm run build:storybook` | bestanden |
| UI-Tests, erster Lauf | `npm run test:ui -- tests/ui/confluence-live.spec.ts tests/ui/plugins.spec.ts tests/ui/isometric-icons.spec.ts` | **ungültig**: 27 bestanden, 2 fehlgeschlagen, aber gegen den fremden Server auf 5173 |
| Nachweis fremder Server | `npm run test:ui -- --config /tmp/sketchdraw-210-fable-pw/probe-5173.config.mts tests/ui/isometric-icons.spec.ts` | `Error: http://127.0.0.1:5173 is already used` |
| UI-Tests #210, Plugins, Herkunftsprobe | `npm run test:ui -- --config /tmp/sketchdraw-210-fable-pw/playwright.config.mts tests/ui/confluence-live.spec.ts tests/ui/plugins.spec.ts tests/ui/isometric-icons.spec.ts` | bestanden: 29 von 29 |
| Dialog- und Tastatur-Regression | gleiche Konfiguration mit `settings`, `web-embed`, `resource-card`, `task-board-cards`, `comments-tasks`, `whiteboard`, `custom-dropdowns`, `element-clipboard`, `i18n`, `frame-presentation` | bestanden: 56 von 56 |
| Stories im gebauten Storybook, hell und dunkel | `npm run test:ui -- --config /tmp/sketchdraw-210-fable-pw/stories.config.mts` | bestanden: 9 von 9 (nach Korrektur meines Prüfaufbaus, siehe unten) |
| `test:electron` | nicht ausgeführt | Root zuständig |

Erläuterungen:

- **Temporäre Konfiguration:** `/tmp/sketchdraw-210-fable-pw/playwright.config.mts` importiert die echte `playwright.config.ts` und ändert nur Port (5183), absolute Pfade und `reuseExistingServer: false`. Der Server wurde von Playwright gestartet und nach dem Lauf beendet. Die Isometrie-Spezifikation aus `main` dient als Herkunftsprobe: Sie besteht nur gegen diesen Checkout.
- **Abgedeckte Dialoge:** Die Regressionsauswahl umfasst alle sieben Komponenten mit `showModal()` (PluginSettings, SettingsDialog, ProfileDialog, WebEmbedDialog, ResourceCardEditor, TaskBoard, AppDialog) sowie Tastenkürzel, Zwischenablage und Präsentation.
- **Story-Prüfung:** Eine temporäre Spezifikation unter `/tmp` beantwortet alle Anfragen aus `storybook-static` (kein Server) und verwirft alles andere. Je Story und Theme geprüft: Zustandstext, `role` (`status` bzw. `alert`), Atom-Klassen, axe ohne Befund der Stufen serious/critical im Dialog, keine Seitenfehler, keine Anfrage nach außen. Screenshots liegen in `/tmp/sketchdraw-210-fable-pw/shots/` und wurden hell und dunkel angesehen.
- **Erster Story-Lauf 7 von 9 fehlgeschlagen:** Ursache war mein Prüfaufbau (`http://storybook.invalid` ist kein sicherer Kontext, `crypto.subtle` fehlt), nicht der Code. Nach Umstellung auf eine `localhost`-Adresse 9 von 9.

## Nachweis des Verhaltens und der Quellverträge

- **Fokus nach dem Verknüpfen:** `confluence-live.spec.ts` verlangt den Fokus auf `confluence-live-sync-now`; die Story-Prüfung bestätigt zusätzlich, dass das fokussierte Element das native `BUTTON` im `AppButton` ist.
- **Fokus nach dem Lösen:** liegt auf der Überschrift `confluence-live-heading` (UI-Test und Story-Prüfung).
- **Fokus-Rückgabe mit `AppTextField`:** Enter im Suchfeld sendet das Formular; nach der deaktivierten Phase liegt der Fokus wieder im Suchfeld (Story-Prüfung).
- **Tastatur hinter dem Dialog:** Entf und Rücktaste mit Fokus auf `body` ändern das Diagramm nicht, Escape schließt den Dialog (`confluence-live.spec.ts`).
- **Status und Zugänglichkeit:** `role="alert"` nur im Fehlerzustand, sonst `status`; „Zuletzt übertragen" und „Nächster Versuch nicht vor" erscheinen in den passenden Stories.
- **i18n:** Alle im Template verwendeten #210-Texte stehen in `en.ts`; `i18n.spec.ts` (7 Tests) besteht. `en.ts` wurde von mir nicht verändert.

## Grenzen

- **Keine echte Confluence-Abnahme.** Es gab keine Tenant-Schreibzugriffe, kein echtes Profil, keine Zugangsdaten. Root muss weiterhin zeigen, dass ein bereits geöffnetes LiveDoc ohne Neuladen aktualisiert wird.
- **Stories brauchen einen sicheren Kontext.** Die verknüpften Zustände laufen über den echten Store-Pfad inklusive Hash mit `crypto.subtle`. Unter `npm run storybook` (localhost) funktioniert das; bei statischem Hosting über einfaches `http` auf einem anderen Host zeigen sie stattdessen den Renderfehler.
- **Jira-Auswahl in den Stories ist indirekt.** `PluginSettings` hat keine Prop für das gewählte Plugin; das erfundene Profil hat nur Jira installiert, sodass der Dialog es selbst auswählt. Git ist in diesen Stories daher nicht sichtbar.
- **Story „Pause" ist nicht statisch.** Die erfundene Bridge nennt jeweils „jetzt + 15 Minuten"; der Store versucht es danach erneut gegen die Bridge.
- **Docs-Seite „Organisms/Panels".** Die vier neuen Stories laufen dort in eigenen Rahmen (`inline: false`). Die schon vorhandene `Plugins`-Story öffnet ihren modalen Dialog weiterhin inline; nicht geändert.
- **WorkspacePage-Story nicht geändert.** Der Tastaturschutz ist Verhalten ohne sichtbaren Zustand; der Nachweis liegt im UI-Test.
- **`:modal` vorausgesetzt.** `behindModal()` nutzt `document.querySelector('dialog:modal')` wie in der Referenz. Ein Browser ohne diese Pseudoklasse würde bei jedem Tastendruck einen `SyntaxError` werfen; Electron 44 und aktuelle Browser kennen sie.
- **`keyup` ungeschützt**, wie in der Referenz: `store.handleKeyUp` läuft auch hinter einem Dialog.
- **Höhen:** Das Suchfeld ist 42 px hoch, „Suchen" hat die kompakte Schaltflächenhöhe; das entspricht dem Stand vor #210. Keine schwebende Leiste wurde geändert, daher keine `--chrome-height`-Messung.

## Bedenken

1. **Fremder Dev-Server auf Port 5173 (materiell für die Gesamtprüfung).**
   - Fehlerfall: `playwright.config.ts` setzt `reuseExistingServer: !process.env.CI`. Läuft auf 5173 der Server eines anderen Checkouts, testet `npm run test:ui` dessen Code.
   - Beleg: Die ausgelieferte Oberfläche kannte `open-isometric-library` nicht (im Worktree vorhanden), `node_modules/.vite/deps` fehlte im Worktree, und die Probe meldete „already used".
   - Auswirkung: Grüne wie rote UI-Läufe aus diesem Worktree sind ohne eigenen Server kein Nachweis. Besonders heikel hier, weil die ältere Arbeitskopie die #210-Oberfläche ebenfalls enthält und `confluence-live.spec.ts` dort bestehen kann.
   - Vorschlag: Für Roots Läufe den fremden Server beenden, mit `CI=1` starten oder die temporäre Konfiguration verwenden. Welcher Prozess den Port hält, konnte ich nicht feststellen (`lsof` abgelehnt); ich habe ihn nicht angefasst.
2. **Optik von „Verknüpfung lösen"** weicht von der Referenz ab (siehe oben). Falls die stille Textvariante gewollt ist, bräuchte `AppButton` eine eigene Variante in `button.variants.ts`; das wäre eine Design-System-Änderung außerhalb dieses Auftrags.
3. **Baseline und README geändert.** Die Senkung auf 13 folgt der Regel „wer umstellt, senkt die Zahl", ist aber eine Änderung an einer Testdatei und einer Dokumentationszeile, die Root beim Commit mitnehmen muss.

## Vom Berechtigungsmodus abgelehnt (keine Freigabe möglich)

- `graphify query …`: Der Hook verlangt es vor dem Lesen von Quelldateien; die Ausführung wurde abgelehnt, `graphify-out/wiki/index.md` existiert nicht. Ich habe die Dateien direkt gelesen. Kein Graph- oder Ledger-Schreibvorgang.
- Bash-Zugriffe auf `/tmp` (`ls`, `cat`), `lsof`, `curl`, `unzip`, `git clean -n`, `npm run dev:browser`, `CI=1 npx playwright …`. Die Referenzdateien habe ich mit dem Lese-Werkzeug gelesen.
- Folge: Die temporären Dateien unter `/tmp/sketchdraw-210-fable-pw/` (drei Konfigurationen, eine Spezifikation, `shots/`, `results/`) konnte ich nicht löschen. Im Worktree liegt nichts Temporäres; `storybook-static/`, `test-results/` und `dist-mcp/` sind Build-Ausgaben und tauchen in `git status` nicht auf.

## Nächste Schritte für Root

1. Fremden Server auf 5173 klären, bevor eigene UI-Läufe gewertet werden.
2. `test:electron` mit den nativen #210-Tests ausführen.
3. Echte Abnahme: geöffnetes LiveDoc aktualisiert sich ohne Neuladen.
4. Danach `python3 tools/graphify-update.py`, `python3 tools/graphify-links.py`, `--check` und Ticket-Kommentar mit diesen Nachweisen.

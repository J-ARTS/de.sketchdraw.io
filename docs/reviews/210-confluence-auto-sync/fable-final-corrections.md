# #210 Confluence-Live-Sync – Abschlusskorrekturen (Claude Code)

- Ticket: #210; Antwort auf `codex-correction-review.md`, `correction-backend-probes.json`, `correction-fingerprint-probes.json`.
- Ausführendes Werkzeug / Modell: Claude Code (Claude Agent SDK), `claude-fable-5-2`. Keine Subagenten. Run-ID: mir nicht zugewiesen.
- Stand: lokal auf `codex/210-confluence-live-sync`, nicht committet. Zeit / Tokens / Kosten: nicht gemessen.
- Status: beide Befunde behoben und lokal mit Unit-Tests geprüft. Kein Tenant, kein Electron, keine Bedienung der App des Nutzers. Frühere Korrekturen sind unverändert erhalten.

## CF-210-10 (P1): abgebrochener Auftrag löschte den gespeicherten Stand

**Ursache bestätigt.** `runLivePublish` begann mit leerem `published`/`pending`, prüfte die Autorität und übernahm erst danach den gespeicherten Stand. Scheiterte die erste Prüfung (wartender, veralteter Auftrag), schrieb das `remember()` im `catch` die leeren Maps in die noch bestehende Verknüpfung.

**Korrektur** (`electron/plugin-service.ts`, `runLivePublish`): Ein Auftrag kennt seinen Stand erst, wenn er den gespeicherten Stand der Verknüpfung übernommen hat (`started`). Davor schreibt `remember()` nichts – die Prüfung sitzt in `remember()` selbst, nicht nur im `catch`, damit kein Pfad einen nicht geladenen Stand speichern kann.

Erhalten bleibt, was der Review ausdrücklich verlangt: Ein Auftrag, der wirklich begonnen hat und danach seine Autorität verliert, speichert weiter, was er sicher weiß (bestätigte Uploads) und was gesendet, aber unbeantwortet ist. Es gibt kein vorzeitiges `return`, das einen echten Upload-Vermerk verliert.

Regressionen in `tests/unit/confluence-live-service.spec.ts`, Gruppe „the stored record of a link when publications are cancelled“, alle gegen eine Profildatei auf Platte:

| Test | Was er festhält |
| --- | --- |
| keeps the known attachments … | Der Ablauf aus dem Review: bekannter Anhang, laufender + wartender Auftrag, Einstellungen erneut gespeichert, beide `cancelled`, keine Schreibanfrage, Eintrag auf Platte unverändert. Danach 19 fremde Versionen mit erkanntem Sketchdraw-Vermerk: nächster Versuch ist Konflikt, **0 POST**, hier und nach Neustart; fremde Version bleibt die letzte. |
| keeps the note about an unconfirmed upload … | Dasselbe mit einem Vermerk über einen unbestätigten Upload, für drei Arten des Autoritätsverlusts (Einstellungen gespeichert, Fenster weg und neu, A→B→A). `published` und `pending` unverändert; danach weiter sichtbare Pause, 0 POST, auch nach Neustart. |
| records what a publication really did … | Auftrag lädt Bild 1 hoch (bestätigt), verliert die Autorität während Upload 2 unterwegs ist. Gespeichert: Bild 1 als bekannt, Bild 2 als gesendet. Der nächste Lauf klärt Bild 2 gegen Confluence und lädt nichts doppelt. |
| writes nothing for a publication that is cancelled before it starts … | Vier wartende Aufträge, Fenster geht weg: alle `cancelled`, Profildatei byte-gleich. |

Gegenprobe: Mit vorübergehend ausgeschalteter Prüfung schlagen genau diese vier Tests fehl (`published: undefined` auf Platte); danach zurückgenommen und wieder grün.

## CF-210-11 (P2): sichtbare Änderungen ohne automatische Veröffentlichung

**Ursache bestätigt.** Der Fingerabdruck in `whiteboard.ts` enthielt nur Titel, Seiten, Elemente und von Bildern nur ID, Typ und Länge. Icon-Definitionen der Komponentensets und der Inhalt gleich langer Bilder fehlten.

**Korrektur** (`src/renderer/state/whiteboard.ts`): Es zählt jetzt das ganze Dokument außer Aufgaben und Kommentaren – also auch Komponentensets mit ihren Icons und die Dokument-Metadaten. Die Ausschlussliste ist bewusst die kurze Seite: ein künftiges Feld wird mitverfolgt, bis man es ausdrücklich ausnimmt. Eingebettete Bilder zählen nach ihrem Inhalt; sie werden direkt mit dem zuletzt gesehenen Stand verglichen statt in einen Text kopiert.

Regressionen in `tests/unit/renderer/confluence-live-store.spec.ts`, echter Store, echter Code-Parser, echter SVG-Export; Bridge und Rastern sind Attrappen:

| Test | Was er festhält |
| --- | --- |
| publishes on its own when only the icon of a used component changes through the code view | Verknüpft und übertragen; gültige Code-Ersetzung, in der nur `iconSvg` von Rot auf Blau wechselt (Elemente identisch). Ohne `syncConfluenceLive()` folgt eine weitere Veröffentlichung mit anderem Hash; das gerenderte Bild enthält Blau, kein Rot. |
| publishes on its own when a used image is replaced by another one of exactly the same size | Zwei echte 1×1-PNGs gleicher Daten-URL-Länge; Code-Ersetzung tauscht nur die Daten. Zweite Veröffentlichung automatisch, anderer Hash, neues Bild im Export. |
| still does not publish when a code replacement changes only tasks and comments | Code-Ersetzung fügt nur eine Aufgabe und einen Kommentar hinzu: keine Veröffentlichung, kein erneutes Rastern. Der bestehende Aufgaben-Test bleibt zusätzlich. |

Gegenprobe: Mit dem alten Fingerabdruck schlagen die beiden ersten Tests fehl (Zähler bleibt stehen), der dritte besteht; danach zurückgenommen.

Wie im Review: Das belegt die fehlende automatische Veröffentlichung nach einer lokalen Ersetzung. Eine Git-spezifische Aussage leite ich daraus nicht ab; der Git-Weg löst über das Neuladen ohnehin eine Veröffentlichung aus.

## Prüfungen

Umgebung: macOS (Darwin 23.6), Node 22.16, Vitest 5.0.5, Playwright 1.64.1.

| Prüfung | Befehl | Ergebnis |
| --- | --- | --- |
| Typprüfung (4 Projekte) | `npm run typecheck` | bestanden |
| Gesamte Unit-Suite | `npx vitest run --config vitest.config.ts` | bestanden: 119 Dateien, 1232 Tests |
| Die fünf Dateien zu #210 | `npx vitest run tests/unit/domain/confluence-live.spec.ts tests/unit/confluence-live-service.spec.ts tests/unit/renderer/confluence-live-image.spec.ts tests/unit/renderer/confluence-live-store.spec.ts tests/unit/renderer/confluence-live-scheduler.spec.ts` | bestanden: 81 Tests (14 + 39 + 3 + 21 + 4) |
| Gegenprobe CF-210-10 | Prüfung in `remember()` vorübergehend ausgeschaltet | 4 neue Tests rot; zurückgenommen, grün |
| Gegenprobe CF-210-11 | alter Fingerabdruck vorübergehend eingesetzt | 2 neue Tests rot; zurückgenommen, grün |
| UI, fokussiert | `npm run test:ui -- tests/ui/confluence-live.spec.ts` | bestanden: 1 Test |

Die komplette UI-Suite habe ich nicht wiederholt: diese Runde ändert keine Komponente, nur den Store-Fingerabdruck und den Dienst. Der fokussierte UI-Test lief, weil er den geänderten Store im Browser durchläuft.

Nicht ausgeführt: Electron (`tests/electron/confluence-live.spec.ts` und `confluence-fixture.ts` gehören Root und sind unberührt), Tenant, `node --test tests/unit/*.test.mjs`, Python-/Graphify-Prüfungen.

## Grenzen, die bleiben

1. **Mehraufwand des Fingerabdrucks.** Je Dokument-Snapshot bei aktiver Verknüpfung: ein `JSON.stringify` des Dokuments ohne Bilddaten, Aufgaben und Kommentare, dazu ein Inhaltsvergleich der Bilder. Große importierte Komponentensets gehen mit in den Text. Gemessen habe ich das nicht.
2. **Unbenutzte Daten lösen ein Rendern aus.** Ein geändertes, aber nirgends verwendetes Icon oder Bild und geänderte Dokument-Metadaten starten ein Rendern. Veröffentlicht wird trotzdem nur, wenn sich ein Bild-Hash ändert.
3. **Vermerke über nie gesendete Uploads.** Verliert ein Auftrag die Autorität zwischen dem Speichern der Vermerke und dem ersten Upload, bleiben Vermerke für Uploads stehen, die nie hinausgingen. Der nächste Lauf sieht die unveränderte Version und räumt sie ab; in der Zwischenzeit steht ein Vermerk im Profil, der nichts Gesendetem entspricht.
4. Alle Grenzen aus `fable-corrections.md` gelten weiter, insbesondere: kein atomarer Schutz bei Anhängen, Eigentum ohne lokalen Eintrag über den Versionskommentar, dauerhafte Pause bei unklarem Upload ohne lesbaren Vermerk.

## Offene Abnahme (bei Root)

Unverändert gegenüber `fable-corrections.md`: unabhängige Probes gegen den Endstand, nativer Lauf mit der synthetischen HTTP-Fixture, reale Git-Kette, Tenant-Abnahme an Seite 164037 und die Frage, ob ein offenes Live Doc eine neue Anhangsversion ohne Seitenänderung zeigt. Die native Fixture belegt Letzteres nicht.

## Nicht möglich in dieser Sitzung

`gh` und `graphify` waren gesperrt: Issue #210 nicht gelesen, nichts kommentiert, Graph nicht befragt. Ledger, `docs/concerns.md`, `graphify-out/`, die Codex-Reviewdateien und die beiden nativen Testdateien sind unangetastet. Keine Commits.

## Geänderte Dateien dieser Runde

- `electron/plugin-service.ts` – `runLivePublish`: `started`, Prüfung in `remember()`.
- `src/renderer/state/whiteboard.ts` – Fingerabdruck (`liveSee`, `liveLooksDifferent`) ersetzt `liveFingerprintOf`.
- `tests/unit/confluence-live-service.spec.ts` – 4 neue Tests.
- `tests/unit/renderer/confluence-live-store.spec.ts` – 3 neue Tests.
- dieser Bericht.

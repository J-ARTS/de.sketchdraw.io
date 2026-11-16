# #210: Untersuchung des vermeintlichen Live-Hängers (abgebrochen)

- Ticket: J-ARTS/de.sketchdraw.io#210
- Worktree: `/Users/jeremyteichmann/.codex/worktrees/210-confluence-integration/de.sketchdraw.io`
- Werkzeug / Modell: Claude Code, Claude Fable 5.2 (`claude-fable-5-2`)
- Datum: 16.11.2026
- Zeit, Tokens, Kosten: nicht gemessen, unbekannt (der Lauf wurde von Root per SIGINT unterbrochen)

## Ergebnis

Es gibt keinen reproduzierten Hänger und keine Korrektur. Laut Root war die Anzeige „Diagramm wird nach Confluence übertragen …" ein veralteter Screenshot- bzw. Accessibility-Stand; die erste Veröffentlichung war um 08:43 Ortszeit bereits bestätigt. Ich schreibe dem Renderer, einem Timeout oder dem Tenant deshalb nichts zu.

Ich habe in diesem Lauf **keine Produkt-, Test- oder Konfigurationsdatei im Worktree geändert**. Die einzige neue Datei im Worktree ist dieser Bericht. Die Stände der fünf geprüften Läufe sind unberührt.

## Was ich tatsächlich getan habe

**Gelesen (ohne Änderung):**

- `src/renderer/lib/confluence-live-image.ts`, `src/renderer/state/confluence-live-sync.ts`, `src/domain/confluence-live.ts`
- `electron/plugin-service.ts` (Zeilen 392–890 und 1020–1340), Diff von `electron/main.ts` und `electron/preload.ts`
- `docs/reviews/210-confluence-auto-sync/live-git-fixture.json`, `integrated-live-build.json`, `docs/reviews/208-confluence-live/result.json`, Anfang der Referenz-SVG und der Referenzzeichnung

**Ein isolierter Lauf im Browser** (Chromium headless über Playwright, eigener Dev-Server des Worktrees auf Port 5184, erfundene Desktop-Bridge, kein Electron, kein Profil, kein Netz nach außen):

```
npm run test:ui -- --config /tmp/sketchdraw-210-fable-pw/hang.config.mts
```

Ergebnis: 2 von 2 bestanden (7,0 s). Die exakte AWS-Referenzzeichnung wurde über den echten Store-Pfad geöffnet, verknüpft, gerendert und an die erfundene Bridge übergeben.

| Messpunkt (ms nach Seitenstart) | Seite 1 `page:architecture` | Seite 2 `page:live-doc` |
| --- | --- | --- |
| SVG als Bild gesetzt | 3533 (32 924 Zeichen) | 3596 (9 620 Zeichen) |
| Bild geladen | 3566 | 3848 |
| PNG fertig | 3596 | 3874 |
| Größe in CSS-Pixeln | 1601 × 1304 | 1281 × 1803 |
| PNG in Gerätepixeln | 3202 × 2608 | 2562 × 3606 |
| PNG-Bytes | 571 969 | 774 755 |

Übergabe an die Bridge bei 3874 ms, Antwort bei 3908 ms. Beide PNGs ließen sich im Browser dekodieren; Status danach „Diagramm in Confluence aktualisiert.", keine Seitenfehler. Das Rendern beider Seiten dauerte zusammen rund 0,35 s.

**Fixture, wie vom Lauf gemessen:** `docs/reviews/208-confluence-live/aws-bedrock-agentcore.sketchdraw.json`, SHA-256 `bdf3038570b04d6b0141faa0bf2405238f2d24ff3923c0754eef1c10f62cc888`, 53 000 Bytes, Dokument `document:aws-bedrock-agentcore-live-doc-208`. Seite 1 hat 60 Elemente (13 Rechtecke, 14 Verbinder, 33 Texte), Seite 2 hat 2 (1 Text, 1 Annotation); keine Assets. Die Datei wurde nur gelesen.

## Was dieser Lauf nicht belegt

- Er lief in Chromium headless, nicht in Electron und nicht im gepackten Build.
- Ein verdecktes oder verstecktes Fenster habe ich nicht nachgestellt.
- Der Hauptprozess, echtes HTTP und der Tenant waren nicht beteiligt.
- Im Skript stehen zwei Schalter zum künstlichen Verschlucken der Bild- bzw. `toBlob`-Rückmeldung (`dropImageEvents`, `dropToBlob`). Sie wurden nie ausgeführt; es gibt dazu kein Ergebnis.

## Beobachtungen aus dem Lesen (keine reproduzierten Fehler, keine Änderung)

Diese Punkte bestätigen den unabhängigen Lesebefund. Ich habe keinen davon als Fehlverhalten beobachtet.

1. **Keine Frist im Rasterizer:** `rasterizeSvgToPng` wartet ohne Zeitgrenze auf `image.onload`/`onerror` und auf den `canvas.toBlob`-Rückruf. Bleibt einer aus, bleibt der Lauf in „syncing", und „Jetzt synchronisieren" ist in diesem Zustand deaktiviert.
2. **Ein Status für zwei Phasen:** Der Scheduler setzt „syncing" vor dem Rendern und behält es bis zur Antwort des Hauptprozesses. Die Oberfläche zeigt nicht, welche Phase läuft.
3. **Keine Gesamtfrist im Hauptprozess:** Jede Anfrage ist einzeln begrenzt (20 s, Uploads 60 s, über `AbortSignal` am `fetch`). Die Summe eines Laufs mit zwei neuen Bildern kann mehrere Minuten betragen.
4. **Keinen unbegrenzten Wartepunkt gefunden** in `publishConfluenceLive`/`runLivePublish`, in der Warteschlange `liveQueue` oder im IPC-Pfad; jeder gelesene Pfad endet mit einem Ergebnis. Das ist eine Leseaussage, kein Testnachweis.

Ob daraus eine Änderung folgen soll, entscheidet Root.

## Dateien

**Im Worktree neu:** nur `docs/reviews/210-confluence-auto-sync/fable-live-hang.md` (dieser Bericht).

`git status --short` zeigte vor dem Schreiben dieses Berichts dieselbe Dateiliste wie zu Beginn des Laufs. Inhaltlich habe ich keine dieser Dateien angefasst.

**Außerhalb des Repos, unter `/tmp/sketchdraw-210-fable-pw/`:**

| Datei | Zweck |
| --- | --- |
| `hang.config.mts` | Playwright-Konfiguration: Port 5184, Specs und Ergebnisse unter `/tmp` |
| `hang/render-repro.spec.cjs` | Reproduktionsskript mit erfundener Bridge und Phasenmessung |
| `hang-out/fixture-facts.json` | gemessene Fakten der Fixture |
| `hang-out/render-repro.json` | Messprotokoll des Laufs |
| `hang-out/render-repro.png` | Screenshot des Dialogs nach dem Lauf (nicht angesehen) |
| `results-hang/` | Playwright-Ausgabeordner |

**Hashes:** Außer dem Fixture-Hash oben kann ich keine liefern. `shasum` und `git hash-object` wurden vom Berechtigungsmodus abgelehnt, und weitere Testläufe (über die ich Hashes hätte berechnen können) sind untersagt. Root müsste die Hashes der Dateien bei Bedarf selbst bilden.

## Abgelehnte Befehle in diesem Lauf

`node -e …` (Fixture-Auswertung), `shasum -a 256`, `git hash-object`, eine verkettete `grep | sort | uniq`-Zeile. `graphify` war schon in den früheren Läufen gesperrt und wurde nicht erneut versucht; die Quellen habe ich direkt gelesen.

## Offen bei Root

- Pixelprüfung der beiden Bilder im geöffneten LiveDoc und die übrige Tenant-Abnahme.
- Entscheidung, ob die Beobachtungen 1 bis 3 ein eigenes Folgeticket bekommen.
- Aufräumen der `/tmp`-Dateien, falls gewünscht.

Aus diesem Lauf folgt keine Aussage über Erfolg oder Misserfolg am Tenant.

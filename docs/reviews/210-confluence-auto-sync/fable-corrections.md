# #210 Confluence-Live-Sync – Korrekturbericht (Claude Code)

- Ticket: #210 (Bezug #208, #209); Antwort auf `codex-early-domain-review.md`, `codex-early-backend-review.md`, die drei Probe-JSONs und den ersten UI-Lauf (`ui-first-run/`).
- Ausführendes Werkzeug / Modell: Claude Code (Claude Agent SDK), `claude-fable-5-2`. Keine Subagenten. Run-ID: mir nicht zugewiesen.
- Stand: lokal auf `codex/210-confluence-live-sync`, nicht committet. Zeit / Tokens / Kosten: nicht gemessen.
- Status: alle sieben Pflichtkorrekturen und der UI-Befund umgesetzt und lokal geprüft. **Kein** Tenant-Aufruf, **kein** Electron-Lauf, keine Bedienung der App des Nutzers. Abnahme bleibt bei Root.
- Dieser Bericht ersetzt in `fable-implementation.md`: die Aussagen zum Upload-Endpunkt (`PUT …/child/attachment`), Bedenken B4 und den Satz, die UI-Spec sei nie gestartet.

## UI-Befund: Escape schloss den Dialog nicht

Reproduziert mit `npm run test:ui -- tests/ui/confluence-live.spec.ts`. Ursache war das **Produkt**, nicht der Test:

1. Eine laufende Aktion sperrt die Bedienelemente des Dialogs. Der Browser nimmt einem gesperrten Element den Fokus ohne Ereignis; er lag danach auf `<body>` (gemessen: `activeElement = BODY`).
2. Die Taste ging damit am Dialog vorbei an den globalen Tastenhandler (`App.vue`). Der behandelte Escape als „Auswahl aufheben“ und rief `preventDefault()` – das native Schließen blieb aus (gemessen: `keydown Escape, defaultPrevented = true`, kein `cancel`).

Betroffen war jede Aktion im Plugin-Dialog, die Bedienelemente sperrt, nicht nur die neue. Zusätzlich hätten Entf/Rücktaste in diesem Zustand Elemente hinter dem modalen Dialog gelöscht.

Korrekturen:

- `App.vue`: Eine Taste, die bei offenem modalem Dialog von außerhalb des Dialogs kommt, ist kein Canvas-Kürzel; sie behält ihre native Bedeutung.
- `PluginSettings.vue`: Der Fokus bleibt im Dialog. Verliert das fokussierte Element seine Bedienbarkeit, wartet der Fokus auf dem Dialograhmen und kehrt zum Element zurück, sobald es wieder bedienbar ist.
- Nach „Verknüpfung lösen“ geht der Fokus auf die Abschnittsüberschrift statt in das Suchfeld (dort hätte das erste Escape nur den Suchtext geleert).

Die Abnahme-Assertions wurden nicht abgeschwächt, sondern erweitert: Fokus liegt nach Verknüpfen und Übertragen auf „Jetzt synchronisieren“; bei erzwungenem Fokusverlust ändern Entf/Rücktaste das Diagramm nicht; Escape schließt; nach dem Lösen liegt der Fokus auf der Überschrift und Escape schließt erneut.

## Pflichtkorrekturen

### 1. Fremde Container-Referenzen und XML-Zeichenreferenzen (`src/domain/confluence-live.ts`)

- Eigen ist ein Bild nur, wenn es genau eine Quelle hat: ein `<ri:attachment>` **ohne** Kindelement, dessen dekodierter Dateiname dem eigenen Muster entspricht. Ein Anhang mit `<ri:page>`, `<ri:blog-post>` oder anderem Inhalt gehört einem anderen Container: er wird weder entfernt noch zählt er als „Diagramm wird gezeigt“.
- Dateinamen werden für den Vergleich dekodiert (numerische Referenzen, die fünf vordefinierten Entities). Das Markup bleibt unverändert; Position und Breite eines so geschriebenen Bildes bleiben erhalten.
- Nicht sicher lesbar → `unsafe`, es wird nichts geschrieben: unbekannte Entity, ungültige oder unmögliche Zeichenreferenz, nacktes `&`, doppeltes Attribut.
- Mehrere Quellen in einem Bild (`ri:url` daneben, zweiter Anhang) oder ein Name, der nur wie ein eigener beginnt: fremd, bleibt stehen.
- Doppelte Wunschnamen werden abgewiesen. Der Vertrag „vorhandene Bilder werden nicht umsortiert“ steht jetzt im Modulkommentar und hat einen Test.
- `isPngImage` prüft zusätzlich Kopf-Chunk mit echter Größe und End-Chunk (die Neun-Byte-Signatur aus `domain-probe.json` wird abgelehnt).

### 2. Keine Überschreibung fremder Anhänge (`electron/plugin-service.ts`)

- Je Dateiname wird gespeichert: Anhangs-ID, zuletzt selbst bestätigte Version, Inhalts-Hash.
- Neuer Anhang: `POST …/child/attachment` (nur Anlegen; schlägt bei vorhandenem Namen fehl). Bekannter Anhang: `POST …/child/attachment/{id}/data`. Der namensbasierte „Create or update“ wird nicht mehr verwendet.
- Entscheidung je Lauf:

| Zustand in Confluence | Verhalten |
| --- | --- |
| Kein Anhang dieses Namens | anlegen |
| Anhang vorhanden, hier unbekannt, aktuelle Version trägt keinen Sketchdraw-Vermerk | **Konflikt**, kein Schreiben |
| Anhang vorhanden, hier unbekannt, aktuelle Version trägt den Vermerk `Sketchdraw <sha256>` | gleicher Inhalt: übernehmen ohne Upload; anderer Inhalt: per ID fortschreiben |
| Bekannte ID, bekannte Version | bei geändertem Diagramm per ID aktualisieren |
| Bekannte ID, **andere** Version | gleicher Inhalt laut Vermerk: übernehmen; sonst **Konflikt**, kein Wiederherstellen |
| Andere ID unter demselben Namen | **Konflikt** |

- Der frühere Test, der das Wiederherstellen nach fremder Änderung festschrieb, ist ersetzt: jetzt Konflikt, keine neue Version, weder bei gleichem noch bei geändertem Diagramm.
- Ausweg für den Menschen, in jeder Konfliktmeldung genannt: den Anhang in Confluence prüfen und löschen oder umbenennen; danach legt Sketchdraw ihn neu an.
- Kein atomares CAS: Zwischen der Prüfung und dem Upload kann jemand eine Version einfügen; das erkennt dieser Lauf nicht. Steht so im Code und unten bei den Grenzen.

### 3. Legacy-„Senden“ über die ganze Operation geschützt

- `updateConfluencePage` hält die Autorität vom Aufruf an fest und prüft sie vor jeder Anfrage und nach jeder Wartezeit (Lesen, Schreiben, Bestätigungslesen). Der Probe-Fall „GET auf A, Umstellung, PUT auf B“ sendet nach dem Lesen **keine** Anfrage mehr.
- `expectedBodyHash` ist Pflicht (Typ, Preload, Hauptprozess). Ohne ihn: Abbruch ohne eine einzige Anfrage. Der Renderer sendet ältere Annotationen ohne Hash nicht und fordert zum Neuladen auf; „Neu laden“ setzt den Hash.
- #209 (verlustfreier Codec) bleibt offen; hier nur der Schutz.

### 4. Retry-After

- Der Anfrage-Wrapper liest `Retry-After` (Sekunden oder Datum) bei 429/503, merkt sich den Zeitpunkt je Site und sendet bis dahin **keine** Anfrage an diese Site – gleich, wer sie auslöst (Veröffentlichung, „Senden“, Suche, Jira). Obergrenze 6 Stunden gegen defekte Header.
- Das Ergebnis trägt `retryAt`. Der Scheduler startet keinen Versuch vor diesem Zeitpunkt, auch nicht durch Bearbeitungen, „Jetzt synchronisieren“ oder das `online`-Ereignis. Der Dialog zeigt „Nächster Versuch nicht vor …“.
- Die Zahl automatischer Versuche bleibt begrenzt; das Ende ist ein sichtbarer Fehlerstatus, die nächste Änderung oder ein manueller Start beginnt neu.
- Tests mit kontrollierter Uhr: Dienst (Uhr injiziert, 3600 s, Prüfung bei 0 s / 1 s / 3599 s / 3600 s) und Scheduler (Fake-Timer, fünf Zeitpunkte innerhalb der Stunde, genau ein Versuch bei 3600 s).

### 5. Upload mit verlorener Antwort

- Vor dem ersten Byte wird je Datei ein Vermerk im Profil gespeichert (Hash, Version davor, Anhangs-ID). Lässt er sich nicht speichern, wird nichts gesendet.
- Der nächste Lauf klärt jeden Vermerk zuerst gegen Confluence:
  - Version unverändert → nicht angekommen → erneut senden.
  - Version höher, Vermerk mit diesem Hash → eigener Upload → übernehmen, kein zweiter Upload.
  - Version höher, kein Vermerk lesbar → **sichtbare Pause**, kein Upload, Vermerk bleibt – auch nach Neustart.
- Der Vermerk wird in v2 gelesen und, wenn er dort fehlt, zusätzlich über die klassische API (`…/child/attachment?filename=&expand=version`).
- Was ein Lauf sicher weiß (bestätigte Uploads), wird gespeichert, wie auch immer er endet.

### 6. Unwiderrufliche Epochen und Fenster-Lebenszyklus

- Ein Zähler im Dienst steigt bei **jeder** Änderung der Autorität: Dokumentwechsel (auch im selben Ordner), Projekt lösen, Profilwechsel, jedes Speichern der Atlassian-Einstellungen (auch mit gleichen Werten), Plugin installieren/deinstallieren, Verknüpfung setzen/lösen, Beenden, Fenster weg. Laufende und wartende Arbeit trägt den Wert vom Start und endet, sobald er nicht mehr gilt. Zurückstellen auf den alten Zustand ergibt einen neuen Wert.
- Mit dem Epochenwechsel werden laufende geschützte Anfragen abgebrochen (`AbortSignal`), statt bis zum Timeout im Hintergrund zu warten.
- `electron/main.ts`: Bei Navigation/Reload des Hauptframes, Absturz des Renderers und geschlossenem Fenster ruft der Hauptprozess `releaseRenderer()` – auch wenn der Prozess ohne Fenster weiterlebt (macOS). Ein neues Fenster arbeitet normal weiter, sobald es sein Diagramm nennt.

### 7. Abdeckung

Die Tests für alle Seiten, lokale Änderungen und Git-Reload aus dem ersten Bericht sind erhalten (`confluence-live-store.spec.ts`, jetzt 18 Tests).

## Prüfungen

Umgebung: macOS (Darwin 23.6), Vitest 5.0.5, Playwright 1.64.1 (Chromium, headless, lokale Testseite mit Mock-Bridge).

| Prüfung | Befehl | Ergebnis |
| --- | --- | --- |
| Typprüfung (4 Projekte) | `npm run typecheck` | bestanden |
| Gesamte Unit-Suite | `npx vitest run --config vitest.config.ts` | bestanden: 119 Dateien, 1225 Tests |
| Die fünf Dateien zu #210 | `npx vitest run tests/unit/domain/confluence-live.spec.ts tests/unit/confluence-live-service.spec.ts tests/unit/renderer/confluence-live-image.spec.ts tests/unit/renderer/confluence-live-store.spec.ts tests/unit/renderer/confluence-live-scheduler.spec.ts` | bestanden: 74 Tests (14 + 35 + 3 + 18 + 4) |
| Gegenprobe Epochen | Epochenvergleich in beiden Prüfungen vorübergehend entfernt | 2 Tests rot (A→B→A lieferte `synced`, Legacy-Senden lieferte `resolved`); zurückgenommen, wieder grün |
| UI, fokussiert | `npm run test:ui -- tests/ui/confluence-live.spec.ts` | vorher fehlgeschlagen (Zeile 117), nach Korrektur bestanden |
| UI, Plugin-Dialog gesamt | `npm run test:ui -- tests/ui/confluence-live.spec.ts tests/ui/plugins.spec.ts` | bestanden: 27 Tests |
| UI, gesamte Suite | `npm run test:ui` | bestanden: 233 Tests (zweimal gelaufen, siehe unten) |

Zuordnung zu den Probes:

| Probe | Regression |
| --- | --- |
| cross-page attachment removed / satisfies | Domain: „treats an attachment of another page…“; Dienst: „leaves an image of the same file name on another page alone…“ |
| entity-in-prefix / entity-in-page-key | Domain: „recognises its own file name behind XML character references…“ |
| duplicate attributes, mixed sources, duplicate desired, nine-byte PNG | Domain: „decides nothing…“, „does not own an image with more than one source…“, „accepts only…“ |
| existing foreign attachment overwritten | Dienst: „never overwrites a file of the same name…“ |
| foreign update after known version | Dienst: „treats a version it did not write as a conflict…“ |
| unknown outcome without digest | Dienst: „pauses visibly when Confluence cannot confirm the content, across a restart…“ |
| positive control with digest | Dienst: „recognises its own upload by the digest…“ |
| Retry-After discarded | Dienst: „keeps every attempt away from the site…“; Scheduler: 3600-s-Test |
| legacy write changes tenant | Dienst: „never continues on another site, account, profile or diagram…“ (6 Varianten) |
| missing expectedBodyHash | Dienst: „requires the content the annotation was loaded from…“; Store: „does not send a page that was embedded before…“ |
| A→B→A, disable→reenable | Dienst: „never revives a publication…“ (17 Varianten, je laufender und wartender Auftrag) |
| Navigation/Crash/Close | Dienst: dieselbe Liste, „works again for a new window…“, Abbruch-Test über echtes HTTP; Verdrahtung in `main.ts` nur als Quelltext-Prüfung |

### Gesamte UI-Suite

Die Korrektur am globalen Tastenhandler betrifft jeden modalen Dialog, deshalb lief die ganze Suite, nicht nur der Plugin-Dialog:

- Lauf 1 nach den Fokus-Korrekturen: 233 bestanden, 5,6 min.
- Danach habe ich den Tastenhandler für übereinanderliegende modale Dialoge präzisiert (`closest('dialog:modal')` statt des ersten Dialogs im Dokument).
- Lauf 2 auf dem Endstand: 233 bestanden, 5,5 min.

Endstand zusätzlich: `npm run typecheck` bestanden, `npx vitest run --config vitest.config.ts` 119 Dateien / 1225 Tests bestanden.

Während meiner Läufe lief ein Electron-Testlauf von Root in einer Snapshot-Kopie (`…/sketchdraw-210-native-snapshot-…`); den habe ich nicht berührt.

## Grenzen, die bleiben

1. **Kein atomarer Schutz bei Anhängen.** Confluence bietet kein „nur wenn noch Version N“. Eine Version, die jemand zwischen Prüfung und Upload einfügt, wird von diesem Lauf überschrieben; erkannt wird sie nicht.
2. **Eigentum ohne lokalen Eintrag beruht auf dem Versionskommentar.** Nach neuem Verknüpfen oder auf einem zweiten Gerät gilt ein Anhang als Sketchdraw-Anhang, wenn seine aktuelle Version den Vermerk `Sketchdraw <sha256>` trägt. Wer diesen Text von Hand setzt, gibt den Anhang frei. Liefert ein Tenant den Kommentar über keine der beiden APIs, endet neues Verknüpfen im Konflikt, bis der Anhang gelöscht ist.
3. **Unklarer Upload ohne lesbaren Vermerk pausiert dauerhaft**, bis ein Mensch den Anhang löscht. Ein Inhaltsvergleich per Download ist nicht gebaut: der Download-Weg leitet auf einen anderen Host um, und das wollte ich ohne Tenant-Prüfung nicht mit Zugangsdaten verbinden.
4. **Zwei Geräte mit auseinanderlaufendem Diagramm** geraten in den Versionskonflikt statt sich gegenseitig zu überschreiben. Gleicher Inhalt (etwa nach Git-Pull) wird ohne Upload übernommen.
5. **Schreiben des Seitentexts** bleibt wie im ersten Bericht (B2): ein Tippen zwischen letztem Lesen und `PUT` kann die API nicht ausschließen.
6. **Pausen des Servers** gelten je Site im laufenden Prozess; sie werden nicht über einen Neustart gespeichert. Nach Neustart geht eine Anfrage hinaus und erhält die Pause erneut.
7. **Anhangs-IDs:** v1 und v2 können die ID mit oder ohne `att` liefern. Verglichen wird ohne Präfix; für den Daten-Endpunkt wird eine rein numerische ID mit `att` versehen. Am Tenant ungeprüft.
8. **Fenster weg, Renderer lebt:** Sollte `did-start-navigation` feuern, ohne dass die Seite neu lädt, hat der Hauptprozess kein Projekt mehr, bis der Renderer seine Einstellungen neu abruft; bis dahin meldet die Veröffentlichung einen sichtbaren Fehler. Gleiche Annahme wie beim bestehenden Aufräumen der Direktverbindungen an derselben Stelle.
9. **Unlesbare Dateinamen blockieren die Seite:** Enthält irgendein Bild der Seite einen Anhangsnamen mit unbekannter Entity, gilt die ganze Seite als nicht sicher lesbar und der Diagrammabschnitt wird nicht geschrieben (Uploads vorhandener Anhänge laufen weiter).

## Offene Abnahmelücken (bei Root)

- Echter Tenant, Seite 164037: Anlegen (`POST`), Aktualisieren über `…/{id}/data`, Form der Anhangs-ID, Kommentar in v2 und v1, `Retry-After` in der Praxis.
- Sichtbarkeit einer neuen Anhangsversion im offenen Live Doc (B1 des ersten Berichts) – weiterhin unbelegt.
- Electron: Übergabe der PNG-Bytes über IPC; `releaseRenderer` bei echtem Reload, Absturz, Schließen und beim Weiterleben ohne Fenster auf macOS; Wiederaufnahme im neuen Fenster.
- Git-Kette real: Push → Auto-Pull → geladenes Dokument → geändertes Bild in Confluence, mit sauberem und mit ungespeichertem Stand (Fixture `live-git-fixture.json`).
- Neustart mit bestehender Verknüpfung, inklusive Fall „Vermerk über gesendeten Upload liegt vor“.
- Dark Theme, Höhenmessung der Leisten und axe für den neuen Abschnitt.
- `tests/electron/*`, `node --test tests/unit/*.test.mjs`, Python-/Graphify-Prüfungen: von mir nicht ausgeführt.

## Nicht möglich in dieser Sitzung

`gh` und `graphify` waren gesperrt: Issue #210 nicht gelesen, nichts kommentiert, Graph nicht befragt oder aktualisiert. Ledger, `docs/concerns.md`, `graphify-out/` und die Codex-Reviewdateien sind unangetastet.

## Geänderte Dateien dieser Runde

Geändert: `electron/main.ts`, `electron/plugin-service.ts`, `electron/preload.ts`, `src/domain/confluence-live.ts`, `src/domain/plugins.ts`, `src/renderer/App.vue`, `src/renderer/components/PluginSettings.vue`, `src/renderer/i18n/en.ts`, `src/renderer/state/confluence-live-sync.ts`, `src/renderer/state/whiteboard.ts`, `tests/ui/confluence-live.spec.ts`, `tests/unit/confluence-live-service.spec.ts`, `tests/unit/domain/confluence-live.spec.ts`, `tests/unit/renderer/confluence-live-store.spec.ts`

Neu: `tests/unit/renderer/confluence-live-scheduler.spec.ts`, dieser Bericht.

Vertragsänderungen gegenüber der ersten Runde: `expectedBodyHash` ist Pflicht; `ConfluenceLivePublishResult.retryAt` und `ConfluenceLiveStatus.retryAt` sind neu; `PluginService.releaseRenderer()` und die Option `now` sind neu; das Profilformat der Verknüpfung hat `token`, `published` mit `id` und `pending`.

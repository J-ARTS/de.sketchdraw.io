# #210 Confluence-Live-Sync – Umsetzungsbericht (Claude Code)

- Ticket: #210 (Bezug: #208 Live-Abnahme, #209 Codec-Verlust)
- Ausführendes Werkzeug / Modell: Claude Code (Claude Agent SDK), `claude-fable-5-2`
- Run-ID: mir nicht zugewiesen – bitte durch Codex im Ledger zuordnen
- Basis: `main` 96c0039, Branch `codex/210-confluence-live-sync`, Stand: lokal, nicht committet
- Zeit / Tokens / Kosten: nicht gemessen (unbekannt)
- Status: implementiert und lokal mit Unit-Tests geprüft; **nicht** gegen einen echten Tenant, **nicht** in Electron und **nicht** im Browser ausgeführt (siehe „Nicht ausgeführt“). Kein Abschluss, keine Aussage über #208.

## Ergebnis in Kürze

Ein lokal gespeichertes Diagramm lässt sich im bestehenden Plugin-Dialog (Jira → „Diagramm live in Confluence“) ausdrücklich mit einer Confluence-Seite verknüpfen. Danach rendert die laufende Desktop-App nach jeder Änderung **alle** Diagrammseiten als PNG und veröffentlicht sie über das Atlassian-Plugin – ohne weiteres „Senden“:

- lokale Änderungen (auch Undo, Code, Agenten) mit 3 s Sammelzeit,
- Versionen, die über den vorhandenen Git-Watcher/Auto-Pull eintreffen, sobald sie geladen sind,
- nach dem Öffnen des Diagramms einmal als Abgleich (Neustart-Fall).

Jede Diagrammseite ist ein eigener, versionierter Anhang mit festem Dateinamen. Die Seite selbst wird nur angefasst, um Bilder des Diagramms einzufügen oder zu entfernen; alles andere bleibt zeichengenau erhalten. Der alte manuelle „Senden“-Pfad schreibt nur noch, wenn die Seite dabei nichts verliert.

## Architektur

| Teil | Datei | Aufgabe |
| --- | --- | --- |
| Verwalteter Abschnitt | `src/domain/confluence-live.ts` | Findet eigene `<ac:image>`-Elemente über den Anhangsnamen und plant das kleinste Einfügen/Entfernen. Kein Parsen-und-Neuschreiben der Seite; unklares Markup → `unsafe`, es wird nicht geschrieben. |
| Verlustprüfung | `src/domain/atlassian.ts` (`confluenceStorageLoss`) | Benennt, was der Annotation-Codec (#209) aus einer Seite entfernen würde. |
| Verträge | `src/domain/plugins.ts` | `ConfluenceLiveLink` im Settings-Snapshot, `setConfluenceLiveLink`, `publishConfluenceLive` (beide optional in `PluginBridge`). |
| Ausführung | `electron/plugin-service.ts` | Verknüpfung im Profil, serialisierte Veröffentlichung, Bindung an Datei/Diagramm/Profil/Site/Konto, Fehlerklassen, Verlustschutz für „Senden“. |
| IPC | `electron/main.ts`, `electron/preload.ts` | Zwei neue Aktionen über den vorhandenen Plugin-Kanal. |
| Rendering | `src/renderer/lib/confluence-live-image.ts` | Bestehender SVG-Export je Seite (ohne eingebettetes Dokument) auf weißem Blatt mit Titelzeile; PNG über Canvas. |
| Steuerung | `src/renderer/state/confluence-live-sync.ts` | Sammeln, eine Veröffentlichung zur Zeit, Wiederholung mit Pausen, Kontextwechsel. |
| Store | `src/renderer/state/whiteboard.ts`, `contract.ts` | Auslöser, Kontext (wer darf wann veröffentlichen), Status in `state.confluenceLive`. |
| UI | `src/renderer/components/PluginSettings.vue`, `i18n/en.ts` | Verknüpfen, Status, „Jetzt synchronisieren“, Lösen, Hinweise. |

### Ablauf einer Veröffentlichung (Hauptprozess)

1. Seite lesen (`GET /wiki/api/v2/pages/{id}?body-format=storage`).
2. Je Diagrammseite: Anhang per Name suchen (`GET …/pages/{id}/attachments?filename=`). Der hochgeladene Inhalt trägt seinen SHA-256 im Versionskommentar; stimmt er, wird nichts hochgeladen. Sonst `PUT /wiki/rest/api/content/{id}/child/attachment` (multipart, `X-Atlassian-Token: nocheck`, `minorEdit=true`) → neue Version desselben Anhangs.
3. Nur wenn die Seite nicht genau die Seiten des Diagramms zeigt: Ruhefenster (1,5 s), Seite erneut lesen, **Text und Version müssen unverändert sein**, dann `PUT /wiki/api/v2/pages/{id}` (`status: current`, Version N+1), danach lesen und prüfen, dass die Bilder ankamen.
4. Erst dann `synced`. Ergebnis wird im Profil vermerkt (nur wenn tatsächlich etwas übertragen wurde).

Dateinamen: `sketchdraw-<12 Hex aus Diagramm-ID>-<12 Hex aus Seiten-ID>.png`. Zwei Geräte mit derselben Verknüpfung treffen dieselben Anhänge; der Inhalts-Hash wird aus dem SVG gebildet und ist geräteunabhängig.

### Autorität und Abbruch

- Die Verknüpfung liegt **nur** im aktiven Profil (`plugins.json` in den App-Daten), mit kanonischem Dateipfad, Diagramm-ID, Site-URL und Seiten-ID. Nichts davon steht im Diagramm. Eine kopierte Profilvorlage erbt keine Verknüpfungen; die alte Ordner-Konfigurationsdatei kann keine einschleusen.
- Jede Anfrage einer laufenden Veröffentlichung prüft vor dem Absenden und nach jeder Wartezeit: Projekt-Generation, aktives Profil, aktives Dokument, Plugin aktiv, Site-URL, Konto (E-Mail und Token-Eintrag), Verknüpfung unverändert, Dienst nicht beendet. Sonst `cancelled`, ohne weitere Anfrage.
- Renderer: Gast/Raum, ungespeichert, anderes Diagramm unter demselben Dateinamen, andere Site, deaktiviertes Plugin, wartende externe Änderung, Speicherkonflikt und laufende Dokumentwechsel veröffentlichen nicht. Ein Ergebnis aus altem Kontext wird verworfen.
- Es wandern ausschließlich PNG-Bytes (Signatur und Größe geprüft, max. 10 MB, max. 100 Seiten). Kein SVG, kein eingebettetes Dokument, keine Kommentare/Aufgaben.

### Wiederholung

`retry` (Netz, 409, 429, 5xx, Seite wird bearbeitet, Antwort verloren) → 5 s, 15 s, 45 s, 2 min, 5 min, dann Stopp mit Fehlerstatus. Neu gestartet wird durch die nächste Änderung, „Jetzt synchronisieren“ oder das `online`-Ereignis. `failed` (401/403/404, fremdes Diagramm, unlesbares Markup) wiederholt nicht von selbst; weitere Bearbeitungen fragen höchstens einmal pro Minute erneut an. Verlorene Antworten werden nicht blind wiederholt: der nächste Lauf liest zuerst den Zustand in Confluence.

## Recherche Atlassian

- Live Docs laufen über Pages v2; Inhalt kann sich innerhalb einer Version ändern (Ankündigung, von Codex vorgegeben; von mir gegengelesen).
- CONFCLOUD-83848: Updates mit Draft-Status erzeugen keine Version → hier wird nur `status: current` geschrieben.
- Anhänge: v1 „Create or update attachment“ legt bei vorhandenem Namen eine neue Version an und verlangt `X-Atlassian-Token: nocheck` (offizielle v1-Dokumentation).
- **Nicht belegt:** ob eine offene Live-Doc-Ansicht nach einer neuen Anhangsversion das neue Bild ohne Seitenänderung zeigt. Berichte dazu widersprechen sich (ein Entwicklerbericht: neue Bytes erscheinen; CONFCLOUD-71173: Vorschau kann nach API-Upload brechen). Siehe Bedenken B1.

Quellen: https://community.developer.atlassian.com/t/please-test-update-your-confluence-cloud-apps-to-function-in-live-docs-by-may-30-2025/89849 · https://jira.atlassian.com/browse/CONFCLOUD-83848 · https://developer.atlassian.com/cloud/confluence/rest/v1/api-group-content---attachments/ · https://community.developer.atlassian.com/t/uploading-a-new-version-of-an-attachment-breaks-the-image-preview/46980 · https://github.com/178inaba/atlio/issues/111

## Bedenken

| Nr. | Fehlerfall | Auswirkung | Stand / Alternative | Vorgeschlagene Prüfung |
| --- | --- | --- | --- | --- |
| B1 | Die Seite zeigt nach einer neuen Anhangsversion weiter das alte Bild (festgehaltene Version `ri:version-at-save`/Media-ID oder Cache des Live-Editors). | Das eigentliche Nutzerziel wäre trotz `synced` nicht sichtbar. | **Offen, nur am Tenant klärbar.** Alternative: nach jedem Upload das eigene Bild-Element neu schreiben (dann wieder Seitenänderung je Bearbeitung, siehe B2) – bewusst nicht gebaut, solange das Verhalten unbekannt ist. | Tenant: Diagramm ändern, Seite neu laden **und** eine offene Live-Doc-Sitzung beobachten; `storage`-Body auf `ri:version-at-save` prüfen. |
| B2 | Jemand tippt genau zwischen letztem Lesen und `PUT` der Seite. | Diese Eingabe kann verloren gehen; die REST-API bietet dafür keinen Schutz. | Gemindert: Seitenänderung nur beim Einrichten und bei hinzugefügten/entfernten Diagrammseiten; Ruhefenster, Vollvergleich des Textes, Versionsprüfung, 409 → Wiederholung. Restrisiko bleibt (Größenordnung eine Anfragelaufzeit). Alternative: Abschnitt nie automatisch einfügen, Nutzer platziert das Bild einmal selbst. | Tenant: während des Verknüpfens im Live Doc tippen; erwartet „wird gerade bearbeitet“ und kein Verlust. |
| B3 | Confluence akzeptiert das Markup nicht oder benennt den Anhang um (`<ac:image ac:align ac:layout ac:alt ac:width><ri:attachment ri:filename/></ac:image>` auf Blockebene). | Einrichten endet mit Wiederholung/Fehler statt Bild. | Annahme aus dem Storage-Format, nicht am Tenant geprüft. | Tenant: Erstveröffentlichung auf der leeren Seite 164037, danach Body lesen. |
| B4 | v2-Anhangsliste liefert keinen Kommentar oder ignoriert `filename`. | Kein Erkennen des eigenen Uploads über den Hash. | Rückfall eingebaut: im Profil vermerkte Version je Datei; im schlechtesten Fall eine zusätzliche Version pro Anlass, keine Schleife. | Tenant: zweimal ohne Änderung „Jetzt synchronisieren“ → keine neue Anhangsversion. |
| B5 | Veröffentlicht wird der bestätigte Arbeitsstand, auch wenn er noch nicht gespeichert ist. | Confluence kann kurz weiter sein als Datei/Git; nach dem nächsten Öffnen gleicht sich das an. | Entspricht „nach lokalen Änderungen“. Alternative: erst beim Speichern veröffentlichen – Produktentscheidung. | Entscheidung im Ticket. |
| B6 | Gelöschte Diagrammseite. | Bild verschwindet von der Seite, der Anhang bleibt in der Anhangsliste. | Bewusst kein automatisches Löschen fremd sichtbarer Daten. | – |
| B7 | SVG wird als Bild gerastert und kann die App-Schriften nicht laden. | Textumbruch kann leicht vom Canvas abweichen. | Wie beim bestehenden SVG-Export (`FONT_RENDERING_DEPENDENT`). PNG max. 4096 px Kantenlänge, 2× Dichte. | Sichtprüfung der AWS-Referenz. |
| B8 | Verknüpfung hängt am Dateipfad. | Nach Verschieben oder „Speichern unter“ ist neu zu verknüpfen; jedes Gerät verknüpft selbst. | Gewollt (kein stilles Senden für Kopien oder fremde Geräte). | – |
| B9 | Der Verlustschutz für „Senden“ ist streng. | Die meisten echten Seiten (Fett, Links, Tabellen, Bilder, auch der Diagrammabschnitt) lassen sich nicht mehr überschreiben. | Gewollt; **#209 ist damit nicht gelöst**, nur entschärft. Neuer Metadaten-Schlüssel `sketchdraw.atlassian.pageBodyHash`; ältere Elemente ohne Hash werden über Version und aktuelle Seite geprüft. | – |
| B10 | Zwei App-Instanzen (kein Single-Instance-Lock). | Eine Veröffentlichung der einen ändert `plugins.json`; die andere meldet danach „extern geändert“ (#181) und sperrt Einstellungen bis zum Neustart. | Gemindert: geschrieben wird nur, wenn wirklich etwas übertragen wurde. Alternative: Sync-Vermerke in eigener Datei. | Zwei Instanzen, eine veröffentlicht. |
| B11 | Bei aktiver Verknüpfung wird je Dokument-Snapshot ein Fingerabdruck (`JSON.stringify` von Titel, Seiten, Elementen) gebildet. | Mehraufwand bei sehr großen Diagrammen, auch durch den 5-s-Jira-Abgleich. | Verhindert dafür jedes unnötige Rendern. | Messung an großem Diagramm. |
| B12 | Der Sync-Status ist nur im Plugin-Dialog sichtbar. | Ein Dauerfehler fällt außerhalb des Dialogs nicht auf. | Bewusst keine Dauer-Notices; Vorschlag: Statuspunkt in der Dokumentkarte (eigenes `ui`-Ticket). | – |

## Prüfungen

Umgebung: macOS (Darwin 23.6), Vitest 5.0.5, Arbeitsstand wie oben.

| Prüfung | Befehl | Ergebnis |
| --- | --- | --- |
| Typprüfung (4 Projekte) | `npm run typecheck` | bestanden |
| Gesamte Unit-Suite | `npx vitest run --config vitest.config.ts` | bestanden: 118 Dateien, 1198 Tests |
| Neue Tests einzeln | `npx vitest run tests/unit/domain/confluence-live.spec.ts tests/unit/confluence-live-service.spec.ts tests/unit/renderer/confluence-live-image.spec.ts tests/unit/renderer/confluence-live-store.spec.ts` | bestanden: 9 + 19 + 3 + 16 |
| Gegenprobe | Auslöser im Store bzw. Job-Prüfung im Dienst vorübergehend entfernt | 11 Tests schlugen wie erwartet fehl; Änderung zurückgenommen |
| AWS-Referenz aus #208 | Einmal-Test: `aws-bedrock-agentcore.sketchdraw.json` seitenweise gerendert und mit dem strengen XML-Parser gelesen | bestanden; Testdatei wieder entfernt |
| i18n | `npx vitest run tests/unit/renderer/i18n-coverage.spec.ts` | bestanden |

Abgedeckt (Auswahl): lokale Änderung → neues gerendertes Bild; Git-Reload → neues Bild; ungespeicherte Arbeit + externe Änderung → Pause, kein Überschreiben; mehrere Seiten, hinzugefügte/entfernte Seiten; Verknüpfung übersteht Neustart; Fremdinhalt zeichengenau erhalten (inkl. CDATA-Attrappe, verschobene/skalierte Bilder); gleichzeitige Bearbeitung (Text ändert sich ohne Version, 409); verlorene Antworten bei Upload und Seitenänderung ohne Doppelversion; 401/404/429/503/Netz; Profil-, Dokument-, Konto-, Site-Wechsel und Deaktivieren während einer laufenden Veröffentlichung; Gast, ungespeichert, fremdes Diagramm; nur PNG; echter HTTP-Durchlauf gegen lokalen Server (Multipart, Header, JSON).

### Nicht ausgeführt

- **Echter Tenant** (bei Codex): kein einziger Aufruf gegen Atlassian.
- **`tests/ui/confluence-live.spec.ts`** (neu, Playwright): geschrieben, **nie gestartet** – Playwright war in dieser Sitzung gesperrt. Er ist der einzige Test für das echte Rastern im Fenster (`rasterizeSvgToPng`) und die Dialogbedienung; in den Unit-Tests ist das Rastern ersetzt. Bitte als ungeprüft behandeln.
- **Electron**: kein Lauf. Ungeprüft bleibt damit die Übergabe der PNG-Bytes (`Uint8Array`) durch contextBridge/IPC. `npm run test:electron` baut zudem nach `dist*`; ich habe das wegen der laufenden App nicht angestoßen. Kein neuer Electron-Test.
- Höhen-/Layoutmessung im Browser, Dark-Theme-Sichtprüfung, axe für den neuen Abschnitt.
- Der Neustart über das `online`-Ereignis des Fensters ist implementiert, hat aber keinen Test.
- `node --test tests/unit/*.test.mjs`, Python-Graphify-Tests, `tools/graphify-update.py`/`graphify-links.py` (nicht mein Bereich bzw. gesperrt).
- GitHub: `gh` war gesperrt. Ich konnte Issue #210 **nicht lesen** und habe nach dem Auftragstext und `agent-state/tasks/210-confluence-live-sync.md` gearbeitet; nichts kommentiert, kein Label gesetzt.

## Geänderte Dateien

Geändert: `electron/main.ts`, `electron/plugin-service.ts`, `electron/preload.ts`, `src/domain/atlassian.ts`, `src/domain/index.ts`, `src/domain/plugins.ts`, `src/renderer/components/PluginSettings.vue`, `src/renderer/i18n/en.ts`, `src/renderer/state/contract.ts`, `src/renderer/state/whiteboard.ts`

Neu: `src/domain/confluence-live.ts`, `src/renderer/lib/confluence-live-image.ts`, `src/renderer/state/confluence-live-sync.ts`, `tests/unit/domain/confluence-live.spec.ts`, `tests/unit/confluence-live-service.spec.ts`, `tests/unit/renderer/confluence-live-image.spec.ts`, `tests/unit/renderer/confluence-live-store.spec.ts`, `tests/ui/confluence-live.spec.ts`, dieser Bericht.

Nicht angefasst: `agent-state/work-ledger.json`, `docs/concerns.md`, `graphify-out/`, Abhängigkeiten, Zugangsdaten. Keine Commits.

## Verhaltensänderungen an Bestehendem

- `updateConfluencePage` liest die Seite vor dem Schreiben und verweigert bei geänderter Seite oder drohendem Verlust (vorher: blindes Überschreiben).
- `getConfluencePage` liefert zusätzlich `bodyHash`; eingebundene Seiten merken ihn sich in den Element-Metadaten.
- Fehler der Atlassian-Anfragen sind intern eine eigene Klasse mit Statuscode; der Text ist unverändert.
- Leertext der Confluence-Suche im Dialog umformuliert; Suchtreffer haben zwei Aktionen („Live verknüpfen“, „Einbinden“).

## Nächste Schritte

1. Codex: `npm run test:ui -- tests/ui/confluence-live.spec.ts` ausführen und Ergebnis ins Ticket; bei Fehlschlag zurück an Claude Code.
2. Codex: Tenant-Abnahme an Seite 164037 in dieser Reihenfolge – Verknüpfen (B3), Änderung sichtbar (B1), ohne Änderung keine neue Version (B4), Tippen während des Einrichtens (B2), Git-Pull mit sauberem und mit ungespeichertem Stand, Neustart.
3. Je nach B1: Entscheidung, ob das Bild-Element nach einem Upload neu geschrieben werden muss.
4. Bedenken B1–B12 nach `docs/concerns.md`; Produktentscheidung zu B5.
5. Ledger, Graphify, Issue-Kommentar und Statuslabel durch Codex.

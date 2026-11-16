# #217 – Autorität nach Git-/Datei-Ersetzung: Umsetzungsbericht

- Ticket: #217 (blockiert die Abnahme von #210). Run: Session `64f445c3-ea0d-4cab-9925-03e9d2364df9`.
- Werkzeug: Claude Code, Modell `claude-fable-5-2` (angefordert: high). Zeit, Tokens, Kosten: unbekannt.
- Arbeitsverzeichnis: nur `/Users/jeremyteichmann/.codex/worktrees/210-confluence-integration/de.sketchdraw.io`.
- Nicht getan: Commit/Push, GitHub, Ledger/Graphify, native Tests, echte App, echter Tenant, Subagenten.

## Ergebnis in Kürze

Die Ursache ist reproduziert und in `src/crdt/persistence.ts` behoben. Der Cache folgt jetzt nur noch dem
Controller und schreibt nie mehr in ihn hinein. Unit-Regressionen, Typecheck und Build sind grün. Der native Test ist
vorbereitet, aber **nicht ausgeführt**; die Abnahme in der echten App steht aus.

## Reproduktion (vor dem Fix)

`npx vitest run --config vitest.config.ts tests/unit/renderer/document-cache.spec.ts` gegen den unveränderten Code:

- Nach der Git-Ersetzung mit gleicher Dokument-ID stand im Controller der **alte** Stand aus dem Cache
  (Titel `Local`, beide alten Elemente), Revision 1 statt 0. Der Git-Stand war vollständig überschrieben.
- `SessionAccessError: AUTHORITY_DIVERGED` (`src/session/authority.ts:115`), auch aus `store.dispose()`.
- MCP: `AgentAccessError: Application rejected access change.` (`electron/agent-access/host.ts:80`) bei der
  Registrierung der neuen Sitzung.
- Schreiben danach wirkungslos (`setTitle` änderte nichts).

Kontrolllauf der fertigen Tests gegen `git show HEAD:src/crdt/persistence.ts` (Datei kurz zurückgesetzt, danach
wiederhergestellt): **5 fehlgeschlagen, 19 bestanden** (`/tmp/sketchdraw-217-fable-before.json`). Fehlgeschlagen:
Git-Ersetzung, Schreiben nach Ersetzung, „ältere Cache-Fassung wird ersetzt", „Datei öffnen trotz Cache eines
früheren Laufs" und der Abbau-Test (Timeout 5 s: `destroy()` kehrte nie zurück).

Wichtig für die Einordnung: Welcher von zwei unabhängigen CRDT-Ständen eine Zusammenführung gewinnt, hängt von den
zufälligen Yjs-Client-IDs ab. Der Fehler trat deshalb pro Ersetzung nur in etwa der Hälfte der Fälle auf. Die Tests
wiederholen die Ersetzung darum mehrfach (6 Runden); einzelne Tests können gegen den alten Code zufällig bestehen.

## Ursache

1. `managedController` hängt `attachIndexedDbPersistence` unter `document:<id>` an und erzeugt sofort die Autorität.
2. Die alte Persistenz las den Cache und wandte ihn per `controller.applyRemoteUpdate` direkt an, an der Autorität
   vorbei. Zusätzlich war `y-indexeddb` live an `controller.ydoc` gebunden; es schreibt beim Binden und bei jeder
   Verdichtung (ab 500 Updates) alles aus der Datenbank in das gebundene Dokument.
3. Jede Installation (`install`) erzeugt mit `createCrdtController(document)` eine neue, unabhängige CRDT-Linie.
   Der Cache derselben ID enthält die vorige Linie. Die Zusammenführung zweier Linien ist keine Wiederherstellung,
   sondern ersetzt Schlüssel je nach Client-ID durch alte oder neue Werte.
4. Folge: unangekündigte Controller-Änderung → `AUTHORITY_DIVERGED` → Autorität gestoppt → MCP-Registrierung
   abgelehnt, Schließen antwortet `cancel`.

Das betraf nicht nur Git: Auch das erneute Öffnen derselben Datei nach einem Neustart lief in denselben Pfad.

## Gewählte Semantik

**Der Controller ist die Wahrheit, der Cache folgt ihm. Aus dem Cache gelangt nichts in einen Controller.**

- `attachIndexedDbPersistence(controller, key)`: verwirft einen älteren Stand unter dem Schlüssel und schreibt den
  Stand des Controllers hinein. Kein Import. Damit bleibt eine geöffnete, neu geöffnete oder von Git ersetzte Datei
  exakt so, wie sie geladen wurde, und die Autorität sieht keine fremde Änderung.
- `createPersistedCrdtController(key, fallback)` bleibt der ausdrückliche Wiederherstellungsweg: Er baut den
  Controller **aus** dem Cache (gleiche Linie) und lässt den Cache dann stehen. Verhalten und bestehender Test
  unverändert.
- Technisch bindet `y-indexeddb` jetzt an eine Kopie des CRDT-Stands, die dem Controller über `updateV2` folgt, nie
  an `controller.ydoc`. So ist der Rückweg strukturell ausgeschlossen, auch wenn eine zweite Verbindung (zweites
  Fenster, gleiche ID) in dieselbe Datenbank schreibt. Nur „Datenbank leeren und direkt binden" hätte den Rückweg
  beim Binden und bei der Verdichtung offen gelassen.
- Abbau: `destroy()` beendet den Fluss sofort (synchron), meldet danach nichts mehr an den Controller und kehrt
  auch dann zurück, wenn der Controller schon zerstört ist oder die Datenbank noch blockiert ist. Wird nur der
  Controller zerstört, schließt der Cache sich selbst.

Warum kein Warten auf `persistence.ready` vor der Autorität und keine Wiederholungen: Da nichts mehr aus dem Cache
zurückfließt, gibt es keine Reihenfolgeabhängigkeit mehr. MCP und Schließen funktionieren ohne Änderung an
`renderer-session.ts`, `WorkspacePage.vue`, `authority.ts` oder den Quit-Gates.

Ungespeicherte Änderungen: Der Schutz davor liegt unverändert vor `install` (Dialog „ungespeichert", kein
automatisches Neuladen bei Entwürfen). Im Produkt las bisher nichts den Cache außer dem fehlerhaften Import;
`createPersistedCrdtController` hat keinen Aufrufer im Produktcode.

## Geänderte Dateien

| Datei | Änderung |
| --- | --- |
| `src/crdt/persistence.ts` | Einweg-Cache (`mirrorToCache`), kein Import, robuster Abbau; Wiederherstellung behält den Cache |
| `src/crdt/types.ts` | nur Kommentare am `CrdtPersistenceHandle` |
| `src/renderer/state/whiteboard.ts` | eine Kommentarzeile in `managedController`, keine Logikänderung |
| `tests/unit/crdt.spec.ts` | 5 neue Tests „cache of a controller in use" |
| `tests/unit/renderer/document-cache.spec.ts` | neu, 5 Tests über Store, Autorität, MCP und Schließen |
| `tests/electron/confluence-live.spec.ts` | neuer nativer Test #217 angehängt, **nicht ausgeführt** |

Unverändert (Hash gleich `source-before.json`): `src/agent-access/renderer-session.ts`, `WorkspacePage.vue`,
`src/session/authority.ts`, `electron/main.ts`, `tests/electron/confluence-fixture.ts`.

## Tests

Neu in `document-cache.spec.ts` (echter Store mit eigenem Controller, `fake-indexeddb`, echter `createAgentHost` und
`connectAgent` wie in `renderer-session.spec.ts`; kein Discovery-Runtime-File):

- Git-Ersetzung mit gleicher ID, 6 Runden: Dokument exakt gleich der Datei, Revision 0, Autorität lesbar, kein
  Fehlerhinweis, Schließanfrage wird mit `close` beantwortet.
- Schreiben nach der Ersetzung; der Stand ist danach über `createPersistedCrdtController` wiederherstellbar.
- MCP, 6 Runden: alter Grant `ACCESS_DENIED`, neuer Grant liest exakt den Git-Stand (Revision 0) und schreibt.
- Datei öffnen, obwohl der Cache ungespeicherte Änderungen eines früheren Laufs hält, 6 Runden.
- Schnelle Ersetzungen ohne Warten und Dokumentwechsel: kein Übersprechen; Cache hält die letzte Fassung.

Neu in `crdt.spec.ts`: ältere Cache-Fassung wird ersetzt statt gemischt (mit Autorität, 6 Runden); Änderungen vor
und nach „bereit" inklusive Undo/Redo landen im Cache; Abbau zu sechs Zeitpunkten ohne späte Meldungen; ein
abgelöster, weiterlebender Controller schreibt nicht mehr in den Cache; fremder Stand in derselben Datenbank
erreicht den Controller nie (4 Runden).

## Ausgeführte Befehle (nach dem Fix)

| Befehl | Ergebnis |
| --- | --- |
| `npm run typecheck` | bestanden |
| `npx vitest run --config vitest.config.ts tests/unit/crdt.spec.ts tests/unit/renderer/document-cache.spec.ts` | 24/24, viermal in Folge |
| dieselben plus `tests/unit/crdt`, `renderer/{whiteboard,plugin-store,room-adopt,room-connection,room-permissions,guest-store,confluence-live-store}.spec.ts`, `mcp/renderer-session.spec.ts`, `mcp-review-boundaries.spec.ts`, `tests/unit/session`, `tests/unit/collaboration` | 43 Dateien, 427/427 |
| `tests/unit/desktop-review.spec.ts`, `desktop-security.spec.ts`, `tests/unit/mcp`, `domain-review.spec.ts` | 9 Dateien, 69/69 |
| `npm run build` | bestanden (`dist`, `dist-electron`, `dist-mcp`) |

Nicht ausgeführt: vollständige Unit-Suite, `test:ui`, `test:electron`, Storybook-Build.

Zwischenfehler während der Arbeit, alle in meinen Tests und behoben: ungültige Element-IDs mit Leerzeichen, ein
Warten auf ein bereits gemeldetes „bereit", ein Vergleich mit `assets` (der Agent liest ohne Assets), ein direkter
`dispatch` an der Autorität vorbei, falsches Feld `tone` statt `kind` (die Prüfung wäre sonst leer gewesen).

## Nativer Test für Root (vorbereitet)

`tests/electron/confluence-live.spec.ts`: „the local agent and a normal quit survive file and Git replacements of
the open diagram, also after restart (#217)". Er nutzt das vorhandene Fixture mit eigenem Profil, eigener Session
und eigenem Runtime-File (`<root>/agent-runtime/active-v1.json`; der Fixture-Einstieg verweigert jeden anderen Pfad)
und den offiziellen SDK-Client über die `clientConfiguration` dieses Runtime-Files.

Ablauf: zeichnen, speichern, Git-Plugin über die UI aktivieren (Automatik aus), zwei Ersetzungen der Datei an Ort
und Stelle, eine echte Git-Ersetzung (`git pull --ff-only` nach Commit aus zweitem Klon), jeweils: Canvas zeigt die
Datei, neuer Grant, Agent liest Revision 0 mit exakter Breite. Danach Agent schreibt, speichern, **normales
Beenden ohne Signal** (`app.quit()`, Prozess muss von selbst enden), Neustart, Datei öffnen, Agent liest, weitere
Ersetzung, erneut normales Beenden.

Typgeprüft, aber nie gelaufen. Mögliche Stolperstellen: UI-Texte und Selektoren sind aus dem ersten Test
übernommen; ob der Datei-Watcher nach Gits „löschen und neu anlegen" weitere Änderungen derselben Datei meldet, ist
ungeprüft, deshalb liegt die Git-Ersetzung am Ende des ersten Laufs.

## Hashes (SHA-256)

```
727cd5490975d45d8d25e2581290cff0555b19d00e17850256c5d7035c4242fd  src/crdt/persistence.ts
9e42349eb0b38982389ff2256d69608ede90fd9d36333336b7ad9cef7f92525a  src/crdt/types.ts
fa3747dc91839da9cb3e308580c5df5ced12c0bf48472a99e04d50d60421dce6  src/renderer/state/whiteboard.ts
5933ec0308fbd6c57ecb4c939a4a84c234acb60a3417fedc3a174148ee2a0e7c  tests/unit/crdt.spec.ts
cf8aba8df3e59a24854defdec298431955cd86a54007543854dbe42b9bafe5f8  tests/unit/renderer/document-cache.spec.ts
3fe01caec1ee4b8ab603dcbed265c3568c740d34fc6d1cc89f3bdd52980c04a3  tests/electron/confluence-live.spec.ts
1b9f18add79f28467d7cfa5e3bec57334219f45175c9f4093547b0f76fcd76db  src/agent-access/renderer-session.ts (unverändert)
cfdfb294fbdec5e8b3b70a22121e39d22d3f30be7e414d71c47609caa3825d60  src/renderer/design-system/pages/WorkspacePage.vue (unverändert)
fc98a538196537a4cf72b95a303752cb3afb540dc2958f0e2cc3f3d32665ed1d  src/session/authority.ts (unverändert)
dcce42fad5ec3764edc15ce1f95f22460d02cde32385d8b692ae2a464fc1ba0b  electron/main.ts (unverändert)
3477e116ade73304a6d1a6e631a02d77d47077671e668814886b1238bb25cb37  tests/electron/confluence-fixture.ts (unverändert)
38c9998741ae28af2877f2de99155c4e66730b4e6b80813cc65fd8b9d50a2ee5  dist-electron/main.cjs (Build dieses Laufs)
a4f86f229a0683fa7716766328873807032f704ac637167c1ad4b1d178332169  dist-mcp/server.cjs (Build dieses Laufs)
```

## Grenzen und offene Punkte

- **Keine native und keine echte Abnahme.** Belegt ist das Verhalten nur in Unit-Tests mit `fake-indexeddb`.
  Verhalten von Chromiums IndexedDB (Löschen bei offener Verbindung) ist nicht nativ geprüft.
- **Speicher:** Der CRDT-Stand liegt je verwaltetem Dokument doppelt im Speicher (Controller und Cache-Kopie),
  eingebettete Bilder eingeschlossen. Das ist der Preis für den strukturell ausgeschlossenen Rückweg.
- **Zweites Fenster mit gleicher Dokument-ID:** Das Löschen der Datenbank wartet, bis die andere Verbindung
  schließt. Solange bleibt der Cache des zweiten Fensters im Zustand „loading"; Dokument, Autorität und Abbau
  sind davon nicht betroffen (getestet).
- **Verhaltensänderung bei Räumen:** Ein übernommenes Raumdokument ersetzt jetzt den lokalen Cache derselben ID.
  Vorher wurde ein lokaler Cache in das Raumdokument gemischt. Gast-Einschränkungen und der Pfad ohne lokalen
  Controller (`GuestSession`) sind unverändert.
- **Ungespeicherter Stand nach Absturz:** Er bleibt im Cache, bis ein Dokument derselben ID installiert wird;
  dann gilt die Datei. Ein Wiederherstellungsdialog existiert im Produkt nicht; er müsste den Cache vor `install`
  über `createPersistedCrdtController` lesen.
- **Bestehender Cache im echten Profil:** keine Migration nötig; beim nächsten Öffnen wird die Datenbank des
  Dokuments ersetzt.
- Beobachtet, nicht geändert: `store.dispose()` wirft bei einer bereits gestoppten Autorität `AUTHORITY_DIVERGED`;
  `WorkspacePage` verschluckt eine abgelehnte MCP-Registrierung weiterhin. Beides tritt nach dem Fix in diesem
  Ablauf nicht mehr auf. Verwaiste Cache-Datenbanken unbenannter Dokumente sammeln sich wie bisher an.
- `docs/architecture.md` (Zeile 76) beschreibt den Cache weiter nur als „Recovery-Cache"; die Einweg-Regel steht
  bisher nur im Code. Graphify, Ledger und Ticket sind nicht nachgeführt (Root).

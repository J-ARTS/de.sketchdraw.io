# #217 – Korrektur: mehrere Cachehalter unter einem Schlüssel

- Ticket #217, Fortsetzung desselben Laufs (Claude Code, `claude-fable-5-2`, angefordert: high). Zeit, Tokens, Kosten: unbekannt.
- Bezug: `docs/reviews/217-mcp-git-authority/concurrency-review.md` (P2, reproduziert gegen Persistence-SHA `727cd549…`).
- Der erste Bericht `/tmp/sketchdraw-217-fable-implementation.md` ist unverändert. Abweichungen davon stehen unten.
- Nicht getan: native Tests, App, UI, Tenant, Profile, Runtime, GitHub, Ledger/Graphify, Commit/Push, Subagenten.

## Ergebnis in Kürze

Der Befund stimmt und ist behoben. Zwei gleichzeitig aktive Handles unter demselben Schlüssel stören einander nicht
mehr: keiner verliert seine Verbindung, keiner meldet einen Fehler, und die Wiederherstellung liefert den
vollständigen Stand des Handles, der zuletzt geschrieben hat. Aus dem Cache gelangt weiterhin nichts in einen
Controller. Unit-Tests, Typecheck und Build sind grün; nativ ist nichts gelaufen.

## Befund bestätigt, Regression archiviert

Meine Aussage im ersten Bericht („das zweite Fenster bleibt im Zustand loading, bis die andere Verbindung schließt")
war falsch: `lib0` schließt bestehende Verbindungen bei `versionchange`. `clearDocument` des zweiten Attach hat die
Verbindung des ersten Handles also still geschlossen.

Neue Tests zuerst gegen den Stand `727cd549…` ausgeführt
(`npx vitest run --config vitest.config.ts tests/unit/crdt.spec.ts`, Ergebnis in
`/tmp/sketchdraw-217-fable-concurrency-before.json`): **4 fehlgeschlagen, 20 bestanden**. Alle vier mit
`['loading', 'ready', 'error']` im betroffenen Handle:

- last writer holds the cache (zwei Handles, wechselnde Änderungen)
- der exakte Review-Fall (erster ändert nach Attach des zweiten, reguläres Abbauen, Recovery)
- letzte Änderung eines Handles, der direkt danach endet
- Cache wird unter einem aktiven Handle geleert

## Gewählte Semantik

**Der Cache hält genau einen vollständigen Stand: den des Handles, der zuletzt geschrieben hat. Anhängen zählt als
Schreiben.**

- Jede Änderung ist eine Transaktion über `updates` und `custom`. Im Cache steht ein Vermerk, wessen Stand er hält
  (`writer`, laufende Nummer, Zahl angehängter Änderungen).
- Setzt der Cache den Stand dieses Handles lückenlos fort, wird nur die Änderung angehängt. Sonst ersetzt dieselbe
  Transaktion den Cache durch den vollständigen Stand des Handles. „Sonst" heißt: ein anderer Handle hat
  dazwischen geschrieben, ein früherer Schreibvorgang ist fehlgeschlagen, der Cache wurde geleert, oder 500
  Änderungen sind angehängt (Verdichtung).
- Prüfen und Schreiben sind atomar. Es gibt kein Löschen der Datenbank mehr beim Anhängen, also auch keine
  geschlossene fremde Verbindung und kein leeres Zwischenfenster.
- Wird der Cache ausdrücklich geleert (`clearIndexedDbPersistence`), gibt ein aktiver Handle seine Verbindung frei,
  statt zu blockieren, und schreibt seinen Stand mit der nächsten Änderung neu.
- Ein fehlgeschlagener Schreibvorgang wird als `error` gemeldet und von der nächsten Änderung repariert (voller
  Stand), danach wieder `ready`. Keine Timer, keine Wiederholungsschleifen: höchstens ein Versuch je Änderung.

Für den Review-Fall heißt das: Nach dem Attach des zweiten hält der Cache dessen Stand. Ändert der erste danach,
übernimmt er den Cache mit seinem vollständigen Stand; die Recovery liefert seine Änderung. Zwei unabhängige
CRDT-Linien lassen sich nicht sinnvoll mischen, deshalb gewinnt immer genau eine, und zwar die jüngste.

## Umsetzung

Nur `src/crdt/persistence.ts` (Logik) und `src/crdt/types.ts` (Kommentar). Keine weitere Produktdatei nötig.

- `y-indexeddb` schreibt nicht mehr. Der Handle schreibt selbst über IndexedDB in das Layout, das die Recovery über
  `y-indexeddb` liest (`updates` mit Yjs-Updates in Einfügereihenfolge, Vermerk in `custom`).
- Der Schreiber kodiert nur (`Y.encodeStateAsUpdate`) und hört auf `update`. Er wendet nie etwas auf ein Dokument
  an. Die Einbahnregel gilt damit ohne die Kopie des CRDT-Stands aus der ersten Fassung; die Kopie entfällt.
- `createPersistedCrdtController` liest unverändert über `y-indexeddb` und hängt danach normal an. Die Übernahme
  ist eine Transaktion, der Sonderfall `keepCache` entfällt.
- `destroy()` beendet den Fluss sofort, wartet auf bereits begonnene Schreibvorgänge und schließt dann. Änderungen
  vor dem Abbau landen im Cache, auch wenn der Controller direkt danach zerstört wird.

Abweichungen vom ersten Bericht: Die Grenze „doppelter Speicher" entfällt. Die Grenze „zweites Fenster wartet" ist
durch die Semantik oben ersetzt.

## Tests

Neu in `tests/unit/crdt.spec.ts` (echte Controller, echte Authorities mit Binding wie in der Probe):

- zwei Handles, wechselnde Änderungen: keine Fehlermeldung, kein Fatal, kein Controller durch den Cache des anderen
  verändert; Recovery = vollständiger Stand des letzten Schreibers, nichts vom anderen
- exakter Review-Fall: Recovery enthält die Änderung des ersten
- Handle endet direkt nach seiner letzten Änderung: Änderung ist wiederherstellbar
- Cache unter aktivem Handle geleert: kein Fehler, nächste Änderung stellt den Cache wieder her
- 1100 Änderungen (über die Verdichtungsgrenze): Recovery = Endstand

Neu in `tests/unit/renderer/document-cache.spec.ts`: zwei Stores auf derselben Datei, wechselnde Änderungen, beide
Authorities gesund, keine Fehlerhinweise, Recovery = Stand des zuletzt ändernden Stores.

Unverändert bestanden: Git-Ersetzung (6 Runden), MCP-Grant (6 Runden), Öffnen trotz älterem Cache, schnelle
Ersetzungen, Abbau zu sechs Zeitpunkten ohne späte Meldungen, abgelöster Controller, fremder Stand in der Datenbank,
bestehender Recovery-Test.

## Ausgeführte Befehle (nach der Korrektur)

| Befehl | Ergebnis |
| --- | --- |
| `npx vitest run --config vitest.config.ts tests/unit/crdt.spec.ts tests/unit/renderer/document-cache.spec.ts` | 30/30, viermal in Folge |
| dieselben plus `tests/unit/crdt`, `renderer/{whiteboard,plugin-store,room-adopt,room-connection,room-permissions,guest-store,confluence-live-store}.spec.ts`, `mcp/renderer-session.spec.ts`, `mcp-review-boundaries.spec.ts`, `tests/unit/session`, `tests/unit/collaboration` | 43 Dateien, 433/433 |
| `npm run typecheck` | bestanden |
| `npm run build` | bestanden |

Nicht ausgeführt: vollständige Unit-Suite, `test:ui`, `test:electron`, die gebündelte Probe des Reviewers
(`probe.cjs` enthält den alten Stand; der Ordner unter `/tmp` ist für mich nicht auflistbar). Der Review-Fall läuft
stattdessen als Test im Repository.

## Hashes (SHA-256)

```
581dd836497f1cd31b8454932cdbf901bffeb990742fad32585f4b4c708c23dd  src/crdt/persistence.ts            (geändert)
b32e7575e7d46deae93defd7af4282b372809cd6b854abfae4edc374a4a9a8bb  src/crdt/types.ts                  (Kommentar)
15d5c73211c878d372c351b23c469ff58493d67983f7d65a7ab18d4b76229567  tests/unit/crdt.spec.ts            (geändert)
43b739ff0b25957e4f25285a823e83e9bd2ecb99ae4c73dadb4921983ea76547  tests/unit/renderer/document-cache.spec.ts (geändert)
fa3747dc91839da9cb3e308580c5df5ced12c0bf48472a99e04d50d60421dce6  src/renderer/state/whiteboard.ts   (wie erster Bericht)
1b9f18add79f28467d7cfa5e3bec57334219f45175c9f4093547b0f76fcd76db  src/agent-access/renderer-session.ts (unverändert)
cfdfb294fbdec5e8b3b70a22121e39d22d3f30be7e414d71c47609caa3825d60  src/renderer/design-system/pages/WorkspacePage.vue (unverändert)
fc98a538196537a4cf72b95a303752cb3afb540dc2958f0e2cc3f3d32665ed1d  src/session/authority.ts           (unverändert)
dcce42fad5ec3764edc15ce1f95f22460d02cde32385d8b692ae2a464fc1ba0b  electron/main.ts                   (unverändert)
3477e116ade73304a6d1a6e631a02d77d47077671e668814886b1238bb25cb37  tests/electron/confluence-fixture.ts (unverändert)
66325edc64db474a5d0e2ca6b9421a1093a3a48fd445f2b47e5721217f12a00f  tests/electron/confluence-live.spec.ts
38c9998741ae28af2877f2de99155c4e66730b4e6b80813cc65fd8b9d50a2ee5  dist-electron/main.cjs
a4f86f229a0683fa7716766328873807032f704ac637167c1ad4b1d178332169  dist-mcp/server.cjs
```

`tests/electron/confluence-live.spec.ts` hatte im ersten Bericht `3fe01cae…`. Ich habe die Datei in diesem
Durchgang nicht angefasst; die Änderung stammt nicht von mir.

## Grenzen

- **Nur `fake-indexeddb`.** Transaktionsreihenfolge über Verbindungen hinweg und `versionchange` in Chromium sind
  nicht nativ geprüft.
- **Ein Stand, nicht zwei.** Bei zwei aktiven Handles enthält der Cache nur den Stand des letzten Schreibers. Der
  ungespeicherte Stand des anderen ist erst nach dessen nächster Änderung wieder wiederherstellbar.
- **Kosten bei Wechsel.** Ändern zwei Handles abwechselnd, schreibt jeder Wechsel den vollständigen Stand
  (Aufwand in Dokumentgröße). Ein einzelner Handle hängt wie bisher nur Änderungen an.
- **Layout-Kopplung.** Der Schreiber nutzt die Store-Namen und das Update-Format von `y-indexeddb` 9.0.12, weil
  die Recovery darüber liest. Die Recovery-Tests sichern das ab; ein Versionswechsel der Bibliothek braucht sie.
  Ein fremder, direkt gebundener `y-indexeddb`-Schreiber (im Produkt nicht vorhanden) kennt den Vermerk nicht.
- **Fehler bleiben Ereignisse.** `error` wird am Controller gemeldet; die Oberfläche wertet das weiterhin nicht
  aus. Ein fehlgeschlagener Schreibvorgang wird erst mit der nächsten Änderung repariert.
- Kontrolllauf gegen den Vorstand liegt für die vier CRDT-Tests vor, nicht für den neuen Store-Test.
- Keine native und keine echte Abnahme; der vorbereitete native Test bleibt bei Root.

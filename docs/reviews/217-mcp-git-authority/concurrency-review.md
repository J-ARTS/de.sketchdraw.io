# #217 – konkurrierende Cachehalter: isolierter Nachweis

Geprüft am 16.11.2026 um09:08:46 UTC durch Codex `/root/live_correction_review`; delegierter Scope in Kommentar6912104646. Fable-Implementierungslauf lief parallel. Ausschließlich ein begrenzter Fall unter `/tmp`, echte Produktfunktionen und `fake-indexeddb` im Arbeitsspeicher. Keine Produkt-/Testdateiänderung, App, native UI, Tenant-, Profil-, Runtime-, GitHub-, Ledger- oder Graphaktion.

## Ergebnis: materieller Befund bestätigt (P2)

Zwei aktive Persistenzhandles verwenden denselben Cache-Schlüssel. Der zweite Attach löscht die Datenbank und schließt dadurch die Datenbankverbindung des ersten Handles. Dessen nächste gültige Dokumentänderung wird zwar in der Authority committed, kann aber nicht mehr persistiert werden. Der erste Handle meldet einen Persistence-Fehler; die anschließende explizite Recovery enthält die Änderung nicht.

Ablauf des einzigen ausgeführten Falls:

1. Zwei reale CRDT-Controller und Authorities starten mit exakt demselben synthetischen Dokument: gleicher ID, Titel `Shared initial state`, Inhalt und Revision0.
2. Ersten Cache attachen und `ready` abwarten. Zweiten Cache unter demselben Schlüssel attachen und `ready` abwarten. Beide Handles bleiben aktiv.
3. Über das echte Authority-Binding der ersten Instanz den Titel auf `Unsaved edit in still-active first instance` ändern. Antwort `committed`, Revision1.
4. Erster Handle meldet nach `loading`/`ready` nun `error` mit der InvalidStateError-Nachricht von fake-indexeddb. Zweiter Handle bleibt bei `ready`; keine Authority meldet einen Fatalfehler. Beide Authority-Snapshots sind weiterhin lesbar, der erste enthält die neue Änderung.
5. Beide Handles regulär zerstören. Echte `createPersistedCrdtController`-Recovery auf demselben Schlüssel liefert `recovered:true`, aber weiterhin `Shared initial state`. Die gültige ungespeicherte Änderung der ersten Instanz fehlt im Recovery-Zustand.

Ausführung `node /tmp/sketchdraw-217-concurrency-probe/probe.cjs`: **Exit0 bedeutet erfolgreiche Fehlerreproduktion, keine Korrekturfreigabe**. Start09:08:46.363Z, Ende09:08:46.475Z. Kein weiterer Fall oder Testlauf.

## Ursache und Reichweite

- `src/crdt/persistence.ts:61–67`: Jeder normale Attach ruft `clearDocument(name)` auf und bindet danach den neuen Mirror.
- `node_modules/y-indexeddb/src/y-indexeddb.js:49`: clearDocument nutzt deleteDB.
- `node_modules/lib0/indexeddb.js:45–50`: bestehende Datenbankverbindungen schließen bei versionchange.
- `node_modules/y-indexeddb/src/y-indexeddb.js:107–110`: Der ältere Handle behält eine nicht-null db-Referenz und versucht bei seiner nächsten Änderung eine Transaktion auf der inzwischen geschlossenen Verbindung.
- `src/crdt/persistence.ts:51–53`: forward meldet den Fehler und beendet den Cache-Handle. Im Renderer wird dieses Ereignis derzeit nicht als Nutzerstatus beobachtet.

Die Einbahnspiegelung schützt die lebenden Authorities im geprüften Fall. Der konkrete Restfehler ist verlorene Recovery-Fortschreibung einer weiterhin aktiven Instanz nach konkurrierendem Attach. Daraus wird weder ein erneuter AUTHORITY_DIVERGED-Befund noch ein tatsächlicher Datenverlust im Nutzer-Tenant oder ein nativer Mehrfensterlauf abgeleitet.

Der neue Fremdverbindungstest in `tests/unit/crdt.spec.ts` prüft den Controller der neu angehängten Instanz und beendet danach den fremden Handle. Eine weitere Änderung über diesen noch aktiven älteren Handle und deren Recovery-Ergebnis fehlen. Die neue Regression sollte genau den oben ausgeführten Fall aufnehmen. Cache-Besitz und konkurrierende Generationen müssen bewusst geregelt werden: keine still geschlossene alte Verbindung mit weiter gültigem Persistence-Versprechen. Die Korrektur darf den alten Cache nicht wieder in die maßgebliche Datei-/Git-Authority einspielen.

## Snapshot und Belege

Alle **28 gebündelten Produktquelldateien** wurden vor und nach dem Bundlebau sowie nach dem Lauf gehasht: unverändert. Auch die erfassten y-indexeddb/lib0/yjs/fake-indexeddb-Abhängigkeiten blieben unverändert. Der Befund gilt exakt für diesen Zwischenstand; ein späterer Fable-Endstand erfordert gesonderten Abgleich.

- Persistence-SHA256: `727cd5490975d45d8d25e2581290cff0555b19d00e17850256c5d7035c4242fd`
- Ausgeführtes Bundle-SHA256: `cd343b7556f1b1a0f86a427b3432f86bd0f7a10c2a59a1ebbae5aed391057a95`
- Ergebnis-SHA256: `35a1f9da3f9887f122551fa6a6236a44353d00c86adcad66a9aa9e6ef844a15c`
- Harness: `/tmp/sketchdraw-217-concurrency-probe/probe.ts`
- Ergebnis: `/tmp/sketchdraw-217-concurrency-probe/result.json`
- Vollständige Hashgrenze: `/tmp/sketchdraw-217-concurrency-probe/source-manifest.json`
- Ausgeführtes Bundle bleibt lokal: `/tmp/sketchdraw-217-concurrency-probe/probe.cjs`

Keine endgültige #217-, native MCP-/Quit-, Neustart- oder Tenant-Abnahme aus diesem Teilauftrag.

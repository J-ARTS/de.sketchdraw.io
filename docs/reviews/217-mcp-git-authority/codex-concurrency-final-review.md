# #217 – unabhängige finale Prüfung der Cache-Konkurrenzkorrektur

Codex `/root/live_correction_review`, delegiert in Kommentar6912405878. Geprüfter Freeze: `native-final-source-before.json` vom16.11.2026 09:21:02.962005UTC. Fable-Korrekturlauf war terminal; Root führte parallel ausschließlich seine nativen Tests aus. Hier nur Quellprüfung und eine in-memory fake-indexeddb-Probe. Keine Produkt-/Testdatei, App/UI, Tenant, Profil, Runtime, GitHub, Ledger oder Graph verändert.

## Ergebnis

**Der zuvor unabhängig reproduzierte Konkurrenzfehler ist für den eingefrorenen Stand behoben bestätigt. Kein neuer materieller Befund im begrenzten Reviewumfang.**

Die eigene ursprüngliche Probe wurde aus ihrem TypeScript-Harness neu gebündelt. Ablauf unverändert: zwei aktive Controller/Authorities mit genau demselben Dokument und Cache-Schlüssel, erster Attach ready, zweiter Attach ready, danach eine gültige Änderung über das echte Authority-Binding der ersten Instanz; reguläres Ende beider Handles und explizite Recovery. Angepasst wurden die erwarteten Assertions und der separate Ausgabepfad.

Ergebnis am16.11.2026 09:22:46.378–09:22:46.496UTC, Exit0:

- Beide Handles melden ausschließlich loading/ready, keinen Persistenzfehler.
- Beide Authorities bleiben lesbar und ohne Fatalereignis; die zweite behält ihren unveränderten Dokumentstand.
- Die erste Änderung ist committed mit Revision1.
- `createPersistedCrdtController` meldet recovered:true und liefert genau den neuen Titel der ersten Instanz: `Unsaved edit in still-active first instance`.
- Die frühere Fehlerprobe und ihre Resultate bleiben bytegleich erhalten. Ihr Exit0 bedeutete Fehlerreproduktion; dieser neue Exit0 bedeutet bestandene Korrekturprüfung.

## Quellabgleich

`src/crdt/persistence.ts:85–114` liest den Writer-Vermerk und schreibt Update oder vollständigen Ersatz in einer einzigen readwrite-Transaktion über updates/custom. Bei einem anderen letzten Schreiber, einer Sequenzlücke oder Verdichtung ersetzt dieselbe Transaktion den vollständigen Stand. Das normale Attach löscht keine Datenbank mehr und schließt dadurch keine fremde Verbindung.

Der Writer kodiert nur den Quellcontroller; es gibt keinen Cache→Controller-Rückkanal. Listener werden bei release unmittelbar entfernt. Bereits begonnene Transaktionen werden vor dem endgültigen Schließen abgewartet. Nach einer externen Datenbanklöschung wird die Verbindung freigegeben; eine weitere Änderung öffnet sie erneut und schreibt den vollständigen Zustand.

Die explizite Recovery liest weiterhin das y-indexeddb-Layout. `updates` enthält Yjs-V1-Updates (`update` / `Y.encodeStateAsUpdate`), die der bestehende y-indexeddb-Reader über `Y.applyUpdate` verarbeitet. Der eigene Writer-Vermerk liegt getrennt in custom. Das Format ist damit zum vorhandenen Reader passend; die eigene erfolgreiche Recoveryprobe bestätigt den ausgeübten Pfad.

Die festgelegte Semantik hält einen vollständigen Dokumentstand des letzten Schreibers pro Cache-Schlüssel; Attach zählt als Schreiben. Sie führt unabhängige Dokumentstände nicht zusammen. Die zusätzlichen Fable-Regressionsnachweise wurden gelesen, hier nicht erneut ausgeführt. Dieses Review bestätigt keine native Transaktionsreihenfolge, MCP-/Quit-Abnahme, tatsächlichen Neustart oder Tenant-Abnahme; diese bleiben bei Root.

## Snapshotnachweis

Alle28 gebündelten Produktquelldateien stimmen mit dem Root-Freeze überein und blieben vor/nach Bundlebau sowie nach dem Lauf unverändert. Die erfassten Abhängigkeiten blieben ebenfalls unverändert.

- Persistence SHA256: `581dd836497f1cd31b8454932cdbf901bffeb990742fad32585f4b4c708c23dd`
- Harness SHA256: `8e9b65b34e60fcb524870c322cfbfef2e00f5eba5938683847e6a530d615d885`
- Ausgeführtes Bundle SHA256: `9b7472b33adfaaba8ecea967c0d7dc6b72895384996001a0a131c7e580c7f0b8`
- Ergebnis SHA256: `594f0c1ad8d438039a609bd86463811ea2079b702548a4e1caffe82be311b7fc`

Belege unter `/tmp/sketchdraw-217-concurrency-final-probe/`: `probe.ts`, `probe.cjs`, `result.json`, `source-manifest.json`, `historical-integrity-before.json`. Exakte Vorgeschichte unter `/tmp/sketchdraw-217-concurrency-probe/` unverändert. Keine großen Bundle-Dateien ins Repository kopiert.

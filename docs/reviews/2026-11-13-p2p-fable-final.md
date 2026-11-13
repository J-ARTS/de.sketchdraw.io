# Fable 5.2 / high: begrenzter P2P-Abschlussreview

Originalausgabe des tatsächlichen Claude-Code-Laufs. Dieser Lauf fand zwei konkrete Blocker; beide wurden anschließend unabhängig mit roten Regressionen bestätigt und minimal korrigiert. Die Nachweise und Grenzen stehen im P2P-Audit. Der Review selbst führte keine Tests aus.

**Ergebnis: 2 Blocker (einer in #182, einer in B3). B1 und B2 ohne Blocker.**

Ich habe nichts ausgeführt. Gelesen wurden `relay/hub.mjs` und `relay/hub.d.mts`; zusätzlich habe ich drei gezielte Greps auf dem B3-Aufrufpfad gemacht (`crdt.ts`, `session.ts`), also etwas über deine Vorgabe hinaus.

## Blocker

### 1. #182: Globales Queue-Limit driftet nach Shedding (`relay/hub.mjs:156-170` mit `:99-106`)

`paceForwarding` holt `queue` vor der Shed-Schleife. Schließt die Schleife ein Opfer, entfernt `forgetForwarding` auch die Records anderer Quellen an dieses Ziel. Wird die Queue der aktuellen Quelle dabei komplett leer, wird sie nur aus der Map gelöscht; `records` und `bytes` am Objekt bleiben stehen (`:104`). Danach hängt `:169-170` den neuen Record an dieses veraltete Objekt und registriert es wieder.

- **Fehlerfall:** Host H hat nur Records an Gast G1 in der Queue. G1 ist größter Produzent. H sendet an G2, während die globale Queue voll ist. G1 wird geschlossen, H und G2 leben weiter.
- **Zahlenbeispiel** (Burst/Rate 100, `maxAggregateQueuedBytes` 250):
  1. G1 sendet 3×84 Byte: einer geht direkt durch, 200 Byte liegen in der Queue.
  2. H sendet 30 Byte an G1: 230 Byte in der Queue.
  3. H sendet 30 Byte an G2: 260 > 250, G1 wird geschlossen, `queuedBytes` fällt auf 0.
  4. Hs Queue enthält jetzt den toten G1-Record plus den neuen: `queue.bytes` = 60, `queuedBytes` = 30.
  5. Nach dem Drain steht `queuedBytes` bei −30.
- **Auswirkung:** Der Zähler unterzählt dauerhaft, bis zu etwa 1 MiB pro Wiederholung. Auf einem Volunteer-Helper kann ein Angreifer H, G1 und G2 selbst stellen; nach etwa acht Runden ist die 8-MiB-Grenze wirkungslos. Tote Records verbrauchen außerdem Aggregat-Tokens.
- **Korrektur:** Nach der Shed-Schleife `queue = forwarding.get(source) ?? { records: [], bytes: 0 }` neu lesen, oder im Löschzweig von `forgetForwarding` das Objekt zurücksetzen. Dazu ein Regressionstest mit obiger Sequenz, der prüft, dass die Shed-Schwelle danach unverändert greift.

### 2. B3: Per-Peer-Limit trifft ehrliche, direkt aufeinanderfolgende Transfers (`crdt-transfer.ts`, neue Zeile mit `[...reservations].some(...)`)

Die Reservierung bleibt absichtlich bis zum Ende von `digest` bestehen. Die neue Prüfung zählt aber alle Reservierungen des Peers, auch vollständig empfangene in der Verifikation. `crdt.ts:138` und `:293` rufen `receiver.accept` ohne Serialisierung auf (`void …then`).

- **Fehlerfall:** Ein Peer sendet zwei große Updates direkt nacheinander, etwa Sync-Antwort plus Bild-Paste. Chunk 0 von Transfer 2 trifft ein, während Transfer 1 noch gehasht wird. Das ergibt `SYNC_TRANSFER_LIMIT`.
- **Auswirkung auf dem Host:** `onPeerError` führt zu `kick` (KICKED) für einen korrekten Gast.
- **Auswirkung auf dem Gast:** Dort gibt es kein `onPeerError`, also `reportError` und `SYNC_FAILED` für die ganze Bindung (`crdt.ts:62`).
- **Einordnung:** Regression dieses Patches; vorher waren mehrere parallele Transfers bis `MAX_TRANSFERS` erlaubt. Ob die Sendeseite das Fenster zeitlich immer verdeckt, habe ich nicht gelesen. Der Empfänger darf sich darauf nicht verlassen, weil ein Relay die Frames gebündelt zustellen kann.
- **Korrektur:** Per-Peer-Prüfung auf `!value.verifying` beschränken; das entspricht „1 unvollständiger Snapshot pro Peer“. Mehrere verifizierende Einträge bleiben durch das globale Budget gedeckt und liefern dann `SYNC_TRANSFER_BUSY`. Dazu ein Test: letzter Chunk von T1 und erster von T2 ohne `await` dazwischen.

## Ohne Blocker bestätigt

- **B1:** Quarantäne nur bei `AUTH_TIMEOUT` und `HEARTBEAT_TIMEOUT`, nur für Helper-Kanäle und nicht bei Abbruch. `SYNC_BUSY` wird nicht markiert. Sind alle Kandidaten gesperrt, wird genau einer (der älteste) erneut versucht; ein weiterer Fehlschlag rotiert zum nächsten.
- **B2:** Die Untergrenze `base * 0.8` wird nach jedem Wake neu berechnet. Wake gibt es nur noch beim Verlust eines aktiven Helpers. `emptyRounds` steigt unabhängig vom Discovery-Ergebnis; flatternde Registrierungen sind auf einen Lookup pro etwa 2,4 s begrenzt.
- **B3-Reconnect:** `peerId` ist pro Verbindung zufällig (`session.ts:151`), und die Quarantäne wird bei Abwesenheit des Peers gelöscht (`crdt.ts:186`). Ein per `SYNC_BUSY` gelöster Gast bleibt nach dem Reconnect nicht stumm.
- **#182 Reihenfolge:** Der Schnellpfad greift nur bei leerer Queue; je Quelle FIFO, ein Record pro Runde.
- **#182 Budget:** Controls, Drop-Frames und unbekannte Ziele verbrauchen keine Tokens. Der `Infinity`-Bypass ist unverändert.
- **#182 Cleanup:** `closed()` entfernt Quell- und Zielrecords synchron. `dispose` löscht den Timer, und danach wird nichts neu geplant. Die Shed-Schleife terminiert.
- **`hub.d.mts`:** Stimmt mit den Limits überein.

## Einschränkungen

**Nicht geprüft:**
- Ob `ended.reason` in B1 nur lokal entsteht oder auch einen Remote-Bye-Grund tragen kann.
- Ob `establishChannel` dasselbe Kanalobjekt zurückgibt, das in der `WeakMap` liegt; bei einem Wrapper wäre die Quarantäne wirkungslos.
- Ob der Gast `SYNC_BUSY` als wiederholbar behandelt und wie schnell er wiederholt. Der Host sendet kein `retryAfterMs`; unter anhaltendem Druck ist eine Reconnect-Schleife im Basis-Backoff möglich.
- Die Helper-Konfiguration: Records größer als `aggregateByteBurst` trennen die Quelle sofort, der Burst muss also mindestens `maxRecordBytes` sein.

**Verhaltensänderung in B1:** `error` wird jetzt auch im Zustand `reconnecting` mit rohen Gründen gesetzt. Verbraucher, die `status.error` als endgültig werten oder keine Übersetzung für diese Codes haben, sollten geprüft werden.

**Designgrenzen von #182 (keine Fehler dieses Patches):**
- **Fairness ohne Identität:** Fairness gilt pro Verbindung. Viele kleine Sybil-Verbindungen können die globale Queue füllen; verworfen wird dann der ehrliche größte Produzent.
- **Hosts überproportional betroffen:** Ein Host teilt 1 MiB und 128 Records über alle seine Gäste. Er ist typischerweise der größte Produzent, und sein Abbruch beendet die Sitzung für bis zu 24 Gäste. Ein 8-MiB-Snapshot (etwa 137 Records) passt bei Sättigung nicht in die Queue.
- **Byte-Grenze ist kein Speichermaß:** Bei 1-Byte-Frames begrenzt nur 128 × `maxConnections` die Zahl der Record-Objekte.
- **CPU unter Sättigung:** Jede eingehende Nachricht kostet O(wartende Quellen), jeder Verbindungsabbau O(alle Records). Bei Default `maxConnections` 2000 im Main-Prozess ist das spürbar, aber endlich.

**B3 unter Angriff:** Authentifizierte böswillige Gäste können die gemeinsamen Empfangsplätze belegen. Ehrliche Gäste erleben dann wiederholte Trennungen statt KICKED.

**L1:** Wie dokumentiert akzeptiert, nicht erneut bewertet.

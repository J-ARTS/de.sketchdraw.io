# Fable 5.2 / high: P2P-Nachreview

Originalausgabe des tatsächlichen Claude-Code-Laufs. Keine Tests durch den Reviewer. Nachfolgende Codex-Korrekturen separat im P2P-Audit dokumentiert.

# Finales Diff-Review P2P (#152, #179), nur gelesen

**Rahmen:** Claude Code, `claude-fable-5-2`, high. Keine Edits, Befehle oder Tests; alle Befunde sind statisch und nicht reproduziert. Gelesen wurden das Diff, der Vorbericht und gezielte Stellen in `crdt.ts`, `hdht/session.ts`, dazu Grep-Treffer in `hdht/peer-relay.ts` und `crdt-transfer.ts`, also leicht über dem 3-Dateien-Limit. Der Graphify-Hook war ohne Befehlswerkzeug nicht erfüllbar. Zeit, Tokens, Kosten: unbekannt.

## Fazit

Die #179-Kernkorrektur ist schlüssig, darin finde ich keinen Blocker. Zwei Defekte im #152-Teil sollten vor dem Abschluss behoben werden (B1, B2). Dazu kommt ein mittlerer Defekt im Empfangsbudget (B3).

## Blocker

**B1: Der Gast sperrt seinen Helfer bei fast jedem Verbindungsende (`session.ts:509-515`, `:530`).**
- **Fehlerfall:** Die Bedingung schließt nur fatale Auth-Codes, `SESSION_ENDED`/`KICKED` und Sync-Byes aus. Alles andere markiert den Helfer für 60 s als defekt: Host im Ruhezustand oder abgestürzt, eigener WLAN-Wechsel des Gasts, jedes andere `PEER_BYE:*`, lokale Fehler wie `INTERNAL_ERROR` oder `SEND_FAILED`.
- **Widerspruch:** Ein `PEER_BYE` beweist gerade, dass der Helfer weiterleitet.
- **Auswirkung:** Gibt es nur einen Helfer, liefert `peer-relay.ts:103-104` danach 60 s lang `NO_HELPER`. Vorher wurde derselbe Helfer sofort erneut versucht. Bei einem kurzen Host-Aussetzer sperren alle Gäste gleichzeitig ihren Helfer, und die UI meldet `HELPER_FORWARDING_FAILED` für einen Hostausfall.
- **Offen:** Ob das bis `CONNECTION_LOST` führt, hängt von Backoff-Summe und `maxReconnect` ab; das habe ich nicht gelesen.
- **Fix:**
  - Nur bei lokal beobachteter Stille markieren (Auth- oder Heartbeat-Timeout), nie bei `PEER_BYE:*` oder lokalen Fehlern.
  - Sind alle gefundenen Kandidaten gesperrt, den am längsten gesperrten versuchen statt `NO_HELPER` zu werfen.
- **Fehlender Test:** Ein Helfer, Host pausiert kurz, Gast verbindet sich über denselben Helfer wieder.

**B2: Der Mindestabstand zwischen Lookups ist umgehbar (`peer-relay.ts:225-227`, Wake bei `:286-290`).**
- **Fehlerfall:** Die Abstandswartezeit läuft über dasselbe weckbare `wait()`. Zwei aktive Sybil-Helfer fallen nacheinander ab: Der erste Verlust weckt die Schleife in die Abstandswartezeit, der zweite beendet diese vorzeitig, und der Lookup startet sofort.
- **Auswirkung:** Neue Schlüssel registrieren, `ready` melden und abfallen ergibt eine Lookup-Rate, die nur durch die Registrierungsdauer begrenzt ist. `emptyRounds` wird dabei jedes Mal auf 0 gesetzt. Der Kommentar bei `:224` und Entscheidung D1 stimmen ab `target ≥ 2` nicht.
- **Fix:** Die Untergrenze als Schleife ausführen: `while ((remaining = …) > 0) { await this.wait(remaining); if (!this.current(generation)) return; }`.
- **Fehlender Test:** Zwei Helfer werden `ready` und schließen zeitversetzt; die Lookup-Zeitpunkte liegen mindestens `0.8·base` auseinander.

**B3 (mittel): `SYNC_TRANSFER_LIMIT` trifft den Falschen (`crdt-transfer.ts:97-99`).**
- **Fehlerfall:** Der erste 48-KiB-Frame reserviert sofort das deklarierte `total`, und es gibt keine Grenze je Peer. Ein Editor kann so das ganze 64-MiB-Budget oder alle Transferplätze für 30 s belegen.
- **Auswirkung:** Der nächste große Snapshot eines unbeteiligten Editors bekommt den Fehler. Mit `onPeerError` wird dieser Editor jetzt gekickt, und zwar endgültig, weil `PEER_BYE:KICKED` final ist (`session.ts:18`).
- **Einordnung:** Besser als der frühere sitzungsweite Abbruch, aber eine gezielte Verdrängung. Vor dem Schließen von #179 beheben oder dort ausdrücklich als offen führen.
- **Fix:** Höchstens ein gleichzeitiger Transfer je Peer, und bei aggregatbedingtem Limit den Anfragenden nicht endgültig entfernen.

## Kein Befund

- **Generationsbereinigung:** In Ordnung. `peerId` ist je Verbindung zufällig, `keyHash` ist das Kanal-Binding (`session.ts:149-150`). Der Close-Handler veröffentlicht den Status (`:175`), daraufhin werden Queues, Quarantäne und Sync-Zähler geleert (`crdt.ts:185-187`). Ein altes Timeout kann keine neue Verbindung treffen.
- **Buchhaltung:** Jede Reservierung hat genau ein `finally`; frühe Rückgaben reservieren nicht. Bei Abbruch werden wartende und laufende Aufträge freigegeben. `syncPending` wird in allen Pfaden gelöst. Bei `close()` bleiben keine Timer.
- **Koaleszieren und 8/s:** Der legitime Gast sendet eine Bootstrap-Anfrage je Verbindung (`crdt.ts:260-265`) plus eine Binding-Anfrage. Eine verworfene Zweitanfrage kostet keine Daten, weil Broadcasts weiter in der Peer-Queue landen.
- **Gastverhalten:** Ohne `onPeerError` fällt alles auf `reportError` zurück. Fehler bereits getrennter Peers werden jetzt verworfen, was zum alten Sendepfad passt.
- **API:** Der zweite `onError`-Parameter ist für den Bootstrap-Aufrufer (`crdt.ts:242`) kompatibel. `externalAddressKnown` ist nur ein Boolean; die IP wird nicht exportiert.

## Einschränkungen (kein Blocker, im Ticket benennen)

- **L1, sitzungsweites Budget (`crdt.ts:75`):** Sync-Antworten sind je Peer eigene Arrays ohne geteilte Referenz. Mehrere authentisierte Gäste, auch Viewer, mit je einer wartenden Vollzustandsantwort beenden die Session weiterhin für alle, sobald die Summe 64 MiB übersteigt. #179 gilt damit für große Dokumente nur eingeschränkt. Eng begrenzte Abhilfe: Bei erschöpftem Budget die peer-spezifische Antwort überspringen statt `reportError` aufzurufen; der Gast fragt neu an.
- **L2, Kick-Grund:** Ein langsamer Uplink (30 s Leerlauf, 120 s gesamt) oder 32 wartende Updates führen zu endgültigem `KICKED` ohne automatischen Wiederaufbau, ununterscheidbar von manuellem Entfernen. `kick(peerId)` kennt keinen Grund; ein eigener, nicht finaler Grund wäre eine Vertragsänderung und gehört in ein Folgeticket.
- **L3, flatternder Helfer:** `ready` setzt den Backoff zurück, ist aber nur eine Registrierung. Ein Helfer, der annimmt und abfällt, hält den Host nach dem B2-Fix dauerhaft an der Untergrenze von etwa 2,4 s. Das ist beschränkt und mit D1 vereinbar.
- **L4, Härtung:** `onPeerError` läuft ungeschützt aus Timer- und Promise-Pfaden (`crdt.ts:66`). Der aktuelle Handler wirft nicht; ein `try/catch` wäre trotzdem angebracht.
- **L5, nicht verifiziert:**
  - Andere Host-Aufrufer von `bindCrdtTransport` ohne `onPeerError` behalten den sitzungsweiten Abbruch.
  - Gast-Konsumenten, die exakt auf `SYNC_FAILED` prüfen, sehen jetzt `SYNC_PEER_BACKPRESSURE`.

## Abschlussbewertung

- **#179:** Kern erfüllt. Schließbar, wenn B3 behoben oder als offen dokumentiert ist und L1 im Ticket steht.
- **#152:** Nicht abschlussreif, bis B1 und B2 behoben und mit den genannten Tests belegt sind.

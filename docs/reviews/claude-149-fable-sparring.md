# #149 / #150 / #151 — Fable 5.2: unabhängiges Sparring

Der tatsächliche Aufruf erfolgte mit Claude Code 2.1.321, `--model claude-fable-5-2 --effort high`. Init, Assistant-Nachrichten und Abschlussmetrik bestätigen das Modell. Die ältere CLI 2.1.185 wurde zunächst mit API400 abgewiesen; dieser Versuch lieferte keinen Review. Kein Modellwechsel.

Sitzung: `5db4e51b-d87f-4bd2-a71a-44ca84903e8c`. Nur Read/Grep/Glob; keine Tests, Codeänderungen oder GitHub-Schreibvorgänge durch Fable. Auftrag: `/tmp/sketchdraw-149-fable-sparring.md`, Rohlog: `/tmp/sketchdraw-149-fable-sparring-v2.jsonl`.

## Tatsächliche Abschlussmetrik

- Erfolgreich abgeschlossen, is_error=false, 50 Turns, 508.246 s Laufzeit.
- Vom CLI gemeldete Kosten (Listenpreis): 4.702750 USD; kein gesonderter Zahlungsnachweis.
- Input: 28; Cache-Erstellung: 158621; Cache-Lesen: 1175151; Output: 48239 Tokens.

## Unveränderter Fable-Abschlussbericht

Die folgende Aussage, dass Laufmetrik/Effort dem Reviewer unbekannt seien, beschreibt dessen Sicht. Der Aufruf und die tatsächliche Abschlussmetrik sind oben durch Codex separat belegt.

# Review #149 – HyperDHT-Relay (nur lesend)

**Lauf:** Claude Code, Modell laut Laufzeit `claude-fable-5-2` (Fable 5.2). Die Effort-Stufe kann ich aus der Laufzeit nicht ablesen; Zeit, Tokens und Kosten sind unbekannt. Ich habe nichts geändert und nichts ausgeführt: keine Tests, kein Netzwerk, keine Issue-Updates. `graphify query` konnte ich mangels Shell nicht starten, und `graphify-out/` enthält keine Treffer zu den uncommitteten #149-Dateien, daher habe ich die Quellen direkt gelesen.

Es gibt fünf materielle Befunde. Der schwerste ist ein stiller Datenverlust bei Dokumenten oder Updates über 4 MiB.

## Befunde

### 1 · P1 · Stiller Verlust und dauerhafte Divergenz ab 4 MiB
- **Stelle:**
  - `src/collaboration/crdt.ts:33-43` und `:62` verschlucken jeden Sendefehler; `:55-57` verschluckt abgelehnte Remote-Updates.
  - `src/collaboration/hdht/session.ts:227`, `:230` und `:511` werfen `TRANSPORT_MESSAGE_LIMIT` bzw. `TRANSPORT_BACKPRESSURE`, bevor etwas gesendet wird; der Kanal bleibt offen.
  - `src/crdt/controller.ts:181-188` prüft lokale Updates nicht auf Größe.
- **Auslöser:** Bild-Assets liegen als `dataUrl` im Yjs-Dokument (`src/crdt/projection.ts:657`) und dürfen 8 MiB groß sein (`src/domain/limits.ts:29`). Der `update`-Kanal und `CRDT_UPDATE_LIMIT_BYTES` enden bei 4 MiB. Es genügt ein Bild ab etwa 3 MiB oder ein Gesamtzustand über 4 MiB; bei fünf Gästen reicht ein 3,3-MiB-Update für das 16-MiB-Budget.
- **Auswirkung:**
  - Der Gast läuft beim Beitritt 35 s in `DIRECT_CONNECTION_TIMEOUT` (`crdt.ts:123`) und sieht die irreführende Meldung „Keine Verbindung erreichbar … WSS-Gateway“ (`HdhtSession.vue:58`).
  - Im laufenden Betrieb fehlt der Gegenseite das Update. Alle Folgeänderungen desselben Yjs-Clients bleiben dort als Pending-Structs liegen, während der Status „Verbunden“ zeigt.
  - Ein Reconnect heilt das nicht, weil der Diff wieder über 4 MiB liegt.
- **Kleinste Korrektur:**
  - Beim Sessionstart und bei lokalen Änderungen die Größe prüfen und sichtbar ablehnen.
  - Einen abgelehnten `update`-Send als Sync-Fehler behandeln: den Peer mit benanntem Grund (z. B. `SYNC_TOO_LARGE`) schließen und den Grund in der UI anzeigen.
- **Test:** Host-Dokument mit 3,5-MiB-PNG: `bootstrapRoomDocument` muss in unter 2 s mit spezifischem Code scheitern. Verbundener Editor: großes Asset, dann Umbenennen; heute bleibt der Titel beim Gast alt bei `state: ready`.
- **Nachweislücke:** Der 8-MiB-Test (`session-peer-relay.spec.ts:129-135`) sendet über den Kanal `asset`, den kein Produktivcode nutzt. Er belegt den Dokumentpfad nicht.

### 2 · P1/P2 · Hub trennt gesunde Verbindungen bei Kontrollframes unter Rückstau
- **Stelle:** `relay/hub.mjs:99` schließt mit `slow-consumer`, sobald mehr als 64 KiB gepuffert sind und ein Kontrollframe ansteht. Das betrifft `pong` (`:149`), `guest-join` (`:193`) und `guest-leave` (`:233`). Beim Helfer ist `bufferedAmount` der Schreibrückstau desselben Kanals (`electron/peer-relay-service.ts:224`).
- **Auslöser:** Jeder Helfer-Client sendet alle 20 s einen Text-Ping (`channel-socket.ts:47`). Zwei Records im Rückstau (etwa 123 KiB) genügen. Das tritt bei jedem mehrere MiB großen Transfer auf, wenn der Empfänger langsamer ist als der Sender.
- **Auswirkung:** Der Gast fliegt mitten im Abgleich. Beim Host fällt die Registrierung, alle Gäste dieses Helfers werden getrennt und der Helfer ist 60 s gesperrt. Das ist probabilistisch, kein Datenverlust, aber Flattern.
- **Kleinste Korrektur:** Für beigetretene Verbindungen bei Kontrollframes `maxBufferedBytes` anwenden; die 64-KiB-Grenze nur vor dem Join. Alternativ nur Kontrollbytes zählen.
- **Test:** `relay-hub.spec.ts:113-120` schreibt das Fehlverhalten fest. Gegenfall: Host mit 200 KiB Puffer erhält `guest-join` und bleibt verbunden.

### 3 · P2 · Der Helfer begrenzt die Rate, nicht den Speicher
- **Stelle:** `HELPER_DEFAULT_LIMITS` (`electron/peer-relay-service.ts:26-32`) überschreibt `maxBufferedBytes` nicht. Es gelten 12 MiB je Ziel (`relay/hub.mjs:22`, `:215`) bei 48 Verbindungen.
- **Auslöser:** Ein Angreifer registriert zwei eigene Hosts mit 46 nicht lesenden Gästen und füllt jeden Puffer knapp unter 12 MiB. Kleine Records alle 60 s halten die Verbindungen bis zu 13 h offen.
- **Auswirkung:** Rund 0,5 GiB im Electron-Hauptprozess eines Freiwilligen, in etwa 46 s gefüllt; dazu kommen nicht mitgezählte UDX-Puffer.
- **Kleinste Korrektur:** Ein Gesamtbudget im Hub (z. B. 64 MiB über alle Verbindungen), geprüft in `forward()`. Zusätzlich kann die Ziel-Grenze auf die reale Maximalnachricht sinken, da der 8-MiB-Kanal ungenutzt ist.
- **Test:** Fake-Stream ohne Drain, 2 Hosts und N Gäste; die Summe von `pendingBytes` muss unter dem Budget bleiben.

### 4 · P2 · Der Direktweg wird unnötig verworfen
- **4-s-Abbruch:** `session.ts:346` bricht den Direktversuch nach 4 s ab. Der Client-DHT-Knoten entsteht erst beim ersten Lookup oder Connect (`electron/direct-service.ts:292`, `:323`). Kaltstart, Peer-Suche und Holepunch müssen also in 4 s passen, dreimal, dann ist Schluss. Ohne Helfer und Gateway ist das der einzige Weg. Die Tests laufen nur auf einem lokalen DHT ohne NAT; das Budget ist ungeprüft.
  - **Korrektur:** Den Sonderabbruch streichen. Der Parallelstart nach 1,5 s und das 20-s-Gesamtlimit begrenzen bereits.
- **Link ohne Direktschlüssel:** Der Link wird vor `hostStart` gebaut (`HdhtSession.vue:90`) und erst danach ergänzt (`:96`). Er ist sichtbar, sobald ein Gateway oder Helfer „ready“ meldet (`:198-200`, `session.ts:90`). Ein früh kopierter Link hat dauerhaft `d: ""`.
  - **Korrektur:** Link und Kopieren erst freigeben, wenn `hostStart` entschieden ist.
- **Test:** Verzögertes `hostStart` mit schnellem Gateway; der kopierbare Link muss `d` enthalten.

### 5 · P2 · Reconnect hängt an der PIN und kennt kein Ende
- **PIN-Sperre trifft Authentifizierte:** `PinGate.attempt` liefert während der Abklingzeit `PIN_LOCKED`, auch bei richtiger PIN (`invitation.ts:178-179`). Der Gast wertet das als endgültig (`session.ts:19`, `:448-451`). Wer nur die URL kennt, rät fünfmal falsch; jeder Gast mit kurzem Abriss im Fenster ist endgültig draußen. Dasselbe gilt nach „Neue PIN“ und nach 20 Fehlversuchen.
  - **Kleinste Korrektur:** Für bereits verbundene Gäste `PIN_LOCKED` nicht fatal behandeln, sondern nach `retryAfterMs` erneut versuchen. Sauberer wäre ein Resume-Geheimnis in `AUTH_OK`, das am PIN-Zähler vorbei prüft.
- **Flattern ohne Grenze:** `session.ts:485` setzt den Fehlerzähler nach jeder Authentifizierung auf 0. Trennt etwas direkt danach (Befunde 1 bis 3), läuft die Schleife im 500-ms-Takt endlos.
  - **Korrektur:** Erst nach stabiler Sitzung (z. B. 30 s) zurücksetzen.
- **Test:** Verbundener Gast, fünf Fehlversuche eines Dritten, Kanal kappen; erwartet `ready`, heute `error: PIN_LOCKED`.

## R31 – Restlücke, kein neuer Befund
Die Reihenfolge in `HdhtSession.vue:138-139` stimmt jetzt. `flushed` bedeutet aber nur „an UDX übergeben“. Das anschließende `hostStop` zerstört den Knoten sofort mit `force` (`direct-service.ts:214`, `:454`) und hebt das 1-s-Fenster aus `:434-436` auf. Geht das eine Bye-Datagramm verloren, läuft der Gast durch bis zu acht Reconnects statt „Gastgeber hat beendet“ zu sehen.

## Dezentralität und Zuverlässigkeit

**Behebbar (Engineering):**
- Der Helfer bewirbt sich ohne Erreichbarkeitsprüfung (`peer-relay-service.ts:124`). `dht-rpc` kennt `firewalled` und `randomized`, wird aber nicht abgefragt. Ein Helfer hinter zufälligem NAT nützt genau den Paaren nicht, die ein Relay brauchen.
- Der Host fragt alle 3 s ohne Backoff das DHT ab, solange weniger als zwei Helfer registriert sind (`peer-relay.ts:211`). Ohne Flotte ist das der Dauerzustand, bis zu 12 h.
- Ein Host kann nicht erkennen, ob ein Helfer nur „ready“ meldet und nichts weiterleitet. Ein begrenzter Schleifentest über den Helfer fehlt.
- `new DHT()` läuft ohne gespeicherte Knoten (`direct-service.ts:89`); pro App entstehen bis zu drei getrennte DHT-Instanzen.

**Nicht wegzuentwickeln:**
- Der Einstieg hängt an drei fremden Bootstrap-Knoten von hyperdht.org (`node_modules/hyperdht/lib/constants.js:17-21`).
- Die Helfersuche ist gegen Sybil-Einträge offen. Ein DHT-Knoten liefert höchstens 20 Einträge je Topic (`persistent.js:32`); der Lookup nimmt die ersten 8 in Ankunftsreihenfolge (`direct-service.ts:304-306`). Jeder Helfer, bei dem sich ein Host registriert, kennt dessen Session-Topic. Mit etwa 12 Scheinschlüsseln (4 Kandidaten × 3 Versuche, je 8 s) kann er den Helferweg dieser Session blockieren.
- Wer die URL ohne PIN kennt, kann die 8 Auth-Slots belegen (`session.ts:16`, `:105`) und so Beitritte blockieren.
- Ohne UDP und ohne erreichbares Gateway gibt es keinen Weg. Zwei symmetrische NATs brauchen einen tatsächlich erreichbaren Dritten.
- Helfer sehen IP-Adressen, Zeitpunkte, Topics und Datenmengen.

## Unbelegt
Bestandene lokale Tests sind keine Produktionsfreigabe. Nicht belegt sind:
- Verhalten hinter echtem NAT, CGNAT oder Proxy sowie die realen Zeitbudgets (4 s, 8 s, 20 s).
- Discovery im öffentlichen DHT und die Existenz einer Helferflotte.
- Die Firewall-Reihenfolge habe ich nur am installierten Quelltext nachvollzogen (`node_modules/hyperdht/lib/server.js:270` vor `:429`), nicht ausgeführt. Ressourcen vor dem Hook (Upstream #296) bleiben offen.
- Das tatsächliche Speicherverhalten von UDX unter Rückstau.
- Konvergenz bei Dokumenten nahe 4 MiB und bei mehreren gleichzeitigen Beitritten.

## Codex-Gegenprüfung und Korrekturen

Der Originalbericht ist oben unverändert erhalten. Codex hat die Befunde gegen den Arbeitsstand geprüft und die folgenden Änderungen selbst umgesetzt; Fable hat keinen Code geschrieben und keine Tests ausgeführt.

| Fable-Befund | Gegenprüfung und Entscheidung |
| --- | --- |
| 1: gültige große Dokumente / stiller Sendefehler | Unabhängig mit 4.526.689 Yjs-Bytes reproduziert. Auf zusätzliche Nutzeranweisung vollständiger Transfer für Bilder, Seiten, Notizen und übrige Elemente statt bloßer 4-MiB-Abweisung: versionierte 48-KiB-Chunks, exakte Yjs-IDs, SHA-256, Zeit-/Gesamtbudgets, validierter Snapshotimport. Normale Delta-Schranke bleibt 4 MiB. Sendefehler werden sichtbar. #151. |
| 2: Kontrollframe bei normalem Rückstau | Neue Regressionen waren vor dem Fix rot. Nach Join gilt auch für Kontrollen das normale Zielbudget. 200 KiB Rückstau führen nicht allein zum Verbindungsabbruch. |
| 3: gemeinsames Speicherbudget | Vor jedem Daten-/Kontrollsend wird das gemeinsame Adapterpufferbudget von 64 MiB einschließlich Framingreserve geprüft. 12 MiB je Ziel bleiben erhalten. Keine Zusage für gesamten RSS-/UDX-/Kernelverbrauch. |
| 4a: Direktversuch nach vier Sekunden beendet | Standardfrist auf die bereits begrenzte gemeinsame Verbindungsfrist vereinheitlicht; sekundäre Wege starten weiterhin parallel verzögert. Kontrolliert verzögerter Direktweg geprüft. |
| 4b: vorzeitig kopierter Link ohne Direktkey | Das pauschale Warten würde den bereits getesteten Gatewayweg bei blockiertem UDP unzugänglich machen. Stattdessen während Native-Start zunächst Vorbereitung anzeigen; Relay-Link nur über ausdrückliche Aktion freigeben. Sobald der Direktkey vorhanden ist, vollständigen Link zeigen. |
| 5: PIN-Sperre und unbegrenztes Flattern | Nur bereits authentifizierte Gäste warten bei vorübergehendem PIN_LOCKED begrenzt erneut; PIN-Erneuerung/endgültige Sperren werden nicht umgangen. Fehlerbudget erst nach 30 Sekunden stabiler Verbindung zurücksetzen. Vorher-Nachher-Regressionen bestätigt. |
| R31: Native-Abbau vor Streamabschluss | Bereits geschlossene native Streams bleiben bis Close oder maximal einer Sekunde vor Node-Abbau berücksichtigt. Fokussierter Test bestätigt, dass hostStop das Fenster nicht sofort abbricht. Das ist kein Remote-ACK und keine Garantie bei Paketverlust. |

### Weitere unabhängige Prüfungen des neuen Großtransfers

Das separate Codex-Review fand und reproduzierte drei Fehler im ersten Entwurf: Pufferfreigabe während noch laufender Hashprüfung; inkrementeller Wechsel der Dokument-ID; Abbruch während blockiertem Send. Root korrigierte sie und ergänzte Regressionen. Alle drei Originalreproduktionen bestehen nach Korrektur. Ein weiterer Mehrpeer-Test fand den Viewer-Reconnect-Fehler: Host fragte den Viewer nach Updates, dessen Rollenprüfung die Antwort zu Recht ablehnte. Host/Viewer senden jetzt keine unzulässigen Antworten; Warteschlangen prüfen die konkrete Verbindungsgeneration und duplizieren bei Teilfehlern keine Chunks an gesunde Empfänger.

Bestätigt: unabhängiger gültiger 4.526.550-Byte-Zustand wird in 93 Frames bytegleich übertragen, nachfolgender normaler Delta konvergiert. Alter 4-MiB-Import und Viewer-Schutz bleiben wirksam. Browser: 10 HDHT-Fälle einschließlich gültigem großem Dokument und Folgeänderung bestanden. Echter nativer Großbildtest: vollständiger Mehrseiteninhalt und zweites, vom Gast eingefügtes PNG bytegleich beim Host; Annotationen, Kommentare, Aufgaben und Notizen Bestandteil des geprüften Dokuments. Abschließende Nachweise: 751 Unit-, 10 Browser- und 7 Electron-Tests bestanden; neues macOS-arm64-Paket samt Sandbox/MCP und 8-MiB-Nativübertragung bestanden. Quell-/Paket-Hashes und Grenzen stehen in `149-local-validation.json` und `codex-149-validation.md`.

### Weiterhin offene Grenzen

Kein `relayThrough`-/`blind-relay`-Wechsel. Keine erfundene Relay-Flotte oder garantierte Verbindung bei vollständig blockiertem UDP ohne erreichbaren anderen Transportweg. Öffentliche Discovery ist weiter Sybil-anfällig; Auth-Slots und Erreichbarkeit geeigneter Helfer bleiben Verfügbarkeitsgrenzen. Bootstrapknoten sind externe Infrastruktur der Bibliothek. Reale NAT-, CGNAT-, Proxy-, Skalierungs- und Paketverlustprüfungen bleiben in #72 offen. Behauptete Kapazitäten nicht als geprüfte Anbieterzusagen behandeln. Alle Produktänderungen sind lokal auf `codex/149-hyperdht-relay`, noch nicht integriert oder veröffentlicht.

Fables weitere Engineering-Hinweise zur dauerhaften Helfersuche, Eignung und tatsächlichen Weiterleitung sind als geplanter Folgeauftrag [#152](https://github.com/J-ARTS/de.sketchdraw.io/issues/152) erfasst. Sie sind keine erledigten Fixes dieses Laufs.

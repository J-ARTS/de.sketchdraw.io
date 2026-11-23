# ADR 0011 — Cloudflare TURN als dritter Verbindungsweg: erprobt und verworfen

Status: **verworfen und ausgebaut** ([#303](https://github.com/J-ARTS/de.sketchdraw.io/issues/303)). Der Owner hat den Weg am 23.11.2026 selbst erprobt und noch am selben Tag entschieden: **Der Worker-Relay ([ADR 0010](0010-session-route-cloudflare-relay.md)) bleibt, TURN und der WebRTC-Datenkanal werden entfernt.** Seine Rückmeldung dazu: „Der Relay-Server als Worker funktioniert, wie er soll.“ Messwerte seiner Erprobung liegen diesem Dokument nicht vor.

Der Rest hält fest, was erprobt wurde, damit die Frage nicht ohne dieses Wissen neu gestellt wird. Der Code stand von `6e975a4` bis zum Ausbau auf `main`.

## Was beim Ausbau entfernt wurde

`src/collaboration/hdht/turn-channel.ts`, das Feld `c` der Einladung, `turn`/`rtc` in `session.ts`, `acceptGuest`/`requestIce`/`openRelayGuestWire` in `relay-wire.ts`, die Route `turn` in `cloud-relay.ts` und im Panel, der Kontrolltext `ice` im Hub, `generateIceServers` im Worker, die Option `iceServers` des Node-Relays sowie die zugehörigen Tests. Geblieben sind die vorausgefüllte Relay-Adresse und die Feldhöhe aus demselben Commit.

Beim Betreiber aufzuräumen: die Worker-Secrets `TURN_KEY_ID` und `TURN_KEY_API_TOKEN`, der TURN-Schlüssel im Cloudflare-Konto, danach den Worker neu bereitstellen – der zuletzt bereitgestellte Stand gibt sonst weiter TURN-Zugangsdaten aus.

## Beobachtungen aus der Erprobung

- Die Einrichtung war fehleranfällig: Cloudflare verlangt das Token des TURN-Schlüssels selbst (`secret`, 64 Zeichen), nicht ein allgemeines API-Token; falsche Werte zeigen sich erst als `404` (unbekannte Schlüssel-ID) oder `401` (falsches Token).
- TURN ersetzt den Worker nicht: Für Zugangsdaten und für das Aushandeln des Datenkanals braucht es ihn weiterhin. Der Weg bringt also einen zweiten Dienst, ohne den ersten zu sparen.
- Der Worker-Relay lief im selben Zeitraum im Cloudflare-Netz mit drei Gästen (siehe #302).

## Anlass

Der Worker-Relay (ADR 0010) ist bereitgestellt. Sein kostenloses Kontingent zählt Anfragen und Laufzeit (100.000 Anfragen, 13.000 GB-s je Tag). Cloudflares TURN-Dienst zählt dagegen Datenmenge: 1.000 GB je Monat frei, danach 0,05 $ je GB. Offen ist, welcher Weg hinter einem Unternehmens-Proxy zuverlässig zustande kommt und welcher im Betrieb günstiger ist. Das lässt sich nur im echten Netz klären.

## Was erprobt wurde

- **Dritter Verbindungsweg „Cloudflare TURN“** in der Auswahl. Die Einladung trägt den Träger (`c: "turn"`), Gäste stellen nichts ein.
- **Der Worker bleibt Treffpunkt.** Gastgeber und Gast handeln über den Raum einen WebRTC-Datenkanal aus (Angebot, Antwort, ICE-Kandidaten). Danach verlässt der Gast den Raum; die Sitzungsdaten laufen über TURN.
- **Ausschließlich TURN:** `iceTransportPolicy: 'relay'`. So ist eindeutig, was gemessen wird, und kein Gerät erfährt die Netzwerkadresse eines anderen.
- **Zugangsdaten:** Der TURN-Schlüssel liegt als Secret im Worker. Der Raum gibt befristete Zugangsdaten (14 h) nur über eine Raumverbindung aus.
- **Gleiche Sicherheit:** Auf dem Datenkanal läuft derselbe Ende-zu-Ende-Handshake wie auf jedem Träger. WebRTCs eigene Verschlüsselung ist nicht Teil des Vertrauensmodells.

## Risiken der Erprobung

- **Kosten:** Wer das Protokoll spricht, kann sich als Gastgeber registrieren und TURN-Zugangsdaten holen. Verbrauch läuft auf das Konto des Betreibers. Für die Erprobung hingenommen; für den Dauerbetrieb braucht es eine Begrenzung.
- **Proxy:** TURN über TLS auf 443 ist kein HTTP. Ob Chromium/Electron es durch den jeweiligen Proxy tunnelt, ist genau die offene Frage.
- **Alte Versionen:** Apps vor diesem Stand lehnen TURN-Links als ungültig ab.
- **Zwei Wege zugleich** bedeuten doppelte Pflege, bis entschieden ist.

## Nicht nachgewiesen

Keine Verbindung in den automatischen Tests lief über `turn.cloudflare.com`. Geprüft waren die Vermittlung über den Raum (auch in der Workers-Laufzeit, mit einem Ersatz für Cloudflares API), der Handshake auf dem Datenkanal und echtes WebRTC im Browser ohne TURN-Server. Den Vergleich im echten Netz hat der Owner selbst vorgenommen.

# ADR 0011 — Erprobung: Cloudflare TURN als dritter Verbindungsweg

Status: **Erprobung** ([#303](https://github.com/J-ARTS/de.sketchdraw.io/issues/303)), Nutzerentscheidung vom 23.11.2026. Ergänzt [ADR 0010](0010-session-route-cloudflare-relay.md). **Nach dem Vergleich wird einer der beiden Cloudflare-Wege wieder ausgebaut** – diese Entscheidung steht aus und gehört dem Owner.

## Anlass

Der Worker-Relay (ADR 0010) ist bereitgestellt. Sein kostenloses Kontingent zählt Anfragen und Laufzeit (100.000 Anfragen, 13.000 GB-s je Tag). Cloudflares TURN-Dienst zählt dagegen Datenmenge: 1.000 GB je Monat frei, danach 0,05 $ je GB. Offen ist, welcher Weg hinter einem Unternehmens-Proxy zuverlässig zustande kommt und welcher im Betrieb günstiger ist. Das lässt sich nur im echten Netz klären.

## Was erprobt wird

- **Dritter Verbindungsweg „Cloudflare TURN“** in der Auswahl. Die Einladung trägt den Träger (`c: "turn"`), Gäste stellen nichts ein.
- **Der Worker bleibt Treffpunkt.** Gastgeber und Gast handeln über den Raum einen WebRTC-Datenkanal aus (Angebot, Antwort, ICE-Kandidaten). Danach verlässt der Gast den Raum; die Sitzungsdaten laufen über TURN.
- **Ausschließlich TURN:** `iceTransportPolicy: 'relay'`. So ist eindeutig, was gemessen wird, und kein Gerät erfährt die Netzwerkadresse eines anderen.
- **Zugangsdaten:** Der TURN-Schlüssel liegt als Secret im Worker. Der Raum gibt befristete Zugangsdaten (14 h) nur über eine Raumverbindung aus.
- **Gleiche Sicherheit:** Auf dem Datenkanal läuft derselbe Ende-zu-Ende-Handshake wie auf jedem Träger. WebRTCs eigene Verschlüsselung ist nicht Teil des Vertrauensmodells.

## Auffindbarkeit für den Ausbau

Alles, was nur zum TURN-Weg gehört, trägt die Marke `POC(#303)`:

- `src/collaboration/hdht/turn-channel.ts` (ganz), Feld `carrier` in `invitation.ts`, `turn`/`rtc` in `session.ts`, `acceptGuest`/`requestIce`/`openRelayGuestWire` in `relay-wire.ts`, Route `turn` in `cloud-relay.ts` und `HdhtSession.vue`.
- `relay/hub.mjs` (`iceServers`, Kontrolltext `ice`), `relay/cloudflare/src/room.mjs` (`generateIceServers`), `relay/server.mjs` (Option `iceServers`).
- Tests `turn-channel.spec.ts`, `tests/ui/session-turn.spec.ts`, ein Test in `cloudflare-worker.spec.ts`.

**Bleibt TURN**, schrumpft der Worker auf Vermittlung und Zugangsdaten: Der Relay-Träger (`connectRelayGuest` als Sitzungsweg, Route `cloud`) entfällt, die Raumgrenzen können auf wenige Kilobyte je Gast sinken. **Bleibt der Worker-Relay**, entfallen die markierten Stellen.

## Risiken der Erprobung

- **Kosten:** Wer das Protokoll spricht, kann sich als Gastgeber registrieren und TURN-Zugangsdaten holen. Verbrauch läuft auf das Konto des Betreibers. Für die Erprobung hingenommen; für den Dauerbetrieb braucht es eine Begrenzung.
- **Proxy:** TURN über TLS auf 443 ist kein HTTP. Ob Chromium/Electron es durch den jeweiligen Proxy tunnelt, ist genau die offene Frage.
- **Alte Versionen:** Apps vor diesem Stand lehnen TURN-Links als ungültig ab.
- **Zwei Wege zugleich** bedeuten doppelte Pflege, bis entschieden ist.

## Nicht nachgewiesen

Keine Verbindung in den Tests lief über `turn.cloudflare.com`. Geprüft sind die Vermittlung über den Raum (auch in der Workers-Laufzeit, mit einem Ersatz für Cloudflares API), der Handshake auf dem Datenkanal und echtes WebRTC im Browser ohne TURN-Server. Der Vergleich im Firmennetz ist Sache des Owners; Messpunkte stehen in `relay/cloudflare/README.md`.

> Codex-Hinweis zum tatsächlichen Status (11.11.2026): Dieser von Claude begonnene Bericht beschreibt den frühen Entwurf. Sonnet5.5/high wurde später mit nativen Community-Helfern fortgesetzt, endete aber durch API429 vor vollständiger Abnahme. Aussagen zu UI, Gastautorität und Nachweisen hier sind kein abschließender Iststand. Maßgeblich für den final geprüften Stand sind `codex-149-validation.md` und `149-decentralized-relay-decision.md`; dort sind spätere Codex-Fixes und das zusätzliche Fable5.2-Sparring getrennt dokumentiert.

# Issue #149 – HyperDHT + Relay (Claude-Code-Umsetzung)

Werkzeug: Claude Code, Modell `claude-sonnet-5-5`, Aufwand `high`. GitHub, Ledger, Graphify, Commits und PR liegen bei Codex. Dieser Bericht beginnt mit dem Architekturentwurf (vor der Implementierung) und endet mit den tatsächlichen Prüfnachweisen (Abschnitt „Nachweise“).

## 1. Ziel und Abgrenzung

Ablauf „Link einfügen, PIN eingeben, verbunden“ ohne Routerkonfiguration. Der Nutzer hat für diesen Modus Relay-Infrastruktur ausdrücklich erlaubt; das ersetzt den „strict no relay“-Wortlaut in AGENTS/CLAUDE nur für den neuen Modus. Der bisherige Trystero-Modus und der manuelle Strict-Modus bleiben unverändert verfügbar.

Es wird **kein** produktiver Relay-Endpunkt mitgeliefert oder behauptet. Geliefert werden ein lauffähiger, selbst zu betreibender Relay (`relay/`), ein konfigurierbarer Endpunkt in der Oberfläche und eine Betriebsanleitung. Es wird nicht versprochen, dass jede Firewall/jeder Proxy funktioniert.

## 2. Transporte

| Route | Wer | Ort | Zweck |
| --- | --- | --- | --- |
| Direkt (HyperDHT, Noise-Secret-Stream) | nur Electron | Main-Prozess (`electron/direct-service.ts`) | Hole-Punching, kein Relay-Datenpfad |
| Relay (WebSocket, eigener E2E-Kanal) | Electron-Renderer und Browser | Renderer (Chromium-Netzwerkstack, nutzt Proxy/PAC) | Fallback, wenn UDP/Hole-Punching scheitert |

- Topologie: **Stern**. Der Gastgeber (Dokumentautorität) hält je Gast einen Kanal; Gäste sehen nur den Gastgeber. Aktualisierungen eines Gasts verteilt der Gastgeber über die vorhandene `excludePeerId`-Logik von `bindCrdtTransport` an die übrigen. Teilnehmerlimit wie bisher 25 (inkl. Gastgeber).
- Der Gast startet **direkt zuerst**; nach 1,5 s (oder sofort bei Fehlschlag) startet parallel die Relay-Route. Der erste fertige, authentisierte Kanal gewinnt, der andere wird geschlossen. Direktversuch endet nach 4 s. Kein Warten auf unerreichbare DHT-Bootstrap-Knoten.
- Der Gastgeber lauscht auf beiden Routen gleichzeitig (DHT-Server im Main, Relay-Registrierung im Renderer). Nur Direkt, nur Relay oder beides ist möglich; Browser-Gastgeber nutzen nur Relay.
- Native Module (`hyperdht`, `sodium-native`, `udx-native`) laufen ausschließlich im Main. Der Renderer erhält über eine eng gefasste, validierte IPC-Schnittstelle (`direct:invoke` / `direct:event`) nur opake, bereits Ende-zu-Ende gesicherte Frames.
- Der Relay (`relay/server.mjs`, `ws`) leitet nur verschlüsselte Datensätze weiter, hält Zustand ausschließlich im Speicher und kennt weder Dokument noch PIN.

## 3. Link und Authentisierung

Link: `https://<web-app>/#sketchdraw-hdht=<base64url(JSON)>` mit `{ v, s: Session-ID (32 Byte hex), h: Ed25519-Hostschlüssel (Relay-Kanal), d: HyperDHT-Public-Key (Direktkanal), r: Relay-URL?, i: Dokument-ID, e: Ablauf }`. Das Fragment verlässt den Browser nie in Richtung Server. **Die PIN steht nicht im Link**, nicht in Logs, Fehlern oder im Relay.

- **Gastgeber-Authentizität:**
  - Direkt: HyperDHT verbindet per Noise gegen den gepinnten Public Key (`dk`); zusätzlich wird `remotePublicKey` geprüft.
  - Relay: Ephemeral-X25519-ECDH, der Gastgeber signiert das Transkript (Label, Session-ID, beide ephemeren Schlüssel, beide Nonces) mit dem gepinnten Ed25519-Schlüssel `hk`. Schlüssel per HKDF-SHA-256 (Salt = Transkripthash), getrennte AES-256-GCM-Schlüssel je Richtung, Zähler-Nonces, strikte Reihenfolge (Verlust/Replay/Reorder bricht den Kanal ab). Ein Relay kann den Gastgeber nicht imitieren und nichts mitlesen.
- **PIN:** 6 Ziffern (CSPRNG), erst nach Aufbau des authentisierten, verschlüsselten Kanals gesendet – als `HMAC-SHA-256(PIN, Label ‖ Channel-Binding ‖ Session-ID)`. Es gibt keine PIN-abgeleiteten Schlüssel und damit kein Offline-Wörterbuch-Orakel. Der Gastgeber begrenzt Fehlversuche **pro PIN-Generation und unabhängig von der Gast-Identität**: ab 5 Fehlversuchen Sperrzeit mit Verdopplung, nach 20 Fehlversuchen ist die PIN endgültig verbraucht („PIN erneuern“). Versuche werden vor der Prüfung reserviert (kein paralleles Raten).
- **Rolle:** Der Gastgeber vergibt die Rolle (`viewer`/`editor`) aus seiner eigenen Konfiguration und teilt sie in `AUTH_OK` mit; kein Self-Claim des Gasts. Viewer-`update`/`asset` werden am Gastgeber verworfen (Kanal wird geschlossen) und vom Gast-Transport nicht gesendet; zusätzlich ist das adoptierte Dokument lokal schreibgeschützt.
- **Frischer Kanal pro Verbindung:** Jeder (Wieder-)Aufbau macht neuen Schlüsselaustausch mit neuen ephemeren Schlüsseln; die PIN-Antwort ist an den Kanal gebunden und daher nicht wiederverwendbar.

## 4. Lebenszyklus

- **Verbunden** erst nach: Kanal → Host-Authentisierung → PIN akzeptiert (`AUTH_OK`) → Dokument-Bootstrap (`bootstrapRoomDocument` + `adoptRoom`). Der Transport meldet `ready` nach `AUTH_OK`; die Oberfläche zeigt „Verbunden“ erst nach der Dokumentübernahme.
- Heartbeat: PING alle 10 s, Abbruch nach 30 s ohne eingehende Daten. Authentisierungs-/Handshake-Timeouts 10 s.
- Reconnect (Gast): exponentieller Backoff 0,5–8 s mit Jitter; 3 Versuche vor der ersten Verbindung, 8 danach; dann Zustand `error`. Endgültige Fehler (falsche/gesperrte PIN, Schlüsselabweichung, Session beendet) werden nicht wiederholt. Gastgeber-Relay-Registrierung wird mit gedeckeltem Backoff (max. 30 s) erneuert, solange die Session läuft. Nach Wiederverbindung gleicht `bindCrdtTransport` per State-Vector ab.
- Aufräumen: Session beenden, Dokumentwechsel (Autoritätswechsel im Panel), Panel-Unmount und Fensterzerstörung/Navigation (Main) schließen alle Timer, WebSockets, Streams und den DHT-Knoten.
- Limits: Nachrichten (sync 256 KiB, update 4 MiB, awareness 64 KiB, asset 8 MiB), WS-Datensatz 64 KiB, ausgehende Warteschlange 16 MiB, Relay: Frame, Rate, Verbindungen je Topic/IP/gesamt, Timeouts, Backpressure.

## 5. Integration

- `CollaborationTransport` bleibt die Schnittstelle zu `bindCrdtTransport`/`bootstrapRoomDocument`; `mode` wird um `hyperdht-relay` erweitert (additiv: `route`, Zustand `reconnecting`).
- `CollaborationPanel.vue`: Modus „Direkt + Relay“ (Standard, wenn Direktbrücke oder Relay-URL vorhanden), Legacy-Modus über „Netzwerk“ weiterhin wählbar; Gast: Link + PIN, Fortschritt, Abbrechen, Wiederholen. Relay-Endpunkt in „Netzwerk“ (lokal gespeichert). Autoritätswechsel beendet die Session (bestehende Generation/Adoption-Schutzlogik bleibt).
- `whiteboard.ts`: `adoptRoomDocument(controller, { readOnly })` setzt für Viewer eine Schreibsperre (`canWrite`).

## 6. Risiken / Restlücken (Vorab)

- HyperDHT-Issue #296 (relayThrough/Probe-Fanout): kein generischer DHT-Proxy; `relayThrough` wird nicht genutzt. Rest-Risiko der Abhängigkeit bleibt.
- `@hyperswarm/dht-relay` ist laut Projekt „DO NOT USE IN PRODUCTION“ und wird nicht verwendet; der Relay ist ein eigener, begrenzter Weiterleiter.
- WebCrypto Ed25519/X25519 benötigt aktuelle Browser (Chromium ≥ 137, Firefox ≥ 130, Safari ≥ 17); sonst klare Fehlermeldung statt stiller Degradierung.
- Der Gastgeber ist Single Point of Truth (Stern); fällt er aus, endet die Session. Metadaten (IP, Zeitpunkt, Topic-Hash, Datenmenge) sieht der Relay-Betreiber.
- Link-Inhaber (ohne PIN) können PIN-Sperren auslösen (Verfügbarkeit, nicht Vertraulichkeit); Abhilfe: „PIN erneuern“.
- Loopback-Test beweist keine Multi-Netzwerk-/NAT-/Proxy-/Plattformfähigkeit; #72 bleibt offen.

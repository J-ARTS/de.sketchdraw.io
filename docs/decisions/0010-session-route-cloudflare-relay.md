# ADR 0010 — Verbindungsweg einer Session wählbar: direkt (P2P) oder Cloudflare-Relay

Status: angenommen und umgesetzt ([#300](https://github.com/J-ARTS/de.sketchdraw.io/issues/300)). Nutzerentscheidung vom 23.11.2026. Ändert Punkt 4 von [ADR 0007](0007-app-link-and-session-relay-helper.md) („nur noch ein Verbindungsweg in der Oberfläche“) und die dortige Folge „es gibt dafür keinen Produktweg mehr“.

## Anlass

Der direkte Weg (HyperDHT über UDP, sonst freiwillige Helfer) kommt nicht in jedem Netz zustande: Ist UDP gesperrt – in vielen Firmennetzen der Normalfall –, entsteht keine Verbindung (`docs/concerns.md` C-001, HD-01). Der Owner will deshalb beim Start einer Session wählen können, ob die Geräte sich direkt oder über einen Relay bei Cloudflare verbinden; mehrere Personen müssen derselben Session beitreten können.

## Entscheidung

1. **Auswahl beim Gastgeber.** Das Panel „Zusammenarbeiten“ bietet vor „Session starten“ den Verbindungsweg **„Direkt (P2P)“** (Voreinstellung, unverändert) oder **„Cloudflare-Relay“**. Die Wahl und die Relay-Adresse bleiben auf dem Gerät gespeichert.
2. **Relay-Weg ist ausschließlich.** Mit „Cloudflare-Relay“ öffnet jedes Gerät eine WebSocket-Verbindung (Port 443) zum Relay. Es startet kein DHT-Knoten, kein direkter Listener und kein Relay-Helfer dieses Geräts. Die Einladung trägt den Raum des Relays (Feld `r`) und keinen Direktschlüssel (`d` leer); ein Gast erkennt daran den Weg und folgt ihm, ohne etwas einzustellen. Kein stiller Wechsel zwischen den Wegen: Wer P2P wählt, benutzt keinen Server; wer den Relay wählt, weiß, wohin die Verbindung geht.
3. **Derselbe Kanal, derselbe Hub.** Der Relay spricht das vorhandene Protokoll `sketchdraw-relay.v1` und benutzt den vorhandenen Hub (`relay/hub.mjs`). Die Ende-zu-Ende-Verschlüsselung, das Pinning des Gastgeberschlüssels, der PIN-Nachweis im Kanal und alle Grenzen sind die des Helfer-Wegs. Der Relay sieht IP-Adressen, Zeitpunkte, den Topic und Datenmengen – nie PIN, Schlüssel oder Inhalt.
4. **Ein Raum je Session.** Die Adresse eines Raums ist `<Relay>/v1/<topic>`. Bei Cloudflare ist jeder Raum ein eigenes Durable Object, das nur seinen Topic annimmt (`acceptTopic` im Hub). Das selbst betriebene Relay (`relay/server.mjs`) nimmt dieselbe Adressform an; die Einstellung in der App heißt nach dem vorgesehenen Betrieb „Cloudflare-Relay“, funktioniert aber mit jedem Relay dieses Protokolls.
5. **Keine Zugangsdaten in der App, kein mitgelieferter Endpunkt.** Der Worker braucht kein Geheimnis. Die App kennt nur eine Adresse: die vom Nutzer eingetragene oder `DEFAULT_CLOUD_RELAY_URL` (heute leer). Den Worker stellt der Betreiber selbst bereit (`relay/cloudflare/README.md`).
6. **Sichtbarkeit.** Der Einleitungstext nennt, was der Relay sieht. Ein Gast sieht vor dem Beitritt, über welchen Relay ein Link verbindet; Gastgeber und Gast sehen den Relay während der Session. Ist der Relay nicht erreichbar, sagt die App das und versucht es weiter.

## Verworfen

- **TURN (Cloudflare Realtime) für WebRTC.** Braucht kurzlebige Zugangsdaten, die ein Dienst ausstellen muss, und den WebRTC-Weg, den ADR 0007 aus der Oberfläche genommen hat. Mehr Teile, gleiche Metadaten beim Betreiber.
- **Relay als stiller Rückfall hinter P2P.** Wäre robuster, widerspricht aber der Vorgabe, dass ohne ausdrückliche Wahl kein Server beteiligt ist. Ein dritter Weg „Automatisch“ bleibt möglich.
- **Ein gemeinsames Durable Object für alle Sessions.** Ein einzelner Ort für alle Verbindungen der Welt; ein Raum je Session liegt dagegen dort, wo sein Gastgeber ist, und endet mit ihm.
- **WebSocket-Hibernation.** Der Hub hält Zustand, Zeitgeber und Ratenbegrenzung im Speicher, und die Teilnehmenden senden alle 10 Sekunden einen Herzschlag – ein Raum käme während einer Session ohnehin nicht zur Ruhe. Der geprüfte Hub wurde deshalb nicht für die Hibernation umgeschrieben.

## Folgen und Grenzen

- **Abweichung vom Zielbild.** Die Vision nennt „ohne … Signaling- oder Relay-Server“. Der direkte Weg bleibt so und bleibt Voreinstellung; der Relay-Weg ist eine ausdrückliche Wahl je Session. Das Zielbild in `CLAUDE.md`/`AGENTS.md` sollte diese Wahl nennen (Entscheidung des Owners, nicht Teil dieses Tickets).
- **Metadaten.** Beim Relay-Weg sehen Cloudflare und der Betreiber des Workers IP-Adressen, Zeitpunkte, Topic und Datenmengen. Ein Link kann einen beliebigen Relay nennen; ein Gast, der ihm folgt, zeigt diesem Relay seine IP-Adresse. Die App nennt den Relay deshalb vor dem Beitritt.
- **Kontingente.** Im kostenlosen Tarif begrenzen 100.000 Anfragen und 13.000 GB-s je Tag den Betrieb über alle Sessions; danach endet der Dienst für den Tag. Zahlen und Quellen in `relay/cloudflare/README.md`.
- **Offener Relay.** Jeder, der das Protokoll spricht, kann einen Raum eröffnen. Die Grenzen des Hubs begrenzen den Verbrauch je Verbindung, ersetzen aber keine Zugangskontrolle.
- **Wartender Gastgeber.** Ein Worker kann von sich aus keine WebSocket-Pings senden. Ein Gastgeber ohne Gäste sendet deshalb alle 20 Sekunden ein `ping` über die WebSocket-Registrierung, sonst trennt ihn der Hub nach 60 Sekunden Leerlauf.
- **Browser.** Der Relay-Weg braucht kein natives HyperDHT; die Browser-Fassung kann darüber Sessions starten und beitreten. Session-Links öffnen weiterhin die Desktop-App (`sketchdraw://join`).
- **Nicht nachgewiesen:** Betrieb im echten Cloudflare-Netz, Firmen-Proxys mit TLS-Inspektion oder WebSocket-Sperre, Verhalten bei erschöpftem Kontingent. Geprüft ist die echte Workers-Laufzeit (workerd) lokal.

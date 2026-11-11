# #149 — Dezentrale Discovery und Peer-Relays

Stand: 11.11.2026, Architekturentscheidung nach Nutzerkorrektur um 19:46. Im Arbeitsbranch lokal implementiert, abschließende Integration noch ausstehend; lokale Transportprüfungen sind kein Nachweis eines existierenden öffentlichen Relay-Netzes.

## Nutzerziel

Kein eigener fester Relay-Server und keine Domain als Voraussetzung. HyperDHT für dezentrale Discovery; geeignete freiwillige Teilnehmer sollen verschlüsselte Nutzdaten für andere vermitteln. URL + separate PIN bleibt der sichtbare Beitritt. Keine Routerkonfiguration auf normalen Teilnehmergeräten.

## Verifizierte Grenzen und Quellen

- HyperDHT `lookup`/`announce` entdeckt Public Keys dezentral über UDP. DHT-Handshakerelays stellen nicht automatisch eine Nutzdaten-Relay-Flotte bereit: https://github.com/holepunchto/hyperdht#additional-peer-discovery
- Native `relayThrough`/`blind-relay` kann tatsächliche verschlüsselte UDX-Nutzdaten über einen dritten erreichbaren Peer vermitteln. Beide Enden müssen ihn über HyperDHT/UDX erreichen: https://github.com/holepunchto/blind-relay und https://docs.pears.com/p2p/how-to/connect-to-peers/relay-connections-through-a-blind-relay/
- Offizielle Beschreibung nennt andere Teilnehmer als mögliche Relays, etwa bei Keet: https://docs.pears.com/p2p/how-to/connect-to-peers/connect-two-peers-by-key-with-hyperdht/
- Ein vollständig UDP-blockierter Teilnehmer erreicht auch die native DHT nicht. Ein TCP/WSS-Einstieg muss deshalb zunächst über Einladung, Cache oder bekannte unabhängige Einstiegspunkte erreichbar sein. Das folgt aus dem Transport; es ist kein externer Proxy-Feldtest.
- `@hyperswarm/dht-relay` ist seit 15.10.2026 archiviert; README warnt vor Produktionseinsatz: https://github.com/holepunchto/hyperswarm-dht-relay
- libp2p Circuit Relay v2 unterstützt WSS/Browser, verlangt aber tatsächlich erreichbare Betreiber und Kapazität. Standardlimits 2 Minuten/128 KiB sind kein ausreichendes dauerhaftes Whiteboard-/Assetbudget: https://github.com/libp2p/js-libp2p/blob/main/packages/transport-circuit-relay-v2/src/constants.ts
- Nostr bietet unabhängige öffentliche WSS-Relays. Ephemeral Events können verworfen, begrenzt oder abgelehnt werden; Relay-OK ist keine Empfangsbestätigung. Für unseren geordneten Recordkanal wären zusätzliche ACK-/Retry-/Reorder-/Dedupe-/Fragmentierungsmechanismen nötig. Deshalb kein ungeprüfter transparenter Bytekanalersatz: https://github.com/nostr-protocol/nips/blob/master/01.md und https://github.com/nostr-protocol/nips/blob/master/11.md
- Trystero-Nostr ist Discovery/Signaling; Anwendungsdaten bleiben WebRTC, kein automatischer Nutzdatenfallback: https://trystero.dev/docs/signaling-strategies/

## Entscheidung für die laufende Implementierung

1. HyperDHT + Yjs + vorhandene PIN-/Host-/Rollenprüfungen beibehalten.
2. Native Desktop-Peers können ausdrücklich Relay-Unterstützung aktivieren. Standard aus; keine heimliche fremde Bandbreitennutzung.
3. Relay-Angebote automatisch über einen versionierten DHT-Service-Topic entdecken, mit Zeit-/Kandidaten-/Kapazitätsgrenzen prüfen. Keine zentrale Registry und kein fest codierter Produktserver.
4. Gastgeber registrieren sich redundant bei geeigneten Relay-Peers; Gäste finden den für die Session erreichbaren Weg über DHT beziehungsweise begrenzte Einladungshinweise. Ausfälle führen zu begrenzter Neuauswahl/Wiederverbindung und erneutem Yjs-Abgleich.
5. Der Native-Relay-Peer leitet ausschließlich den bereits hostauthentisierten, Ende-zu-Ende verschlüsselten Datenkanal weiter. Kein Klartext/PIN/Dokumentzustand beim Helfer. Für die Weiterleitung bevorzugt die vorhandene begrenzte Relay-Logik transportneutral wiederverwenden; keine unlimitierte fremde Proxy-Funktion einführen.
6. Bestehender WSS-Adapter bleibt optional für unabhängig betriebene Gateways und Browser/UDP-Sperren. Er ist keine Voraussetzung für native Discovery oder native Peer-Relays. Kein erfundener öffentlicher Endpunkt, kein stiller Ersatz durch MQTT-/Nostr-Datenverkehr.
7. Keine Relay-Peers und keine direkte Verbindung ergeben eine ehrliche begrenzte Fehlermeldung. Zwei gegenseitig unerreichbare Geräte erzeugen aus sich heraus keinen dritten Transportweg.

## Erforderliche Nachweise

- Isoliertes echtes DHT-Netz: Relay-Angebot erscheint/verschwindet, Lookup findet tatsächliche Helfer ohne manuelle Endpoint-Eingabe.
- Host und Gast verbinden sich über einen dritten Peer; PIN, Host-Bindung, Rollen und bidirektionales Yjs funktionieren bei gezielt unterbundenem direkten Weg.
- Zwei unabhängige Relay-Peers: Ausfall des ersten und Wiederverbindung über den zweiten mit Dokumentabgleich.
- Kein Relay verfügbar, falsche Angebote, Grenzwerte, Abbruch und vollständiges Aufräumen; Relay nur nach ausdrücklichem Aktivieren.
- Bestehende R1–R18 korrigieren und erneut prüfen; UI-/Electron-/Build-/Paketabnahme weiterhin erforderlich.

Externe NAT-/Proxy-Netze und eine tatsächlich existierende öffentliche Community-Relay-Kapazität bleiben separate, unbestätigte Betriebseigenschaften.

## Überprüfung des zusätzlichen Nutzerreviews

Der Nutzer lieferte am 11.11.2026 einen ausdrücklich nur lesenden Vergleich des Branches mit `relayThrough`/`blind-relay`. Das ist Reviewinput, kein ausgeführter Testnachweis und kein Claude-Ergebnis. Codex prüft die Aussagen gegen HyperDHT 6.36.0 und blind-relay 1.6.1:

- Kein Wechsel auf `blind-relay`: Das gemeinsame begrenzte Hub-Protokoll über normale HyperDHT-Streams bleibt. Kein `mutablePut`-Koordinationsverzeichnis; der Sitzungs-Topic leitet sich vom öffentlichen Hostschlüssel ab, nicht von der PIN oder einer frei behaupteten Hostliste.
- DHT-Discovery und Host-Besitznachweis besagen nicht, dass ein Helfer vertrauenswürdig, leistungsfähig oder global erreichbar ist. Es gibt keine signierte Kapazitätsgarantie, keine fest codierte Relay-Startliste und keine zugesagte Anzahl online verfügbarer Helfer. Öffentliche Bootstrapknoten der HyperDHT-Bibliothek sind weiterhin für den Einstieg in deren DHT erforderlich; „dezentral“ bedeutet nicht ohne jegliche fremde Netzteilnehmer.
- Native UDX-Relaywege beheben keine UDP-Sperre. Das optionale WSS-Gateway benötigt einen erreichbaren, tatsächlich betriebenen Endpunkt. Eine künftig fest mitgelieferte Gatewayliste wäre eine neue Betriebsentscheidung.
- Der Verzicht auf eigene `relayThrough`-Optionen allein schützt den Host **nicht** vor einem fremden Handshake mit dieser Option. In 6.36.0 ruft `lib/server.js` den dokumentierten `createServer.firewall(remotePublicKey, remoteHandshakePayload)` vor dem fremdbestimmten Relay-Dial auf. Eine zusätzliche Ablehnung dieses Felds über die öffentliche API ist in #149 implementiert und durch einen echten verschlüsselten Testhandshake mit null ausgehenden Dials geprüft. Sie ist kein vollständiger Fix aller Probe-/Handshake-Pfade aus Upstream #296; dessen PR #300 ist weiterhin offen.
- Zusätzliche ACKs für Dokumentänderungen sind bei unseren geordneten Streams nicht erforderlich: Yjs synchronisiert nach Wiederverbindung per State-Vector. Die vorhandenen monotonen AES-GCM-Zähler sind dagegen kryptografischer Replay-/Reorder-Schutz und müssen erhalten bleiben. Auch flüchtige Nachrichten und Transportauthentifizierung werden nicht durch Yjs ersetzt.
- Globale Discovery bleibt gegen falsche Angebote/Sybil-Belegung anfällig. Begrenzte Kandidaten, zwei Hostregistrierungen und zeitweilige Sperren begrenzen Fehlversuche, garantieren aber keine Verfügbarkeit. Helfer sehen IP-Adressen ihrer Verbindungen, Zeitpunkte, Topics und Datenmengen trotz innerer Ende-zu-Ende-Verschlüsselung.

Quellen: [öffentlicher Firewall-Hook](https://docs.pears.com/p2p/reference/building-blocks/hyperdht/#createserveroptions), [Upstream #296](https://github.com/holepunchto/hyperdht/issues/296), [offener Patch #300](https://github.com/holepunchto/hyperdht/pull/300). Lokaler Quelltext und konkrete Prüfungen sind im Validierungsbericht getrennt von externen Betriebsaussagen dokumentiert.


## Abgleich nach Fable-Sparring und Bildanforderung

Nach dem tatsächlichen Fable-5.2/high-Review hält Codex an der Wahl des begrenzten Anwendungshubs fest; die fünf materiellen Implementierungsbefunde wurden durch Codex korrigiert und lokal geprüft. Bilder, Seiten, Notizen und die übrigen Dokumentinhalte werden jetzt einschließlich großer exakter Yjs-Zustände begrenzt übertragen (#151); Relay-Helfer sehen weiterhin nur verschlüsselte Inhalte. Sie sind keine Dokumentserver. Normale Deltas bleiben auf 4 MiB begrenzt; bis 64 MiB vollständiger Yjs-Zustand über 48-KiB-Nutzdatenpakete mit Hash-/Zeit-/Ressourcenprüfung. Dokumentformatgrenzen unverändert.

Nachweise: `149-local-validation.json`, `codex-149-validation.md`, `claude-149-fable-sparring.md`. Die verbleibende Verbesserung von Backoff und tatsächlicher Helfereignung/-weiterleitung ist #152; externe Netze und Skalierung bleiben #72. Die lokale Abnahme ist keine Zusage vorhandener öffentlicher Kapazität oder universeller Verbindung. Alle aktuellen Produktänderungen warten noch auf Integration in den Zielbranch.

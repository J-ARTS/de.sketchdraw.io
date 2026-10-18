# ADR 0003 — Trystero als optionaler P2P-Transportadapter

Status: angenommen; Transportadapter, CRDT-Brücke und Modusoberfläche sind umgesetzt. Reale Proxy-, TURN- und Lastnachweise bleiben in [#72](https://github.com/J-ARTS/de.sketchdraw.io/issues/72) offen. Die Yjs-Datenschicht folgt [ADR 0004](./0004-yjs-crdt-data-layer.md) und [#71](https://github.com/J-ARTS/de.sketchdraw.io/issues/71).

## Kontext

Die bestehende Zusammenarbeit verwendet einen direkten, verschlüsselten WebRTC-DataChannel zwischen jedem Gast und dem Owner. Offer und Answer werden manuell ausgetauscht; `RTCPeerConnection` erhält keine ICE-Server. Damit erfüllt die Implementierung die verbindliche Vision ohne zentrale Dokument-, Signaling-, STUN-, TURN- oder Relay-Dienste, kann aber nicht jede NAT-, Firewall- oder Unternehmensproxy-Situation erreichen.

Trystero 0.26.0 bietet eine einheitliche Raum-, Action- und Media-API über mehrere Discovery-Strategien. Das Standardpaket verwendet öffentliche Nostr-Relays; weitere Strategien nutzen MQTT, BitTorrent-Tracker, IPFS, Supabase, Firebase oder einen selbst betriebenen WebSocket-Relay. Diese Dienste tauschen Verbindungsinformationen aus. Anwendungsdaten laufen anschließend weiterhin über WebRTC. Ein nicht erreichbarer WebRTC-Datenkanal wird daher nicht dadurch zum WSS-Datenkanal, dass eine andere Trystero-Strategie gewählt wird. Dafür ist TURN oder ein eigener Daten-Relay-Adapter erforderlich.

OpenPencil 0.16 ist eine belastbare Referenz für die Kombination aus Vue 3, `@trystero-p2p/mqtt` 0.26, Yjs und `y-indexeddb`. Die Prüfung bezieht sich auf Commit [`1c1986b20d15f2556c563d6c59d14a006269a40a`](https://github.com/open-pencil/open-pencil/commit/1c1986b20d15f2556c563d6c59d14a006269a40a). OpenPencil trennt den Transport von der Yjs-Synchronisation und verwendet eigene Actions für Updates, State-Vector-Sync und Awareness. Diese Struktur wird als Referenz verwendet, nicht unverändert übernommen.

Quellen: [Trystero Signaling Strategies](https://trystero.dev/docs/signaling-strategies/), [Trystero Connections and Access](https://trystero.dev/docs/connections/), [Trystero Repository](https://github.com/dmotz/trystero), [OpenPencil Tech Stack](https://openpencil.dev/development/tech-stack), [OpenPencil Collaboration](https://openpencil.dev/programmable/collaboration), [WebRTC TURN](https://webrtc.org/getting-started/turn-server), [Electron Session Proxy](https://www.electronjs.org/docs/latest/api/session).

## Verifizierte Eigenschaften von Trystero 0.26

- `joinRoom()` verwaltet Signaling, `RTCPeerConnection` und einen geordneten DataChannel. Trystero ist deshalb ein Transportadapter und keine reine Discovery-Hilfe.
- Actions unterstützen gezielte Nachrichten, Request/Response, Transferfortschritt, Abbruch und empfangsseitige Freigabe. TypeScript-Typen ersetzen keine Laufzeitvalidierung.
- `onPeerHandshake` läuft nach dem Aufbau des WebRTC-Transports und vor der Aktivierung des Peers. Das ist der richtige Ort für den Sketchdraw-Identitäts- und Grant-Handshake.
- Das gemeinsame Passwort schützt den Signaling-Schlüssel, identifiziert aber keine Person. Die Trystero-Peer-ID ist eine flüchtige Routingkennung.
- Die Standard-ICE-Konfiguration enthält öffentliche STUN-Dienste. `rtcConfig.iceServers` ersetzt diese Liste; `turnConfig` ergänzt sie.
- Trystero 0.26 begrenzt eingehende Actions standardmäßig auf 256 MiB pro Raum. Sketchdraw setzt engere, domänenspezifische Grenzen.
- Alle Teilnehmer eines Raums bilden grundsätzlich ein WebRTC-Mesh. Trystero empfiehlt deshalb kleine Räume und liefert keine allgemeine Teilnehmergrenze.
- Die Action-Wire-Version änderte sich in 0.26. Kommunizierende Clients müssen gemeinsam aktualisiert oder über eine explizite Protokollversion getrennt werden.

## Bewertung der Signaling-Strategien

| Strategie | Eignung für Sketchdraw | Grenze |
| --- | --- | --- |
| MQTT über WSS | Erster Prototyp: proxyfreundlich, von OpenPencil praktisch erprobt, Endpunkte explizit konfigurierbar | Öffentliche Broker sind externe Infrastruktur; das MQTT-Paket erhöht den Browser-Bundleumfang merklich |
| Nostr über WSS | Gute alternative Mehrfach-Relay-Strategie mit Redundanz | Standardmäßig mehrere öffentliche Relays und dadurch größere Metadatenfläche |
| BitTorrent-Tracker | Direkte, dezentrale Discovery in offenen Netzen | WSS-Tracker und ICE sind in Unternehmensnetzen häufig unzuverlässig |
| IPFS | Dezentraler Discovery-Ansatz | Zusätzliche Komplexität und keine Lösung für blockiertes WebRTC |
| Supabase/Firebase | Kontrollierbare, verwaltete Signaling-Infrastruktur | Zentraler Anbieter und Projektkonfiguration widersprechen dem Strict-Direct-Modus |
| Selbst betriebener WSS-Relay | Klare Betriebs- und Datenschutzkontrolle | Erfordert eigenen Dienst; transportiert weiterhin keine App-Daten |

MQTT wird für den ersten Automatic-P2P-Prototyp verwendet, weil WSS durch Chromiums Proxy-Stack geführt werden kann und OpenPencil dieselbe Kombination produktnah nutzt. Die produktive Strategie bleibt austauschbar; öffentliche Default-Broker werden nicht als dauerhafte Verfügbarkeitsgarantie behandelt.

## Entscheidung

Sketchdraw erhält zwei klar getrennte Verbindungsmodi:

1. **Strict Direct:** bestehendes manuelles Pairing ohne externe Signaling-, STUN-, TURN- oder Relay-Dienste. Dieser Modus erfüllt weiterhin die verbindliche Strict-P2P-Vision.
2. **Automatic P2P:** Trystero übernimmt Signaling und WebRTC-Transport. Der Modus ist ausdrücklich aktivierbar und zeigt Strategie, Endpunkte, Metadatenwirkung und einen möglichen TURN-Datenpfad an. Die Dokumentdaten bleiben über WebRTC Ende-zu-Ende transportverschlüsselt; TURN wird nur als sichtbarer, optionaler Fallback konfiguriert.

Der bestehende `src/collaboration`-Vertrag bleibt während der Migration für Identität, Rollen, Grants, Permission-Epoch, Sitzungsbindung, Größenlimits und Fehlerverhalten maßgeblich. Trystero Actions transportieren signierte Sketchdraw-Envelopes. Ein Peer erhält erst nach erfolgreichem `onPeerHandshake` und nach der Sketchdraw-Fingerprint-/Grant-Prüfung Dokumentzugriff.

Die Yjs-Datenschicht wird über einen transportunabhängigen Vertrag angebunden. Mindestens vier logische Action-Namespaces werden getrennt behandelt:

- CRDT-Updates;
- State-Vector- und Initial-Sync;
- flüchtige Awareness-Daten;
- große Assets mit eigenem Budget und Backpressure.

Ein Trystero-`send()`-Abschluss bestätigt nur die lokale Übergabe an den Transport. Fachliche Commit- oder Persistenzbestätigungen werden weiterhin durch Sketchdraw-Nachrichten ausgedrückt.

## OpenPencil als Referenz und Abgrenzung

Übernommen werden die Transportabstraktion, die getrennten Sync-Kanäle, Yjs-State-Vectors, Awareness als flüchtiger Zustand, lokale IndexedDB-Wiederherstellung, gebündelte Transaktionen und eigene Regeln für Baum und Reihenfolge.

Nicht übernommen werden:

- ein Raum, dem jeder mit dem Link ohne individuelle Rolle beitreten kann;
- zufällige Namen oder Yjs-/Trystero-IDs als Identität;
- direktes Anwenden entfernter Yjs-Updates ohne Sketchdraw-Schema- und Grant-Prüfung;
- fest eingebaute öffentliche STUN-/TURN-Endpunkte oder gemeinsame öffentliche TURN-Zugangsdaten;
- ein unbeschränktes Vollmesh oder eine ungeprüfte 100-Teilnehmer-Zusage.

OpenPencils Dokumentation beschreibt den Datenpfad als direkt, während der geprüfte Quellstand zusätzlich öffentliche TURN-Konfiguration enthält. Sketchdraw weist einen Relay-Pfad deshalb technisch und in der Oberfläche ausdrücklich aus.

## Electron-Proxy und Unternehmensnetze

Der Chromium-Schalter `WebRtcHideLocalIpsWithMdns` schützt lokale ICE-Adressen durch mDNS-Namen. Er konfiguriert weder den Systemproxy noch leitet er WebRTC durch einen HTTP-Proxy.

MQTT-/Nostr-/WSS-Signaling im Renderer nutzt Chromiums Netzwerkstack. PAC/WPAD und integrierte Proxy-Authentisierung können dadurch funktionieren, hängen aber von Betriebssystem, Sicherheitszonen und Richtlinien ab. Eine Zusage „hinter jedem Proxy“ wird nicht gemacht. `app.on('login')` darf nur bestätigte Proxy-Challenges mit `authInfo.isProxy` beantworten; Zugangsdaten werden weder im Dokument noch in Issues oder Logs abgelegt.

TURN über TCP/TLS 443 kann blockierte direkte WebRTC-Verbindungen überbrücken, ist aber ein echter Datenrelay. Zugangsdaten müssen kurzlebig sein und dürfen nicht fest im Renderer stehen. Ein WSS-Datenfallback wäre ein eigener Adapter und keine Trystero-Eigenschaft.

## Topologie und Skalierung

Für kleine Räume kann der Automatic-P2P-Modus ein gemeinsames Trystero-Mesh verwenden. Die anfängliche Teilnehmergrenze bleibt konservativ und wird erst nach Messungen festgelegt. Ein Vollmesh mit 100 Teilnehmern erzeugt bis zu 4.950 Peer-Paare und ist kein akzeptierter Zielzustand.

Für größere Räume werden vor einer Produktzusage begrenzte Topologien verglichen: der vorhandene Owner-Stern als CRDT-Bridge, wenige gewählte Replikationspeers oder hierarchische Gruppen. Yjs verhindert doppelte Anwendung von Updates, löst aber weder Peer-Auswahl, Autorisierung, Lastverteilung noch Bridge-Ausfälle automatisch.

## Paket- und Prototypbefund

Eine temporäre Browser-Bündelung außerhalb des Repositorys mit `yjs@13.6.32`, `y-indexeddb@9.0.12`, `y-protocols@1.0.7` und `@trystero-p2p/mqtt@0.26.0` war erfolgreich. Die vollständig exportierende, minifizierte Testbündelung ergab ungefähr 158 KiB gzip: rund 30 KiB für Yjs/Persistenz/Awareness und rund 127 KiB für Trystero/MQTT. `npm audit --omit=dev` meldete für diesen temporären Stand keine bekannte Schwachstelle. Das ist ein Kompatibilitäts- und Größenhinweis, kein Laufzeit- oder Sicherheitsnachweis.

## Umgesetzter Stand vom 18.10.2026

`src/collaboration/transport.ts` definiert den transportneutralen Vertrag. `automatic.ts` implementiert `@trystero-p2p/mqtt@0.26.0`; `crdt.ts` verbindet dessen getrennte Sync-, Update- und Awareness-Actions mit dem Yjs-Controller. Der bisherige `PeerLink` und das manuelle Owner-/Gastprotokoll bleiben unverändert als Strict Direct erhalten.

Automatic P2P besitzt folgende erzwungene Grenzen:

- Raum-ID und Passwort enthalten jeweils 256 Bit Zufall; die signierte, fünf Minuten gültige Einladung bindet Raum, Rolle, Dokument, Controller-, Sitzungs- und Permission-Epoch sowie die ausdrücklich konfigurierten Endpunkte.
- `onPeerHandshake` verifiziert Sketchdraw-P-256-Identität, Sitzung, Einladung und Grant, bevor ein Peer Actions verwenden darf. Trystero-Peer-IDs dienen nur dem Routing.
- Jede Action ist separat signiert und bindet Kanal, Rolle, Grant-Generation, Sequenz, Bytezahl, SHA-256 und Sitzung. Sequenzen bleiben pro Identität über eine Transportwiederverbindung erhalten. Viewer dürfen ausschließlich Sync und Awareness senden.
- Eingangsgrenzen betragen 256 KiB für State-Vectors, 4 MiB für Yjs-Updates, 64 KiB für Awareness und 8 MiB für Assets. Zusätzlich begrenzt der Adapter ausstehende Ausgangsdaten auf 16 MiB.
- MQTT-Relays müssen als sichtbare, credential-freie `wss://`-Adressen angegeben werden. `rtcConfig` ist ebenfalls ausdrücklich anzugeben; es gibt keine eingebauten öffentlichen STUN-/TURN-Adressen oder TURN-Zugangsdaten.
- Die Vue-Oberfläche trennt „Strict Direct“ und „Automatic P2P“, zeigt Signaling- und ICE/TURN-Adressen und erklärt die externe Signaling-Grenze. Automatic P2P startet ohne angegebenen WSS-Endpunkt nicht.
- Der Trystero-WebSocket läuft im Renderer und nutzt damit Chromium/Electrons System-Netzwerkpfad. Electron aktiviert vor dem App-Start `WebRtcHideLocalIpsWithMdns`. Daraus wird ohne reale Plattformmessung keine PAC-/NTLM-/Kerberos-Garantie abgeleitet.

`@trystero-p2p/mqtt@0.26.0` und `@trystero-p2p/core@0.26.0` sind MIT-lizenziert. Der direkte Produktionsaudit meldete keine bekannte Schwachstelle. Der automatische Modus wird dynamisch geladen: Der normale Renderer-Chunk misst 1.064,93 kB minifiziert beziehungsweise 326,05 kB gzip; der Automatic-P2P-Chunk 403,13 kB beziehungsweise 123,47 kB gzip. Dadurch belastet Trystero den üblichen Startpfad erst beim Öffnen des automatischen Modus.

Deterministische In-Memory-Transporttests prüfen Zwei-Peer-Handshake, Grantbindung, Viewer-Abweisung, Replay, unbekannte Peers, explizite Endpunkte und einen vollständigen Yjs-Updatepfad. Die Browseroberfläche prüft die Modustrennung und verweigert fehlende Endpunkte. Diese Tests ersetzen keinen echten MQTT-Broker-, Unternehmensproxy-, TURN-, Ausfall- oder 25/50/100-Teilnehmer-Nachweis. Ein Gast kann im aktuellen UI-Prototyp nur beitreten, wenn dieselbe Dokument-ID bereits geöffnet ist; der sichere automatische Bootstrap eines fremden Dokuments bleibt vor einer allgemeinen Freigabe zu lösen.

## Erforderliche Nachweise

- Strict Direct bleibt ohne externe Verbindungen funktionsfähig.
- Automatic P2P verbindet zwei authentisierte Peers über explizit konfigurierte MQTT/WSS-Endpunkte.
- PAC-/HTTP-Proxy, erlaubte integrierte Windows-Authentisierung und manueller Proxy-Login werden real geprüft.
- Direkter ICE-Pfad und optionaler TURN/TLS-443-Pfad sind diagnostizierbar und in der Oberfläche unterscheidbar.
- Broker-/Relay-Ausfall, Wiederverbindung, Versionsabweichung und abgewiesene Peers sind getestet.
- Signaling-Logs enthalten keine Dokumentinhalte oder Geheimnisse.
- Lasttests mit 25, 50 und 100 Teilnehmern bestimmen eine nachweisbare Topologie und Produktgrenze.
- Die vorhandenen Rollen-, Session-, Datei-, Sandbox- und P2P-Tests sowie die CRDT-Konvergenztests aus #71 bleiben grün.

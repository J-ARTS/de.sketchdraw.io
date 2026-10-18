# ADR 0003 — Trystero nur als optionaler Discovery-Adapter

Status: vorgeschlagen zur Produktentscheidung in [#70](https://github.com/J-ARTS/de.sketchdraw.io/issues/70), nicht zur Implementierung freigegeben.

## Kontext

Die bestehende Zusammenarbeit verwendet einen direkten, verschlüsselten WebRTC-DataChannel zwischen jedem Gast und dem Owner. Offer und Answer werden manuell ausgetauscht; `RTCPeerConnection` erhält keine ICE-Server. Damit erfüllt die Implementierung die verbindliche Vision ohne zentrale Dokument-, Signaling-, STUN-, TURN- oder Relay-Dienste, kann aber nicht jede NAT-, Firewall- oder Unternehmensproxy-Situation erreichen.

Trystero 0.26.0 bietet eine einheitliche Raum- und Action-API über mehrere Discovery-Strategien. Das Standardpaket verwendet öffentliche Nostr-Relays; weitere Strategien nutzen unter anderem MQTT, BitTorrent-Tracker, IPFS, Supabase, Firebase oder einen selbst betriebenen WebSocket-Relay. Diese Medien tauschen Verbindungsinformationen aus. Anwendungsdaten laufen anschließend weiterhin über WebRTC. Ein nicht erreichbarer WebRTC-Datenkanal wird daher nicht dadurch zum WSS-Datenkanal, dass eine andere Trystero-Strategie gewählt wird. Dafür ist TURN oder ein eigener Daten-Relay-Adapter erforderlich.

Quellen: [Trystero Signaling Strategies](https://trystero.dev/docs/signaling-strategies/), [Trystero Repository](https://github.com/dmotz/trystero), [WebRTC TURN](https://webrtc.org/getting-started/turn-server), [Electron Session Proxy](https://www.electronjs.org/docs/latest/api/session).

## Bewertung der vorgeschlagenen Bausteine

| Baustein | Eignung | Grenze |
| --- | --- | --- |
| Trystero | Geeignet für optionale Peer-Discovery und WebRTC-Abstraktion | Öffentliche Strategien sind externe Signaling-Infrastruktur; App-Daten fallen nicht automatisch auf WSS zurück |
| TURN über TCP/TLS 443 | Geeignet als WebRTC-Fallback in restriktiven Netzen | TURN ist ein Relay-Dienst mit Betrieb, Zugangsdaten, Metadaten und Kosten |
| Renderer-`WebSocket` oder `net.WebSocket` | Geeignet für einen ausdrücklich entworfenen WSS-Datenadapter über Chromiums Netzwerkstack | Benötigt einen Daten-Relay und einen eigenen sicheren Wire-Vertrag; Trysteros Signaling-Socket ist dafür nicht vorgesehen |
| Electron-Systemproxy | Geeignet für PAC/WPAD und Systemproxy-Auflösung | `WebRtcHideLocalIpsWithMdns` erzwingt keinen Proxy; `session.setProxy({ mode: 'system' })` oder die Session-Standardkonfiguration steuern den Proxy |
| NTLM/Kerberos | Chromiums Netzwerkstack kann integrierte Authentisierung verwenden | Verhalten hängt von Betriebssystem, Sicherheitszonen und Richtlinien ab; „hinter jedem Proxy“ ist keine belastbare Garantie |
| `app.on('login')` | Geeignet für explizite Proxy-Credentials | Standardverhalten storniert Authentisierung; Geheimnisse benötigen sicheren Dialog und geschützte Ablage |
| Yjs | Geeignet als netzwerkunabhängiges CRDT, wenn echte Multi-Writer-/Offline-Konvergenz beschlossen wird | Ersetzt weder Discovery, Transport, IAM noch Topologie; wäre eine grundlegende Änderung des aktuellen Owner-/Revision-/Undo-Vertrags |
| Hyperswarm | Möglich als optionaler Desktop-Discovery-/Transportadapter | UDP/uTP wird in vielen Unternehmensnetzen blockiert und läuft außerhalb des Chromium-Proxy-Stacks |
| mDNS/LAN-TCP | Sinnvoll für direkte Teilnehmer im selben LAN | Erfordert eigenen authentisierten TCP-Transport und funktioniert nicht über geroutete Netze oder isolierte WLAN-Clients |

Der Chromium-Schalter `WebRtcHideLocalIpsWithMdns` schützt lokale ICE-Adressen durch mDNS-Namen. Er konfiguriert weder den Systemproxy noch leitet er WebRTC durch einen HTTP-Proxy.

## Entscheidungsvorschlag

Der bestehende `src/collaboration`-Vertrag bleibt für Autorisierung, Peer-Identität, Rollen, Fingerprint-Bestätigung, Revisionen, Backpressure und Fehlerverhalten maßgeblich. Trystero wird nicht direkt in die Domäne oder an ein `Y.Doc` gekoppelt. Falls die Produktvision externe Infrastruktur künftig optional erlaubt, wird zuerst eine kleine Transport-/Discovery-Grenze vor dem bestehenden Protokoll definiert.

Die Oberfläche unterscheidet dann sichtbar zwei Modi:

1. **Strict Direct:** heutiges manuelles Pairing, keine externen Signaling-/Relay-Dienste, keine allgemeine Internet-Erreichbarkeitsgarantie.
2. **Proxy Assisted:** Trystero für Discovery und optional TURN über TLS 443. Externe Dienste, deren Betreiber, Metadatenwirkung und Datenpfad werden vor Aktivierung angezeigt. Ein späterer WSS-Datenfallback ist ein eigener Adapter und keine Trystero-Eigenschaft.

`WebRtcHideLocalIpsWithMdns` darf unabhängig davon als Privatsphäreneinstellung verwendet werden. Proxy-Auflösung wird über eine eigene Electron-Session geprüft. Auf Electron 44 kann ein Main-Prozess-WebSocket bei Bedarf über `net.WebSocket` denselben Chromium-Netzwerkstack verwenden; ein Renderer-WebSocket erhält keinen Node-Zugriff und bleibt unter Context Isolation.

## Skalierung

Trystero stellt pro sichtbarem Peer eine `RTCPeerConnection` bereit und weist selbst darauf hin, dass Browser nur eine begrenzte Zahl solcher Verbindungen tragen. Ein unbeschränktes Vollmesh mit 100 Teilnehmern erzeugt bis zu 4.950 Peer-Paare und ist kein akzeptierter Zielzustand.

Die bestehende Owner-Stern-Topologie benötigt beim Owner bis zu 99 Verbindungen. Auch das muss mit realen Dokumentgrößen, Updatefrequenzen und Backpressure gemessen werden. Für 100 Teilnehmer ist vor einer Zusage eine begrenzte Topologie nötig, beispielsweise wenige Replikationspeers plus Zuschauergruppen. Ein Peer, der zwei Provider erreicht, kann CRDT-Updates technisch weiterreichen; das macht ihn aber zu einer bewusst zu entwerfenden Bridge mit Schleifenunterdrückung, Autorisierung, Lastgrenzen und Ausfallverhalten. Diese Eigenschaften entstehen nicht automatisch allein durch mehrere Yjs-Provider.

## Sicherheits- und Betriebsfolgen

- Öffentliche Nostr-Relays und BitTorrent-Tracker sehen mindestens zeitliche und Netzwerkmetadaten des Signaling-Verkehrs. Verfügbarkeit und Nutzungsregeln werden nicht von Sketchdraw kontrolliert.
- TURN-Credentials dürfen nicht dauerhaft im Renderer liegen. Kurzlebige Zugangsdaten benötigen eine vertrauenswürdige Ausgabequelle; statische öffentliche Credentials wären missbrauchbar.
- Trysteros Discovery ist nicht die Sketchdraw-Autorisierung. Ein entdeckter Peer erhält erst nach dem vorhandenen kryptografischen Handshake, Rollenentscheid und Fingerprint-Abgleich Zugriff.
- Proxy-Credentials werden nur auf ein bestätigtes Proxy-Challenge mit `authInfo.isProxy` angewendet, nie pauschal auf Server-Authentisierung.
- Ein WSS-Datenadapter benötigt Ende-zu-Ende-Verschlüsselung, Größen- und Ratenlimits, Wiederholungsunterdrückung, Sitzungsbindung und eine klare Aussage, ob der Relay flüchtig puffert oder speichert.

## Erforderliche Entscheidung und Nachweise

Vor einer Implementierung muss entschieden werden, ob „Strict P2P“ weiterhin externe Signaling- und Relay-Dienste ausschließt oder ob ein separat aktivierbarer Proxy-Assisted-Modus die Vision erweitert.

Ein anschließender Prototyp muss mindestens folgende Nachweise liefern:

- zwei direkte Peers ohne externen Dienst;
- zwei Peers hinter PAC-/HTTP-Proxy mit reproduzierbarer Proxyauflösung;
- Windows-Test für erlaubte integrierte NTLM-/Kerberos-Authentisierung sowie manuellen Proxy-Login;
- TURN/TLS-443-Fallback mit klar ausgewiesenem Relay-Kandidaten;
- Trystero-Ausfall, Relaywechsel, Reconnect und abgewiesener unbekannter Peer;
- keine Geheimnisse oder Dokumentinhalte in Signaling-Logs;
- Lasttests mit 25, 50 und 100 Teilnehmern für gewählte Topologie, Updatefächerung, CPU, Speicher und Wiederverbindung;
- Regression der vorhandenen Rollen-, Revisions-, Konflikt-, Sandbox- und P2P-Tests.

Bis diese Entscheidung und Nachweise vorliegen, wird Trystero nicht als Abhängigkeit installiert und es wird keine allgemeine Erreichbarkeit hinter jedem Proxy oder für 100 Teilnehmer behauptet.

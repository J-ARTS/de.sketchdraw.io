# Netzwerk- und Lasttestplan für Automatic-P2P

Bezug: Issue #72, ADR 0003, `docs/contracts-p2p.md`. Dieses Dokument trennt strikt zwischen dem, was lokal deterministisch belegt ist, und dem, was eine reale Umgebung erfordert. **Nichts aus Abschnitt 3 ist ausgeführt; kein Eintrag dort gilt als bestanden.**

## 1. Lokal deterministisch belegt

Prüfumgebung der Messwerte: macOS 14 (Darwin 23.6), Apple M1 Pro (10 Kerne), Node 22.16, Vitest 5, Stand nach Commit `9d40f33` plus Änderungen aus #72. Die Tests verwenden echte P-256-Signaturen, SHA-256 und die echten Envelopes des Transports über ein In-Memory-Netz (`tests/unit/collaboration/fake-trystero.ts`). Sie können weder ICE/DTLS noch einen echten Broker, Proxy oder TURN-Server nachweisen.

| Kriterium aus #72 | Test | Was bewiesen ist | Grenze |
| --- | --- | --- | --- |
| Verbindungsverlust und Wiederverbindung | `automatic-resilience.spec.ts` | Verlorene Peers verschwinden aus dem Status, Senden an sie scheitert mit `PEER_NOT_AUTHORIZED`, nach dem Wiederfinden läuft der Handshake erneut, Sequenzen setzen sich fort, alte Envelopes bleiben abgewiesen | Netz ist simuliert |
| Broker-Ausfall | `automatic-resilience.spec.ts` | Bestehende Verbindungen laufen ohne Broker weiter, Neue werden erst nach Rückkehr des Brokers entdeckt und aufgenommen | Simulierter Broker |
| Broker-Ausfall mit echter Trystero-Strategie | `automatic-signaling.spec.ts` | Nach Trennung und `connect` abonniert Trystero dieselben Topics erneut und kündigt sich erneut an | MQTT-Client ist ein Stub, kein realer Broker |
| Neustart mit gleicher Identität | `automatic-resilience.spec.ts` | Ein neu erzeugter Transport startet über der Sequenz seines Vorgängers und wird nicht als Replay abgewiesen | Voraussetzung: Uhr läuft nicht rückwärts |
| Abgewiesene Beitritte | `automatic-resilience.spec.ts`, `automatic-load.spec.ts` | Ein abgewiesener Fremder oder der 26. Teilnehmer stört eine laufende Sitzung nicht und hinterlässt keinen Peer-Eintrag | |
| Doppelter und vertauschter Empfang | `automatic-resilience.spec.ts` | Wiederholte und ältere Envelopes werden je Kanal abgewiesen, der nächste gültige wird angenommen | |
| Backpressure | `automatic-resilience.spec.ts` | 16 MiB ausstehende Ausgangsdaten sind die Grenze (`TRANSPORT_BACKPRESSURE`), danach läuft das Senden wieder | Kein echter DataChannel-Puffer |
| Abbruch großer Übertragungen | `automatic-resilience.spec.ts` | Verlässt Sender oder Empfänger mitten in einer 8-MiB-Übertragung den Raum, bricht sie ab, liefert nichts aus und gibt das Ausgangsbudget frei | |
| Rollen und Größen am Empfänger | `automatic-resilience.spec.ts` | Behauptete Rolle ≠ vergebene Rolle wird auf jedem Kanal abgewiesen, leere und übergroße Nachrichten verlassen das Gerät nicht | |
| Keine Geheimnisse im Signaling | `automatic-signaling.spec.ts` | Die echte Trystero-MQTT-Strategie veröffentlicht nur gehashte Topics und `{"peerId": …}`; Passwort, Raum-ID, Einladungs-ID, Schlüssel, Sitzungs-/Dokument-IDs und TURN-Zugangsdaten tauchen weder in Topics noch Nachrichten noch Abos auf | SDP/ICE-Angebote entstehen erst mit echten WebRTC-Verbindungen; ihre Verschlüsselung leistet Trystero und ist hier nicht geprüft |
| Keine Geheimnisse in Konsole und Fehlertexten | `automatic-signaling.spec.ts`, `automatic-resilience.spec.ts` | Fehler sind reine Codes; während Fehlern, Replays, Verbindungsabbruch und Brokerfehler enthält die Konsole keine Geheimnisse, der Transport schreibt nichts; ein statischer Test verbietet `console.*` in `src/collaboration`, `src/crdt`, `src/session` und im Panel | Broker-Logs fremder Betreiber sind nicht prüfbar |
| Last 25/50/100 | `automatic-load.spec.ts` | Vollvermaschung aus 25, 50 und 100 Teilnehmern wird aufgebaut; ein 64-KiB-Update erreicht alle anderen genau einmal; alle senden Awareness an alle | Nur Protokoll- und Kryptokosten, keine WebRTC-Kosten |

Gemessene Protokolllast (ein Lauf, Richtwerte; die Tests prüfen nur großzügige Obergrenzen):

| Teilnehmer | Verbindungen (n·(n−1)/2) | Aufbau des Vollnetzes | 64-KiB-Update an alle | Awareness aller an alle |
| ---: | ---: | ---: | ---: | ---: |
| 25 | 300 | ≈ 100 ms | ≈ 8 ms | ≈ 40 ms (600 Zustellungen) |
| 50 | 1 225 | ≈ 370 ms | ≈ 12 ms | ≈ 150 ms (2 450 Zustellungen) |
| 100 | 4 950 | ≈ 1,5 s | ≈ 20 ms | ≈ 530 ms (9 900 Zustellungen) |

Ableitung: Signatur-, Hash- und Prüfaufwand des Protokolls wächst erwartungsgemäß quadratisch, bleibt aber bis 100 Teilnehmern unkritisch (alle 100 Teilnehmer zusammen benötigen für sämtliche Handshakes etwa 1,5 s CPU-Zeit auf einem Laptop). Das Protokoll ist damit nicht der Engpass. Der Engpass sind die echten WebRTC-Verbindungen: jede Person hält n−1 ICE/DTLS/SCTP-Verbindungen, und jede Änderung wird n−1-mal hochgeladen. Das wurde nicht gemessen.

## 2. Entscheidung zur Topologie und Produktzusage

- Automatic-P2P ist eine **Vollvermaschung** (jeder mit jedem). Ein Raum nimmt standardmäßig **höchstens 25 Teilnehmer inklusive der eigenen Person** auf (`AUTOMATIC_DEFAULT_MAX_PARTICIPANTS`). Die Konfiguration `maxParticipants` erlaubt 2 bis 100 (`AUTOMATIC_MAX_PARTICIPANTS_CEILING`); alles darüber wird abgelehnt.
- Der Transport weist den Teilnehmer über der Grenze im Handshake ab (`ROOM_FULL`), ohne dass bestehende Verbindungen oder der Sitzungsstatus leiden. Die abgewiesene Person sieht den generischen Verbindungsfehler; der Grund wird nicht übertragen.
- **Produktzusage bis zur realen Messung:** höchstens 25 gleichzeitige Teilnehmer, und auch das erst nach bestandenem Test R11. Für 26 bis 100 Teilnehmer gibt es keine Zusage; dort wäre eine andere Topologie nötig (zum Beispiel ein Hub-Teilnehmer, der Updates weiterreicht, oder ein sichtbar betriebener Relay). Sie ist nicht implementiert und mit den Vorgaben „keine zentralen Server“ nur als ausdrückliche Betriebsentscheidung vereinbar.
- Die Grenze wird erst angehoben, wenn R11 für die jeweilige Stufe mit den Schwellen aus Abschnitt 4 bestanden ist.

## 3. Offene Realumgebungs-Matrix (Plan, nicht ausgeführt)

Jeder Test ist mit App-Version und Commit, Betriebssystem samt Version, Netzaufbau, Ergebnis (bestanden / fehlgeschlagen / eingeschränkt) und Beleg (Log-Auszug ohne Geheimnisse, Screenshot, Messwerte) im Issue #72 zu dokumentieren.

| ID | Szenario | Aufbau | Durchführung | Erwartung | Status |
| --- | --- | --- | --- | --- | --- |
| R1 | Zwei Geräte, direkte Verbindung | Zwei Geräte im selben LAN, öffentliche Broker oder eigener WSS-Broker | Session starten, per Link beitreten, in beide Richtungen zeichnen | Beitritt, Dokumentabruf, Live-Sync | offen (Browser-Browser über öffentliche Broker am 18.10.2026 belegt, `tests/ui/session-network.spec.ts`) |
| R2 | Systemproxy ohne Anmeldung | Unternehmens- oder Testproxy (zum Beispiel Squid), HTTP CONNECT, manuell im Betriebssystem eingestellt | App als Electron-Anwendung und im Browser; Session starten und beitreten | WSS-Signaling läuft über den Proxy; Ergebnis je Plattform (macOS, Windows, Linux) | offen |
| R3 | PAC-Datei | Proxy-Konfiguration über PAC-URL | Wie R2 | Chromium wertet die PAC-Regeln aus; ein PAC mit `DIRECT` für den Broker funktioniert ebenso | offen |
| R4 | Manueller Proxy-Login | Proxy mit Basic-Authentifizierung | Wie R2 | Die Anmeldung erfolgt über den Betriebssystem- oder Browserdialog; ein abgelehnter Login ergibt einen verständlichen Verbindungsfehler. Die Electron-Anwendung registriert keinen eigenen `login`-Handler (`electron/main.ts`); das Verhalten ist zu klären | offen |
| R5 | NTLM | Proxy mit NTLM, Windows-Domäne | Wie R2 | Anmeldung mit den Windows-Zugangsdaten oder dokumentierte Einschränkung | offen |
| R6 | Kerberos | Proxy mit Kerberos/Negotiate, Domäne | Wie R2 (Windows und macOS) | Anmeldung per Ticket oder dokumentierte Einschränkung | offen |
| R7 | TURN über TLS auf Port 443 | Eigener TURN-Server (zum Beispiel coturn) mit `turns:…:443?transport=tcp`, kurzlebige Zugangsdaten; Netz blockiert UDP | Einladung mit dieser ICE-Konfiguration erzeugen, zwei Geräte hinter getrennten NATs verbinden | Verbindung kommt über TURN zustande; ohne TURN schlägt sie bei symmetrischem NAT mit klarer Meldung fehl | offen |
| R8 | Symmetrisches NAT ohne TURN | Zwei Mobilfunk- oder Firmennetze | Beitritt versuchen | Dokumentiertes Scheitern mit verständlicher Meldung | offen |
| R9 | Echter Broker-Ausfall | Eigener MQTT-WSS-Broker (zum Beispiel Mosquitto oder EMQX) | Drei Geräte verbinden, Broker stoppen, weiterzeichnen, Broker starten, vierte Person tritt bei, Gerät trennt kurz das Netz und kehrt zurück | Bestehende Verbindungen laufen ohne Broker; Beitritt erst nach Rückkehr; Wiederverbindung innerhalb der Brokerzeitgrenzen | offen |
| R10 | Mehrere Hosts und Plattformen | Windows, macOS, Linux; Electron und Chromium-Browser | Gemischte Session mit drei Plattformen | Gleiche Dokumentzustände (Hash-Vergleich), Rollen werden durchgesetzt, auch im Gast-Browser (Viewer) | offen |
| R11 | Last mit echten Verbindungen | Stufen 25, 50, 100: Headless-Chromium-Instanzen auf mehreren Hosts | Vollvermaschung aufbauen, jede Instanz zeichnet mit festem Takt, danach Netzverlust einzelner Instanzen | Schwellen aus Abschnitt 4; Ergebnis legt die Teilnehmergrenze fest | offen |
| R12 | Broker-Log-Abnahme | Eigener Broker mit ausführlichem Log | Eine Session mit Beitritt und Wiederverbindung | Im Log nur gehashte Topics, Peer-IDs und verschlüsselte Angebote; weder Passwort, Raum-ID noch Dokumentdaten | offen |

## 4. Messgrößen und Schwellen für R11

Vorschlag, vor dem Lauf mit Codex abzustimmen:

- Aufbau des Vollnetzes: 95 % der Teilnehmer in höchstens 30 s verbunden.
- Konvergenz: Nach einer Änderung halten 95 % der Teilnehmer den gleichen Zustand innerhalb von 2 s, nach 60 s alle (Hash-Vergleich).
- Stabilität: höchstens 1 % ungeplante Verbindungsabbrüche in 10 Minuten, jeder Abbruch erholt sich ohne Neuladen.
- Ressourcen je Teilnehmer: Speicher und CPU unterhalb einer vorher festgelegten Grenze auf dem schwächsten Zielgerät; Upload je Änderung ist (n−1) × Update-Größe und wird gemessen.
- Jede Stufe erhält ein eigenes Ergebnis; fällt eine Stufe durch, bleibt die Grenze darunter.

## 5. Abnahmeregel für #72

Das Ticket wird erst geschlossen, wenn R2 bis R12 jeweils bestanden sind oder mit dokumentierter Einschränkung in die Produktzusage übernommen wurden (zum Beispiel „Kerberos-Proxys werden nicht unterstützt“) und die Teilnehmergrenze durch R11 belegt ist.

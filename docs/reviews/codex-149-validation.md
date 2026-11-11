# Unabhängige Prüfung — HyperDHT / Relay (#149)

Status: laufende Implementierungsprüfung; mehrere Fehler nachgewiesen und zur Korrektur zurückgegeben. Noch keine Gesamtabnahme.

## Ausgangsstand

`bd610f6`, macOS/Node lokal. `npx vitest run --config vitest.config.ts tests/unit/collaboration tests/unit/session`: 9 Dateien / 85 Tests bestanden (11.11.2026). Das prüft den bisherigen Stand; kein HyperDHT-/Relay-Nachweis.

## Lesendes Architekturreview

Tatsächliches Tool: Codex-Subagent `/root/hyperdht_architecture_review`; keine Claude-Ausgabe. Der tatsächliche Implementierer ist separat Claude CLI, Sonnet 5.5/high.

- Native HyperDHT-Laufzeit in Electron Main halten; Peer-Findung und UDX-Holepunch allein lösen blockiertes UDP nicht. Ein separater verschlüsselter WSS-Datenpfad muss auch dann bereitstehen, wenn der Host keinen DHT-Zugang hat.
- Link pinnt Host-Identität. Erst authentisierter E2E-Kanal, danach PIN. Kein mitgeschnittener öffentlicher PIN-Prüfwert, keine PIN in Link oder Logs. Hostweite Versuchsbegrenzung darf nicht durch neue Peer-IDs umgangen werden.
- Neue Verbindung nach Pfadwechsel/Reconnect erhält frische Schlüssel/Sequenzen; alte Generation darf keine Nachrichten oder Zustandsänderungen mehr liefern.
- `bootstrapRoomDocument` merkt sich bislang nur `requested=true`; ein verlorener erster Sync vor einem Reconnect wird nicht wiederholt. In #149 beim neuen Fallback-/Reconnect-Pfad prüfen.
- Bestehender Automatic-Beitritt installiert das Gastdokument als lokale Authority ohne Rolle. Viewer-Lokalbearbeitung und Agentenanbindung wurden separat in #150 erfasst. Neuer Modus muss Store-Schreibgate und Agentenautorität korrekt führen.
- Native Pakete müssen aus dem gebauten Electron-Artefakt laden. Ein bestandener Typecheck oder ein Node-Test allein belegt keine funktionierende Electron-Verpackung.

## Offene Prüfkriterien

- Echte lokale HyperDHT-Verbindung und bidirektionaler Yjs-Abgleich.
- Echter lokaler WebSocket-Relay bei unerreichbarem direkten Pfad; PIN, Bootstrap und bidirektionaler Abgleich.
- PIN-Fehler, Link-/Host-Manipulation, abgelaufene Einladung, Replay, Viewer und Größen-/Queue-/Verbindungsgrenzen.
- Abbruch/Reconnect beim Bootstrap, Relay-Ausfall, direkter Timeout und späte Ergebnisse nach Dokumentwechsel.
- Relay sieht keine PIN/Klartext; UI meldet Verbindung erst nach Authentisierung und Dokumentabgleich.
- Browser-/Electron-Anbindung, native Paketlaufzeit, Typecheck/Regression/Build.

Nicht durch lokale Loopback-Prüfung belegt: verschiedene reale NATs, Unternehmensproxy/PAC/NTLM/Kerberos, produktiver WSS/TLS-Endpunkt, Plattformen außerhalb der tatsächlich ausgeführten Umgebungen. #72 bleibt separat offen.

## Erster konkreter Implementierungsreview

Lesender Subagent reproduzierte am entstehenden Code drei Fehler mit In-Memory-Bündelung und Node: (1) sechs parallele falsche PIN-Prüfungen umgehen den Cooldown durch Abschluss-Modulo; (2) altes Ergebnis nach `renew()` sperrt die neue PIN; (3) `WireInbox.drain().failure` wird beim Handshake verworfen und liefert einen offen erscheinenden Kanal nach Wire-Close. Zusätzlich fehlten Limits des Handshake-Inbox-Puffers. Diese Findings wurden Claude am ersten Checkpoint zur Korrektur und Regression übergeben; noch kein Fix-Nachweis.

Claude-Sitzung bleibt `7fcd65b3-bd16-4c09-8731-18ec7a9f4487`; erste Ausführung kontrolliert unterbrochen und mit demselben Modell/`--effort high` plus konkretem Feedback fortgesetzt. Kein anderer Agent editiert die Implementierungsdateien.

## Zweiter Review-Checkpoint / fortlaufendes Feedback

- Erste PIN-/Handshake-Races unabhängig nachgeprüft: parallele Versuche begrenzt; erneuerte PIN bleibt durch alte Ergebnisse unverändert (`PIN_STALE`); geschlossenes Wire bricht Handshake ab; Inbox-Overflow erkannt.
- Mit echtem lokalem Relay reproduziert: unauthentisierte Host-Registrierung verdrängt Host/Gäste; abgelehntes WebSocket-Upgrade verbraucht IP-Slot dauerhaft. Als R2 zurückgegeben, Eigentumsnachweis und vollständige Reservierungsfreigabe verlangt.
- Weitere konkrete Fälle als R3/R5/R6 zurückgegeben: wartendes `WireInbox.next()` bei Dispose; große erlaubte Nachricht überschreitet Relay-Burst ohne Pacing; Kontrollnachrichten ohne Backpressure; native Connects bei Dispose nicht geschlossen; hängendes BYE verhindert echtes Close; asynchrones Decrypt liefert Message nach Close.
- Positiver Teilnachweis: `WireInbox.dispose()` inzwischen repariert; frühe DirectBridge-Events vor `connect`-Antwort werden geordnet gepuffert. Keine Gesamtabnahme daraus abgeleitet.
- Fortlaufender expliziter Feedbackpfad für Claude: `/tmp/sketchdraw-149-live-review.md` (R1–R6). Claude prüft ihn vor Komponenten/Testabschluss. Zweiter lesender Reviewer `/root/hyperdht_lifecycle_review` prüfte ausschließlich Direct-/Channel-Lifecycle; keine parallelen Edits.

## Dritter Checkpoint: echter Relay und native Laufzeit

- Codex führte `npx vitest run --config vitest.config.ts tests/unit/collaboration/hdht/relay-server.spec.ts` unabhängig aus: **5/5 bestanden**, macOS, lokaler Arbeitsstand 11.11.2026, Log `/tmp/sketchdraw-149-root-relay-check.log`. Geprüft: Datenweiterleitung, fremde Host-Übernahme/Preclaim/Replay, berechtigter Host-Reconnect, fehlerhafte/abgebrochene Upgrades mit anschließender gültiger Verbindung. Kein vollständiger URL-/PIN-/Yjs-Abnahmetest daraus abgeleitet.
- Lesender Reviewer übertrug nach Pacing-Korrektur 8.388.609 Bytes (8 MiB + Nachrichtentyp) über den echten lokalen Relay und verschlüsselten Kanal. Originaler Burst-Fehler behoben.
- R7 weiterhin zur Abnahme: Host-Stop muss bestehende Kanäle/Pacer/Session-Promise tatsächlich beenden; übergroße Kontrollnachricht muss den echten WebSocket schließen, nicht nur Close melden.
- R8/R9/R10 native Findings: Stop/Dispose während ausstehendem `listen` erreicht Ressourcen nicht; `server.close()` kann auf Listen warten und Destroy blockieren; ein Zwischenfix schließt sogar regulär erfolgreiches Listen vor Aktivierung. Realer SecretStream hat kein `writableLength`; sein Streamx-`write` unterstützt außerdem keinen Node-Write-Callback. Reproduktionen mit realem Streamx/SecretStream belegen unwirksames Pufferlimit beziehungsweise nie endendes Send-Promise. Claude erhielt konkrete Korrekturhinweise und muss reale native Regressionen nachweisen.
- Positiv aus Lifecycle-Review: Framing für geteilte Header/Payload, mehrere Frames und Oversize-Abweisung geprüft. Das ersetzt keinen funktionsfähigen Direktkanal.
- Zwei separate Codex-Reviewer prüfen lesend Kerntransport/Auth sowie native Lifecycle/IPC. Live-Feedback `/tmp/sketchdraw-149-live-review.md`, inzwischen R1–R10. Claude bleibt alleiniger Implementierungsautor.

## Vierter Checkpoint: Session-Authentifizierung

- Unabhängiger Codex-Lauf: `npx vitest run --config vitest.config.ts tests/unit/collaboration/hdht/{pin-gate,relay-channel,channel-io,relay-server}.spec.ts`: **4 Dateien/31 Tests bestanden**, 11.11.2026 19:39 lokal, Log `/tmp/sketchdraw-149-root-protocol-check.log`. Noch kein vollständiger Direkt-/UI-Nachweis.
- R7 unabhängig bestanden: Host-Stop schließt verschlüsselte Kanäle und spätere Sends schlagen fehl; übergroße Kontrollnachrichten schließen den tatsächlichen WebSocket.
- R11 echte Relay-Repros: Abbruch während Auth hinterlässt Host-Peer/Socket; parallele PIN-Erfolge überschreiten Teilnehmerlimit; erste Sync-Nachricht trifft vor asynchron fertig aufgebautem Gast-Host-Peer und löst `PROTOCOL_ERROR` aus. Für die letzten zwei Fälle wurde der Digest gezielt verzögert, um reguläre Async-Interleavings deterministisch zu erzeugen.
- R13 echte Relay-Repros: Kick wird automatisch rückgängig gemacht (Gast verbindet erneut); explizites Host-Ende beendet Relay vor Abschlussnachricht, daher nur `CONNECTION_LOST` statt `SESSION_ENDED`.
- R14 echte Relay-Repro: abgelaufener Original-Link wird lokal abgewiesen, ausschließlich verlängertes `e`-Feld hingegen ermöglicht noch Anmeldung beim Host. Verbindliche Gastgeber-Ablaufzeit und Prüfung nach Async-Authentifizierung verlangt; bestehende autorisierte Sessions dürfen bleiben.
- R12 nativer Neustart nach abgebrochenem Start übernimmt noch altes Start-Promise. R15 ergänzt Abnahme für Gastrolle/MCP auch bei gleicher Dokument-ID und atomarem Dokumentübergang.
- Claude vor der nächsten Testphase mit allen R1–R15 explizit im selben CLI-/Modell-/Effort-Run fortgesetzt; Implementierung weiter ausschließlich durch Claude. Neue Befunde sind noch nicht als behoben abgenommen.

## Unabhängige native Nachprüfung bestanden

Codex-Lifecycle-Reviewer prüfte `electron/direct-service.ts` Snapshot SHA-256 `0d641a3ec3e4f87fa2387aa50aef67daf91239f046cdb3afaeed2fd323528f58` mit eigener Reproduktion `/tmp/sketchdraw-review149-direct.mjs` (keine Repository-Edits):

- Erfolgreiches Hosting bleibt aktiv; Stop während Startup mit sofortigem Neustart erzeugt getrennte Generationen; verspätetes altes `listen` bleibt inert.
- Nie endendes natives Close/Destroy ist nach 2.004 ms begrenzt.
- Tatsächliches Streamx: Drain löst Send auf, 7 MiB + 7 MiB reservieren korrekt und weiterer großer Send wird abgewiesen; Close beendet wartende Sends; Host-Stop erhält ausgehende Kanäle.
- Tatsächliches lokales HyperDHT-Testnetz: beide Enden haben dieselbe Handshake-Bindung, bidirektionale Übertragung einschließlich 8.388.609 Bytes exakt, Stop schließt Verbindung, Neustart rotiert Schlüssel und erneuter Beitritt funktioniert.
- `streamx@2.28.1` direkte Runtime-Abhängigkeit, dedupliziert mit SecretStream. Native Verpackung statisch passend, aber noch kein tatsächlicher Electron-Paketnachweis.

R8/R9/R10/R12 damit im geprüften nativen Umfang bestätigt behoben. Neue UI-/Transportänderungen und endgültige Gesamtregression separat prüfen.

## Reviewcheckpoint: dezentrale Helper-Ergänzung (lokal, noch keine Abnahme)

Nutzerkorrektur und weiterer Community-Relay-Anhang verlangen native freiwillige Helfer ohne eigenen festen Endpunkt. Architekturbegründung: `149-decentralized-relay-decision.md`. Claude-Sitzung bleibt `7fcd65b3-bd16-4c09-8731-18ec7a9f4487`, Sonnet5.5/high, Segment5 läuft. Root und Codex-Reviewer ändern keinen Implementierungscode.

Neue unabhängige reproduzierbare Befunde sind vor Gesamtintegration an Claude zurückgegeben:
- R20: synchrones Host-Replacement löscht den Raum; gemeinsamer Hub leitet übergroßen Binärrecord weiter.
- R21/R25: Hub-/Helper-Dispose hängt von bereits verworfenen Transport-Close-Callbacks ab und behält Verbindungen/Timer.
- R22: verzögerte DHT-Ankündigung setzt Status nach Stop zurück; Refresh-Rejection unbehandelt.
- R23: asynchrones Unannounce vor Detach verursacht alten Hostkey beim sofortigen Neustart.
- R24: parallele Discovery-Anfragen ohne Gesamtbudget.
- R26: synchrones Close-Replay erzeugt trotzdem Open und Keepalive-Intervall.
- R27: Abbruch während Helper-Verbindungsaufbau kann registrierten Geisterhost hinterlassen.

Reproduktionen (lokale temporäre Prüfarbeitsdateien, keine fertige Produktabnahme): `/tmp/sketchdraw-149-hub-review.mjs` (0/3), `/tmp/sketchdraw-review149-helper.mjs`, `/tmp/sketchdraw-149-peer-relay-review.mjs` (0/2). Maßgeblich bleiben geprüfte Dateisnapshots im jeweiligen Bericht; laufende Claude-Änderungen können sie später korrigieren. Neue Drei-/Mehrpeer-Abnahme, UI und finaler Gesamtstand weiterhin offen.

### Bestätigte positive Ergänzungen zum Helper-Review
- `/tmp/sketchdraw-review149-helper-real.mjs`: echtes isoliertes HyperDHT-Netz mit drei Bootstrapknoten; default-off 0 Nodes, Start genau1 Helpernode, richtige Service-Discovery, Sessionad erst nach signierter Hostregistrierung, Withdrawal nach Hostleave und Optout; exit0.
- `/tmp/sketchdraw-149-session-race-review.mjs`: 4/4 bestanden. R16 buffered AUTH, BYE SESSION_ENDED, AUTH_OK + frühes Sync im echten DirectLink mit kontrolliertem Bridge-Replay. Echter lokaler WSS-Host/Gast verbindet trotz absichtlich nie abgeschlossener nativer Verbindung und Discovery.
- `/tmp/sketchdraw-149-peer-relay-review.mjs`, nur Test `session helper discovery`: zwei echte Shared-Hubs mit echter E2E/PIN/Sessionlogik, kontrollierter native Adapter. Ausfall erster Helfer, weiterhin veralteter Key in Discovery, trotzdem Verbindung über anderen Helfer und Empfang. Kein Ersatz für echte DHT-/Yjs-Mehrpeer-Abnahme.
- Main/Preload mit echten esbuild-Optionen im Speicher gebaut; beide bestanden. Native Helper/Hub nur im Main-Bundle. Neue IPC-Validierung: 5 gültige +7 ungültige Requests korrekt. Kein Installer-Nachweis.
- Claude meldet 17 Dateien/138 Tests des bisherigen Bestands bestanden. Root unterbricht Segment5 danach am Reviewcheckpoint (CLI error_during_execution durch SIGINT, kein erfolgreicher Gesamtabschluss), startet Segment6 mit R17–R27 und vollständigem verbleibendem Auftrag. Modell unverändert Sonnet5.5/high.

## Claude-Limit und bestätigte Vertretung
Segment6 endet mit API429/is_error=true: „session limit“, Reset00:40 Europe/Berlin. Kein erfolgreicher Abschluss trotz CLI subtype success. Gemäß bestehender AGENTS.md-Vertretungsfreigabe vom17.10.2026 übernimmt Codex die offenen Implementierungsfixes, UI und Tests. Tatsächliche Rollen getrennt: bisheriger Code Claude CLI Sonnet5.5/high; folgende Änderungen Codex. Getrennte Besitzbereiche vor Start: Native/Lifecycle +Tests; Hub/ChannelSocket/PeerRelayHosts +Tests; Gast-Store/CRDT/UI +Tests; Root Sessionintegration/Mehrpeer-Abnahme/Tracking. Kein weiterer Claude-Aufruf vor Reset und keine Umgehung des Limits.

## Codex-Endreview und ergänzende Regressionen

Nach dem Claude-Limit führte Codex R17–R28 in getrennten Bereichen zu Ende. Native Teilabnahme:26/26; Hub/Adapter53/53; Gast-/CRDT34 gezielte Unitfälle. Frontend:11/11 kombinierte Browserfälle, danach zwei neue verzögerte Race-Repros ergänzt und alle6 HDHT-UI-Fälle erneut bestanden. Die beiden UI-Fixes verhindern Hoststart für ein inzwischen gewechseltes Dokument sowie ein nachträgliches Zurücksetzen nach doppeltem Stop. Browser-WSS ist real, native IPC in diesen UI-Tests simuliert; Root prüft die gebaute Electron-Anwendung separat.

- **R29:** Eigener verschlüsselter Repro konnte 10.000 leere Fortsetzungsfragmente halten, ohne das Bytebudget zu erhöhen. Codex erzwingt kanonische60-KiB-Fortsetzungen und nichtleere Endfragmente, leert Teilpuffer bei Close. Repro danach beim ersten Record `RECORD_INVALID`, retainedFragments0.52/52 fokussierte Crypto/PIN/Invitation/Session/Koordinator-Tests bestanden. Der zuvor wirkungslose R6-Test hält nun tatsächliche AES-Entschlüsselung an und prüft unterdrückte Ausgabe nach Close.
- **R30:** Nutzerreview zu `relayThrough` nachgeprüft: Nichtsetzen der Option genügt nicht gegen fremde Handshakes. Der dokumentierte HyperDHT-Firewall-Hook wird in DirectService zur gezielten Abweisung verwendet; vollständige Upstream-Absicherung bleibt außerhalb dieses Claims. Nachweis in nativer Regression ergänzen.
- **CSP:** Echte Browserprüfung deckte lokale Relay-Ports auf, die Validator zuließ und CSP blockierte. Nur `ws://127.0.0.1:*` und `ws://localhost:*` ergänzt, Remote weiterhinWSS. Native Chromium152-Probe bestätigt, dass IPv6-Literale in CSP ignoriert werden und localhost einen reinen::1-Server erreicht. IPv6-Loopback-URLs deshalb auf localhost normalisiert.
- **Initialer Gesamtunitlauf:** 680/683 bestanden, drei erste reale DHT-Fälle unter Gesamtlast mit Timeout fehlgeschlagen. Kompletter anschließender HDHT-Lauf16Dateien/113Tests bestanden. Lokale Testknoten werden ausdrücklich an127.0.0.1 gebunden wie die upstreamTestnet-Fabrik; finale Gesamtabnahme noch separat.
- **Build-Lifecycle:** `node --test tests/unit/*.test.mjs`:61/61 bestanden,11.16s, Log `/tmp/sketchdraw-149-build-lifecycle-tests.log`.

Alle Zahlen beziehen sich auf den jeweiligen lokalen Snapshot; finale Tests und Plattformgrenzen folgen. Kein öffentlicher Relay-Pool, Internet-NAT-Nachweis oder Signierung/Release daraus abgeleitet.

## Gebaute Desktop-App und macOS-Paket: bestätigte Abnahme

Stand:11.11.2026, lokaler Arbeitsbranch vor Commit. Vollständige Unit-Suite nach Loopback-Korrektur: **91 Dateien/692 Tests bestanden** (Root7,10s, unabhängiger Native-Reviewer6,93s). Vollständiger Typecheck und Produktionsbuild bestanden. Die Schleifen/Kandidatenlimits wurden dafür nicht gelockert.

**Electron:** Sechs vorhandene Produkt-/MCP-/Sandbox-/IPC-Fälle bestanden. Der neue siebte Fall startet zwei echte Electron-Prozesse mit unveränderten Produktbundles, nur App-Speicher und DHT-Bootstrap sind lokale Fixtures. Er bestätigte native URL/PIN-Verbindung, Editor-Sync, Gast-MCPentzug und HelperOpt-in. Beim ersten Lauf schlug der Endzustand fehl: R31, natives `hostStop` lief parallel vor dem vorgesehenen Abschluss-Flush. Nach geordneter Bereinigung bestanden der zusätzliche verzögerte Browser-Repro (7/7HDHT-UI-Fälle) und der echte Electron-Fall (2,5s). Danach bleibt der Gast read-only/MCP-gesperrt; explizite lokale Kopie stellt lokale Autorität wieder her. Logs:`/tmp/sketchdraw-149-final-electron.log`, `/tmp/sketchdraw-149-electron-r31.log`, `/tmp/sketchdraw-149-ui-r31.log`.

**Native Verpackung:** `CSC_IDENTITY_AUTO_DISCOVERY=false npx electron-builder --config electron-builder.json --dir --publish never --config.directories.output=/tmp/sketchdraw-149-package` erfolgreich. Tatsächlich gestartetes macOSarm64-Paket: `app.isPackaged=true`, sandbox/contextIsolation aktiv, NodeIntegration aus; Bundlehashes entsprechen dem geprüften Build. MCP-SDKinitialisiert alle6Tools und verweigert Zugriff ohne aktive Autorität. Die tatsächlich aus `app.asar` geladenen HyperDHT6.36.0/Streamx2.28.1/nativen Addons übertragen8.388.608Bytes im isoliertenDHT bytegleich. Kompakter maschinenlesbarer Beleg:`149-local-validation.json`.

Die ersten temporären Paketprüfaufrufe scheiterten an Prüfskript-/Pfadannahmen (Streamx verbietet den package.json-Subpath; macOS `/tmp` ist ein Symlink auf `/private/tmp`). Aufrufe korrigiert, erfolgreiche Ergebnisse oben; keine Produktänderung daraus. Kein veröffentlichterInstaller, kein Signierungs-/Notarisierungsnachweis und kein Windows-/Linux-Paketstart. Diese Plattformen benötigen separate CI-Läufe.


## Abschließende Abnahme nach Fable-Sparring und Großbild-Sync (#149/#150/#151)

Stand: 11.11.2026, lokaler Branch `codex/149-hyperdht-relay`, Basis `bd610f6`, noch nicht committed oder integriert. Dieser Abschnitt ersetzt ältere Zwischenzahlen für die aktuelle Abnahme; vorherige fehlgeschlagene Prüfungen und Korrekturen bleiben als Historie oben erhalten. Die konkreten Quell- und Paket-Hashes stehen in `149-local-validation.json`.

**Tatsächlich verwendetes Sparring:** Claude Code 2.1.321, `claude-fable-5-2 --effort high`, Sitzung `5db4e51b-d87f-4bd2-a71a-44ca84903e8c`, abgeschlossen, 50 Turns, 508,246 s. Die ältere CLI konnte dieses Modell nicht ausführen; kein Modellwechsel wurde als Fable ausgegeben. Originalreview, getrennte Codex-Gegenprüfung und gemessene CLI-Kosten/Token sind in `claude-149-fable-sparring.md` und `149-fable-metrics.json` erhalten. Fable las Code; Implementierungsfixes und sämtliche Tests stammen von Codex.

**Korrigiert:** alle fünf materiellen Fable-Befundgruppen (Großzustand/stilles Senden, Kontrollframe-Rückstau, Hub-Gesamtpuffer, vorzeitiger Direktabbruch/Link, PIN-Reconnect/Flattern) sowie das verbleibende native Abschlussfenster R31. Ein früher Relay-Link bleibt während noch laufendem Native-Start als ausdrückliche Aktion verfügbar; der funktionierende Gatewayweg wird nicht durch blockiertes UDP gesperrt. Grace bis Close oder einer Sekunde ist kein Remote-ACK.

**Bilder und gesamter Dokumentzustand:** Neue Nutzeranforderung in #151 umgesetzt. Normale Deltas bleiben auf 4 MiB begrenzt. Größere exakte Yjs-Zustände/Deltas werden bis 64 MiB in 48-KiB-Nutzdatenpaketen mit 60-Byte-Header, SHA-256 und Offset-/Längenprüfung transportiert. Acht Empfangsreservierungen, insgesamt 64 MiB, 30 s Leerlauf und 120 s Gesamtfrist; Standard-Beitrittsfrist weiterhin 35 s. Keine JSON-Neuerzeugung mit fremden Yjs-IDs. Das Dokumentformat bleibt unverändert (32 MiB JSON, 8 MiB pro Bild, 20 MiB Bilddaten insgesamt, 100 Seiten). Alte vier-MiB-APIs und Rollenprüfungen bleiben erhalten.

Das unabhängige Gegenreview reproduzierte drei Fehler im ersten Transferentwurf: Hash-Puffer zu früh freigegeben, inkrementeller Dokument-ID-Wechsel möglich, blockiertes Send bei Abbruch hängend. Alle ursprünglichen Repros bestehen nach Root-Korrektur; die Regressionen sind als Tests im lokalen Arbeitsstand gespeichert. Der Mehrpeer-Test fand außerdem eine unzulässige Sync-Antwortanforderung an Viewer nach Reconnect; Binding korrigiert. Warteschlangen unterscheiden Verbindungsgenerationen und wiederholen Teil-Broadcasts nicht an bereits erfolgreiche Empfänger.

**Realer Dokumentnachweis:** Zwei Integrationstests übertragen ein vollständiges PNG mit 1024 × 896 RGBA-Pixeln, gültigen CRCs/Zlib und einem Yjs-Zustand über 4 MiB. Verglichen werden der gesamte Dokumentinhalt sowie Hashes der tatsächlich dekodierten Bildbytes. Enthalten sind zwei Seiten, Shape, Freihandpfad, Text, Haftnotiz, Annotation, Kommentar und Aufgabe. Über den echten lokalen verschlüsselten WebSocket-Relay empfangen Editor und Viewer denselben Inhalt; nach neuer großer Grafik vom Editor, Host-Änderung und Viewer-Unterbrechung mit neuer Verbindung konvergiert alles. Über das echte isolierte HyperDHT-Netz sind Host/Gast-Inhalt, Notizänderung und zweites großes Gast-PNG ebenfalls identisch. Dies prüft den Host als Dokumentteilnehmer; Relay-Helfer erhalten keinen entschlüsselten Dokumentzustand.

| Prüfung des finalen lokalen Stands | Ergebnis | Beleg |
| --- | --- | --- |
| `npm run test:unit` | 96 Dateien, **751/751 bestanden** | `/tmp/sketchdraw-151-final-unit.log` |
| `npm run typecheck` und `npm run build` | beide bestanden | `/tmp/sketchdraw-151-final-typecheck.log`, `/tmp/sketchdraw-151-final-build.log` |
| `node --test tests/unit/*.test.mjs` | **61/61 bestanden** | `/tmp/sketchdraw-151-build-lifecycle.log` |
| `python3 -m unittest discover -s tools/tests -v` | **22/22 bestanden** | `/tmp/sketchdraw-151-python-graphify.log` |
| `npx playwright test tests/ui/hdht-session.spec.ts --config playwright.config.ts --project=ui` | **10/10 bestanden**, 21,5 s | `/tmp/sketchdraw-151-final-ui-confirmed.log` |
| `npx playwright test --config playwright.config.ts --project=electron` | **7/7 bestanden**, 23,5 s; echte native Zwei-Prozess-Verbindung enthalten | `/tmp/sketchdraw-151-final-electron.log` |
| Neues lokales macOS-arm64-Verzeichnispaket und `smokeInstalledApp` | gebaut, echtes `isPackaged`, Sandbox, MCP-Initialisierung/fehlende Autorität geprüft | `/tmp/sketchdraw-151-package.log`, `/tmp/sketchdraw-151-package-smoke.log` |
| HyperDHT/Streamx aus dem neuen tatsächlichen `app.asar` | **8.388.608 Bytes bytegleich** im isolierten Netz | `/tmp/sketchdraw-151-native-package.log` |

Die erste finale UI-Runde hatte 8/10 bestanden: Zwei Tests verlangten nach einem einmaligen Socketfehler fälschlich einen dauerhaften Abbruch. Der korrigierte Verbindungsgenerationspfad hatte sich bereits erholt. Ausschließlich diese Erwartungen wurden angepasst: tatsächliche Unterbrechung, Gast-Schreibsperre/MCP-Entzug, Nachlieferung der zunächst nicht gesendeten Ellipse und neue Gegenrichtungsänderung müssen nachgewiesen werden. Beide Einzelfälle und danach alle zehn Fälle bestanden. Nicht behebbarer aktiver Sendefehler bleibt durch Unit-Test abgedeckt. Ein weiterer Aufruf verwendete den nicht vorhandenen Playwright-Projektnamen `chromium` und startete keine Tests; mit dem vorhandenen Projekt `ui` durchgeführt, wie oben angegeben. Keine Produktlimits oder Testzeitbudgets aufgeweicht.

**Offene Grenzen und Fortsetzung:** Öffentliche NAT-/CGNAT-/Proxy-/Skalierungsprüfung bleibt #72. Keine öffentliche Helferflotte, universelle Erreichbarkeit, maximale Dokumentbelastung oder RSS-/UDX-/Kernelgrenze belegt. Fables verbleibende Suchlast-/Eignungs-/Weiterleitungsprüfung ist als eigener Folgeauftrag #152 erfasst, keine abgeschlossene Implementierung. Windows-/Linux-Paketstart, Signatur, Notarisierung, Installer und Release wurden für diesen Stand nicht ausgeführt. Alle drei Umsetzungstickets bleiben bis Zielbranchintegration offen.

**Graphify:** `graphify update .` extrahierte 444 Dateien, verweigerte aber wegen 5.801 neuen gegenüber 6.036 vorhandenen Knoten das Überschreiben. Nicht als Erfolg verbucht und nicht mit `--force` umgangen; #145 mit neuem Repro aktualisiert. Die getrennte Ledger-/Traceability-Projektion wird nach den letzten GitHub-Updates erneut erzeugt und geprüft; sie ist kein frischer vollständiger Codegraph.

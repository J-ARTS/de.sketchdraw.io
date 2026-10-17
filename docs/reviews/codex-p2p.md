# Codex-Implementierung und Eigenprüfung: Strict P2P v1

Stand: 17.10.2026, lokale Arbeitsdateien; unabhängige Root-Gesamtabnahme und die Wiederholung der nativen UI-Abnahme stehen aus. Tickets: [#14](https://github.com/J-ARTS/de.sketchdraw.io/issues/14), gemeinsame Authority aus [#13](https://github.com/J-ARTS/de.sketchdraw.io/issues/13). Tatsächliches Werkzeug: OpenAI Codex, delegierter Implementierer `/root/domain_review`. Dies ist kein Claude-Code- oder Antigravity-Bericht. Deren zuvor gestarteter P2P-Lauf hatte keinen Produktcode geliefert; die Übernahme wurde durch Root im autorisierten Umfang beauftragt.

## Ergebnis und Grenze der Aussage

`src/collaboration/` enthält die Owner-/Guest-Fabriken auf echter Browser-WebCrypto und nativer WebRTC-API. Es gibt keine Produktions-Dummyverbindung, keinen zweiten Ownercontroller, keine Serververmittlung und keine STUN-/TURN-Konfiguration. Die native Verbindung ist auf Linux **positiv nachgewiesen**: zwei echte Chromium-Kontexte und zwei echte Electronfenster bestanden im CI-Lauf (ohne bestätigte OS-Sandbox, siehe Korrektur unten). Auf dem lokalen macOS-Host endeten beide Varianten zuvor mit `DIRECT_CONNECTION_TIMEOUT`; dessen Ursache bleibt offen. Die vollständige Zwei-App-UI-Abnahme erreichte erfolgreich Pairing und entfernte Mutation, scheiterte anschließend an einer mehrdeutigen Testselektion von Dokumentelement plus Entwurf. Der Locator-/Outcomeablauf ist korrigiert, die Wiederholung steht aus. P2P-Gesamtabnahme und Ticketabschluss bleiben daher offen.

Der native Test verlangt einen erfolgreichen Datenaustausch. Ein Timeout wird weder übersprungen noch als Erfolg gewertet. Die vollständige Zwei-App-UI-Abnahme wird auf Root-Anforderung in Linux CI ausgeführt; sie behandelt ein bestätigtes Dokumentelement und eine noch ausstehende Vorschau ausdrücklich getrennt.

## Implementierte Verträge

- Öffentliche Exporte entsprechen [contracts-p2p.md](../contracts-p2p.md) §3: `createSessionIdentity`, `createOwnerSession`, `acceptInvitation`, die zugehörigen Session-/Pairingtypen und readonly Source/Gateway/Lifecycle-Komposition.
- P-256/SHA-256 mit nicht exportierbarem privatem Schlüssel, Laufzeitregistrierung gültiger Identityhandles, exakt signierte UTF-8-JSON-Payloads, 64-Byte-WebCrypto-Signaturen. Beide signierten Pairingpakete binden Session, Rolle, vollständiges SDP, Nonce, Ablaufzeit und DTLS-Fingerprint. Acht Vierergruppen ergeben den vollständigen 128-Bit-Vergleichscode.
- Der tatsächliche erste Remote-DTLS-Zertifikathash wird vor Dokumentfreigabe gegen das signierte SDP geprüft. Beide menschlichen Bestätigungen und signierten Gegenbestätigungen sind erforderlich. Fehlt die native Zertifikatsfunktion/-kette, wird geschlossen. Die erfolgreichen nativen Linux-Fabriktests durchliefen auch diese Zertifikatsprüfung; die Ablehnungslogik ist separat im Protokolltest geprüft.
- Additiv von Root freigegeben: `PairingReview.ownerDtlsFingerprint?` und `peerDtlsFingerprint?`. Beide Fabriken liefern die vollständigen verifizierten signierten Werte; Tests vergleichen sie beidseitig. §3 wurde entsprechend ergänzt.
- Timerkorrektur nach Rootbefund: Der Owner hat 30 s ab importiertem Answer; beim Gast startet die kurze Netzwerkfrist erst mit seiner expliziten Codebestätigung, falls der Transport noch fehlt. Vorher läuft eine begrenzte lokale 5-Minuten-Frist für die manuelle Antwortübermittlung. Die originale monotone Owner-Einladungsfrist bleibt maßgeblich und wird nicht verlängert. Die zwei Minuten Fingerprintbestätigung beginnen nach verifiziertem DTLS-Aufbau. Wiederholte Bestätigung setzt keine Frist zurück. Native terminale Verbindungsfehler bleiben Abbruchgründe. Drei Regressionen prüfen den Ablauf.
- Genau zwei zuverlässige, geordnete Datenkanäle; `iceServers: []`, keine Medien, keine zusätzliche Transportart/Channel/Neuverhandlung. Manuelles vollständiges Gathering mit Deadline, neue Verbindung bei Reconnect, explizite Timeouts und Heartbeats.
- Strikte begrenzte JSON- und Wirevalidierung einschließlich doppelter/gefährlicher Schlüssel, nicht endlicher Zahlen, unbekannter Felder und unerlaubtem `null`; SDP-Import verweigert Medien und relay-/srflx-Kandidaten.
- Signierte Manifeste, Reservierung vor Allokation, Ready-Handschlag vor Binärchunks, tatsächliches SCTP-Maximum und eigenes 16-KiB-Maximum, Header-/Offset-/Chunkanzahl-/Duplikatprüfung, Gesamthash, fatales UTF-8-Decoding und Domainvalidierung vor Mirrorinstallation. Empfangsreservierung bleibt bis tatsächlicher Validierung/Verwendung gehalten.
- Ein gemeinsames Owner-Retentionsbudget für Hashqueue, Snapshots, Commitlog und referenzierte Peerqueues; dieselben Commitbytes werden einmal gezählt. Grenzen: 256 Commits/64 MiB, höchstens vier Gäste/zwei zusätzliche Pairings, global zwei Inboundtransfers/80 MiB, pro Verbindung ein Inbound-/Outboundtransfer und ein gemeinsamer begrenzter Sendepuffer. Die Ergebnisdigests/-ausgänge werden ownerweit auf 1.024 begrenzt; ihre geschlossenen kleinen Schemas liegen insgesamt unter 4 MiB. Kein vollständiges Dokument im Ergebnisjournal. Ressourcenüberlauf schließt die betreffende Verbindung bzw. die Zusammenarbeit, lokale Authoritybearbeitung bleibt erhalten.
- Ein einziger Owner-Authority-Schreibweg für Gäste und lokale Aktionen. Der Guard bindet Rolle, aktuelle authentifizierte Verbindung, Scope und Session. Eine alte wartende Verbindung wird durch den Reconnect nicht nachträglich autorisiert. CAS, actorbezogenes Undo/Redo, No-Op ohne Revision, ID-/Intentdigestprüfung, High-Water-Mark und Ausgänge verwenden die gemeinsame Authority. Drei abweichende Wiederverwendungen eines angenommenen Request-IDs schließen den Peer.
- Reconnect behält Identity, Scope und ungeklärten Intent. Originalbytes/ID/Digest bleiben bis zur Klärung stabil; keine automatische neue ID, kein optimistischer Canvascommit und kein automatischer CAS-Retry. Ergebnis und Mirror kommen getrennt: `committed` bestätigt die Ownerrevision; UI muss den betreffenden Entwurf bis zum passenden bestätigten Mirror halten.
- Erhaltene Commitstrecken werden nachgeladen. Interne Wirekonkretisierung: ein frischer noncegebundener `checkpoint` mit `transferId: null` bestätigt ausschließlich eine bereits lokal validierte identische Revision/Hashbasis; er installiert keinen anderen Zustand. Anschließend folgen lückenlose Retentionscommits. Ist die Strecke nicht vollständig, erfolgt ein vollständig validierter Snapshot. Veraltete/fremde Checkpoints erlauben keinen Mirrorwechsel.
- Der Gast hat keinen Domaincontroller. Er hält einen validierten bestätigten Mirror und eine lokale Lifecyclebarriere, die neue Übermittlung und Mirrorinstallation synchron einfriert; Cancel setzt die Verarbeitung fort. Gesendete ungeklärte IDs stehen in der Barriere. Widerruf/Leave bewahrt den bereits empfangenen letzten Stand lesbar.
- Ownerende widerruft Peer-Bindings synchron und finalisiert nur die Peergruppe; lokale History/Bindings bleiben bestehen. Bereits abgeschlossene/abweichende Authority verhindert das Schließen von PCs, Einladungen, Timern und Abonnements nicht. Ein best-effort Abschlussframe wartet höchstens 250 ms, ohne entferntes ACK zu verlangen. `getStatus()` bleibt nach Ownerclose lesbar.
- Guest-MCP-Scope-Registrierung wird bewusst mit `ACCESS_DENIED` verweigert, solange die getrennte autorisierte lokale Grantbridge nicht geliefert ist. Es gibt keine unterstellte oder simulierte Guest-MCP-Integration; dieser im Vertrag benannte Integrationsumfang bleibt offen.

## Prüfungen

Umgebung: macOS 14.6.1 (23G93), arm64, Node v22.16.0; installierte Paketpins: TypeScript 6.0.3, Vitest 5.0.5, Playwright 1.64.1, Electron 44.9.0. Der native Browserlauf verwendet das installierte Playwright-Chromium; Root hat den Browserstand separat als Chromium 156 diagnostiziert.

| Prüfung | Tatsächliches Ergebnis |
| --- | --- |
| `npx vitest run tests/unit/collaboration tests/unit/session` | **Bestanden: 44/44**, 3 Dateien, letzter Lauf 17.10.2026 16:49:33 Europe/Berlin, 2,16 s. Davon 25 neue Collaborationtests, 19 bestehende Authoritytests. |
| Strikter isolierter Typecheck, Befehl unten | Bestanden nach finalen Änderungen an Produktcode/Tests. |
| `npx playwright test --config tests/p2p/playwright.config.ts --list` | Bestanden: alle drei nativen Tests erkannt. Dies ist keine Ausführung der positiven UI-Abnahme. |
| `npx playwright test --config tests/p2p/playwright.config.ts` im früheren lokalen Zwischenstand | **Fehlgeschlagen: 2/2** (damals Chromium- und Electron-Fabriktest), jeweils `DIRECT_CONNECTION_TIMEOUT`, circa 30 bzw. 31 Sekunden. |
| Linux-CI auf `f8c55fb2d8250b236aa133609462894a402db40a` | **2 bestanden / 1 fehlgeschlagen**: Chromium-Fabrik 496 ms, Electron-Fabrik 6,7 s; OS-Sandbox in diesem Lauf nicht aktiv bestätigt. UI verband sich, replizierte eine Gastellipse und scheiterte an `locator.getAttribute` wegen Dokumentelement plus Draft mit gleicher ID. |
| Überarbeitete native UI-Abnahme, Sandboxassertions und Timerkorrektur | **Noch nicht nativ wiederholt**: semantische Dokument-/Draftselektion und Outcomeabfrage korrigiert; Root übernimmt erneuten CI-Lauf. Kein vollständiger UI-Pass behauptet. |
| Gesamtrepository-Typecheck | Während paralleler Änderungen zuletzt fremde Fehler in Interop-/Renderer-Testdateien; kein Collaborationfehler. Root übernimmt finale Gesamtprüfung. |

Strikter gezielter Typecheck:

```sh
npx tsc --ignoreConfig --noEmit --strict --noUncheckedIndexedAccess --target ES2022 --module ESNext --moduleResolution Bundler --lib ES2022,DOM --types node --skipLibCheck src/collaboration/index.ts tests/unit/collaboration/*.spec.ts tests/p2p/native.spec.ts
```

Die 25 Collaborationtests verwenden ausschließlich in Tests einen gepaarten RTC-Transportdouble. WebCrypto, Protokoll, Domaincontroller und Authority bleiben echt. Der Double kann weder ICE noch native DTLS-Kompatibilität belegen. Wesentliche Fälle: beidseitige Bestätigung vor Freigabe, reale Signatur-/Transcriptprüfung, falsches Zertifikat, Viewer-Bypass am Owner, CAS/No-Op/actorbezogenes Undo/Redo, doppelte und missbräuchlich wiederverwendete IDs, verlorene Antwort/gleichidentischer Reconnect, Retentionsreplay und Snapshotfallback nach 258 Offlinecommits, Lifecyclefreeze/Cancel, bereits geschlossene Authority, korrupter Bulktransfer, kleine ausgehandelte 4.096-Byte-Grenze mit Unicode und gültiges Dokument innerhalb 1 KiB von 32 MiB einschließlich eingebettetem PNG/Image-Element (mehrere Tausend Chunks).

## Native Diagnose und nächster Nachweis

Beide nativen Fabriktests benutzen wirkliche PeerConnections; die Fixture beobachtet lediglich die native API. Es werden keine mDNS-Abschwächungen oder ICE-Dienste verwendet. Electron verwendet getrennte Sessions, explizite Fensterpräferenzen `sandbox: true`, `contextIsolation: true`, `nodeIntegration: false`, `webSecurity: true` und verweigert alle Permissions. **Korrektur des frühen Testnachweises:** Playwright fügte beim früheren Electronstart mangels `chromiumSandbox: true` automatisch `--no-sandbox` hinzu. Der frühe Linux-Pass belegt echten P2P-Datenaustausch, keine aktive Betriebssystem-Sandbox. Der überarbeitete Test setzt `chromiumSandbox: true`, prüft `app.commandLine.hasSwitch('no-sandbox') === false` und die drei relevanten WebPreferences beider Fenster. Dieser Sandboxlauf muss erneut bestehen; ein Startfehler darf nicht durch Abschwächung umgangen werden.

Bestätigte Diagnose auf beiden Enden: ICE-Gathering vollständig, jeweils zwei lokale/zwei entfernte Kandidaten, ICE-/Connectionstate bleiben `new`, keine Candidate-Pairs und keine Remotezertifikate. Die Electron-Permissionbeobachtung enthält vier Checks für `media`, keinen `local-network` Request. Die Quelle einer Medienpermission ist damit nicht als notwendige Freigabe für DataChannels bewiesen; es wurde nichts freigegeben. Eine mDNS-/Umgebungsursache ist eine Hypothese, keine bestätigte Fehlerursache. Diese lokale Diagnose widerlegt den positiven Linux-Nachweis nicht. Die erfolgreiche Linux-DTLS-Verbindung durchlief die echte Remotezertifikatsprüfung.

Lokale Artefakte (ignoriertes `test-results`, für CI dauerhaft hochladen):

- `test-results/p2p/native-two-native-Chromium-68c47--no-configured-ICE-services/native-peer-0.json` und `native-peer-1.json`
- `test-results/p2p/native-two-sandboxed-Elect-82169--and-exercise-native-WebRTC/electron-peer-0.json`, `electron-peer-1.json`, `electron-permission-events.json`
- Entsprechende Playwright-Attachments/Fehlerkontexte unter denselben Verzeichnissen. Diagnosen enthalten Zustände/Zählwerte statt vollständiger SDP-/IP-Dumps.

Der überarbeitete UI-Test wartet nach dem Gastcommit auf `[data-render-state=document]` an beiden Enden und löst einen sichtbaren ausstehenden Ausgang durch „Ausgang prüfen“, bis kein `draft` mehr vorhanden ist. Eine Vorschau wird weder als bestätigtes Element gezählt noch mit `first()` ignoriert.

Der vollständige UI-Test unter `tests/p2p/native.spec.ts` verwendet zwei getrennte Browserkontexte mit der echten App auf `/`: Owner zeichnet ein Rechteck, UI-Einladung/Antwort mit Editorrolle, vollständiger Codevergleich und Checkboxen, kein Diagramm beim Gast vor Bestätigung, neue Gast-Ellipse mit gleicher Element-ID beim Owner, Leave-Dialog und danach unabhängig editierbare lokale Kopie. Keine direkte Testmutation des Produktstores und keine simulierte Freigabe.

Verifizierter Linux-Nachweis: [Run 39041998555, Job 117423198082](https://github.com/J-ARTS/de.sketchdraw.io/actions/runs/39041998555/job/117423198082), Checkout `f8c55fb2d8250b236aa133609462894a402db40a`, 17.10.2026 14:44 UTC, Node 22.16.0 / Chrome Headless Shell 156.0.8078.4. Der von Root abgelegte Log `/tmp/sketchdraw-p2p-ci.log` wurde direkt geprüft (Testausgänge ab Zeile 397). [Diagnoseartefakt](https://github.com/J-ARTS/de.sketchdraw.io/actions/runs/39041998555/artifacts/12104288122), ZIP-SHA256 `ee27282db5b0a78d93d767a504ded2c72063ebd3728ae6283c30a652a4598524`. Die späteren Timer-/UI-Test-/Sandboxänderungen sind durch dieses frühere CI-Ergebnis noch nicht geprüft.

Linux-CI-Voraussetzungen und Befehl (Root verwaltet den Workflow):

```sh
npm ci
npx playwright install --with-deps chromium
xvfb-run --auto-servernum npx playwright test --config tests/p2p/playwright.config.ts
```

Port 5184 muss frei sein; die Konfiguration startet Vite selbst. Alle `test-results/p2p/**` auch bei Fehlschlag hochladen. Tests verlangen echte positive Verbindung/Mutation; keine bedingten Skips, keine TURN-/STUN-Fallbacks. Windows, reale getrennte Rechner/LAN, restriktive NAT-Netze und großes Dokument über einen tatsächlich verbundenen nativen Transport sind noch nicht abgenommen.

## Read-only UI-Review an Root

Der parallel gelieferte `CollaborationPanel.vue` wurde nur gelesen. Zurückgemeldete konkrete Integrationsbefunde: Ownercleanup nach bereits abgeschlossener Authority (hier behoben+Regression), obsolete Ownererzeugung nach Epochwechsel, Pairingcancel während erfolgreichem Guestjoin und Readiness-Abonnements (Root hatte diese bereits in Arbeit), veralteter Abschlussstatus bei `endOwner` sowie nachträglich gewechselter Guest beim Leave-Dialog (Root hat Capturing/Busy/Epochchecks ergänzt). Zuletzt gemeldet und von Root mit Epochprüfung behoben: unbedingtes `confirm`-finally durfte nicht die Busy-Sperre einer jüngeren Operation freigeben. Die finale UI-Regression und deren Freigabe gehören zur Rootintegration; dieser Eigenbericht behauptet dafür keinen bestandenen Test.

## Quellen der technischen Prüfung

- [W3C WebRTC: RTCDtlsTransport und getRemoteCertificates](https://www.w3.org/TR/webrtc/#rtcdtlstransport-interface)
- [W3C WebRTC: RTCDataChannel und bufferedAmount](https://www.w3.org/TR/webrtc/#rtcdatachannel)
- [Electron Session: Permissionhandler](https://www.electronjs.org/docs/latest/api/session) – `local-network` ist ein dokumentierter Permissionname; das ist kein Beweis, dass hier ein entsprechender Request stattfand.
- [WebRTC-Primärquelle: Local Network Access Permission](https://webrtc.googlesource.com/src/+/refs/heads/main/api/local_network_access_permission.h)

## Geprüfte Arbeitsdateien (SHA-256)

Die Hashes referenzieren lokale Dateien, nicht einen behaupteten integrierten Commit. Folgeänderungen erfordern erneute betroffene Prüfungen.

| Datei | SHA-256 |
| --- | --- |
| `src/collaboration/crypto.ts` | `49d76366f9d6715849d817bf7e47c093636ef2177566e7da5489538373633d47` |
| `src/collaboration/guest.ts` | `7678c31fcc9c5adae4d6c57441d672c81a20d3624262c5dd6b1457a14429c059` |
| `src/collaboration/index.ts` | `7c2841043c7524a893baf7079100e305f70a2a6ab8148a8a74d1000774c20017` |
| `src/collaboration/link.ts` | `c326369692ec6e64de7eb0f84715ecb3973b9859b32b5c63ad10e373cb3b8db3` |
| `src/collaboration/owner.ts` | `a0622fde42e8045e11af056760759869561e115756517e00a956f2a3006acad4` |
| `src/collaboration/primitives.ts` | `4e84d1b36be6627e68574e089805b604746c6797af7a677b77f28db00b1b8432` |
| `src/collaboration/sessions.ts` | `c4c46fd861cd9c09dbc89090e61672a809ddd0b7229b055197e3d5128a019c47` |
| `src/collaboration/types.ts` | `ef2d8464d13a2996a72ab71ca657f2c76da542209a2ed717e2dee96c72e34c64` |
| `src/collaboration/wire.ts` | `667d96478b6cf482297ef807da02eea2ae2b006b6d649ff8f91b99a6763ed726` |
| `tests/unit/collaboration/protocol.spec.ts` | `05ab929578c484fabe5fe85b02c72960ff455a0618c8b3c6bfe6623b062fcfe9` |
| `tests/unit/collaboration/rtc-double.ts` | `6b7fb324e439a12b5e6e92c7f8adb34b820c07ddd31330b37e5525096ce02092` |
| `tests/unit/collaboration/session.spec.ts` | `150b197c1061969cbcdb009201b24b9ca738804f124e84442241ddd8042c613a` |
| `tests/p2p/electron-main.cjs` | `87c687c2888be42319c703402e2b9db6d041d1f00197a5db669891ca2ffd6c95` |
| `tests/p2p/fixture.html` | `401e70153d3ce4782e0332bcb75aca23fe1134c9a968bb169c8136b47fb9b0d6` |
| `tests/p2p/native.spec.ts` | `144654508cd3fbcd302a6f5893ca90174fefb3a95851aec1de5da1902e6c576a` |
| `tests/p2p/playwright.config.ts` | `c6a7a83ae14a0e0dbbba6163941b0bb8e00f7a962336792adeb52a012f4462ab` |
| `docs/contracts-p2p.md` | `c2204565064940cb2fd2b2dba88573dc05522a2e773c386a842891c45853b434` |

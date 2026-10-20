# Lokaler Agentenzugriff — Vertrag

Issues #6/#13/#30, Codex, 17.10.2026. Dieser Vertrag ergänzt S1 nach unabhängigem Review MC-01–MC-06 und enthält die mit #30 eingeführte automatische lokale Bereitstellung. Der aktuelle Produktnachweis verwendet einen echten stdio-MCP-Client gegen die laufende Electron-App.

## Zweck und Datenhoheit

Externe Agenten lesen und verändern dasselbe geöffnete Dokument wie der Mensch. Ein eigener unsichtbarer MCP-Dokumentspeicher erfüllt die Anforderung nicht. Der Renderer hält den aktiven `DocumentController`; Main vermittelt berechtigte lokale Anfragen, ohne eine zweite schreibbare Modellkopie zu führen. Canvas, Code, MCP und später P2P müssen denselben kontrollierten Commitweg nutzen.

Für jede aktive lokale `DocumentAuthority` erzeugt Main automatisch genau eine interne Schreibfreigabe. Es gibt keinen Freigabe-Tab, keinen manuellen Read-only-Modus und keine Modell-/Herstelleridentifikation. Die Freigabe besitzt eine zufällige 256-Bit-Capability, Grant-ID, Generation, Dokument-ID und Session-Epoche. Main veröffentlicht sie zusammen mit der exakten gebündelten Client-Konfiguration ausschließlich in einer privaten Datei des aktuellen Betriebssystemkontos. Das Geheimnis erscheint weder in Diagrammen noch Logs, Issues oder Fehlermeldungen. Jede Controller-Neuerzeugung, auch erneutes Öffnen derselben Datei, Gastmodus, Schließen oder Renderer-/App-Neustart invalidiert die Capability und erzeugt bei der nächsten lokalen Authority eine neue. Main bindet sie zusätzlich an die aktuelle WebContents-/Navigationsgeneration. Der stdio-Adapter verbindet nach einem sicheren Zugriffsfehler gegen den neuen Stand; eine ungeklärte laufende Mutation wird nicht automatisch wiederholt.

## Prozesse und Verbindung

- Der externe Host startet einen gebündelten stdio-MCP-Adapter. stdout enthält ausschließlich MCP-Nachrichten; Diagnose auf stderr ohne Geheimnisse oder Diagramminhalte.
- Auf macOS/Linux verbindet sich der Adapter über einen Unix-Domain-Socket in einem privaten, besitzergeprüften Verzeichnis (0700, Socket0600, keine fremden Symlinks, begrenzter Pfad). Auf Windows wird nach MC-05 ausdrücklich ein roher TCP-Listener nur auf der numerischen IPv4-Adresse `127.0.0.1` und einem ephemeren Port verwendet. Kein HTTP-/WebSocket-Protokoll, keine Wildcard-/LAN-Adresse, keine Firewalländerung und keine fremde Hostauflösung. Nach `listening` wird die tatsächliche Bindung geprüft. Andere lokale Prozesse können verbinden; nur Authentifizierung erlaubt Dokumentzugriff. Dies ist lokale Prozesskommunikation, kein P2P-Signaling/Relay oder zentraler Dokumentdienst. `exclusive:true` bedeutet keine behauptete Windows-OS-Exklusivitätsgarantie. Listenerverlust invalidiert alle zugehörigen Grants; kein stiller Reconnect über App-Generationen.
- Endpoint und Capability kommen aus der festen privaten Sketchdraw-Laufzeitdatei des angemeldeten Betriebssystemkontos. `SKETCHDRAW_MCP_RUNTIME_FILE` darf für Entwicklung und isolierte Tests einen absoluten Pfad vorgeben; Modellargumente können keinen Pfad wählen. Der Adapter durchsucht keine fremden App-Instanzen oder Benutzerverzeichnisse. Explizite Umgebungsvariablen bleiben als Abwärtskompatibilität alter Client-Einträge erhalten und wechseln nach abgelaufenem Zugriff auf die aktuelle Laufzeitdatei.
- Verbindungen werden vor Dokumentdaten gegenseitig authentifiziert; die Capability wird nicht im Transport übertragen. Danach trägt jede Anfrage requestId, erlaubte Operation, Grant-ID/Generation, Dokument-ID und Epoche. Main prüft sie vor Weiterleitung und vor Rückgabe; der Renderer prüft seine lokale Grant-Generation unmittelbar vor jedem Commit synchron. Ein Client darf weder Actor noch Rechte hocheskalieren. Ein nachträglicher Authfehler macht einen bereits linearisierten Commit nicht rückgängig.
- Ein JSON-Frame je LF. Bytes vor JSON-Parse an beiden Eingängen (Host→stdio und Adapter→Main) begrenzen: höchstens40MiB einschließlich Envelope; vor Auth höchstens4KiB. Höchstens16 Verbindungen insgesamt, davon8 unauthentifiziert,8 aktive Grants,16 laufende Requests insgesamt und128MiB aggregierte Transportbuffer. Auth muss nach5s abgeschlossen sein, sonst Socket aktiv schließen. Pro authentifiziertem Client höchstens2 parallele Requests. Größenüberschreitung schließt die betroffene Verbindung mit begrenztem Fehler; keine unbeschränkte Warteschlange. Responsegrößen ebenfalls begrenzen. Große Assetdaten nur auf ausdrücklich angefragtem vollständigem Dokument, nicht in jeder Suchantwort.
- Keine beliebige Shell, kein freier Dateizugriff und keine automatischen HTTP-Abrufe aus Dokumentationslinks. Der Zugriff auf das Dokument gewährt keine Desktop-Dateirechte.

## Enger Renderer/Main-Vertrag

Separate typisierte Erweiterung der DesktopBridge erst nach Abgleich mit #8/#10:

1. Renderer meldet die aktive lokale Dokument-ID und neue Controller-Epoche an Main, auch bei identischer persistenter Dokument-ID. Main beendet vorherige Verbindungen, installiert automatisch eine interne Schreibfreigabe und ersetzt die private Laufzeitdatei atomar.
2. Beim Abmelden der Authority, Gastmodus, Navigation oder Schließen entfernt Main die zugehörige Laufzeitdatei und schließt Host sowie Verbindungen. Ein verspätetes Abmelden darf eine bereits neuere Sitzung nicht löschen.
3. Main sendet eine geprüfte Anfrage mit eigener unvorhersagbarer Korrelations-ID. Renderer akzeptiert nur den benannten Preload-Kanal und die aktive Dokument-/Controller-/Grant-Generation. Reads liefern den aktuellen ReadonlyDocumentSource-Snapshot; Writes laufen über dieselbe DocumentAuthority und einen gebundenen WriteGateway wie Human/Code/Import/Peer. Kein direkter zweiter Controllerpfad. `expectedRevision` ist verpflichtend, Actor und Quelle `agent` werden von der eigenen Komposition gebunden.
4. Renderer antwortet mit derselben Korrelations-ID. Main akzeptiert nur die eigene ausstehende Anfrage und den geprüften Hauptframe. Timeout, Renderer-Ausfall oder Dokumentwechsel werden als Fehler gemeldet, niemals als Erfolg.
5. Mutationen haben eine Client-Command-ID (ASCII-ID,1–128 Zeichen). Vor dem ersten await wird unter Grant/Controller-Epoche/Command-ID ein Pending-Eintrag reserviert. Fingerprint umfasst Operation, Dokument, erwartete Revision und kanonischen Payload. Identische Wiederholung hängt am selben Pending-Ergebnis; anderer Inhalt wird als REQUEST_ID_REUSED abgewiesen. Die Renderer-Commitgrenze ist ebenfalls dedupliziert. Timeout entfernt keinen ungeklärten Eintrag: vor nachweislichem Commitabbruch REQUEST_TIMEOUT, bei möglichem Commit OUTCOME_UNKNOWN. Keine automatische Wiederholung mit neuer Revision/ID. Maximal4096 Mutations-IDs je interner Sitzung, jeweils nur begrenzte Ergebnisdaten ohne Dokumentbytes; keine Verdrängung zum stillen Wiederverwenden, bei Ausschöpfung `JOURNAL_FULL`. No-Op-Resultate werden genauso reserviert und gespeichert. Das Journal bildet auf die interne Gateway-ID ab; keine Exactly-once-Zusage über neue Grants/App-Neustarts.

Eine eigene `window.sketchdrawAgentAccess`-Fassade registriert und entfernt ausschließlich die aktuelle Sitzung sowie die begrenzten Control-/Request-Handler. Sie besitzt keine öffentlichen Grant-Erstellungs-, Listen- oder Widerrufsmethoden. Browser ohne echte Desktopbrücke exponieren die Fassade nicht. Das ist keine Erlaubnis, `ipcRenderer`, einen beliebigen Kanalnamen oder ein generisches Main-Callback in den Renderer zu geben. Main und Renderer validieren Daten jeweils an ihrer Grenze.

## Öffentliche MCP-Werkzeuge

| Werkzeug | Eingabe / Wirkung | Recht |
| --- | --- | --- |
| `sketchdraw_read_document` | Optionale aktuelle Dokument-ID; Snapshot mit Revision, optional mit Assetbytes. | read |
| `sketchdraw_find_elements` | Optionale aktuelle Dokument-ID, Suchtext und begrenzte Ergebnisanzahl; keine eval-Ausdrücke. | read |
| `sketchdraw_analyze_document` | Optionale aktuelle Dokument-ID; deterministische Strukturübersicht und tatsächlich prüfbare Befunde. | read |
| `sketchdraw_apply_commands` | Optionale aktuelle Dokument-ID, expectedRevision, commandId, begrenztes `DocumentCommand`; ein atomarer Commit. | write |
| `sketchdraw_read_code` | Optionale aktuelle Dokument-ID; native Diagrammsyntax, Revision und Formatversion. | read |
| `sketchdraw_apply_code` | Optionale aktuelle Dokument-ID, expectedRevision, commandId, Text; atomarer Replace derselben Dokument-ID. | write |

Alle Tools liefern strukturierte Resultate und verständliche Fehlermeldungen. Schreibtools sind entsprechend annotiert, aber Annotationen ersetzen keine Berechtigungsprüfung. Keine freie Argumentation aus einem Diagramm wird als Systemanweisung übernommen. Zugriffslimits gelten auch für formal gültige Anfragen.

Fehlercodes mindestens: `ACCESS_DENIED`, `ACCESS_REVOKED`, `DOCUMENT_MISMATCH`, `SESSION_CHANGED`, `REVISION_CONFLICT`, `VALIDATION_FAILED`, `REQUEST_TOO_LARGE`, `BUSY`, `REQUEST_TIMEOUT`, `OUTCOME_UNKNOWN`. Schemafehler nennen Pfad/Code, aber keine Capability oder lokalen Dateipfade. Konflikte enthalten nur nach erfolgreicher Rechteprüfung die aktuelle Revision.

## Seiten (Schema v2)

`sketchdraw_read_document` liefert `document.pages` und je Element `pageId`; `sketchdraw_find_elements` nennt `pageId` je Treffer; `sketchdraw_analyze_document` enthält `summary.pageCount`; `sketchdraw_read_code` liefert `formatVersion: 2` (Abschnitte `page "id" {"name":…}`), `sketchdraw_apply_code` liest auch Skripte mit `sketchdraw 1`. `sketchdraw_apply_commands` kennt `add-page`, `rename-page`, `delete-page`, `reorder-pages`; ein `add` ohne `pageId` ist bei mehreren Seiten ein Fehler (`VALIDATION_FAILED`) statt einer stillen Wahl der ersten Seite. Die aktive Seite der Oberfläche ist kein Dokumentzustand.

## SDK und Kompatibilität

Codex hat nach Prüfung der offiziellen npm-Metadaten am17.10.2026 `@modelcontextprotocol/server@2.3.1`, `@modelcontextprotocol/client@2.3.1` und `zod@4.6.7` exakt installiert (Node>=20); npm-Audit danach0. Keine Mischung aus v1- und v2-Importpfaden. Der tatsächlich installierte StdioServerTransport unterstützt `maxBufferSize`; statt seines10-MB-Defaults wird die vereinbarte40-MiB-Grenze explizit gesetzt und getestet. Die alten zusammengefassten SDK1.x-Pakete sind die Wartungslinie für2025-11-25; neue Entwicklung richtet sich nach dem stabilen v2-SDK. Tatsächliche Kompatibilität mit den installierten Claude-/Codex-/Antigravity-Hosts wird durch reale stdio-Sitzungen belegt, nicht aus dem Versionsnamen abgeleitet.

Primärquellen: [MCP-Transportmodell2026-07-28](https://modelcontextprotocol.io/specification/2026-07-28/basic/transports), [offizielle SDK-Werkzeuge](https://github.com/modelcontextprotocol/typescript-sdk/blob/main/docs/servers/tools.md), [Abgrenzung der v1-Wartungslinie](https://github.com/modelcontextprotocol/typescript-sdk/blob/v1.x/README.md). Das SDK übernimmt das jeweilige Wire-Protokoll; Sketchdraw erfindet keine eigene MCP-Handshake-Variante.

## Skills und Nachweise

Ein projektspezifischer Skill erklärt die automatisch verwaltete Verbindung, Lesen→Planen→CAS-Command, Revisionskonflikte und die Grenze zwischen Diagrammdaten und Agentenanweisungen. Die einmalige Installation in eine fremde globale Toolkonfiguration ist kein stiller Nebeneffekt des Produktbuilds.

Pflichtnachweise: Ein echter stdio-Client liest und verändert die laufende App ohne UI-Freigabe, ein Mensch editiert weiter, Dokumentwechsel und App-Neustart verbinden automatisch neu; Gastmodus besitzt keinen lokalen Host. Falsche Tokens, stale Revision, doppelte Command-ID, Timeout und übergroße Frames bleiben abgesichert; stdout bleibt parsebar. Zusätzlich Cross-Platform-Socket-/Loopback-Tests. In-memory-Tests allein erfüllen die App-Integration nicht.


## Ergänzungen nach Review MC-01–MC-06

Die vollständigen Gegenbeispiele stehen in `docs/reviews/codex-mcp-contract-review.md`. Die folgenden Regeln sind verbindliche Architekturentscheidungen, noch keine getestete Implementierung.

### Gegenseitige lokale Authentifizierung

Main schreibt Endpoint, Grant-ID, App-/Controller-Epoche und 32-Byte-Capability in die private Laufzeitdatei. Der Adapter liest nur diesen festen Pfad oder den absoluten Test-/Entwicklungs-Override. Handshake: Client sendet Version1, Grant-ID, App-Epoche und32 zufällige Noncebytes (Hex); Main antwortet mit eigener32-Byte-Nonce und HMAC-SHA256 über das kanonische UTF-8-JSON-Array `["sketchdraw-mcp-server-v1", grantId, appEpoch, clientNonce, serverNonce]`. Erst nach erfolgreicher Serverprüfung sendet der Client den HMAC derselben Felder mit dem getrennten Label `sketchdraw-mcp-client-v1`. Beide verwenden die Capability als HMAC-Key und konstantzeitlichen Vergleich. Werte/Typen/Längen strikt prüfen, Nonces nur für diesen Socket verwenden, nach5s oder einem Fehler schließen. Roh-Capability, HMACs und Dokumente nicht loggen. Erst danach sind RPC-Nachrichten zulässig.

Damit erhält ein irrtümlich wiederbelegter lokaler Port nicht das Geheimnis. OS-Administratoren bzw. kompromittierte Prozesse desselben Benutzers sind keine durch dieses lokale IPC-Protokoll beseitigte Bedrohung. Keine globale Systemrichtlinie verändern. Socketende widerruft nur seine Verbindung, nicht automatisch die Dokumentfreigabe eines anderen korrekt authentifizierten Adapters.

### Commit, Widerruf und Schließen

Unmittelbar vor dem synchronen Domain-Aufruf prüft der gemeinsame Gateway Session, Actorbindung, Grant-Generation, Schreibrecht, erwartete Revision und Lifecycle-Gate **ohne await dazwischen**. Authoritywechsel und Renderer-Dispose sperren lokal; Main schließt den Host und entfernt die passende Laufzeitdatei. Bereits vorher linearisierte Commits bleiben gültig; bei fehlender Antwort wird kein Rollback behauptet.

Close/Öffnen verwendet denselben Lifecycle-Gate aus `docs/contracts-p2p.md`: Eingang sofort sperren, lokale Commitauflösung abwarten, Barrier-Snapshot plus Token/Controller-Epoche/Revision/Draftgeneration prüfen. Nach asynchronem Speichern erneut prüfen, Sperre bis tatsächlichem Schließen halten. Cancel oder Save-/IPC-Fehler lösen nur das eigene Token. Drafts oder ungeklärte Outcomes verhindern einen behaupteten sauberen Speicherstand. Der Drain wartet nicht unbegrenzt auf entfernte ACKs oder einen MCP-Client.

Im Gastmodus ist der lokale MCP-Host deaktiviert und antwortet mit `ACCESS_DENIED`; niemals in einen zweiten lokalen Mirror committen. Eine spätere Ownergateway-/Agent-Scope-Integration benötigt einen eigenen Vertrag und Nachweis.

### Ausgelieferter Adapter und Ressourcen

Buildziel: `dist-mcp/server.cjs`, vollständig gebündelt außer Node-Builtins. Das installierte Electron-Executable startet diesen Adapter mit `ELECTRON_RUN_AS_NODE=1` und dessen absolutem Pfad im App-Paket. Keine zweite App-/Dokumentinstanz und kein vorausgesetztes globales Node. Main erzeugt die Konfiguration aus tatsächlichen installierten Pfaden, niemals aus Modellargumenten. In Entwicklung ist `node dist-mcp/server.cjs` zulässig. Das Packaging muss den Adapter enthalten; Laufzeitfuses dürfen den ausgewählten Startmodus nicht still deaktivieren. Pfade mit Leerzeichen durch strukturierte Argumentarrays behandeln.

stdin-EOF, SIGTERM oder SDK-Schließen beendet den Adapter und seine Sockets begrenzt; laufende Mutationen folgen der Outcome-Semantik. Ein kurzlebiger SDK-Probeprozess widerruft keine Benutzerfreigabe. Main-Shutdown muss vorhandene Sockets aktiv schließen; `server.close()` alleine genügt dafür nicht. Verbindungsabbruch bedeutet nicht, dass ein schon bestätigter Dokumentcommit gelöscht wird. SDK `serveStdio` übernimmt moderne und Legacy-Protokollauswahl; keine selbst erfundene MCP-Handshake-Erkennung.

Toolresultate liefern umfangreiche Dokument-/Codeinhalte nur einmal als strukturierte Daten und kurze Textzusammenfassung. Größenfehler sind explizit; eine maximale Domain-Datei passt nicht automatisch in jedes zusätzliche Wire-Envelope. Erfolgreiche Writes nennen Revision und **ungespeichert im offenen Dokument**; sie behaupten keine Dateipersistenz. Kein versteckter zweiter Dokumentstore.

Windows-Transportentscheidung: [Node22 net](https://nodejs.org/docs/latest-v22.x/api/net.html#serverlistenoptions-callback) und [Server-Shutdown](https://nodejs.org/docs/latest-v22.x/api/net.html#serverclosecallback). Die vorher vorgeschlagene Named Pipe wurde wegen der nicht nachgewiesenen Remote-/Benutzergrenze verworfen. Windows-Nachweis und gepackter stdio-Start bleiben Pflichtprüfungen.


## Implementierungsstruktur

`src/mcp/` enthält stdio-Adapter und Client, `electron/agent-access/` den lokalen Host, die private Laufzeitdatei und den begrenzten Transport, `src/agent-access/` die browserreinen Verträge und Rendererbindung. Der Host erhält einen explizit injizierten Request-/Control-Handler; Produktcode liefert keine vorgetäuschten Beispielantworten oder einen heimlichen eigenen Dokumentstore. Tests dürfen dafür kontrollierte echte Domain-Sessions einsetzen.

Nur Main darf den internen Grant erzeugen, Controller-Sessions registrieren, die Laufzeitdatei schreiben und Controlnachrichten initiieren. Der gebundene Renderer bestätigt deren Anwendung; Main prüft diese ACKs. Netzwerk-/stdio-Eingaben erhalten keine Managementmethoden. Der Grant bleibt bis bestätigter Rendererinstallation inaktiv; ein fehlender Handler ist ein Fehler, kein implizites Schreibrecht.

## Gelieferter Integrationsanschluss

Die separate `window.sketchdrawAgentAccess`-Facade ergänzt die unveränderte DesktopBridge. Der Renderer registriert für jede tatsächliche lokale Authorityinstanz eine neue numerische Sessionepoche; Main fügt seine WebContents-Generation hinzu. Das erste `sync-session` bestätigt diese Kombination vor der automatischen Grantinstallation. Ein Dokumentwechsel mit identischer ID erneuert trotzdem die Epoche. Dispose sperrt den lokalen Guard, meldet die Sitzung ab und entfernt die Listener.

SDK-Initialisierung und `tools/list` sind öffentliches Protokollwissen. Erst ein Toolaufruf verbindet zum authentifizierten Host; ohne aktive lokale Desktop-Authority ist er `ACCESS_DENIED`. Es gibt sechs dokumentierte Tools, keine zusätzliche Resource- oder Prompt-API. Siehe `docs/agent-integration.md`, `skills/sketchdraw-desktop/SKILL.md` und den tatsächlichen Teststand in `docs/reviews/codex-mcp-integration.md`.

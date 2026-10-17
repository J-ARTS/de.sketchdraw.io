# Lokaler Agentenzugriff — S3-Vertragsentwurf

Issues #6/#13, Codex, 17.10.2026. Dieser Vertrag ergänzt S1 nach unabhängigem Review MC-01–MC-06. Der Transport-/SDK-Auftrag wird getrennt von der gemeinsamen Sessionautorität und der UI-Anbindung umgesetzt. Noch kein ausgeführter MCP- oder Sicherheitstest.

## Zweck und Datenhoheit

Externe Agenten lesen und verändern dasselbe geöffnete Dokument wie der Mensch. Ein eigener unsichtbarer MCP-Dokumentspeicher erfüllt die Anforderung nicht. Der Renderer hält den aktiven `DocumentController`; Main vermittelt berechtigte lokale Anfragen, ohne eine zweite schreibbare Modellkopie zu führen. Canvas, Code, MCP und später P2P müssen denselben kontrollierten Commitweg nutzen.

Die Freigabe erfolgt sichtbar je geöffnetem Dokument: ausgeschaltet, nur lesen oder lesen und schreiben. Standard ist ausgeschaltet. Bis zu acht einzeln benannte Freigaben sind möglich, jeweils mit eigenem Actor und einzeln widerrufbar. Die Bezeichnung eines Tools ist eine Nutzereingabe und kein verifizierter Hersteller-/Modellnachweis. Eine Freigabe besitzt zufällige 256-Bit-Capability, zufällige Grant-ID, Generation, Dokument-ID und Session-Epoche. Main erzeugt das Geheimnis; es erscheint weder in Diagrammen noch Logs/Issues/Fehlermeldungen. Die UI kann eine lokale MCP-Konfiguration ausdrücklich anzeigen/kopieren. Jede Controller-Neuerzeugung, auch erneutes Öffnen derselben Datei, Schließen, Renderer-Neustart und Widerruf invalidieren die Capability. Main bindet sie zusätzlich an seine aktuelle WebContents-/Navigationsgeneration. Eine vorhandene Verbindung erhält dadurch keine Rechte auf das neue Dokument.

## Prozesse und Verbindung

- Der externe Host startet einen gebündelten stdio-MCP-Adapter. stdout enthält ausschließlich MCP-Nachrichten; Diagnose auf stderr ohne Geheimnisse oder Diagramminhalte.
- Auf macOS/Linux verbindet sich der Adapter über einen Unix-Domain-Socket in einem privaten, besitzergeprüften Verzeichnis (0700, Socket0600, keine fremden Symlinks, begrenzter Pfad). Auf Windows wird nach MC-05 ausdrücklich ein roher TCP-Listener nur auf der numerischen IPv4-Adresse `127.0.0.1` und einem ephemeren Port verwendet. Kein HTTP-/WebSocket-Protokoll, keine Wildcard-/LAN-Adresse, keine Firewalländerung und keine fremde Hostauflösung. Nach `listening` wird die tatsächliche Bindung geprüft. Andere lokale Prozesse können verbinden; nur Authentifizierung erlaubt Dokumentzugriff. Dies ist lokale Prozesskommunikation, kein P2P-Signaling/Relay oder zentraler Dokumentdienst. `exclusive:true` bedeutet keine behauptete Windows-OS-Exklusivitätsgarantie. Listenerverlust invalidiert alle zugehörigen Grants; kein stiller Reconnect über App-Generationen.
- Endpoint und Capability kommen über ausdrücklich konfigurierte Umgebungsvariablen, nicht über vom Modell gelieferte freie Dateipfade. Kein automatisches Durchsuchen fremder App-Instanzen oder Benutzerverzeichnisse.
- Verbindungen werden vor Dokumentdaten gegenseitig authentifiziert; die Capability wird nicht im Transport übertragen. Danach trägt jede Anfrage requestId, erlaubte Operation, Grant-ID/Generation, Dokument-ID und Epoche. Main prüft sie vor Weiterleitung und vor Rückgabe; der Renderer prüft seine lokale Grant-Generation unmittelbar vor jedem Commit synchron. Ein Client darf weder Actor noch Rechte hocheskalieren. Ein nachträglicher Authfehler macht einen bereits linearisierten Commit nicht rückgängig.
- Ein JSON-Frame je LF. Bytes vor JSON-Parse an beiden Eingängen (Host→stdio und Adapter→Main) begrenzen: höchstens40MiB einschließlich Envelope; vor Auth höchstens4KiB. Höchstens16 Verbindungen insgesamt, davon8 unauthentifiziert,8 aktive Grants,16 laufende Requests insgesamt und128MiB aggregierte Transportbuffer. Auth muss nach5s abgeschlossen sein, sonst Socket aktiv schließen. Pro authentifiziertem Client höchstens2 parallele Requests. Größenüberschreitung schließt die betroffene Verbindung mit begrenztem Fehler; keine unbeschränkte Warteschlange. Responsegrößen ebenfalls begrenzen. Große Assetdaten nur auf ausdrücklich angefragtem vollständigem Dokument, nicht in jeder Suchantwort.
- Keine beliebige Shell, kein freier Dateizugriff und keine automatischen HTTP-Abrufe aus Dokumentationslinks. Der Zugriff auf das Dokument gewährt keine Desktop-Dateirechte.

## Enger Renderer/Main-Vertrag

Separate typisierte Erweiterung der DesktopBridge erst nach Abgleich mit #8/#10:

1. Renderer meldet die aktive Dokument-ID und neue Controller-Epoche an Main, auch bei identischer persistenter Dokument-ID. Main widerruft vorherige Freigaben. Eine erste Meldung aktiviert keine Freigabe.
2. UI fordert Freigabe mit `read` bzw. `write` an oder widerruft sie. Main liefert die konfigurierte lokale Verbindung ausschließlich an die eigene vertrauenswürdige Hauptseite.
3. Main sendet eine geprüfte Anfrage mit eigener unvorhersagbarer Korrelations-ID. Renderer akzeptiert nur den benannten Preload-Kanal und die aktive Dokument-/Controller-/Grant-Generation. Reads liefern den aktuellen ReadonlyDocumentSource-Snapshot; Writes laufen über dieselbe DocumentAuthority und einen gebundenen WriteGateway wie Human/Code/Import/Peer. Kein direkter zweiter Controllerpfad. `expectedRevision` ist verpflichtend, Actor und Quelle `agent` werden von der eigenen Komposition gebunden.
4. Renderer antwortet mit derselben Korrelations-ID. Main akzeptiert nur die eigene ausstehende Anfrage und den geprüften Hauptframe. Timeout, Renderer-Ausfall oder Dokumentwechsel werden als Fehler gemeldet, niemals als Erfolg.
5. Mutationen haben eine Client-Command-ID (ASCII-ID,1–128 Zeichen). Vor dem ersten await wird unter Grant/Controller-Epoche/Command-ID ein Pending-Eintrag reserviert. Fingerprint umfasst Operation, Dokument, erwartete Revision und kanonischen Payload. Identische Wiederholung hängt am selben Pending-Ergebnis; anderer Inhalt wird als REQUEST_ID_REUSED abgewiesen. Die Renderer-Commitgrenze ist ebenfalls dedupliziert. Timeout entfernt keinen ungeklärten Eintrag: vor nachweislichem Commitabbruch REQUEST_TIMEOUT, bei möglichem Commit OUTCOME_UNKNOWN. Keine automatische Wiederholung mit neuer Revision/ID. Maximal4096 Mutations-IDs je Grant, jeweils nur begrenzte Ergebnisdaten ohne Dokumentbytes; keine Verdrängung zum stillen Wiederverwenden, bei Ausschöpfung JOURNAL_FULL und ausdrückliche neue Freigabe. No-Op-Resultate werden genauso reserviert und gespeichert. Das Journal bildet auf die interne Gateway-ID ab; keine Exactly-once-Zusage über neue Grants/App-Neustarts.

`onAgentRequest`/`respondToAgentRequest` und Freigabemethoden werden vor Desktopintegration als gesonderte browserreine Typen unter `src/agent-access/` fixiert. Eine eigene `window.sketchdrawAgentAccess`-Fassade vermeidet stilles Umdeuten der S1-DesktopBridge; Browser ohne echte Desktopbrücke meldet Agentenzugriff ausdrücklich als nicht verfügbar. Das ist keine Erlaubnis, `ipcRenderer`, einen beliebigen Kanalnamen oder ein generisches Main-Callback in den Renderer zu geben. Main und Renderer validieren Daten jeweils an ihrer Grenze.

## Öffentliche MCP-Werkzeuge

| Werkzeug | Eingabe / Wirkung | Recht |
| --- | --- | --- |
| `sketchdraw_read_document` | Dokument-ID; aktueller Snapshot mit Revision, optional ohne Assetbytes für einen begrenzten Überblick. Vollständige Daten ausdrücklich anfragen. | read |
| `sketchdraw_find_elements` | Dokument-ID, einfacher Suchtext und begrenzte Ergebnisanzahl; Suche in Namen/Text/Typ/Metadaten, keine eval-Ausdrücke. Rückgabe stabiler IDs und Revision. | read |
| `sketchdraw_analyze_document` | Dokument-ID; deterministische Strukturübersicht, Container-/Verbindungszahlen und tatsächlich prüfbare Befunde. Keine vorgetäuschte Cloud-Compliance. | read |
| `sketchdraw_apply_commands` | Dokument-ID, expectedRevision, commandId, begrenztes `DocumentCommand`; Validierung und ein atomarer Commit. | write |
| `sketchdraw_read_code` | Dokument-ID; native Diagrammsyntax, Revision und Formatversion. | read |
| `sketchdraw_apply_code` | Dokument-ID, expectedRevision, commandId, Text; Parser mit aktuellem Ressourcenkontext und atomarer Replace derselben Dokument-ID. | write |

Alle Tools liefern strukturierte Resultate und verständliche Fehlermeldungen. Schreibtools sind entsprechend annotiert, aber Annotationen ersetzen keine Berechtigungsprüfung. Keine freie Argumentation aus einem Diagramm wird als Systemanweisung übernommen. Zugriffslimits gelten auch für formal gültige Anfragen.

Fehlercodes mindestens: `ACCESS_DENIED`, `ACCESS_REVOKED`, `DOCUMENT_MISMATCH`, `SESSION_CHANGED`, `REVISION_CONFLICT`, `VALIDATION_FAILED`, `REQUEST_TOO_LARGE`, `BUSY`, `REQUEST_TIMEOUT`, `OUTCOME_UNKNOWN`. Schemafehler nennen Pfad/Code, aber keine Capability oder lokalen Dateipfade. Konflikte enthalten nur nach erfolgreicher Rechteprüfung die aktuelle Revision.

## SDK und Kompatibilität

Codex hat nach Prüfung der offiziellen npm-Metadaten am17.10.2026 `@modelcontextprotocol/server@2.3.1`, `@modelcontextprotocol/client@2.3.1` und `zod@4.6.7` exakt installiert (Node>=20); npm-Audit danach0. Keine Mischung aus v1- und v2-Importpfaden. Der tatsächlich installierte StdioServerTransport unterstützt `maxBufferSize`; statt seines10-MB-Defaults wird die vereinbarte40-MiB-Grenze explizit gesetzt und getestet. Die alten zusammengefassten SDK1.x-Pakete sind die Wartungslinie für2025-11-25; neue Entwicklung richtet sich nach dem stabilen v2-SDK. Tatsächliche Kompatibilität mit den installierten Claude-/Codex-/Antigravity-Hosts wird durch reale stdio-Sitzungen belegt, nicht aus dem Versionsnamen abgeleitet.

Primärquellen: [MCP-Transportmodell2026-07-28](https://modelcontextprotocol.io/specification/2026-07-28/basic/transports), [offizielle SDK-Werkzeuge](https://github.com/modelcontextprotocol/typescript-sdk/blob/main/docs/servers/tools.md), [Abgrenzung der v1-Wartungslinie](https://github.com/modelcontextprotocol/typescript-sdk/blob/v1.x/README.md). Das SDK übernimmt das jeweilige Wire-Protokoll; Sketchdraw erfindet keine eigene MCP-Handshake-Variante.

## Skills und Nachweise

Ein projektspezifischer Skill erklärt Verbindungsfreigabe, Lesen→Planen→CAS-Command, Revision-Konflikte, verständliche Codebeispiele und die Grenze zwischen Diagrammdaten und Agentenanweisungen. Er erteilt selbst keine pauschalen Rechte oder Erlaubnis zum Weitergeben privater Dokumente. Installation in fremde globale Toolkonfigurationen ist kein stiller Nebeneffekt des Produktbuilds.

Pflichtnachweise: echter stdio-Client liest die laufende App, fügt Shapes/Connector hinzu, Mensch editiert sie weiter; read-only und falsches Token verweigern Schreiben; Dokumentwechsel/widerrufene Freigabe greifen auch bei wartender Anfrage; stale Revision, doppelte Command-ID und Timeout verändern nichts doppelt; übergroße/fehlerhafte Frames werden begrenzt; stdout bleibt parsebar. Zusätzlich Cross-Platform-Socket-/Pipe-Tests. In-memory-Tests allein erfüllen die App-Integration nicht.


## Ergänzungen nach Review MC-01–MC-06

Die vollständigen Gegenbeispiele stehen in `docs/reviews/codex-mcp-contract-review.md`. Die folgenden Regeln sind verbindliche Architekturentscheidungen, noch keine getestete Implementierung.

### Gegenseitige lokale Authentifizierung

Die Main-Freigabe liefert Endpoint, öffentliche `grantId`, App-/Controller-Epoche und eine32-Byte-Capability nur an die eigene vertrauenswürdige UI. Der konfigurierte Adapter erhält sie über Umgebungsvariablen. Keine Suchpfade, keine beliebigen Hosts und kein Fallback. Handshake: Client sendet Version1, Grant-ID, App-Epoche und32 zufällige Noncebytes (Hex); Main antwortet mit eigener32-Byte-Nonce und HMAC-SHA256 über das kanonische UTF-8-JSON-Array `["sketchdraw-mcp-server-v1", grantId, appEpoch, clientNonce, serverNonce]`. Erst nach erfolgreicher Serverprüfung sendet der Client den HMAC derselben Felder mit dem getrennten Label `sketchdraw-mcp-client-v1`. Beide verwenden die Capability als HMAC-Key und konstantzeitlichen Vergleich. Werte/Typen/Längen strikt prüfen, Nonces nur für diesen Socket verwenden, nach5s oder einem Fehler schließen. Roh-Capability, HMACs und Dokumente nicht loggen. Erst danach sind RPC-Nachrichten zulässig.

Damit erhält ein irrtümlich wiederbelegter lokaler Port nicht das Geheimnis. OS-Administratoren bzw. kompromittierte Prozesse desselben Benutzers sind keine durch dieses lokale IPC-Protokoll beseitigte Bedrohung. Keine globale Systemrichtlinie verändern. Socketende widerruft nur seine Verbindung, nicht automatisch die Dokumentfreigabe eines anderen korrekt authentifizierten Adapters.

### Commit, Widerruf und Schließen

Unmittelbar vor dem synchronen Domain-Aufruf prüft der gemeinsame Gateway Session, Actorbindung, Grant-Generation, Rechte, erwartete Revision und Lifecycle-Gate **ohne await dazwischen**. UI-Widerruf/Downgrade sperrt lokal vor dem await zu Main. Main-Widerruf verhindert sofort neue Weiterleitungen und ist erst nach Renderer-Gate-Ack bestätigt. Bereits vorher linearisierte Commits bleiben gültig; bei fehlender Antwort wird kein Rollback behauptet.

Close/Öffnen verwendet denselben Lifecycle-Gate aus `docs/contracts-p2p.md`: Eingang sofort sperren, lokale Commitauflösung abwarten, Barrier-Snapshot plus Token/Controller-Epoche/Revision/Draftgeneration prüfen. Nach asynchronem Speichern erneut prüfen, Sperre bis tatsächlichem Schließen halten. Cancel oder Save-/IPC-Fehler lösen nur das eigene Token. Drafts oder ungeklärte Outcomes verhindern einen behaupteten sauberen Speicherstand. Der Drain wartet nicht unbegrenzt auf entfernte ACKs oder einen MCP-Client.

Im Gastmodus darf MCP nur über den autorisierten Ownergateway und einen Owner-gebundenen Agent-Scope schreiben. Fehlt diese Integration, explizit ACCESS_DENIED; niemals in einen zweiten lokalen Mirror committen. Diese zeitweilige Integrationsgrenze wird nicht als vollständige Agenten-/Peer-Zusammenarbeit ausgegeben.

### Ausgelieferter Adapter und Ressourcen

Buildziel: `dist-mcp/server.cjs`, vollständig gebündelt außer Node-Builtins. Das installierte Electron-Executable startet diesen Adapter mit `ELECTRON_RUN_AS_NODE=1` und dessen absolutem Pfad im App-Paket. Keine zweite App-/Dokumentinstanz und kein vorausgesetztes globales Node. Main erzeugt die Konfiguration aus tatsächlichen installierten Pfaden, niemals aus Modellargumenten. In Entwicklung ist `node dist-mcp/server.cjs` zulässig. Das Packaging muss den Adapter enthalten; Laufzeitfuses dürfen den ausgewählten Startmodus nicht still deaktivieren. Pfade mit Leerzeichen durch strukturierte Argumentarrays behandeln.

stdin-EOF, SIGTERM oder SDK-Schließen beendet den Adapter und seine Sockets begrenzt; laufende Mutationen folgen der Outcome-Semantik. Ein kurzlebiger SDK-Probeprozess widerruft keine Benutzerfreigabe. Main-Shutdown muss vorhandene Sockets aktiv schließen; `server.close()` alleine genügt dafür nicht. Verbindungsabbruch bedeutet nicht, dass ein schon bestätigter Dokumentcommit gelöscht wird. SDK `serveStdio` übernimmt moderne und Legacy-Protokollauswahl; keine selbst erfundene MCP-Handshake-Erkennung.

Toolresultate liefern umfangreiche Dokument-/Codeinhalte nur einmal als strukturierte Daten und kurze Textzusammenfassung. Größenfehler sind explizit; eine maximale Domain-Datei passt nicht automatisch in jedes zusätzliche Wire-Envelope. Erfolgreiche Writes nennen Revision und **ungespeichert im offenen Dokument**; sie behaupten keine Dateipersistenz. Kein versteckter zweiter Dokumentstore.

Windows-Transportentscheidung: [Node22 net](https://nodejs.org/docs/latest-v22.x/api/net.html#serverlistenoptions-callback) und [Server-Shutdown](https://nodejs.org/docs/latest-v22.x/api/net.html#serverclosecallback). Die vorher vorgeschlagene Named Pipe wurde wegen der nicht nachgewiesenen Remote-/Benutzergrenze verworfen. Windows-Nachweis und gepackter stdio-Start bleiben Pflichtprüfungen.


## Abgegrenzter erster Backendauftrag

Der erste Auftrag implementiert `src/mcp/` (stdio-Adapter/Client), `electron/agent-access/` (lokaler Host, Grantverwaltung, begrenzter Transport) und browserreine Typen in `src/agent-access/`. Main-/Preload-/Rendererintegration folgt separat, damit keine unvollständige UI als Agentenintegration ausgegeben wird. Der Host erhält einen explizit injizierten Request-/Control-Handler; Produktcode liefert keine vorgetäuschten Beispielantworten oder einen heimlichen eigenen Dokumentstore. Tests dürfen dafür kontrollierte echte Domain-Sessions einsetzen.

Der Implementierer konkretisiert typsichere Host-/Client-Fabriken im erlaubten Bereich und dokumentiert sie. Nur Main darf Grants erzeugen, Controller-Sessions registrieren und Controlnachrichten initiieren. Der gebundene Renderer bestätigt deren Anwendung; Main prüft diese ACKs. Netzwerk-/stdio-Eingaben erhalten keine Managementmethoden. Grants bleiben bis bestätigter Rendererinstallation inaktiv; ein fehlender Handler ist ein Fehler, kein implizites Schreibrecht. In diesem Auftrag keine bestehende S1-DesktopBridge ändern. Die gemeinsame Sessionautorität aus dem P2P-Vertrag wird in einem eigenen begrenzten Auftrag umgesetzt und danach angeschlossen.

## Gelieferter Integrationsanschluss

Die separate `window.sketchdrawAgentAccess`-Facade ergänzt die unveränderte DesktopBridge. Der Renderer registriert für jede tatsächliche Authorityinstanz eine neue numerische Sessionepoche; Main fügt seine WebContents-Generation hinzu. Das erste `sync-session` bestätigt diese Kombination vor jeder Grantinstallation. Ein Dokumentwechsel mit identischer ID erneuert trotzdem die Epoche. UI-Widerruf sperrt den lokalen Guard synchron vor dem IPC-Warten; dispose entfernt Listener auch nach beendetem Controller.

SDK-Initialisierung und `tools/list` sind öffentliches Protokollwissen und benötigen keine Freigabe. Erst ein Toolaufruf verbindet zum authentifizierten Host; ohne gültige Konfiguration ist er `ACCESS_DENIED`. Es gibt sechs dokumentierte Tools, keine zusätzliche Resource- oder Prompt-API. Siehe `docs/agent-integration.md`, `skills/sketchdraw-desktop/SKILL.md` und den tatsächlichen Teststand in `docs/reviews/codex-mcp-integration.md`.

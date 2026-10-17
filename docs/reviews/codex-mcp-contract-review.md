# Unabhängige Prüfung des lokalen MCP-Vertrags

Issues: [#6](https://github.com/J-ARTS/de.sketchdraw.io/issues/6), [#13](https://github.com/J-ARTS/de.sketchdraw.io/issues/13). Stand: 17.10.2026. Reviewer: interner Codex-Subagent `dependency_review`, kein Claude-/Antigravity-Beitrag.

Geprüft wurde der 57-zeilige Entwurf `docs/contracts-mcp.md` gegen `docs/contracts.md`, `src/domain/types.ts`, die vorhandenen Controller-, Main-, Preload-, Senderprüfungs- und Close-Handshake-Implementierungen sowie Build-/Paketkonfiguration. MCP ist noch nicht implementiert. Die folgenden Abläufe sind konkrete Gegenbeispiele zum Entwurf, keine behaupteten ausgeführten MCP-Tests. Produktdateien wurden nicht geändert.

## Befunde vor Freigabe zur Implementierung

### MC-01 — P1: Nachträgliche Auth-Prüfung verhindert keinen bereits ausgeführten Commit

**Vertragsstelle:** `docs/contracts-mcp.md:16`, `:24–27`.

Main prüft vor Weiterleitung und nach asynchronem Warten. Der Renderer prüft laut Entwurf nur Dokument/Epoche und verwendet dann den Controller. Bei einem Widerruf oder Downgrade im selben Dokument bleibt die Dokument-Epoche gegebenenfalls unverändert: Main hat einen Write bereits weitergegeben, der Nutzer widerruft, der Renderer führt den Write dennoch aus, Main verwirft erst dessen Antwort. Die sichtbare Änderung ist dann bereits erfolgt. Eine Korrektur des Antwortstatus macht sie nicht rückgängig.

**Minimale Erweiterung:** Ein Grant benötigt eine Generation und einen lokal im Renderer geprüften Zustand. Direkt vor jedem Commit müssen Dokument-Session, Grant-Generation, Schreibrecht und Lifecycle-Gate synchron geprüft werden; zwischen Prüfung und `dispatch` darf kein `await` liegen. UI-Widerruf, Downgrade und Dokumentwechsel sperren lokal **vor** der asynchronen Meldung an Main. Ein durch Main ausgelöster Widerruf sperrt dort sofort neue Weiterleitungen und ist erst nach einem Renderer-Gate-Ack abgeschlossen. Bereits vor diesem Punkt linearisierte Commits bleiben gültige Commits; ein verlorener oder wegen Widerrufs unterdrückter Rückweg darf nicht als „nichts geändert“ ausgegeben werden. Main prüft Rechte auch vor Rückgabe gecachter Resultate.

**Nachweis:** Write zwischen Main-Prüfung und Renderer-Ausführung anhalten; lokal widerrufen; anschließend fortsetzen. Kein Commit nach der lokalen Sperre. Separater Fall: bereits synchron committen, dann Main-Widerruf vor Antwort; Status darf keinen Rollback behaupten.

### MC-02 — P1: Der bestehende Close-Handshake schützt nicht vor einem späten Agenten-Commit

**Vertragsstelle:** `docs/contracts-mcp.md:9`, `:27`; `docs/contracts.md:96`.

`electron/close-handshake.ts:56–74` prüft ausschließlich die ausstehende Request-ID und schließt nach `decision: close`. `electron/main.ts:343–351` besitzt noch keine Schreibsperre. Beispiel: Der Renderer prüft einen sauberen Stand oder speichert Revision 12; während der Dialog-/IPC-Fortsetzung wird Agenten-Revision 13 committed; anschließend wird das Fenster geschlossen. Der Agent kann einen erfolgreichen flüchtigen Commit erhalten, dessen Daten die App beim Schließen verliert. Widerruf erst bei `closed` ist hierfür zu spät.

**Minimale Erweiterung:** Vor der finalen Schließprüfung ein rendererweites Lifecycle-Gate setzen und begonnene Commits eindeutig davor/dahinter einordnen. Alle Writer müssen dieselbe Grenze nutzen: Human, Code, Import, MCP, Peer sowie Undo/Redo. Danach neue Commits zurückweisen oder wartend halten. Der Close-Vorgang muss Request-ID, Dokument-Session, geprüfte Revision und Draft-Generation verbinden. Nach einem asynchronen Save/Dialog nochmals prüfen; auch menschliche Änderungen oder noch offene Text-/Codeentwürfe zählen. Bei späterer Änderung abbrechen bzw. erneut prüfen. Die Sperre bis zum tatsächlichen Schließen halten. Bei Cancel, fehlgeschlagenem Save oder fehlgeschlagenem Close-IPC zuverlässig lösen. Ein veralteter Close-Vorgang darf keine neuere Sperre lösen.

**Nachweis:** Während Save/Close kontrolliert Agenten-Write und Textentwurfsänderung einschieben; kein stiller Verlust. Cancel und Save-Fehler müssen anschließende erlaubte Agenten-Commits wieder ermöglichen.

### MC-03 — P1: Bestätigte Resultate allein reichen für Command-ID-Deduplizierung nicht

**Vertragsstelle:** `docs/contracts-mcp.md:28`, `:39–45`.

Der Entwurf erwähnt nur gespeicherte bestätigte Ergebnisse. Zwei Requests derselben Command-ID können eintreffen, bevor das erste Ergebnis gespeichert ist. Mit verschiedenem Inhalt und aufeinanderfolgenden erwarteten Revisionen könnten beide committed werden. CAS prüft die Revision, nicht die Identität einer Operation. Ein Timeout nach Weiterleitung sagt zudem nicht, ob der Renderer schon committed hat.

**Minimale Erweiterung:** Vor dem ersten `await` einen Eintrag unter `(grantId, sessionEpoch, commandId)` reservieren. Ein kanonischer Fingerprint umfasst Operation, Dokument, `expectedRevision` und Payload. Gleiche ID/Fingerprint hängt an derselben ausstehenden Promise oder erhält dasselbe bestätigte Resultat; anderer Fingerprint wird sofort abgewiesen. Der Renderer führt dieselbe Identitätsprüfung an seiner Commit-Grenze aus oder besitzt nachweislich den einzigen dafür zuständigen Eintrag. Bestätigung und synchroner Commit dürfen kein Wiederholungsfenster offenlassen. Ein abgelaufener Wartender entfernt keinen noch unklaren Eintrag.

`REQUEST_TIMEOUT` darf nur „nicht committed“ bedeuten, wenn der Vorgang nachweislich noch vor dem Commit abgebrochen wurde. Bei möglichem Commit: `OUTCOME_UNKNOWN`, exakte Wiederholung mit identischer ID/Revision oder Ergebnisabgleich; kein automatischer neuer Write mit frischer Revision. Die Aussage „nach Cacheablauf schützt CAS“ gilt für semantisch wirksame Commits innerhalb derselben ungebrochenen Controller-Session; No-Ops erhöhen nach S1 die Revision nicht. Grenzen und Ablauf des Resultat-Caches müssen daher Teil des Vertrags sein, ohne globale Exactly-once-Garantie vorzutäuschen.

**Nachweis:** Parallel gleiche/verschiedene Payloads unter derselben ID; Timeout vor Commit und nach Commit; Adapter-Neustart mit unverändertem Main/Renderer; Cacheablauf; No-Op. Jeder Fall nennt tatsächlichen Commit-Zähler und Revision.

### MC-04 — P2: Controller-Neuerzeugung mit derselben Dokument-ID muss die Session wechseln

**Vertragsstelle:** `docs/contracts-mcp.md:9`, `:24–27`; `docs/contracts.md:43`, `:47`.

Explizit genannt ist das Öffnen eines **anderen** Dokuments. Die Domain besitzt aber eine persistente Dokument-ID und erzeugt einen neuen Controller standardmäßig mit Revision 0. Auch erneutes Öffnen derselben Datei, Reload oder Restore kann daher dieselbe ID und eine früher verwendete Revision erzeugen. Ohne neue Session wäre ein alter Write trotz CAS wieder passend. Die vorhandene Senderprüfung in `electron/security.ts:191–244` prüft den aktuellen Hauptframe; sie ersetzt keinen Controller-/Navigations-Generationsnachweis.

**Minimale Erweiterung:** Jede Controller-Neuerzeugung wechselt die Session, unabhängig von Dokument-ID oder Inhalt. Main bindet Freigaben zusätzlich an seine aktuelle WebContents-/Navigationsgeneration und nimmt nach Crash, Reload, Navigation oder neuer Hauptseite keine Freigaben automatisch wieder auf. Die erste Renderer-Meldung registriert nur den Controller und erlaubt keine Wiederverwendung einer alten Freigabe. Alte ausstehende Antworten/Close-IDs werden invalidiert.

**Nachweis:** Dasselbe Dokument erneut öffnen und mit alter Capability, alter Epoche und wieder passender Revision schreiben; der Write muss abgewiesen werden. Renderer-Neustart zwischen Commit und Antwort liefert keinen Erfolg für die neue Session.

### MC-05 — P2: „Lokale Named Pipe“ ist noch kein Nachweis einer ausschließlich lokalen Windows-Grenze

**Vertragsstelle:** `docs/contracts-mcp.md:14–16`.

Der Entwurf nennt Tokenprüfung, lässt aber offen, ob damit die Dokument-Capability oder ein Windows-Zugriffstoken gemeint ist. Eine Capability authentifiziert Requests; sie macht einen erreichbaren Pipe-Endpunkt nicht automatisch lokal. Microsoft beschreibt gesonderte DACL-/Logon-SID-Grenzen gegen Remotezugriff und andere Anmeldesitzungen. Der untersuchte libuv-Quellstand zeigt außerdem Pipe-Erzeugung mit Standard-Sicherheitsdeskriptor und ohne `PIPE_REJECT_REMOTE_CLIENTS`; daraus darf keine generelle Lokalitätsgarantie für eine spätere Node-Implementierung abgeleitet werden. Dies ist eine Quellenprüfung, kein Windows-Laufzeittest. [Microsoft: Named-Pipe-Zugriffsrechte](https://learn.microsoft.com/en-us/windows/win32/ipc/named-pipe-security-and-access-rights), [libuv 1.51.0: Pipe-Erzeugung](https://github.com/libuv/libuv/blob/v1.51.0/src/win/pipe.c#L505-L513).

**Minimale Erweiterung:** Dokument-Capability und Betriebssystem-Zugriffsgrenze getrennt benennen. Für die tatsächlich gebündelte Windows-Laufzeit einen belegten Schutz gegen fremde Benutzer/Anmeldesitzungen und Remote-Pipezugriff verlangen; bis dahin die Behauptung „kein Netzwerkdienst“ als unbewiesen markieren. Keine globale Firewall-/Systemkonfiguration als stillen Workaround verändern. Für Unix weiterhin privates Verzeichnis, Besitzer-/Symlinkprüfung und begrenzten Socket-Pfad verwenden.

**Nachweis:** Lokaler erlaubter Benutzer funktioniert; anderer Benutzer/andere Sitzung und Remote-Pipeversuch scheitern. Zufälliger Name und fehlende Capability allein ersetzen diesen Plattformnachweis nicht.

**Nachträglich geprüfte Alternative von Root:** Nur unter Windows den privaten Adapterkanal als rohes, begrenztes JSON über `127.0.0.1` und einen ephemeren Port betreiben; Unix behält UDS. Diese Architekturentscheidung ist mit der Vision vereinbar und vermeidet die unbewiesene Named-Pipe-Grenze. Sie liefert lokale Erreichbarkeit, keine Benutzer-/Sitzungsisolation; Dokumentzugriff bleibt durch Capability und Grants geschützt. Kein grundsätzlicher Packagingblocker gefunden, aber noch kein Windows-Laufzeittest.

Dabei nicht `exclusive: true` als Windows-OS-Exklusivität ausgeben: Node beschreibt damit Cluster-Handle-Sharing; der untersuchte libuv-Code setzt gerade kein `SO_EXCLUSIVEADDRUSE`. Main muss die tatsächlich gebundene IPv4-Adresse prüfen; Adapter akzeptieren ausschließlich numerisches `127.0.0.1` mit gültigem Port, ohne Host-Fallback. Verlust/Ersetzung des Listeners invalidiert dessen Grants; veraltete Ports dürfen keine transparente Wiederaufnahme alter Freigaben auslösen. Unauthentifizierte erste Frames, Zeit, Verbindungen und Gesamtpuffer begrenzen. Idle-Timeout muss den Socket aktiv schließen; Listener-Schließen allein beendet bestehende Verbindungen nicht. [Node: Listener-Optionen und Shutdown](https://nodejs.org/docs/latest-v22.x/api/net.html#serverlistenoptions-callback), [libuv: Windows-TCP-Bind](https://github.com/libuv/libuv/blob/v1.49.2/src/win/tcp.c#L256-L266).

### MC-06 — P2: Der gebündelte stdio-Start- und Abbruchpfad ist noch nicht definiert

**Vertragsstelle:** `docs/contracts-mcp.md:13`, `:15`, `:49–57`.

Der externe Host soll einen gebündelten Adapter starten. Der vorhandene Build erstellt ausschließlich `main.cjs` und `preload.cjs`; die Pakete enthalten noch keinen festgelegten Adapter-Entry oder Runtime-Startvertrag. Ein späteres Beispiel `node <repo>/adapter.js` würde die installierte Desktop-App nicht abdecken. Ohne definierten Abbruchpfad kann ein vom Host beendeter stdio-Prozess außerdem offene Socket-Requests zurücklassen oder die Dokumentfreigabe unbeabsichtigt beenden.

**Minimale Erweiterung:** Vor #13 den tatsächlich ausgelieferten ausführbaren Pfad samt Argumenten und Runtime festlegen: ohne Entwickler-Checkout, ohne vorausgesetztes globales Node und mit Pfaden mit Leerzeichen. Das Starten des Adapters darf keine zweite Dokumentinstanz öffnen. stdin-EOF/Prozessabbruch beendet seine Verbindung und noch nicht begonnene Arbeit; bereits linearisierte Writes folgen MC-03. Transport-Reconnect erzeugt keine neue Dokument-Session und hebt keinen Widerruf auf. Fehlende App, veraltete Capability und neuer App-Endpoint erhalten klare, begrenzte Fehler statt endloser Wiederverbindung.

Das offizielle stdio-Protokoll behandelt stdin-EOF als primären portablen Shutdown. SDK-v2 kann für automatische Erkennung einen kurzlebigen zusätzlichen Probeprozess starten; dessen Ende darf nicht die eigentliche Freigabe widerrufen. `serveStdio` unterstützt beide Protokollgenerationen, sodass kein eigener MCP-Handshake nötig ist. [stdio](https://modelcontextprotocol.io/specification/2026-07-28/basic/transports/stdio), [SDK-Protokollversionen](https://github.com/modelcontextprotocol/typescript-sdk/blob/main/docs/protocol-versions.md), [Legacy-Unterstützung](https://github.com/modelcontextprotocol/typescript-sdk/blob/main/docs/serving/legacy-clients.md).

**Nachweis:** Gepackte App plus echter Host auf allen Zielplattformen, Start aus fremdem Arbeitsverzeichnis und Pfad mit Leerzeichen; EOF, Host-Abbruch, Probeprozess, App-Neustart und Adapter-Neustart. stdout enthält ausschließlich Protokollnachrichten.

## Noch ausdrücklich zu entscheidende Vertragsdetails

- **Grant pro Tool:** Der Entwurf bindet Actor an Capability, beschreibt jedoch eine Freigabe pro Dokument. Wenn Claude, Codex und Antigravity dieselbe Capability teilen, teilen sie auch Actor/History und lassen sich nicht einzeln widerrufen. Minimale Option: mehrere benannte Grants je Dokument mit eigenem Main-vergebenem Actor. Ein vom Client übermittelter Toolname bleibt eine Behauptung, keine verifizierte Identität.
- **Transportbudgets:** Die 40-MiB-Grenze muss an beiden Eingängen vor dem JSON-Parse gelten: Host→stdio-Adapter und Adapter→Main. Anzahl offener Verbindungen, insgesamt gepufferte Bytes, ausstehende Requests und deduplizierte Resultate brauchen konkrete Grenzen. Vollständige Dokumente in Antworten nicht unbemerkt gleichzeitig als großen Text und strukturierten Inhalt verdoppeln. Die SDK-Dokumentation unterscheidet Byte- und Tool-Elementgrenzen; die tatsächliche stdio-Konfiguration muss gegen das 32-MiB-Domänenlimit getestet werden. [SDK-Tools und Limits](https://github.com/modelcontextprotocol/typescript-sdk/blob/main/docs/servers/tools.md).
- **Durability:** Ein erfolgreicher MCP-Commit ist zunächst nur eine Änderung des offenen Dokuments. Toolresultate sollten Revision und den tatsächlichen ungespeicherten Zustand benennen; ein fehlendes Save-Tool ist zulässig, ein behaupteter Dateispeichererfolg nicht. Bei App-/Renderer-Absturz kann ein bestätigter ungespeicherter Stand verloren gehen; MCP darf diese Grenze nicht durch eine zweite heimliche Dokumentkopie „lösen“.

## Gemeinsame Grenze zu P2P und UI

Mit dem P2P-Reviewer wird folgende minimale Vertragserweiterung abgeglichen; dies ist noch keine Produktimplementierung:

- Ein asynchrones `WriteGateway.submit` kapselt den weiterhin synchronen, privaten Controller für sämtliche Writer einschließlich Undo/Redo. Der Auftrag enthält Operation, `expectedRevision` und die Dokument-Session aus persistenter `documentId` plus nicht wiederverwendbarer Controller-Epoche. Actor und Grant kommen aus dem geprüften Aufruferkontext, nicht aus beliebigen Payload-Feldern. Auch vor den bisher revisionslosen synchronen `undo`-/`redo`-Methoden prüft das Gateway CAS unmittelbar.
- Direkt vor dem synchronen Controller-Aufruf prüft das Gateway Session, Actorbindung, Grant-Generation/Schreibrecht, CAS und Lifecycle-Gate ohne weiteres `await`. Eine vorherige asynchrone Prüfung ersetzt diesen Schritt nicht.
- `beginTransition(close | replace)` liefert einen eindeutigen Barrier-Token, sperrt neue Einträge und ordnet bereits angenommene Arbeit eindeutig ein. Noch nicht linearisierte Arbeit wird vor der finalen Zustandsprüfung abgebrochen/zurückgewiesen oder unter derselben Sperre kontrolliert fertiggestellt. Bereits linearisierte Commits gehören zum geprüften Stand. Das Warten darf nicht von unbegrenzt ausstehenden Netzwerk-/MCP-Antworten abhängen: Commit-Fertigstellung und externe Zustellung sind unterschiedliche Zustände.
- Close-Ack und Aufheben einer Sperre sind an Barrier-Token und Session gebunden. Cancel/Fehler dürfen nur ihre eigene aktive Sperre lösen. Ein bestätigter Dokumentwechsel ersetzt die Session und invalidiert alte Aufträge; bloßes Transport-Reconnect tut das nicht.
- Ein Guest-Mirror bleibt schreibgeschützt. Guest-MCP-Aufträge müssen über den Owner und dessen gebundenen Peer-/Grant-Actor laufen. Kein direkter Mirror-Dispatch und keine vom Peer frei wählbare fremde Actor-ID; erzeugte Actor-Bezeichner müssen außerdem die vorhandenen Domain-Limits erfüllen.

## Bestätigte Grundlagen und Grenzen der Prüfung

Der enge lokale Transport, Main-vergebene Actoren, Pflicht-CAS und gemeinsame Domain passen zum Ziel. Für stdio sind Umgebungsvariablen als Credential-Zuführung ausdrücklich vorgesehen; dafür ist kein zusätzlicher OAuth-Server erforderlich. [Offizielle MCP-Autorisierung](https://modelcontextprotocol.io/specification/2026-07-28/basic/authorization).

Es wurden Quellen und vorhandener Code gelesen sowie offizielle SDK-Metadaten geprüft. Kein MCP-Server installiert oder gestartet, keine Produkt-/GitHub-/Graph-Schreiboperation ausgeführt und kein Plattform- oder Sicherheitstest als bestanden deklariert. Die Umsetzung und Aufnahme in `docs/concerns.md`/Verträge koordiniert Root.

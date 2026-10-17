# Unabhängiges Architektur-Review (Antigravity) zu Issue #6 (Epic #4)

- **Prüfer / Rolle:** Google Antigravity (`logic`, `interface`, `iam`, `devops`)
- **Modell & Modus:** Gemini 4 Argon (High), lesender Plan-/Review-Modus (`/plan`)
- **Geprüfter Stand:** Eingebettete Zielentwürfe aus [AGENTS.md](../../AGENTS.md), [docs/architecture.md](../../docs/architecture.md), [docs/contracts.md](../../docs/contracts.md), [docs/sprints.md](../../docs/sprints.md), [docs/concerns.md](../../docs/concerns.md) und [src/domain/types.ts](../../src/domain/types.ts).
- **Hinweis zur Durchführung:** Reine statische Entwurfs- und Vertragsprüfung des bereitgestellten Textstands. Es wurden **keine** Tools, Shell-Befehle, Builds, Linter oder Laufzeittests ausgeführt und keine Dateien verändert. Die geprüften Produktdateien sind Zielentwürfe und noch nicht implementiert.

---

## 1. Gesamtbewertung des Architekturentwurfs

Der Entwurf in [docs/architecture.md](../../docs/architecture.md) und [docs/contracts.md](../../docs/contracts.md) setzt die sechs Kernfähigkeiten aus [AGENTS.md](../../AGENTS.md) sauber in einen modularen TypeScript-Monolithen mit strikter Trennung zwischen Domänenmodell (`src/domain/`), Vue-Renderer (`src/renderer/`), privilegierter Electron-Hülle (`electron/`) und Adaptern (`src/codec/`, `src/interop/`, `src/catalog/`, `src/mcp/`, `src/collaboration/`) um.

Bevor die parallele Implementierung von Sprint 1 (#8, #9, #10) startet, bestehen jedoch **zehn konkrete vertragliche und sicherheitsrelevante Lücken**, die durch Codex in [docs/concerns.md](../../docs/concerns.md) und [docs/contracts.md](../../docs/contracts.md) entschieden und fixiert werden sollten, damit keine stillen Architekturentscheidungen zwischen Domäne und UI entstehen.

---

## 2. Priorisierte konkrete Bedenken (Trigger, Auswirkung, Alternative, Validierung)

### AG-01 (P0 / Kritisch) — `DocumentCommand` (`update`) kann optionale Referenzen über JSON nicht löschen und überschreibt `ElementStyle` vollständig

- **Betroffener Bereich:** Domain-Types & Commands ([`SketchElement`](../../src/domain/types.ts), [`ElementStyle`](../../src/domain/types.ts), [`DocumentCommand`](../../src/domain/types.ts), [docs/contracts.md](../../docs/contracts.md))
- **Trigger:**
  1. Ein Nutzer oder Agent löst ein Element aus einem Container (`parentId` soll entfernt werden), koppelt ein Connector-Ende ab (`from` oder `to` soll entfernt werden) oder löscht `text` / `documentationUrl`. Das `update`-Command nutzt `patch: Partial<Omit<SketchElement, 'id' | 'kind'>>`. Bei der Übertragung über JSON (Electron IPC, MCP, P2P) werden Schlüssel mit dem Wert `undefined` durch `JSON.stringify` entfernt (`{ parentId: undefined }` wird zu `{}`).
  2. Ein `update`-Command ändert nur eine Stil-Eigenschaft (z. B. `style.fill`), muss aber laut Typdefinition immer das komplette [`ElementStyle`](../../src/domain/types.ts)-Objekt übergeben.
  3. Wenn beim Löschen eines verbundenen Shapes laut [docs/contracts.md](../../docs/contracts.md) gilt: *„betroffene Connectoren verlieren gelöschte Referenzen und behalten ihre sichtbaren Endpunkte"*, fehlt dem Connector ohne `from`/`to` die Information, wo sein abgekoppelter Endpunkt liegt, sofern `points` nicht mindestens Start- und Endpunkt im Element-Koordinatensystem speichert.
- **Auswirkung:** Optionale Eigenschaften (`parentId`, `from`, `to`, `assetId`, `documentationUrl`, `text`) lassen sich über IPC/MCP/P2P nicht zurücksetzen. Partielle Stil-Updates überschreiben bei nebenläufigen Änderungen andere Stil-Felder. Abgekoppelte Connectoren sind geometrisch unterbestimmt.
- **Alternative:**
  1. Eigenen Typ `ElementPatch` in [src/domain/types.ts](../../src/domain/types.ts) definieren, der `style?: Partial<ElementStyle>` nutzt und für optionale Felder explizit `null` als Lösch-Sentinel erlaubt (`parentId?: string | null`, `from?: Endpoint | null`, `to?: Endpoint | null`, `text?: string | null`, `documentationUrl?: string | null`, `metadata?: Record<string, string | null> | null`).
  2. Für `kind: 'connector'` vertraglich festlegen, dass `points` immer mindestens zwei Punkte (Start- und Endpunkt relativ zu `x, y`) enthält; beim Löschen eines referenzierten Ziel-Elements wird die jeweilige [`Endpoint`](../../src/domain/types.ts)-Referenz (`from`/`to`) auf `undefined` gesetzt, während die letzte berechnete Endpunkt-Koordinate in `points` erhalten bleibt.
- **Validierung:** Unit-Test in `tests/unit/domain/`: JSON-Roundtrip (`JSON.parse(JSON.stringify(command))`) eines `update`-Commands, das `parentId` und `from` via `null` entfernt und nur `style.stroke` ändert; Löschen eines mit einem Connector verbundenen Shapes und Prüfung der verbleibenden Connector-Geometrie.

---

### AG-02 (P0 / Kritisch) — Ungeklärte Koordinatensemantik bei `parentId` (Container-Verschachtelung)

- **Betroffener Bereich:** Domain-Types & Geometrie ([`SketchElement`](../../src/domain/types.ts), [docs/contracts.md](../../docs/contracts.md))
- **Trigger:** Ein Container (`kind: 'container'`) mit enthaltenen Kind-Elementen (`parentId === container.id`) wird verschoben, skaliert oder gedreht, oder ein Element wird per `update` in einen Container hinein- bzw. herausbewegt.
- **Auswirkung:** In [src/domain/types.ts](../../src/domain/types.ts) ist für `points` dokumentiert (`Element-local points, not screen coordinates`), für `x` und `y` eines Elements mit `parentId` jedoch nicht, ob sie relativ zum Parent-Container oder absolut im Dokument-Koordinatensystem (World Space) gespeichert werden. Treffen `src/domain/`, `src/renderer/` und `src/interop/` (draw.io nutzt standardmäßig Parent-relative Koordinaten) hier unterschiedliche Annahmen, springen Elemente beim Reparenting, Connectoren zwischen Elementen in verschiedenen Containern berechnen falsche Ankerpunkte, und das Verschieben eines Containers verhält sich zwischen UI und Code-Syntax inkonsistent.
- **Alternative:**
  - In [docs/contracts.md](../../docs/contracts.md) explizit festlegen: `x` und `y` in [`SketchElement`](../../src/domain/types.ts) sind **immer absolute Dokumentkoordinaten (World Space)**; `rotation` für `kind: 'container'` wird auf `0` beschränkt.
  - Vertraglich festlegen, ob ein `update` von `x`/`y` auf einem `container` innerhalb von [`applyCommand`](../../docs/contracts.md) alle Nachfahren automatisch um `(\Delta x, \Delta y)` mitverschiebt (empfohlen, damit auch Agenten-/Code-Updates konsistent bleiben) oder ob der Aufrufer alle Nachfahren im selben `update`-Command mitführen muss.
- **Validierung:** Unit-Test für mehrstufig verschachtelte Container (Container A → Container B → Shape C mit Connector zu Shape D außerhalb): Verschieben von Container A, Reparenting von Shape C und Prüfung aller Weltkoordinaten sowie der Azyklizitätsprüfung (`A -> B -> A` muss mit Validierungsfehler abgewiesen werden).

---

### AG-03 (P0 / Kritisch) — Lokale Persistenz: [`DesktopBridge`](../../src/domain/types.ts) kann weder bestehende Dateien direkt speichern noch externe Dateikonflikte erkennen

- **Betroffener Bereich:** Lokale Persistenz & Electron-IPC ([`DesktopBridge`](../../src/domain/types.ts), [docs/architecture.md](../../docs/architecture.md), [docs/contracts.md](../../docs/contracts.md))
- **Trigger:**
  1. [docs/architecture.md](../../docs/architecture.md) fordert: *„Speichern ist atomar mit nachvollziehbaren Fehlern; Überschreiben neuerer Dateiversionen ist ein Konflikt."*
  2. [`DesktopBridge`](../../src/domain/types.ts) definiert jedoch nur `openDocument(): Promise<{ text: string; name: string } | null>` und `saveDocument(text: string, suggestedName: string): Promise<{ name: string } | null>`. Es wird weder ein opakes Datei-Handle/Token für die geöffnete Zieldatei noch ein Versions-Token (`mtimeMs` / Content-Hash) übergeben, und Rückgabewerte kennen keinen strukturierten Konflikt- oder I/O-Fehlerzustand (`null` ist nicht von „Nutzer hat Dialog abgebrochen" unterscheidbar).
- **Auswirkung:** Entweder öffnet jedes `Strg/Cmd+S` erneut einen „Speichern unter"-Dateidialog, oder der Electron-Main-Prozess hält implizit einen globalen Dateipfad ohne Versionsabgleich, wodurch extern (z. B. durch `git pull` oder einen Texteditor) geänderte Dateien stillschweigend überschrieben werden. Gleichzeitig darf der Renderer aus Sicherheitsgründen keine freien Dateisystempfade an den Main-Prozess senden (Arbitrary-File-Write-Risiko).
- **Alternative:**
  - Der Electron-Main-Prozess verwaltet eine Map freigegebener Dateipfade pro Session hinter einem opaken `fileHandleId: string` und berechnet beim Lesen/Schreiben ein `diskVersionToken: string` (z. B. SHA-256-Hash + `mtimeMs`).
  - Erweiterung von [`DesktopBridge`](../../src/domain/types.ts) in [src/domain/types.ts](../../src/domain/types.ts):
    - `openDocument(): Promise<{ text: string; name: string; fileHandleId: string; diskVersionToken: string } | null>`
    - `saveDocument(options: { text: string; suggestedName: string; fileHandleId?: string; expectedDiskVersionToken?: string; saveAs?: boolean }): Promise<{ status: 'saved'; name: string; fileHandleId: string; diskVersionToken: string } | { status: 'cancelled' } | { status: 'conflict' | 'error'; message: string }>`
  - Atomares Schreiben im Main-Prozess über eine temporäre Datei im selben Zielverzeichnis (`<filename>.<random>.tmp`), `fileHandle.sync()` (`fsync`) und anschließendes atomares `fs.promises.rename()`.
- **Validierung:** Electron-/Persistenz-Test (#8): Datei öffnen, Zieldatei extern auf dem Dateisystem verändern, `saveDocument` mit dem ursprünglichen `expectedDiskVersionToken` aufrufen → Rückgabe muss `status: 'conflict'` sein und die extern geänderte Datei muss unversehrt bleiben.

---

### AG-04 (P0 / Kritisch) — Replikation & IAM (C-002): Ungeprüfte CRDTs vs. validiertes Command-Protokoll und Rollen-Durchsetzung beim Empfang

- **Betroffener Bereich:** Strict P2P & IAM (`src/collaboration/`, [docs/architecture.md](../../docs/architecture.md), C-002 in [docs/concerns.md](../../docs/concerns.md))
- **Trigger:**
  1. Ein verbundener Peer mit der Rolle `viewer` manipuliert seinen lokalen Client und sendet Schreiboperationen (`add`, `update`, `delete`, `replace`) oder Rollenänderungen über den WebRTC DataChannel.
  2. Zwei `editor`-Peers verschieben gleichzeitig Container ineinander (`A -> B` auf Peer 1, `B -> A` auf Peer 2) oder löschen ein Element, während der andere Peer einen Connector daran bindet.
- **Auswirkung:** Bei binärer CRDT-Replikation (z. B. Yjs-Update-Streams) konvergieren zwar einzelne Felder, aber dokumentweite Invarianten (Azyklizität von `parentId`, Referenzintegrität von `from`/`to`, Schema-Limits) sowie feingranulare Rollenprüfungen werden umgangen, sofern nicht jedes Update auf ein Schatten-Dokument angewendet und bei Fehlern die gesamte CRDT-Session verworfen wird. Zudem entstünde mit `Y.Doc` ein zweiter Zustands-Store neben [`SketchDocument`](../../src/domain/types.ts) (Widerspruch zu C-003).
- **Alternative:** Einsatz eines **validierten, kryptografisch signierten Command-Protokolls** (detaillierte Begründung und Protokollentwurf siehe Abschnitt 3) mit Ed25519-Signaturprüfung, vom Session-`owner` ausgestellten `RoleGrant`-Zertifikaten (`owner` | `editor` | `viewer`) und deterministischer Anwendung über [`applyCommand`](../../docs/contracts.md).
- **Validierung:** Zwei-Peer-Sicherheits- und Konflikttest (#14):
  1. Authentifizierter `viewer`-Peer sendet signiertes `DocumentCommand` → Empfänger lehnt vor [`applyCommand`](../../docs/contracts.md) mit `ERR_ROLE_FORBIDDEN` ab.
  2. Zwei `editor`-Peers erzeugen nebenläufig einen Container-Zyklus (`A -> B` und `B -> A`) → das in der deterministischen Ordnung erste Command gewinnt, das zweite wird von [`applyCommand`](../../docs/contracts.md) wegen Zyklusbildung abgewiesen; beide Peers konvergieren auf denselben gültigen [`SketchDocument`](../../src/domain/types.ts)-Zustand.

---

### AG-05 (P1 / Hoch) — Undo/Redo-Architektur bei Multi-Actor-Betrieb (Mensch, Code, MCP-Agent, Peer) und Transaktionsbündelung

- **Betroffener Bereich:** Commands & Undo/Redo ([`DocumentCommand`](../../src/domain/types.ts), [`CommandContext`](../../src/domain/types.ts), [docs/contracts.md](../../docs/contracts.md))
- **Trigger:**
  1. Eine Benutzerinteraktion (z. B. Komponente aus Katalog ziehen, automatisch mit bestehendem Element verbinden und Z-Order anpassen) erfordert mehrere atomare Operationen (`add` + `update` + `reorder`), aber [`DocumentCommand`](../../src/domain/types.ts) besitzt keinen `batch`-Typ.
  2. Der menschliche Nutzer führt eine Änderung durch (Revision 1 → 2), anschließend fügt ein MCP-Agent oder Peer ein Element hinzu (Revision 2 → 3), und der Nutzer betätigt `Undo`.
  3. Das Dokument enthält mehrere Bilder (`SketchAsset.dataUrl`), und der Undo-Stack speichert bei jeder Änderung vollständige [`SketchDocument`](../../src/domain/types.ts)-Kopien.
- **Auswirkung:** Ohne `batch`-Command zerfällt eine logische Geste in mehrere Undo-Schritte. Ein naiver Snapshot-Rollback bei `Undo` überschreibt zwischenzeitliche Änderungen von MCP-Agenten oder Peers. Vollständige Dokument-Snapshots führen bei eingebetteten Bildern zu hohem Speicherverbrauch, wenn `assets` nicht strukturell geteilt oder als inverse Deltas geführt werden.
- **Alternative:**
  1. [`DocumentCommand`](../../src/domain/types.ts) um `{ type: 'batch'; commands: DocumentCommand[] }` erweitern (atomare Ausführung: schlägt ein Teil-Command fehl, bleibt das Ausgangsdokument unverändert).
  2. Eine Funktion `applyCommandWithInverse(document: SketchDocument, command: DocumentCommand): { document: SketchDocument; inverse: DocumentCommand }` in `src/domain/index.ts` bereitstellen.
  3. Undo/Redo im Session-Controller als **invertierende Vorwärts-Transaktion** implementieren: Ein lokales Undo wendet das gespeicherte `inverse`-Command des jeweiligen Akteurs über [`applyCommand`](../../docs/contracts.md) auf den aktuellen Dokumentstand an und erhöht `revision` um 1, anstatt auf einen veralteten Gesamtsnapshot zurückzuspringen.
- **Validierung:** Unit-Test in `tests/unit/domain/` (#9): (a) `batch`-Command mit fehlerhaftem drittem Teilschritt lässt Ausgangsdokument unverändert; (b) `human`-Edit → `agent`-Edit → `human`-Undo erhält den `agent`-Edit und inkrementiert `revision` von 2 auf 3.

---

### AG-06 (P1 / Hoch) — Diagram-as-Code (`src/codec/`) und Canvas-Konflikte: Verlust von Assets/ComponentSets bei `replace` (C-003)

- **Betroffener Bereich:** Canvas/Code-Synchronisation ([`parseDiagram`](../../docs/contracts.md), [`DocumentCommand`](../../src/domain/types.ts), C-003 in [docs/concerns.md](../../docs/concerns.md))
- **Trigger:** Ein Dokument enthält eingebettete Bild-Assets (`assets`) oder importierte `componentSets` mit SVG-Icons. Der Nutzer bearbeitet den Diagramm-Quelltext im Code-Panel, woraufhin [`parseDiagram(source: string)`](../../docs/contracts.md) aufgerufen und das Ergebnis auf das Dokument angewendet wird; oder während eines ungespeicherten Text-Entwurfs (`draft`) ändert ein Agent/Canvas-Nutzer das Dokument.
- **Auswirkung:** Da eine menschenlesbare, Mermaid-ähnliche Syntax keine megabytegroßen Base64-`dataUrl`-Blobs oder vollständigen Katalog-SVGs inline enthalten soll, kann `parseDiagram(source: string)` ohne Kenntnis des bestehenden Dokuments kein vollständiges [`SketchDocument`](../../src/domain/types.ts) erzeugen, das die Validierung von `assetId`- und `componentType`-Referenzen besteht. Zudem fehlt im Vertrag die Konflikt-Schnittstelle, wenn `draftBaseRevision !== session.revision`.
- **Alternative:**
  1. Signatur in `src/codec/index.ts` erweitern zu `parseDiagram(source: string, contextDocument?: SketchDocument): ParseResult` (übernimmt `id`, `assets` und `componentSets` aus `contextDocument`, sofern im Text referenziert) und zusätzlich einen Helper `diffDocumentToCommand(prev: SketchDocument, next: SketchDocument): DocumentCommand` bereitstellen, der gezielte `batch`-Commands (`add`/`update`/`delete`/`reorder`) statt eines blinden Komplett-`replace` erzeugt.
  2. Im Session-Controller für den Code-Editor den Zustand `{ draftText: string; baseRevision: number; isDirty: boolean; diagnostics: ParseDiagnostic[] }` führen. Weicht `baseRevision` bei der Übernahme von `session.revision` ab, wird kein automatisches Überschreiben ausgeführt, sondern ein typisierter `CodeSyncConflict` (mit Liste der auf Canvas vs. im Text geänderten Element-IDs) an die UI gemeldet.
- **Validierung:** Unit-Test (#11): Dokument mit `image`-Element (`assetId`) und Custom-Component formatieren (`formatDiagram`), im Text ein Element-Label ändern, mit `parseDiagram(text, baseDoc)` parsen → `assets`, `componentSets` und unveränderte Element-IDs bleiben erhalten; zweiter Test prüft die Ablehnung/Konfliktmeldung bei veralteter `baseRevision`.

---

### AG-07 (P1 / Hoch) — Sicherer lokaler MCP-Zugriff: Authentifizierung der lokalen Desktop-Brücke, CAS-Pflicht und Prompt-Injection-Abwehr

- **Betroffener Bereich:** MCP & lokale Sicherheit (`src/mcp/`, `electron/`, [docs/architecture.md](../../docs/architecture.md))
- **Trigger:**
  1. Der stdio-MCP-Adapter (`src/mcp/`) verbindet sich zur Laufzeit mit der geöffneten Electron-App über eine lokale Brücke. Wenn diese Brücke ein unauthentifizierter localhost-Port oder ein ungeschützter IPC-Socket ist, können beliebige lokale Prozesse oder Browser-Webseiten (via lokaler Requests) auf geöffnete Architekturdiagramme zugreifen.
  2. Ein externer Agent liest ein Diagramm (Revision `N`), berechnet Änderungen und ruft ein Schreib-Tool auf, ohne `expectedRevision: N` mitzusenden, während der Nutzer im Canvas bereits Revision `N+1` erzeugt hat.
  3. Ein fremdes importiertes Diagramm enthält in `SketchElement.text` oder `metadata` bösartige Anweisungen (Indirect Prompt Injection), die ein lesender Agent als Systembefehl interpretiert.
- **Auswirkung:** Unbefugter lokaler Lese-/Schreibzugriff auf Diagramme, Überschreiben von Nutzeränderungen durch langsame Agenten-Runs oder ungewollte destruktive Änderungen durch Prompt-Injection.
- **Alternative:**
  1. **Lokaler Transport & Capability-Auth:** Die Brücke zwischen Electron-Main und dem stdio-MCP-Prozess nutzt einen Unix Domain Socket (macOS/Linux, Dateirechte `0600`) bzw. eine Named Pipe (Windows, ACL auf aktuellen User beschränkt) und verlangt beim Handshake ein kurzlebiges, kryptografisches 256-Bit-Capability-Token, das die erlaubten Scopes (`read` | `write`) und freigegebenen `documentId`s definiert.
  2. **Zwingendes Compare-and-Set (CAS):** Alle mutierenden MCP-Tools verlangen `documentId` und `expectedRevision: number` als Pflichtparameter. Bei `expectedRevision !== currentRevision` wird die Änderung abgewiesen und ein strukturierter Konflikt (`{ error: 'REVISION_CONFLICT', currentRevision }`) zurückgegeben.
  3. **Daten-Kapselung:** MCP-Lese-Tools markieren alle aus Diagrammen stammenden Freitexte explizit als untrusted Nutzdaten und erlauben ausschließlich das Erzeugen validierter [`DocumentCommand`](../../src/domain/types.ts)-Payloads (keine Datei-, Shell- oder Netzwerk-Operationen).
- **Validierung:** Integrationstest (#13): (a) Zugriff auf die lokale Brücke ohne gültiges Token oder mit `read`-Only-Token bei einem Schreibbefehl wird abgewiesen; (b) Schreibbefehl mit veralteter `expectedRevision` liefert `REVISION_CONFLICT`; (c) gültiger Agenten-Schreibbefehl erscheint in der UI und lässt sich vom Nutzer per Undo rückgängig machen.

---

### AG-08 (P1 / Hoch) — Strict P2P ohne STUN/TURN: WebRTC Non-Trickle ICE-Gathering, mDNS-Grenzen und Pairing-Token-Ablauf (C-001)

- **Betroffener Bereich:** Strict P2P Transport (`src/collaboration/`, [docs/architecture.md](../../docs/architecture.md), C-001 in [docs/concerns.md](../../docs/concerns.md))
- **Trigger:** Bei `new RTCPeerConnection({ iceServers: [] })` ohne Signaling-Server müssen sämtliche ICE-Kandidaten im manuell ausgetauschten Offer/Answer-Paket enthalten sein (Non-Trickle ICE). In der Praxis treten dabei drei Effekte auf:
  1. `iceGatheringState === 'complete'` kann durch virtuelle Netzwerkinterfaces (Docker, VPN-Adapter, WSL) 10–30 Sekunden blockieren.
  2. Chromium/Electron generiert für lokale Schnittstellen häufig `.local`-mDNS-Kandidaten, die in manchen Unternehmens-LANs oder über VPN-Interfaces ohne Multicast-Routing nicht aufgelöst werden.
  3. Dauert der manuelle Copy/Paste-Austausch von Offer und Answer durch den Menschen länger als das interne WebRTC-ICE-Timeout, schlägt der DTLS-Handshake fehl, ohne dass die Ursache für den Nutzer erkennbar ist.
- **Auswirkung:** P2P-Verbindungen schlagen selbst im selben LAN/VPN fehl oder hängen beim Erstellen des Einladungscodes, und der Nutzer erhält keine klare Diagnose.
- **Alternative:**
  1. **Gathering mit Timeout-Guard:** ICE-Gathering wartet auf `iceGatheringState === 'complete'`, bricht aber kontrolliert nach einem Timeout (z. B. 3.000 ms) ab, sobald mindestens ein direkter `host`-Kandidat gesammelt wurde.
  2. **Kompaktes, signiertes Pairing-Paket mit Ablaufzeit:** Das ausgetauschte Token enthält neben dem komprimierten SDP den Ed25519-Public-Key, den DTLS-Fingerprint, einen Zeitstempel (`issuedAt`, `expiresAt`) sowie eine Diagnose-Zusammenfassung der gefundenen Kandidatentypen (`lan-ipv4`, `ipv6`, `mdns-only`).
  3. **Sichtbare Verbindungszustandsmaschine:** Explizite Zustände (`gathering-candidates` → `awaiting-peer-answer` → `verifying-fingerprint` → `connected` | `failed-unreachable` | `failed-timeout`) im Collaboration-Vertrag, damit die UI Verbindungsgrenzen gemäß C-001 klar anzeigen kann.
- **Validierung:** Zwei-Peer-Test (#14) mit `iceServers: []`: (a) erfolgreicher Verbindungsaufbau inklusive Fingerprint-Verifikation; (b) simulierter nicht erreichbarer Peer / abgelaufenes Answer-Token führt deterministisch in den Zustand `failed-unreachable` bzw. `failed-timeout` mit klarer Fehlermeldung.

---

### AG-09 (P2 / Mittel) — Unbegrenztes Wachstum von [`SketchDocument.assets`](../../src/domain/types.ts) und fehlendes Metadata-Update-Command

- **Betroffener Bereich:** Domain-Types & Commands ([`SketchDocument`](../../src/domain/types.ts), [`DocumentCommand`](../../src/domain/types.ts))
- **Trigger:**
  1. Ein Nutzer fügt Bilder (`kind: 'image'`) mit `SketchAsset.dataUrl` hinzu und löscht die Bild-Elemente später wieder via `{ type: 'delete', ids }`. In [docs/contracts.md](../../docs/contracts.md) ist nicht geregelt, ob verwaiste Einträge in `document.assets` entfernt werden.
  2. Dokumentweite Metadaten (`SketchDocument.metadata`) sollen aktualisiert werden, aber [`DocumentCommand`](../../src/domain/types.ts) kennt nur `rename` (für `title`) und `set-component-sets`, jedoch kein Command für `metadata`.
- **Auswirkung:** Gelöschte Bilder verbleiben dauerhaft als Base64-Blobs in der `.sketchdraw`-Datei und blähen Speicher, Persistenz und P2P-Synchronisation auf. Dokument-Metadaten können nur über ein vollständiges `replace` des Dokuments geändert werden.
- **Alternative:**
  1. Bei `{ type: 'delete', ids }` in [`applyCommand`](../../docs/contracts.md) automatisch nicht mehr von verbleibenden Elementen referenzierte `assets` aus `document.assets` bereinigen (das durch `applyCommandWithInverse` erzeugte inverse `add`-Command enthält die gelöschten [`SketchAsset`](../../src/domain/types.ts)-Objekte, sodass Undo verlustfrei funktioniert).
  2. [`DocumentCommand`](../../src/domain/types.ts) um `{ type: 'set-metadata'; metadata: Record<string, string | null> }` erweitern.
- **Validierung:** Unit-Test: Bild-Element samt Asset hinzufügen → Element löschen (`document.assets` ist leer) → Undo ausführen (Bild-Element und Asset sind wiederhergestellt).

---

### AG-10 (P2 / Mittel) — Fehlende konkrete Validierungsgrenzen (`DOMAIN_LIMITS`) und Fehlerklasse für [`validateDocument`](../../docs/contracts.md) (C-004)

- **Betroffener Bereich:** Eingabevalidierung & Interop ([docs/contracts.md](../../docs/contracts.md), [`ValidationIssue`](../../src/domain/types.ts), C-004 in [docs/concerns.md](../../docs/concerns.md))
- **Trigger:** [`validateDocument(input: unknown)`](../../docs/contracts.md) und [`deserializeDocument(text: string)`](../../docs/contracts.md) sollen laut [docs/contracts.md](../../docs/contracts.md) strukturierte Validierungsfehler werfen und Größen-, Element-, Text- sowie Verschachtelungslimits prüfen. In [src/domain/types.ts](../../src/domain/types.ts) sind diese Limits und die geworfene Fehlerstruktur jedoch noch nicht als exportierte Konstanten/Klassen festgelegt.
- **Auswirkung:** UI (`src/renderer/`), Domain (`src/domain/`) und Interop (`src/interop/`) legen abweichende Grenzwerte zugrunde oder können geworfene Validierungsfehler nicht typisiert nach [`ValidationIssue`](../../src/domain/types.ts) auswerten.
- **Alternative:** In `src/domain/` eine Fehlerklasse `DomainValidationError extends Error { readonly issues: ValidationIssue[] }` sowie ein konstantes Objekt `DOMAIN_LIMITS` exportieren:
  - `MAX_DOCUMENT_JSON_BYTES: 25 * 1024 * 1024` (25 MiB)
  - `MAX_ELEMENTS: 10_000`
  - `MAX_CONTAINER_DEPTH: 32`
  - `MAX_ID_LENGTH: 128` (nur sichere ASCII-Zeichen `^[a-zA-Z0-9._:-]+$`)
  - `MAX_TEXT_LENGTH: 50_000`
  - `MAX_POINTS_PER_ELEMENT: 10_000`
  - `MAX_ASSET_BYTES: 10 * 1024 * 1024` (10 MiB, strikte Prüfung des `data:image/(png|jpeg|webp);base64,...`-Präfixes)
  - `MAX_COORDINATE_ABS: 1_000_000`, `MAX_DIMENSION: 1_000_000`
  - Verbot der Schlüssel `__proto__`, `constructor`, `prototype` in allen `Record`-Strukturen (`metadata`, `assets`) schon beim JSON-Reviver in [`deserializeDocument`](../../docs/contracts.md).
  - URL-Allowlist für `documentationUrl`: ausschließlich `https:` und `http:` (Verbot von `javascript:`, `data:`, `file:`, `vbscript:`).
- **Validierung:** Unit-Test-Suite mit Grenz- und Negativfällen (überdimensioniertes JSON, `__proto__`-Payload, `NaN`/`Infinity`, `javascript:`-Link, tiefer Container-Baum > 32 Ebenen).

---

## 3. Begründete Architekturempfehlung: CRDT vs. Validiertes, signiertes Command-Protokoll (zu C-002)

### Empfehlung
Für Sketchdraw wird **ein validiertes, kryptografisch signiertes Command-Protokoll mit deterministischer Konfliktauflösung** empfohlen – **kein** direktes binäres CRDT-Protokoll (wie ungeprüfte Yjs-Update-Streams) als kanonische Replikationsschicht.

### Gegenüberstellung und Begründung

| Kriterium | Ungeprüftes CRDT (z. B. Yjs-Update-Stream) | Validiertes, signiertes Command-Protokoll (Empfehlung) |
| --- | --- | --- |
| **Kanonisches Modell (C-003)** | Erfordert ein paralleles `Y.Doc` neben [`SketchDocument`](../../src/domain/types.ts); Risiko von Divergenz zwischen CRDT-State und Domain-State. | Arbeitet direkt auf [`SketchDocument`](../../src/domain/types.ts) und [`DocumentCommand`](../../src/domain/types.ts). Eine einzige Wahrheit für UI, Code, MCP und P2P. |
| **Dokument-Invarianten** | Nebenläufige `parentId`-Änderungen (`A -> B` und `B -> A`) konvergieren in CRDTs auf Feldebene, erzeugen aber **ungültige Container-Zyklen** oder dangling Connector-Referenzen. | Jedes Command durchläuft [`applyCommand`](../../docs/contracts.md). Verletzt ein konkurrierendes Command nach den vorangegangenen Schritten die Azyklizität oder Referenzintegrität, wird es deterministisch abgewiesen. |
| **IAM & Rollenprüfung (C-002)** | Binäre CRDT-Deltas sind schwer vorab auf granulare Rollenberechtigungen (`viewer` vs. `editor` vs. `owner`) und Größenlimits zu prüfen. | Jedes Paket ist ein `SignedCommandEnvelope` mit Ed25519-Signatur des Senders. Der Empfänger prüft Signatur und `RoleGrant` (`owner`/`editor`) **vor** dem Aufruf von [`applyCommand`](../../docs/contracts.md). |
| **Lokales Undo/Redo & MCP** | Yjs-UndoManager kollidiert leicht mit externen Voll-/Teil-Updates aus Diagram-as-Code und MCP. | Identische Command- und Inverse-Command-Semantik für Mensch, Code-Editor, MCP-Agent und P2P-Peer. |
| **Abhängigkeiten & Angriffsfläche** | Zusätzliche komplexe CRDT-Laufzeit und binäre Parser-Angriffsfläche für untrusted Peer-Inputs. | Reines TypeScript auf Basis der bestehenden Domain-Validierung und WebCrypto (`Ed25519`, `SHA-256`). |

### Funktionsweise des empfohlenen Command-Protokolls (`src/collaboration/`)
1. **Authentifizierte Session & Rollenbindung:**
   - Beim Pairing tauschen die Peers ihre Ed25519-Public-Keys gebunden an den DTLS-Fingerprint aus und bestätigen den gemeinsamen kurzen SAS-Fingerprint.
   - Der Session-Ersteller (`owner`) signiert für jeden Peer ein `RoleGrant` (`{ sessionId, peerId, peerPublicKey, role: 'owner' | 'editor' | 'viewer', issuedAt }`).
2. **Signierte Command-Envelopes:**
   - Jede Schreibänderung wird als `SignedCommandEnvelope` übertragen: `{ sessionId, commandId, actorId, lamportClock, baseRevision, command: DocumentCommand, signature }`.
   - `viewer`-Peers dürfen ausschließlich flüchtige `PresenceMessage`-Pakete (Cursor/Viewport) senden; eingehende `SignedCommandEnvelope`-Pakete eines `viewer` werden sofort am Eingangs-Gatekeeper verworfen.
3. **Deterministische Ordnung & Reconnect:**
   - Der Session-`owner` (bzw. bei mehreren Editoren eine deterministische Total-Order nach `(lamportClock, actorId)`) ordnet konkurrierende Commands in eine eindeutige Sequenz.
   - Konkurrierende Element-Patches (`update`) auf unterschiedlichen Elementen oder unterschiedlichen Feldern desselben Elements kommutieren; bei Konflikt auf demselben Feld gewinnt deterministisch das höhere Tupel `(lamportClock, actorId)`. Wurde ein Ziel-Element durch ein früher eingeordnetes `delete` bereits gelöscht, wird ein nachfolgendes `update` auf diesem Element verworfen.
   - Nach jedem angewendeten Command-Schritt lässt sich über `SHA-256(serializeDocument(doc))` die Zustandsgleichheit zwischen Peers prüfen. Bei Reconnect synchronisieren Peers fehlende Commands ab der letzten gemeinsamen Sequenz oder übernehmen einen vom `owner` signierten und lokal via [`validateDocument`](../../docs/contracts.md) geprüften Snapshot.

---

## 4. Begrenzter Implementierungsplan für #8 (Setup/Persistenz) und #9 (Domain/Commands/Undo)

> **Wichtiger Vorbehalt:** Dieser Plan beschreibt die vorgeschlagene Umsetzung für Antigravity in Sprint 1 (#8 und #9). Vor Beginn der Implementierung entscheidet Codex über die in Abschnitt 2 genannten Vertragspräzisierungen (insb. AG-01, AG-02, AG-03, AG-05, AG-10) und gibt die Verträge in [docs/contracts.md](../../docs/contracts.md) frei. Es werden keine stillen Vertragsänderungen vorgenommen.

### 4.1 Abgrenzung der Zuständigkeiten in Sprint 1
- **Antigravity (#8 & #9):** Projekt-/Build-/Test-Grundgerüst (`package.json`, `tsconfig.json`, `vite.config.ts`, `vitest.config.ts`), Electron-Main- und Preload-Prozess (`electron/`), sichere lokale Datei-Persistenz inkl. Browser-Fallback-Adapter sowie die reine Domain-Engine (`src/domain/`) samt Unit- und Electron-Persistenz-Tests (`tests/unit/domain/`, `tests/electron/`).
- **Claude Code (#10):** Vue-3-Renderer, Canvas-/Whiteboard-Interaktion und UI-Komponenten (`src/renderer/`) sowie UI-Tests (`tests/ui/`).
- **Codex (#6, #7, Sprint-Koordination):** Freigabe der gemeinsamen Verträge in [docs/contracts.md](../../docs/contracts.md) und [src/domain/types.ts](../../src/domain/types.ts), Abnahme der Testnachweise und Pflege von Graphify / Work-Ledger.

---

### 4.2 Arbeitspaket #9: Domain-Engine, Validierung, Commands & Transaktions-Undo (`src/domain/`)

#### Geplante Dateistruktur (`src/domain/`)
1. **[src/domain/types.ts](../../src/domain/types.ts)** *(nur nach Abstimmung/Freigabe durch Codex anpassen)*:
   - Ergänzung der abgestimmten Vertragstypen (falls von Codex freigegeben: `ElementPatch` mit Nullability für optionale Felder + `Partial<ElementStyle>`, `batch`-Command, `DomainValidationError`, `DOMAIN_LIMITS`).
2. **`src/domain/limits.ts` [NEU]**:
   - Zentrale Grenzwerte (`DOMAIN_LIMITS`) für JSON-Bytegröße, Elementanzahl, Textlängen, Koordinatenbereich, Container-Tiefe, Asset-Größen und erlaubte URL-Schemata (`https:`, `http:`).
3. **`src/domain/validation.ts` [NEU]**:
   - Laufzeit-Validierung `validateDocument(input: unknown): SketchDocument` ohne externe Schema-Abhängigkeiten oder mit leichtgewichtigem, deterministischem Validator.
   - Schutz vor Prototype Pollution (`__proto__`, `constructor`, `prototype`), Prüfung auf endliche Zahlen (`Number.isFinite`), nicht-negative `width`/`height`, normalisierte `anchor`-Koordinaten (`0 <= x, y <= 1`), eindeutige stabile IDs, Existenz von `assetId`- und `from`/`to`-Referenzen sowie Zykluserkennung in `parentId`-Ketten (DFS mit Tiefenlimit).
4. **`src/domain/factory.ts` [NEU]**:
   - `createDocument(title?: string): SketchDocument` (erzeugt leeres Dokument der `schemaVersion: 1` mit stabiler ID und Standardwerten).
   - `createElement(kind: ElementKind, overrides?: Partial<SketchElement>): SketchElement` (setzt valide Standardgeometrie, Default-[`ElementStyle`](../../src/domain/types.ts) und elementtypspezifische Pflichtfelder).
5. **`src/domain/commands.ts` [NEU]**:
   - `applyCommand(document: SketchDocument, command: DocumentCommand): SketchDocument` (reine Funktion ohne Mutation des Eingabe-Dokuments).
   - Atomare Ausführung für `add`, `update`, `delete` (inkl. kaskadierendem Löschen von Container-Nachfahren und sauberem Bereinigen betroffener Connector-Referenzen), `reorder` (Prüfung auf vollständige Permutation vorhandener Element-IDs), `rename`, `set-component-sets` und `replace`.
   - Jedes Ergebnis durchläuft vor Rückgabe die Invariantenprüfung; bei Fehlern bleibt das Ausgangsdokument unverändert.
6. **`src/domain/history.ts` [NEU]**:
   - Transaktionsbasierter Session-/History-Controller (`DocumentSession` + Undo/Redo-Stack für abgeschlossene Command-Transaktionen, getrennt von flüchtigen Pointermove-Vorschauen, inkl. `expectedRevision`-Prüfung).
7. **`src/domain/serialization.ts` [NEU]**:
   - `serializeDocument(document: SketchDocument): string` (deterministisches JSON mit stabil sortierten Objekt-Schlüsseln und 2-Space-Formatierung für Git-Freundlichkeit).
   - `deserializeDocument(text: string): SketchDocument` (Byte-Limit-Prüfung vor `JSON.parse`, sicherer JSON-Reviver gegen `__proto__` und anschließendes `validateDocument`).
8. **`src/domain/index.ts` [NEU]**:
   - Öffentlicher Barrel-Export exakt gemäß [docs/contracts.md](../../docs/contracts.md).

---

### 4.3 Arbeitspaket #8: Projekt-Setup, Electron-Hülle & Sichere lokale Persistenz (`electron/`)

#### Geplante Dateistruktur (`electron/` & Root-Konfiguration)
1. **`package.json`, `tsconfig.json`, `vite.config.ts`, `vitest.config.ts` [NEU]**:
   - Minimale, reproduzierbare Konfiguration für TypeScript (`strict: true`), Vue 3, Vite, Electron und Vitest.
   - Skripte: `typecheck`, `test:unit`, `build`, `dev:browser`, `dev:electron`.
2. **`electron/main.ts` [NEU]**:
   - Erstellt `BrowserWindow` mit gehärteten Sicherheitsvorgaben gemäß [docs/architecture.md](../../docs/architecture.md):
     - `contextIsolation: true`
     - `sandbox: true`
     - `nodeIntegration: false`
     - `webSecurity: true`
   - Blockiert unerlaubte Navigation (`will-navigate`) und neue Fenster (`setWindowOpenHandler`), setzt restriktive Content-Security-Policy (keine Remote-Skripte, kein `unsafe-eval`).
3. **`electron/ipc-handlers.ts` & `electron/persistence.ts` [NEU]**:
   - Prüft bei jedem IPC-Aufruf den `event.senderFrame` (nur lokales Hauptfenster erlaubt) sowie die Payload-Struktur und Größenlimits.
   - `openDocument`: Nativer `dialog.showOpenDialog` (`.sketchdraw`, `.json`), Größenprüfung vor dem Lesen, Validierung via `deserializeDocument`, Rückgabe an den Renderer.
   - `saveDocument` / `exportFile`: Nativer `dialog.showSaveDialog` (bzw. Speichern auf registriertem Datei-Handle mit Konfliktprüfung gegen externe Änderungen, falls AG-03 angenommen wird), Validierung des zu speichernden Inhalts, **atomares Schreiben** über temporäre Datei im Zielverzeichnis + `fsync` + `rename`.
   - `openExternal`: Strikte URL-Parser-Prüfung (`https:` / `http:` Allowlist) vor Übergabe an `shell.openExternal`.
4. **`electron/preload.ts` [NEU]**:
   - Exponiert über `contextBridge.exposeInMainWorld('sketchdraw', ...)` ausschließlich die benannten Methoden von [`DesktopBridge`](../../src/domain/types.ts); kein rohes `ipcRenderer` im Renderer.
5. **`src/platform/browser-bridge.ts` [NEU]**:
   - Expliziter Browser-Test-/Entwicklungsadapter für [`DesktopBridge`](../../src/domain/types.ts) (Dateiauswahl via `<input type="file">` und Download via Blob), klar getrennt von nativen Electron-Tests.

---

### 4.4 Geplanter Verifikationsplan für #8 und #9 (noch nicht ausgeführt)

Sobald Codex die Verträge freigibt und die Implementierun

---

## Integrator-Vermerk

Unveränderte inhaltliche Antwort aus dem echten Antigravity-CLI-Lauf `antigravity-architecture-002`; lokale Linkziele normalisiert. Geprüft wurde ein von Codex bereitgestellter Dateisnapshot, keine Laufzeit. Der zurückgegebene Text endet im Verifikationsplan unvollständig; die Empfehlungen werden als Review-Eingang weiterbearbeitet, nicht als fertige Implementierung gewertet. Die CLI meldete für diesen nichtleeren Bericht 0 Sekunden und 0 Tokens; diese Telemetrie ist unplausibel und wird im Ledger als unbekannt geführt. Die Prozessdauer wurde unabhängig gemessen.

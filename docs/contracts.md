# Gemeinsame Verträge — S1 v2

Issue [#6](https://github.com/J-ARTS/de.sketchdraw.io/issues/6). Definitionen: `src/domain/types.ts`. Diese Datei fixiert nach Antigravity-Review AG-01–AG-10 die gemeinsame Sprache für S1. Eine Laufzeit ist damit noch nicht nachgewiesen. Claude-Bedenken CL-01–CL-14 sind im Bedenkenregister gegen v2 entschieden.

## Exporte

Antigravity implementiert einen stabilen Einstieg `src/domain/index.ts`:

```ts
export * from './types';
export function createDocument(title?: string): SketchDocument;
export function createElement(kind: ElementKind, overrides?: Partial<SketchElement>): SketchElement;
export function validateDocument(input: unknown): SketchDocument; // throws structured validation error
export function applyCommand(document: SketchDocument, command: DocumentCommand): SketchDocument;
export function serializeDocument(document: SketchDocument): string; // deterministic JSON
export function deserializeDocument(text: string): SketchDocument; // size/schema validation
export function createController(document: SketchDocument, initialRevision?: number): DocumentController;
export class DomainValidationError extends Error { readonly issues: ValidationIssue[] }
export class DomainConflictError extends Error { readonly code: string; readonly currentRevision?: number }
export const DOMAIN_LIMITS: Readonly<Record<string, number>>;
```

`applyCommand` mutiert sein Eingabedokument nicht. IDs bleiben stabil. Updates einer unbekannten ID sind Fehler. `delete` entfernt ausgewählte Elemente und ihre Container-Nachfahren; betroffene Connectoren verlieren gelöschte Referenzen und behalten ihre letzten sichtbaren Endpunkte in `points`. Connectoren werden nicht automatisch gelöscht. Vor dem Abkoppeln werden die transformierten Ankerpunkte berechnet. Keine dangling references. `reorder` erwartet eine vollständige Permutation vorhandener IDs. `replace` wird vollständig validiert, einschließlich Asset- und Component-Referenzen. Schutz vor `__proto__`-/Prototype-Pollution-Schlüsseln gehört zur Eingabevalidierung.

Frontend: `src/renderer/` importiert nur diesen Einstieg und die separaten Adapter. Die Revision wird im Session-/Controller-Layer geführt, nicht in jedem persistenten Dokument geändert. Undo/Redo arbeitet auf abgeschlossenen Command-Transaktionen; Pointermove-Vorschauen erzeugen keinen Historieneintrag pro Pixel.

## Geometrie und Validierung

- Koordinaten und Rotationen sind endlich. Breite/Höhe sind nicht negativ; erlaubte Obergrenzen werden dokumentiert und getestet.
- `points` sind relativ zum Element, `anchor` ist normalisiert im Bereich 0–1.
- Containerbezüge sind azyklisch; Connectoren referenzieren vorhandene Elemente.
- IDs sind nicht leer, eindeutig, stabil und innerhalb dokumentierter Längenlimits.
- Elementanzahl, Textlänge, JSON-Größe, Assets und XML-Dekompression erhalten explizite Limits und verständliche Fehler.
- Imports, Peer- und MCP-Daten sind untrusted, auch wenn TypeScript-Typen passen.
- HTML im Text wird als Text dargestellt. Dokumentationslinks unterstützen nur explizit erlaubte Protokolle, nicht `javascript:`/`file:`.

### Verbindliche S1-Entscheidungen aus dem Review

- `x/y` sind absolute Dokumentkoordinaten, auch bei `parentId`. `points` sind elementlokal. Rotation ist im Uhrzeigersinn um die Elementmitte; Connector-Anker werden mit derselben Transformation aufgelöst. Container haben Rotation 0. Eine Container-Verschiebung verschiebt alle Nachfahren genau einmal um dasselbe Delta; eine Größenänderung verändert nur die Containergrenze. Reparenting allein verändert keine Geometrie. Gemeinsames Verschieben von Container und Nachfahren darf deren Bewegung nicht doppelt anwenden; der Aufrufer übergibt dafür nur die obersten ausgewählten Elemente.
- `ElementPatch`: `null` entfernt optionale Felder, `style` wird feldweise zusammengeführt, `metadata` schlüsselweise (`null` entfernt den Schlüssel; `metadata: null` entfernt das gesamte Feld). Unbekannte Felder und nicht-JSON-fähige Werte sind Fehler. `id/kind` bleiben unveränderlich.
- Jeder Connector besitzt mindestens zwei `points`. Gebundene Endpunkte werden aus Zielgeometrie und Anker berechnet; die gespeicherten Endpunkte dienen beim Abkoppeln als verlustfreier Fallback. Die Domäne aktualisiert betroffene Endpunkte auch bei Zielbewegung, Zielrotation und kaskadierendem Löschen. `points` eines Connectors dürfen deshalb nicht auf `null` gesetzt werden.
- `batch` führt begrenzt viele Commands sequenziell aus und übernimmt nur bei vollständigem Erfolg das Ergebnis. Teilcommands müssen gültige Zwischenstände erzeugen. Mehrere zusammengehörige neue Elemente können in einem `add` referenziert werden. Ein Batch ist eine Revision und eine Undo-Einheit; maximal 1.000 Teilcommands, maximal 4 Batch-Ebenen.
- `replace` verlangt dieselbe Dokument-ID und weist eine abweichende ID als Validierungsfehler zurück; das Öffnen eines anderen Dokuments erzeugt einen neuen Controller. Verwaiste Assets bleiben zunächst erhalten und unterliegen dem Gesamtlimit; automatische Assetbereinigung wird nicht mit einem normalen Delete vermischt. Eine spätere explizite Kompaktierung muss History-/Exportreferenzen beachten. Dokument-Metadaten werden über `set-metadata` schlüsselweise geändert.

### Controller, Revisionen und History

`createController(document, initialRevision = 0)` ist der gemeinsame Einstieg für UI und spätere Adapter. Der Controller validiert seinen Anfangsstand und gibt über `getSnapshot` eine abgetrennte oder tief eingefrorene Momentaufnahme zurück. `dispatch` verlangt für jede Quelle `actorId` und die aktuelle `expectedRevision`; Abweichungen werfen `DomainConflictError` mit `code: 'REVISION_CONFLICT'` und `currentRevision`. Fehler verändern weder Zustand noch Revision oder History. Ein erfolgreicher Command/Batch mit semantischer Änderung erhöht die Revision genau einmal und benachrichtigt Subscriber erst nach dem Commit; Subscriberfehler machen den Commit nicht rückgängig.

Undo/Redo ist pro `actorId` geführt und wendet eine neue validierte Transaktion auf den aktuellen Stand an. Es darf keinen alten Gesamtsnapshot über fremde Änderungen legen. Der Implementierer speichert die betroffenen Felder/Objekte mit ihrem Vorher-/Nachherwert und prüft vor der Inversion, ob diese Werte noch passen. Unbeteiligte Elemente und Felder bleiben erhalten. Wenn sich ein betroffenes Feld, eine Abhängigkeit oder eine nicht sicher rekonstruierbare Reihenfolge inzwischen geändert hat, wird Undo mit `HISTORY_CONFLICT` abgewiesen und verändert nichts. Diese konservative Ablehnung ist zulässig; ein stilles Überschreiben oder Teil-Undo nicht. `getHistoryState(actorId)` liefert dazu Verfügbarkeit und Konfliktgrund. Die UI ruft Undo mit ihrer lokalen Actor-ID auf; Agenten-/Peer-Änderungen sind getrennte Actoren.

Pflichtfälle: lokale Positionsänderung → fremdes Element hinzugefügt → lokales Undo erhält das fremde Element; lokale Positionsänderung → fremde Änderung derselben Position → Undo-Konflikt ohne Datenverlust; Batchfehler ohne Teiländerung; ein Drag erzeugt nur einen History-Eintrag. Snapshots dürfen Assetstrings strukturell teilen; UI-Pointervorschauen gehören nicht in die History.

### Gemeinsame Limits und Fehler

`DOMAIN_LIMITS` exportiert diese anfänglichen Sicherheitsgrenzen (keine Performancezusage): `MAX_DOCUMENT_JSON_BYTES = 32 * 1024 * 1024`, `MAX_ELEMENTS = 10_000`, `MAX_CONTAINER_DEPTH = 32`, `MAX_ID_LENGTH = 128`, `MAX_TEXT_LENGTH = 50_000`, `MAX_POINTS_PER_ELEMENT = 10_000`, `MAX_ASSET_BYTES = 8 * 1024 * 1024`, `MAX_TOTAL_ASSET_BYTES = 20 * 1024 * 1024`, `MAX_COORDINATE_ABS = 1_000_000`, `MAX_DIMENSION = 1_000_000`, `MAX_BATCH_COMMANDS = 1_000`, `MAX_BATCH_DEPTH = 4`. Bytegrenzen beziehen sich auf UTF-8 bzw. decodierte Assetbytes, nicht Stringzeichen. IDs sind nichtleer und verwenden ASCII `A–Z a–z 0–9 . _ : -`.

`DomainValidationError.issues` ist stabil typisiert. `__proto__`, `constructor` und `prototype` werden in Eingabe-Records abgewiesen; ebenso unbekannte Felder, nichtendliche Zahlen, zyklische JS-Eingaben und ungültige Referenzen. Asset-Präfix, Base64, tatsächliche PNG/JPEG/WebP-Signatur und Größenlimit müssen zusammenpassen. Links sind ausschließlich absolute `https:`/`http:`-URLs. Parserfehler werden getrennt von Revision-/Historykonflikten an die UI gegeben.

### Dateizugriff und Speicherzustand

Die neuen `DesktopBridge`-Typen verwenden ausschließlich opake, vom Main-Prozess vergebene `handleId`s. `openDocument` liefert Inhalt und `versionToken`; `save` erfordert Handle und erwartetes Token. Vor dem atomaren Schreiben wird der aktuelle Dateiinhalt mit dieser Version verglichen. Unbekannte Handles, falsche Sender oder freie Pfade aus Renderer-Nachrichten sind Fehler. Bei externer Änderung wird `conflict` zurückgegeben und nicht überschrieben. `save-as` nutzt immer einen nativen Dialog. Abbruch, I/O-Fehler und Erfolg sind getrennte Resultate.

Gleichzeitige Speicheraufrufe desselben Handles werden im Main-Prozess serialisiert. Atomarer Rename schützt vor halben Dateien, bietet aber alleine keinen atomaren Compare-and-Swap gegenüber fremden Prozessen; diese Restgrenze wird dokumentiert und unmittelbar vor Rename erneut geprüft. Browser-Downloads liefern `download-initiated`, niemals einen behaupteten nativen Speichererfolg. Erst `saved` mit neuer Dateiversion darf die UI als bestätigte Speicherung anzeigen. Änderungen während eines laufenden Saves bleiben als ungespeichert markiert, auch wenn die frühere Revision erfolgreich gespeichert wurde.

## Schema v2: Seiten

Seit ADR 0006 (`docs/decisions/0006-multi-page-schema-v2.md`) hat `SketchDocument` `schemaVersion: 2`, `pages: SketchPage[]` (1–100, `{ id, name }`) und trägt jedes Element `pageId`. Die flache Elementliste ist kanonisch nach Seiten gruppiert. `parentId` und Connector-Endpunkte dürfen die Seite nicht verlassen. Commands: `add` (mit optionalem `pageId`), `add-page`, `rename-page`, `delete-page`, `reorder-pages`; `reorder` permutiert die Elemente genau einer Seite. v1-Dokumente werden beim Laden zu einer Seite migriert, gespeichert wird immer v2.

## Adapter

`src/codec/index.ts`: `parseDiagram(source: string, contextDocument?: SketchDocument): ParseResult`, `formatDiagram(doc: SketchDocument): string`. Im Editor liefert der Kontext Dokument-ID, Assets und Component Sets; die Syntax muss referenzierte Ressourcen ausdrücklich benennen. Fehlende Ressourcen ohne Kontext sind strukturierte Fehler, kein stilles Entfernen. Ein Codeentwurf führt `baseRevision`; bei abweichender Sessionrevision bleibt er erhalten und wird nicht automatisch angewendet.

`src/catalog/index.ts`: `builtInComponentSets: ComponentSet[]`, validierter Import eigener Sets. Typen sind provider-namespaced, z. B. `aws.compute.instance`, ohne eine größere offizielle Bibliotheksabdeckung vorzutäuschen.

`src/interop/index.ts`: `importDrawio(xml: string): ImportResult`, `exportDrawio(doc): string`, `importSvg(svg: string): ImportResult`, `exportSvg(doc): string`. Unterstützte und nicht unterstützte Eigenschaften werden im Verlustbericht dokumentiert.

`window.sketchdraw` implementiert `DesktopBridge` in Electron. Im Browser-Testmodus gibt es einen expliziten Adapter für lokale Downloads/Dateiauswahl, keine vorgetäuschten nativen Dateitests.

Für MCP und P2P werden Protokollverträge nach dem unabhängigen Antigravity-Bericht ergänzt. Bis dahin keine unvalidierten Nachrichten direkt in das kanonische Dokument schreiben. Diese offene Entscheidung blockiert nicht Engine-/Canvas-Arbeit.

## Erster ausführbarer Integrationsfall

1. Dokument erzeugen und Rectangle + Text + Connector hinzufügen.
2. Connector-Referenz und Geometrie validieren.
3. Command-Transaktion bewegen, undo, redo.
4. Speichern, öffnen, Gleichheit der Semantik prüfen.
5. Dieselben Aktionen per UI ausführen und tatsächlichen Dokumentinhalt prüfen.

Die Implementierenden sollen jeden Vertrag, der ihre korrekte Umsetzung verhindert, als konkretes Bedenken melden. Codex entscheidet über die Änderung, dokumentiert sie und informiert beide Seiten vor dem parallelen Weiterarbeiten.


## Ergänzungen nach Claude-Review (CL-01–CL-14)

Die beiden tatsächlichen Sonnet-5.5-Reviewer prüften den früheren v1-Stand. Ihre Bedenken werden gegen v2 abgeglichen; Quellenbericht: `docs/reviews/claude-architecture.md`.

- Semantische No-Ops ändern weder Revision noch History und benachrichtigen keine Subscriber. Doppelte IDs innerhalb von `changes` oder `delete.ids` sind Fehler; unbekannte Delete-IDs werden abgewiesen. Netzwerkduplikate werden im Protokoll anhand Command-ID behandelt. `reorder` bleibt für S1 eine vollständige Permutation unter CAS; bei stale Basis erfolgt ein erklärbarer Konflikt. Geschwister müssen in der flachen Z-Liste nicht direkt hinter dem Parent liegen.
- `label` und `description` sind optionale zugängliche Eigenschaften aller Elemente und Teil der persistenten Semantik. `assetId` ist nur bei image, `componentType` nur bei component, `from/to` nur bei connector und `points` nur bei path/connector zulässig. Text und Metadaten dürfen auch Shapes beschriften. Der Renderer bietet eine Elementliste und einen begrenzten Fokuszugang zur Canvas statt tausender Tab-Stopps.
- `fontFamily` verwendet die Tokens sans/mono, Standard sans. Der Renderer bündelt die tatsächlich verwendeten offenen Fonts mit Lizenznachweis. Textboxen sind explizite persistente Geometrie, kein automatisches plattformabhängiges DOM-Reflow des Modells. Text, Bilder, Container, Components und gefüllte Shapes benötigen positive Dimensionen; path/connector dürfen in einer Achse 0 haben. Ein Text-Factory-Standard muss direkt wählbar sein. Beim Pfad-Resize skaliert der Renderer Punkte und Box in einer atomaren Änderung. Ein Ziehen über eine Gegenkante wird zu positiven Dimensionen normalisiert; Spiegelung als persistente Eigenschaft ist zunächst nicht vorgesehen.
- Pointervorschauen und Text-/IME-Entwürfe bleiben lokal. Die UI merkt sich Basisrevision und betroffene Werte. Nach einer Fremdänderung darf sie eine Geste nur auf die aktuelle Revision übertragen, wenn die betroffenen Werte unverändert sind; andernfalls erhält sie den Entwurf und zeigt einen Konflikt. Enter/Escape während IME-Composition lösen keinen Dokumentcommit aus. Leere neue Texte erzeugen kein Element. Einzeltasten-Kürzel gelten nur bei Canvas-Fokus; Eingabefelder behalten natives Text-Undo. Tastendrücke derselben gehaltenen Nudge-Geste werden im Renderer gebündelt, ohne eine Uhrpflicht in der Domäne.
- Menu- und Tastaturaktionen nutzen je einen Ausführungspfad. `onMenuCommand` leitet native Menüaktionen an den Renderer; dessen Fokus entscheidet zwischen Texteingabe und Dokumentaktion. Vor Fensterschließen sendet Main eine einmalige requestId über `onCloseRequested`. Der Renderer prüft Dokument- und Code-/Textentwürfe, bietet Speichern/Verwerfen/Abbrechen und antwortet über `respondToClose`. Main akzeptiert nur seine eigene ausstehende ID vom zugelassenen Sender. Fehlende Antwort schließt nicht still. Browsermodus verwendet beforeunload entsprechend seiner Plattformgrenzen.
- Anfangsfenster 1280×800, geprüfte Untergrenze 960×640; Panels unterhalb ausreichender Breite als Overlay. Zoom 10–400 %, UI-Ziele/Trefferzonen bleiben in Bildschirmpixeln nutzbar. Alles anzeigen und Zur Auswahl sind explizite Aktionen. Externe Änderungen verschieben den Viewport nicht automatisch; nach externem Löschen erhält der Canvas-/Listenfokus eine definierte nächste Position.
- `ParseDiagnostic` hat stabilen code, optionalen Endbereich und Element-/Issue-Bezug. Die Parserimplementierung ordnet semantische Fehler der Deklarationszeile zu. Parser liefert Resultate; Domäne wirft typisierte Fehler. Diese bewusst getrennten API-Stile bleiben bestehen, statt alle Aufrufer gleichzeitig umzustellen.
- Deterministisches JSON: rekursiv sortierte Objektschlüssel, erhaltene Arrayreihenfolge, zwei Leerzeichen, LF und ein abschließender Zeilenumbruch. JSON-Zahlen bleiben in ihrer verlustfreien JavaScript-Darstellung, -0 wird zu 0. Keine pauschale Rundung gespeicherter Geometrie; Anzeige darf runden. `serialize(deserialize(serialize(doc)))` ist bytegleich. Tests setzen Element-IDs über overrides und eine Dokument-ID vor Controller-Erzeugung; es gibt in der Domain keine zeitabhängige Coalescing-Logik.
- Katalog-Instanziierung, aliases, Widget-Namespace und deduplizierte Set-Übernahme gehören zu #11. Vor S2 wird `instantiateComponent` gemeinsam fixiert; #10 erfindet keine vorläufigen Exporte. Alle neun Elementarten werden von der Domäne unterstützt. Die acht freien Whiteboard-Arten und zugängliche Grundbedienung gehören zur S1-UI; Component-Katalog und Instanziierung folgen in #11; die geplanten 8 Story Points sind eine veränderbare Schätzung, keine Umfangsgrenze.

## AWS-Gruppenrahmen (#143)

Die AWS-Bibliothek enthält unter „Gruppen“ die 20 Gruppen der draw.io-Palette „AWS / Groups“. Es gibt keine neue Elementart und keinen Schemawechsel: Eine Gruppe ist ein `container`-Element, dessen Metadatenschlüssel `sketchdraw.group` die Gruppen-ID nennt (`aws.group.vpc`, `aws.group.region`, `aws.group.private-subnet` usw.; die Liste steht in `src/catalog/aws-groups.ts`). Rahmenfarbe, Füllung, Strichart, Textfarbe und Schriftgröße liegen weiter im normalen `style`; eine ältere App ohne die Registry zeigt die Gruppe deshalb als gerahmten Container ohne Kopf-Icon. Unbekannte Gruppen-IDs verhalten sich wie ein gewöhnlicher Container.

- **Darstellung (draw.io `mxgraph.aws4.group`):** Kopf-Kachel `25 × Schriftgröße/12` oben links in der Rahmenfarbe mit weißem Symbol, Beschriftung mit Einzug `32 × Schriftgröße/12`; Auto Scaling group zentriert Kachel und Beschriftung, Availability Zone, Security group und die beiden Generic groups sind einfache Rahmen mit zentrierter Beschriftung oben. Strichbreite 0 lässt den Rahmen weg (Private/Public subnet, Generic group gefüllt); die Kachel behält die Rahmenfarbe. Gestrichelte Rahmen verwenden das Muster `3 3` (mal Strichbreite). Neue Gruppen haben Schriftgröße 16 und 360 × 320 Einheiten; die Kopfgrößen skalieren mit der Schriftgröße.
- **Anklicken:** Gruppen ohne Füllung sind nur an Rahmen, Kopf-Kachel und Beschriftung treffbar (draw.io `pointerEvents=0`); ein Klick ins Innere wählt das Element darunter oder startet die Mehrfachauswahl. Gefüllte Gruppen sind überall treffbar.
- **Container-Verhalten für alle Container:** Das Ablegen eines Elements aus der Bibliothek oder das Ziehen mit der Maus macht es zum Kind des obersten Containers unter dem Zeiger (`parentId`); Ziehen auf die freie Fläche löst es. Während des Ziehens zeigt der Canvas den Container als Ablageziel. Das neue Kind wird in der Z-Reihenfolge über den Container gehoben. Tastatur-Verschieben, Verbinder und Frames ändern ihre Zugehörigkeit nicht; Klick ohne Ziehen auch nicht. Verschieben des Containers bewegt die Kinder, Größe ändern nicht (siehe oben).
- **Agenten:** `add` mit `kind: container`, `metadata: { "sketchdraw.group": "<id>" }` und dem Gruppenstil erzeugt dieselbe Gruppe; die Katalog-Instanziierung (`instantiateComponent`) tut das für die Bibliothekseinträge.
- **Interop:** siehe `docs/contracts-interop.md` (draw.io `mxgraph.aws4.group`, SVG-Kopf-Kachel).
- **Quelle der Symbole:** Die weißen Symbole stammen aus den AWS-Architektursymbolen des Katalogs (Gruppen-Icons; Elastic Beanstalk, Step Functions und IoT Greengrass aus den Service-Symbolen). `node scripts/generate-aws-group-glyphs.mjs` erzeugt `src/catalog/aws-group-glyphs.ts` neu.


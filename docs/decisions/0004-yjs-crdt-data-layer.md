# ADR 0004 — Yjs als CRDT-Datenschicht

Status: angenommen. Umsetzung wird in [#71](https://github.com/J-ARTS/de.sketchdraw.io/issues/71) geplant; der Transport folgt [ADR 0003](./0003-trystero-proxy-assisted-collaboration.md) und [#72](https://github.com/J-ARTS/de.sketchdraw.io/issues/72).

## Entscheidung

Yjs wird die verbindliche kollaborative Laufzeit-Datenschicht von Sketchdraw. `SketchDocument` bleibt das validierte, menschenlesbare und Git-freundliche Datei-, Diagram-as-Code-, Import-, Export- und MCP-Projektionsformat. Ein Yjs-Dokument ersetzt daher nicht das offene Dateiformat, sondern hält dessen gemeinsam bearbeitbaren Laufzeitzustand.

Die CRDT-Schicht bleibt vom Netzwerk getrennt. Trystero ist der erste automatische Transportadapter; Strict Direct bleibt verfügbar. Lokale Wiederherstellung verwendet `y-indexeddb`, ohne eine zentrale Dokumentablage einzuführen.

## Referenz und Quellen

OpenPencil kombiniert Vue 3, `@trystero-p2p/mqtt` 0.26, Yjs 13.6, `y-indexeddb` 9.0 und `nanoevents` 9.1. Als Quellreferenz dient Commit [`1c1986b20d15f2556c563d6c59d14a006269a40a`](https://github.com/open-pencil/open-pencil/commit/1c1986b20d15f2556c563d6c59d14a006269a40a).

Besonders relevant sind OpenPencils folgende Muster:

- ein `Y.Doc` pro Raum mit getrennten Maps für Nodes, Bilder, Metadaten und Variablen;
- gebündelte Scene-Graph-Ereignisse in einer Yjs-Transaktion;
- State-Vector-Sync bei Peer-Beitritt und inkrementelle `updateV2`-Nachrichten;
- Awareness für Cursor, Auswahl, Anwesenheit und Agenten, getrennt vom persistenten Dokument;
- `y-indexeddb` als lokale Raumkopie;
- ein eigener Tree-CRDT für Parent-Wechsel und Reihenfolge statt einer naiven Liste;
- typisierte Scene-Graph-Ereignisse über `nanoevents`, einschließlich gepufferter Zustellung nach einem erfolgreichen Batch;
- Normalisierung und Migration versionsabhängiger Felder.

Quellen: [OpenPencil Tech Stack](https://openpencil.dev/development/tech-stack), [OpenPencil Architecture](https://openpencil.dev/development/architecture), [OpenPencil Collaboration](https://openpencil.dev/programmable/collaboration), [OpenPencil SceneGraph Events](https://github.com/open-pencil/open-pencil/blob/1c1986b20d15f2556c563d6c59d14a006269a40a/packages/scene-graph/src/events.ts), [OpenPencil Buffered Events](https://github.com/open-pencil/open-pencil/blob/1c1986b20d15f2556c563d6c59d14a006269a40a/packages/scene-graph/src/buffered-events.ts), [Yjs Shared Types](https://docs.yjs.dev/getting-started/working-with-shared-types), [Yjs Awareness](https://docs.yjs.dev/getting-started/adding-awareness), [Yjs UndoManager](https://docs.yjs.dev/api/undo-manager), [y-indexeddb](https://docs.yjs.dev/ecosystem/database-provider/y-indexeddb).

## Zielmodell

```text
UI / Diagram as Code / MCP / Plugins
              │
              ▼
    Domain Commands + IAM Gate
              │
              ▼
    CrdtDocumentStore (Y.Doc)
       │                 │
       │                 ├── Awareness (flüchtig)
       │                 └── y-indexeddb (lokaler Recovery-Cache)
       ▼
Validated SketchDocument Projection
       │
       ├── Datei / Git / Import / Export
       └── Renderer-Snapshot

Y.Doc Updates ⇄ CollaborationTransport ⇄ authentisierte Peers
```

Alle lokalen Änderungen beginnen als validierte `DocumentCommand`s oder als gleichwertige, streng typisierte Text-/Presence-Operationen. Ein Adapter übersetzt sie in eine Yjs-Transaktion. Die UI und alle externen Schnittstellen lesen eine validierte `SketchDocument`-Projektion. So bleiben bestehende Domainregeln und das offene Textformat erhalten.

## Typisierte Event-Schicht mit nanoevents

`nanoevents` wird als kleine, typisierte Benachrichtigungsgrenze zwischen CRDT-Store, Projektion, Renderer, Persistenz und Transport verwendet. Die Event-Schicht ersetzt weder Commands noch Yjs-Transaktionen und speichert keinen eigenen Zustand.

Der Eventvertrag enthält zunächst:

- `document:committed` mit Origin, lokal/remote, betroffenen Element-IDs und lokalem Projektionszähler;
- `element:created`, `element:updated`, `element:deleted`, `element:reparented` und `element:reordered`;
- `presence:changed` für bereits validierte Awareness-Projektionen;
- `sync:status` für Transport- und Initial-Sync-Zustand;
- `persistence:synced` und `persistence:error` für den lokalen Recovery-Cache.

Events werden erst nach einer erfolgreichen Domain-/Yjs-Transaktion veröffentlicht. Mehrere Elementänderungen einer Geste oder eines Batch-Commands werden gepuffert und anschließend in stabiler Reihenfolge zugestellt. Listenerfehler dürfen einen bereits committed Zustand nicht zurückrollen und blockieren keine weiteren Listener; sie werden gesammelt und über den bestehenden Fehlerkanal gemeldet. Events enthalten kompakte IDs und Deltas statt vollständiger Dokumentkopien.

Die Migration ersetzt gezielt die verstreuten Listener-Sets in Domain-, Session- und Collaboration-Code. Vue-Komponenten behalten ihre lokalen `emit()`-Events; `nanoevents` wird nicht als globaler UI-Bus eingesetzt.

OpenPencil kapselt `createNanoEvents()` dafür in einem synchronen, verschachtelbar gepufferten Emitter. Sketchdraw übernimmt dieses Muster mit seinen eigenen Fehler- und Transaktionsregeln. `nanoevents@9.1.0` ist MIT-lizenziert und besitzt keine Laufzeitabhängigkeiten. Eine temporäre Browserbündelung ergab 236 Byte minifiziert beziehungsweise 179 Byte gzip; die oft genannte Größe von 108 Byte hängt von Messmethode und Kompression ab.

## Versioniertes Yjs-Schema

Der erste Entwurf verwendet benannte Top-Level-Typen:

| Yjs-Typ | Inhalt |
| --- | --- |
| `meta: Y.Map` | CRDT-Formatversion, Dokument-ID, Titel und sichere Metadaten |
| `elements: Y.Map<Y.Map>` | Elemente nach stabiler ID; skalare Felder granular, komplexe Werte normalisiert |
| `placements: Y.Map<Y.Map>` | Parent-Historie, Seite/Frame und Order-Key für deterministische Baum- und Z-Reihenfolge |
| `texts: Y.Map<Y.Text/Y.XmlFragment>` | gleichzeitig editierbarer Text und formatierter Annotationstext |
| `assets: Y.Map<Uint8Array>` | begrenzte Binärdaten getrennt von Elementmetadaten |
| `componentSets: Y.Map` | versionierte Komponentensets nach ID |
| `comments: Y.Map` | Threads und Nachrichten nach stabilen IDs; Nachrichteninhalt als `Y.Text` |
| `tasks: Y.Map` | Aufgaben nach stabiler ID; Status und Rank getrennt änderbar |

Yjs-Werte dürfen nicht als veränderbare JSON-Objekte außerhalb einer Transaktion weitergereicht werden. Projektionen werden geklont und durch die vorhandene Domainvalidierung geprüft.

### Baum und Reihenfolge

`SketchDocument.elements` kodiert zugleich Elementmenge und Back-to-front-Reihenfolge; `parentId` bildet Container ab. Eine einzelne `Y.Array` mit Entfernen und erneutem Einfügen ist für konkurrierende Moves unzureichend. Sketchdraw verwendet deshalb eine eigene Placement-Struktur mit:

- stabiler Element-ID;
- Parent-Einträgen mit deterministisch vergleichbarer Move-Uhr;
- zyklusfreier Konfliktauflösung;
- Order-Keys zwischen Geschwistern;
- deterministischer Waisenbehandlung, wenn Parent und Kind gleichzeitig geändert oder gelöscht werden.

OpenPencils Umsetzung nach dem Tree-CRDT-Ansatz von Evan Wallace ist Referenz. Der Code wird nicht blind kopiert; das Sketchdraw-Modell benötigt zusätzlich Frames, flache globale Z-Reihenfolge, Connector-Endpunkte und Domainlimits.

### Text, Kommentare und Aufgaben

Ein gesamtes Textfeld als skalarer `Y.Map`-Wert würde parallele Texteingaben gegenseitig überschreiben. Editierbarer Elementtext, Annotationen und Kommentartexte verwenden deshalb `Y.Text` oder eine strukturierte Yjs-Repräsentation mit stabilen Block-/Run-IDs. Aufgabenstatus, Rank und externe Jira-Referenz bleiben getrennte Felder, damit unabhängige Änderungen zusammengeführt werden können.

## Autorisierung und untrusted Updates

Yjs löst Konvergenz, nicht Identität oder Berechtigung. `Y.Doc.clientID`, Awareness-Client-ID und Trystero-Peer-ID sind keine Sketchdraw-Identitäten.

Jedes Remote-Update wird in einem signierten Sketchdraw-Envelope übertragen. Der Envelope bindet mindestens Dokument, Session, Actor, Grant, Permission-Epoch, Sequenz, Update-Hash und Protokollversion. Viewer dürfen keine Dokumentupdates senden. Widerrufene oder abgelaufene Grants werden vor der Yjs-Anwendung abgewiesen.

Yjs kann ein angewendetes fehlerhaftes Update nicht wie eine gewöhnliche Domain-Transaktion zurückrollen. Der erste sichere Adapter validiert deshalb in dieser Reihenfolge:

1. Transport-, Frame-, Dekompressions- und Updategrößenlimit;
2. Signatur, Sitzung, Rolle, Grant und Wiederholungsprüfung;
3. Update auf eine begrenzte Schattenkopie des aktuellen `Y.Doc` anwenden;
4. vollständige `SketchDocument`-Projektion und Domainlimits validieren;
5. erst danach dasselbe Update auf das aktive `Y.Doc` anwenden.

Diese Strategie ist zunächst bewusst konservativ und muss unter realen Dokumentgrößen gemessen werden. Spätere inkrementelle Validierung darf sie erst ersetzen, wenn dieselben Sicherheits- und Konvergenzeigenschaften nachgewiesen sind. Update-Duplikate sind durch Yjs idempotent, die Sketchdraw-Sequenzprüfung begrenzt zusätzlich Replay- und Ressourcenmissbrauch.

Vollständig dezentrale Offline-Bearbeitung begrenzt sofortige Widerrufbarkeit: Ein offline befindlicher, früher berechtigter Peer kennt eine alte Berechtigung. Beim Wiederverbinden werden Updates deshalb gegen Permission-Epoch und eine dokumentierte Widerrufsregel geprüft. Dieses Produktverhalten muss vor Freigabe ausdrücklich getestet und in der Oberfläche erklärt werden.

## Revision, Commit und Konflikte

Der heutige Controller besitzt eine einzige globale Integer-Revision und weist Writes mit abweichender `expectedRevision` zurück. Das verhindert echte Multi-Writer-Offline-Konvergenz. Mit Yjs gilt:

- State-Vectors und Updates bestimmen kausalen Synchronisationsstand;
- ein Integer `revision` bleibt nur ein lokaler, monotoner Projektions- und UI-Zähler;
- Dateispeicherung verwendet weiterhin Snapshot und Version-Token;
- fachliche Request-IDs bleiben für Idempotenz und Agentenresultate erhalten;
- Commit-Bestätigungen bestätigen Domainannahme und Projektion, nicht eine global identische Empfangsreihenfolge aller Peers.

Die Migration erfolgt hinter den bestehenden `DocumentSnapshotSource`- und Gateway-Grenzen. Erst wenn Konvergenz-, IAM- und Dateitests bestehen, wird der bisherige `DocumentAuthority`-Controller als alleinige Zustandsquelle abgelöst.

## Undo und Redo

`Y.UndoManager` unterstützt `trackedOrigins`. Sketchdraw erzeugt stabile lokale Origins für Human, Agent, Code und Import und führt pro lokalem Actor eine passende Undo-Historie. Entfernte Transaktionen werden nicht in den lokalen Undo-Stack aufgenommen. Gesten und Batch-Commands bilden jeweils eine Transaktion; `stopCapturing()` trennt fachlich abgeschlossene Schritte.

Cursor, Auswahl und Viewport gehören nicht in den Undo-Stack. Bei gelöschten oder konkurrierend verschobenen Elementen muss Undo gegen den bereits konvergierten Zustand getestet werden.

## Awareness

Awareness hält ausschließlich flüchtige Informationen: Presence, Cursor, Auswahl, Viewport/Folgemodus und begrenzte Agentenaktivität. Die Daten werden zur Laufzeit validiert, größenbegrenzt und bei Peer-Abgang entfernt. Prompts, Antworten, Tokens, Dateipfade, Credentials und vollständige Dokumentinhalte werden nicht als Awareness verteilt oder persistiert.

## Lokale Persistenz und Dateien

`y-indexeddb` speichert CRDT-Updates pro Dokument-/Raumkennung im Chromium-Profil und ermöglicht Neustart sowie Offline-Arbeit. Diese Kopie ist ein Recovery-Cache:

- eine `.sketchdraw`-Datei bleibt die explizite portable und Git-freundliche Quelle;
- Öffnen einer Datei erzeugt oder migriert ein Yjs-Dokument aus einem validierten Snapshot;
- Speichern projiziert und validiert einen atomaren `SketchDocument`-Snapshot;
- Raum verlassen, Dokument ersetzen und Cache löschen besitzen eindeutige Lebenszyklusregeln;
- Raum-ID, Dokument-ID und Dateipfad werden nicht gleichgesetzt;
- veraltete Updates werden über Formatversionen und Migrationen behandelt, nicht stillschweigend interpretiert.

## Assets und Speichergrenzen

Assets werden binär und dedupliziert nach Inhalts-Hash gespeichert. Metadaten referenzieren den Hash. Pro Asset, Update, Dokument und Sitzung gelten harte Limits. Initial-Sync und Assettransfer laufen getrennt von interaktiven Updates, damit große Bilder Cursor und Textänderungen nicht blockieren.

Yjs-Historie, Tombstones und IndexedDB-Wachstum werden gemessen. Kompaktierung darf nur über einen validierten Snapshot in eine neue Dokumentgeneration erfolgen; alle Peers müssen den Generationswechsel erkennen.

## Migrationsschritte

1. **Schema-Spike:** Yjs-Schema, Snapshotprojektion und deterministische Zwei-Dokument-Konvergenz ohne Netzwerk.
2. **Lokaler Store:** Commands, Text und Undo über `CrdtDocumentStore`; bestehender Renderer liest weiterhin Snapshots.
3. **Persistenz:** `y-indexeddb` mit Wiederherstellung, Cache-Lebenszyklus und Formatmigration.
4. **Transport:** signierte Updates über den Adapter aus ADR 0003; Awareness bleibt getrennt.
5. **Authority-Migration:** globale Revisionsannahmen durch State-Vector-/Grant-Verträge ersetzen.
6. **Freigabe:** reale Offline-, Proxy-, Last-, Speicher-, Datei-, MCP- und Plugin-Regressionen.

## Teststrategie

Ein deterministischer In-Memory-Provider verbindet mehrere `Y.Doc`-Instanzen und variiert Zustellreihenfolge, Duplikate, Trennung und Wiederverbindung. Mindestens geprüft werden:

- paralleles Add, Update und Delete desselben sowie verschiedener Elemente;
- konkurrierendes Reparenting und Reordering einschließlich Zyklusversuchen;
- parallele Texteingabe und Formatierung;
- Kommentare, Antworten, Auflösen, Aufgabenstatus und Jira-Referenzen;
- Undo/Redo pro Actor bei dazwischenliegenden Remote-Änderungen;
- State-Vector-Initial-Sync und inkrementeller Reconnect;
- identische kanonische `SketchDocument`-Projektion nach jeder vollständigen Synchronisation;
- Datei-Roundtrip und Diagram-as-Code-Roundtrip;
- Neustart über IndexedDB und saubere Cache-Löschung;
- abgewiesene Viewer-, Session-, Grant-, Replay-, Oversize- und Schemaangriffe;
- Speicher- und Latenzgrenzen mit großen Dokumenten und Assets.

OpenPencils Zufalls- und Concurrent-Edit-Tests dienen als Referenz für den Harness. Sketchdraw ergänzt seine strengeren IAM-, Datei- und Domaininvarianten.

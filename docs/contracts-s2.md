# S2-Vertragsvorschlag: Diagram as Code und Komponentenkatalog

Stand: 17.10.2026. Architekturarbeit zu [#6](https://github.com/J-ARTS/de.sketchdraw.io/issues/6), Umsetzung zu [#11](https://github.com/J-ARTS/de.sketchdraw.io/issues/11). **Von Codex für den begrenzten Codec-/Katalog-Auftrag freigegeben; noch keine implementierte oder getestete Fähigkeit.** Antigravity implementiert Codec und Katalog, Claude Code die Bedienung; Codex bestätigt gemeinsame Verträge und prüft die Ergebnisse.

Die verbindlichen Anforderungen stammen aus [Vision und Rollen](../AGENTS.md), [S1 v2](contracts.md), [Domänentypen](../src/domain/types.ts), [Architektur](architecture.md) und [UI-Research](design-research.md). Insbesondere müssen IDs, Geometrie, Reihenfolge, zugängliche Beschriftungen, Ressourcen und Metadaten erhalten bleiben. Ein ungültiger oder überholter Codeentwurf darf das gültige Dokument nicht überschreiben. Die nachfolgenden Syntax-, Katalog- und Grenzwertentscheidungen sind für den begrenzten Auftrag vereinbart; vorhandene S1-TypeScript-Typen werden durch dieses Dokument nicht verändert. Antigravity meldet konkrete Implementierungsbedenken vor abweichendem Verhalten.

## 1. Format und öffentliche API

Das native Format heißt **Sketchdraw Script v1**, Dateiendung `.sketchdraw.txt`. Es verwendet lesbare Deklarationen mit strikten JSON-Eigenschaften. Es ist von der Lesbarkeit einfacher Diagrammsprachen inspiriert, aber **keine Mermaid-Syntax und kein Mermaid-Import**. Es gibt weder automatische Neuanordnung noch implizite neue IDs. Jede gültige Szene bleibt im Canvas bearbeitbar.

Die bereits vereinbarten Exporte bleiben bestehen:

```ts
// src/codec/index.ts
export function parseDiagram(source: string, contextDocument?: SketchDocument): ParseResult;
export function formatDiagram(document: SketchDocument): string;
```

- `parseDiagram` ist rein: keine Dateizugriffe, Netzwerkzugriffe, Registrierung von Sets, Controller-Änderungen oder Mutation des Kontexts. Fehlerhafte Eingaben liefern `ok: false`; erwartbare Eingabefehler werfen nicht. Ein Erfolg enthält ein vollständig domänenvalidiertes, vom Kontext abgetrenntes Dokument.
- `formatDiagram` validiert sein Dokument und wirft bei ungültigen JS-Eingaben `DomainValidationError`. Es schreibt immer ein **vollständiges, eigenständig lesbares Dokument** einschließlich eingebetteter Assets und vollständiger Sets. Kontextreferenzen sind eine ausdrücklich gewählte Schreibweise beim Bearbeiten, kein versteckter Standardexport.
- Verlustfrei bedeutet Gleichheit der persistenten Dokumentsemantik nach kanonischer Domänenserialisierung. Kommentare, Einrückungen, die ursprüngliche Schreibweise von Zahlen und optionale Abkürzungen werden beim Formatieren nicht erhalten. Arrays, optionale Felder und alle gültigen persistenten Werte werden erhalten.
- Es gilt `serializeDocument(parseDiagram(formatDiagram(doc)).document) === serializeDocument(doc)` für jedes aktuell domänenvalide Schema-1-Dokument. Außerdem ist erneutes Formatieren bytegleich. Der Codec darf keine zusätzlichen Provider-, Widget-, Unicode- oder Iconregeln als stillschweigende Schemaänderung einführen. Engere Regeln für neu importierte Katalogdaten gelten ausschließlich an diesem ausdrücklich gewählten Eingang; eine allgemeine Verschärfung des Dokumentmodells braucht eine eigene Versions-/Migrationsentscheidung.

## 2. Zeilengrammatik

Eine Deklaration steht auf genau einer physischen Zeile. Zeilenumbrüche in Texten oder SVG werden als JSON-Escape `\n` geschrieben. Leere Zeilen und vollständige Kommentarzeilen mit `#` sind erlaubt. Inline-Kommentare, mehrzeilige JSON-Blöcke, JSON5, Kommas zwischen Deklarationen und Semikolons sind nicht erlaubt.

```text
script        = header, document, { declaration | blank | comment } ;
header        = "sketchdraw 1" ;
document      = "document", WS, json-object ;
declaration   = element | asset | component-set | asset-ref | set-ref | drop ;
element       = kind, WS, json-string-id, WS, json-object ;
kind          = "rectangle" | "ellipse" | "diamond" | "text" | "path"
              | "image" | "connector" | "container" | "component" ;
asset         = "asset", WS, json-string-id, WS, json-object ;
component-set = "set", WS, json-string-id, WS, json-object ;
asset-ref     = "asset-ref", WS, json-string-id ;
set-ref       = "set-ref", WS, json-string-id, WS, json-object ;
drop          = "drop", WS, ("asset" | "set"), WS, json-string-id ;
```

Diese Darstellung ist eine Grammatikskizze; `WS` sind ein oder mehrere Leerzeichen oder Tabs, IDs sind normale JSON-Strings. Führende und nachgestellte horizontale Leerzeichen sind erlaubt. Header und Dokumentdeklaration sind die ersten beiden **nicht leeren und nicht kommentierten** Zeilen und jeweils genau einmal vorhanden. Weitere Deklarationen dürfen Ressourcen vor oder nach ihrer Verwendung nennen; die Referenzprüfung erfolgt nach vollständigem Lesen. CRLF wird akzeptiert, Ausgabe ist LF. Ein einzelnes UTF-8-BOM am Anfang wird akzeptiert und nicht ausgegeben.

### Abbildung auf das Dokument

| Deklaration | Abbildung und Einschränkung |
| --- | --- |
| `sketchdraw 1` | Formatversion 1 und `schemaVersion: 1`; andere Versionen sind Fehler, keine automatische Migration. |
| `document {...}` | Felder `id`, `title`, `metadata`. `title` ist erforderlich, fehlende `metadata` bedeutet `{}`. `id` ist ohne Kontext erforderlich; bei ausgelassener ID wird ausdrücklich die Kontext-ID verwendet. Eine angegebene ID muss bei vorhandenem Kontext übereinstimmen. `schemaVersion`, `elements`, `assets` und `componentSets` sind hier nicht erlaubt. |
| `<kind> "id" {...}` | Ein Element. Die äußeren Werte liefern `kind` und `id`; diese Schlüssel sind im JSON-Objekt verboten. Alle übrigen `SketchElement`-Felder sind darstellbar. Die Reihenfolge der Elementdeklarationen ist die vollständige Z-Reihenfolge von hinten nach vorn. |
| `asset "id" {...}` | Ein `SketchAsset` unter demselben Record-Schlüssel; das JSON enthält `mimeType`, `dataUrl`, `name`, aber kein zweites `id`. |
| `set "id" {...}` | Ein `ComponentSet`; JSON enthält `name`, `version`, `components`, aber kein zweites `id`. Die Reihenfolge von `set`/`set-ref` ist die vollständige Set-Reihenfolge. Reihenfolge der Komponenten, Aliase, Widgets und Optionen bleibt erhalten. |
| `asset-ref "id"` | Kopiert exakt dieses Asset aus dem Kontext. Ohne Kontext oder bei fehlender ID ein Fehler. Es wird nichts nachgeladen. |
| `set-ref "id" {"version":"1.0.0"}` | Kopiert exakt das Kontext-Set mit dieser ID und Version. Einziger erlaubter JSON-Schlüssel ist `version`; fehlende oder abweichende Version ist ein Fehler. |
| `drop asset "id"` / `drop set "id"` | Bestätigt die Entfernung einer vorhandenen Kontextressource. Ohne passende Kontextressource ein Fehler. Der Marker wird nicht persistiert. Weiterbestehende Referenzen machen das Gesamtdokument ungültig. |

IDs sind innerhalb der jeweiligen Domänen-Namespaces eindeutig. Zwei Elementdeklarationen mit derselben ID oder mehrere Deklarationen derselben Ressource — auch `asset` zusammen mit `asset-ref` oder `drop` — sind Fehler. Element-, Asset- und Set-IDs dürfen untereinander gleich heißen, sofern der bestehende Domänenvertrag diese getrennten Namespaces zulässt. Der Codec erfindet kein zusätzliches globales ID-Verbot.

### Kleine, versionierte Abkürzungen

`x`, `y`, `width` und `height` sind bei jedem Element erforderlich. Es gibt kein stilles Layout. Fehlende `rotation` bedeutet `0`. Eine fehlende oder partielle `style` wird ausschließlich um fehlende **Pflichtfelder** ergänzt:

```json
{"stroke":"#1f2937","fill":"transparent","strokeWidth":2,"opacity":1,"fontSize":16,"textAlign":"left","strokeDash":"solid"}
```

Dies ist der vorgeschlagene feste Default von Script v1, unabhängig von UI-Voreinstellungen oder einer später veränderten Element-Factory. Ein fehlendes optionales `fontFamily` wird nicht als neues Feld eingefügt; die Domäne interpretiert es wie vereinbart als `sans`. Alle anderen optionalen Felder bleiben bei Weglassen abwesend. `null` ist in vollständigen Dokumentdeklarationen **keine Patch-Operation** und nur zulässig, falls der persistente Feldtyp es ausdrücklich erlaubt; die gegenwärtigen optionalen Elementfelder erlauben es nicht. Der Formatter schreibt vollständige Pflichtfelder und deshalb keine von UI-Einstellungen abhängigen Abkürzungen.

### Ressourcen und ausdrückliches Löschen

Bei vorhandenem Kontext muss **jede** dort enthaltene Asset- und Set-ID im Script entweder vollständig deklariert, ausdrücklich referenziert oder ausdrücklich mit `drop` entfernt werden. Bloßes Weglassen liefert `RESOURCE_OMITTED`, auch bei derzeit ungenutzten Assets. Neue Ressourcen dürfen ergänzt werden. Dadurch verursacht ein verkürzter Entwurf keinen unbemerkten Ressourcenverlust und eine normale Elementlöschung keine automatische Assetbereinigung.

Ein identischer ID-Verweis mit geändertem Assetinhalt ist über eine vollständige `asset`-Deklaration eine ausdrückliche Ressourcenänderung. Vollständige Set-Deklarationen sind ebenfalls ausdrückliche Änderungen; der Codec erhält die aktuellen Domänenregeln, während der unten beschriebene Katalogimport zusätzlich vor ungewolltem Überschreiben schützt. Der Parser erzeugt einen vollständigen Kandidaten; seine Anwendung als `replace` ist eine normale validierte Controller-Transaktion mit Undo. Es gibt keine Löschung externer Dateien oder eine Bereinigung anderer History-Stände.

Ohne Kontext ist das Script eine vollständige neue Momentaufnahme: nur deklarierte Ressourcen existieren. `asset-ref`, `set-ref` und `drop` verlangen Kontext und sind deshalb hier Fehler. Ein Kontext ist kein Registry-Fallback: eine im Script verwendete, aber nicht deklarierte Ressource wird nicht automatisch übernommen. Auch eingebaute Komponenten müssen durch ein `set` oder `set-ref` ausdrücklich verfügbar sein.

## 3. Determinismus, Diagnostik und Grenzen

Der Formatter schreibt Header, Dokument, Assets nach ID sortiert, Sets in persistierter Arrayreihenfolge und schließlich Elemente in Z-Reihenfolge. Zwischen diesen Gruppen steht genau eine Leerzeile; nach dem letzten Inhalt folgt genau ein LF. JSON-Tails sind kompakt auf einer Zeile, ihre Objektschlüssel rekursiv sortiert; Arrayreihenfolge und Stringwerte bleiben erhalten. Die Domänenserialisierung mit zwei Leerzeichen bleibt unverändert — Script ist ein anderes Format. Zahlen folgen derselben verlustfreien JavaScript-JSON-Darstellung; `-0` wird `0`, keine geometrische Rundung. Kommentare werden nicht erzeugt.

Der Parser erhält beim Lesen eine Zuordnung von JSON-Pfaden zu Quellbereichen. `ParseDiagnostic.line/column` sind einsbasiert; Spalten und optionale Endspalten zählen UTF-16-Codeeinheiten, Endpositionen sind exklusiv. Das passt zu JavaScript-Editoroffsets und muss mit Emoji vor einer Fehlerstelle getestet werden. Semantische Fehler zeigen möglichst auf das betroffene JSON-Feld, sonst auf die zugehörige Deklaration; fehlende globale Pflichtangaben zeigen auf das Header-/Dokumentende. Kontextfehler werden an der Referenz oder bei ausgelassenen Ressourcen an der Dokumentdeklaration angezeigt. `issuePath` verwendet den Domänenpfad, `elementId` nur bei Elementbezug.

Vorgeschlagene stabile Codes: `FORMAT_VERSION`, `EXPECTED_HEADER`, `EXPECTED_DOCUMENT`, `UNKNOWN_DECLARATION`, `JSON_SYNTAX`, `DUPLICATE_JSON_KEY`, `DUPLICATE_DECLARATION`, `UNKNOWN_FIELD`, `CONTEXT_REQUIRED`, `CONTEXT_ID_MISMATCH`, `RESOURCE_MISSING`, `RESOURCE_OMITTED`, `RESOURCE_VERSION_CONFLICT`, `LIMIT_EXCEEDED` und die spezifischen Domänenvalidierungscodes. Keine maschinenabhängigen Rohmeldungen eines JSON-Parsers als einziges Fehlerformat. Ein fehlgeschlagener Parse liefert nie ein teilweise gültiges Dokument.

Erforderliche Schutzmaßnahmen:

- Vor Zerlegung maximal **32 MiB UTF-8** für das vollständige Script prüfen; auch das erzeugte kanonische Dokument unterliegt der bestehenden 32-MiB-Grenze. Kein Umgehen durch Referenzen auf große Kontextressourcen. `formatDiagram` weist einen übergroßen Script-Output ausdrücklich zurück.
- Vorgeschlagen zusätzlich JSON-Verschachtelungstiefe 64 und 100 ausgegebene Diagnosen; die feste Schema-1-Struktur liegt darunter. Kein zusätzlicher Zeilenzahlgrenzwert darf den Roundtrip eines gültigen Dokuments mit vielen Ressourcen ausschließen. Nach der Fehlerobergrenze erscheint ein abschließender Hinweis, dass weitere Fehler existieren können. S1-Limits für Elemente, Text, Punkte, Assets und Container gelten unverändert. Die Grenzen sind Sicherheitsgrenzen, keine Leistungszusage.
- Die JSON-Erkennung muss doppelte Objektschlüssel **vor** einem überschreibenden `JSON.parse` erkennen und Quellbereiche erfassen. Ein begrenzter JSON-Tokenizer mit anschließendem Parser ist ausreichend; `eval`, `Function`, dynamische Imports und ausführbare Ausdrücke sind verboten. Ein einfaches Regex-Aufteilen kompletter JSON-Tails ist nicht ausreichend.
- Verbotene Schlüssel `__proto__`, `constructor`, `prototype` auf jeder Objektebene, unbekannte Schemafelder, nichtendliche Zahlen sowie ungültige Referenzen werden entsprechend der bestehenden Domäne abgewiesen. Records mit sicheren eigenen Schlüsseln aufbauen; keine unkontrollierte Objektzusammenführung. Vorhandene zulässige Strings bleiben vollständig erhalten, einschließlich einzeln vorkommender UTF-16-Surrogate, die der Formatter als JSON-Escape schreibt; keine neue Unicode-Normalisierung oder Ablehnung.
- Assets bleiben eingebettete und geprüfte PNG-/JPEG-/WebP-Daten; keine impliziten URL-Abrufe. Links folgen der vorhandenen Domänenvalidierung. Texte und Metadaten bleiben Text, keine HTML-Inhalte. Eingebettete Set-Icons werden verlustfrei gespeichert und erhalten vor Darstellung eine getrennte Prüfung in eine sichere Baumdarstellung; die Darstellungsgrenze ist kein stiller Datenfilter des Codecs.
- Keine DOM-/Canvas-/Node-Abhängigkeit im Codec. Eine Worker-Ausführung im Renderer ist optional; sie ändert keine API oder Fehlersemantik. Vor Weitergabe an Controller wird der vollständige Kandidat domänenvalidiert.

`CodeDraft.baseRevision` wird **nicht** durch den Parser geprüft: Der Renderer bewahrt Entwurf, Parse-Ergebnis und Basisrevision auf und übergibt bei Anwendung `expectedRevision: baseRevision` sowie `source: 'code'`. Ein Revisionskonflikt behält den Entwurf und den aktuellen Canvas. Auch ein erfolgreicher Parse erlaubt kein stilles Rebase. Im Kontextmodus muss der Renderer zum Parsen denselben Dokument-Snapshot verwenden, auf dem der Entwurf basiert, nicht unbemerkt den neuesten Stand.

## 4. Katalog-API als vorgeschlagene Ergänzung

Die folgenden Typen/Exporte sind **neu vorgeschlagen** und werden erst nach Abstimmung implementiert. Vorhandene `ComponentSet`, `ComponentDefinition`, `SketchElement` und `DocumentCommand` bleiben die persistente Grundlage.

```ts
// src/catalog/index.ts
export const builtInComponentSets: ComponentSet[];
export function validateComponentSet(input: unknown): ComponentSet;
export function parseComponentSet(source: string): ComponentSet;

export interface InstantiateComponentRequest {
  set: ComponentSet;
  type: string;
  id: string;
  at: Point; // absolute top-left document coordinates
  parentId?: string;
  label?: string;
  metadata?: Record<string, string>;
}

export interface ComponentInstantiation {
  element: SketchElement;
  command: DocumentCommand;
}

export function instantiateComponent(
  document: SketchDocument,
  request: InstantiateComponentRequest,
): ComponentInstantiation;

export function prepareComponentSetImport(
  document: SketchDocument,
  set: ComponentSet,
): DocumentCommand | null;
```

Alle Funktionen sind rein. Fehler sind `DomainValidationError` mit Pfad und stabilem Code. Ergebnisse sind abgetrennte Werte; eine Mutation eines Resultats verändert weder den Eingang noch den eingebauten Katalog. `builtInComponentSets` wird zur Laufzeit tief eingefroren, auch wenn aus Kompatibilitätsgründen zunächst der vereinbarte Array-Typ exportiert wird. Kein Verbraucher darf es mutieren.

### Instanziierung und Import

1. `instantiateComponent` validiert Dokument, Set, gewählten Typ, freie Element-ID, Position und optionalen Container. `type` muss genau einer Definition des angegebenen Sets entsprechen; Namen und Aliase sind Suchhilfen, keine IDs. Die IDs erzeugt der Aufrufer, damit Tests und Agentenaufrufe deterministisch bleiben.
2. Das neue Element hat `kind: 'component'`, `componentType: request.type`, `x/y: at`, die Defaultgröße der Definition und Rotation 0. `text` ist der Komponentenname; `label` ist die ausdrückliche Anforderung oder ebenfalls der Name. Es übernimmt erlaubte Dokumentations-URL und Definition-Metadaten, danach zulässige Request-Metadaten. Der komplette Stil entsteht aus den oben explizit festgelegten v1-Pflichtdefaults und dem partiellen Definitionsstil. Optionaler `parentId` wird ohne Geometrieumrechnung gesetzt; er muss auf einen Container zeigen. Keine automatisch erzeugten Kinder, externen Ressourcen oder Netzwerkanfragen.
3. Fehlt das Set im Dokument, lautet `command` ein Batch aus `set-component-sets` mit bisherigen Sets plus dem neuen Set, dann `add` mit genau diesem Element. Dieser Batch ist eine Undo-Einheit. Ist ein identisches Set vorhanden, genügt `add`. Das Ergebnis wird vor Rückgabe auf dem Eingangsdokument mit der Domäne validiert; der Aufrufer dispatcht es mit seiner erwarteten Revision. Das separat zurückgegebene `element` entspricht genau dem Commandinhalt.
4. `prepareComponentSetImport` erzeugt `set-component-sets` mit einem am Ende ergänzten validierten Set, bei bereits identischem Set `null`. Es ändert den Controller nicht. `parseComponentSet` akzeptiert ausschließlich ein JSON-Objekt für ein vollständiges `ComponentSet`, maximal 2 MiB UTF-8, mit demselben Schutz vor doppelten/verbotenen Schlüsseln und unbekannten Feldern.
5. Identität beim **Katalogimport/Instanziieren** ist Set-ID plus exakte Version und Inhalt. Gleiche ID/Version mit anderem Inhalt ist `SET_CONTENT_CONFLICT`; gleiche ID mit anderer Version ist beim Import/Instanziieren `SET_VERSION_CONFLICT`, auch wenn der Name gleich ist. Keine automatische Aktualisierung verwendeter Definitionen. Eine spätere ausdrückliche Migration braucht ein separat beschriebenes, atomar validiertes Verfahren. Für S2 kann der Nutzer ein anderes Set unter neuer ID und neuen Typnamen importieren. Eine vollständige Set-Deklaration im Codeeditor wird dagegen als ausdrückliche Dokumentänderung nach den vorhandenen Domänenregeln behandelt; der Codec erzwingt keine nachträgliche Versionspflicht für bereits gültige Dokumente.
6. Komponententypen sind im gesamten Dokument eindeutig, unabhängig von Set-ID. Eine Kollision zwischen zwei Sets ist `COMPONENT_TYPE_COLLISION`, kein „letztes Set gewinnt“. Ein Set darf auch ohne Instanzen im Dokument bestehen. Entfernen eines verwendeten Sets ist ein Validierungsfehler.

### Identität, Umfang und Widgets

Die folgenden Regeln betreffen **neue Katalogimporte und Instanziierungen**, nicht die allgemeine Validität eines vorhandenen Dokuments oder dessen Code-Roundtrip. Set-ID und Typ verwenden die bestehenden ASCII-ID-Zeichen und maximal 128 Zeichen. Ein Typ beginnt mit dem Provider plus Punkt: `aws.`, `azure.`, `gcp.`, `generic.` oder `custom.`; eigene Typen verwenden zusätzlich einen stabilen Organisations-/Set-Namespace, z. B. `custom.acme.queue`. Version ist ein nichtleerer, maximal 64 Zeichen langer opaker Bezeichner ohne Steuerzeichen; es gibt keinen Semver-Vergleich und kein „latest“. Startsets verwenden zur Verständlichkeit `1.0.0`.

Vorgeschlagene zusätzliche Grenzen: maximal 128 Sets je Dokument, 2.000 Definitionen insgesamt, 200 Aliase pro Definition, 32 Widgets je Definition, 100 Optionen je Select-Widget. Strings unterliegen den bestehenden Textlimits und dem Dokumentgesamtlimit. Widgets haben innerhalb ihrer Definition eindeutige Schlüssel nach `[A-Za-z][A-Za-z0-9_-]{0,63}`, eine nichtleere Beschriftung und genau einen bekannten `kind`. `select` verlangt eine nichtleere Liste eindeutiger Optionen; andere Widgetarten verbieten `options`.

Widgetwerte liegen in `SketchElement.metadata`, ohne neues persistentes Schema:

```text
widget:<componentType>:<widgetKey>
widget:aws.compute.instance:region
widget:custom.acme.queue:capacity
```

Ein Widgetwert ist immer ein String. `text` erlaubt normalen Text, `number` eine kanonische endliche JSON-Zahl als String (`String(Number(value)) === value`, `-0` deshalb nicht kanonisch), `select` exakt eine deklarierte Option. Fehlende Werte sind zulässig; es gibt keine impliziten Pflichtfelder oder versteckten Widgetdefaults. Die UI schreibt Zahlen erst nach erfolgreicher Prüfung und behält ungültige Eingaben als lokalen Entwurf.

Der neue Katalog-/Widget-Editor nutzt den Präfix `widget:` für eigene Werte. Beim neuen Instanziieren und beim Editieren eines bekannten Widgets werden dessen Namespace und Wert geprüft. **Bestehende beliebige Metadatenschlüssel/-strings bleiben jedoch gültig und verlustfrei**, auch wenn sie zufällig diesen Präfix verwenden oder nicht mehr zu einer Definition passen. Die UI zeigt solche Werte als freie Metadaten bzw. meldet eine Widgetzuordnung, ohne sie zu löschen. Eine Definitionsänderung darf bestehende Widgetwerte nicht still verwerfen oder umdeuten. Der Codec normalisiert keine Metadatenstrings zu Zahlen und erzwingt keine nachträgliche Namespace-Reservierung im allgemeinen Schema 1.

### Sicherer Iconvertrag

`iconSvg` ist ein optionales dekoratives Symbol; zugänglicher Name und Beschreibung kommen aus den normalen Textfeldern. Vorgeschlagen wird für S2 eine bewusst kleine, vollständig prüfbare SVG-Teilmenge: `svg`, `g`, `path`, `rect`, `circle`, `ellipse`, `line`, `polyline`, `polygon`. Maximal 64 KiB UTF-8, 256 Elemente, Tiefe 16 und 10.000 numerische Pfad-/Punktwerte pro Symbol. Der Wurzelknoten hat einen `viewBox` aus vier endlichen Zahlen mit positiver Breite/Höhe; Koordinatenbeträge und Dimensionen bleiben jeweils höchstens 1.000.000. Verschachtelte `svg`-Elemente sind nicht erlaubt.

Erlaubte Attribute werden pro Tag positiv aufgezählt: notwendige Geometrie, `viewBox`, `fill`, `stroke`, `stroke-width`, `opacity`, `fill-rule`, `stroke-linecap`, `stroke-linejoin` sowie am Wurzelelement `xmlns` mit dem Standard-SVG-Namespace. Farben sind `none`, `currentColor` oder Hexfarben; `url(...)` ist ausgeschlossen. Geometrie- und Pfadwerte werden mit begrenztem Parser geprüft. Für v1 keine Transforms, CSS, IDs oder Referenzen. Weitere SVG-Funktionen werden erst mit einer erweiterten positiven Policy zugelassen.

Konkret sind Geometrieattribute `path: d`, `rect: x/y/width/height/rx/ry`, `circle: cx/cy/r`, `ellipse: cx/cy/rx/ry`, `line: x1/y1/x2/y2`, `polyline/polygon: points`; `g` hat keine Geometrieattribute. `svg` erhält ausschließlich `viewBox`, optional `xmlns` und die erlaubten Präsentationsattribute. Dimensionen/Radien sind nicht negativ, `opacity` liegt bei 0–1, `stroke-width` bei 0–1.000. `fill-rule` ist `nonzero|evenodd`, `stroke-linecap` ist `butt|round|square`, `stroke-linejoin` ist `miter|round|bevel`. Hexfarben haben 3, 4, 6 oder 8 Hexziffern. Pfade unterstützen zunächst nur `M/L/H/V/C/Q/Z` und ihre relativen Kleinbuchstabenvarianten, mit SVG-konformer Argumentanzahl; unbekannte Befehle sind Fehler. Normale numerische SVG-Werte einschließlich Exponenten sind zulässig, Einheiten und Prozentwerte nicht. Die Regel ist absichtlich enger als allgemeines SVG.

DOCTYPE/Entities, Processing Instructions, unbekannte Namespace-Präfixe, Script, `foreignObject`, Eventhandler, `style`, `href`/`xlink:href`, Bilder, Animation, Filter, externe Referenzen und Fonts sind Fehler. Ein XML-Parser darf keine DTD oder externen Entitäten auflösen. Keine Regex-Sanitization als Sicherheitsgrenze. Zulässige XML-Zeichenreferenzen sind nur die fünf eingebauten Entities und gültige numerische Zeichenreferenzen; sie dürfen keine verbotenen Attributwerte einschleusen. SVG-Text und -Geometrie werden nicht durch ausführbare Ausdrücke ausgewertet.

Die Iconprüfung erzeugt entweder eine separat validierte, begrenzte Baumdarstellung oder einen erklärten Fehler; sie verändert den gespeicherten String nicht. Der Renderer erstellt nur aus dieser Baumdarstellung eigene SVG-Knoten; kein ungeprüftes `v-html` oder Dokument-Markup. Ein fehlendes oder von dieser Darstellungsmenge nicht unterstütztes vorhandenes Icon erhält ein eigenes generisches Symbol. Sein ursprünglicher `iconSvg`-String bleibt im Dokument und im Codec erhalten, soweit er nach der bestehenden Domäne gültig ist. Beim ausdrücklich neuen Katalogimport darf ein ungeeignetes Icon den Import mit konkreter Meldung ablehnen; es wird nicht kommentarlos entfernt. DOM-freie Prüfung muss ebenso in Node/Agentenadaptern verfügbar sein. Eine allgemeine Verschärfung des persistenten Schemas ist damit nicht beschlossen.

### Kleiner, ehrlich bezeichneter Startkatalog

Vorgeschlagene Sets: `sketchdraw.generic`, `sketchdraw.aws`, `sketchdraw.azure`, `sketchdraw.gcp`, jeweils `1.0.0`. Alle Symbole sind eigene einfache Darstellungen mit dokumentierter Projektprovenienz; keine Behauptung offizieller Hersteller-Icons oder vollständiger Serviceabdeckung.

| Provider | Begrenzte Beispieltypen | Suchaliase als Beispiele |
| --- | --- | --- |
| generic | `generic.service`, `generic.database`, `generic.queue`, `generic.user`, `generic.network` | API, Datenbank, Warteschlange, Nutzer, Netzwerk |
| aws | `aws.compute.instance`, `aws.storage.object`, `aws.database.relational` | Compute, EC2, S3, RDS |
| azure | `azure.compute.vm`, `azure.storage.blob`, `azure.database.sql` | Virtual Machine, Blob, SQL |
| gcp | `gcp.compute.instance`, `gcp.storage.object`, `gcp.database.sql` | Compute Engine, Cloud Storage, Cloud SQL |

Herstellerbezüge benennen Beispielrollen im Diagramm; die Kataloganzeige nennt den Provider und den begrenzten Umfang. Dokumentationslinks werden erst nach Quellenprüfung ergänzt. Suchtreffer müssen Name, Provider, Kategorie und Aliase berücksichtigen; eine leere Suche zeigt alle vorhandenen Komponenten, ein Nulltreffer bietet eine erklärende Anzeige und Rücksetzen. Suche ändert das Dokument nicht. Die konkrete Such-/Filter-UI entscheidet Claude Code innerhalb dieser Semantik.

## 5. Beispielskripte

Diese Beispiele sind Soll-Fixtures, **noch keine bestandenen Parsertests**. Sie nutzen die oben festgelegten Defaults. Nach Formatierung werden die ergänzten Pflichtfelder ausdrücklich sichtbar.

### Zwei Elemente und eine gebundene Verbindung

```text
sketchdraw 1
document {"id":"demo.architecture","title":"Web und API","metadata":{"owner":"Team"}}

rectangle "web" {"x":40,"y":80,"width":140,"height":70,"text":"Web","label":"Web-Anwendung"}
rectangle "api" {"x":320,"y":80,"width":140,"height":70,"text":"API","description":"Bearbeitet Anfragen"}
connector "request" {"x":180,"y":115,"width":140,"height":0,"points":[{"x":0,"y":0},{"x":140,"y":0}],"from":{"elementId":"web","anchor":{"x":1,"y":0.5}},"to":{"elementId":"api","anchor":{"x":0,"y":0.5}},"text":"HTTPS"}
```

### Eigenes Set, Widget und persistente Stiländerung

```text
sketchdraw 1
document {"id":"demo.queue","title":"Arbeitswarteschlange"}

set "acme.core" {"name":"Acme-Komponenten","version":"1.0.0","components":[{"type":"custom.acme.queue","name":"Queue","provider":"custom","category":"Messaging","aliases":["Warteschlange"],"defaultWidth":160,"defaultHeight":80,"style":{"fill":"#e0f2fe"},"widgets":[{"key":"capacity","label":"Kapazität","kind":"number"}]}]}

component "jobs" {"x":80,"y":80,"width":160,"height":80,"componentType":"custom.acme.queue","text":"Jobs","label":"Job-Warteschlange","style":{"fill":"#e0f2fe","strokeDash":"dashed"},"metadata":{"widget:custom.acme.queue:capacity":"100","team":"Platform"}}
```

### Kurzer Entwurf mit ausdrücklich übernommenen Ressourcen

Dieser Entwurf benötigt einen Snapshot von `demo.assets`, der das gültige Asset `logo` und das Set `sketchdraw.generic` in Version `1.0.0` enthält. Weitere Kontextressourcen müssten ebenfalls deklariert werden.

```text
sketchdraw 1
document {"title":"Lokale Ressourcen"}
asset-ref "logo"
set-ref "sketchdraw.generic" {"version":"1.0.0"}

image "brand" {"x":40,"y":40,"width":120,"height":80,"assetId":"logo","label":"Projektlogo"}
component "service" {"x":240,"y":40,"width":160,"height":80,"componentType":"generic.service","text":"Dienst"}
```

### Ausdrückliche Ressourcenentfernung

Mit demselben Kontext entfernt dieser Entwurf die Ressourcen und ersetzt die bisherige Elementliste durch ein Textelement. Es darf kein verbleibendes Bild oder Component-Element die entfernten Ressourcen referenzieren.

```text
sketchdraw 1
document {"id":"demo.assets","title":"Bereinigte Skizze","metadata":{}}
drop asset "logo"
drop set "sketchdraw.generic"
text "note" {"x":40,"y":40,"width":260,"height":60,"text":"Ressourcen ausdrücklich entfernt."}
```

## 6. Abnahme und offene Abstimmung

Die folgenden Fälle sind von Codex unabhängig zu prüfen; sie sind keine bereits ausgeführten Tests.

| ID | Fall | Erwartung |
| --- | --- | --- |
| S2-C01 | Alle neun Elementarten, vollständige und optionale Stile, label/description, Container, rotierte Ziele, Connector-Anker, Assetbytes, freie Metadaten, Sets/Widgets/Aliase/Icons | Standalone-Format/Parse erhält die kanonische Domänenserialisierung exakt; Element-, Set- und Widgetreihenfolge bleibt bestehen. |
| S2-C02 | Dezimalzahlen mit hoher Präzision, `-0`, Unicode, Quotes, Backslashes und Text mit Zeilenumbrüchen | Keine Geometrie-Rundung; Strings unverändert; wiederholtes Formatieren bytegleich. |
| S2-C03 | Kommentare, CRLF, BOM, Defaultstil und nachgelagerte Ressourcendeklarationen | Gültig nach definierter Grammatik; kanonischer Output ist LF und ohne Kommentare/BOM. |
| S2-C04 | Unbekannte Version/Felder, doppelte IDs/JSON-Schlüssel, ungültige Referenzen und Zyklen | Strukturierte Fehler an nachprüfbarer Zeile/UTF-16-Spalte; kein Teilmodell und keine Kontextmutation. |
| S2-C05 | Asset-/Set-Referenz ohne Kontext, falsche Setversion, falsche Dokument-ID | Expliziter Kontext-/Versionsfehler, kein Download und kein Fallback auf Built-ins. |
| S2-C06 | Kontextasset/-set weglassen, ausdrücklich entfernen, beim Entfernen weiter referenzieren | Weglassen scheitert; gültiges `drop` funktioniert; verbleibende Referenz scheitert. Formatierter neuer Snapshot braucht danach keine Tombstones. |
| S2-C07 | Größen-/Tiefengrenzen, extrem viele Fehler, verbotene Schlüssel und bösartiges SVG | Begrenzte Verarbeitung, eindeutige Eingabefehler nach geltender Domäne, keine Ausführung oder Netzwerkanfrage. Nicht unterstützte vorhandene Icons bleiben als Daten erhalten und werden über ein generisches Symbol dargestellt. Grenzen auch für durch Kontext vergrößerte Dokumente prüfen. |
| S2-C08 | Komponente aus fehlendem Set instanziieren, danach erneut aus demselben Set | Erstes Command enthält Setübernahme plus Element; zweites keine Setduplikate; jeweils eine Undo-Einheit. Eingänge/Katalog bleiben unverändert. |
| S2-C09 | Gleiche Set-ID/Version mit anderem Inhalt, andere Version, doppelte Typen, unbekannter Typ/Container, doppelte Element-ID | Eindeutige Konflikte, keine teilweise Katalog- oder Dokumentänderung. |
| S2-C10 | Text-/Number-/Select-Widgets, Fremdnamespace, ungültige Zahlen und unbekannte Optionen | Widgeteditor/Neuanlage prüfen neue Werte. Vorhandene beliebige Metadatenstrings bleiben im Codec erhalten; keine stillschweigende Umwandlung, Ablehnung des ganzen Dokuments oder Entfernung. |
| S2-C11 | Canvas ändern → Code öffnen/ändern/anwenden → erneut Canvas bearbeiten | Kein Neulayout; IDs, zugängliche Eigenschaften, Ressourcen und Stiländerungen bleiben editierbar. |
| S2-C12 | Codeentwurf erstellen → Agent/Peer verändert aktuelle Revision → alten Entwurf anwenden | Revisionskonflikt; beide Stände zugänglich, Canvas unverändert, Entwurf erhalten. Kontextreferenzen basieren weiterhin auf dem alten Snapshot. |
| S2-C13 | Panel schließen/öffnen, Fehler korrigieren, Native Undo im Textfeld, Tastatur-/Pointer-Katalogeinfügen, Nulltreffer | Kein Entwurfsverlust, zugängliche Fehlernavigation, kein versehentliches Dokument-Undo beim Tippen, Einfügen ohne Drag möglich. |
| S2-C14 | Aktuell gültige Bestandsdokumente mit nicht namespaced Komponententypen, beliebigen `widget:`-Metadaten, einzelnen UTF-16-Surrogaten und Icons außerhalb der neuen Darstellungsmenge | Standalone-Format/Parse bleibt semantisch verlustfrei. Keine neue Domainrestriktion; unsicher darstellbare Icons werden ausschließlich visuell ersetzt. |

Vor Implementierungsstart zu bestätigen: (1) die exakten Script-v1-Defaults, (2) die engere Policy allein für neue Katalogimporte/Instanziierungen sowie die separate sichere Icon-Baumdarstellung mit Fallback, (3) die ausdrücklichen `drop`-Regeln bei Kontextressourcen. Offene Architekturfrage für später: Soll eine neue Schemaversion allgemein strengere Provider-/Widget-/Iconregeln erhalten, und wie würden vorhandene Dokumente migriert? **Für S2 wird keine solche Schemaänderung vorausgesetzt.** Dies sind routinemäßige Architekturentscheidungen von Codex mit Rückmeldung der Implementierenden; daraus entsteht keine neue Nutzerfreigabe. Eine breitere Mermaid-Syntax, automatisch migrierte Katalogversionen und größere offizielle Cloud-Iconbibliotheken sind keine zugesagten S2-Eigenschaften.

## Prüfung dieses Entwurfs

Erstellt aus den oben verknüpften lokalen Verträgen und Research-Ergebnissen. Graphify wurde vor der gezielten Quellprüfung abgefragt; sein Index enthielt noch Vertragsüberschriften des älteren v1-Stands, deshalb wurde der tatsächliche S1-v2-Text als maßgeblich gelesen. Tatsächlich bestanden: fünf lokale Dokumentverweise vorhanden, vier Beispielskripte mit insgesamt 13 syntaktisch gültigen JSON-Tails, keine nachgestellten Leerzeichen. Dies war eine statische Python-Prüfung des Dokuments, kein Nachweis eines implementierten Codecs. Produkt-, Codec-, Katalog- und UI-Tests sind bis zur Implementierung nicht ausgeführt. Root pflegt GitHub, Ledger und Graphprojektion nach Übernahme dieses Entwurfs.

## Freigabe für Codec/Katalog durch Codex

Die versionierten Scriptdefaults, ausdrücklichen Ressourcenreferenzen/-löschungen und Instanziierungsverträge sind angenommen. Keine nachträgliche Verschärfung der gültigen Schema1-Bestandsdaten durch den Codec. Neue Katalogimporte dürfen engere Regeln erhalten; die UI muss unverarbeitbare dekorative Icons durch ein generisches Symbol ersetzen. Dafür wird eine DOM-freie positiv validierte Baumdarstellung verwendet. `jsonc-parser@3.3.1` kann strict JSON inklusive Quellpositionen bereitstellen; Kommentare/Trailing Commas deaktivieren und doppelte Keys zusätzlich im Baum prüfen. `saxes@6.0.0` kann XML-Struktur lesen; DOCTYPE/PI/unerlaubte Entities/Namespaces explizit zurückweisen, keine externe Auflösung. Bibliotheksparse allein ist keine SVG-Freigabe. Primärquellen: [Microsoft JSON-Parser](https://github.com/microsoft/node-jsonc-parser), [Saxes](https://github.com/lddubeau/saxes).


## Ergänzender öffentlicher Iconvertrag

Der tatsächlich gelieferte Einstieg `src/catalog/index.ts` exportiert zusätzlich die folgenden sicheren Darstellungsfunktionen; Codex bestätigt diese API für Renderer/Interop, ohne das obige Iconprofil zu erweitern:

- `parseSafeIconSvg(svg: string): { ok: true; tree: SafeSvgRootNode } | { ok: false; code: string; message: string }`.
- `validateSafeIconSvg(svg: unknown, path?: string): SafeSvgRootNode`, Fehler als DomainValidationError.
- `resolveCatalogIcon(iconSvg?: string): { tree: SafeSvgRootNode; isFallback: boolean; warning?: { code: string; message: string } }`.
- `SafeSvgRootNode` enthält `tag:'svg'`, `viewBox:string`, `parsedViewBox:{minX,minY,width,height}`, `xmlns` mit festem SVG-Namespace, sichere readonly `attributes` und readonly `children`. Kindknoten haben `tag`, `attributes`, `children`, keine freie HTML-Payload.
- `validateWidgetValue(widget, value, path?)` liefert den geprüften String oder wirft DomainValidationError; kein boolescher Erfolg. `formatWidgetMetadataKey(type,key)` konstruiert den vereinbarten Metadatenschlüssel.
- `searchCatalogComponents(sets = builtInComponentSets, query = '', providerFilter = 'all')` liefert getrennte `{set,component}`-Werte.

Die eigenen Zusatztests des Implementierenden müssen diese tatsächlichen Signaturen und die freigegebene Policy prüfen. Abweichende Fixtures mit Root-width/height, stroke-dasharray, clip-rule oder Set-ID-Doppelpunktpräfix sind kein Grund, das Icon-/Typenprofil still zu erweitern.

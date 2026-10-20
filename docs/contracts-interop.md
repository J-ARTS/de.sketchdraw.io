# S3-Vertragsentwurf: draw.io und SVG

Stand: 17.10.2026. **Von Codex für den reinen Interop-Adapterauftrag freigegeben; noch kein Implementierungs- oder Kompatibilitätsnachweis.** Architektur [#6](https://github.com/J-ARTS/de.sketchdraw.io/issues/6), Implementierung [#12](https://github.com/J-ARTS/de.sketchdraw.io/issues/12), Abnahme [#15](https://github.com/J-ARTS/de.sketchdraw.io/issues/15). Antigravity implementiert `src/interop/`, Claude Code die Bedienung, Codex verantwortet Vertragsabgleich und unabhängige Prüfungen.

Grundlagen sind [S1](contracts.md), [S2](contracts-s2.md), [Schema 1](../src/domain/types.ts), [Architektur](architecture.md) und Bedenken C-004/DR-C07 sowie AG-01/02/06/10. Dieser Entwurf erweitert öffentliche Adapterfunktionen, **ändert aber keine persistenten Schema-1-Typen**. Verlustfrei bezeichnet unten ausdrücklich einen eigenen unveränderten Roundtrip oder die jeweils unterstützte Fremdformat-Teilmenge. Es bedeutet weder vollständige draw.io-Kompatibilität noch identische Textdarstellung auf jedem Rechner.

## 1. Adapter-API und Ergebnissemantik

Alle Funktionen arbeiten ausschließlich mit übergebenen Strings/Dokumenten. Keine Datei-, Netzwerk-, Shell-, Electron-, Browser-DOM- oder Canvaszugriffe; kein Controller-Commit und keine Mutation der Eingaben. Synchroner Aufruf ist Teil des bestehenden Vertrags. XML-, Pfad- und DEFLATE-Verarbeitung müssen dafür Browser und Node unterstützen; Bibliotheken werden vor Installation durch Codex/DevOps abgestimmt und gepinnt. DOM-freies Parsen bedeutet nicht Regex-Sanitizing.

```ts
// src/interop/index.ts — neue Adaptertypen, keine Änderung von domain/types.ts
export type InteropFormat = 'drawio' | 'svg';
export interface InteropDiagnostic extends ConversionWarning {
  code: string;
  severity: 'info' | 'warning' | 'error';
  effect: 'normalized' | 'approximated' | 'preserved-as-data' | 'omitted' | 'rejected';
  pageIndex?: number;
  elementId?: string;
  sourcePath?: string; // parser path, never an OS path
}
export class InteropError extends Error {
  readonly code: string;
  readonly diagnostics: readonly InteropDiagnostic[];
}
export interface DrawioPageInfo {
  index: number;       // zero-based and unambiguous, even if foreign page IDs repeat
  id?: string;
  name: string;
  encoding: 'xml' | 'deflate-base64';
}
export interface ImportOptions {
  documentId?: string; // explicit new identity; otherwise preserve valid own metadata,
                       // or generate a fresh ID with the existing domain factory
  title?: string;      // explicit override; otherwise own title / page name / SVG title
}
export interface DrawioImportOptions extends ImportOptions {
  pageIndex?: number;
}
export interface InteropImportResult extends ImportResult {
  diagnostics: InteropDiagnostic[];
  fidelity: 'own-roundtrip' | 'supported-subset' | 'approximate';
  requiresConfirmation: boolean;
  source: { format: InteropFormat; page?: DrawioPageInfo };
}
export interface InteropExportOptions {
  embedDocument?: boolean; // default true; explicit false creates a portable projection
}
export interface InteropExportResult {
  format: InteropFormat;
  contents: string;
  mimeType: 'application/xml' | 'image/svg+xml';
  suggestedExtension: '.drawio' | '.svg';
  diagnostics: InteropDiagnostic[];
  requiresConfirmation: boolean;
  embedsDocument: boolean;
}

export function inspectDrawio(xml: string): DrawioPageInfo[];
export function importDrawio(xml: string, options?: DrawioImportOptions): InteropImportResult;
export function importSvg(svg: string, options?: ImportOptions): InteropImportResult;
export function prepareDrawioExport(doc: SketchDocument, options?: InteropExportOptions): InteropExportResult;
export function prepareSvgExport(doc: SketchDocument, options?: InteropExportOptions): InteropExportResult;

// Existing signatures retained for callers that require an unambiguous string.
export function exportDrawio(doc: SketchDocument): string;
export function exportSvg(doc: SketchDocument): string;
export const INTEROP_LIMITS: Readonly<Record<string, number>>;
```

- `ImportResult.document` bleibt ein vollständiges, abgetrenntes, domänenvalidiertes Dokument. `warnings` ist die kompatible Projektion aller `warning`-Diagnosen auf `sourceId/property/message`; `diagnostics` ist die maßgebliche strukturierte Liste. Bei fatalen Fehlern wird `InteropError` geworfen; nie ein halbes Dokument zurückgeben. Ungültige Dokumente am Exporteingang liefern `DomainValidationError`.
- `requiresConfirmation` ist genau dann wahr, wenn mindestens eine `warning` vorliegt. Die Konvertierung selbst ist eine lokale Vorschau. Der Renderer zeigt Anzahl, betroffene Objekte und Folgen vor Übernahme/Dateiausgabe. Keine Bestätigung pro einzelner Diagnose verlangen. `info` beschreibt beispielsweise eine ID-Umsetzung oder Semantik, die nur in Zusatzmetadaten verfügbar ist.
- Die beiden String-Wrapper rufen die entsprechende `prepare…Export`-Funktion mit Standardeinstellungen auf. Bei `requiresConfirmation` werfen sie `InteropError` mit `LOSS_CONFIRMATION_REQUIRED` samt Diagnosen; sie verschweigen keinen Verlust. UI und MCP verwenden für Exporte die vorbereitenden Funktionen und deren Bericht. Ein Fehler liefert niemals einen bereits geschriebenen Export.
- `fidelity: 'own-roundtrip'` setzt den nach Abschnitt 6 bestätigten Metadatenpfad voraus. Ohne diesen Pfad ist `supported-subset` nur ohne approximierte oder ausgelassene Inhalte zulässig. Alle anderen erfolgreichen Importe heißen `approximate`. Explizite `documentId`-/`title`-Overrides werden nach Wiederherstellung angewendet und als `IDENTITY_OVERRIDDEN`/`TITLE_OVERRIDDEN` dokumentiert; die Gleichheitszusage gilt ohne Overrides.
- Diagnosen sind deterministisch nach Quellreihenfolge/Attributpfad, dann Code sortiert. Gleiche Probleme nicht mehrfach pro Nachfahren melden, sofern ein klar referenzierter Subtree-Befund die Auswirkung vollständig beschreibt. Mindestens Format, Quellobjekt oder Pfad, Eigenschaft und verständliche Folge nennen. Quellenstrings sind Daten und werden in der UI als Text ausgegeben.

## 2. Ressourcen- und Sicherheitsgrenzen

Vorgeschlagene Grenzen gelten für diese Adapter und ersetzen keine Domänengrenze. Ein exportierbares Dokument kann aufgrund der zusätzlichen XML-/Metadatenrepräsentation größer als seine native JSON-Datei werden. Bei Überschreitung klar abbrechen; keine Behauptung, jedes domänenvalide Dokument passe zwangsläufig in jedes Exportlimit.

| Grenze | Wert / Anwendung |
| --- | --- |
| `MAX_INPUT_BYTES`, `MAX_EXPORT_BYTES` | Je 96 MiB UTF-8; vor Parsing bzw. vor Rückgabe prüfen. |
| `MAX_XML_NODES` | 200.000 über das tatsächlich geparste Dokument; Attribute zählen separat. |
| `MAX_XML_DEPTH` | 64; früh im Parser prüfen, bevor rekursiv umgewandelt wird. |
| `MAX_ATTRIBUTES_PER_NODE` | 128; doppelte Attribute/IDs nicht still überschreiben. |
| `MAX_PAGES` | 100; allein die Seitenauswahl darf keine beliebige Expansion auslösen. |
| `MAX_COMPRESSED_PAGE_BYTES` | 32 MiB nach Base64-Decodierung. |
| `MAX_INFLATED_URI_BYTES` | 96 MiB ASCII-Zwischenrepräsentation einer ausgewählten draw.io-Seite. |
| `MAX_DECODED_PAGE_BYTES` | 32 MiB UTF-8 nach URI-Decodierung, vor zweitem XML-Parsing. |
| `MAX_EMBEDDED_DOCUMENT_BYTES` | 32 MiB decodiertes kanonisches JSON; Domain- und Assetlimits zusätzlich. |
| `MAX_PATH_COMMANDS` | 10.000 pro SVG-Pfad; Zahlen endlich und begrenzt. |
| `MAX_GENERATED_POINTS` | 10.000 pro Zielelement, insgesamt 100.000 pro Import; niemals erst unbeschränkt erzeugen. |
| `MAX_DIAGNOSTICS` | 200 plus genau eine abschließende `DIAGNOSTICS_TRUNCATED`-Warnung bei weiteren Befunden. |
| `MAX_PRESERVED_SOURCE_BYTES` | 32 KiB UTF-8 pro Quellobjekt, 1 MiB pro importiertem Dokument; zusätzlich höchstens 50.000 Zeichen je Metadatenwert. |

Alle Pfade, einschließlich eingebetteter Metadaten, komprimierter Seiten, `<defs>`-/`use`-Expansion und Import eigener Exporte, durchlaufen dieselben Limits. Ein Domänenkandidat muss auch die kanonische JSON-Größe einhalten; große Zeichnungsdaten dürfen nicht erst beim späteren Speichern scheitern. Outputlängen werden während der Erzeugung gezählt, nicht erst nach riesiger Stringallokation. Streaming-Inflater muss beim Erreichen des Outputlimits abbrechen; nachträgliches Prüfen einer vollständig unbeschränkt entpackten Zeichenfolge reicht nicht. Die Implementierung meldet vorab, falls ihre Bibliothek das nicht ermöglicht.

Empfohlene portable Abhängigkeit ist **`fflate` mit synchronem `Inflate`-Stream** und einem eigenen begrenzenden Wrapper. Die Bibliothek bietet reine JavaScript- und Browser-/Node-Unterstützung; konkrete Version prüft und installiert Codex nach Vertragsfreigabe. Kein `node:zlib`, kein `Buffer` im Browseradapter und keine Voraussetzung, dass `DecompressionStream('deflate-raw')` unter Node 22.16 oder allen Zielbrowsern verfügbar ist. [fflate-Primärdokumentation](https://github.com/101arrowz/fflate).

Der Wrapper speist begrenzte Eingabechunks (anfangs höchstens 1.024 Bytes), zählt jede Ausgabe **vor** Übernahme in die Ergebnissammlung und bricht bei Grenzüberschreitung ab; keine weiteren `push`-Aufrufe nach Abbruch. `inflateSync`/`decompressSync` auf dem vollständigen unbekannten Payload plus nachträglichem Größencheck ist kein Ersatz. Antigravity muss anhand der gepinnten Implementation und Bomben-Fixtures auch das maximale temporäre Arbeitsvolumen pro Push begründen: Ein Callback allein garantiert noch keinen hart begrenzten internen Allocator. Kann dieser Nachweis nicht erbracht werden, braucht der Auftrag einen anderen begrenzten Inflater oder eine ausdrücklich abgestimmte API-Änderung, keine stille Rückkehr zu unbeschränkter Dekompression.

XML-Verarbeitung:

1. Ein echtes XML-Parsing mit Namespacebewusstsein und positionsbezogenen Fehlern verwenden. Vor DTD-Auflösung abbrechen: `DOCTYPE`, benutzerdefinierte Entities, externe Entities und Processing Instructions sind abzuweisen; die normale XML-Deklaration ist zulässig. Die fünf eingebauten XML-Entities und gültige numerische Zeichenreferenzen werden genau einmal nach XML-Regeln dekodiert. Entity-expansion, XInclude, Stylesheet-PI und Netzwerknachladen sind nicht erlaubt.
2. Wohlgeformtheit, erlaubte Wurzel, Duplikate, Knotenzahl und Tiefe vor Interpretation prüfen. Keine Recovery, die kaputte XML-Struktur still neu verschachtelt. Namespacepräfixe sind nicht die Identität; die expandierten Namen müssen passen. Fremde Namespaces werden als unbekannte Daten behandelt, niemals als Parser-/Plugin-Code.
3. Kein fremdes XML/SVG/HTML in `innerHTML`, `v-html`, `object`, `iframe` oder einen Live-DOM übernehmen. Auch eine Browser-`DOMParser`-Instanz ist keine vollständige Sanitization-Grenze. Die App rendert ausschließlich das konvertierte Schema-1-Dokument über ihre eigenen Komponenten.
4. Farben, Zahlen, URLs, Referenzen und geometrische Daten werden nach dem Entity-Decoding positiv validiert. `url(...)`, `@import`, CSS-Ausdrücke, fremde Dokument-URLs und Eventhandler dürfen keinen Netz-/Ausführungspfad erreichen. Private IPs oder lokale Dateipfade sind keine Ausnahme. HTTP(S)-Dokumentationslinks sind nur inert gespeicherte, domänenvalidierte Daten; Öffnen bleibt eine ausdrückliche Nutzeraktion.
5. Eingebettete Bilder akzeptieren ausschließlich vollständige Base64-Daten für PNG/JPEG/WebP mit Domänenprüfung von MIME, Bytesignatur und Grenzen. `file:`, `blob:`, entfernte Bilder, SVG-in-`image`, HTML-Daten und fremde Fonts nicht laden. Unbekannte Bilder erhalten nach Möglichkeit einen sichtbaren Platzhalter und eine Diagnose. Roh-SVG als Bildasset würde Schema 1 umgehen und ist nicht erlaubt.

Die SVG-Spezifikation unterscheidet Ressourcen-/Ausführungsmodi; das ist keine Freigabe für beliebiges Inline-Markup in unserer Oberfläche. Der oben beschriebene Datenparser ist eine eigene, engere Produktgrenze. [SVG-2-Konformität](https://www.w3.org/TR/SVG2/conform.html), [eingebettete Inhalte](https://www.w3.org/TR/SVG2/embedded.html).

## 3. draw.io: Container, Seiten und Einlesen

Seit Schema v2 (ADR 0006): `DrawioImportOptions.pageIndex` akzeptiert zusätzlich `'all'`; dann wird jede `<diagram>`-Seite zu einer Dokumentseite (Name aus `name`). Ohne Angabe bleibt bei mehreren Seiten die ausdrückliche Auswahl Pflicht (`PAGE_SELECTION_REQUIRED`). Der Export schreibt eine `<diagram>` je Seite, das eingebettete Modell sitzt auf der ersten. `InteropExportOptions.pageId` wählt die Seite des SVG-Exports (Standard: erste Seite; Hinweis `PAGE_EXPORTED_SINGLE`, kein Verlustwarnung).

Akzeptierte Eingänge sind `<mxfile>` mit `<diagram>`-Seiten sowie ein einzelnes `<mxGraphModel>`. Eine Seite enthält entweder direkt ein `<mxGraphModel>` oder komprimierten Text. Der komprimierte Weg ist **Base64 → raw DEFLATE → URI-Decodierung → XML**, nicht ZIP oder ungeprüftes zlib-Autodetect. Andere Verpackungen liefern einen Formatfehler. Diese Varianten und der Zusammenhang zwischen `mxfile`, Seiten und Modellen sind im [primären Dateiformat](https://github.com/jgraph/drawio/wiki/File-Format) beschrieben.

- `inspectDrawio` liest nur den begrenzten äußeren XML-Baum und meldet Seiten in Dateireihenfolge. Komprimierte Seiten werden dabei nicht entpackt und noch nicht als gültiges Modell bestätigt. Name ohne Inhalt: `Seite N`. Ein bloßes `<mxGraphModel>` erhält eine synthetische Seite mit Index 0.
- Bei mehr als einer Seite ist `pageIndex` erforderlich; andernfalls `PAGE_SELECTION_REQUIRED` statt stiller Auswahl der ersten Seite. Ein falscher Index liefert `PAGE_NOT_FOUND`. Die Auswahl importiert genau diese Seite. Nicht ausgewählte Seiten bleiben unberührt und werden nicht unbemerkt zusammengeführt. Der Bericht nennt die Auswahl und Gesamtzahl; fehlende Auswertung anderer Seiten ist kein erfolgreicher Gesamtdatei-Test.
- Seiten-ID und Zell-ID sind verschiedene Namespaces. Doppelte Seiten-IDs verhindern die indexbasierte Auswahl nicht und erzeugen eine Warnung. Doppelte Zell-IDs in der gewählten Seite sind ein Fehler. Parentzyklen, ungültige terminale Referenzen und widersprüchliche Wrapper-/Cell-IDs ebenfalls, sofern keine explizit unten beschriebene, sichtbare Entkopplung möglich ist.
- XML-Attribute wie `modified`, `agent`, `host` oder behauptete Version sind Daten, keine Vertrauensentscheidung. Nicht ausgewählte Seiten und fremde Dokumente werden niemals durch einen Export des aktuellen Sketchdraw-Dokuments überschrieben.

### Native Zellabbildung

`mxCell` und zulässige User-Object-Wrapper werden zu einer begrenzten neutralen Zellliste gelesen. Wrapper-ID/-Label, Parent- und Kantenreferenzen werden ausdrücklich aufgelöst, keine beliebigen mxGraph-Codecs instanziiert. Freie User-Object-Attribute bleiben begrenzte, inerte Quelldaten. Grundlage sind [mxCellCodec](https://jgraph.github.io/mxgraph/docs/js-api/files/io/mxCellCodec-js.html) und die [offizielle Diagrammerzeugung](https://www.drawio.com/docs/reference/diagram-generation/).

| Quellinhalt | Schema-1-Abbildung und diagnostizierte Grenze |
| --- | --- |
| Unbekleidetes Rechteck, Ellipse, Rhombus, Text | `rectangle`, `ellipse`, `diamond`, `text`; positive Bounds und unterstützte Stile. Abgerundete Ecken, Schatten, Verläufe und weitere nicht darstellbare Gestaltung bleiben eine explizite Approximation. |
| Gruppe / Container mit Kindern | `container` mit Rotation 0, Kinder mit `parentId` und absoluten Weltkoordinaten. Reine Root-/Layer-Zellen sind keine sichtbaren Elemente. Layerinformationen als begrenzte Metadaten; Reihenfolge erhalten, soweit die flache Z-Liste sie ausdrücken kann. |
| Absolute Vertex-Geometrie | Elternursprung zur lokalen Position addieren. Reparenting darf die sichtbare Position nicht verändern. Die ursprüngliche Parentreferenz im Quellmapping behalten. |
| Relative Vertex-/Port-Geometrie | Position aus Parentbreite/-höhe und explizitem Offset berechnen; als editierbares Element übernehmen. Prozentuale Bindung ist in Schema 1 nicht persistent ausdrückbar: `RELATIVE_LAYOUT_FLATTENED`. |
| Kante mit Source/Target | `connector`; bekannte gebundene Endpunkte und Waypoints in Weltkoordinaten auswerten, anschließend in lokale `points` umrechnen. Terminalanker nur aus expliziten gültigen Ankerwerten exakt übernehmen. |
| Freie Kantenendpunkte | Explizite `sourcePoint`/`targetPoint` verwenden. Fehlt eine referenzierte Zelle, aber ein gültiger Ersatzendpunkt existiert: entkoppeln und warnen. Fehlen beide: kein erfundener Ursprung; sichtbarer Platzhalter mit `EDGE_ENDPOINT_UNRESOLVED`. |
| Automatischer Router / Perimeter | Gespeicherte Waypoints erhalten. Ohne ausreichende gerenderte Route eine deterministische gerade Verbindung zwischen Terminalmitten erzeugen, Anker `(0.5, 0.5)` und `ROUTING_APPROXIMATED`. Dies ist kein mxGraph-Router-Nachbau. |
| Kantenbeschriftung / zusätzlicher Edge-Label-Vertex | Haupttext bleibt am Connector. Positionsabhängige Zusatzlabels als getrennte Texte mit berechenbarer Position; nicht darstellbare Relative-/Offsetsemantik im Bericht. |
| Bilder | Eingebettete PNG/JPEG/WebP in `assets`, Deduplizierung nur bei identischem geprüften Inhalt/MIME. Unbekannte oder externe Bilder als beschriftete Rectangle-Platzhalter gleicher bekannter Bounds. |
| Fremde Cloud-/Stencil-/Custom-Shape | Keine erfundene Zuordnung zu einem Sketchdraw-Provider. Bekannte Bounds, Rotation, Text und sichere Stile als beschriftetes Rectangle erhalten, Quelltyp im Bericht/Metadaten. Die Silhouette wird als Verlust ausgewiesen. |
| Versteckte Layer/Zellen | Wirksame Unsichtbarkeit über `opacity: 0` und klare Elementlistennamen/Metadaten erhalten; `VISIBILITY_FLATTENED`, weil ursprüngliche Sichtbarkeitsumschaltung fehlt. Keine heimliche Löschung. |
| Eingeklappte / rotierte Container | Kinder nach nachvollziehbarer Weltgeometrie erhalten und Container expandiert/unrotiert abbilden; `CONTAINER_LAYOUT_APPROXIMATED`. Wenn Weltgeometrie nicht bestimmbar ist, sichtbare Platzhalter statt erfundener präziser Anordnung. |

Die Zuordnung von Vertex-, Port-, Kanten- und Labelkoordinaten richtet sich nach [mxGeometry](https://jgraph.github.io/mxgraph/docs/js-api/files/model/mxGeometry-js.html). Die obigen Fallbacks sind Sketchdraw-Entscheidungen, keine Behauptung gleicher Fremdformatsemantik.

Styles werden als Daten mit begrenztem Parser gelesen. Unterstützt: Farbe/Füllung, Strichbreite, Deckkraft, Schriftgröße, links/zentriert/rechts, Rotation und die drei eigenen Strichmuster. Benannte/nicht aufgelöste Styles sind keine ausführbaren Ausdrücke. Unbekannte Stylekeys und Pfeilkopfvarianten erhalten Diagnosen; nur als begrenzte Quelldaten speichern. `html=1`-Beschriftungen werden mit einem inerten HTML-Tokenizer zu Klartext einschließlich nachvollziehbarer Block-/Zeilenumbrüche; Tags, eingebettete Bilder, Schriftmischung und Links erscheinen als Verluste. HTML niemals rendern. Ein `<` in einem reinen Textlabel bleibt Text. Attribute und Stylebedeutungen sind in [mxConstants](https://jgraph.github.io/mxgraph/docs/js-api/files/util/mxConstants-js.html) beschrieben; die unterstützte Teilmenge wird mit Fixtures fixiert.

`<defs>`/`def(n)` für komprimierte Styles darf ausschließlich auf einen begrenzten, lokalen Definitionseintrag aufgelöst werden. Mehrere Zellen dürfen denselben Definitionseintrag wiederverwenden. Bilder unterliegen erneut der Assetprüfung; Stencils werden nicht ausgeführt, sondern wie unbekannte Shapes behandelt. Zyklische oder außerhalb der Definitionstabelle liegende Verweise sind Fehler. Dynamische Platzhalter, Tags, Seitenlinks, Custom Actions, Animation und fremde Layoutregeln bleiben inerte Quelleninformationen mit Verlusthinweis.

### Native draw.io-Ausgabe

Ausgabe ist immer eigenständiges, **unkomprimiertes** XML mit `<mxfile compressed="false">`, genau einer `<diagram>`-Seite, `<mxGraphModel>` und echten `<mxCell>`-/`<mxGeometry>`-Daten. Keine proprietäre JSON-Datei mit `.drawio`-Endung. Keine eingebetteten Skripte oder Abhängigkeit von Sketchdraw, um die sichtbare Projektion zu öffnen.

- Root-/Layer-Zellen und Zell-ID-Mapping sind explizit und kollisionsfrei. Interne IDs `0`/`1` oder ungeeignete Quell-IDs werden deterministisch umgesetzt; native Verweise verwenden das Mapping. Das vollständige eigene Dokument liegt bei gewählter Metadateneinbettung separat vor.
- Rechteck/Ellipse/Rhombus/Text/Bild erhalten native editierbare Zellen. Container-Parentbezüge werden in native Elterngeometrie umgerechnet. Wenn die flache Schema-1-Z-Reihenfolge nicht als mxGraph-Hierarchie darstellbar ist, bleibt die Hierarchie erhalten und `STACKING_ORDER_APPROXIMATED` benennt die geänderte sichtbare Überlagerung. Keine stillschweigende Neuordnung als „verlustfrei“ melden.
- Connectoren haben echte `source`-/`target`-Referenzen, explizite Anker ohne automatische Perimeterkorrektur, transformierte freie Endpunkte und Waypoints. Automatisches Rerouting deaktivieren; gerenderte Punktgeometrie bleibt die Grundlage. Für geometrisch nicht exakt darstellbare Fälle eine Warnung ausgeben. Schema 1 besitzt keine getrennte Pfeilkopfsemantik; keine zusätzlichen Pfeile erfinden.
- Freihandpfade werden als native Linienzüge/geeignete editierbare Projektion ausgegeben. Geschlossene Füllungen oder Shape-Identität, die dabei verloren gehen, erfordern `PATH_PROJECTION_APPROXIMATED`. Eine einzelne native Zelle darf nicht als angeblich gleichwertig bezeichnet werden, wenn sie tatsächlich in mehrere Zellen zerlegt wird.
- Components bekommen zumindest editierbare Bounds und Namen. Ein zulässiges S2-Icon kann als sichere Vektorprojektion erhalten werden; eine Bitmaprasterisierung oder externes Iconladen gehört nicht zu diesem synchronen Adapter. Component Sets, Widgets und API-Semantik bleiben Zusatzmetadaten; fremde Bibliothekszugehörigkeit wird nicht behauptet.
- Texte werden XML-escaped mit `html=0` ausgegeben. Für XML 1.0 nicht darstellbare Zeichen im sichtbaren Text einen Ersatz mit `TEXT_CHARACTERS_APPROXIMATED` melden; das JSON der eigenen Zusatzmetadaten erhält die ursprünglichen Codeeinheiten. Keine stille Änderung des Eingabedokuments.

## 4. SVG: sichere editierbare Projektion

### SVG-Ausgabe

`prepareSvgExport` erzeugt ein eigenständiges `<svg xmlns="http://www.w3.org/2000/svg">` mit endlichem positivem `viewBox`, explizitem sichtbarem Inhalt, Titel/Beschreibung und optionalen eigenen Metadaten. Es enthält native Vektoren und Texte, keine Screenshot-Fläche und kein `foreignObject`. Leeres Dokument: `viewBox="0 0 1 1"`. Sonst sichtbare transformierte Bounds einschließlich Strichbreite und deterministischem Rand von 16 Dokumenteinheiten. Der Export verändert keine Modellkoordinaten; `viewBox` darf negative Ursprünge haben.

| Domäne | SVG-Projektion |
| --- | --- |
| Rectangle / Container | `rect`; Containersemantik steht zusätzlich in eigenen Metadaten. |
| Ellipse / Diamond | `ellipse` bzw. geschlossenes `polygon`. |
| Path | Ein `path`/`polyline` aus vorhandenen lokalen Punkten; nicht automatisch schließen. Eine vorhandene explizite Rückkehr zum Anfang bleibt erhalten. Keine erfundenen Kurven. |
| Connector | Polyline mit vollständig aufgelösten, transformierten Endpunkten und Waypoints. Referenzsemantik bleibt eigene Metadaten, die sichtbare Linie funktioniert ohne sie. |
| Text und Shape-Text | Native `text`-/`tspan`-Knoten mit escaptem Inhalt, expliziten Zeilen und erlaubter Ausrichtung. Festes Layout, kein browserabhängiger Eingriff in die Modellgeometrie. |
| Image | `image` mit geprüftem PNG-/JPEG-/WebP-Data-URI, expliziten Bounds und erhaltener Rotation. |
| Component | Editierbare Bounds/Name und ein nach S2 positiv geprüfter Iconbaum; andernfalls sichtbares generisches Symbol mit `COMPONENT_ICON_FALLBACK`. |

Ein Element erhält eine eigene `g`-Transformation entsprechend Weltposition und Drehung um seine Mitte. Alle Top-Level-Elementgruppen bleiben in der flachen Dokumentreihenfolge; Container verschachteln die SVG-Zeichenreihenfolge nicht nachträglich. `label/description` erzeugen `title/desc` und zugängliche Namen; Element-IDs werden in sichere kollisionsfreie SVG-IDs umgesetzt. Keine Eventhandler, Scripts, CSS-Stylesheets oder externen Ressourcen. Präsentationsattribute werden ausschließlich aus positiv geprüften Werten erzeugt. Ein nach der Domäne zulässiger, aber vom sicheren Exportprofil nicht darstellbarer Farb-/Stilstring führt zu einer expliziten Approximation, nicht zur Ausführung und nicht zur Mutation der Domäne.

Die unterstützten Vektor- und Malprimitive folgen [SVG-Basisformen](https://www.w3.org/TR/SVG2/shapes.html) und [SVG-Painting](https://www.w3.org/TR/SVG2/painting.html). Die konkrete Projektion in dieser Tabelle ist unsere Exportpolicy.

Fonts: `sans`/`mono` auf die tatsächlich gebündelten UI-Familien plus generischen Fallback abbilden. Keine entfernten Font-URLs oder still eingebetteten Fontdateien. SVG außerhalb der App kann andere Metriken verwenden; bei Text `FONT_RENDERING_DEPENDENT` als Warnung ausgeben. Schriftkonturen sind kein gleichwertiger Ersatz für editierbaren Text. Das native JSON erhält Fonttoken und Text unverändert. Text-Baselines und Tspan-Abstände sind gemeinsam mit Claude gegen Canvas-Fixtures festzulegen; [SVG-Text](https://www.w3.org/TR/SVG2/text.html) ersetzt diesen Vergleich nicht.

### Fremdes SVG importieren

Wurzel muss SVG im Standardnamespace sein; namespacefreie historische SVG-Wurzel ist mit `SVG_NAMESPACE_ASSUMED` zulässig. Parser erzeugt eine eigene Baumdarstellung. Beschränkt unterstützte Elemente: `svg`, `g`, `rect`, `circle`, `ellipse`, `line`, `polyline`, `polygon`, `path`, `text`, `tspan`, `image`, `title`, `desc`, `metadata`, sowie lokale `defs`/`use` nach den folgenden Regeln. Animierte Zustände werden nicht ausgewertet. Styles werden niemals an einen Browser delegiert.

- `rect/circle/ellipse`, einfache Texte, Linienzüge und eingebettete Rasterbilder werden in eigene bearbeitbare Elemente umgewandelt. Ein `g` ist zunächst eine Transform-/Stilvererbung, kein automatisch neu erfundener sichtbarer Container. Eigene bestätigte Metadaten können echte Container wiederherstellen.
- Transformationen `matrix/translate/scale/rotate/skewX/skewY` mit endlichen begrenzten Zahlen werden als affine Matrix in korrekter Reihenfolge komponiert. Positionen in root-`viewBox`-Benutzerkoordinaten werden Dokumentkoordinaten; äußere Druck-/Viewportgröße ist keine versteckte Skalierung des Dokuments. Verschachtelte SVG-Viewports müssen `viewBox`/`preserveAspectRatio` berücksichtigen oder den gesamten betroffenen Subtree ausdrücklich als approximiert behandeln. [SVG-Koordinaten und Transformationen](https://www.w3.org/TR/SVG2/coords.html).
- Für geometrisch exakt darstellbare Translation/Rotation/Skalierung Kind und Geometrie erhalten. Skew, Spiegelung, nicht darstellbare Text-/Bildtransformation oder ein Nullmaßstab werden nicht mit falschen Rotation-/Breitenwerten kaschiert: Vektorformen in editierbare Punkte überführen oder einen beschrifteten Bounds-Platzhalter erzeugen und warnen. Containerrotation bleibt 0.
- Numerische Werte und `px` sind direkt unterstützt. Prozentwerte werden nur bei eindeutig bekanntem zuständigem Viewport aufgelöst. Andere Einheiten brauchen explizite 96-dpi-Umrechnung oder `UNSUPPORTED_UNIT`; bei unbekanntem Bezugsmaß kein willkürlicher Wert. Geometrieergebnisse und Radien unterliegen stets den Domänengrenzen.
- Pfade unterstützen `M/L/H/V/C/S/Q/T/A/Z` einschließlich relativer Formen und impliziter Wiederholungen mit SVG-konformer Argumentzahl. `C/S/Q/T/A` werden deterministisch zu Punkten angenähert: maximal 0,25 Dokumenteinheiten Abweichung nach Transform, Teilungstiefe höchstens 16, harte Punktebudgets. Bei unerreichbarer Toleranz `PATH_COMPLEXITY_LIMIT`, kein still gröberes Ergebnis. Ein nicht implementierter Pfadbefehl wird vor Freigabe als fehlende Fähigkeit gemeldet. [SVG-Pfade](https://www.w3.org/TR/SVG2/paths.html).
- Mehrere Subpfade werden getrennte Elemente. Bei zusammengesetzten Füllungen, Löchern oder überlappenden Füllregeln kann Schema 1 die Semantik nicht exakt ausdrücken: `COMPOUND_FILL_APPROXIMATED`, sichere sichtbare Konturen oder klarer Platzhalter. Kurvenannäherung erzeugt `CURVE_FLATTENED`, auch wenn die Toleranz eingehalten wird.
- `fill`, `stroke`, Strichbreite, Gesamtdeckkraft, Schriftgröße/-familie, Ausrichtung und begrenzte Strichmuster sind unterstützt. Attributvererbung plus ein einfacher, positiv geprüfter `style`-Deklarationsparser sind zulässig. CSS-Selektoren/Stylesheets, `!important`, Variablen und `url(...)` sind keine stillen Fallbacks. Zugelassene CSS-Farben: Hex, `none`, `transparent`, endliche validierte `rgb()/rgba()` sowie eine feste dokumentierte Tabelle benannter Farben. `currentColor` nur mit explizit aufgelöstem `color`, sonst Warnung und dokumentierter Default.
- Getrennte Füll-/Strichdeckkraft, Blendmodi, Masken, Filter, Clipping, Muster, Verläufe und Marker sind nicht allgemein in Schema 1 ausdrückbar. Die Wirkung wird ausdrücklich diagnostiziert; sichere Grundgeometrie oder Platzhalter erhalten. Kein unsichtbarer Verlust von Pfeilspitzen unter der Bezeichnung „exakt“.
- Text wird als Klartext erhalten. Native `text/tspan`-Zeilen ohne komplexe Positionierung unterstützen; gemischte Stile, `textPath`, Bidi-/Schreibrichtungsabweichungen und anspruchsvolle `x/y/dx/dy`-Listen warnend vereinfachen. Ohne verlässliche explizite Textbounds eine feste, dokumentierte Schätzung mit `TEXT_BOUNDS_APPROXIMATED`; kein vorgetäuschter Fontmetriken-Nachweis.
- `use` darf ausschließlich auf eine eindeutige lokale `#id` verweisen. Referenzzyklen, Tiefe > 16 oder Expansionsbudgetüberschreitung sind Fehler. Nur der sicher unterstützte Zielbaum wird kopiert und transformiert; externe Referenzen niemals auflösen. Nicht unterstützte Symbol-/Viewportsemantik erzeugt eine Warnung. Definitionen sind keine automatisch sichtbaren Zeichenobjekte.
- `display:none` und `visibility:hidden` werden, soweit innerhalb der unterstützten Vererbung eindeutig, als `opacity: 0` mit Herkunftshinweis erhalten. Keine implizite Löschung versteckter Inhalte. Nicht unterstützte Fremdobjekte erhalten bekannte Bounds und zugängliche Platzhalternamen; ohne berechenbare Bounds erscheinen 160×80-Platzhalter auf einer ausdrücklich als Ersatzanordnung diagnostizierten vertikalen Liste. Nie behaupten, unbekannte Originalgeometrie rekonstruiert zu haben.
- `script`, Eventhandler, ausführbare Animation, aktive `foreignObject`-Inhalte und externe Ressourcen werden als nicht übernommen diagnostiziert. Sie werden weder ausgeführt noch automatisch in ein später ausführbares Exportmarkup zurückgeschrieben. Enthält `foreignObject` nutzbaren Text, darf ausschließlich inert extrahierter Klartext in einem Platzhalter erscheinen. Ein verbotener DTD-/Entity-Mechanismus oder unkontrollierbare Struktur bleibt ein fataler Fehler, kein Warnungs-Fallback.

Die SVG-Darstellungsregeln für ganze Diagramme sind ausdrücklich breiter als das dekorative Iconprofil in S2. Keines der beiden Profile darf das andere still erweitern. Ein bereits gespeichertes `iconSvg` bleibt Daten; seine sichere Darstellung erfolgt weiterhin ausschließlich nach dem vereinbarten S2-Profil.

## 5. Herkunft, IDs und Verlustbericht

Unterstützte eigene IDs bleiben erhalten, wenn eindeutig und domänenkonform. Fremde IDs werden nötigenfalls deterministisch anhand Quellreihenfolge auf gültige Element-IDs abgebildet; alle Referenzen benutzen dieselbe Tabelle. Original-ID, Quellformat, Seitenindex und ursprünglicher Typ werden im Bericht sowie bei Bedarf in einem **einzigen JSON-String** unter `metadata['sketchdraw.interop.source.v1']` aufbewahrt. Das enthält nur begrenzte inerte Informationen, keine echten Dateipfade. Bei bestehendem gleichnamigem Metadatenfeld nichts überschreiben; zusätzlicher freier Schlüssel mit numerischem Suffix und Diagnose.

Unbekannte Attribute oder Stile dürfen innerhalb des Quellenbudgets dort ebenfalls erhalten bleiben. Überschreitung liefert `SOURCE_DATA_NOT_PRESERVED` mit Umfang. Metadaten sind kein Versprechen, fremde Funktionen weiter auszuführen. Exporter setzen daraus weder HTML, SVG, native Actions noch beliebige Style-Attribute zurück. Der Bericht unterscheidet „als Daten erhalten“ von „sichtbar/editierbar erhalten“ und „weggelassen“.

Stabile Mindestcodes: `XML_SYNTAX`, `XML_FORBIDDEN_CONSTRUCT`, `UNSUPPORTED_FORMAT`, `LIMIT_EXCEEDED`, `INVALID_COMPRESSION`, `PAGE_SELECTION_REQUIRED`, `PAGE_NOT_FOUND`, `DUPLICATE_SOURCE_ID`, `INVALID_REFERENCE`, `ID_REMAPPED`, `UNSUPPORTED_SHAPE`, `STYLE_APPROXIMATED`, `ROUTING_APPROXIMATED`, `EDGE_ENDPOINT_UNRESOLVED`, `CONTAINER_LAYOUT_APPROXIMATED`, `TEXT_FORMATTING_LOST`, `EXTERNAL_RESOURCE_BLOCKED`, `ACTIVE_CONTENT_OMITTED`, `EMBEDDED_MODEL_INVALID`, `EMBEDDED_MODEL_STALE`, `SEMANTICS_IN_METADATA`, `LOSS_CONFIRMATION_REQUIRED` sowie die spezifischen Codes der Abbildungstabellen. Diagnosecodes sind maschinenlesbar; Rohfehlermeldungen einer Bibliothek reichen nicht.

## 6. Eigene Zusatzmetadaten und echte Roundtrips

Standardexporte enthalten neben **vollständig nutzbaren nativen Zeichenobjekten** ein Envelope `format: 'sketchdraw-interop'`, `version: 1`, `projection: 'drawio-v1' | 'svg-v1'`, `encoding: 'base64-json'` und das vollständige kanonische Dokument. JSON wird UTF-8/Base64 kodiert, damit XML-Zeichenrestriktionen nicht die persistenten Strings verändern. Der Base64-Inhalt ist keine Kompression und keine Signatur.

- SVG: genau ein eigenes Namespaceelement innerhalb eines rootnahen `<metadata>`, Namespace `https://sketchdraw.io/ns/interop/1`.
- draw.io: Envelope als ausdrücklich benanntes, begrenztes Datenattribut `sketchdrawInterop` am User-Object-Wrapper der Rootzelle. Ob dieser konkrete Attributplatz in der geprüften draw.io-Version ohne Nebenwirkungen geladen wird, ist Teil der echten Abnahme; nicht voraussetzen, dass jeder Editor unbekannte Attribute beim Speichern erhält.
- Metadaten werden genau einmal decodiert. Doppelte Envelope-Felder, unbekannte Version, fehlerhaftes JSON, verbotene Keys, ungültige Referenzen oder überschrittene Limits machen das Envelope unbrauchbar. Native Projektion weiter sicher importieren, wenn möglich, mit `EMBEDDED_MODEL_INVALID`; sonst strukturierter Fehler. Kein Privileg entsteht durch Herstellername, Domain-URL oder bloß vorhandenes Envelope.
- **Vor Verwendung zusätzlich Projektion prüfen:** Aus dem validierten eingebetteten Dokument mit derselben Projektionsversion die native Zeichenprojektion erneut generieren. Den Quellbaum ohne Envelope mit dieser Projektion vergleichen: expandierte Namespace-/Attributnamen und Werte, Kindreihenfolge und Textinhalte; Attributreihenfolge, Kommentare und ausschließlich strukturelle Formatierungsleerzeichen ignorieren. Der Vergleich umfasst ausdrücklich root-`viewBox`/Bounds, alle Transform-/Stylewerte, vollständige Punkte, Text und Bildbytes sowie alle nativen Objekte. Native Bounds und Envelope-Geometrie separat auf Endlichkeit/Größenlimits prüfen; vorhandene Metadaten überspringen keine Prüfung des äußeren Baums. Innerhalb von `text/tspan`, Labels und Werten keine Leerzeichen weg-normalisieren. Der Vergleich selbst ist begrenzt und DOM-frei. Keine eingebetteten Hashwerte als Vertrauensbeweis akzeptieren.
- Bei Abweichung, unbekannter Projektionsversion oder nachträglich hinzugefügten nativen Objekten gilt `EMBEDDED_MODEL_STALE`: Die aktuelle sichtbare Fremdprojektion wird importiert; das alte Gesamtdokument darf ihre Änderungen nicht überschreiben. Keine automatische unsichere Teilzusammenführung. Die UI erklärt, dass Zusatzsemantik möglicherweise verloren geht, während native Änderungen erhalten werden.
- Bei Übereinstimmung darf das vollständig validierte eigene Dokument zurückgegeben werden, einschließlich IDs, optionaler Felder, Reihenfolge, Ressourcen, ungenutzter Assets, Component Sets, label/description, Links und Metadaten. Es bleibt untrusted Inhalt für Renderer, MCP und Peerautorisierung. Ein Angreifer kann neue konsistente Daten schreiben; daraus entsteht kein Zugang zu fremden Dokumenten oder lokalen Dateien.

Damit gilt innerhalb der Adapterlimits ohne Overrides für unveränderte eigene Exporte:

```ts
serializeDocument(importDrawio(prepareDrawioExport(doc).contents).document)
  === serializeDocument(doc);
serializeDocument(importSvg(prepareSvgExport(doc).contents).document)
  === serializeDocument(doc);
```

Diese Zusage braucht native Projektionstests **zusätzlich** zum Metadatenroundtrip: Ein leerer SVG-/mxGraph-Body plus JSON erfüllt sie nicht. Entfernen der Metadaten muss weiterhin erkennbare, bearbeitbare native Formen/Verbindungen/Bilder ergeben. Ein `embedDocument: false`-Export erhält nur die unterstützte native Semantik und einen passenden Bericht; ungenutzte Assets, Widgets oder Bindungen nicht fälschlich als erhalten ausgeben. Die UI benennt bei eingebetteten Metadaten, dass auch nicht sichtbare Dokumentinformationen einschließlich Metadaten/ungenutzter Ressourcen enthalten sein können.

## 7. Anwendung, Renderer und Autorisierung

Import erzeugt zunächst eine Vorschau mit Seitenauswahl, Umfang und Bericht. Standardaktion ist **als neues Dokument öffnen**, mit neuem Controller erst nach den bestehenden Dirty-/Save-/Abbruchregeln. Die aktuelle Datei wird nicht durch das Wählen einer Importdatei überschrieben. Import in ein vorhandenes Dokument/Merge ist für diese erste API kein impliziter Nebenweg.

Ein ausdrücklich gewähltes Ersetzen muss Kandidaten-ID an die aktuelle Dokument-ID anpassen, erneut validieren und `replace` mit der beim Vorschauauftrag gespeicherten `expectedRevision` und `source: 'import'` anwenden. Bei inzwischen geänderter Revision Vorschau und aktuelles Dokument erhalten, Konflikt zeigen. Die Vorschau darf nicht heimlich auf eine neue Revision umgestellt werden. Nur bereits bestätigte Änderungen verändern Dirty-/Historyzustand; eine erfolgreiche Konvertierung ist weder ein Save noch ein Commit.

Dateidialoge, Dateiauswahl und Ausgabe laufen ausschließlich über die vorhandenen privilegierten Desktopfähigkeiten bzw. den ausdrücklich benannten Browseradapter. Der synchrone Interop-Adapter benötigt keine Dateihandles. Eine Erweiterung der Desktop-Dialogfilter oder des Browser-Inputs wird mit Antigravity/Claude abgestimmt; `DesktopBridge` nicht still verändern. `exportFile` unterscheidet native Ausgabe, Downloadstart, Abbruch und Fehler wie in S1.

MCP und Peers dürfen diese reinen Konvertierungen nicht als Umgehung von Dokument-Capability, read/write-Rollen oder CAS nutzen. Ein Export gibt nur bereits autorisierten Dokumentinhalt zurück; Importcommit unterliegt denselben Schreibrechten wie jeder andere Command. Metadaten-/Quelltextstrings sind keine Agenteninstruktionen. Die App öffnet keine `link`, `href`, `<image>`-URL oder Benutzeraktion allein durch Auswahl, Vorschau, Konvertierung oder Rendering.

## 8. Abnahmefälle

Fixtures dokumentieren Herkunft, getestete draw.io-/Browserversion, erwartete Elemente/Geometrie und erwartete Diagnosen. Tests erzeugen nicht ausschließlich Exporte mit dem eigenen Exporter: mindestens ein tatsächliches Fremdprogrammfixture je Hauptformat und eine direkt unabhängige Referenzdarstellung verwenden. Entweder neu selbst erzeugte Fixtures verwenden oder Herkunft/Lizenz fremder Dateien festhalten.

| Fall | Erwartung |
| --- | --- |
| IO-01 Unkomprimiertes echtes draw.io mit Shape, Text und gebundener Kante | Editierbare Schemaelemente, richtige Weltkoordinaten, Referenzen, Unicode und Z-Reihenfolge; kein JSON-Ersatzformat. |
| IO-02 Dasselbe als echte raw-DEFLATE/Base64-Seite | Gleiche konvertierte Semantik; Unicode/URI-Decoding korrekt. Defektes Base64, DEFLATE und URI-Escape getrennt diagnostiziert. |
| IO-03 Zwei Seiten mit verschiedenen Namen/Inhalten | Ohne Auswahl `PAGE_SELECTION_REQUIRED`; jede explizite Auswahl erzeugt nur ihre Seite; Inspektion entpackt nicht alle Seiten. |
| IO-04 Container, verschachtelte Kinder, Port/Offset und gedrehte Form | Absolute Geometrie stimmt; unterstützte Rotation exakt, Flattening/Approximation sichtbar benannt. |
| IO-05 Waypoints, freie Endpunkte, explizite Anker und automatisches Routing | Exakte Fälle bleiben gebunden; Näherungen erhalten Diagnose; fehlende Endpunkte werden nicht als `(0,0)` erfunden. |
| IO-06 Unbekannte Cloudshape, HTML-Label und externe Bild-URL | Bounds/Name/Klartext bzw. Platzhalter erhalten; keine Netzwerkanfrage; konkrete Verlustliste. |
| IO-07 Export in tatsächlich geöffnetem diagrams.net/draw.io | Native Shapes, Kanten und eingebettetes Bild sichtbar und dort editierbar; anschließend veränderte/geöffnete Datei erneut importieren und Ergebnis prüfen. Keine vollständige Bibliothekskompatibilität behaupten. |
| IO-08 Fremdes SVG mit rect/ellipse/polyline/text/image und verschachteltem Transform | Sichere eigene Elemente, korrekte Transformreihenfolge und editierbare Geometrie; Bildbytes erhalten. |
| IO-09 Kurven einschließlich relativer Smooth-/Arc-Kommandos | Toleranz und Punktebudget unabhängig messen; komplexe Füllungen diagnostizieren; Grenzüberschreitung bricht begrenzt ab. |
| IO-10 Filter, Maske, Marker, Skew, fremde Fonts und gemischte Textstile | Keine schweigende Auslassung; Fallback/Verlust je betroffenem Objekt; kein Fremdmarkup im DOM. |
| IO-11 SVG nativ im Browser/offline anzeigen, Metadaten entfernen | Erkennbare Vektoren, Texte und Bilder ohne Sketchdraw, Skripte oder Netzwerk; Objektstruktur zusätzlich prüfen. |
| IO-12 Eigenroundtrip beider Formate mit allen neun Arten | Kanonisches JSON bytegleich innerhalb der Grenzen; Labels/Beschreibungen, lokale Punkte, Container, Bindungen, Sets/Widgets, ungenutzte Assets und Metadaten erhalten. |
| IO-13 Natives Shape nach Export ändern, altes Envelope stehen lassen | `EMBEDDED_MODEL_STALE`; native Änderung erhalten, altes Dokument nicht darüberlegen. Auch zusätzliches Objekt und geänderten Text testen. |
| IO-14 Envelope manipulieren / doppeln / falsche Version | Keine ungeprüfte Wiederherstellung; valide native Projektion mit Bericht oder definierter Fehler. Prototype Pollution und übergroße eingebettete Dokumente abweisen. |
| IO-15 DTD, Entities, PI, tiefe XMLs, DEFLATE-Bombe, riesige use-Kette | Früher begrenzter Abbruch; keine Datei-/Netzwerkzugriffe, keine unbegrenzte Expansion. Bei Page-Inspektion fremde komprimierte Seiten nicht expandieren. |
| IO-16 Eventhandler, script, foreignObject, CSS-url/import, data-SVG | Nichts ausführen/nachladen; sichere Fallbacks oder Fehler; Export enthält keine später aktivierbaren Quellfragmente. |
| IO-17 Importvorschau und Verlustdialog abbrechen / Revision zwischenzeitlich ändern | Bestehendes Dokument, Entwurf, Dirtyzustand und History bleiben erhalten; stale Ersetzen wird abgewiesen. |
| IO-18 Export abbrechen / Ausgabe fehlschlagen / Browserdownload | Richtiger Plattformstatus, keine falsche Speicherbestätigung, Ausgangsdokument unverändert. |
| IO-19 Grenzwerte und XML-unzulässige Textzeichen | Eigener JSON-Roundtrip erhält Semantik, sichtbare Approximation benannt; keine übergroße kanonische Übernahme. |
| IO-20 String-Wrapper bei warnendem Export | `LOSS_CONFIRMATION_REQUIRED`; vorbereitende API liefert denselben überprüfbaren Inhalt samt vollständigem Bericht. |

## 9. Vor Umsetzung zu bestätigende Entscheidungen

Codex muss die neuen Ergebnis-/Fehler-APIs, synchronen Dekompressionsgrenzen, SVG-Pfadteilmenge, Verlustbestätigung sowie das Envelope-/Projektionsvergleichsverfahren freigeben. Antigravity soll insbesondere Parser-/Inflatergrenzen, Path-Flattening und draw.io-Root-Wrapper kritisch prüfen; Claude soll Vorschau, Seitenauswahl, Verlustdarstellung und Textlayout gegen die einfache Oberfläche abgleichen. Bedenken werden in `docs/concerns.md` und den Tickets erfasst, statt behauptete Vollkompatibilität durch Platzhalter zu ersetzen.

Die auf dieser Seite verlinkten Primärquellen wurden am 17.10.2026 gelesen. Die spezifischen Limits, APIs, Fallbacks und Sicherheitsregeln sind Vorschläge für Sketchdraw, keine aus Fremdspezifikationen abgeleitete Zertifizierung. Umsetzung und echte Kompatibilitätsabnahme stehen aus.


## Codex-Freigabe des begrenzten Adapterauftrags

Am 17.10.2026 für `src/interop/` und eigene Unit-Fixtures freigegeben. Verfügbare gepinnte Parserabhängigkeiten: `saxes@6.0.0`, `fflate@0.8.3`, `htmlparser2@12.0.0`; Installation von Codex durchgeführt, npm-Audit danach ohne Befund. `htmlparser2` dient nur inerter Klartextgewinnung, niemals der Übernahme fremden Markups. Vorhandene S2-Iconprüfung darf über ihren öffentlichen Einstieg verwendet werden, sobald geliefert.

Die gegenwärtige Persistenz begrenzt Exporte noch auf 32 MiB. Die in diesem Vertrag erlaubten größeren XML-Exporte erfordern vor UI-Freigabe eine getrennte Exportgrenze in Desktop und Browser; das native Dokumentlimit bleibt 32 MiB. Dies gehört zur Integration von #12 und ist kein Auftrag, parallel laufende Desktopdateien zu verändern. Import kann über ein ausdrücklich vom Menschen bedientes Datei-Input mit `File`-Bytes erfolgen; es braucht keine freie Pfad-API. Die Nutzerdatei bleibt unverändert.

Text-/Iconprojektion wird mit den später gelieferten Renderer-Fixtures abgeglichen. Reale Fremdprogramm-/UI-Abnahme folgt der Adapterprüfung; die reine Metadatenwiederherstellung reicht nicht als Kompatibilitätsnachweis.

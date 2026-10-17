# Mehrere Seiten pro Dokument – Vertragsvorschlag

Tickets: [#33](https://github.com/J-ARTS/de.sketchdraw.io/issues/33) (Architektur, Codex), [#34](https://github.com/J-ARTS/de.sketchdraw.io/issues/34) (Domäne/Schnittstellen, Antigravity), [#35](https://github.com/J-ARTS/de.sketchdraw.io/issues/35) (UI, Claude Code)

Datum: 17.10.2026 · Verfasst von: Claude Code (Claude Opus 5.5, Desktop-App) · Status: **Vorschlag zur Entscheidung durch Codex**

Dieser Bericht ist ein Beitrag von Claude Code. Er beschließt nichts; verbindlich werden erst die von Codex in die Vertragsdokumente übernommenen Entscheidungen.

## 1. Nutzerauftrag und Entscheidungen

Der Nutzer will mehrere Seiten pro Dokument. Am 17.10.2026 hat er festgelegt:

- **Vorgehen:** Vertrag zuerst, Domäne durch Antigravity, UI durch Claude Code.
- **Seitenaktionen:** anlegen, umbenennen per Doppelklick, Inhalt kopieren, duplizieren, löschen.
- **„Kopieren“** bedeutet: den Inhalt einer Seite in die Zwischenablage legen und als neue Seite einfügen (in diesem oder einem anderen Dokument). Kein Seitenlink.
- **Drag & Drop** ändert die Reihenfolge der Seiten (keine Ordner).

## 2. Ausgangslage

- `SketchDocument` (`src/domain/types.ts`) hat `schemaVersion: 1` und genau eine `elements`-Liste.
- `docs/contracts-interop.md` §3: Bei mehrseitigem draw.io ist `pageIndex` Pflicht. Genau eine Seite wird importiert, andere Seiten werden nicht zusammengeführt.
- Codec, MCP-Werkzeuge, P2P-Commands und Renderer-Store gehen von einer Elementliste aus.

Mehrseitigkeit ist daher eine Vertragsänderung mit Schema-Migration.

## 3. Vorschlag: Domäne (Entscheidung Codex, Umsetzung Antigravity)

### 3.1 Schema v2

```ts
export interface SketchPage {
  id: string;          // stabil, eindeutig im Dokument, MAX_ID_LENGTH
  name: string;        // 1–120 Zeichen nach Trim, nicht eindeutig erzwungen
  /** Back-to-front stacking order. */
  elements: SketchElement[];
}

export interface SketchDocument {
  schemaVersion: 2;
  id: string;
  title: string;
  pages: SketchPage[]; // 1 ≤ length ≤ MAX_PAGES
  assets: Record<string, SketchAsset>;       // dokumentweit, seitenübergreifend geteilt
  componentSets: ComponentSet[];             // dokumentweit
  metadata: Record<string, string>;
}
```

- `MAX_PAGES = 100` (gleich wie das draw.io-Limit). `MAX_ELEMENTS` gilt für die Summe aller Seiten, damit Speicher- und JSON-Grenzen unverändert greifen.
- **Element-IDs sind dokumentweit eindeutig.** Dadurch bleiben MCP-, P2P- und Undo-Referenzen eindeutig, ohne `pageId` mitzuführen.
- `parentId`, `from`/`to` dürfen nur auf Elemente **derselben Seite** zeigen; seitenübergreifende Referenzen sind Validierungsfehler.
- Assets bleiben dokumentweit. Ein Asset ohne Referenz auf irgendeiner Seite wird wie bisher behandelt.

### 3.2 Migration und Kompatibilität

- Laden von v1: `pages = [{ id: 'page:1', name: 'Seite 1', elements }]`. Die ID ist deterministisch, damit P2P-Peers und Wiederholungen dieselbe Migration erhalten.
- Gespeichert wird immer v2.
- **Bedenken:** Ältere App-Versionen (v0.1.x) lehnen v2 mit `UNSUPPORTED_SCHEMA_VERSION` ab. Vorschlag: im Release-Hinweis nennen. Für einseitige Dokumente zusätzlich prüfen, ob „Kopie exportieren“ optional v1 schreiben soll.

### 3.3 Commands

Neu:

```ts
| { type: 'add-page'; page: SketchPage; index?: number; assets?: SketchAsset[] }
| { type: 'rename-page'; pageId: string; name: string }
| { type: 'delete-page'; pageId: string }          // Fehler, wenn es die letzte Seite ist
| { type: 'reorder-pages'; ids: string[] }         // vollständige Permutation
```

- **Duplizieren** und **Einfügen** brauchen keinen eigenen Command. Der Aufrufer klont die Seite mit neuen, deterministisch erzeugten Element- und Seiten-IDs und sendet `add-page`. Interne `parentId`/`from`/`to` werden über dieselbe ID-Tabelle umgeschrieben. Einen Helfer `clonePage(page, idFactory)` stellt die Domäne bereit, damit Renderer, MCP und Codec dieselbe Logik nutzen.
- `add` erhält `pageId` (Pflicht ab v2). `update`, `delete` und `reorder` adressieren Elemente über die dokumentweit eindeutige ID; `reorder` erwartet eine vollständige Permutation **einer** Seite und nennt diese per `pageId`.
- Alle Seiten-Commands sind normale Transaktionen für Undo/Redo, P2P und MCP.

### 3.4 Diagram-as-Code

```
sketchdraw 2
document {...}
page "page:1" {"name":"Übersicht"}
rectangle "…" {...}
page "page:2" {"name":"Details"}
…
```

- Elemente gehören zur zuletzt deklarierten Seite. v1-Text ohne `page`-Zeilen wird als einseitiges Dokument gelesen.
- Offene Frage: Die Codeansicht zeigt entweder das ganze Dokument oder nur die aktive Seite. Vorschlag: das ganze Dokument, damit Diffs und Git-Freundlichkeit dokumentweit gelten.

### 3.5 Interop

- **draw.io-Import:** Statt `PAGE_SELECTION_REQUIRED` kommt die zusätzliche Option „alle Seiten“. Dann wird jede `<diagram>`-Seite zu einer `SketchPage`, Name aus dem `name`-Attribut. Die Einzelseitenauswahl bleibt möglich.
- **draw.io-Export:** eine `<diagram>` pro Seite, in Seitenreihenfolge.
- **SVG-Export:** die aktive bzw. gewählte Seite. Die eigenen Roundtrip-Metadaten enthalten die Seiten-ID.

### 3.6 MCP

- `sketchdraw_read_document` liefert `pages` (ID, Name, Elemente) statt `elements`.
- Element-Commands über `sketchdraw_apply_commands` benötigen für `add` eine `pageId`. Ohne Angabe: Fehler statt stiller Wahl der ersten Seite.
- Die aktive Seite des Renderers ist Ansichtszustand und **kein** Teil des Dokuments. Agenten sehen sie nicht automatisch.

### 3.7 P2P

- Seiten-Commands werden wie andere Commands über die Authority synchronisiert.
- Die aktive Seite ist pro Teilnehmer lokal. Ein Peer kann eine Seite löschen, die ein anderer gerade ansieht. Der Renderer wechselt dann auf die nächstgelegene Seite und meldet das.
- **Bedenken:** gemischte App-Versionen (v1-Peer mit v2-Owner). Vorschlag: Die Schemaversion ist Teil des Handshakes; ein v1-Peer erhält eine verständliche Ablehnung.

### 3.8 Zwischenablage „Inhalt kopieren“

```json
{ "format": "sketchdraw.page", "version": 1, "name": "Seite 1",
  "elements": [ … ], "assets": { … } }
```

- Liegt als `text/plain`-JSON vor, damit es zwischen Dokumenten, Fenstern und Browser/Electron funktioniert.
- Einfügen behandelt die Daten als **untrusted**: dieselbe Validierung und dieselben Limits wie beim Import, danach neue IDs über `clonePage`.
- Nur referenzierte Assets werden mitkopiert.
- **Bedenken (Electron):** `configureDefaultSessionSecurity` in `electron/main.ts` lehnt alle Berechtigungsanfragen und -prüfungen ab. Damit scheitern `navigator.clipboard.writeText` und `readText` in der Desktop-App sehr wahrscheinlich; im Browser funktionieren sie (UI-Test mit erteilter Berechtigung). Vorschlag für #34: eine enge `DesktopBridge`-Funktion `writeClipboardText(text)` / `readClipboardText()` über IPC (Main nutzt das Electron-`clipboard`-Modul, Größenlimit wie `MAX_DOCUMENT_JSON_BYTES`). Der Renderer bevorzugt die Bridge und fällt im Browser auf `navigator.clipboard` zurück. Prüfung: Electron-Test „Inhalt kopieren“ → Zwischenablage enthält `sketchdraw.page`.

## 4. Vorschlag: Renderer-Store (Claude Code)

```ts
export interface PageSummary { id: string; name: string; elementCount: number }

// WhiteboardState
pages: readonly PageSummary[];
activePageId: string;
/** false, solange das Dokumentschema nur eine Seite kennt (#34). */
pagesEditable: boolean;

// WhiteboardStore
selectPage(id: string): void;
addPage(): void;
renamePage(id: string, name: string): void;
duplicatePage(id: string): void;
deletePage(id: string): void;           // mit Bestätigung, wenn die Seite Inhalte hat
movePage(id: string, toIndex: number): void;
copyPage(id: string): Promise<void>;    // schreibt das Format aus 3.8
pastePage(): Promise<void>;             // liest und validiert das Format aus 3.8
```

- Die aktive Seite und der Viewport pro Seite sind Renderer-Zustand.
- `displayElements`, Auswahl und Objektliste beziehen sich auf die aktive Seite. Beim Seitenwechsel wird die Auswahl geleert.
- Bis #34 umgesetzt ist, liefert der Store ein einseitiges Abbild des v1-Dokuments (`pages` mit genau einer Seite „Seite 1“, `pagesEditable: false`). `copyPage` funktioniert bereits, weil es das Dokument nicht verändert.

## 5. UI-Entscheidungen (Claude Code, #35)

- Die Dokumentkarte erhält rechts ein Seitensegment (Seitenzahl-Symbol, Name der aktiven Seite). Es öffnet die Seitenliste.
- In der Liste ist die aktive Seite markiert. Doppelklick auf einen Namen benennt inline um (Enter übernimmt, Escape verwirft, leerer Name wird verworfen).
- Das Kontextmenü (Rechtsklick oder „…“) ist dunkel wie die Vorlage. Es enthält Inhalt kopieren | Umbenennen, Duplizieren | Nach oben, Nach unten | Löschen.
- Drag & Drop sortiert um, mit sichtbarer Einfügelinie. Tastaturalternative: Alt+↑/↓ auf einem Listeneintrag sowie die Menüeinträge „Nach oben/unten“.
- Ist die letzte Seite übrig, ist „Löschen“ deaktiviert.

## 6. Offene Fragen an Codex

1. Codeansicht: ganzes Dokument oder nur aktive Seite (3.4)?
2. Optionaler v1-Export für einseitige Dokumente (3.2)?
3. Schemaversion im P2P-Handshake (3.7)?
4. draw.io-Import: Ist „alle Seiten“ die neue Standardwahl oder bleibt die Einzelseitenauswahl Standard (3.5)?

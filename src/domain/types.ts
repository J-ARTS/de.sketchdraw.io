/** Shared architecture contract. Runtime validation is required at every input boundary. */
export type ElementKind =
  | 'rectangle' | 'ellipse' | 'diamond' | 'text' | 'path'
  | 'image' | 'connector' | 'container' | 'component';

export interface Point { x: number; y: number }

export type ConnectorRouting = 'straight' | 'elbowed' | 'curved';
export type ConnectorMarker =
  | 'none'
  | 'line-arrow'
  | 'solid-arrow'
  | 'triangle'
  | 'circle'
  | 'diamond';

export interface ElementStyle {
  stroke: string;
  fill: string;
  strokeWidth: number;
  opacity: number;
  fontSize: number;
  textAlign: 'left' | 'center' | 'right';
  strokeDash: 'solid' | 'dashed' | 'dotted';
  fontFamily?: 'sans' | 'mono' | 'roboto' | 'scribbled';
}

export interface Endpoint {
  elementId: string;
  /** Normalized attachment position on the element's bounding rectangle. */
  anchor: Point;
}

export interface SketchElement {
  id: string;
  kind: ElementKind;
  /** Absolute document coordinates, including children of containers. */
  x: number;
  y: number;
  width: number;
  height: number;
  /** Clockwise degrees about the element center. Containers have rotation 0. */
  rotation: number;
  style: ElementStyle;
  /** Non-visual accessible name and description, preserved by every codec. */
  label?: string;
  description?: string;
  text?: string;
  /** Element-local points. Connectors always retain at least two points. */
  points?: Point[];
  /** Connector-only route and endpoint decoration. Missing values use the v1-compatible defaults. */
  connectorRouting?: ConnectorRouting;
  startMarker?: ConnectorMarker;
  endMarker?: ConnectorMarker;
  assetId?: string;
  from?: Endpoint;
  to?: Endpoint;
  parentId?: string;
  componentType?: string;
  metadata?: Record<string, string>;
  documentationUrl?: string;
}

export interface SketchAsset {
  id: string;
  mimeType: 'image/png' | 'image/jpeg' | 'image/webp';
  /** Embedded local bytes; remote URLs are not fetched implicitly. */
  dataUrl: string;
  name: string;
}

export interface ComponentDefinition {
  type: string;
  name: string;
  provider: 'aws' | 'azure' | 'gcp' | 'generic' | 'custom';
  category: string;
  aliases?: string[];
  defaultWidth: number;
  defaultHeight: number;
  style: Partial<ElementStyle>;
  metadata?: Record<string, string>;
  documentationUrl?: string;
  /** Sanitized vector symbol; no scripts, remote resources or event handlers. */
  iconSvg?: string;
  widgets?: Array<{
    key: string;
    label: string;
    kind: 'text' | 'number' | 'select';
    options?: string[];
  }>;
}

export interface ComponentSet {
  id: string;
  name: string;
  version: string;
  components: ComponentDefinition[];
}

export interface SketchDocument {
  schemaVersion: 1;
  id: string;
  title: string;
  /** Back-to-front stacking order. */
  elements: SketchElement[];
  assets: Record<string, SketchAsset>;
  componentSets: ComponentSet[];
  metadata: Record<string, string>;
}

/** null removes an optional field; undefined is never a wire-level deletion. */
export type ElementPatch = Partial<Pick<SketchElement, 'x' | 'y' | 'width' | 'height' | 'rotation'>> & {
  style?: Partial<ElementStyle>;
  label?: string | null;
  description?: string | null;
  text?: string | null;
  points?: Point[] | null;
  connectorRouting?: ConnectorRouting | null;
  startMarker?: ConnectorMarker | null;
  endMarker?: ConnectorMarker | null;
  assetId?: string | null;
  from?: Endpoint | null;
  to?: Endpoint | null;
  parentId?: string | null;
  componentType?: string | null;
  metadata?: Record<string, string | null> | null;
  documentationUrl?: string | null;
};

export type DocumentCommand =
  | { type: 'add'; elements: SketchElement[]; assets?: SketchAsset[] }
  | { type: 'update'; changes: Array<{ id: string; patch: ElementPatch }> }
  | { type: 'delete'; ids: string[] }
  | { type: 'reorder'; ids: string[] }
  | { type: 'rename'; title: string }
  | { type: 'set-component-sets'; sets: ComponentSet[] }
  | { type: 'set-metadata'; patch: Record<string, string | null> }
  | { type: 'batch'; commands: DocumentCommand[] }
  | { type: 'replace'; document: SketchDocument };

export interface ValidationIssue {
  path: string;
  code: string;
  message: string;
}

export interface CommandContext {
  actorId: string;
  expectedRevision: number;
  source: 'human' | 'code' | 'import' | 'agent' | 'peer';
}

export interface DocumentSession {
  document: SketchDocument;
  revision: number;
}

export interface HistoryAvailability {
  canUndo: boolean;
  canRedo: boolean;
  undoConflict?: string;
  redoConflict?: string;
}

export interface DocumentController {
  /** A detached or deeply frozen snapshot; callers cannot mutate controller state. */
  getSnapshot(): DocumentSession;
  dispatch(command: DocumentCommand, context: CommandContext): DocumentSession;
  undo(actorId: string): DocumentSession;
  redo(actorId: string): DocumentSession;
  getHistoryState(actorId: string): HistoryAvailability;
  subscribe(listener: (snapshot: DocumentSession) => void): () => void;
}

export interface CodeDraft {
  text: string;
  baseRevision: number;
  dirty: boolean;
  diagnostics: ParseDiagnostic[];
}

export interface ParseDiagnostic {
  code: string;
  line: number;
  column: number;
  endLine?: number;
  endColumn?: number;
  elementId?: string;
  issuePath?: string;
  message: string;
  severity: 'error' | 'warning';
}

export type ParseResult =
  | { ok: true; document: SketchDocument; diagnostics: ParseDiagnostic[] }
  | { ok: false; diagnostics: ParseDiagnostic[] };

export interface ConversionWarning {
  sourceId?: string;
  property?: string;
  message: string;
}

export interface ImportResult {
  document: SketchDocument;
  warnings: ConversionWarning[];
}

export interface FileReference {
  /** Opaque capability owned by Electron Main, never a renderer-provided path. */
  handleId: string;
  name: string;
  versionToken: string;
}

export type FileError = { status: 'error'; code: string; message: string };
export type OpenDocumentResult =
  | { status: 'opened'; text: string; file: FileReference }
  | { status: 'cancelled' }
  | FileError;
export type SaveDocumentRequest = { text: string; suggestedName: string } & (
  | { mode: 'save-as' }
  | { mode: 'save'; handleId: string; expectedVersionToken: string }
);
export type SaveDocumentResult =
  | { status: 'saved'; file: FileReference }
  | { status: 'download-initiated'; name: string }
  | { status: 'cancelled' }
  | { status: 'conflict'; message: string }
  | FileError;
export type ExportFileResult =
  | { status: 'exported'; name: string }
  | { status: 'download-initiated'; name: string }
  | { status: 'cancelled' }
  | FileError;

export interface DesktopBridge {
  readonly platform: 'electron' | 'browser';
  openDocument(): Promise<OpenDocumentResult>;
  saveDocument(request: SaveDocumentRequest): Promise<SaveDocumentResult>;
  exportFile(contents: string, suggestedName: string, format: 'svg' | 'drawio' | 'sketchdraw'): Promise<ExportFileResult>;
  openExternal(url: string): Promise<void>;
  onCloseRequested(listener: (requestId: string) => void): () => void;
  respondToClose(requestId: string, decision: 'close' | 'cancel'): Promise<void>;
  onMenuCommand(listener: (command: 'open' | 'save' | 'save-as' | 'undo' | 'redo') => void): () => void;
}

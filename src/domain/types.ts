/** Shared architecture contract. Runtime validation is required at every input boundary. */
export type ElementKind =
  | 'rectangle' | 'ellipse' | 'diamond' | 'text' | 'path'
  | 'image' | 'connector' | 'container' | 'component' | 'sticky-note' | 'annotation' | 'table' | 'web-embed' | 'frame';

export type AnnotationBlockType =
  | 'paragraph' | 'heading-1' | 'heading-2' | 'heading-3' | 'heading-4'
  | 'bullet' | 'numbered' | 'quote';

export interface AnnotationRun {
  text: string;
  bold?: true;
  italic?: true;
  underline?: true;
  /** Strict six-digit RGB value. */
  color?: string;
}

export interface AnnotationBlock {
  type: AnnotationBlockType;
  runs: AnnotationRun[];
}

/** Safe, versioned rich-text model. Raw HTML is never stored in a document. */
export interface AnnotationDocument {
  version: 1;
  blocks: AnnotationBlock[];
}

export interface TableCellStyle {
  fill: string;
  color: string;
  fontSize: number;
  fontFamily: 'sans' | 'mono' | 'roboto' | 'scribbled';
  fontWeight: 'normal' | 'bold';
  textDecoration: 'none' | 'line-through';
  listStyle: 'none' | 'bullet';
  textAlign: 'left' | 'center' | 'right';
}

export interface TableRow { id: string; height: number }
export interface TableColumn { id: string; width: number }
export interface TableCell {
  id: string;
  rowId: string;
  columnId: string;
  text: string;
  style: TableCellStyle;
}

/** Safe, versioned table model. Raw HTML and formulas are never stored. */
export interface TableDocument {
  version: 1;
  rows: TableRow[];
  columns: TableColumn[];
  cells: TableCell[];
}

export type ShapeVariant =
  | 'circle' | 'square' | 'diamond' | 'triangle' | 'triangle-down' | 'rounded'
  | 'chevron' | 'process' | 'document' | 'documents' | 'manual-input' | 'hexagon'
  | 'parallelogram' | 'parallelogram-reverse' | 'cylinder' | 'tube'
  | 'internal-storage' | 'trapezoid' | 'summing' | 'or' | 'off-page'
  | 'folder' | 'note' | 'pentagon' | 'loop-limit';

export interface Point { x: number; y: number }

export type ConnectorRouting = 'straight' | 'elbowed' | 'curved';
export type ConnectorMarker =
  | 'none'
  | 'line-arrow'
  | 'solid-arrow'
  | 'triangle'
  | 'reverse-triangle'
  | 'circle'
  | 'diamond'
  | 'exactly-one'
  | 'many'
  | 'zero-or-one'
  | 'zero-or-many'
  | 'one-or-many';

export interface ElementStyle {
  stroke: string;
  fill: string;
  strokeWidth: number;
  opacity: number;
  fontSize: number;
  textAlign: 'left' | 'center' | 'right';
  strokeDash: 'solid' | 'dashed' | 'dotted';
  fontFamily?: 'sans' | 'mono' | 'roboto' | 'scribbled';
  fontWeight?: 'normal' | 'bold';
  textDecoration?: 'none' | 'line-through';
  listStyle?: 'none' | 'bullet';
  /** Corner radius in document units for rounded rectangles; missing keeps the default (one sixth of the shorter side). */
  cornerRadius?: number;
}

export interface Endpoint {
  elementId: string;
  /** Normalized attachment position on the element's bounding rectangle. */
  anchor: Point;
}

export interface SketchElement {
  id: string;
  kind: ElementKind;
  /** Concrete visual form for geometric elements. Missing values retain the legacy kind shape. */
  shapeVariant?: ShapeVariant;
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
  /** Annotation-only structured content. `text` remains its derived plain-text fallback. */
  annotation?: AnnotationDocument;
  /** Table-only structured content. `text` remains its derived TSV fallback. */
  table?: TableDocument;
  /** Display name shown in the footer of sticky notes. */
  author?: string;
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
  /** Web-embed-only absolute HTTP(S) URL. Remote page content is never persisted. */
  embedUrl?: string;
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
  provider: 'aws' | 'azure' | 'gcp' | 'kubernetes' | 'generic' | 'custom';
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

/** A collaboration marker anchored to an element, a table cell, or a retained canvas point. */
export interface CommentTarget {
  elementId?: string;
  tableCellId?: string;
  /** Normalized element coordinates while elementId is present. */
  anchor: Point;
  /** Absolute document point retained when the original target is removed. */
  fallback: Point;
}

export interface CommentMessage {
  id: string;
  authorId: string;
  authorName: string;
  body: string;
  /** ISO 8601 timestamp supplied by the caller; domain commands never read the clock. */
  createdAt: string;
  editedAt?: string;
}

export interface CommentThread {
  id: string;
  target: CommentTarget;
  messages: CommentMessage[];
  resolved: boolean;
  createdAt: string;
  updatedAt: string;
}

export type TaskStatus = 'todo' | 'doing' | 'review' | 'done';
/** Kind of work; drives the card cover on the task board (#105). */
export type TaskType = 'feature' | 'bug' | 'design' | 'research' | 'docs' | 'ops';

export interface ExternalTaskReference {
  provider: 'jira';
  remoteId: string;
  key: string;
  url: string;
  remoteStatus: string;
  updatedAt: string;
}

export interface SketchTask {
  id: string;
  /** Present when the task originated from a Sketchdraw comment. */
  sourceThreadId?: string;
  /** Present when the task originated from a canvas element such as a sticky note. */
  sourceElementId?: string;
  title: string;
  description: string;
  status: TaskStatus;
  /** Deterministic ordering inside a board column. */
  rank: number;
  createdAt: string;
  updatedAt: string;
  /** Optional, safe remote reference. Credentials are never part of the document. */
  external?: ExternalTaskReference;
  /** Optional kind of work (#105). */
  type?: TaskType;
  /** Optional display name of the responsible person, 1–120 characters (#105). */
  assignee?: string;
  /** Optional calendar due date in YYYY-MM-DD (#105). */
  dueDate?: string;
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
  /** Optional on legacy v1 input; validation normalizes the field to an empty array. */
  commentThreads?: CommentThread[];
  /** Optional on legacy v1 input; validation normalizes the field to an empty array. */
  tasks?: SketchTask[];
}

/** null removes an optional field; undefined is never a wire-level deletion. */
export type ElementPatch = Partial<Pick<SketchElement, 'x' | 'y' | 'width' | 'height' | 'rotation'>> & {
  style?: Partial<ElementStyle>;
  label?: string | null;
  description?: string | null;
  text?: string | null;
  annotation?: AnnotationDocument | null;
  table?: TableDocument | null;
  author?: string | null;
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
  embedUrl?: string | null;
  shapeVariant?: ShapeVariant | null;
};

export type DocumentCommand =
  | { type: 'add'; elements: SketchElement[]; assets?: SketchAsset[] }
  | { type: 'update'; changes: Array<{ id: string; patch: ElementPatch }> }
  | { type: 'delete'; ids: string[] }
  | { type: 'reorder'; ids: string[] }
  | { type: 'rename'; title: string }
  | { type: 'set-component-sets'; sets: ComponentSet[] }
  | { type: 'set-metadata'; patch: Record<string, string | null> }
  | { type: 'set-comments'; threads: CommentThread[] }
  | { type: 'set-tasks'; tasks: SketchTask[] }
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
  /** Optional desktop-only capability. Browser builds intentionally omit it. */
  readonly plugins?: import('./plugins').PluginBridge;
}

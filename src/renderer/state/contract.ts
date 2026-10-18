/** Renderer-internal contract between the store (logic) and the Vue components (presentation). Types only. */
import type { InjectionKey } from 'vue';
import type { DocumentAuthority } from '@/session';
import type { CollaborationStatus, GuestSession } from '@/collaboration';
import type {
  DesktopBridge,
  DocumentController,
  DocumentSession,
  ElementKind,
  ElementPatch,
  ElementStyle,
  FileReference,
  HistoryAvailability,
  Point,
  SketchDocument,
  SketchElement,
  ShapeVariant,
  CodeDraft,
  ComponentSet,
  ConnectorMarker,
  ConnectorRouting,
} from '@/domain/types';

export type Tool =
  | 'select' | 'hand' | 'rectangle' | 'ellipse' | 'diamond'
  | 'connector' | 'path' | 'text' | 'sticky-note' | 'image' | 'container';

/** screen = doc * zoom + pan. Zoom is clamped to 0.1..4. Pan is in CSS pixels of the canvas element. */
export interface Viewport { panX: number; panY: number; zoom: number }
export interface Size { width: number; height: number }
export interface Rect { x: number; y: number; width: number; height: number }

/** Screen coordinates are CSS pixels relative to the top-left corner of the canvas element. */
export interface PointerInput {
  x: number; y: number; button: number;
  pointerType: 'mouse' | 'pen' | 'touch';
  shiftKey: boolean; altKey: boolean; metaOrCtrl: boolean;
  /** MouseEvent.detail (click count). */
  detail: number;
}
export interface WheelInput {
  x: number; y: number; deltaX: number; deltaY: number;
  deltaMode: number; ctrlKey: boolean; shiftKey: boolean;
}

export interface TextClipboard {
  writeText(value: string): Promise<void>;
  readText(): Promise<string>;
}
export interface KeyInput {
  key: string; code: string;
  shiftKey: boolean; altKey: boolean; ctrlKey: boolean; metaKey: boolean;
  repeat: boolean; isComposing: boolean;
  /** Chosen by the component from the event target: canvas, text editor, or anything else (toolbar, panels). */
  scope: 'canvas' | 'text' | 'other';
}

export type HandleId = 'nw' | 'n' | 'ne' | 'e' | 'se' | 's' | 'sw' | 'w' | 'rotate';

/** Frame of the current selection in document coordinates (centre + size, rotation in degrees). */
export interface SelectionFrame {
  cx: number; cy: number; width: number; height: number; rotation: number;
  /** Resize and rotation handles exist only for a single, non-container-locked selection. */
  single: boolean;
}
/** Handle positions are in SCREEN pixels so size and hit zone (>= 24 px) are independent of zoom. */
export interface HandleView { id: HandleId; x: number; y: number }

export interface SnapTarget { elementId: string; anchor: Point; screen: Point }

export interface TextEditSession {
  /** null while a new text element is being created (nothing exists in the document yet). */
  elementId: string | null;
  kind: ElementKind;
  box: Rect;
  rotation: number;
  /**
   * Draft style (#44). ElementStyle changes made while editing land here only; the document is untouched until
   * the text edit commits, where text and style changes are written in one update command.
   */
  style: ElementStyle;
  /** Style the session started with. Only keys differing from it are written on commit. */
  initialStyle: ElementStyle;
  initialText: string;
  draft: string;
  composing: boolean;
  /** Set when the document changed underneath the draft (target changed or deleted). The draft is kept. */
  conflict: string | null;
}

export type SaveStatus =
  | 'unsaved-new' | 'dirty' | 'saving' | 'saved' | 'handed-off' | 'error' | 'conflict';

export interface FileState {
  /** Converted import has no persisted native origin, even at revision zero. */
  requiresInitialSave?: boolean;
  handle: FileReference | null;
  /** Revision whose persistence was confirmed by a `saved` result. Never set by `download-initiated`. */
  savedRevision: number | null;
  /** Revision that was handed to a browser download. Not a persistence claim. */
  handedOffRevision: number | null;
  saving: boolean;
  lastError: string | null;
  conflict: boolean;
}

export type DialogState =
  | { kind: 'unsaved'; reason: 'new' | 'open' | 'close' | 'import' | 'join' | 'leave'; requestId?: string; busy: boolean; error: string | null }
  | { kind: 'save-conflict'; message: string }
  | { kind: 'help' };
export type DialogChoice = 'save' | 'discard' | 'cancel' | 'save-copy';

export interface Notice { id: number; kind: 'info' | 'error'; text: string }

export interface GestureConflict {
  message: string;
  /** True while every gesture target still exists; "retry" then deliberately overwrites the foreign change. */
  canRetry: boolean;
}

export interface CreateStoreOptions {
  /** Defaults to getDesktopBridge() from '@/platform'. Tests inject a fake bridge. */
  bridge?: DesktopBridge;
  /** Defaults to createController(createDocument('Unbenannt')). Tests inject a controller to simulate foreign actors. */
  controller?: DocumentController;
  /** Trusted composition injects the same authority used by MCP/peer adapters. */
  authority?: DocumentAuthority;
  authorityFactory?: (controller: DocumentController) => DocumentAuthority;
  actorId?: string;
  /** Display name placed in newly created sticky-note footers. */
  authorName?: string;
  /** Defaults to the browser/Electron system clipboard. Tests may inject a deterministic adapter. */
  clipboard?: TextClipboard;
  isMac?: boolean;
  initialTheme?: 'light' | 'dark';
}

/** Side of a selected shape from which a connected copy is created (#36). */
export type QuickDirection = 'top' | 'right' | 'bottom' | 'left';

/** Renderer view of one document page (docs/reviews/multi-page-proposal.md §4). */
export interface PageSummary { id: string; name: string; elementCount: number }

export interface ObjectListItem {
  id: string; depth: number; kind: ElementKind; name: string; selected: boolean; parentId: string | null;
}

/** Aggregated view of the selection for the properties panel. `mixed` lists fields whose values differ. */
export interface SelectionInfo {
  count: number;
  kinds: ElementKind[];
  singleId: string | null;
  values: {
    x?: number; y?: number; width?: number; height?: number; rotation?: number;
    stroke?: string; fill?: string; strokeWidth?: number; opacity?: number; fontSize?: number;
    textAlign?: ElementStyle['textAlign']; strokeDash?: ElementStyle['strokeDash'];
    fontFamily?: 'sans' | 'mono' | 'roboto' | 'scribbled'; label?: string; description?: string; text?: string;
    fontWeight?: ElementStyle['fontWeight']; textDecoration?: ElementStyle['textDecoration']; listStyle?: ElementStyle['listStyle']; author?: string;
    connectorFrom?: string; connectorTo?: string; connectorRouting?: ConnectorRouting;
    startMarker?: ConnectorMarker; endMarker?: ConnectorMarker; parentName?: string;
  };
  mixed: string[];
  canGroup: boolean; canUngroup: boolean; canConnect: boolean;
  canEditText: boolean; hasStroke: boolean; hasFill: boolean; hasText: boolean;
}

export interface WhiteboardState {
  document: SketchDocument;
  revision: number;
  /** Document elements in z-order with live gesture previews applied (connectors included). */
  displayElements: readonly SketchElement[];
  readonly hasElementPreview: boolean;
  /** In-progress element of a drawing gesture; not part of the document. */
  draftElement: SketchElement | null;
  selection: readonly string[];
  /** Element that owns keyboard focus inside the canvas (roving focus). */
  focusedId: string | null;
  tool: Tool;
  shapeVariant: ShapeVariant;
  viewport: Viewport;
  viewportSize: Size;
  marquee: Rect | null;
  frame: SelectionFrame | null;
  handles: readonly HandleView[];
  snapTarget: SnapTarget | null;
  /** Bound source and current valid target while a connector is being drawn. */
  connectorTargets: { fromId: string; toId: string | null } | null;
  cursor: string;
  textEdit: TextEditSession | null;
  gestureConflict: GestureConflict | null;
  history: HistoryAvailability;
  file: FileState;
  saveStatus: SaveStatus;
  saveStatusText: string;
  title: string;
  dialog: DialogState | null;
  notices: readonly Notice[];
  /** Polite live-region text. Updated per user-visible action, never per pointer move. */
  liveMessage: string;
  /** External (non-local) changes outside the visible area; no automatic pan. */
  offscreenChanges: number;
  selectionInfo: SelectionInfo;
  objectList: readonly ObjectListItem[];
  pages: readonly PageSummary[];
  activePageId: string;
  /** False while the document schema knows a single page only (#34); page mutations are unavailable then. */
  pagesEditable: boolean;
  objectsOpen: boolean;
  propertiesCollapsed: boolean;
  theme: 'light' | 'dark';
  bridgePlatform: 'electron' | 'browser';
  empty: boolean;
  propertyDraft: { patch: ElementPatch; baseRevision: number; ids: string[] } | null;
  transitioning: boolean;
  codeOpen: boolean;
  code: CodeDraft;
  catalogOpen: boolean;
  hasDraft: boolean;
  collaboration: CollaborationStatus | null;
  canWrite: boolean;
  pendingPeerWrite: { requestId: string } | null;
}

export interface WhiteboardStore {
  /** Trusted local composition only; never expose this capability through IPC. */
  getAuthority(): DocumentAuthority | null;
  subscribeAuthority(listener: (authority: DocumentAuthority | null) => void): () => void;
  readonly state: WhiteboardState;

  setTool(tool: Tool): void;
  setShapeTool(variant: ShapeVariant): void;
  setViewportSize(width: number, height: number): void;

  pointerDown(input: PointerInput): void;
  pointerMove(input: PointerInput): void;
  pointerUp(input: PointerInput): void;
  pointerCancel(): void;
  doubleClick(input: PointerInput): void;
  wheel(input: WheelInput): void;
  /** Returns true if the key was consumed (caller then calls preventDefault). */
  handleKeyDown(input: KeyInput): boolean;
  handleKeyUp(input: KeyInput): void;
  canvasFocusChanged(hasFocus: boolean): void;

  zoomBy(factor: number, anchor?: Point): void;
  zoomTo(zoom: number, anchor?: Point): void;
  panBy(dx: number, dy: number): void;
  fitAll(): void;
  fitSelection(): void;
  revealOffscreenChanges(): void;

  select(ids: string[], additive?: boolean): void;
  selectAll(): void;
  clearSelection(): void;
  focusElement(id: string): void;

  deleteSelection(): void;
  copySelection(): Promise<void>;
  pasteSelection(): Promise<void>;
  duplicateSelection(): void;
  nudge(dx: number, dy: number): void;
  endNudge(): void;
  reorder(op: 'front' | 'back' | 'forward' | 'backward'): void;
  groupSelection(): void;
  ungroupSelection(): void;
  connectSelection(): void;
  /** Creates a same-shaped copy next to the single selected shape and an arrow to it (#36). */
  quickConnect(direction: QuickDirection): void;
  /** Changes selected geometric elements in place; IDs and connector references stay stable (#39/#40). */
  replaceShape(variant: ShapeVariant): void;
  applyPatch(patch: ElementPatch): void;
  setPropertyDraft(patch: ElementPatch): void;
  setInputComposing(value: boolean): void;
  commitPropertyDraft(): Promise<boolean>;
  discardPropertyDraft(): void;
  setNumeric(field: 'x' | 'y' | 'width' | 'height' | 'rotation', value: number): void;
  setTitle(title: string): void;
  updateTitleDraft(title: string): void;

  startTextEdit(elementId?: string): void;
  setTextDraft(text: string): void;
  setComposing(composing: boolean): void;
  /** Returns false (and keeps the editor open) while composing. */
  commitTextEdit(): boolean;
  cancelTextEdit(): void;
  resolveTextConflict(choice: 'keep-mine' | 'use-current' | 'insert-new'): void;
  resolveGestureConflict(choice: 'retry' | 'discard'): void;

  insertImageFile(file: File, at?: Point): Promise<void>;

  undo(): void;
  redo(): void;

  joinGuestSession(guest: GuestSession): Promise<boolean>;
  leaveGuestSession(): Promise<boolean>;
  getGuestSession(): GuestSession | null;
  resolvePendingWrite(): Promise<void>;
  newDocument(): Promise<void>;
  openDocument(): Promise<void>;
  importDocument(document: SketchDocument): Promise<void>;
  prepareDocumentSnapshot(): Promise<DocumentSession | null>;
  save(): Promise<void>;
  saveAs(): Promise<void>;
  exportDocument(format: 'svg' | 'drawio' | 'sketchdraw'): Promise<void>;
  toggleCode(): void;
  setCodeDraft(text: string): void;
  applyCode(): Promise<boolean>;
  resetCodeDraft(): void;
  toggleCatalog(): void;
  insertComponent(set: ComponentSet, type: string): Promise<void>;
  importComponentSet(file: File): Promise<void>;
  whenIdle(): Promise<void>;
  needsCloseWarning(): boolean;
  resolveDialog(choice: DialogChoice): Promise<void>;
  openHelp(): void;
  closeDialog(): void;

  toggleObjects(open?: boolean): void;
  selectPage(id: string): void;
  addPage(): void;
  renamePage(id: string, name: string): void;
  duplicatePage(id: string): void;
  deletePage(id: string): void;
  movePage(id: string, toIndex: number): void;
  /** Writes the page content to the clipboard (format `sketchdraw.page`). */
  copyPage(id: string): Promise<void>;
  /** Reads `sketchdraw.page` content from the clipboard and inserts it as a new page. */
  pastePage(): Promise<void>;
  togglePropertiesCollapsed(collapsed?: boolean): void;
  setTheme(theme: 'light' | 'dark'): void;
  dismissNotice(id: number): void;
  openDocumentationLink(url: string): Promise<void>;
  dispose(): void;
}

export const WHITEBOARD_KEY: InjectionKey<WhiteboardStore> = Symbol('whiteboard-store');

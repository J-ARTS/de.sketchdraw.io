/** Renderer-internal contract between the store (logic) and the Vue components (presentation). Types only. */
import type { InjectionKey } from 'vue';
import type { LanguageCode, Preferences } from '../lib/preferences';
import type { DocumentAuthority } from '@/session';
import type { CollaborationStatus, GuestSession } from '@/collaboration';
import type { CursorPoint, PresenceSnapshot, ViewRect } from '@/collaboration/presence';
import type { SmartGuide } from '../lib/smart-guides';
import type { CrdtDocumentController } from '@/crdt';
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
  AnnotationDocument,
  TableCellStyle,
  CommentTarget,
  TaskStatus,
  TaskType,
} from '@/domain/types';
import type { ResourceCardField } from '@/catalog';
import type { ElementClipboardPayload } from './element-clipboard';
import type { ConfigureAtlassianPluginInput, ConfigureGitPluginInput, ConfluencePageSummary, GitCommitSummary, GitFileDiff, GitWorkbenchResult, GitWorkbenchSnapshot, PluginId, PluginSettingsSnapshot } from '@/domain/plugins';
import type { ConfluenceLiveStatus } from './confluence-live-sync';

export type Tool =
  | 'select' | 'hand' | 'rectangle' | 'ellipse' | 'diamond'
  | 'connector' | 'path' | 'eraser' | 'text' | 'sticky-note' | 'annotation' | 'table' | 'image' | 'container'
  | 'frame' | 'comment' | 'laser';

export type PencilPreset = 'fine' | 'pencil' | 'marker';

export interface TableSelection {
  elementId: string;
  cellIds: string[];
  mode: 'cell' | 'row' | 'column' | 'table';
  rowIndex: number;
  columnIndex: number;
}

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
  /**
   * Set where copy and paste arrive as clipboard events of the document (#174): the key press is then left alone, so the
   * event that follows it can carry the data.
   */
  clipboardEvents?: boolean;
}
/** The part of a clipboard event's DataTransfer the store writes to. */
export interface ClipboardSink { setData(format: string, value: string): void }
/** What a paste event offered: its plain text and the first image file, if any. */
export interface ClipboardContent { text: string; image: File | null }

export type HandleId =
  | 'nw' | 'n' | 'ne' | 'e' | 'se' | 's' | 'sw' | 'w' | 'rotate'
  | 'connector-endpoint:start' | 'connector-endpoint:end'
  | `connector-control:${number}`
  | 'connector-label'
  | `connector-segment:${number}`;

/** Frame of the current selection in document coordinates (centre + size, rotation in degrees). */
export interface SelectionFrame {
  cx: number; cy: number; width: number; height: number; rotation: number;
  /** Resize and rotation handles exist only for a single, non-container-locked selection. */
  single: boolean;
}
/** Handle positions are in SCREEN pixels so size and hit zone (>= 24 px) are independent of zoom. */
export interface HandleView {
  id: HandleId;
  /** Connector owning this handle; enables direct editing from hover previews. */
  elementId?: string;
  x: number;
  y: number;
  /** `connector-label` moves the connector's text along the connector (#195). */
  kind?: 'selection' | 'connector-endpoint' | 'connector-control' | 'connector-segment' | 'connector-label';
  /** Segment direction; the drag cursor moves on the perpendicular axis. */
  orientation?: 'horizontal' | 'vertical';
}

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
  /**
   * Present while one line of a resource card is edited on the canvas (#189): `box` is that line, the draft is
   * a single line, and the commit writes the card's name or description instead of a multi-line element text.
   */
  field?: ResourceCardField;
  /** A connector's new text is placed here, as a share of the connector's length (#195); written with the text. */
  labelPosition?: number;
  /** Sticky note author while editing; written together with the text on commit. */
  author?: string | null;
  initialAuthor?: string | null;
  /** Hyperlinks on parts of the text (plain text elements only); committed with the text. */
  links?: import('../lib/text-links').TextLink[];
  initialLinks?: import('../lib/text-links').TextLink[];
  /** Present only while editing an annotation shape. */
  initialAnnotation: AnnotationDocument | null;
  annotationDraft: AnnotationDocument | null;
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
  | { kind: 'unsaved'; reason: 'new' | 'open' | 'close' | 'import' | 'join' | 'leave' | 'room'; requestId?: string; busy: boolean; error: string | null }
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
  /** Where preferences (theme, canvas background, language) persist; defaults to localStorage. Tests may inject or disable. */
  preferences?: { load(): Preferences; save(value: Preferences): void } | null;
  /**
   * Timing and rendering of the automatic Confluence publication. `rasterize` turns the SVG of one diagram page into
   * PNG bytes and defaults to the window's own renderer; tests inject a deterministic one.
   */
  confluenceLive?: { debounceMs?: number; retryDelaysMs?: readonly number[]; failureHoldMs?: number; rasterize?: (svg: string, width: number, height: number) => Promise<Uint8Array> };
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
    stroke?: string; fill?: string; textColor?: string; strokeWidth?: number; opacity?: number; fontSize?: number;
    textAlign?: ElementStyle['textAlign']; strokeDash?: ElementStyle['strokeDash'];
    fontFamily?: 'sans' | 'mono' | 'roboto' | 'scribbled'; label?: string; description?: string; text?: string;
    fontWeight?: ElementStyle['fontWeight']; textDecoration?: ElementStyle['textDecoration']; listStyle?: ElementStyle['listStyle']; cornerRadius?: number; author?: string;
    connectorFrom?: string; connectorTo?: string; connectorRouting?: ConnectorRouting;
    startMarker?: ConnectorMarker; endMarker?: ConnectorMarker; parentName?: string;
  };
  mixed: string[];
  canGroup: boolean; canUngroup: boolean; canConnect: boolean;
  canEditText: boolean; hasStroke: boolean; hasFill: boolean; hasText: boolean;
}

/** The answer to a call of the Git dialog: the value, or the reason it could not be had, already in the language of the interface. */
export type GitAnswer<T> = { ok: true; value: T } | { ok: false; message: string };

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
  /** Line type and arrowhead for new connectors; also follows edits made to a selected connector. */
  connectorDefaults: { routing: ConnectorRouting; endMarker: ConnectorMarker };
  pencilPreset: PencilPreset;
  pencilColor: string;
  /** Pencil stroke width in CSS screen pixels while drawing; independent from the canvas zoom. */
  pencilSize: number;
  /** Pencil opacity as an integer percentage from 0 through 100. */
  pencilOpacity: number;
  /** Eraser hit radius in CSS screen pixels; independent from the canvas zoom. */
  eraserRadius: number;
  viewport: Viewport;
  viewportSize: Size;
  marquee: Rect | null;
  frame: SelectionFrame | null;
  handles: readonly HandleView[];
  hoveredHandleId: HandleId | null;
  hoveredConnectorId: string | null;
  /** Valid non-connector element currently offered as a connector docking target. */
  connectorHoverTargetId: string | null;
  /** Container that adopts the dragged elements when the pointer is released (#143). */
  dropTargetId: string | null;
  snapTarget: SnapTarget | null;
  /** Bound source and current valid target while a connector is being drawn. */
  connectorTargets: { fromId: string; toId: string | null } | null;
  cursor: string;
  textEdit: TextEditSession | null;
  tableSelection: TableSelection | null;
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
  /** Elements of the active page in stacking order (the canvas content). */
  readonly pageElements: readonly SketchElement[];
  workspaceView: 'canvas' | 'tasks';
  commentSidebarOpen: boolean;
  frameSidebarOpen: boolean;
  frameSlides: readonly SketchElement[];
  presenterOpen: boolean;
  presenterIndex: number;
  /** Presenter view: the presentation shows the speaker notes of the current slide next to it. */
  presenterNotes: boolean;
  activeCommentId: string | null;
  commentComposerTarget: CommentTarget | null;
  unreadCommentIds: readonly string[];
  currentActorId: string;
  /** False while the document schema knows a single page only (#34); page mutations are unavailable then. */
  pagesEditable: boolean;
  objectsOpen: boolean;
  propertiesCollapsed: boolean;
  theme: 'light' | 'dark';
  /** Preset id or `#rrggbb`; null = the theme's default canvas. */
  canvasBackground: string | null;
  /** Guides and snapping while elements are moved are switched on (a personal preference). */
  smartGuides: boolean;
  /** The lines to draw for the move in progress, in document coordinates; empty otherwise (#224). */
  guides: readonly SmartGuide[];
  language: LanguageCode;
  bridgePlatform: 'electron' | 'browser';
  empty: boolean;
  propertyDraft: { patch: ElementPatch; baseRevision: number; ids: string[] } | null;
  transitioning: boolean;
  codeOpen: boolean;
  /** The Mermaid code of a diagram is shown beside the canvas (#203, #206). */
  diagramCodeOpen: boolean;
  code: CodeDraft;
  catalogOpen: boolean;
  hasDraft: boolean;
  collaboration: CollaborationStatus | null;
  /** Set while this device is a guest of a session room (HyperDHT/relay or automatic). */
  roomGuest: { role: 'editor' | 'viewer'; connected: boolean } | null;
  /** Who is in the running session and where their pointers are; empty without a session (#222). */
  presence: PresenceSnapshot;
  /** A session this device hosts or takes part in is running; null without one (#223). */
  session: { hosting: boolean } | null;
  /** The participant whose view this device shows; null when it shows its own. */
  following: string | null;
  canWrite: boolean;
  pendingPeerWrite: { requestId: string } | null;
  pluginSettings: PluginSettingsSnapshot | null;
  pluginBusy: boolean;
  /** The Git dialog is open (#216). */
  gitOpen: boolean;
  confluencePages: readonly ConfluencePageSummary[];
  pendingExternalDocument: boolean;
  /** Progress of the automatic publication to the linked Confluence page (#210); the link itself is in `pluginSettings.confluenceLive`. */
  confluenceLive: ConfluenceLiveStatus;
}

export interface WhiteboardStore {
  /** Trusted local composition only; never expose this capability through IPC. */
  getAuthority(): DocumentAuthority | null;
  /** The actor under which this user's own changes are filed for undo; a local agent shares it (#176). */
  getLocalActorId(): string;
  getCrdtController(): CrdtDocumentController | null;
  subscribeAuthority(listener: (authority: DocumentAuthority | null) => void): () => void;
  readonly state: WhiteboardState;

  setTool(tool: Tool): void;
  setShapeTool(variant: ShapeVariant): void;
  setConnectorDefaults(patch: Partial<{ routing: ConnectorRouting; endMarker: ConnectorMarker }>): void;
  setPencilPreset(preset: PencilPreset): void;
  setPencilColor(color: string): void;
  setPencilSize(size: number): void;
  setPencilOpacity(opacity: number): void;
  setEraserRadius(radius: number): void;
  setViewportSize(width: number, height: number): void;

  pointerDown(input: PointerInput): void;
  pointerMove(input: PointerInput): void;
  pointerLeave(): void;
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
  /** Copy event: puts the selection into the event's clipboard data. False when there is nothing to copy (native copy proceeds). */
  copyToClipboardData(data: ClipboardSink): boolean;
  /** Paste event: Sketchdraw elements from its text, otherwise its image, at the pointer. */
  pasteClipboardData(content: ClipboardContent): Promise<void>;
  duplicateSelection(): void;
  /**
   * Saves the selection to the user's own component library (#188) under a derived name. Returns the id of the
   * new component, or null when nothing could be saved; the reason is shown as a notice.
   */
  saveSelectionAsComponent(): string | null;
  /**
   * Inserts a saved selection (an own component or a library template) as new elements on the active page, at the
   * canvas centre or centred on a screen-space point, as one undo step. `name` is announced to screen readers.
   */
  insertElements(payload: ElementClipboardPayload, screenAt?: Point, name?: string): Promise<boolean>;
  /** Adds a lane at the bottom of the BPMN pool of the selection; the pool grows by it (#196). */
  addBpmnLane(): Promise<void>;
  /** Adds a lifeline to the sequence diagram of the selection, right of the selected lifeline (#192, #199). */
  addSequenceLifeline(): Promise<void>;
  /** Adds a message, a reply or a call to oneself: directly below a selected message, else at the end (#199). */
  addSequenceMessage(kind?: 'sync' | 'async' | 'reply' | 'self'): Promise<void>;
  /** Turns the running numbers at the messages of the selection's sequence diagram on or off (#199). */
  toggleSequenceNumbers(): Promise<void>;
  /**
   * Makes the diagram `anchorId` belongs to show what its Mermaid code says, as one step (#200, #203, #206):
   * a sequence diagram or a process. Returns an element of the diagram as it is now, or null when nothing
   * was applied.
   */
  applyDiagramCode(code: string, anchorId: string): Promise<string | null>;
  /** Opens or closes the Mermaid code of a diagram beside the canvas (#203, #206). */
  toggleDiagramCode(open?: boolean): void;
  /** Inserts one of the user's own components at the canvas centre or, when supplied, centred on a screen-space point. */
  insertCustomComponent(id: string, screenAt?: Point): Promise<void>;
  nudge(dx: number, dy: number): void;
  endNudge(): void;
  reorder(op: 'front' | 'back' | 'forward' | 'backward'): void;
  /** Moves one element to a new position in the stacking order (object list drag and drop), one undo step. */
  moveObject(id: string, toIndex: number): Promise<boolean>;
  groupSelection(): void;
  ungroupSelection(): void;
  connectSelection(): void;
  /** Creates a same-shaped copy next to the single selected shape and an arrow to it (#36). */
  quickConnect(direction: QuickDirection): void;
  /** Connects the single selected shape from its `direction` side to an existing element, without a copy (#107). */
  /** Connects the selected shape to `targetId`; `near` picks the target's dock point closest to it, else the nearest side. */
  quickConnectTo(direction: QuickDirection, targetId: string, near?: Point): void;
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

  /** Edits an element's text on the canvas. A resource card needs `field`: its name or its description. */
  startTextEdit(elementId?: string, field?: ResourceCardField): void;
  setTextDraft(text: string): void;
  /** Changes a sticky note's author while its text is edited; committed with the text. */
  setTextAuthor(author: string | null): void;
  /** Links [start, end) of the edited text to `url`, or removes the link there when `url` is null. */
  setTextLink(start: number, end: number, url: string | null): boolean;
  setAnnotationDraft(document: AnnotationDocument, plainText: string): void;
  setComposing(composing: boolean): void;
  /** Returns false (and keeps the editor open) while composing. */
  commitTextEdit(): boolean;
  cancelTextEdit(): void;
  resolveTextConflict(choice: 'keep-mine' | 'use-current' | 'insert-new'): void;
  resolveGestureConflict(choice: 'retry' | 'discard'): void;

  selectTableCells(elementId: string, cellIds: string[], mode: TableSelection['mode'], rowIndex: number, columnIndex: number): void;
  setTableCellText(elementId: string, cellId: string, text: string): void;
  formatTableSelection(patch: Partial<TableCellStyle>): void;
  /** Merges the rectangle around the selected table cells into one cell (#197); the cells keep their content. */
  mergeTableCells(): void;
  /** Undoes every merge that holds one of the selected table cells. */
  unmergeTableCells(): void;
  changeTableStructure(action: 'row-before' | 'row-after' | 'column-before' | 'column-after' | 'row-duplicate' | 'column-duplicate' | 'row-delete' | 'column-delete' | 'row-up' | 'row-down' | 'column-left' | 'column-right'): void;

  startComment(elementId?: string, tableCellId?: string, at?: Point): void;
  cancelComment(): void;
  createComment(body: string): Promise<boolean>;
  /** `reveal: false` keeps the viewport (used when the pin was clicked on the canvas and is already visible). */
  openComment(threadId: string, options?: { reveal?: boolean }): void;
  closeCommentThread(): void;
  closeCommentSidebar(): void;
  addCommentReply(threadId: string, body: string): Promise<boolean>;
  editCommentMessage(threadId: string, messageId: string, body: string): Promise<boolean>;
  /** Deletes one of the actor's own messages; removing the last message of a thread removes the thread. */
  deleteCommentMessage(threadId: string, messageId: string): Promise<boolean>;
  setCommentResolved(threadId: string, resolved: boolean): Promise<boolean>;
  markCommentUnread(threadId: string): void;
  copyCommentLink(threadId: string): Promise<void>;
  deleteCommentThread(threadId: string): Promise<boolean>;
  createTaskFromComment(threadId: string): Promise<boolean>;
  createTaskFromStickyNote(elementId: string): Promise<boolean>;
  createTask(input: { title: string; description?: string; status?: TaskStatus; type?: TaskType; assignee?: string; dueDate?: string }): Promise<boolean>;
  /** `null` removes type, assignee or due date (#105). */
  updateTask(taskId: string, patch: { title?: string; description?: string; status?: TaskStatus; type?: TaskType | null; assignee?: string | null; dueDate?: string | null }): Promise<boolean>;
  /** Places a task at `index` of the `status` column and renumbers the affected columns (#106). */
  moveTask(taskId: string, status: TaskStatus, index: number): Promise<boolean>;
  deleteTask(taskId: string): Promise<boolean>;
  openTaskBoard(): void;
  showCanvas(): void;
  refreshPluginSettings(): Promise<void>;
  /** Switches the editor to another plugin profile. */
  selectPluginProfile(id: string): Promise<boolean>;
  /** Creates a profile (a copy of `copyFrom` when given) and switches to it. */
  createPluginProfile(name: string, copyFrom?: string): Promise<boolean>;
  renamePluginProfile(id: string, name: string): Promise<boolean>;
  deletePluginProfile(id: string): Promise<boolean>;
  setPluginInstalled(id: PluginId, installed: boolean): Promise<boolean>;
  configureGitPlugin(input: ConfigureGitPluginInput): Promise<boolean>;
  configureAtlassianPlugin(input: ConfigureAtlassianPluginInput): Promise<boolean>;
  testAtlassianPlugin(): Promise<boolean>;
  refreshGitStatus(): Promise<boolean>;
  syncGit(): Promise<boolean>;
  /** Opens or closes the Git dialog (#216). */
  toggleGit(open?: boolean): void;
  /** What the Git dialog shows of the repository of the open diagram. */
  gitWorkbench(): Promise<GitAnswer<GitWorkbenchSnapshot>>;
  /** The changes of one file, in the working tree or in `commit`. */
  gitDiff(path: string, commit?: string): Promise<GitAnswer<GitFileDiff>>;
  gitCommit(message: string, paths: string[], push: boolean): Promise<GitAnswer<GitWorkbenchResult>>;
  gitPush(): Promise<GitAnswer<GitWorkbenchResult>>;
  /** Fetches the remote branch and fast-forwards to it. */
  gitUpdate(): Promise<GitAnswer<GitWorkbenchResult>>;
  gitLog(documentOnly: boolean): Promise<GitAnswer<GitCommitSummary[]>>;
  /** Puts versioned files back to the last commit. */
  gitDiscard(paths: string[]): Promise<GitAnswer<GitWorkbenchResult>>;
  /** Gives the open diagram the content it had in `commit`; refused while the diagram has unsaved changes. */
  gitRestoreDocument(commit: string): Promise<GitAnswer<GitWorkbenchResult>>;
  /** Switches automatic commit, push and sync of the Git plugin. */
  setGitAutomation(input: { autoCommit: boolean; autoPush: boolean; autoPull: boolean }): Promise<GitAnswer<true>>;
  searchConfluencePages(query: string): Promise<void>;
  insertConfluencePage(pageId: string): Promise<boolean>;
  syncConfluenceElement(elementId: string): Promise<boolean>;
  refreshConfluenceElement(elementId: string): Promise<boolean>;
  /** Links the open local diagram to a Confluence page that is kept up to date automatically; `null` removes the link. */
  setConfluenceLiveLink(pageId: string | null): Promise<boolean>;
  /** Publishes the linked diagram now instead of after the next change. */
  syncConfluenceLive(): void;
  syncJiraTasks(options?: { announce?: boolean }): Promise<boolean>;
  acceptExternalDocument(): Promise<boolean>;

  toggleFrameSidebar(open?: boolean): void;
  focusFrame(id: string): void;
  renameFrame(id: string, name: string): void;
  moveFrame(id: string, toIndex: number): void;
  startPresentation(frameId?: string, withNotes?: boolean): void;
  /** Writes the speaker notes of a slide (stored in the frame's metadata, one undo step). */
  setSlideNotes(frameId: string, notes: string): void;
  setPresenterNotes(open: boolean): void;
  stopPresentation(): void;
  goToPresentation(index: number): void;

  insertImageFile(file: File, at?: Point): Promise<void>;

  undo(): void;
  redo(): void;

  joinGuestSession(guest: GuestSession): Promise<boolean>;
  leaveGuestSession(): Promise<boolean>;
  /** Replaces the open document by one fetched from a room host (asks about unsaved work first). Takes ownership of the controller. */
  adoptRoomDocument(controller: CrdtDocumentController, options?: { role: 'editor' | 'viewer'; access?: () => { role: 'editor' | 'viewer'; connected: boolean } }): Promise<boolean>;
  cancelRoomAdoption(controller: CrdtDocumentController): void;
  /** Marks the open document as a room guest (same document id: nothing is replaced). Blocks local writes and local agent access. */
  enterRoomGuest(role: 'editor' | 'viewer', connected?: boolean, access?: () => { role: 'editor' | 'viewer'; connected: boolean }): void;
  /** Transport connectivity; a lost connection keeps the guest marker and the write block. */
  setRoomConnected(connected: boolean): void;
  /** Explicit leave: the local copy stays and local authority is restored. */
  leaveRoomGuest(): void;
  getRoomGuest(): { role: 'editor' | 'viewer'; connected: boolean } | null;
  /** The session reports who is present; null when there is no session any more. */
  setPresence(presence: PresenceSnapshot | null): void;
  /**
   * Reports the own pointer on the canvas in document coordinates, null when it left the canvas. The session passes
   * it on to the other participants.
   */
  subscribePointer(listener: (point: CursorPoint | null) => void): () => void;
  /**
   * Reports the part of the drawing this device shows, at once and after every change. While this device follows
   * someone it has no view of its own to offer and reports null.
   */
  subscribeView(listener: (view: ViewRect | null) => void): () => void;
  /** The session component announces a running session and how to end it; null when it is over. */
  setSession(session: { hosting: boolean; end(): void | Promise<void> } | null): void;
  /** Ends the running session (host) or leaves it (guest). */
  endSession(): Promise<void>;
  /**
   * Shows what this participant sees and keeps doing so until the user navigates on their own, presses Escape or
   * the participant is gone; null stops. Only another participant that is connected can be followed.
   */
  followParticipant(id: string | null): void;
  /** Shows a message from outside the store, such as the end of a session; errors stay until they are closed. */
  announce(text: string, kind?: 'info' | 'error'): void;
  getGuestSession(): GuestSession | null;
  resolvePendingWrite(): Promise<void>;
  newDocument(): Promise<void>;
  openDocument(): Promise<void>;
  importDocument(document: SketchDocument): Promise<void>;
  prepareDocumentSnapshot(): Promise<DocumentSession | null>;
  save(): Promise<void>;
  saveAs(): Promise<void>;
  exportDocument(format: 'svg' | 'drawio' | 'mermaid' | 'sketchdraw'): Promise<void>;
  toggleCode(): void;
  setCodeDraft(text: string): void;
  applyCode(): Promise<boolean>;
  resetCodeDraft(): void;
  toggleCatalog(): void;
  setCatalogOpen(open: boolean): void;
  /** Inserts a component at the canvas centre or, when supplied, centred on a screen-space point. */
  insertComponent(set: ComponentSet, type: string, screenAt?: Point): Promise<void>;
  /**
   * Writes the resource card dialog's changes as one undo step. `iconSet` is the set of a newly picked icon; a set
   * the document does not have yet (a provider library) is added with the same command, so the icon can be drawn.
   */
  updateResourceCard(id: string, patch: ElementPatch, iconSet?: ComponentSet): Promise<boolean>;
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
  setCanvasBackground(value: string | null): void;
  /** Switches guides and snapping while moving on or off and remembers the choice on this device. */
  setSmartGuides(value: boolean): void;
  setLanguage(language: LanguageCode): void;
  dismissNotice(id: number): void;
  /** Pauses the automatic dismissal of a hint while it is hovered or focused. */
  holdNotice(id: number): void;
  /** Restarts the dismissal countdown of a hint; errors never leave on their own. */
  releaseNotice(id: number): void;
  openDocumentationLink(url: string): Promise<void>;
  dispose(): void;
}

export const WHITEBOARD_KEY: InjectionKey<WhiteboardStore> = Symbol('whiteboard-store');

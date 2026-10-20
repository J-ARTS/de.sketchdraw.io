import { reactive } from 'vue';
import {
  applyCommand, createDocument, createElement, deserializeDocument,
  areAnnotationDocumentsEqual, annotationPlainText, cloneAnnotationDocument, createAnnotationDocument,
  formatTableCells, insertTableRow, insertTableColumn, deleteTableRow, deleteTableColumn,
  duplicateTableRow, duplicateTableColumn, moveTableRow, moveTableColumn, setTableCellText as updateTableCellText,
  tablePlainText,
  connectorEndMarker, connectorRoutePoints, connectorRoutePointsForRouting, connectorRouting, connectorStartMarker,
  moveElbowedSegment, DOMAIN_LIMITS, serializeDocument,
  resolveAnchorWorldPoint, worldToElementLocalPoint,
  type ComponentSet, type DocumentCommand, type DocumentSession, type ElementPatch,
  type Point, type SketchDocument, type SketchElement, type ElementStyle, type AnnotationDocument, type TableCellStyle, type TableDocument,
  type ShapeVariant, type CommentTarget, type CommentThread, type CommentMessage, type SketchTask, effectiveShapeVariant, shapeBaseKind,
  parseWebEmbedUrl, webEmbedLabel,
  FRAME_ORDER_METADATA_KEY, frameOrderMetadata, nextFrameLabel, orderedFrames,
  annotationToConfluenceStorage, confluenceStorageToAnnotation,
  type ConfigureAtlassianPluginInput, type ConfigureGitPluginInput, type PluginExternalEvent,
} from '@/domain';
import {
  attachIndexedDbPersistence,
  createCrdtController,
  type CrdtDocumentController,
  type CrdtPersistenceHandle,
} from '@/crdt';
import { createDocumentAuthority, SessionAccessError, type ActorBinding, type DocumentAuthority, type TransitionBarrier, type WriteAction, type WriteIntent } from '@/session';
import type { GuestSession, CollaborationStatus } from '@/collaboration';
import { getDesktopBridge } from '@/platform';
import { formatDiagram, parseDiagram } from '@/codec';
import { instantiateComponent, isResourceCard, parseComponentSet, prepareComponentSetImport } from '@/catalog';
import type {
  CreateStoreOptions, DialogChoice, FileState, HandleId, HandleView, Rect,
  PencilPreset, SelectionInfo, Tool, WhiteboardState, WhiteboardStore,
} from './contract';
import { ACTOR_ID, DEFAULT_STYLE, defaultSizeFor, QUICK_CONNECT_KINDS, ROTATABLE_KINDS, STYLE_BY_KIND } from '../lib/constants';
import { bounds, center, endpointAt, hitElement, normalizedRect, rotatePoint, topSelected } from '../lib/geometry';
import { docToScreen, fitRect, screenToDoc, wheelToAction, zoomAround } from '../lib/viewport';
import { deriveSaveStatus, needsClosePrompt, suggestFileName } from '../lib/savestate';
import { describeElement, describeSelection } from '../lib/describe';
import { resolveShortcut } from '../lib/shortcuts';
import {
  activePageId, clonePage, documentWithPages, MAX_PAGE_NAME_LENGTH, MAX_PAGES, nextPageName,
  pageClipboardPayload, pageState, pageSummaries,
} from './pages';
import { anchorPoint, nearestSideAnchor, planQuickConnect, QUICK_SIDES, quickConnectCopy } from '../lib/quick-connect';
import { SWAPPABLE_KINDS } from '../lib/shapes';
import { elementClipboardPayload, parseElementClipboard, planElementPaste } from './element-clipboard';
import {
  clampEraserRadius, clampPencilOpacity, clampPencilSize,
  ERASER_RADIUS_DEFAULT, PENCIL_OPACITY_DEFAULT, PENCIL_SIZE_DEFAULT, pencilOption,
} from '../lib/drawing-tools';
import { normalizeHex } from '../lib/color';
import { LASER_CURSOR } from '../lib/laser-pointer';
import { COMMENT_CURSOR } from '../lib/comment-cursor';
import { isCanvasBackground, LANGUAGES, loadPreferences, savePreferences, type Preferences } from '../lib/preferences';
import { CONNECTOR_END_MARKER_OPTIONS, CONNECTOR_ROUTING_OPTIONS, loadConnectorDefaults, saveConnectorDefaults } from '../lib/connector-preferences';

import { setLocale, t, tm, tn } from '@/renderer/i18n';
type Gesture = {
  kind: 'draw' | 'erase' | 'move' | 'resize' | 'rotate' | 'connector-point' | 'pan' | 'marquee';
  start: Point; last: Point; screenStart: Point; base: DocumentSession;
  targets: SketchElement[]; handle?: HandleId; tool: Tool; points: Point[];
  preview: DocumentCommand | null; element: SketchElement | null;
  connectorFromId?: string;
  connectorPoints?: Point[];
  connectorPointIndex?: number;
  connectorSegmentIndex?: number;
  connectorStubLength?: number;
  pencilStrokeWidth?: number;
  pencilOpacity?: number;
  eraserRadius?: number;
};
const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;
const freshFile = (): FileState => ({ handle: null, savedRevision: null, handedOffRevision: null, saving: false, lastError: null, conflict: false });
const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
const uid = (prefix: string) => `${prefix}:${crypto.randomUUID()}`;

/** Owns presentation drafts. Canonical writes exclusively use the injected/shared session authority. */
export function createWhiteboardStore(options: CreateStoreOptions = {}): WhiteboardStore {
  const bridge = options.bridge ?? getDesktopBridge();
  const factory = options.authorityFactory ?? ((controller) => createDocumentAuthority({ controller }));
  let localCrdtController: CrdtDocumentController | null = null;
  let crdtPersistence: CrdtPersistenceHandle | null = null;
  function releaseLocalCrdt(): void {
    const persistence = crdtPersistence;
    const controller = localCrdtController;
    crdtPersistence = null;
    localCrdtController = null;
    if (persistence) void persistence.destroy().catch(() => undefined);
    controller?.destroy();
  }
  function managedController(document: SketchDocument, existing?: CrdtDocumentController): CrdtDocumentController {
    releaseLocalCrdt();
    const controller = existing ?? createCrdtController(document);
    localCrdtController = controller;
    if (typeof indexedDB !== 'undefined') {
      const persistence = attachIndexedDbPersistence(controller, `document:${document.id}`);
      crdtPersistence = persistence;
      void persistence.ready.catch(() => undefined);
    }
    return controller;
  }
  const preferenceStore = options.preferences === undefined
    ? { load: () => loadPreferences(), save: (value: Preferences) => { savePreferences(value); } }
    : options.preferences;
  const savedPreferences: Preferences = preferenceStore ? preferenceStore.load() : { theme: null, canvasBackground: null, language: 'de' };
  setLocale(savedPreferences.language);
  function persistPreferences(): void { preferenceStore?.save({ theme: state.theme, canvasBackground: state.canvasBackground, language: state.language }); }
  const initialController = options.controller ?? (options.authority ? null : managedController(createDocument('Unbenannt')));
  let authority: DocumentAuthority | null = options.authority ?? factory(initialController!);
  let guest: GuestSession | null = null;
  const activeSession = () => guest ?? authority!;
  const snapshotSource = () => activeSession().source;
  const lifecycle = () => activeSession().lifecycleGate;
  let unsubscribeStatus = () => {};
  let pendingGuest: GuestSession | null = null;
  /** A room's document, fetched from the host, waiting to replace the local one. */
  let pendingRoom: CrdtDocumentController | null = null;
  let transitionResult: ((success: boolean) => void) | null = null;
  let unknownWrite: { guest: GuestSession; intent: WriteIntent; recover: () => void } | null = null;
  let pendingExternalEvent: PluginExternalEvent | null = null;
  const actorId = options.actorId ?? ACTOR_ID;
  const authorNameOption = options.authorName?.trim();
  const localAuthor = (): string => authorNameOption || t('Lokaler Benutzer');
  let bindings: Record<'human' | 'code' | 'import', ActorBinding>;
  let unsubscribe = () => {};
  let disposed = false;
  const authorityListeners = new Set<(authority: DocumentAuthority | null) => void>();
  let gesture: Gesture | null = null;
  let failedGesture: Gesture | null = null;
  let textBase: SketchElement | null = null;
  let textRevision = 0;
  let draftGeneration = 0;
  let titleDraft = snapshotSource().getSnapshot().document.title;
  let codeBase = snapshotSource().getSnapshot().document;
  let barrier: TransitionBarrier | null = null;
  let pendingImport: SketchDocument | null = null;
  let lastWrite: Promise<void> = Promise.resolve();
  let pendingWrites = 0;
  let spaceHeld = false;
  let inputComposing = false;
  let nudge: { base: DocumentSession; ids: string[]; dx: number; dy: number } | null = null;
  let noticeId = 0;
  let localCommit = false;
  let lastPointerScreen: Point | null = null;
  let internalElementClipboard: string | null = null;
  let clipboardWrite: Promise<boolean> | null = null;
  let internalClipboardFallbackPending = false;
  const initial = snapshotSource().getSnapshot();
  const clipboard = options.clipboard ?? {
    writeText(value: string) {
      if (typeof navigator === 'undefined' || !navigator.clipboard) return Promise.reject(new Error('Clipboard unavailable.'));
      return navigator.clipboard.writeText(value);
    },
    readText() {
      if (typeof navigator === 'undefined' || !navigator.clipboard) return Promise.reject(new Error('Clipboard unavailable.'));
      return navigator.clipboard.readText();
    },
  };

  const selected = () => state.document.elements.filter((e) => state.selection.includes(e.id));
  const changedDraft = () => { draftGeneration += 1; state.draftVersion = draftGeneration; };
  const state = reactive({
    draftVersion: 0, collaboration: null as CollaborationStatus | null, pendingPeerWrite: null as WhiteboardState['pendingPeerWrite'],
    get canWrite() { return !this.collaboration || this.collaboration.state === 'ready' && this.collaboration.role === 'editor' && !this.pendingPeerWrite && !this.collaboration.pendingWrites && !this.collaboration.hasUnresolvedOutcome; },
    document: Object.freeze(initial.document), revision: initial.revision,
    selection: [] as string[], focusedId: null as string | null, tool: 'select' as Tool, shapeVariant: 'square' as ShapeVariant,
    connectorDefaults: loadConnectorDefaults(),
    pencilPreset: 'fine' as PencilPreset, pencilColor: DEFAULT_STYLE.stroke,
    pencilSize: PENCIL_SIZE_DEFAULT, pencilOpacity: PENCIL_OPACITY_DEFAULT, eraserRadius: ERASER_RADIUS_DEFAULT,
    viewport: { panX: 0, panY: 0, zoom: 1 }, viewportSize: { width: 1280, height: 800 },
    marquee: null as Rect | null, snapTarget: null,
    hoveredHandleId: null as HandleId | null, hoveredConnectorId: null as string | null,
    connectorHoverTargetId: null as string | null,
    connectorTargets: null as WhiteboardState['connectorTargets'],
    textEdit: null as WhiteboardState['textEdit'], tableSelection: null as WhiteboardState['tableSelection'], gestureConflict: null as WhiteboardState['gestureConflict'],
    file: freshFile(), dialog: null as WhiteboardState['dialog'], notices: [] as WhiteboardState['notices'],
    liveMessage: '', offscreenChanges: 0, objectsOpen: false, propertiesCollapsed: false,
    theme: options.initialTheme ?? savedPreferences.theme ?? 'light', canvasBackground: savedPreferences.canvasBackground, language: savedPreferences.language, bridgePlatform: bridge.platform,
    pluginSettings: null as WhiteboardState['pluginSettings'], pluginBusy: false,
    confluencePages: [] as WhiteboardState['confluencePages'], pendingExternalDocument: false,
    propertyDraft: null as WhiteboardState['propertyDraft'],
    transitioning: false, codeOpen: false, catalogOpen: false,
    code: { text: formatDiagram(initial.document), baseRevision: initial.revision, dirty: false, diagnostics: [] } as WhiteboardState['code'],
    previewCommand: null as DocumentCommand | null, drawing: null as SketchElement | null,
    get displayElements(): readonly SketchElement[] {
      if (!this.previewCommand) return this.document.elements;
      try { return applyCommand(this.document, this.previewCommand).elements; }
      catch { return this.document.elements; }
    },
    get draftElement() { return this.drawing; },
    get hasElementPreview() { return Boolean(this.previewCommand); },
    get title() { return this.document.title; },
    get empty() { return this.document.elements.length === 0; },
    get saveStatus() { const status = deriveSaveStatus(this.file, this.revision).status; return this.hasDraft && !['saving', 'error', 'conflict'].includes(status) ? 'dirty' : status; },
    get saveStatusText() { return this.hasDraft && !this.file.saving ? t('Offener Entwurf') : deriveSaveStatus(this.file, this.revision).text; },
    get hasDraft() { void this.draftVersion; return Boolean(this.propertyDraft) || Boolean(this.textEdit && (this.textEdit.draft !== this.textEdit.initialText || !areAnnotationDocumentsEqual(this.textEdit.annotationDraft ?? undefined, this.textEdit.initialAnnotation ?? undefined) || Object.keys(textStyleChanges(this.textEdit)).length > 0)) || this.code.dirty || titleDraft !== this.document.title || Boolean(this.drawing || this.previewCommand || this.gestureConflict); },
    get history() { void this.revision; try { return this.canWrite ? (guest?.source ?? bindings.human.source).getHistoryState() : { canUndo: false, canRedo: false }; } catch { return { canUndo: false, canRedo: false }; } },
    get cursor() {
      if (this.transitioning) return 'wait';
      if (this.tool === 'hand' || spaceHeld) return 'grab';
      if (this.tool === 'select' && this.hoveredHandleId) {
        const hovered = this.handles.find((handle) => handle.id === this.hoveredHandleId);
        if (hovered?.kind === 'connector-segment') return hovered.orientation === 'horizontal' ? 'ns-resize' : 'ew-resize';
        if (hovered?.kind === 'connector-endpoint') return 'crosshair';
        if (hovered?.kind === 'connector-control') return 'move';
      }
      return this.tool === 'select' ? 'default' : this.tool === 'text' ? 'text' : ['path', 'eraser'].includes(this.tool) ? 'none' : this.tool === 'laser' ? LASER_CURSOR : this.tool === 'comment' ? COMMENT_CURSOR : 'crosshair';
    },
    get frame(): WhiteboardState['frame'] {
      const elements = this.displayElements.filter((e) => this.selection.includes(e.id));
      const first = elements[0];
      if (!first) return null;
      if (elements.length === 1) return { cx: first.x + first.width / 2, cy: first.y + first.height / 2, width: first.width, height: first.height, rotation: first.rotation, single: true };
      const rect = bounds(elements)!;
      return { cx: rect.x + rect.width / 2, cy: rect.y + rect.height / 2, width: rect.width, height: rect.height, rotation: 0, single: false };
    },
    get handles(): WhiteboardState['handles'] {
      const frame = this.frame;
      const selectedElement = this.selection.length === 1
        ? this.displayElements.find((element) => element.id === this.selection[0])
        : undefined;
      const hoveredConnector = this.tool === 'select' && this.hoveredConnectorId !== selectedElement?.id
        ? this.displayElements.find((element) => element.id === this.hoveredConnectorId && element.kind === 'connector')
        : undefined;
      const element = selectedElement?.kind === 'connector' ? selectedElement : hoveredConnector;
      if (element?.kind === 'connector') {
        const route = connectorRoutePoints(element);
        const c = center(element);
        const screenPoint = (point: Point) => docToScreen(this.viewport, rotatePoint({ x: element.x + point.x, y: element.y + point.y }, c, element.rotation));
        const handles: HandleView[] = route.length >= 2 ? [
          { id: 'connector-endpoint:start', elementId: element.id, ...screenPoint(route[0]!), kind: 'connector-endpoint' },
          { id: 'connector-endpoint:end', elementId: element.id, ...screenPoint(route.at(-1)!), kind: 'connector-endpoint' },
        ] : [];
        const routing = connectorRouting(element);
        if (routing === 'elbowed') {
          for (let index = 0; index < route.length - 1; index += 1) {
            const start = route[index]!; const end = route[index + 1]!;
            const orientation = Math.abs(end.x - start.x) >= Math.abs(end.y - start.y) ? 'horizontal' : 'vertical';
            // Stubs next to an endpoint are too short to grab separately; their handle would sit on top of the endpoint's.
            const from = screenPoint(start); const to = screenPoint(end);
            if (Math.hypot(to.x - from.x, to.y - from.y) < MIN_SEGMENT_HANDLE_LENGTH) continue;
            handles.push({ id: `connector-segment:${index}`, elementId: element.id, ...screenPoint({ x: (start.x + end.x) / 2, y: (start.y + end.y) / 2 }), kind: 'connector-segment', orientation });
          }
        } else if (routing === 'curved') {
          route.slice(1, -1).forEach((point, index) => handles.push({ id: `connector-control:${index + 1}`, elementId: element.id, ...screenPoint(point), kind: 'connector-control' }));
        }
        return handles;
      }
      if (!frame?.single) return [];
      const c = { x: frame.cx, y: frame.cy };
      const positions: Array<[HandleId, number, number]> = [['nw', -1, -1], ['ne', 1, -1], ['se', 1, 1], ['sw', -1, 1]];
      const handles = positions.map(([id, x, y]) => ({ id, ...docToScreen(this.viewport, rotatePoint({ x: c.x + x * frame.width / 2, y: c.y + y * frame.height / 2 }, c, frame.rotation)) }));
      if (ROTATABLE_KINDS.has(selected()[0]!.kind)) handles.push({ id: 'rotate', ...docToScreen(this.viewport, rotatePoint({ x: c.x, y: c.y - frame.height / 2 - 28 / this.viewport.zoom }, c, frame.rotation)) });
      return handles;
    },
    get selectionInfo(): SelectionInfo {
      const elements = selected();
      const first = elements[0];
      const draft = this.propertyDraft && same(this.propertyDraft.ids, this.selection) ? this.propertyDraft.patch : null;
      // Compare the displayed values of every selected element. A shared draft
      // overrides the same fields for all of them without changing the document.
      const edit = this.textEdit;
      const editStyle = edit ? textStyleChanges(edit) : null;
      let tableMixed: string[] = [];
      const displayed = elements.map((element): SelectionInfo['values'] => {
        const withDraft = draft ? { ...element, ...draft, style: { ...element.style, ...draft.style } } : element;
        const e = editStyle && edit!.elementId === element.id ? { ...withDraft, style: { ...withDraft.style, ...editStyle } } : withDraft;
        return { ...e.style, textColor: e.style.textColor ?? e.style.stroke, x: e.x, y: e.y, width: e.width, height: e.height, rotation: e.rotation, label: e.label ?? undefined, description: e.description ?? undefined, text: e.text ?? undefined, author: e.author ?? undefined, connectorFrom: e.from?.elementId, connectorTo: e.to?.elementId,
          connectorRouting: e.kind === 'connector' ? connectorRouting({ connectorRouting: e.connectorRouting ?? undefined }) : undefined,
          startMarker: e.kind === 'connector' ? connectorStartMarker({ startMarker: e.startMarker ?? undefined }) : undefined,
          endMarker: e.kind === 'connector' ? connectorEndMarker({ endMarker: e.endMarker ?? undefined }) : undefined };
      });
      if (elements.length === 1 && first?.kind === 'table' && first.table) {
        const selectedCellIds = this.tableSelection?.elementId === first.id ? this.tableSelection.cellIds : [];
        const cells = selectedCellIds.length ? first.table.cells.filter((cell) => selectedCellIds.includes(cell.id)) : first.table.cells;
        const cell = cells[0];
        if (cell) {
          displayed[0] = { ...displayed[0], fill: cell.style.fill, textColor: cell.style.color, fontSize: cell.style.fontSize, fontFamily: cell.style.fontFamily, fontWeight: cell.style.fontWeight, textDecoration: cell.style.textDecoration, listStyle: cell.style.listStyle, textAlign: cell.style.textAlign };
          tableMixed = (Object.keys(cell.style) as Array<keyof TableCellStyle>).filter((key) => cells.slice(1).some((candidate) => !same(candidate.style[key], cell.style[key]))).map((key) => key === 'color' ? 'textColor' : key);
        }
      }
      const values = displayed[0] ?? { ...DEFAULT_STYLE, ...(edit && !edit.elementId ? edit.style : {}) };
      const others = displayed.slice(1);
      const mixed = [...new Set([...(Object.keys(values) as Array<keyof typeof values>).filter(key => others.some(value => !same(value[key], values[key]))), ...tableMixed])];
      return { count: elements.length, kinds: [...new Set(elements.map((e) => e.kind))], singleId: elements.length === 1 ? first!.id : null, values, mixed,
        canGroup: elements.length > 0 && elements.every((e) => e.kind !== 'frame'), canUngroup: elements.some((e) => e.kind === 'container'), canConnect: elements.length === 2,
        canEditText: elements.length === 1 && !['web-embed', 'frame'].includes(first?.kind ?? ''), hasStroke: true, hasFill: elements.some((e) => !['text', 'path', 'connector', 'image', 'frame'].includes(e.kind)), hasText: elements.some((e) => !['web-embed', 'frame'].includes(e.kind)) };
    },
    get pages() { return pageSummaries(this.document); },
    activePageId: activePageId(initial.document),
    workspaceView: 'canvas' as const,
    commentSidebarOpen: false,
    frameSidebarOpen: false,
    get frameSlides() { return orderedFrames(this.document); },
    presenterOpen: false,
    presenterIndex: 0,
    activeCommentId: null as string | null,
    commentComposerTarget: null as CommentTarget | null,
    unreadCommentIds: [] as string[],
    currentActorId: actorId,
    pagesEditable: true,
    get objectList(): WhiteboardState['objectList'] {
      const index = new Map(this.document.elements.map((e) => [e.id, e]));
      return this.document.elements.map((e) => {
        let depth = 0; let parent = e.parentId;
        while (parent && depth < 32) { depth++; parent = index.get(parent)?.parentId; }
        return { id: e.id, depth, kind: e.kind, name: describeElement(e, this.document), selected: this.selection.includes(e.id), parentId: e.parentId ?? null };
      });
    },
  }) as WhiteboardState & { draftVersion: number; previewCommand: DocumentCommand | null; drawing: SketchElement | null };

  /** Style keys the user changed during a text edit, relative to the style the session started with. */
  function textStyleChanges(edit: NonNullable<WhiteboardState['textEdit']>): Partial<ElementStyle> {
    const changes: Record<string, unknown> = {};
    for (const key of Object.keys(edit.style) as Array<keyof ElementStyle>) if (!same(edit.style[key], edit.initialStyle[key])) changes[key] = edit.style[key];
    return changes as Partial<ElementStyle>;
  }
  function notice(text: string, kind: 'info' | 'error' = 'info') {
    state.liveMessage = text;
    state.notices = [...state.notices.slice(-3), { id: ++noticeId, kind, text }];
  }
  function fail(error: unknown) { notice(error instanceof Error ? tm(error.message) : t('Die Aktion konnte nicht ausgeführt werden.'), 'error'); }
  function sync(snapshot: DocumentSession) {
    const before = state.document;
    state.document = Object.freeze(snapshot.document); state.revision = snapshot.revision;
    state.activePageId = activePageId(snapshot.document);
    state.selection = state.selection.filter((id) => snapshot.document.elements.some((e) => e.id === id));
    if (state.focusedId && !snapshot.document.elements.some((e) => e.id === state.focusedId)) state.focusedId = snapshot.document.elements[0]?.id ?? null;
    if (state.textEdit?.elementId) {
      const current = snapshot.document.elements.find((e) => e.id === state.textEdit!.elementId);
      if (!same(current, textBase)) state.textEdit.conflict = current ? t('Das Element wurde zwischenzeitlich geändert. Dein Text bleibt erhalten.') : t('Das Element wurde gelöscht. Dein Text bleibt erhalten.');
    }
    if (!state.code.dirty) { state.code.text = formatDiagram(snapshot.document); state.code.baseRevision = snapshot.revision; codeBase = snapshot.document; }
    if (titleDraft === before.title) titleDraft = snapshot.document.title;
    if (!localCommit && before !== snapshot.document) state.offscreenChanges += 1;
    if (!state.frameSlides.length) { state.presenterOpen = false; state.presenterIndex = 0; }
    else state.presenterIndex = Math.min(state.presenterIndex, state.frameSlides.length - 1);
  }
  function bind() {
    if (guest) {
      const current = guest; state.collaboration = current.getStatus();
      unsubscribe = current.source.subscribe(sync);
      unsubscribeStatus = current.subscribeStatus(status => { if (guest === current) state.collaboration = status; });
      return;
    }
    state.collaboration = null;
    bindings = Object.fromEntries((['human', 'code', 'import'] as const).map((source) => [source, authority!.bindActor({ actorId, source, grantId: `local:${source}`, grantGeneration: 0, guard: () => ({ allowed: true }) })])) as typeof bindings;
    unsubscribe = snapshotSource().subscribe(sync);
  }
  bind();

  function write(action: WriteAction, revision = state.revision, source: 'human' | 'code' | 'import' = 'human', recover: () => void = () => {}): Promise<boolean> {
    if (!state.canWrite) { notice(t('Die gemeinsame Sitzung ist gerade schreibgeschützt. Offene Entwürfe bleiben erhalten.'), 'error'); return Promise.resolve(false); }
    const owner = activeSession();
    const gateway = guest?.gateway ?? bindings[source].gateway;
    pendingWrites++;
    const result = lastWrite.then(async () => {
      if (disposed || activeSession() !== owner || !state.canWrite) return false;
      const requestId = gateway.nextRequestId();
      if (!requestId) { notice(t('Eine vorherige Änderung ist noch nicht geklärt.'), 'error'); return false; }
      localCommit = true;
      try {
        const intent = { requestId, expectedRevision: revision, action };
        const outcome = await gateway.submit(intent);
        if (activeSession() !== owner) return false;
        const waitingForMirror = guest === owner && (outcome.status === 'committed' || outcome.status === 'no-op') && state.revision < outcome.revision;
        if ((outcome.status === 'outcome-unknown' || waitingForMirror) && guest === owner) { unknownWrite = { guest, intent, recover }; state.pendingPeerWrite = { requestId }; }
        if (waitingForMirror) { notice(t('Der Gastgeber hat bestätigt. Die lokale Ansicht wird noch synchronisiert; dein Entwurf bleibt bis zur Prüfung erhalten.')); return false; }
        if (outcome.status === 'committed' || outcome.status === 'no-op') return true;
        notice(outcome.status === 'outcome-unknown' ? t('Die Änderung ist noch nicht bestätigt. Bitte vor dem Fortfahren klären.') : outcome.code === 'REVISION_CONFLICT' ? t('Das Dokument wurde währenddessen geändert. Deine Aktion wurde nicht übernommen.') : t('Die Änderung wurde abgewiesen ({code}).', { code: outcome.code }), 'error');
        return false;
      } catch (error) { fail(error); return false; }
      finally { localCommit = false; }
    });
    lastWrite = result.then(() => { if (activeSession() === owner) pendingWrites--; }, () => { if (activeSession() === owner) pendingWrites--; });
    return result;
  }
  function dispatch(command: DocumentCommand, revision = state.revision, source: 'human' | 'code' | 'import' = 'human', recover?: () => void) {
    return write({ kind: 'dispatch', command }, revision, source, recover);
  }
  function patch(patches: Array<{ id: string; patch: ElementPatch }>) { if (patches.length) void dispatch({ type: 'update', changes: patches }); }
  function deleteCommand(ids: readonly string[]): DocumentCommand {
    const removed = new Set(ids);
    const removesFrame = state.frameSlides.some((frame) => removed.has(frame.id));
    if (!removesFrame) return { type: 'delete', ids: [...ids] };
    const remaining = state.frameSlides.filter((frame) => !removed.has(frame.id)).map((frame) => frame.id);
    return { type: 'batch', commands: [
      { type: 'delete', ids: [...ids] },
      { type: 'set-metadata', patch: { [FRAME_ORDER_METADATA_KEY]: frameOrderMetadata(remaining) } },
    ] };
  }
  function hit(p: Point) { return [...state.document.elements].reverse().find((e) => hitElement(e, p, 7 / state.viewport.zoom)); }
  /** Segment handles are only shown on screen-space segments at least this long (px). */
  const MIN_SEGMENT_HANDLE_LENGTH = 48;
  function handleAt(point: Point): HandleView | undefined {
    if (state.tool !== 'select') return undefined;
    const hits = (handle: HandleView): boolean => {
      const dx = Math.abs(handle.x - point.x);
      const dy = Math.abs(handle.y - point.y);
      if (handle.kind === 'connector-segment') {
        return handle.orientation === 'horizontal' ? dx <= 24 && dy <= 14 : dx <= 14 && dy <= 24;
      }
      return Math.hypot(dx, dy) <= 14;
    };
    // Endpoints win over every other handle so a connector can always be re-attached.
    return state.handles.find((handle) => handle.kind === 'connector-endpoint' && hits(handle)) ?? [...state.handles].reverse().find(hits);
  }
  function extendEraseGesture(g: Gesture, point: Point): void {
    const ids = g.preview?.type === 'delete' ? [...g.preview.ids] : [];
    const erased = new Set(ids);
    const radius = g.eraserRadius ?? state.eraserRadius;
    const distance = Math.hypot(point.x - g.last.x, point.y - g.last.y);
    const steps = Math.max(1, Math.ceil(distance / (Math.max(4, radius / 2) / state.viewport.zoom)));
    for (let index = 0; index <= steps; index++) {
      const ratio = index / steps;
      const sample = {
        x: g.last.x + (point.x - g.last.x) * ratio,
        y: g.last.y + (point.y - g.last.y) * ratio,
      };
      const target = [...g.base.document.elements].reverse()
        .find((element) => hitElement(element, sample, radius / state.viewport.zoom));
      if (!target || erased.has(target.id)) continue;
      erased.add(target.id);
      ids.push(target.id);
      g.targets.push(clone(target));
    }
    g.preview = ids.length ? { type: 'delete', ids } : null;
    state.previewCommand = g.preview;
    g.last = point;
  }
  function currentCenter() { return screenToDoc(state.viewport, { x: state.viewportSize.width / 2, y: state.viewportSize.height / 2 }); }
  function commentTargetFor(element: SketchElement, tableCellId?: string, point?: Point): CommentTarget {
    let anchorPoint = point;
    if (tableCellId && element.kind === 'table' && element.table) {
      const cell = element.table.cells.find((entry) => entry.id === tableCellId);
      const rowIndex = cell ? element.table.rows.findIndex((row) => row.id === cell.rowId) : -1;
      const columnIndex = cell ? element.table.columns.findIndex((column) => column.id === cell.columnId) : -1;
      if (rowIndex >= 0 && columnIndex >= 0) {
        const totalWidth = element.table.columns.reduce((sum, column) => sum + column.width, 0);
        const totalHeight = element.table.rows.reduce((sum, row) => sum + row.height, 0);
        const x = (element.table.columns.slice(0, columnIndex).reduce((sum, column) => sum + column.width, 0) + element.table.columns[columnIndex]!.width / 2) / totalWidth;
        const y = (element.table.rows.slice(0, rowIndex).reduce((sum, row) => sum + row.height, 0) + element.table.rows[rowIndex]!.height / 2) / totalHeight;
        const anchor = { x, y };
        return { elementId: element.id, tableCellId, anchor, fallback: resolveAnchorWorldPoint(element, anchor) };
      }
    }
    anchorPoint ??= { x: element.x + element.width / 2, y: element.y + element.height / 2 };
    const local = worldToElementLocalPoint(element, anchorPoint);
    const anchor = {
      x: Math.max(0, Math.min(1, element.width ? local.x / element.width : 0.5)),
      y: Math.max(0, Math.min(1, element.height ? local.y / element.height : 0.5)),
    };
    return { elementId: element.id, ...(tableCellId ? { tableCellId } : {}), anchor, fallback: resolveAnchorWorldPoint(element, anchor) };
  }
  function setSelection(ids: string[], additive = false) {
    state.selection = [...new Set(additive ? [...state.selection, ...ids] : ids)].filter((id) => state.document.elements.some((e) => e.id === id));
    state.focusedId = state.selection.at(-1) ?? null;
    state.hoveredHandleId = null;
    if (!state.tableSelection || !state.selection.includes(state.tableSelection.elementId)) state.tableSelection = null;
    state.liveMessage = describeSelection(selected(), state.document);
  }
  function resetGesture() { gesture = null; state.previewCommand = null; state.drawing = null; state.marquee = null; state.connectorTargets = null; state.connectorHoverTargetId = null; changedDraft(); }
  function moveCommand(base: DocumentSession, ids: readonly string[], dx: number, dy: number): DocumentCommand {
    return { type: 'update', changes: topSelected(base.document.elements, ids).map((e) => ({ id: e.id, patch: { x: e.x + dx, y: e.y + dy } })) };
  }
  function connectorAnchor(element: SketchElement, point: Point): Point { return endpointAt(element, point); }
  function connectorGeometryPatch(element: SketchElement, points: readonly Point[]): ElementPatch {
    const minX = Math.min(...points.map((point) => point.x));
    const minY = Math.min(...points.map((point) => point.y));
    const maxX = Math.max(...points.map((point) => point.x));
    const maxY = Math.max(...points.map((point) => point.y));
    return {
      x: element.x + minX,
      y: element.y + minY,
      width: Math.max(1, maxX - minX),
      height: Math.max(1, maxY - minY),
      points: points.map((point) => ({ x: point.x - minX, y: point.y - minY })),
    };
  }
  async function finishGesture(g: Gesture): Promise<boolean> {
    const owner = activeSession();
    const command = g.element ? { type: 'add' as const, elements: [g.element] } : g.preview?.type === 'delete' ? deleteCommand(g.preview.ids) : g.preview;
    if (!command) return true;
    const unchanged = g.targets.every((e) => same(e, state.document.elements.find((current) => current.id === e.id)));
    if (!unchanged) {
      failedGesture = g;
      state.gestureConflict = { message: t('Ein betroffenes Element wurde während der Geste geändert. Die Vorschau bleibt erhalten.'), canRetry: g.targets.every((e) => state.document.elements.some((current) => current.id === e.id)) };
      return false;
    }
    const recover = () => { if (gesture === g || failedGesture === g) { if (g.element) { setSelection([g.element.id]); state.tool = 'select'; if (g.element.kind === 'frame') state.frameSidebarOpen = true; } resetGesture(); failedGesture = null; state.gestureConflict = null; } };
    const ok = await dispatch(command, state.revision, 'human', recover);
    if (owner !== activeSession()) return false;
    if (ok) {
      if (g.element) { setSelection([g.element.id]); state.tool = 'select'; if (g.element.kind === 'frame') state.frameSidebarOpen = true; }
      const editTextId = g.element && ['sticky-note', 'annotation'].includes(g.element.kind) ? g.element.id : null;
      resetGesture(); failedGesture = null; state.gestureConflict = null;
      if (editTextId) store.startTextEdit(editTextId);
    } else { failedGesture = g; state.gestureConflict = { message: t('Die Geste wurde nicht übernommen. Deine Vorschau bleibt erhalten.'), canRetry: unchanged }; }
    return ok;
  }
  function createDraw(g: Gesture, point: Point, shift: boolean): SketchElement | null {
    if (g.tool === 'select' || g.tool === 'hand' || g.tool === 'eraser' || g.tool === 'text' || g.tool === 'image' || g.tool === 'web-embed' || g.tool === 'comment' || g.tool === 'laser') return null;
    let end = point;
    if (shift && !['path', 'connector'].includes(g.tool)) {
      const side = Math.max(Math.abs(point.x - g.start.x), Math.abs(point.y - g.start.y));
      end = { x: g.start.x + Math.sign(point.x - g.start.x || 1) * side, y: g.start.y + Math.sign(point.y - g.start.y || 1) * side };
    }
    const points = g.tool === 'path' ? g.points : [g.start, end];
    const rect = g.tool === 'path' ? normalizedRect({ x: Math.min(...points.map((p) => p.x)), y: Math.min(...points.map((p) => p.y)) }, { x: Math.max(...points.map((p) => p.x)), y: Math.max(...points.map((p) => p.y)) }) : normalizedRect(g.start, end);
    const style: ElementStyle = { ...DEFAULT_STYLE, ...STYLE_BY_KIND[g.tool] };
    if (g.tool === 'path') {
      style.stroke = state.pencilColor;
      style.strokeWidth = g.pencilStrokeWidth ?? state.pencilSize / state.viewport.zoom;
      style.opacity = (g.pencilOpacity ?? state.pencilOpacity) / 100;
    }
    const value: Partial<SketchElement> = { ...rect, style, id: g.element?.id ?? uid(g.tool), ...(SWAPPABLE_KINDS.has(g.tool as SketchElement['kind']) ? { shapeVariant: state.shapeVariant } : {}) };
    if (g.tool === 'frame') value.label = g.element?.label ?? nextFrameLabel(state.document, t('Folie'));
    if (g.tool === 'sticky-note') value.author = localAuthor();
    if (g.tool === 'path' || g.tool === 'connector') value.points = points.map((p) => ({ x: p.x - rect.x, y: p.y - rect.y }));
    if (g.tool === 'connector') {
      value.connectorRouting = state.connectorDefaults.routing; value.endMarker = state.connectorDefaults.endMarker;
      const from = state.document.elements.find((element) => element.id === g.connectorFromId);
      const to = hit(end);
      const validTo = to && to.kind !== 'connector' && to.id !== from?.id ? to : null;
      state.connectorTargets = from ? { fromId: from.id, toId: validTo?.id ?? null } : null;
      if (from) value.from = { elementId: from.id, anchor: endpointAt(from, g.start) };
      if (validTo) value.to = { elementId: validTo.id, anchor: endpointAt(validTo, end) };
      if (from && validTo) {
        const ids = new Set([from.id, validTo.id]);
        g.targets = g.base.document.elements.filter((element) => ids.has(element.id)).map(clone);
      }
    }
    try { return createElement(g.tool, value); } catch { return null; }
  }

  async function applyText(): Promise<boolean> {
    const edit = state.textEdit;
    if (!edit) return true;
    if (edit.composing) { notice(t('Bitte die laufende Texteingabe zuerst abschließen.'), 'error'); return false; }
    if (edit.conflict) { notice(edit.conflict, 'error'); return false; }
    const styleChanges = textStyleChanges(edit);
    const annotationChanged = !areAnnotationDocumentsEqual(edit.annotationDraft ?? undefined, edit.initialAnnotation ?? undefined);
    const textChanged = edit.draft !== edit.initialText, styleChanged = Object.keys(styleChanges).length > 0;
    if ((!textChanged && !annotationChanged && !styleChanged) || (!edit.elementId && !edit.draft.trim())) { state.textEdit = null; changedDraft(); return true; }
    const id = edit.elementId ?? uid(edit.kind === 'annotation' ? 'annotation' : 'text');
    const contentPatch = edit.kind === 'annotation' && edit.annotationDraft
      ? { annotation: edit.annotationDraft, text: annotationPlainText(edit.annotationDraft) }
      : textChanged ? { text: edit.draft } : {};
    const command: DocumentCommand = edit.elementId
      ? { type: 'update', changes: [{ id, patch: { ...contentPatch, ...(styleChanged ? { style: styleChanges } : {}) } }] }
      : { type: 'add', elements: [createElement(edit.kind === 'annotation' ? 'annotation' : 'text', { id, ...edit.box, ...contentPatch, text: edit.draft, style: { ...edit.style } })] };
    const now = edit.elementId ? state.document.elements.find((e) => e.id === edit.elementId) : null;
    if (edit.elementId && !same(now, textBase)) { edit.conflict = t('Das Element wurde inzwischen geändert. Bitte den Textkonflikt lösen.'); return false; }
    const recover = () => { if (state.textEdit === edit) { state.textEdit = null; setSelection([id]); changedDraft(); } };
    const ok = await dispatch(command, state.revision === textRevision ? textRevision : state.revision, 'human', recover);
    if (ok) recover();
    return ok;
  }
  async function applyCode(): Promise<boolean> {
    if (!state.code.dirty) return true;
    const source = state.code.text;
    const result = parseDiagram(source, codeBase);
    state.code.diagnostics = result.diagnostics;
    if (!result.ok) { notice(t('Der Code enthält Fehler. Der Entwurf bleibt erhalten.'), 'error'); return false; }
    const recover = () => { if (state.code.text === source) { state.code.dirty = false; state.code.text = formatDiagram(state.document); state.code.baseRevision = state.revision; codeBase = state.document; changedDraft(); } };
    const ok = await dispatch({ type: 'replace', document: result.document }, state.code.baseRevision, 'code', recover);
    if (ok) recover();
    return ok;
  }
  async function applyPropertyDraft(): Promise<boolean> {
    const draft = state.propertyDraft;
    if (!draft) return true;
    const changes = draft.ids.map((id) => {
      const value = clone(draft.patch);
      const e = state.document.elements.find((element) => element.id === id);
      if (e?.points && (value.width !== undefined || value.height !== undefined)) value.points = e.points.map((p) => ({ x: value.width !== undefined && e.width ? p.x * value.width / e.width : p.x, y: value.height !== undefined && e.height ? p.y * value.height / e.height : p.y }));
      return { id, patch: value };
    });
    const recover = () => { if (state.propertyDraft === draft) { state.propertyDraft = null; changedDraft(); } };
    const ok = await dispatch({ type: 'update', changes }, draft.baseRevision, 'human', recover);
    if (ok) recover();
    return ok;
  }
  async function prepareDrafts(): Promise<boolean> {
    if (unknownWrite || guest?.getStatus().hasUnresolvedOutcome) { notice(t('Die ausstehende Peer-Änderung ist noch nicht bestätigt. Bitte ihren Ausgang prüfen oder nur den bestätigten Stand behalten.'), 'error'); return false; }
    if (inputComposing) { notice(t('Bitte die laufende Texteingabe zuerst abschließen.'), 'error'); return false; }
    if (nudge) store.endNudge();
    await lastWrite;
    if (titleDraft !== state.title) {
      const title = titleDraft.trim();
      if (!title) { notice(t('Bitte einen Dokumenttitel eingeben oder die Titeländerung verwerfen.'), 'error'); return false; }
      if (!await dispatch({ type: 'rename', title })) return false;
      titleDraft = title;
    }
    if (!await applyText()) return false;
    if (!await applyPropertyDraft()) return false;
    if (failedGesture) { notice(t('Bitte die ausstehende Zeichenänderung zuerst bestätigen oder verwerfen.'), 'error'); return false; }
    if (gesture && !await finishGesture(gesture)) return false;
    return applyCode();
  }
  async function saveFile(saveAs: boolean, frozen?: DocumentSession): Promise<boolean> {
    if (state.file.saving) return false;
    if (!frozen && !await prepareDrafts()) return false;
    const session = activeSession();
    const snapshot = frozen ?? snapshotSource().getSnapshot();
    state.file.saving = true; state.file.lastError = null; state.file.conflict = false;
    try {
      const base = { text: serializeDocument(snapshot.document), suggestedName: suggestFileName(snapshot.document.title) };
      const handle = state.file.handle;
      const result = await bridge.saveDocument(!saveAs && handle
        ? { ...base, mode: 'save', handleId: handle.handleId, expectedVersionToken: handle.versionToken }
        : { ...base, mode: 'save-as' });
      if (activeSession() !== session) return false;
      if (result.status === 'saved') { state.file.handle = result.file; state.file.savedRevision = snapshot.revision; if (state.pluginSettings?.git.enabled) void bridge.plugins?.watchDocument(result.file.handleId); notice(t('Gespeichert: {name}', { name: result.file.name })); return true; }
      if (result.status === 'download-initiated') { state.file.handedOffRevision = snapshot.revision; notice(t('Als Download übergeben: {name}', { name: result.name })); return true; }
      if (result.status === 'conflict') {
        state.file.conflict = true;
        if (!state.transitioning) state.dialog = { kind: 'save-conflict', message: t('Die Datei wurde außerhalb von Sketchdraw geändert. Deine Änderungen bleiben erhalten.') };
        return false;
      }
      if (result.status === 'error') { state.file.lastError = result.message; notice(t('Speichern fehlgeschlagen: {message}', { message: tm(result.message) }), 'error'); }
      return false;
    } catch (error) { state.file.lastError = error instanceof Error ? error.message : t('Speichern fehlgeschlagen'); fail(error); return false; }
    finally { if (activeSession() === session) state.file.saving = false; }
  }
  function settleTransition(success: boolean) { const resolve = transitionResult; transitionResult = null; pendingGuest = null; if (!success && pendingRoom) { pendingRoom.destroy(); } pendingRoom = null; resolve?.(success); }
  function releaseTransition() {
    if (barrier) lifecycle().cancelTransition(barrier.token);
    barrier = null; pendingImport = null; state.transitioning = false; settleTransition(false);
  }
  function install(document: SketchDocument, file = freshFile(), nextGuest: GuestSession | null = null, room: CrdtDocumentController | null = null) {
    unsubscribe(); unsubscribeStatus();
    const nextSnapshot = nextGuest?.source.getSnapshot();
    if (barrier) lifecycle().completeTransition(barrier.token);
    barrier = null; pendingImport = null;
    if (nextGuest) releaseLocalCrdt();
    guest = nextGuest; authority = nextGuest ? null : factory(managedController(document, room ?? undefined));
    if (room) pendingRoom = null;
    unknownWrite = null; state.pendingPeerWrite = null;
    bindings = {} as typeof bindings; pendingWrites = 0; lastWrite = Promise.resolve();
    state.document = Object.freeze(document); state.revision = nextSnapshot?.revision ?? 0; state.file = file;
    state.selection = []; state.focusedId = null; state.hoveredHandleId = null; state.hoveredConnectorId = null; state.connectorHoverTargetId = null; state.textEdit = null; state.gestureConflict = null; state.propertyDraft = null;
    state.presenterOpen = false; state.presenterIndex = 0; state.frameSidebarOpen = false;
    gesture = null; failedGesture = null; nudge = null; state.previewCommand = null; state.drawing = null;
    titleDraft = document.title; codeBase = document;
    state.code = { text: formatDiagram(document), baseRevision: state.revision, dirty: false, diagnostics: [] };
    state.offscreenChanges = 0; state.dialog = null; state.transitioning = false; changedDraft(); bind();
    for (const listener of authorityListeners) listener(authority);
    store.fitAll(); settleTransition(true);
  }
  async function continueTransition(reason: 'new' | 'open' | 'close' | 'import' | 'join' | 'leave' | 'room', requestId?: string) {
    const active = barrier;
    if (!active || !lifecycle().isCurrent(active, draftGeneration)) { releaseTransition(); state.dialog = null; notice(t('Der Stand hat sich geändert. Bitte die Aktion erneut starten.'), 'error'); if (reason === 'close' && requestId) await bridge.respondToClose(requestId, 'cancel').catch(fail); return; }
    try {
      if (reason === 'join') {
        if (!pendingGuest || pendingGuest.getStatus().state !== 'ready') throw new Error(t('Die Peer-Sitzung ist nicht mehr bereit.'));
        const next = pendingGuest; install(next.source.getSnapshot().document, { ...freshFile(), requiresInitialSave: true }, next); return;
      }
      if (reason === 'room') {
        const room = pendingRoom;
        if (!room) throw new Error(t('Das Dokument der Session ist nicht mehr verfügbar.'));
        install(room.getSnapshot().document, { ...freshFile(), requiresInitialSave: true }, null, room); notice(t('Session beigetreten. Das Dokument kommt vom Gastgeber; speichere eine Kopie, um es zu behalten.')); return;
      }
      if (reason === 'leave') { install(active.snapshot.document, { ...freshFile(), requiresInitialSave: true }); notice(t('Sitzung verlassen. Die lokale Kopie enthält nur den zuletzt bestätigten Stand.')); return; }
      if (reason === 'import') {
        if (!pendingImport) throw new Error(t('Die Importvorschau ist nicht mehr verfügbar.'));
        install(pendingImport, { ...freshFile(), requiresInitialSave: true }); notice(t('Importiert. Bitte als Sketchdraw-Datei speichern.')); return;
      }
      if (reason === 'new') { install(createDocument('Unbenannt')); return; }
      if (reason === 'open') {
        const result = await bridge.openDocument();
        if (!lifecycle().isCurrent(active, draftGeneration)) throw new Error(t('Der Stand hat sich während des Öffnens geändert.'));
        if (result.status === 'opened') { const document = deserializeDocument(result.text); install(document, { ...freshFile(), handle: result.file, savedRevision: 0 }); if (state.pluginSettings?.git.enabled) void bridge.plugins?.watchDocument(result.file.handleId); notice(t('Geöffnet: {name}', { name: result.file.name })); return; }
        if (result.status === 'error') throw new Error(result.message);
        releaseTransition(); state.dialog = null; return;
      }
      if (!requestId) throw new Error(t('Die Schließanfrage fehlt.'));
      await bridge.respondToClose(requestId, 'close');
      if (!lifecycle().isCurrent(active, draftGeneration)) throw new Error(t('Die Schließanfrage ist nicht mehr aktuell.'));
      lifecycle().completeTransition(active.token); state.dialog = null;
    } catch (error) {
      releaseTransition(); state.dialog = null; fail(error);
      if (reason === 'close' && requestId) await bridge.respondToClose(requestId, 'cancel').catch(() => {});
    }
  }
  async function requestTransition(reason: 'new' | 'open' | 'close' | 'import' | 'join' | 'leave' | 'room', requestId?: string) {
    if (state.transitioning) {
      if (reason === 'close' && requestId) {
        if (state.dialog?.kind === 'unsaved' && !state.dialog.busy) { state.dialog.reason = 'close'; pendingImport = null; settleTransition(false); state.dialog.requestId = requestId; }
        else await bridge.respondToClose(requestId, 'cancel').catch(fail);
      }
      return;
    }
    state.transitioning = true;
    try {
      barrier = await lifecycle().beginTransition(reason === 'close' ? 'close' : 'replace', draftGeneration);
      if (needsClosePrompt(state.file, state.revision, state.hasDraft) || pendingWrites > 0 || barrier.unresolvedRequestIds.length > 0 || unknownWrite) {
        state.dialog = { kind: 'unsaved', reason, requestId, busy: false, error: null };
      } else await continueTransition(reason, requestId);
    } catch (error) { releaseTransition(); fail(error); if (reason === 'close' && requestId) await bridge.respondToClose(requestId, 'cancel').catch(fail); }
  }

  function commitTable(element: SketchElement, table: TableDocument, announcement: string, resizeToContent = false): void {
    const oldColumnUnits = element.table?.columns.reduce((sum, column) => sum + column.width, 0) || element.width;
    const oldRowUnits = element.table?.rows.reduce((sum, row) => sum + row.height, 0) || element.height;
    const width = resizeToContent ? element.width * table.columns.reduce((sum, column) => sum + column.width, 0) / oldColumnUnits : element.width;
    const height = resizeToContent ? element.height * table.rows.reduce((sum, row) => sum + row.height, 0) / oldRowUnits : element.height;
    void dispatch({ type: 'update', changes: [{ id: element.id, patch: { table, text: tablePlainText(table), width, height } }] }).then((ok) => {
      if (ok) { setSelection([element.id]); state.liveMessage = announcement; }
    });
  }

  const store: WhiteboardStore = {
    state,
    getAuthority() { return authority; },
    getCrdtController() { return localCrdtController; },
    getGuestSession() { return guest; },
    async joinGuestSession(next) {
      if (state.transitioning || next === guest) return false;
      try { if (next.getStatus().state !== 'ready') return false; deserializeDocument(serializeDocument(next.source.getSnapshot().document)); }
      catch (error) { fail(error); return false; }
      pendingGuest = next;
      const result = new Promise<boolean>(resolve => { transitionResult = resolve; });
      void requestTransition('join'); return result;
    },
    async adoptRoomDocument(controller) {
      if (state.transitioning) return false;
      try { deserializeDocument(serializeDocument(controller.getSnapshot().document)); }
      catch (error) { fail(error); return false; }
      pendingRoom = controller;
      const result = new Promise<boolean>(resolve => { transitionResult = resolve; });
      void requestTransition('room'); return result;
    },
    async leaveGuestSession() {
      if (!guest || state.transitioning) return false;
      const result = new Promise<boolean>(resolve => { transitionResult = resolve; });
      void requestTransition('leave'); return result;
    },
    async resolvePendingWrite() {
      const pending = unknownWrite; if (!pending || state.transitioning) return;
      try {
        const outcome = await pending.guest.gateway.queryOutcome(pending.intent.requestId);
        if (unknownWrite !== pending || guest !== pending.guest) return;
        if (outcome.status === 'committed' || outcome.status === 'no-op') {
          if (state.revision < outcome.revision) { notice(t('Die bestätigte Änderung ist noch nicht in der lokalen Ansicht angekommen. Bitte nach der Synchronisation erneut prüfen.')); return; }
          // A receipt clears only its own retained draft; unrelated drafts survive.
          pending.recover();
          unknownWrite = null; state.pendingPeerWrite = null; notice(t('Die Änderung wurde beim Gastgeber bestätigt.'));
        } else if (outcome.status === 'rejected') { unknownWrite = null; state.pendingPeerWrite = null; notice(t('Die Änderung wurde abgewiesen ({code}). Der Entwurf bleibt erhalten.', { code: outcome.code }), 'error'); }
        else notice(t('Der Ausgang ist weiterhin unbekannt. Kein neuer Schreibversuch wurde gesendet.'), 'error');
      } catch (error) { fail(error); }
    },
    subscribeAuthority(listener) { authorityListeners.add(listener); return () => authorityListeners.delete(listener); },
    setTool(tool) {
      if ((!state.canWrite && !['select', 'hand', 'laser'].includes(tool)) || state.transitioning) return;
      if (state.textEdit) void applyText();
      state.tool = tool;
      state.hoveredHandleId = null;
      state.hoveredConnectorId = null;
      state.connectorHoverTargetId = null;
      state.workspaceView = 'canvas';
      if (tool === 'rectangle') state.shapeVariant = 'square';
      if (tool === 'ellipse') state.shapeVariant = 'circle';
      if (tool === 'diamond') state.shapeVariant = 'diamond';
      if (tool === 'frame') state.frameSidebarOpen = true;
      state.liveMessage = t('Werkzeug: {tool}', { tool });
    },
    setShapeTool(variant) {
      if (!state.canWrite || state.transitioning) return;
      if (state.textEdit) void applyText();
      state.shapeVariant = variant;
      state.tool = shapeBaseKind(variant);
      state.liveMessage = t('Formwerkzeug: {variant}', { variant });
    },
    setConnectorDefaults(patch) {
      const routing = patch.routing && CONNECTOR_ROUTING_OPTIONS.some((option) => option.value === patch.routing) ? patch.routing : state.connectorDefaults.routing;
      const endMarker = patch.endMarker && CONNECTOR_END_MARKER_OPTIONS.some((option) => option.value === patch.endMarker) ? patch.endMarker : state.connectorDefaults.endMarker;
      if (routing === state.connectorDefaults.routing && endMarker === state.connectorDefaults.endMarker) return;
      state.connectorDefaults = { routing, endMarker };
      saveConnectorDefaults(state.connectorDefaults);
    },
    setPencilPreset(preset) {
      if (!state.canWrite || state.transitioning || !(['fine', 'pencil', 'marker'] as PencilPreset[]).includes(preset)) return;
      state.pencilPreset = preset;
      state.pencilSize = pencilOption(preset).strokeWidth;
      state.pencilOpacity = Math.round(pencilOption(preset).opacity * 100);
      state.liveMessage = t('Stifttyp: {label}', { label: pencilOption(preset).label });
    },
    setPencilColor(color) {
      if (!state.canWrite || state.transitioning) return;
      const normalized = normalizeHex(color);
      if (!normalized) return;
      state.pencilColor = normalized;
      state.liveMessage = t('Stiftfarbe: {normalized}', { normalized });
    },
    setPencilSize(size) {
      if (!state.canWrite || state.transitioning || !Number.isFinite(size)) return;
      state.pencilSize = clampPencilSize(size);
      state.liveMessage = t('Pinselgröße: {pencilSize} Pixel', { pencilSize: state.pencilSize });
    },
    setPencilOpacity(opacity) {
      if (!state.canWrite || state.transitioning || !Number.isFinite(opacity)) return;
      state.pencilOpacity = clampPencilOpacity(opacity);
      state.liveMessage = t('Stift-Deckkraft: {pencilOpacity} Prozent', { pencilOpacity: state.pencilOpacity });
    },
    setEraserRadius(radius) {
      if (!state.canWrite || state.transitioning || !Number.isFinite(radius)) return;
      state.eraserRadius = clampEraserRadius(radius);
      state.liveMessage = t('Radierer-Radius: {eraserRadius} Pixel', { eraserRadius: state.eraserRadius });
    },
    async addWebEmbed(rawUrl) {
      if (!state.canWrite || state.transitioning) return false;
      const parsed = parseWebEmbedUrl(rawUrl);
      if (!parsed.ok) { notice(tm(parsed.message), 'error'); return false; }
      const width = Math.min(640, Math.max(320, state.viewportSize.width / state.viewport.zoom - 96));
      const height = Math.min(400, Math.max(220, state.viewportSize.height / state.viewport.zoom - 160));
      const centre = screenToDoc(state.viewport, { x: state.viewportSize.width / 2, y: state.viewportSize.height / 2 });
      const element = createElement('web-embed', {
        id: uid('web-embed'),
        x: centre.x - width / 2,
        y: centre.y - height / 2,
        width,
        height,
        embedUrl: parsed.url,
        label: webEmbedLabel(parsed.url),
      });
      const ok = await dispatch({ type: 'add', elements: [element] });
      if (ok) {
        setSelection([element.id]);
        state.tool = 'select';
        state.liveMessage = t('Web-Embed {label} hinzugefügt.', { label: element.label ?? '' });
      }
      return ok;
    },
    setViewportSize(width, height) { state.viewportSize = { width, height }; },
    pointerDown(input) {
      lastPointerScreen = { x: input.x, y: input.y };
      if (state.transitioning || state.dialog || state.gestureConflict || pendingWrites > 0) return;
      if (state.tool === 'laser') return;
      if (state.textEdit) { void applyText(); return; }
      const point = screenToDoc(state.viewport, input);
      const target = hit(point);
      if (state.tool === 'eraser') {
        if (input.button !== 0 || !state.canWrite) return;
        gesture = {
          kind: 'erase', start: point, last: point, screenStart: input,
          base: snapshotSource().getSnapshot(), targets: [], tool: state.tool,
          points: [point], preview: null, element: null, eraserRadius: state.eraserRadius,
        };
        extendEraseGesture(gesture, point);
        changedDraft();
        return;
      }
      if (state.tool === 'comment') {
        if (input.button !== 0) return;
        store.startComment(target?.id, undefined, point);
        return;
      }
      const handle = handleAt(input);
      state.hoveredHandleId = handle?.id ?? null;
      state.hoveredConnectorId = handle?.elementId
        ?? (target?.kind === 'connector' ? target.id : null);
      if (handle?.elementId && !state.selection.includes(handle.elementId)) setSelection([handle.elementId]);
      let kind: Gesture['kind'] = state.tool === 'hand' || spaceHeld || input.button === 1 ? 'pan' : handle ? handle.id === 'rotate' ? 'rotate' : handle.id.startsWith('connector-') ? 'connector-point' : 'resize' : state.tool === 'select' ? target ? 'move' : 'marquee' : 'draw';
      if (!state.canWrite && kind !== 'pan' && kind !== 'marquee') { if (target) setSelection([target.id], input.shiftKey); return; }
      if (input.button !== 0 && input.button !== 1) return;
      if (state.tool === 'text' && kind === 'draw') { store.startTextEdit(); if ((state.textEdit as WhiteboardState['textEdit'])) (state.textEdit as unknown as NonNullable<WhiteboardState['textEdit']>).box = { x: point.x, y: point.y, width: 240, height: 48 }; return; }
      if (state.tool === 'image') return;
      if (kind === 'move' && target) {
        if (input.shiftKey && state.selection.includes(target.id)) { setSelection(state.selection.filter((id) => id !== target.id)); return; }
        if (!state.selection.includes(target.id)) setSelection([target.id], input.shiftKey);
      }
      if (kind === 'marquee' && !input.shiftKey) setSelection([]);
      // A connector may start anywhere: on an element it docks there, on empty canvas (or on another connector) it is free.
      const dockStart = state.tool === 'connector' && target && target.kind !== 'connector' ? target : null;
      const targets = state.tool === 'connector' && target && !(kind === 'draw' && target.kind === 'connector') ? [clone(target)] : selected().map(clone);
      let connectorPoints: Point[] | undefined;
      let connectorPointIndex: number | undefined;
      let connectorSegmentIndex: number | undefined;
      if (kind === 'connector-point' && targets[0]?.kind === 'connector' && handle) {
        connectorPoints = connectorRoutePoints(targets[0]);
        if (handle.id === 'connector-endpoint:start') connectorPointIndex = 0;
        else if (handle.id === 'connector-endpoint:end') connectorPointIndex = connectorPoints.length - 1;
        else if (handle.id.startsWith('connector-control:')) connectorPointIndex = Number(handle.id.slice('connector-control:'.length));
        else if (handle.id.startsWith('connector-segment:')) connectorSegmentIndex = Number(handle.id.slice('connector-segment:'.length));
      }
      gesture = { kind, start: point, last: point, screenStart: input, base: snapshotSource().getSnapshot(), targets, handle: handle?.id, tool: state.tool, points: [point], preview: null, element: null,
        ...(state.tool === 'path' ? {
          pencilStrokeWidth: state.pencilSize / state.viewport.zoom,
          pencilOpacity: state.pencilOpacity,
        } : {}),
        ...(connectorPoints ? { connectorPoints, connectorPointIndex, connectorSegmentIndex, connectorStubLength: 24 / state.viewport.zoom } : {}),
        ...(dockStart ? { connectorFromId: dockStart.id } : {}) };
      if (dockStart) {
        state.connectorTargets = { fromId: dockStart.id, toId: null };
        state.connectorHoverTargetId = null;
      }
      changedDraft();
    },
    pointerMove(input) {
      lastPointerScreen = { x: input.x, y: input.y };
      const point = screenToDoc(state.viewport, input);
      const g = gesture;
      if (state.tool === 'connector') {
        const dockingTarget = hit(point);
        state.connectorHoverTargetId = dockingTarget?.kind !== 'connector' ? dockingTarget?.id ?? null : null;
      } else if (!g) state.connectorHoverTargetId = null;
      if (!g) {
        const hovered = handleAt(input);
        const hoveredElement = hit(point);
        state.hoveredConnectorId = hovered?.elementId
          ?? (hoveredElement?.kind === 'connector' ? hoveredElement.id : null);
        state.hoveredHandleId = hovered?.id ?? null;
        return;
      }
      if (state.transitioning || !state.canWrite && !['pan', 'marquee'].includes(g.kind)) return;
      const dx = point.x - g.start.x; const dy = point.y - g.start.y;
      if (g.kind === 'pan') { store.panBy(input.x - g.screenStart.x, input.y - g.screenStart.y); g.screenStart = input; return; }
      if (g.kind === 'erase') {
        extendEraseGesture(g, point);
      } else if (g.kind === 'marquee') {
        state.marquee = normalizedRect(g.start, point);
        const r = state.marquee;
        setSelection(state.document.elements.filter((e) => { const b = bounds([e])!; return b.x >= r.x && b.y >= r.y && b.x + b.width <= r.x + r.width && b.y + b.height <= r.y + r.height; }).map((e) => e.id));
      } else if (g.kind === 'move') {
        g.preview = moveCommand(g.base, g.targets.map((e) => e.id), dx, dy); state.previewCommand = g.preview;
      } else if (g.kind === 'draw') {
        if (g.tool === 'path' && Math.hypot(point.x - g.last.x, point.y - g.last.y) >= 1 / state.viewport.zoom && g.points.length < DOMAIN_LIMITS.MAX_POINTS_PER_ELEMENT) g.points.push(point);
        g.element = createDraw(g, point, input.shiftKey); state.drawing = g.element;
      } else if (g.kind === 'connector-point' && g.targets[0]?.kind === 'connector' && g.connectorPoints && (g.connectorPointIndex !== undefined || g.connectorSegmentIndex !== undefined)) {
        const element = g.targets[0];
        let route = g.connectorPoints.map((entry) => ({ ...entry }));
        const patch: ElementPatch = {};
        if (g.connectorSegmentIndex !== undefined) {
          const local = worldToElementLocalPoint(element, point);
          route = moveElbowedSegment(route, g.connectorSegmentIndex, local, g.connectorStubLength);
        } else {
          const index = g.connectorPointIndex!;
          if (index === 0 || index === route.length - 1) {
            const movingStart = index === 0;
            const endpoint = movingStart ? element.from : element.to;
            const opposite = movingStart ? element.to : element.from;
            const candidate = [...g.base.document.elements].reverse().find((entry) =>
              entry.id !== element.id && entry.kind !== 'connector' && entry.id !== opposite?.elementId
              && hitElement(entry, point, 10 / state.viewport.zoom));
            // Dropped on a shape: dock at its nearest of twelve points. Dropped on empty canvas: the end is free.
            // Over the opposite end's own shape (a self-connection) the end keeps its previous binding instead of detaching.
            const oppositeShape = opposite ? g.base.document.elements.find((entry) => entry.id === opposite.elementId) : undefined;
            const overOpposite = Boolean(oppositeShape && !candidate && hitElement(oppositeShape, point, 10 / state.viewport.zoom));
            const bound = candidate ?? (overOpposite && endpoint ? g.base.document.elements.find((entry) => entry.id === endpoint.elementId) : undefined);
            const anchor = bound ? connectorAnchor(bound, point) : undefined;
            const world = bound && anchor ? resolveAnchorWorldPoint(bound, anchor) : point;
            route[index] = worldToElementLocalPoint(element, world);
            let nextFrom = element.from;
            let nextTo = element.to;
            if (bound && anchor) {
              const binding = { elementId: bound.id, anchor };
              if (movingStart) { nextFrom = binding; patch.from = binding; }
              else { nextTo = binding; patch.to = binding; }
              if (!g.targets.some((target) => target.id === bound.id)) g.targets.push(clone(bound));
            } else if (endpoint) {
              if (movingStart) { nextFrom = undefined; patch.from = null; }
              else { nextTo = undefined; patch.to = null; }
            }
            const otherBound = opposite ? g.base.document.elements.find((entry) => entry.id === opposite.elementId) : undefined;
            if (otherBound && !g.targets.some((target) => target.id === otherBound.id)) g.targets.push(clone(otherBound));
            route = connectorRoutePointsForRouting({
              ...element,
              points: [{ ...route[0]! }, { ...route.at(-1)! }],
              from: nextFrom,
              to: nextTo,
            }, connectorRouting(element));
            state.connectorTargets = opposite
              ? { fromId: opposite.elementId, toId: candidate?.id ?? null }
              : candidate ? { fromId: candidate.id, toId: null } : null;
          } else {
            route[index] = worldToElementLocalPoint(element, point);
          }
        }
        Object.assign(patch, connectorGeometryPatch(element, route));
        g.preview = { type: 'update', changes: [{ id: element.id, patch }] };
        state.previewCommand = g.preview;
      } else if (g.targets[0]) {
        const el = g.targets[0]; const c = center(el);
        let value: ElementPatch;
        if (g.kind === 'rotate') {
          let angle = el.rotation + (Math.atan2(point.y - c.y, point.x - c.x) - Math.atan2(g.start.y - c.y, g.start.x - c.x)) * 180 / Math.PI;
          if (input.shiftKey) angle = Math.round(angle / 15) * 15;
          value = { rotation: angle };
        } else {
          const p = rotatePoint(point, c, -el.rotation);
          const left = g.handle?.includes('w') ? p.x : el.x;
          const top = g.handle?.includes('n') ? p.y : el.y;
          const right = g.handle?.includes('e') ? p.x : el.x + el.width;
          const bottom = g.handle?.includes('s') ? p.y : el.y + el.height;
          const rect = normalizedRect({ x: left, y: top }, { x: right, y: bottom });
          rect.width = Math.max(1, rect.width); rect.height = Math.max(1, rect.height);
          const rotatedCenter = rotatePoint(center(rect), c, el.rotation);
          value = { ...rect, x: rotatedCenter.x - rect.width / 2, y: rotatedCenter.y - rect.height / 2 };
          if (el.points) value.points = el.points.map((p) => ({ x: el.width ? p.x * rect.width / el.width : p.x, y: el.height ? p.y * rect.height / el.height : p.y }));
        }
        g.preview = { type: 'update', changes: [{ id: el.id, patch: value }] }; state.previewCommand = g.preview;
      }
      g.last = point; changedDraft();
    },
    pointerLeave() { if (!gesture) { state.hoveredHandleId = null; state.hoveredConnectorId = null; state.connectorHoverTargetId = null; } },
    pointerUp(input) {
      const g = gesture;
      if (!g || state.transitioning || !state.canWrite && !['pan', 'marquee'].includes(g.kind)) return;
      store.pointerMove(input);
      if (g.kind === 'draw' && !g.element && !['path', 'connector'].includes(g.tool)) {
        const size = defaultSizeFor(g.tool, state.shapeVariant);
        if (size) { g.element = createDraw(g, { x: g.start.x + size.width, y: g.start.y + size.height }, false); state.drawing = g.element; }
      }
      if (g.kind === 'pan' || g.kind === 'marquee' || (!g.preview && !g.element)) { resetGesture(); return; }
      if (g.kind === 'draw' && g.element && g.element.width + g.element.height < 4) { resetGesture(); return; }
      void finishGesture(g);
    },
    pointerCancel() { if (state.transitioning) return; state.hoveredHandleId = null; state.hoveredConnectorId = null; state.connectorHoverTargetId = null; resetGesture(); },
    doubleClick(input) {
      if (!state.canWrite || state.transitioning) return;
      const e = hit(screenToDoc(state.viewport, input));
      if (e?.kind === 'frame') { setSelection([e.id]); state.frameSidebarOpen = true; state.liveMessage = t('Frame in der Folienleiste zum Umbenennen ausgewählt.'); return; }
      if (e && e.kind !== 'table' && !isResourceCard(e)) store.startTextEdit(e.id);
    },
    wheel(input) { const action = wheelToAction(input); if (action.kind === 'zoom') store.zoomBy(action.factor, input); else store.panBy(action.dx, action.dy); },
    handleKeyDown(input) {
      if (state.transitioning || state.dialog || input.isComposing) return false;
      if (input.scope === 'canvas' && input.code === 'Space') { spaceHeld = true; return true; }
      const action = resolveShortcut(input, options.isMac ?? (typeof navigator !== 'undefined' && /Mac/.test(navigator.platform)));
      if (!action) return false;
      if (action.startsWith('tool.')) { store.setTool(action.slice(5) as Tool); return true; }
      const actions: Record<string, () => void> = {
        'file.open': () => { void store.openDocument(); }, 'file.save': () => { void store.save(); }, 'file.save-as': () => { void store.saveAs(); },
        'edit.undo': store.undo, 'edit.redo': store.redo, 'edit.select-all': store.selectAll,
        'edit.copy': () => { void store.copySelection(); }, 'edit.paste': () => { void store.pasteSelection(); }, 'edit.duplicate': store.duplicateSelection,
        'edit.group': store.groupSelection, 'edit.ungroup': store.ungroupSelection, 'edit.delete': store.deleteSelection, 'edit.text': () => { if (selected()[0]?.kind !== 'frame') store.startTextEdit(state.selection[0]); },
        'view.zoom-in': () => store.zoomBy(1.2), 'view.zoom-out': () => store.zoomBy(1 / 1.2), 'view.zoom-reset': () => store.zoomTo(1),
        'view.fit-all': store.fitAll, 'view.fit-selection': store.fitSelection, 'view.help': store.openHelp, 'view.objects': store.toggleObjects, 'view.present': () => store.startPresentation(),
        'text.commit': () => { store.commitTextEdit(); },
      };
      if (action === 'move.nudge' || action === 'move.nudge-large') {
        const d = input.shiftKey ? 10 : 1;
        const dx = input.key === 'ArrowLeft' ? -d : input.key === 'ArrowRight' ? d : 0;
        const dy = input.key === 'ArrowUp' ? -d : input.key === 'ArrowDown' ? d : 0;
        if (state.selection.length) store.nudge(dx, dy); else store.panBy(-dx * 20, -dy * 20);
      } else if (action.startsWith('select.')) {
        const index = state.document.elements.findIndex((e) => e.id === state.focusedId);
        const delta = action === 'select.previous' || input.key === 'ArrowLeft' || input.key === 'ArrowUp' ? -1 : 1;
        const e = state.document.elements[(index + delta + state.document.elements.length) % state.document.elements.length];
        if (e) store.focusElement(e.id);
      } else if (actions[action]) actions[action]!();
      else if (input.key === 'Escape') { if (state.textEdit) store.commitTextEdit(); else { resetGesture(); store.clearSelection(); state.tool = 'select'; } }
      else if (input.key === '?') store.openHelp();
      else return false;
      return true;
    },
    handleKeyUp(input) { if (input.code === 'Space') spaceHeld = false; if (input.key.startsWith('Arrow')) store.endNudge(); },
    canvasFocusChanged(hasFocus) { if (!hasFocus) { spaceHeld = false; store.endNudge(); } },
    zoomBy(factor, anchor) { store.zoomTo(state.viewport.zoom * factor, anchor); },
    zoomTo(zoom, anchor = { x: state.viewportSize.width / 2, y: state.viewportSize.height / 2 }) { state.viewport = zoomAround(state.viewport, zoom, anchor); },
    panBy(dx, dy) { state.viewport = { ...state.viewport, panX: state.viewport.panX + dx, panY: state.viewport.panY + dy }; },
    fitAll() { const box = bounds(state.document.elements); state.viewport = box ? fitRect(state.viewportSize, box, 100, 1) : { panX: 0, panY: 0, zoom: 1 }; },
    fitSelection() { const box = bounds(selected()); if (box) state.viewport = fitRect(state.viewportSize, box, 100, 2); },
    revealOffscreenChanges() { store.fitAll(); state.offscreenChanges = 0; },
    select: setSelection, selectAll() { setSelection(state.document.elements.map((e) => e.id)); }, clearSelection() { setSelection([]); },
    focusElement(id) { setSelection([id]); store.fitSelection(); },
    deleteSelection() { if (!state.transitioning && state.selection.length) void dispatch(deleteCommand(state.selection)); },
    async copySelection() {
      if (state.transitioning) return;
      const payload = elementClipboardPayload(state.document, state.selection);
      if (!payload) return;
      const text = JSON.stringify(payload);
      internalElementClipboard = text;
      internalClipboardFallbackPending = true;
      clipboardWrite = clipboard.writeText(text).then(() => true, () => false);
      const written = await clipboardWrite;
      if (written) internalClipboardFallbackPending = false;
      notice(written ? tn(payload.elements.length, '{count} Element kopiert.', '{count} Elemente kopiert.') : tn(payload.elements.length, '{count} Element intern kopiert.', '{count} Elemente intern kopiert.'));
    },
    async pasteSelection() {
      if (!state.canWrite || state.transitioning) return;
      const owner = activeSession();
      const revision = state.revision;
      const lastWriteSucceeded = clipboardWrite ? await clipboardWrite : null;
      let text: string | null = null;
      if (lastWriteSucceeded === false && internalClipboardFallbackPending) {
        text = internalElementClipboard;
        internalClipboardFallbackPending = false;
      }
      else {
        try { text = await clipboard.readText(); }
        catch { text = internalElementClipboard; }
      }
      if (owner !== activeSession() || state.transitioning || !state.canWrite) return;
      const payload = text ? parseElementClipboard(text) : null;
      if (!payload) { notice(t('Die Zwischenablage enthält keine Sketchdraw-Elemente.'), 'error'); return; }
      try {
        const at = lastPointerScreen ? screenToDoc(state.viewport, lastPointerScreen) : currentCenter();
        const plan = planElementPaste(payload, state.document, at, uid);
        if (await dispatch(plan.command, revision)) {
          setSelection(plan.selection);
          state.tool = 'select';
          state.liveMessage = tn(plan.selection.length, '{count} Element eingefügt.', '{count} Elemente eingefügt.');
        }
      } catch (error) { fail(error); }
    },
    duplicateSelection() {
      if (!state.canWrite || state.transitioning || !state.selection.length) return;
      const all = state.document.elements; const ids = new Set(state.selection);
      for (let pass = 0; pass < 32; pass++) for (const e of all) if (e.parentId && ids.has(e.parentId)) ids.add(e.id);
      const map = new Map([...ids].map((id) => [id, uid('copy')]));
      const copies = all.filter((e) => ids.has(e.id)).map((element) => {
        const e = clone(element); e.id = map.get(e.id)!; e.x += 24; e.y += 24;
        if (e.parentId && map.has(e.parentId)) e.parentId = map.get(e.parentId)!;
        if (e.from && map.has(e.from.elementId)) e.from.elementId = map.get(e.from.elementId)!;
        if (e.to && map.has(e.to.elementId)) e.to.elementId = map.get(e.to.elementId)!;
        return e;
      });
      void dispatch({ type: 'add', elements: copies }).then((ok) => { if (ok) setSelection(copies.map((e) => e.id)); });
    },
    nudge(dx, dy) {
      if (!state.canWrite || state.transitioning) return;
      nudge ??= { base: snapshotSource().getSnapshot(), ids: [...state.selection], dx: 0, dy: 0 };
      nudge.dx += dx; nudge.dy += dy;
      state.previewCommand = moveCommand(nudge.base, nudge.ids, nudge.dx, nudge.dy); changedDraft();
    },
    endNudge() {
      if (!nudge) return;
      const n = nudge; nudge = null;
      const targets = topSelected(n.base.document.elements, n.ids).map(clone);
      void finishGesture({ kind: 'move', start: { x: 0, y: 0 }, last: { x: n.dx, y: n.dy }, screenStart: { x: 0, y: 0 }, base: n.base, targets, tool: 'select', points: [], preview: moveCommand(n.base, n.ids, n.dx, n.dy), element: null });
    },
    reorder(op) {
      if (state.transitioning) return;
      const ids = state.document.elements.map((e) => e.id); const selection = new Set(state.selection);
      if (op === 'front' || op === 'back') ids.sort((a, b) => (Number(selection.has(a)) - Number(selection.has(b))) * (op === 'front' ? 1 : -1));
      else {
        const ordered = op === 'forward' ? [...ids.keys()].reverse() : [...ids.keys()];
        for (const i of ordered) { const next = i + (op === 'forward' ? 1 : -1); if (ids[next] && selection.has(ids[i]!) && !selection.has(ids[next]!)) [ids[i], ids[next]] = [ids[next]!, ids[i]!]; }
      }
      void dispatch({ type: 'reorder', ids });
    },
    groupSelection() {
      if (state.transitioning) return;
      const roots = topSelected(state.document.elements, state.selection); const box = bounds(roots);
      if (!box) return;
      const container = createElement('container', { id: uid('container'), x: box.x - 24, y: box.y - 40, width: box.width + 48, height: box.height + 64, text: 'Gruppe', style: { ...DEFAULT_STYLE, ...STYLE_BY_KIND.container } });
      void dispatch({ type: 'batch', commands: [{ type: 'add', elements: [container] }, { type: 'update', changes: roots.map((e) => ({ id: e.id, patch: { parentId: container.id } })) }, { type: 'reorder', ids: [container.id, ...state.document.elements.map((e) => e.id)] }] }).then((ok) => { if (ok) setSelection([container.id]); });
    },
    ungroupSelection() {
      if (state.transitioning) return;
      const containers = selected().filter((e) => e.kind === 'container'); if (!containers.length) return;
      const ids = new Set(containers.map((e) => e.id));
      const children = state.document.elements.filter((e) => e.parentId && ids.has(e.parentId));
      void dispatch({ type: 'batch', commands: [{ type: 'update', changes: children.map((e) => ({ id: e.id, patch: { parentId: null } })) }, { type: 'delete', ids: [...ids] }] }).then((ok) => { if (ok) setSelection(children.filter((e) => !ids.has(e.id)).map((e) => e.id)); });
    },
    connectSelection() {
      if (state.transitioning) return;
      const [a, b] = selected(); if (!a || !b || state.selection.length !== 2) return;
      const start = rotatePoint({ x: a.x + a.width, y: a.y + a.height / 2 }, center(a), a.rotation);
      const end = rotatePoint({ x: b.x, y: b.y + b.height / 2 }, center(b), b.rotation);
      const rect = normalizedRect(start, end);
      const e = createElement('connector', { ...rect, points: [start, end].map((p) => ({ x: p.x - rect.x, y: p.y - rect.y })), from: { elementId: a.id, anchor: { x: 1, y: .5 } }, to: { elementId: b.id, anchor: { x: 0, y: .5 } }, connectorRouting: state.connectorDefaults.routing, endMarker: state.connectorDefaults.endMarker, style: { ...DEFAULT_STYLE } });
      void dispatch({ type: 'add', elements: [e] }).then((ok) => { if (ok) setSelection([e.id]); });
    },
    replaceShape(variant) {
      if (!state.canWrite || state.transitioning) return;
      const targets = selected().filter((e) => SWAPPABLE_KINDS.has(e.kind) && effectiveShapeVariant(e) !== variant);
      if (!targets.length) return;
      void dispatch({ type: 'update', changes: targets.map((element) => ({ id: element.id, patch: { shapeVariant: variant } })) });
    },
    quickConnectTo(direction, targetId) {
      if (!state.canWrite || state.transitioning || state.selection.length !== 1) return;
      const source = selected()[0];
      const target = state.document.elements.find((element) => element.id === targetId);
      if (!source || !target || target.id === source.id || target.kind === 'connector' || !QUICK_CONNECT_KINDS.has(source.kind)) return;
      const fromAnchor = QUICK_SIDES[direction].from;
      const start = anchorPoint(source, fromAnchor);
      const toAnchor = nearestSideAnchor(target, start);
      const end = anchorPoint(target, toAnchor);
      try {
        const rect = normalizedRect(start, end);
        const arrow = createElement('connector', { id: uid('connector'), ...rect, points: [start, end].map((p) => ({ x: p.x - rect.x, y: p.y - rect.y })), from: { elementId: source.id, anchor: fromAnchor }, to: { elementId: target.id, anchor: toAnchor }, connectorRouting: state.connectorDefaults.routing, endMarker: state.connectorDefaults.endMarker, style: { ...DEFAULT_STYLE } });
        void dispatch({ type: 'add', elements: [arrow] }).then((ok) => { if (ok) state.liveMessage = 'Verbindung erstellt.'; });
      } catch (error) { fail(error); }
    },
    quickConnect(direction) {
      if (!state.canWrite || state.transitioning || state.selection.length !== 1) return;
      const source = selected()[0];
      if (!source || !QUICK_CONNECT_KINDS.has(source.kind)) return;
      const plan = planQuickConnect(source, direction, state.document.elements);
      try {
        const shape = createElement(source.kind, { id: uid(source.kind), ...quickConnectCopy(source, plan.shape) });
        const rect = normalizedRect(plan.start, plan.end);
        const arrow = createElement('connector', { id: uid('connector'), ...rect, points: [plan.start, plan.end].map((p) => ({ x: p.x - rect.x, y: p.y - rect.y })), from: { elementId: source.id, anchor: plan.fromAnchor }, to: { elementId: shape.id, anchor: plan.toAnchor }, connectorRouting: state.connectorDefaults.routing, endMarker: state.connectorDefaults.endMarker, style: { ...DEFAULT_STYLE } });
        void dispatch({ type: 'add', elements: [shape, arrow] }).then((ok) => { if (ok) setSelection([shape.id]); });
      } catch (error) { fail(error); }
    },
    setInputComposing(value) { inputComposing = value; changedDraft(); },
    setPropertyDraft(value) {
      if (state.textEdit) {
        // #44: while editing, style changes live only in the text draft and are committed together with the text.
        if (!state.canWrite || state.transitioning || !value.style) return;
        state.textEdit.style = { ...state.textEdit.style, ...value.style };
        changedDraft();
        return;
      }
      if (!state.canWrite || state.transitioning || !state.selection.length) return;
      const previous = state.propertyDraft;
      if (previous && !same(previous.ids, state.selection)) { notice(t('Bitte den offenen Eigenschaftenentwurf zuerst übernehmen oder verwerfen.'), 'error'); return; }
      state.propertyDraft = { baseRevision: previous?.baseRevision ?? state.revision, ids: [...state.selection], patch: { ...previous?.patch, ...value, ...((previous?.patch.style || value.style) ? { style: { ...previous?.patch.style, ...value.style } } : {}) } };
      changedDraft();
    },
    commitPropertyDraft() { return state.transitioning ? Promise.resolve(false) : applyPropertyDraft(); },
    discardPropertyDraft() { if (!state.transitioning && !unknownWrite) { state.propertyDraft = null; changedDraft(); } },
    applyPatch(value) {
      if (state.transitioning) return;
      // Changing the line type or arrowhead of a connector also sets it for connectors drawn from now on.
      if (selected().some((element) => element.kind === 'connector') && (value.connectorRouting || value.endMarker)) {
        store.setConnectorDefaults({ ...(value.connectorRouting ? { routing: value.connectorRouting } : {}), ...(value.endMarker ? { endMarker: value.endMarker } : {}) });
      }
      patch(selected().map((element) => {
        if (element.kind !== 'connector' || !value.connectorRouting || value.connectorRouting === connectorRouting(element)) {
          return { id: element.id, patch: value };
        }
        const route = connectorRoutePointsForRouting(element, value.connectorRouting);
        return { id: element.id, patch: { ...value, ...connectorGeometryPatch(element, route) } };
      }));
    },
    setNumeric(field, value) {
      if (!state.canWrite || state.transitioning || !Number.isFinite(value)) return;
      patch(topSelected(state.document.elements, state.selection).map((e) => {
        const patch: ElementPatch = { [field]: value };
        if (field === 'rotation' && e.kind === 'container') patch.rotation = 0;
        if ((field === 'width' || field === 'height') && e.points) patch.points = e.points.map((p) => ({ x: field === 'width' && e.width ? p.x * value / e.width : p.x, y: field === 'height' && e.height ? p.y * value / e.height : p.y }));
        return { id: e.id, patch };
      }));
    },
    setTitle(title) { if (state.canWrite && !state.transitioning && title.trim()) { titleDraft = title.trim(); changedDraft(); void dispatch({ type: 'rename', title: title.trim() }); } },
    updateTitleDraft(title) { if (state.canWrite && !state.transitioning && title !== titleDraft) { titleDraft = title; changedDraft(); } },
    startTextEdit(elementId) {
      if (!state.canWrite || state.transitioning || state.textEdit) return;
      const e = elementId ? state.document.elements.find((e) => e.id === elementId) : undefined;
      if (isResourceCard(e) || e?.kind === 'table') return;
      textBase = e ? clone(e) : null; textRevision = state.revision;
      const point = currentCenter();
      const annotation = e?.kind === 'annotation' ? cloneAnnotationDocument(e.annotation ?? createAnnotationDocument(e.text ?? '')) : null;
      state.textEdit = { elementId: e?.id ?? null, kind: e?.kind ?? 'text', box: e ? { x: e.x, y: e.y, width: Math.max(120, e.width), height: Math.max(48, e.height) } : { x: point.x, y: point.y, width: 240, height: 48 }, rotation: e?.rotation ?? 0, style: { ...(e?.style ?? DEFAULT_STYLE) }, initialStyle: { ...(e?.style ?? DEFAULT_STYLE) }, initialText: e?.text ?? '', draft: e?.text ?? '', initialAnnotation: annotation ? cloneAnnotationDocument(annotation) : null, annotationDraft: annotation, composing: false, conflict: null }; changedDraft();
    },
    setTextDraft(text) { if (state.canWrite && state.textEdit && !state.transitioning) { state.textEdit.draft = text; changedDraft(); } },
    setAnnotationDraft(document: AnnotationDocument, plainText: string) { if (state.canWrite && state.textEdit?.kind === 'annotation' && !state.transitioning) { state.textEdit.annotationDraft = cloneAnnotationDocument(document); state.textEdit.draft = plainText; changedDraft(); } },
    setComposing(composing) { if (state.textEdit) { state.textEdit.composing = composing; changedDraft(); } },
    commitTextEdit() { if (state.textEdit?.composing || state.transitioning) return false; void applyText(); return true; },
    cancelTextEdit() { if (!state.transitioning && !unknownWrite) { state.textEdit = null; changedDraft(); } },
    resolveTextConflict(choice) {
      const edit = state.textEdit; if (!edit || state.transitioning || unknownWrite) return;
      if (choice === 'use-current') { state.textEdit = null; changedDraft(); return; }
      if (choice === 'insert-new') { edit.elementId = null; if (edit.kind !== 'annotation') edit.kind = 'text'; textBase = null; }
      else { textBase = clone(state.document.elements.find((e) => e.id === edit.elementId) ?? null); if (!textBase) return; }
      edit.conflict = null; textRevision = state.revision; changedDraft(); void applyText();
    },
    resolveGestureConflict(choice) {
      if (state.transitioning || unknownWrite) return;
      if (choice === 'discard') { failedGesture = null; state.gestureConflict = null; resetGesture(); return; }
      if (failedGesture && state.gestureConflict?.canRetry) {
        failedGesture.targets = failedGesture.targets.map((e) => clone(state.document.elements.find((current) => current.id === e.id)!));
        void finishGesture(failedGesture);
      }
    },
    selectTableCells(elementId, cellIds, mode, rowIndex, columnIndex) {
      const element = state.document.elements.find((entry) => entry.id === elementId && entry.kind === 'table');
      if (!element?.table) return;
      setSelection([elementId]);
      state.tableSelection = { elementId, cellIds: cellIds.filter((id) => element.table!.cells.some((cell) => cell.id === id)), mode, rowIndex, columnIndex };
      state.liveMessage = mode === 'table' ? t('Gesamte Tabelle ausgewählt.') : tn(cellIds.length, '{count} Tabellenzelle ausgewählt.', '{count} Tabellenzellen ausgewählt.');
    },
    setTableCellText(elementId, cellId, text) {
      if (!state.canWrite || state.transitioning) return;
      const element = state.document.elements.find((entry) => entry.id === elementId && entry.kind === 'table');
      if (!element?.table || !element.table.cells.some((cell) => cell.id === cellId)) return;
      commitTable(element, updateTableCellText(element.table, cellId, text), 'Tabellenzelle aktualisiert.');
    },
    formatTableSelection(value: Partial<TableCellStyle>) {
      if (!state.canWrite || state.transitioning) return;
      const selection = state.tableSelection;
      const element = selection ? state.document.elements.find((entry) => entry.id === selection.elementId && entry.kind === 'table') : selected()[0];
      if (!element?.table || element.kind !== 'table') return;
      const ids = selection?.elementId === element.id ? selection.cellIds : [];
      commitTable(element, formatTableCells(element.table, ids, value), 'Tabellenformatierung aktualisiert.');
    },
    changeTableStructure(action) {
      if (!state.canWrite || state.transitioning) return;
      const selection = state.tableSelection;
      const element = selection ? state.document.elements.find((entry) => entry.id === selection.elementId && entry.kind === 'table') : selected()[0];
      if (!element?.table || element.kind !== 'table') return;
      const row = Math.max(0, selection?.rowIndex ?? 0); const column = Math.max(0, selection?.columnIndex ?? 0);
      let table = element.table;
      if (action === 'row-before') table = insertTableRow(table, row);
      else if (action === 'row-after') table = insertTableRow(table, row + 1);
      else if (action === 'column-before') table = insertTableColumn(table, column);
      else if (action === 'column-after') table = insertTableColumn(table, column + 1);
      else if (action === 'row-duplicate') table = duplicateTableRow(table, row);
      else if (action === 'column-duplicate') table = duplicateTableColumn(table, column);
      else if (action === 'row-delete') table = deleteTableRow(table, row);
      else if (action === 'column-delete') table = deleteTableColumn(table, column);
      else if (action === 'row-up') table = moveTableRow(table, row, -1);
      else if (action === 'row-down') table = moveTableRow(table, row, 1);
      else if (action === 'column-left') table = moveTableColumn(table, column, -1);
      else if (action === 'column-right') table = moveTableColumn(table, column, 1);
      commitTable(element, table, 'Tabellenstruktur aktualisiert.', true);
    },
    startComment(elementId, tableCellId, at) {
      if (!state.canWrite || state.transitioning) return;
      const element = elementId ? state.document.elements.find((entry) => entry.id === elementId) : undefined;
      if (elementId && !element) return;
      if (!element && !at) return;
      if (tableCellId && (!element || element.kind !== 'table' || !element.table?.cells.some((cell) => cell.id === tableCellId))) return;
      state.commentComposerTarget = element
        ? commentTargetFor(element, tableCellId, at)
        : { anchor: { x: 0.5, y: 0.5 }, fallback: { x: at!.x, y: at!.y } };
      setSelection(element ? [element.id] : []);
      state.commentSidebarOpen = true; state.frameSidebarOpen = false;
      state.codeOpen = false; state.catalogOpen = false; state.objectsOpen = false;
      state.activeCommentId = null;
      state.workspaceView = 'canvas';
      state.liveMessage = element ? t('Kommentar an Element schreiben.') : t('Kommentar auf Zeichenfläche schreiben.');
    },
    cancelComment() { state.commentComposerTarget = null; },
    async createComment(body) {
      const text = body.trim(); const target = state.commentComposerTarget;
      if (!target || !text || !state.canWrite || state.transitioning) return false;
      const now = new Date().toISOString();
      const message: CommentMessage = { id: uid('comment'), authorId: actorId, authorName: localAuthor(), body: text, createdAt: now };
      const thread: CommentThread = { id: uid('thread'), target: clone(target), messages: [message], resolved: false, createdAt: now, updatedAt: now };
      const ok = await dispatch({ type: 'set-comments', threads: [...(state.document.commentThreads ?? []), thread] });
      if (ok) { state.commentComposerTarget = null; state.activeCommentId = thread.id; state.commentSidebarOpen = true; state.frameSidebarOpen = false; state.tool = 'select'; state.liveMessage = t('Kommentar erstellt.'); }
      return ok;
    },
    openComment(threadId, options) {
      const thread = (state.document.commentThreads ?? []).find((entry) => entry.id === threadId);
      if (!thread) return;
      state.workspaceView = 'canvas'; state.activeCommentId = threadId; state.commentSidebarOpen = true; state.frameSidebarOpen = false;
      state.codeOpen = false; state.catalogOpen = false; state.objectsOpen = false;
      state.unreadCommentIds = state.unreadCommentIds.filter((id) => id !== threadId);
      const element = thread.target.elementId ? state.document.elements.find((entry) => entry.id === thread.target.elementId) : undefined;
      if (element) {
        setSelection([element.id]);
        if (thread.target.tableCellId && element.kind === 'table' && element.table) {
          const cell = element.table.cells.find((entry) => entry.id === thread.target.tableCellId);
          if (cell) {
            const rowIndex = element.table.rows.findIndex((row) => row.id === cell.rowId);
            const columnIndex = element.table.columns.findIndex((column) => column.id === cell.columnId);
            store.selectTableCells(element.id, [cell.id], 'cell', rowIndex, columnIndex);
          }
        }
        if (options?.reveal !== false) store.fitSelection();
      } else if (options?.reveal !== false) {
        state.viewport = { ...state.viewport, panX: state.viewportSize.width / 2 - thread.target.fallback.x * state.viewport.zoom, panY: state.viewportSize.height / 2 - thread.target.fallback.y * state.viewport.zoom };
      }
      state.liveMessage = t('Kommentar geöffnet und Ziel hervorgehoben.');
    },
    closeCommentThread() { state.activeCommentId = null; },
    closeCommentSidebar() { state.commentSidebarOpen = false; state.activeCommentId = null; state.commentComposerTarget = null; },
    async addCommentReply(threadId, body) {
      const text = body.trim(); if (!text || !state.canWrite || state.transitioning) return false;
      const now = new Date().toISOString();
      const threads = clone(state.document.commentThreads ?? []);
      const thread = threads.find((entry) => entry.id === threadId); if (!thread) return false;
      thread.messages.push({ id: uid('comment'), authorId: actorId, authorName: localAuthor(), body: text, createdAt: now }); thread.updatedAt = now;
      const ok = await dispatch({ type: 'set-comments', threads }); if (ok) state.liveMessage = t('Antwort hinzugefügt.'); return ok;
    },
    async editCommentMessage(threadId, messageId, body) {
      const text = body.trim(); if (!text || !state.canWrite || state.transitioning) return false;
      const threads = clone(state.document.commentThreads ?? []); const thread = threads.find((entry) => entry.id === threadId); const message = thread?.messages.find((entry) => entry.id === messageId);
      if (!thread || !message || message.authorId !== actorId) return false;
      const now = new Date().toISOString(); message.body = text; message.editedAt = now; thread.updatedAt = now;
      const ok = await dispatch({ type: 'set-comments', threads }); if (ok) state.liveMessage = t('Kommentar bearbeitet.'); return ok;
    },
    async deleteCommentMessage(threadId, messageId) {
      if (!state.canWrite || state.transitioning) return false;
      const threads = clone(state.document.commentThreads ?? []); const thread = threads.find((entry) => entry.id === threadId); const message = thread?.messages.find((entry) => entry.id === messageId);
      if (!thread || !message || message.authorId !== actorId) return false;
      if (thread.messages.length === 1) return store.deleteCommentThread(threadId);
      thread.messages = thread.messages.filter((entry) => entry.id !== messageId); thread.updatedAt = new Date().toISOString();
      const ok = await dispatch({ type: 'set-comments', threads }); if (ok) state.liveMessage = t('Kommentar gelöscht.'); return ok;
    },
    async setCommentResolved(threadId, resolved) {
      const threads = clone(state.document.commentThreads ?? []); const thread = threads.find((entry) => entry.id === threadId); if (!thread || !state.canWrite || state.transitioning) return false;
      thread.resolved = resolved; thread.updatedAt = new Date().toISOString();
      const ok = await dispatch({ type: 'set-comments', threads }); if (ok) state.liveMessage = resolved ? t('Kommentar erledigt.') : t('Kommentar wieder geöffnet.'); return ok;
    },
    markCommentUnread(threadId) { if ((state.document.commentThreads ?? []).some((entry) => entry.id === threadId) && !state.unreadCommentIds.includes(threadId)) state.unreadCommentIds = [...state.unreadCommentIds, threadId]; },
    async copyCommentLink(threadId) {
      if (!(state.document.commentThreads ?? []).some((entry) => entry.id === threadId)) return;
      const base = typeof window === 'undefined' ? 'sketchdraw' : window.location.href.split('#')[0];
      try { await clipboard.writeText(`${base}#comment=${encodeURIComponent(threadId)}`); notice(t('Kommentarlink kopiert.')); } catch (error) { fail(error); }
    },
    async deleteCommentThread(threadId) {
      if (!state.canWrite || state.transitioning) return false;
      const threads = (state.document.commentThreads ?? []).filter((entry) => entry.id !== threadId);
      if (threads.length === (state.document.commentThreads ?? []).length) return false;
      const ok = await dispatch({ type: 'set-comments', threads });
      if (ok) { state.activeCommentId = null; state.unreadCommentIds = state.unreadCommentIds.filter((id) => id !== threadId); state.liveMessage = t('Kommentar-Thread gelöscht.'); }
      return ok;
    },
    async createTask(input) {
      if (!state.canWrite || state.transitioning) return false;
      const title = input.title.trim();
      if (!title) return false;
      const status = input.status ?? 'todo';
      const now = new Date().toISOString();
      const task: SketchTask = {
        id: uid('task'), title, description: input.description?.trim() ?? '', status,
        rank: (state.document.tasks ?? []).filter((entry) => entry.status === status).length,
        createdAt: now, updatedAt: now,
        ...(input.type ? { type: input.type } : {}),
        ...(input.assignee?.trim() ? { assignee: input.assignee.trim().slice(0, 120) } : {}),
        ...(input.dueDate ? { dueDate: input.dueDate } : {}),
      };
      const ok = await dispatch({ type: 'set-tasks', tasks: [...(state.document.tasks ?? []), task] });
      if (!ok) return false;
      state.liveMessage = t('Aufgabe erstellt.');
      if (state.pluginSettings?.atlassian.enabled && bridge.plugins) {
        try {
          const issue = await bridge.plugins.createJiraIssue({ title: task.title, description: task.description });
          const tasks = clone(state.document.tasks ?? []); const stored = tasks.find((entry) => entry.id === task.id);
          if (stored) { stored.external = { provider: 'jira', remoteId: issue.id, key: issue.key, url: issue.url, remoteStatus: issue.remoteStatus, updatedAt: issue.updatedAt }; await dispatch({ type: 'set-tasks', tasks }); notice(t('Jira-Ticket {key} erstellt.', { key: issue.key })); }
        } catch (error) { notice(t('Lokale Aufgabe erstellt; Jira-Synchronisation fehlgeschlagen: {message}', { message: error instanceof Error ? error.message : t('unbekannter Fehler') }), 'error'); }
      }
      return true;
    },
    async createTaskFromComment(threadId) {
      if (!state.canWrite || state.transitioning || (state.document.tasks ?? []).some((task) => task.sourceThreadId === threadId)) return false;
      const thread = (state.document.commentThreads ?? []).find((entry) => entry.id === threadId); const first = thread?.messages[0]; if (!thread || !first) return false;
      const now = new Date().toISOString(); const title = first.body.split(/\r?\n/)[0]!.slice(0, 120);
      const task: SketchTask = { id: uid('task'), sourceThreadId: threadId, title, description: first.body, status: 'todo', rank: (state.document.tasks ?? []).filter((entry) => entry.status === 'todo').length, createdAt: now, updatedAt: now };
      const ok = await dispatch({ type: 'set-tasks', tasks: [...(state.document.tasks ?? []), task] });
      if (!ok) return false;
      state.liveMessage = t('Aufgabe aus Kommentar erstellt.');
      if (state.pluginSettings?.atlassian.enabled && bridge.plugins) {
        try {
          const issue = await bridge.plugins.createJiraIssue({ title: task.title, description: task.description });
          const tasks = clone(state.document.tasks ?? []); const stored = tasks.find((entry) => entry.id === task.id);
          if (stored) { stored.external = { provider: 'jira', remoteId: issue.id, key: issue.key, url: issue.url, remoteStatus: issue.remoteStatus, updatedAt: issue.updatedAt }; await dispatch({ type: 'set-tasks', tasks }); notice(t('Jira-Ticket {key} erstellt.', { key: issue.key })); }
        } catch (error) { notice(t('Lokale Aufgabe erstellt; Jira-Synchronisation fehlgeschlagen: {message}', { message: error instanceof Error ? error.message : t('unbekannter Fehler') }), 'error'); }
      }
      return true;
    },
    async createTaskFromStickyNote(elementId) {
      if (!state.canWrite || state.transitioning || (state.document.tasks ?? []).some((task) => task.sourceElementId === elementId)) return false;
      const note = state.document.elements.find((element) => element.id === elementId && element.kind === 'sticky-note');
      if (!note) return false;
      const description = (note.text ?? '').trim();
      const firstLine = description.split(/\r?\n/).find((line) => line.trim())?.trim();
      const fallback = note.author?.trim() ? t('Notiz von {name}', { name: note.author.trim() }) : t('Notiz');
      const now = new Date().toISOString();
      const task: SketchTask = {
        id: uid('task'), sourceElementId: elementId, title: (firstLine || fallback).slice(0, 120), description,
        status: 'todo', rank: (state.document.tasks ?? []).filter((entry) => entry.status === 'todo').length,
        createdAt: now, updatedAt: now,
      };
      const ok = await dispatch({ type: 'set-tasks', tasks: [...(state.document.tasks ?? []), task] });
      if (!ok) return false;
      state.liveMessage = t('Aufgabe aus Notiz erstellt.');
      if (state.pluginSettings?.atlassian.enabled && bridge.plugins) {
        try {
          const issue = await bridge.plugins.createJiraIssue({ title: task.title, description: task.description });
          const tasks = clone(state.document.tasks ?? []); const stored = tasks.find((entry) => entry.id === task.id);
          if (stored) { stored.external = { provider: 'jira', remoteId: issue.id, key: issue.key, url: issue.url, remoteStatus: issue.remoteStatus, updatedAt: issue.updatedAt }; await dispatch({ type: 'set-tasks', tasks }); notice(t('Jira-Ticket {key} erstellt.', { key: issue.key })); }
        } catch (error) { notice(t('Lokale Aufgabe erstellt; Jira-Synchronisation fehlgeschlagen: {message}', { message: error instanceof Error ? error.message : t('unbekannter Fehler') }), 'error'); }
      }
      return true;
    },
    async moveTask(taskId, status, index) {
      if (!state.canWrite || state.transitioning) return false;
      const tasks = clone(state.document.tasks ?? []); const task = tasks.find((entry) => entry.id === taskId); if (!task) return false;
      const previous = task.status;
      const ordered = (column: SketchTask['status']) => tasks.filter((entry) => entry.status === column && entry.id !== taskId).sort((a, b) => a.rank - b.rank || a.createdAt.localeCompare(b.createdAt));
      const target = ordered(status);
      target.splice(Math.max(0, Math.min(index, target.length)), 0, task);
      task.status = status;
      target.forEach((entry, rank) => { entry.rank = rank; });
      if (previous !== status) ordered(previous).forEach((entry, rank) => { entry.rank = rank; });
      task.updatedAt = new Date().toISOString();
      const ok = await dispatch({ type: 'set-tasks', tasks });
      if (!ok) return false;
      state.liveMessage = t('Aufgabe verschoben.');
      if (previous !== status && task.external?.provider === 'jira' && bridge.plugins) {
        try {
          const issue = await bridge.plugins.transitionJiraIssue({ key: task.external.key, status });
          const current = clone(state.document.tasks ?? []); const synced = current.find((entry) => entry.id === taskId);
          if (synced?.external) { synced.external.remoteStatus = issue.remoteStatus; synced.external.updatedAt = issue.updatedAt; await dispatch({ type: 'set-tasks', tasks: current }); }
        } catch (error) { notice(t('Lokaler Status gespeichert; Jira-Status konnte nicht aktualisiert werden: {message}', { message: error instanceof Error ? error.message : t('unbekannter Fehler') }), 'error'); }
      }
      return true;
    },
    async updateTask(taskId, value) {
      if (!state.canWrite || state.transitioning) return false;
      const tasks = clone(state.document.tasks ?? []); const task = tasks.find((entry) => entry.id === taskId); if (!task) return false;
      if (value.title !== undefined && value.title.trim()) task.title = value.title.trim();
      if (value.description !== undefined) task.description = value.description;
      if (value.status !== undefined) { task.status = value.status; task.rank = tasks.filter((entry) => entry.status === value.status).length; }
      if (value.type !== undefined) { if (value.type) task.type = value.type; else delete task.type; }
      if (value.assignee !== undefined) { const name = value.assignee?.trim().slice(0, 120); if (name) task.assignee = name; else delete task.assignee; }
      if (value.dueDate !== undefined) { if (value.dueDate) task.dueDate = value.dueDate; else delete task.dueDate; }
      task.updatedAt = new Date().toISOString();
      const ok = await dispatch({ type: 'set-tasks', tasks });
      if (ok) {
        state.liveMessage = t('Aufgabe aktualisiert.');
        if (value.status !== undefined && task.external?.provider === 'jira' && bridge.plugins) {
          try {
            const issue = await bridge.plugins.transitionJiraIssue({ key: task.external.key, status: value.status });
            const current = clone(state.document.tasks ?? []); const synced = current.find((entry) => entry.id === taskId);
            if (synced?.external) { synced.external.remoteStatus = issue.remoteStatus; synced.external.updatedAt = issue.updatedAt; await dispatch({ type: 'set-tasks', tasks: current }); }
          } catch (error) { notice(t('Lokaler Status gespeichert; Jira-Status konnte nicht aktualisiert werden: {message}', { message: error instanceof Error ? error.message : t('unbekannter Fehler') }), 'error'); }
        }
      }
      return ok;
    },
    async deleteTask(taskId) {
      if (!state.canWrite || state.transitioning) return false;
      const tasks = (state.document.tasks ?? []).filter((entry) => entry.id !== taskId); if (tasks.length === (state.document.tasks ?? []).length) return false;
      return dispatch({ type: 'set-tasks', tasks });
    },
    openTaskBoard() { state.workspaceView = 'tasks'; state.activeCommentId = null; state.commentComposerTarget = null; state.commentSidebarOpen = false; state.liveMessage = t('Aufgabenboard geöffnet.'); },
    showCanvas() { state.workspaceView = 'canvas'; state.liveMessage = t('Zeichenfläche geöffnet.'); },
    async refreshPluginSettings() {
      if (!bridge.plugins) { state.pluginSettings = { available: false, git: { enabled: false, autoCommit: false, autoPush: false, autoPull: false, remote: 'origin', health: 'disabled', message: 'Plugins sind in der Desktop-App verfügbar.' }, atlassian: { enabled: false, siteUrl: '', email: '', confluenceSpaceKey: '', jiraProjectKey: '', jiraIssueType: 'Task', credentialStored: false, health: 'disabled', message: 'Plugins sind in der Desktop-App verfügbar.' } }; return; }
      try { state.pluginSettings = await bridge.plugins.getSettings(); if (state.file.handle && state.pluginSettings.git.enabled) void bridge.plugins.watchDocument(state.file.handle.handleId); }
      catch (error) { fail(error); }
    },
    async configureGitPlugin(input: ConfigureGitPluginInput) {
      if (!bridge.plugins) return false; state.pluginBusy = true;
      try { state.pluginSettings = await bridge.plugins.configureGit(input); if (input.enabled && state.file.handle) await bridge.plugins.watchDocument(state.file.handle.handleId); notice(t('Git-Plugin gespeichert.')); return true; }
      catch (error) { fail(error); return false; } finally { state.pluginBusy = false; }
    },
    async configureAtlassianPlugin(input: ConfigureAtlassianPluginInput) {
      if (!bridge.plugins) return false; state.pluginBusy = true;
      try { state.pluginSettings = await bridge.plugins.configureAtlassian(input); notice(t('Atlassian-Plugin gespeichert.')); return true; }
      catch (error) { fail(error); return false; } finally { state.pluginBusy = false; }
    },
    async testAtlassianPlugin() {
      if (!bridge.plugins) return false; state.pluginBusy = true;
      try { const result = await bridge.plugins.testAtlassian(); await store.refreshPluginSettings(); notice(tm(result.message), result.ok ? 'info' : 'error'); return result.ok; }
      catch (error) { fail(error); return false; } finally { state.pluginBusy = false; }
    },
    async refreshGitStatus() {
      if (!bridge.plugins || !state.file.handle) { notice(t('Speichere das Dokument zuerst in einem Git-Repository.'), 'error'); return false; }
      state.pluginBusy = true; try { const result = await bridge.plugins.gitStatus(state.file.handle.handleId); if (state.pluginSettings) state.pluginSettings.git = result.settings; notice(tm(result.message), result.ok ? 'info' : 'error'); return result.ok; }
      catch (error) { fail(error); return false; } finally { state.pluginBusy = false; }
    },
    async syncGit() {
      if (!bridge.plugins || !state.file.handle) { notice(t('Speichere das Dokument zuerst in einem Git-Repository.'), 'error'); return false; }
      if (state.saveStatus === 'dirty') { notice(t('Speichere lokale Änderungen vor der Git-Synchronisation.'), 'error'); return false; }
      state.pluginBusy = true; try { const result = await bridge.plugins.gitSync(state.file.handle.handleId); if (state.pluginSettings) state.pluginSettings.git = result.settings; notice(tm(result.message), result.ok ? 'info' : 'error'); return result.ok; }
      catch (error) { fail(error); return false; } finally { state.pluginBusy = false; }
    },
    async searchConfluencePages(query) {
      if (!bridge.plugins) return; state.pluginBusy = true;
      try { state.confluencePages = await bridge.plugins.listConfluencePages(query); }
      catch (error) { fail(error); } finally { state.pluginBusy = false; }
    },
    async insertConfluencePage(pageId) {
      if (!bridge.plugins || !state.canWrite || state.transitioning) return false; state.pluginBusy = true;
      try {
        const page = await bridge.plugins.getConfluencePage(pageId); const annotation = confluenceStorageToAnnotation(page.storageBody); const p = currentCenter();
        const element = createElement('annotation', { x: p.x - 260, y: p.y - 180, width: 520, height: 360, label: page.title, text: annotationPlainText(annotation), annotation, documentationUrl: page.url, metadata: { 'sketchdraw.atlassian.pageId': page.id, 'sketchdraw.atlassian.pageVersion': String(page.version), 'sketchdraw.atlassian.pageUrl': page.url } });
        const ok = await dispatch({ type: 'add', elements: [element] }, state.revision, 'import'); if (ok) { setSelection([element.id]); state.workspaceView = 'canvas'; notice(t('Confluence-Seite „{title}“ eingebunden.', { title: page.title })); } return ok;
      } catch (error) { fail(error); return false; } finally { state.pluginBusy = false; }
    },
    async syncConfluenceElement(elementId) {
      if (!bridge.plugins) return false; const element = state.document.elements.find((entry) => entry.id === elementId); const pageId = element?.metadata?.['sketchdraw.atlassian.pageId']; const version = Number(element?.metadata?.['sketchdraw.atlassian.pageVersion']);
      if (!element?.annotation || !pageId || !Number.isSafeInteger(version)) { notice(t('Das Element ist nicht mit einer Confluence-Seite verknüpft.'), 'error'); return false; }
      state.pluginBusy = true; try { const page = await bridge.plugins.updateConfluencePage({ pageId, title: element.label || state.title, storageBody: annotationToConfluenceStorage(element.annotation), version }); const ok = await dispatch({ type: 'update', changes: [{ id: element.id, patch: { documentationUrl: page.url, metadata: { 'sketchdraw.atlassian.pageVersion': String(page.version), 'sketchdraw.atlassian.pageUrl': page.url } } }] }); if (ok) notice(t('Confluence-Seite aktualisiert.')); return ok; }
      catch (error) { fail(error); return false; } finally { state.pluginBusy = false; }
    },
    async refreshConfluenceElement(elementId) {
      if (!bridge.plugins) return false; const element = state.document.elements.find((entry) => entry.id === elementId); const pageId = element?.metadata?.['sketchdraw.atlassian.pageId'];
      if (!element || !pageId) { notice(t('Das Element ist nicht mit einer Confluence-Seite verknüpft.'), 'error'); return false; }
      state.pluginBusy = true; try { const page = await bridge.plugins.getConfluencePage(pageId); const annotation = confluenceStorageToAnnotation(page.storageBody); const ok = await dispatch({ type: 'update', changes: [{ id: element.id, patch: { label: page.title, text: annotationPlainText(annotation), annotation, documentationUrl: page.url, metadata: { 'sketchdraw.atlassian.pageVersion': String(page.version), 'sketchdraw.atlassian.pageUrl': page.url } } }] }); if (ok) notice(t('Confluence-Seite neu geladen.')); return ok; }
      catch (error) { fail(error); return false; } finally { state.pluginBusy = false; }
    },
    async syncJiraTasks() {
      if (!bridge.plugins || !state.canWrite || state.transitioning) return false; state.pluginBusy = true;
      try {
        const issues = await bridge.plugins.listJiraIssues(); const tasks = clone(state.document.tasks ?? []); const byKey = new Map(tasks.filter((task) => task.external?.provider === 'jira').map((task) => [task.external!.key, task]));
        for (const issue of issues) { const existing = byKey.get(issue.key); if (existing) { existing.title = issue.title; existing.description = issue.description; existing.status = issue.status; existing.updatedAt = issue.updatedAt; existing.external = { provider: 'jira', remoteId: issue.id, key: issue.key, url: issue.url, remoteStatus: issue.remoteStatus, updatedAt: issue.updatedAt }; } else tasks.push({ id: uid('task'), title: issue.title, description: issue.description, status: issue.status, rank: tasks.filter((task) => task.status === issue.status).length, createdAt: issue.updatedAt, updatedAt: issue.updatedAt, external: { provider: 'jira', remoteId: issue.id, key: issue.key, url: issue.url, remoteStatus: issue.remoteStatus, updatedAt: issue.updatedAt } }); }
        const ok = await dispatch({ type: 'set-tasks', tasks }); if (ok) notice(t('{count} Jira-Vorgänge synchronisiert.', { count: issues.length })); return ok;
      } catch (error) { fail(error); return false; } finally { state.pluginBusy = false; }
    },
    async acceptExternalDocument() {
      const event = pendingExternalEvent; if (!event) return false;
      try { const document = deserializeDocument(event.text); install(document, { ...freshFile(), handle: event.file, savedRevision: 0 }); pendingExternalEvent = null; state.pendingExternalDocument = false; notice(t('Extern geändert und neu geladen: {name}', { name: event.file.name })); return true; }
      catch (error) { fail(error); return false; }
    },
    toggleFrameSidebar(open) {
      state.frameSidebarOpen = open ?? !state.frameSidebarOpen;
      if (state.frameSidebarOpen) {
        state.workspaceView = 'canvas'; state.commentSidebarOpen = false; state.codeOpen = false; state.catalogOpen = false; state.objectsOpen = false;
        state.liveMessage = t('Folienleiste geöffnet.');
      }
    },
    focusFrame(id) {
      const frame = state.frameSlides.find((entry) => entry.id === id);
      if (!frame) return;
      setSelection([id]);
      state.viewport = fitRect(state.viewportSize, frame, 72, 2);
      state.liveMessage = t('{label} ausgewählt.', { label: frame.label || t('Folie') });
    },
    renameFrame(id, name) {
      if (!state.canWrite || state.transitioning) return;
      const frame = state.frameSlides.find((entry) => entry.id === id);
      const label = name.trim().slice(0, 120);
      if (!frame || !label || frame.label === label) return;
      void dispatch({ type: 'update', changes: [{ id, patch: { label } }] });
    },
    moveFrame(id, toIndex) {
      if (!state.canWrite || state.transitioning) return;
      const ids = state.frameSlides.map((frame) => frame.id);
      const from = ids.indexOf(id);
      if (from < 0) return;
      const target = Math.max(0, Math.min(ids.length - 1, toIndex));
      if (target === from) return;
      ids.splice(target, 0, ids.splice(from, 1)[0]!);
      void dispatch({ type: 'set-metadata', patch: { [FRAME_ORDER_METADATA_KEY]: frameOrderMetadata(ids) } });
      state.presenterIndex = target;
    },
    startPresentation(frameId) {
      const slides = state.frameSlides;
      if (!slides.length) { notice(t('Lege zuerst mindestens einen Frame an.'), 'error'); return; }
      const selectedFrame = frameId ?? state.selection.find((id) => slides.some((frame) => frame.id === id));
      const index = selectedFrame ? slides.findIndex((frame) => frame.id === selectedFrame) : 0;
      state.presenterIndex = Math.max(0, index);
      state.presenterOpen = true;
      state.liveMessage = t('Präsentation gestartet: {name}.', { name: slides[state.presenterIndex]?.label || t('Folie {index}', { index: state.presenterIndex + 1 }) });
    },
    stopPresentation() { state.presenterOpen = false; state.liveMessage = t('Präsentation beendet.'); },
    goToPresentation(index) {
      if (!state.presenterOpen || !state.frameSlides.length) return;
      state.presenterIndex = Math.max(0, Math.min(state.frameSlides.length - 1, index));
      state.liveMessage = `${state.frameSlides[state.presenterIndex]?.label || `Folie ${state.presenterIndex + 1}`}, ${state.presenterIndex + 1} von ${state.frameSlides.length}.`;
    },
    async insertImageFile(file, at) {
      if (state.transitioning) return;
      if (!['image/png', 'image/jpeg', 'image/webp'].includes(file.type)) { notice(t('Erlaubt sind PNG, JPEG und WebP.'), 'error'); return; }
      if (file.size > DOMAIN_LIMITS.MAX_ASSET_BYTES) { notice(t('Das Bild ist zu groß (maximal 8 MB).'), 'error'); return; }
      const owner = activeSession(); const revision = state.revision;
      try {
        const dataUrl = await new Promise<string>((resolve, reject) => { const reader = new FileReader(); reader.onload = () => resolve(String(reader.result)); reader.onerror = reject; reader.readAsDataURL(file); });
        const image = new Image(); image.src = dataUrl; await image.decode();
        if (activeSession() !== owner || state.transitioning) { notice(t('Das Bild wurde nicht eingefügt, weil das Dokument gewechselt hat.')); return; }
        const scale = Math.min(1, 640 / Math.max(image.naturalWidth, image.naturalHeight));
        const p = at ?? currentCenter(); const width = Math.max(1, image.naturalWidth * scale); const height = Math.max(1, image.naturalHeight * scale);
        const asset = { id: uid('asset'), mimeType: file.type as 'image/png' | 'image/jpeg' | 'image/webp', dataUrl, name: file.name };
        const e = createElement('image', { x: p.x - width / 2, y: p.y - height / 2, width, height, assetId: asset.id, label: file.name, style: { ...DEFAULT_STYLE } });
        if (await dispatch({ type: 'add', elements: [e], assets: [asset] }, revision, 'import')) { setSelection([e.id]); state.tool = 'select'; }
      } catch (error) { fail(error); }
    },
    undo() { if (!state.transitioning) void write({ kind: 'undo' }); },
    redo() { if (!state.transitioning) void write({ kind: 'redo' }); },
    newDocument() { return requestTransition('new'); }, openDocument() { return requestTransition('open'); },
    async importDocument(document) {
      if (state.transitioning) return;
      try { pendingImport = deserializeDocument(serializeDocument(document)); await requestTransition('import'); }
      catch (error) { pendingImport = null; fail(error); }
    },
    async prepareDocumentSnapshot() {
      if (state.transitioning) return null;
      const owner = activeSession();
      if (!await prepareDrafts() || owner !== activeSession() || state.transitioning) return null;
      return snapshotSource().getSnapshot();
    },
    async save() { if (!state.transitioning) await saveFile(false); }, async saveAs() { if (!state.transitioning) await saveFile(true); },
    async exportDocument(format) {
      if (state.transitioning) return;
      if (format !== 'sketchdraw') { notice(t('Dieses Austauschformat ist noch nicht angebunden.'), 'error'); return; }
      try {
        if (!await prepareDrafts()) return;
        const result = await bridge.exportFile(serializeDocument(state.document), suggestFileName(state.title), format);
        if (result.status === 'error') fail(new Error(result.message));
        else if (result.status !== 'cancelled') notice(result.status === 'exported' ? t('Exportiert: {name}', { name: result.name }) : t('Als Download übergeben: {name}', { name: result.name }));
      } catch (error) { fail(error); }
    },
    async resolveDialog(choice: DialogChoice) {
      const dialog = state.dialog;
      if (!dialog) return;
      if (dialog.kind === 'save-conflict') { state.dialog = null; if (choice === 'save-copy') await saveFile(true); return; }
      if (dialog.kind !== 'unsaved' || dialog.busy) return;
      if (choice === 'cancel') { const id = dialog.requestId; releaseTransition(); state.dialog = null; if (dialog.reason === 'close' && id) await bridge.respondToClose(id, 'cancel').catch(fail); return; }
      dialog.busy = true;
      try {
      if (choice === 'save') {
        // Drafts commit through the same gateway before the final barrier. UI remains locked.
        if (barrier) lifecycle().cancelTransition(barrier.token);
        barrier = null;
        const prepared = await prepareDrafts();
        barrier = await lifecycle().beginTransition(dialog.reason === 'close' ? 'close' : 'replace', draftGeneration);
        if (!prepared || !await saveFile(false, barrier.snapshot)) { dialog.busy = false; dialog.error = state.file.conflict ? t('Speicherkonflikt. Abbrechen und über „Speichern unter“ eine Kopie anlegen.') : t('Nicht gespeichert. Entwürfe und Dokument bleiben erhalten.'); return; }
      }
      await continueTransition(dialog.reason, dialog.requestId);
      } catch (error) { releaseTransition(); state.dialog = null; fail(error); if (dialog.reason === 'close' && dialog.requestId) await bridge.respondToClose(dialog.requestId, 'cancel').catch(fail); }
    },
    openHelp() { if (!state.transitioning) state.dialog = { kind: 'help' }; },
    closeDialog() { if (state.dialog?.kind === 'unsaved') void store.resolveDialog('cancel'); else state.dialog = null; },
    toggleObjects(open) { state.objectsOpen = open ?? !state.objectsOpen; if (state.objectsOpen) state.frameSidebarOpen = false; },
    selectPage(id) {
      if (!state.canWrite || state.transitioning || id === state.activePageId) return;
      const model = pageState(state.document);
      if (!model.pages.some((page) => page.id === id)) return;
      void dispatch({ type: 'replace', document: documentWithPages(state.document, model.pages, id) });
    },
    addPage() {
      if (!state.canWrite || state.transitioning) return;
      const model = pageState(state.document);
      if (model.pages.length >= MAX_PAGES) { notice(t('Ein Dokument kann höchstens {MAX_PAGES} Seiten enthalten.', { MAX_PAGES }), 'error'); return; }
      const page = { id: uid('page'), name: nextPageName(model.pages), elements: [] };
      const pages = [...model.pages, page];
      void dispatch({ type: 'replace', document: documentWithPages(state.document, pages, page.id) });
    },
    renamePage(id, name) {
      const next = name.trim();
      if (!state.canWrite || state.transitioning || !next || next.length > MAX_PAGE_NAME_LENGTH) return;
      const model = pageState(state.document);
      const page = model.pages.find((entry) => entry.id === id);
      if (!page || page.name === next) return;
      const pages = model.pages.map((entry) => entry.id === id ? { ...entry, name: next } : entry);
      void dispatch({ type: 'replace', document: documentWithPages(state.document, pages, model.activePageId) });
    },
    duplicatePage(id) {
      if (!state.canWrite || state.transitioning) return;
      const model = pageState(state.document);
      if (model.pages.length >= MAX_PAGES) { notice(t('Ein Dokument kann höchstens {MAX_PAGES} Seiten enthalten.', { MAX_PAGES }), 'error'); return; }
      const index = model.pages.findIndex((page) => page.id === id);
      if (index < 0) return;
      const duplicate = clonePage(model.pages[index]!, uid);
      const pages = [...model.pages]; pages.splice(index + 1, 0, duplicate);
      void dispatch({ type: 'replace', document: documentWithPages(state.document, pages, duplicate.id) });
    },
    deletePage(id) {
      if (!state.canWrite || state.transitioning) return;
      const model = pageState(state.document);
      const index = model.pages.findIndex((page) => page.id === id);
      if (index < 0 || model.pages.length <= 1) return;
      const pages = model.pages.filter((page) => page.id !== id);
      const nextActive = id === model.activePageId ? pages[Math.min(index, pages.length - 1)]!.id : model.activePageId;
      void dispatch({ type: 'replace', document: documentWithPages(state.document, pages, nextActive) });
    },
    movePage(id, toIndex) {
      if (!state.canWrite || state.transitioning) return;
      const model = pageState(state.document);
      const from = model.pages.findIndex((page) => page.id === id);
      const target = Math.max(0, Math.min(model.pages.length - 1, toIndex));
      if (from < 0 || from === target) return;
      const pages = [...model.pages]; pages.splice(target, 0, pages.splice(from, 1)[0]!);
      void dispatch({ type: 'replace', document: documentWithPages(state.document, pages, model.activePageId) });
    },
    async copyPage(id) {
      const page = pageState(state.document).pages.find((entry) => entry.id === id);
      if (!page) return;
      try {
        await clipboard.writeText(JSON.stringify(pageClipboardPayload(page.name, page.elements, state.document.assets)));
        notice(t('Inhalt von „{name}“ kopiert.', { name: page.name }));
      } catch { notice(t('Die Zwischenablage ist nicht verfügbar. Der Seiteninhalt wurde nicht kopiert.'), 'error'); }
    },
    async pastePage() {},
    togglePropertiesCollapsed(collapsed) { state.propertiesCollapsed = collapsed ?? !state.propertiesCollapsed; },
    setTheme(theme) { state.theme = theme; persistPreferences(); },
    setCanvasBackground(value) {
      const next = value && value !== 'default' && isCanvasBackground(value) ? value : null;
      if (next === state.canvasBackground) return;
      state.canvasBackground = next; persistPreferences();
    },
    setLanguage(language) {
      if (language === state.language || !LANGUAGES.some((entry) => entry.code === language && entry.available)) return;
      state.language = language; setLocale(language); persistPreferences();
    },
    dismissNotice(id) { state.notices = state.notices.filter((notice) => notice.id !== id); },
    async openDocumentationLink(url) { try { await bridge.openExternal(url); } catch (error) { fail(error); } },
    toggleCode() { state.codeOpen = !state.codeOpen; if (state.codeOpen) { state.catalogOpen = false; state.frameSidebarOpen = false; } },
    setCodeDraft(text) { if (state.canWrite && !state.transitioning) { state.code.text = text; state.code.dirty = text !== formatDiagram(codeBase); state.code.diagnostics = []; changedDraft(); } },
    applyCode() { return state.transitioning ? Promise.resolve(false) : applyCode(); },
    resetCodeDraft() { if (!state.transitioning && !unknownWrite) { codeBase = state.document; state.code = { text: formatDiagram(state.document), baseRevision: state.revision, dirty: false, diagnostics: [] }; changedDraft(); } },
    toggleCatalog() { state.catalogOpen = !state.catalogOpen; if (state.catalogOpen) { state.codeOpen = false; state.frameSidebarOpen = false; } },
    setCatalogOpen(open) { state.catalogOpen = open; if (state.catalogOpen) { state.codeOpen = false; state.frameSidebarOpen = false; } },
    async insertComponent(set: ComponentSet, type: string, screenAt?: Point) {
      if (state.transitioning) return;
      try {
        const definition = set.components.find((component) => component.type === type);
        const centre = screenAt ? screenToDoc(state.viewport, screenAt) : currentCenter();
        const at = definition
          ? { x: centre.x - definition.defaultWidth / 2, y: centre.y - definition.defaultHeight / 2 }
          : centre;
        const { element, command } = instantiateComponent(state.document, { set, type, id: uid('component'), at });
        if (await dispatch(command)) { setSelection([element.id]); state.tool = 'select'; }
      }
      catch (error) { fail(error); }
    },
    async importComponentSet(file) {
      if (state.transitioning) return;
      const owner = activeSession(); const revision = state.revision;
      try { if (file.size > 2 * 1024 * 1024) throw new Error(t('Das Komponentenset ist zu groß (maximal 2 MB).')); const set = parseComponentSet(await file.text()); if (owner !== activeSession() || state.transitioning) return; const command = prepareComponentSetImport(state.document, set); if (command) await dispatch(command, revision, 'import'); }
      catch (error) { fail(error); }
    },
    whenIdle() { return lastWrite; },
    needsCloseWarning() { return needsClosePrompt(state.file, state.revision, state.hasDraft) || pendingWrites > 0 || Boolean(unknownWrite) || guest?.getStatus().hasUnresolvedOutcome === true; },
    dispose() { disposed = true; settleTransition(false); authorityListeners.clear(); unsubscribe(); unsubscribeStatus(); if (guest) void guest.leave(); unsubscribeClose(); unsubscribeMenu(); unsubscribePluginEvents(); for (const binding of Object.values(bindings)) { try { authority?.revokeBinding(binding.bindingId); } catch (error) { if (!(error instanceof SessionAccessError && error.code === 'SESSION_CHANGED')) throw error; } } releaseLocalCrdt(); },
  };
  const unsubscribeClose = bridge.onCloseRequested((requestId) => { void requestTransition('close', requestId); });
  const unsubscribeMenu = bridge.onMenuCommand((command) => {
    const active = typeof document === 'undefined' ? null : document.activeElement;
    if ((command === 'undo' || command === 'redo') && active?.matches('input, textarea, [contenteditable="true"]')) { document.execCommand(command); return; }
    if (command === 'save') void store.save(); else if (command === 'save-as') void store.saveAs(); else if (command === 'open') void store.openDocument(); else if (command === 'undo') store.undo(); else if (command === 'redo') store.redo();
  });
  const unsubscribePluginEvents = bridge.plugins?.onEvent((event) => {
    if (event.type !== 'document-changed' || event.file.handleId !== state.file.handle?.handleId) return;
    pendingExternalEvent = event;
    state.pendingExternalDocument = true;
    if (state.saveStatus === 'saved' && !state.hasDraft && !state.transitioning) void store.acceptExternalDocument();
    else notice(t('Die Datei wurde extern geändert. Lokale Entwürfe bleiben erhalten; neu laden ist in den Plugin-Einstellungen möglich.'), 'error');
  }) ?? (() => {});
  void store.refreshPluginSettings();
  return store;
}

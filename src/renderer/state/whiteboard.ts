import { reactive } from 'vue';
import {
  applyCommand, createController, createDocument, createElement, deserializeDocument,
  connectorEndMarker, connectorRouting, connectorStartMarker, DOMAIN_LIMITS, serializeDocument,
  type ComponentSet, type DocumentCommand, type DocumentSession, type ElementPatch,
  type Point, type SketchDocument, type SketchElement, type ElementStyle,
  type ShapeVariant, effectiveShapeVariant, shapeBaseKind,
} from '@/domain';
import { createDocumentAuthority, SessionAccessError, type ActorBinding, type DocumentAuthority, type TransitionBarrier, type WriteAction, type WriteIntent } from '@/session';
import type { GuestSession, CollaborationStatus } from '@/collaboration';
import { getDesktopBridge } from '@/platform';
import { formatDiagram, parseDiagram } from '@/codec';
import { instantiateComponent, parseComponentSet, prepareComponentSetImport } from '@/catalog';
import type {
  CreateStoreOptions, DialogChoice, FileState, HandleId, Rect,
  SelectionInfo, Tool, WhiteboardState, WhiteboardStore,
} from './contract';
import { ACTOR_ID, DEFAULT_STYLE, DEFAULT_SIZES, QUICK_CONNECT_KINDS, ROTATABLE_KINDS, STYLE_BY_KIND } from '../lib/constants';
import { bounds, center, endpointAt, hitElement, normalizedRect, rotatePoint, topSelected } from '../lib/geometry';
import { docToScreen, fitRect, screenToDoc, wheelToAction, zoomAround } from '../lib/viewport';
import { deriveSaveStatus, needsClosePrompt, suggestFileName } from '../lib/savestate';
import { describeElement, describeSelection } from '../lib/describe';
import { resolveShortcut } from '../lib/shortcuts';
import {
  MAX_PAGE_NAME_LENGTH, pageClipboardPayload, pageSummaries,
  SINGLE_PAGE_ID, SINGLE_PAGE_NAME, SINGLE_PAGE_NAME_METADATA_KEY,
} from './pages';
import { planQuickConnect, quickConnectCopy } from '../lib/quick-connect';
import { SWAPPABLE_KINDS } from '../lib/shapes';
import { elementClipboardPayload, parseElementClipboard, planElementPaste } from './element-clipboard';

type Gesture = {
  kind: 'draw' | 'move' | 'resize' | 'rotate' | 'pan' | 'marquee';
  start: Point; last: Point; screenStart: Point; base: DocumentSession;
  targets: SketchElement[]; handle?: HandleId; tool: Tool; points: Point[];
  preview: DocumentCommand | null; element: SketchElement | null;
  connectorFromId?: string;
};
const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;
const freshFile = (): FileState => ({ handle: null, savedRevision: null, handedOffRevision: null, saving: false, lastError: null, conflict: false });
const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
const uid = (prefix: string) => `${prefix}:${crypto.randomUUID()}`;

/** Owns presentation drafts. Canonical writes exclusively use the injected/shared session authority. */
export function createWhiteboardStore(options: CreateStoreOptions = {}): WhiteboardStore {
  const bridge = options.bridge ?? getDesktopBridge();
  const factory = options.authorityFactory ?? ((controller) => createDocumentAuthority({ controller }));
  let authority: DocumentAuthority | null = options.authority ?? factory(options.controller ?? createController(createDocument('Unbenannt')));
  let guest: GuestSession | null = null;
  const activeSession = () => guest ?? authority!;
  const snapshotSource = () => activeSession().source;
  const lifecycle = () => activeSession().lifecycleGate;
  let unsubscribeStatus = () => {};
  let pendingGuest: GuestSession | null = null;
  let transitionResult: ((success: boolean) => void) | null = null;
  let unknownWrite: { guest: GuestSession; intent: WriteIntent; recover: () => void } | null = null;
  const actorId = options.actorId ?? ACTOR_ID;
  const authorName = options.authorName?.trim() || 'Lokaler Benutzer';
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
    viewport: { panX: 0, panY: 0, zoom: 1 }, viewportSize: { width: 1280, height: 800 },
    marquee: null as Rect | null, snapTarget: null,
    connectorTargets: null as WhiteboardState['connectorTargets'],
    textEdit: null as WhiteboardState['textEdit'], gestureConflict: null as WhiteboardState['gestureConflict'],
    file: freshFile(), dialog: null as WhiteboardState['dialog'], notices: [] as WhiteboardState['notices'],
    liveMessage: '', offscreenChanges: 0, objectsOpen: false, propertiesCollapsed: false,
    theme: options.initialTheme ?? 'light', bridgePlatform: bridge.platform,
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
    get saveStatusText() { return this.hasDraft && !this.file.saving ? 'Offener Entwurf' : deriveSaveStatus(this.file, this.revision).text; },
    get hasDraft() { void this.draftVersion; return Boolean(this.propertyDraft) || Boolean(this.textEdit && (this.textEdit.draft !== this.textEdit.initialText || Object.keys(textStyleChanges(this.textEdit)).length > 0)) || this.code.dirty || titleDraft !== this.document.title || Boolean(this.drawing || this.previewCommand || this.gestureConflict); },
    get history() { void this.revision; try { return this.canWrite ? (guest?.source ?? bindings.human.source).getHistoryState() : { canUndo: false, canRedo: false }; } catch { return { canUndo: false, canRedo: false }; } },
    get cursor() { return this.transitioning ? 'wait' : this.tool === 'hand' || spaceHeld ? 'grab' : this.tool === 'select' ? 'default' : this.tool === 'text' ? 'text' : 'crosshair'; },
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
      const displayed = elements.map((element): SelectionInfo['values'] => {
        const withDraft = draft ? { ...element, ...draft, style: { ...element.style, ...draft.style } } : element;
        const e = editStyle && edit!.elementId === element.id ? { ...withDraft, style: { ...withDraft.style, ...editStyle } } : withDraft;
        return { ...e.style, x: e.x, y: e.y, width: e.width, height: e.height, rotation: e.rotation, label: e.label ?? undefined, description: e.description ?? undefined, text: e.text ?? undefined, author: e.author ?? undefined, connectorFrom: e.from?.elementId, connectorTo: e.to?.elementId,
          connectorRouting: e.kind === 'connector' ? connectorRouting({ connectorRouting: e.connectorRouting ?? undefined }) : undefined,
          startMarker: e.kind === 'connector' ? connectorStartMarker({ startMarker: e.startMarker ?? undefined }) : undefined,
          endMarker: e.kind === 'connector' ? connectorEndMarker({ endMarker: e.endMarker ?? undefined }) : undefined };
      });
      const values = displayed[0] ?? { ...DEFAULT_STYLE, ...(edit && !edit.elementId ? edit.style : {}) };
      const others = displayed.slice(1);
      const mixed = (Object.keys(values) as Array<keyof typeof values>).filter(key => others.some(value => !same(value[key], values[key])));
      return { count: elements.length, kinds: [...new Set(elements.map((e) => e.kind))], singleId: elements.length === 1 ? first!.id : null, values, mixed,
        canGroup: elements.length > 0, canUngroup: elements.some((e) => e.kind === 'container'), canConnect: elements.length === 2,
        canEditText: elements.length === 1, hasStroke: true, hasFill: elements.some((e) => !['text', 'path', 'connector', 'image'].includes(e.kind)), hasText: true };
    },
    get pages() { return pageSummaries(this.document); },
    activePageId: SINGLE_PAGE_ID,
    pagesEditable: false,
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
  function fail(error: unknown) { notice(error instanceof Error ? error.message : 'Die Aktion konnte nicht ausgeführt werden.', 'error'); }
  function sync(snapshot: DocumentSession) {
    const before = state.document;
    state.document = Object.freeze(snapshot.document); state.revision = snapshot.revision;
    state.selection = state.selection.filter((id) => snapshot.document.elements.some((e) => e.id === id));
    if (state.focusedId && !snapshot.document.elements.some((e) => e.id === state.focusedId)) state.focusedId = snapshot.document.elements[0]?.id ?? null;
    if (state.textEdit?.elementId) {
      const current = snapshot.document.elements.find((e) => e.id === state.textEdit!.elementId);
      if (!same(current, textBase)) state.textEdit.conflict = current ? 'Das Element wurde zwischenzeitlich geändert. Dein Text bleibt erhalten.' : 'Das Element wurde gelöscht. Dein Text bleibt erhalten.';
    }
    if (!state.code.dirty) { state.code.text = formatDiagram(snapshot.document); state.code.baseRevision = snapshot.revision; codeBase = snapshot.document; }
    if (titleDraft === before.title) titleDraft = snapshot.document.title;
    if (!localCommit && before !== snapshot.document) state.offscreenChanges += 1;
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
    if (!state.canWrite) { notice('Die gemeinsame Sitzung ist gerade schreibgeschützt. Offene Entwürfe bleiben erhalten.', 'error'); return Promise.resolve(false); }
    const owner = activeSession();
    const gateway = guest?.gateway ?? bindings[source].gateway;
    pendingWrites++;
    const result = lastWrite.then(async () => {
      if (disposed || activeSession() !== owner || !state.canWrite) return false;
      const requestId = gateway.nextRequestId();
      if (!requestId) { notice('Eine vorherige Änderung ist noch nicht geklärt.', 'error'); return false; }
      localCommit = true;
      try {
        const intent = { requestId, expectedRevision: revision, action };
        const outcome = await gateway.submit(intent);
        if (activeSession() !== owner) return false;
        const waitingForMirror = guest === owner && (outcome.status === 'committed' || outcome.status === 'no-op') && state.revision < outcome.revision;
        if ((outcome.status === 'outcome-unknown' || waitingForMirror) && guest === owner) { unknownWrite = { guest, intent, recover }; state.pendingPeerWrite = { requestId }; }
        if (waitingForMirror) { notice('Der Gastgeber hat bestätigt. Die lokale Ansicht wird noch synchronisiert; dein Entwurf bleibt bis zur Prüfung erhalten.'); return false; }
        if (outcome.status === 'committed' || outcome.status === 'no-op') return true;
        notice(outcome.status === 'outcome-unknown' ? 'Die Änderung ist noch nicht bestätigt. Bitte vor dem Fortfahren klären.' : outcome.code === 'REVISION_CONFLICT' ? 'Das Dokument wurde währenddessen geändert. Deine Aktion wurde nicht übernommen.' : `Die Änderung wurde abgewiesen (${outcome.code}).`, 'error');
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
  function hit(p: Point) { return [...state.document.elements].reverse().find((e) => hitElement(e, p, 7 / state.viewport.zoom)); }
  function currentCenter() { return screenToDoc(state.viewport, { x: state.viewportSize.width / 2, y: state.viewportSize.height / 2 }); }
  function setSelection(ids: string[], additive = false) {
    state.selection = [...new Set(additive ? [...state.selection, ...ids] : ids)].filter((id) => state.document.elements.some((e) => e.id === id));
    state.focusedId = state.selection.at(-1) ?? null;
    state.liveMessage = describeSelection(selected(), state.document);
  }
  function resetGesture() { gesture = null; state.previewCommand = null; state.drawing = null; state.marquee = null; state.connectorTargets = null; changedDraft(); }
  function moveCommand(base: DocumentSession, ids: readonly string[], dx: number, dy: number): DocumentCommand {
    return { type: 'update', changes: topSelected(base.document.elements, ids).map((e) => ({ id: e.id, patch: { x: e.x + dx, y: e.y + dy } })) };
  }
  async function finishGesture(g: Gesture): Promise<boolean> {
    const owner = activeSession();
    const command = g.element ? { type: 'add' as const, elements: [g.element] } : g.preview;
    if (!command) return true;
    const unchanged = g.targets.every((e) => same(e, state.document.elements.find((current) => current.id === e.id)));
    if (!unchanged) {
      failedGesture = g;
      state.gestureConflict = { message: 'Ein betroffenes Element wurde während der Geste geändert. Die Vorschau bleibt erhalten.', canRetry: g.targets.every((e) => state.document.elements.some((current) => current.id === e.id)) };
      return false;
    }
    const recover = () => { if (gesture === g || failedGesture === g) { if (g.element) { setSelection([g.element.id]); state.tool = 'select'; } resetGesture(); failedGesture = null; state.gestureConflict = null; } };
    const ok = await dispatch(command, state.revision, 'human', recover);
    if (owner !== activeSession()) return false;
    if (ok) {
      if (g.element) { setSelection([g.element.id]); state.tool = 'select'; }
      const editStickyId = g.element?.kind === 'sticky-note' ? g.element.id : null;
      resetGesture(); failedGesture = null; state.gestureConflict = null;
      if (editStickyId) store.startTextEdit(editStickyId);
    } else { failedGesture = g; state.gestureConflict = { message: 'Die Geste wurde nicht übernommen. Deine Vorschau bleibt erhalten.', canRetry: unchanged }; }
    return ok;
  }
  function createDraw(g: Gesture, point: Point, shift: boolean): SketchElement | null {
    if (g.tool === 'select' || g.tool === 'hand' || g.tool === 'text' || g.tool === 'image') return null;
    let end = point;
    if (shift && !['path', 'connector'].includes(g.tool)) {
      const side = Math.max(Math.abs(point.x - g.start.x), Math.abs(point.y - g.start.y));
      end = { x: g.start.x + Math.sign(point.x - g.start.x || 1) * side, y: g.start.y + Math.sign(point.y - g.start.y || 1) * side };
    }
    const points = g.tool === 'path' ? g.points : [g.start, end];
    const rect = g.tool === 'path' ? normalizedRect({ x: Math.min(...points.map((p) => p.x)), y: Math.min(...points.map((p) => p.y)) }, { x: Math.max(...points.map((p) => p.x)), y: Math.max(...points.map((p) => p.y)) }) : normalizedRect(g.start, end);
    const style = { ...DEFAULT_STYLE, ...STYLE_BY_KIND[g.tool] };
    const value: Partial<SketchElement> = { ...rect, style, id: g.element?.id ?? uid(g.tool), ...(SWAPPABLE_KINDS.has(g.tool as SketchElement['kind']) ? { shapeVariant: state.shapeVariant } : {}) };
    if (g.tool === 'sticky-note') value.author = authorName;
    if (g.tool === 'path' || g.tool === 'connector') value.points = points.map((p) => ({ x: p.x - rect.x, y: p.y - rect.y }));
    if (g.tool === 'connector') {
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
    if (edit.composing) { notice('Bitte die laufende Texteingabe zuerst abschließen.', 'error'); return false; }
    if (edit.conflict) { notice(edit.conflict, 'error'); return false; }
    const styleChanges = textStyleChanges(edit);
    const textChanged = edit.draft !== edit.initialText, styleChanged = Object.keys(styleChanges).length > 0;
    if ((!textChanged && !styleChanged) || (!edit.elementId && !edit.draft.trim())) { state.textEdit = null; changedDraft(); return true; }
    const id = edit.elementId ?? uid('text');
    const command: DocumentCommand = edit.elementId
      ? { type: 'update', changes: [{ id, patch: { ...(textChanged ? { text: edit.draft } : {}), ...(styleChanged ? { style: styleChanges } : {}) } }] }
      : { type: 'add', elements: [createElement('text', { id, ...edit.box, text: edit.draft, style: { ...edit.style } })] };
    const now = edit.elementId ? state.document.elements.find((e) => e.id === edit.elementId) : null;
    if (edit.elementId && !same(now, textBase)) { edit.conflict = 'Das Element wurde inzwischen geändert. Bitte den Textkonflikt lösen.'; return false; }
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
    if (!result.ok) { notice('Der Code enthält Fehler. Der Entwurf bleibt erhalten.', 'error'); return false; }
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
    if (unknownWrite || guest?.getStatus().hasUnresolvedOutcome) { notice('Die ausstehende Peer-Änderung ist noch nicht bestätigt. Bitte ihren Ausgang prüfen oder nur den bestätigten Stand behalten.', 'error'); return false; }
    if (inputComposing) { notice('Bitte die laufende Texteingabe zuerst abschließen.', 'error'); return false; }
    if (nudge) store.endNudge();
    await lastWrite;
    if (titleDraft !== state.title) {
      const title = titleDraft.trim();
      if (!title) { notice('Bitte einen Dokumenttitel eingeben oder die Titeländerung verwerfen.', 'error'); return false; }
      if (!await dispatch({ type: 'rename', title })) return false;
      titleDraft = title;
    }
    if (!await applyText()) return false;
    if (!await applyPropertyDraft()) return false;
    if (failedGesture) { notice('Bitte die ausstehende Zeichenänderung zuerst bestätigen oder verwerfen.', 'error'); return false; }
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
      if (result.status === 'saved') { state.file.handle = result.file; state.file.savedRevision = snapshot.revision; notice(`Gespeichert: ${result.file.name}`); return true; }
      if (result.status === 'download-initiated') { state.file.handedOffRevision = snapshot.revision; notice(`Als Download übergeben: ${result.name}`); return true; }
      if (result.status === 'conflict') {
        state.file.conflict = true;
        if (!state.transitioning) state.dialog = { kind: 'save-conflict', message: 'Die Datei wurde außerhalb von Sketchdraw geändert. Deine Änderungen bleiben erhalten.' };
        return false;
      }
      if (result.status === 'error') { state.file.lastError = result.message; notice(`Speichern fehlgeschlagen: ${result.message}`, 'error'); }
      return false;
    } catch (error) { state.file.lastError = error instanceof Error ? error.message : 'Speichern fehlgeschlagen'; fail(error); return false; }
    finally { if (activeSession() === session) state.file.saving = false; }
  }
  function settleTransition(success: boolean) { const resolve = transitionResult; transitionResult = null; pendingGuest = null; resolve?.(success); }
  function releaseTransition() {
    if (barrier) lifecycle().cancelTransition(barrier.token);
    barrier = null; pendingImport = null; state.transitioning = false; settleTransition(false);
  }
  function install(document: SketchDocument, file = freshFile(), nextGuest: GuestSession | null = null) {
    unsubscribe(); unsubscribeStatus();
    const nextSnapshot = nextGuest?.source.getSnapshot();
    if (barrier) lifecycle().completeTransition(barrier.token);
    barrier = null; pendingImport = null;
    guest = nextGuest; authority = nextGuest ? null : factory(createController(document));
    unknownWrite = null; state.pendingPeerWrite = null;
    bindings = {} as typeof bindings; pendingWrites = 0; lastWrite = Promise.resolve();
    state.document = Object.freeze(document); state.revision = nextSnapshot?.revision ?? 0; state.file = file;
    state.selection = []; state.focusedId = null; state.textEdit = null; state.gestureConflict = null; state.propertyDraft = null;
    gesture = null; failedGesture = null; nudge = null; state.previewCommand = null; state.drawing = null;
    titleDraft = document.title; codeBase = document;
    state.code = { text: formatDiagram(document), baseRevision: state.revision, dirty: false, diagnostics: [] };
    state.offscreenChanges = 0; state.dialog = null; state.transitioning = false; changedDraft(); bind();
    for (const listener of authorityListeners) listener(authority);
    store.fitAll(); settleTransition(true);
  }
  async function continueTransition(reason: 'new' | 'open' | 'close' | 'import' | 'join' | 'leave', requestId?: string) {
    const active = barrier;
    if (!active || !lifecycle().isCurrent(active, draftGeneration)) { releaseTransition(); state.dialog = null; notice('Der Stand hat sich geändert. Bitte die Aktion erneut starten.', 'error'); if (reason === 'close' && requestId) await bridge.respondToClose(requestId, 'cancel').catch(fail); return; }
    try {
      if (reason === 'join') {
        if (!pendingGuest || pendingGuest.getStatus().state !== 'ready') throw new Error('Die Peer-Sitzung ist nicht mehr bereit.');
        const next = pendingGuest; install(next.source.getSnapshot().document, { ...freshFile(), requiresInitialSave: true }, next); return;
      }
      if (reason === 'leave') { install(active.snapshot.document, { ...freshFile(), requiresInitialSave: true }); notice('Sitzung verlassen. Die lokale Kopie enthält nur den zuletzt bestätigten Stand.'); return; }
      if (reason === 'import') {
        if (!pendingImport) throw new Error('Die Importvorschau ist nicht mehr verfügbar.');
        install(pendingImport, { ...freshFile(), requiresInitialSave: true }); notice('Importiert. Bitte als Sketchdraw-Datei speichern.'); return;
      }
      if (reason === 'new') { install(createDocument('Unbenannt')); return; }
      if (reason === 'open') {
        const result = await bridge.openDocument();
        if (!lifecycle().isCurrent(active, draftGeneration)) throw new Error('Der Stand hat sich während des Öffnens geändert.');
        if (result.status === 'opened') { const document = deserializeDocument(result.text); install(document, { ...freshFile(), handle: result.file, savedRevision: 0 }); notice(`Geöffnet: ${result.file.name}`); return; }
        if (result.status === 'error') throw new Error(result.message);
        releaseTransition(); state.dialog = null; return;
      }
      if (!requestId) throw new Error('Die Schließanfrage fehlt.');
      await bridge.respondToClose(requestId, 'close');
      if (!lifecycle().isCurrent(active, draftGeneration)) throw new Error('Die Schließanfrage ist nicht mehr aktuell.');
      lifecycle().completeTransition(active.token); state.dialog = null;
    } catch (error) {
      releaseTransition(); state.dialog = null; fail(error);
      if (reason === 'close' && requestId) await bridge.respondToClose(requestId, 'cancel').catch(() => {});
    }
  }
  async function requestTransition(reason: 'new' | 'open' | 'close' | 'import' | 'join' | 'leave', requestId?: string) {
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

  const store: WhiteboardStore = {
    state,
    getAuthority() { return authority; },
    getGuestSession() { return guest; },
    async joinGuestSession(next) {
      if (state.transitioning || next === guest) return false;
      try { if (next.getStatus().state !== 'ready') return false; deserializeDocument(serializeDocument(next.source.getSnapshot().document)); }
      catch (error) { fail(error); return false; }
      pendingGuest = next;
      const result = new Promise<boolean>(resolve => { transitionResult = resolve; });
      void requestTransition('join'); return result;
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
          if (state.revision < outcome.revision) { notice('Die bestätigte Änderung ist noch nicht in der lokalen Ansicht angekommen. Bitte nach der Synchronisation erneut prüfen.'); return; }
          // A receipt clears only its own retained draft; unrelated drafts survive.
          pending.recover();
          unknownWrite = null; state.pendingPeerWrite = null; notice('Die Änderung wurde beim Gastgeber bestätigt.');
        } else if (outcome.status === 'rejected') { unknownWrite = null; state.pendingPeerWrite = null; notice(`Die Änderung wurde abgewiesen (${outcome.code}). Der Entwurf bleibt erhalten.`, 'error'); }
        else notice('Der Ausgang ist weiterhin unbekannt. Kein neuer Schreibversuch wurde gesendet.', 'error');
      } catch (error) { fail(error); }
    },
    subscribeAuthority(listener) { authorityListeners.add(listener); return () => authorityListeners.delete(listener); },
    setTool(tool) {
      if ((!state.canWrite && !['select', 'hand'].includes(tool)) || state.transitioning) return;
      if (state.textEdit) void applyText();
      state.tool = tool;
      if (tool === 'rectangle') state.shapeVariant = 'square';
      if (tool === 'ellipse') state.shapeVariant = 'circle';
      if (tool === 'diamond') state.shapeVariant = 'diamond';
      state.liveMessage = `Werkzeug: ${tool}`;
    },
    setShapeTool(variant) {
      if (!state.canWrite || state.transitioning) return;
      if (state.textEdit) void applyText();
      state.shapeVariant = variant;
      state.tool = shapeBaseKind(variant);
      state.liveMessage = `Formwerkzeug: ${variant}`;
    },
    setViewportSize(width, height) { state.viewportSize = { width, height }; },
    pointerDown(input) {
      lastPointerScreen = { x: input.x, y: input.y };
      if (state.transitioning || state.dialog || state.gestureConflict || pendingWrites > 0) return;
      if (state.textEdit) { void applyText(); return; }
      const point = screenToDoc(state.viewport, input);
      const target = hit(point);
      const handle = state.tool === 'select' ? state.handles.find((h) => Math.hypot(h.x - input.x, h.y - input.y) <= 12) : undefined;
      let kind: Gesture['kind'] = state.tool === 'hand' || spaceHeld || input.button === 1 ? 'pan' : handle ? handle.id === 'rotate' ? 'rotate' : 'resize' : state.tool === 'select' ? target ? 'move' : 'marquee' : 'draw';
      if (!state.canWrite && kind !== 'pan' && kind !== 'marquee') { if (target) setSelection([target.id], input.shiftKey); return; }
      if (input.button !== 0 && input.button !== 1) return;
      if (state.tool === 'text' && kind === 'draw') { store.startTextEdit(); if ((state.textEdit as WhiteboardState['textEdit'])) (state.textEdit as unknown as NonNullable<WhiteboardState['textEdit']>).box = { x: point.x, y: point.y, width: 240, height: 48 }; return; }
      if (state.tool === 'image') return;
      if (state.tool === 'connector' && kind === 'draw' && (!target || target.kind === 'connector')) {
        notice('Beginne den Pfeil auf einem Element. Pfeile verbinden immer zwei Elemente.', 'error');
        return;
      }
      if (kind === 'move' && target) {
        if (input.shiftKey && state.selection.includes(target.id)) { setSelection(state.selection.filter((id) => id !== target.id)); return; }
        if (!state.selection.includes(target.id)) setSelection([target.id], input.shiftKey);
      }
      if (kind === 'marquee' && !input.shiftKey) setSelection([]);
      gesture = { kind, start: point, last: point, screenStart: input, base: snapshotSource().getSnapshot(), targets: state.tool === 'connector' && target ? [clone(target)] : selected().map(clone), handle: handle?.id, tool: state.tool, points: [point], preview: null, element: null,
        ...(state.tool === 'connector' && target ? { connectorFromId: target.id } : {}) };
      if (state.tool === 'connector' && target) state.connectorTargets = { fromId: target.id, toId: null };
      changedDraft();
    },
    pointerMove(input) {
      lastPointerScreen = { x: input.x, y: input.y };
      const g = gesture;
      if (!g || state.transitioning || !state.canWrite && !['pan', 'marquee'].includes(g.kind)) return;
      const point = screenToDoc(state.viewport, input);
      const dx = point.x - g.start.x; const dy = point.y - g.start.y;
      if (g.kind === 'pan') { store.panBy(input.x - g.screenStart.x, input.y - g.screenStart.y); g.screenStart = input; return; }
      if (g.kind === 'marquee') {
        state.marquee = normalizedRect(g.start, point);
        const r = state.marquee;
        setSelection(state.document.elements.filter((e) => { const b = bounds([e])!; return b.x >= r.x && b.y >= r.y && b.x + b.width <= r.x + r.width && b.y + b.height <= r.y + r.height; }).map((e) => e.id));
      } else if (g.kind === 'move') {
        g.preview = moveCommand(g.base, g.targets.map((e) => e.id), dx, dy); state.previewCommand = g.preview;
      } else if (g.kind === 'draw') {
        if (g.tool === 'path' && Math.hypot(point.x - g.last.x, point.y - g.last.y) >= 1 / state.viewport.zoom && g.points.length < DOMAIN_LIMITS.MAX_POINTS_PER_ELEMENT) g.points.push(point);
        g.element = createDraw(g, point, input.shiftKey); state.drawing = g.element;
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
    pointerUp(input) {
      const g = gesture;
      if (!g || state.transitioning || !state.canWrite && !['pan', 'marquee'].includes(g.kind)) return;
      store.pointerMove(input);
      if (g.kind === 'draw' && !g.element && !['path', 'connector'].includes(g.tool)) {
        const size = DEFAULT_SIZES[g.tool];
        if (size) { g.element = createDraw(g, { x: g.start.x + size.width, y: g.start.y + size.height }, false); state.drawing = g.element; }
      }
      if (g.kind === 'draw' && g.tool === 'connector' && (!g.element?.from || !g.element.to)) {
        notice('Ziehe den Pfeil auf ein anderes Element, um die Verbindung abzuschließen.', 'error');
        resetGesture();
        return;
      }
      if (g.kind === 'pan' || g.kind === 'marquee' || (!g.preview && !g.element)) { resetGesture(); return; }
      if (g.kind === 'draw' && g.element && g.element.width + g.element.height < 4) { resetGesture(); return; }
      void finishGesture(g);
    },
    pointerCancel() { if (state.transitioning) return; resetGesture(); },
    doubleClick(input) { if (!state.canWrite || state.transitioning) return; const e = hit(screenToDoc(state.viewport, input)); if (e) store.startTextEdit(e.id); },
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
        'edit.group': store.groupSelection, 'edit.ungroup': store.ungroupSelection, 'edit.delete': store.deleteSelection, 'edit.text': () => store.startTextEdit(state.selection[0]),
        'view.zoom-in': () => store.zoomBy(1.2), 'view.zoom-out': () => store.zoomBy(1 / 1.2), 'view.zoom-reset': () => store.zoomTo(1),
        'view.fit-all': store.fitAll, 'view.fit-selection': store.fitSelection, 'view.help': store.openHelp, 'view.objects': store.toggleObjects,
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
    deleteSelection() { if (!state.transitioning && state.selection.length) void dispatch({ type: 'delete', ids: [...state.selection] }); },
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
      notice(written ? `${payload.elements.length} Element${payload.elements.length === 1 ? '' : 'e'} kopiert.` : `${payload.elements.length} Element${payload.elements.length === 1 ? '' : 'e'} intern kopiert.`);
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
      if (!payload) { notice('Die Zwischenablage enthält keine Sketchdraw-Elemente.', 'error'); return; }
      try {
        const at = lastPointerScreen ? screenToDoc(state.viewport, lastPointerScreen) : currentCenter();
        const plan = planElementPaste(payload, state.document, at, uid);
        if (await dispatch(plan.command, revision)) {
          setSelection(plan.selection);
          state.tool = 'select';
          state.liveMessage = `${plan.selection.length} Element${plan.selection.length === 1 ? '' : 'e'} eingefügt.`;
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
      const e = createElement('connector', { ...rect, points: [start, end].map((p) => ({ x: p.x - rect.x, y: p.y - rect.y })), from: { elementId: a.id, anchor: { x: 1, y: .5 } }, to: { elementId: b.id, anchor: { x: 0, y: .5 } }, style: { ...DEFAULT_STYLE } });
      void dispatch({ type: 'add', elements: [e] }).then((ok) => { if (ok) setSelection([e.id]); });
    },
    replaceShape(variant) {
      if (!state.canWrite || state.transitioning) return;
      const targets = selected().filter((e) => SWAPPABLE_KINDS.has(e.kind) && effectiveShapeVariant(e) !== variant);
      if (!targets.length) return;
      void dispatch({ type: 'update', changes: targets.map((element) => ({ id: element.id, patch: { shapeVariant: variant } })) });
    },
    quickConnect(direction) {
      if (!state.canWrite || state.transitioning || state.selection.length !== 1) return;
      const source = selected()[0];
      if (!source || !QUICK_CONNECT_KINDS.has(source.kind)) return;
      const plan = planQuickConnect(source, direction, state.document.elements);
      try {
        const shape = createElement(source.kind, { id: uid(source.kind), ...quickConnectCopy(source, plan.shape) });
        const rect = normalizedRect(plan.start, plan.end);
        const arrow = createElement('connector', { id: uid('connector'), ...rect, points: [plan.start, plan.end].map((p) => ({ x: p.x - rect.x, y: p.y - rect.y })), from: { elementId: source.id, anchor: plan.fromAnchor }, to: { elementId: shape.id, anchor: plan.toAnchor }, style: { ...DEFAULT_STYLE } });
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
      if (previous && !same(previous.ids, state.selection)) { notice('Bitte den offenen Eigenschaftenentwurf zuerst übernehmen oder verwerfen.', 'error'); return; }
      state.propertyDraft = { baseRevision: previous?.baseRevision ?? state.revision, ids: [...state.selection], patch: { ...previous?.patch, ...value, ...((previous?.patch.style || value.style) ? { style: { ...previous?.patch.style, ...value.style } } : {}) } };
      changedDraft();
    },
    commitPropertyDraft() { return state.transitioning ? Promise.resolve(false) : applyPropertyDraft(); },
    discardPropertyDraft() { if (!state.transitioning && !unknownWrite) { state.propertyDraft = null; changedDraft(); } },
    applyPatch(value) { if (!state.transitioning) patch(selected().map((e) => ({ id: e.id, patch: value }))); },
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
      textBase = e ? clone(e) : null; textRevision = state.revision;
      const point = currentCenter();
      state.textEdit = { elementId: e?.id ?? null, kind: e?.kind ?? 'text', box: e ? { x: e.x, y: e.y, width: Math.max(120, e.width), height: Math.max(48, e.height) } : { x: point.x, y: point.y, width: 240, height: 48 }, rotation: e?.rotation ?? 0, style: { ...(e?.style ?? DEFAULT_STYLE) }, initialStyle: { ...(e?.style ?? DEFAULT_STYLE) }, initialText: e?.text ?? '', draft: e?.text ?? '', composing: false, conflict: null }; changedDraft();
    },
    setTextDraft(text) { if (state.canWrite && state.textEdit && !state.transitioning) { state.textEdit.draft = text; changedDraft(); } },
    setComposing(composing) { if (state.textEdit) { state.textEdit.composing = composing; changedDraft(); } },
    commitTextEdit() { if (state.textEdit?.composing || state.transitioning) return false; void applyText(); return true; },
    cancelTextEdit() { if (!state.transitioning && !unknownWrite) { state.textEdit = null; changedDraft(); } },
    resolveTextConflict(choice) {
      const edit = state.textEdit; if (!edit || state.transitioning || unknownWrite) return;
      if (choice === 'use-current') { state.textEdit = null; changedDraft(); return; }
      if (choice === 'insert-new') { edit.elementId = null; edit.kind = 'text'; textBase = null; }
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
    async insertImageFile(file, at) {
      if (state.transitioning) return;
      if (!['image/png', 'image/jpeg', 'image/webp'].includes(file.type)) { notice('Erlaubt sind PNG, JPEG und WebP.', 'error'); return; }
      if (file.size > DOMAIN_LIMITS.MAX_ASSET_BYTES) { notice('Das Bild ist zu groß (maximal 8 MB).', 'error'); return; }
      const owner = activeSession(); const revision = state.revision;
      try {
        const dataUrl = await new Promise<string>((resolve, reject) => { const reader = new FileReader(); reader.onload = () => resolve(String(reader.result)); reader.onerror = reject; reader.readAsDataURL(file); });
        const image = new Image(); image.src = dataUrl; await image.decode();
        if (activeSession() !== owner || state.transitioning) { notice('Das Bild wurde nicht eingefügt, weil das Dokument gewechselt hat.'); return; }
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
      if (format !== 'sketchdraw') { notice('Dieses Austauschformat ist noch nicht angebunden.', 'error'); return; }
      try {
        if (!await prepareDrafts()) return;
        const result = await bridge.exportFile(serializeDocument(state.document), suggestFileName(state.title), format);
        if (result.status === 'error') fail(new Error(result.message));
        else if (result.status !== 'cancelled') notice(result.status === 'exported' ? `Exportiert: ${result.name}` : `Als Download übergeben: ${result.name}`);
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
        if (!prepared || !await saveFile(false, barrier.snapshot)) { dialog.busy = false; dialog.error = state.file.conflict ? 'Speicherkonflikt. Abbrechen und über „Speichern unter“ eine Kopie anlegen.' : 'Nicht gespeichert. Entwürfe und Dokument bleiben erhalten.'; return; }
      }
      await continueTransition(dialog.reason, dialog.requestId);
      } catch (error) { releaseTransition(); state.dialog = null; fail(error); if (dialog.reason === 'close' && dialog.requestId) await bridge.respondToClose(dialog.requestId, 'cancel').catch(fail); }
    },
    openHelp() { if (!state.transitioning) state.dialog = { kind: 'help' }; },
    closeDialog() { if (state.dialog?.kind === 'unsaved') void store.resolveDialog('cancel'); else state.dialog = null; },
    toggleObjects(open) { state.objectsOpen = open ?? !state.objectsOpen; },
    selectPage(id) { if (state.pages.some((page) => page.id === id)) state.activePageId = id; },
    // Structural page mutations stay unavailable until the multi-page schema (#34) lands.
    addPage() {},
    renamePage(id, name) {
      const next = name.trim();
      if (!state.canWrite || state.transitioning || id !== SINGLE_PAGE_ID || !next || next.length > MAX_PAGE_NAME_LENGTH) return;
      const current = state.pages[0]?.name;
      if (next === current) return;
      void dispatch({
        type: 'set-metadata',
        patch: { [SINGLE_PAGE_NAME_METADATA_KEY]: next === SINGLE_PAGE_NAME ? null : next },
      });
    },
    duplicatePage() {},
    deletePage() {},
    movePage() {},
    async copyPage(id) {
      const page = state.pages.find((entry) => entry.id === id);
      if (!page) return;
      try {
        await navigator.clipboard.writeText(JSON.stringify(pageClipboardPayload(page.name, state.document.elements, state.document.assets)));
        notice(`Inhalt von „${page.name}“ kopiert.`);
      } catch { notice('Die Zwischenablage ist nicht verfügbar. Der Seiteninhalt wurde nicht kopiert.', 'error'); }
    },
    async pastePage() {},
    togglePropertiesCollapsed(collapsed) { state.propertiesCollapsed = collapsed ?? !state.propertiesCollapsed; },
    setTheme(theme) { state.theme = theme; },
    dismissNotice(id) { state.notices = state.notices.filter((notice) => notice.id !== id); },
    async openDocumentationLink(url) { try { await bridge.openExternal(url); } catch (error) { fail(error); } },
    toggleCode() { state.codeOpen = !state.codeOpen; if (state.codeOpen) state.catalogOpen = false; },
    setCodeDraft(text) { if (state.canWrite && !state.transitioning) { state.code.text = text; state.code.dirty = text !== formatDiagram(codeBase); state.code.diagnostics = []; changedDraft(); } },
    applyCode() { return state.transitioning ? Promise.resolve(false) : applyCode(); },
    resetCodeDraft() { if (!state.transitioning && !unknownWrite) { codeBase = state.document; state.code = { text: formatDiagram(state.document), baseRevision: state.revision, dirty: false, diagnostics: [] }; changedDraft(); } },
    toggleCatalog() { state.catalogOpen = !state.catalogOpen; if (state.catalogOpen) state.codeOpen = false; },
    async insertComponent(set: ComponentSet, type: string) {
      if (state.transitioning) return;
      try { const { element, command } = instantiateComponent(state.document, { set, type, id: uid('component'), at: currentCenter() }); if (await dispatch(command)) { setSelection([element.id]); state.tool = 'select'; } }
      catch (error) { fail(error); }
    },
    async importComponentSet(file) {
      if (state.transitioning) return;
      const owner = activeSession(); const revision = state.revision;
      try { if (file.size > 2 * 1024 * 1024) throw new Error('Das Komponentenset ist zu groß (maximal 2 MB).'); const set = parseComponentSet(await file.text()); if (owner !== activeSession() || state.transitioning) return; const command = prepareComponentSetImport(state.document, set); if (command) await dispatch(command, revision, 'import'); }
      catch (error) { fail(error); }
    },
    whenIdle() { return lastWrite; },
    needsCloseWarning() { return needsClosePrompt(state.file, state.revision, state.hasDraft) || pendingWrites > 0 || Boolean(unknownWrite) || guest?.getStatus().hasUnresolvedOutcome === true; },
    dispose() { disposed = true; settleTransition(false); authorityListeners.clear(); unsubscribe(); unsubscribeStatus(); if (guest) void guest.leave(); unsubscribeClose(); unsubscribeMenu(); for (const binding of Object.values(bindings)) { try { authority?.revokeBinding(binding.bindingId); } catch (error) { if (!(error instanceof SessionAccessError && error.code === 'SESSION_CHANGED')) throw error; } } },
  };
  const unsubscribeClose = bridge.onCloseRequested((requestId) => { void requestTransition('close', requestId); });
  const unsubscribeMenu = bridge.onMenuCommand((command) => {
    const active = typeof document === 'undefined' ? null : document.activeElement;
    if ((command === 'undo' || command === 'redo') && active?.matches('input, textarea, [contenteditable="true"]')) { document.execCommand(command); return; }
    if (command === 'save') void store.save(); else if (command === 'save-as') void store.saveAs(); else if (command === 'open') void store.openDocument(); else if (command === 'undo') store.undo(); else if (command === 'redo') store.redo();
  });
  return store;
}

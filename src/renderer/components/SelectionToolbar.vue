<script setup lang="ts">
import { L, t } from '@/renderer/i18n';
import { computed, nextTick, ref, useId, watch } from 'vue';
import { useEventListener, useResizeObserver } from '@vueuse/core';
import AppIcon from './AppIcon.vue';
import type { IconName } from './icons';
import { useWhiteboard } from './use-whiteboard';
import { useHorizontalOverflow } from './use-horizontal-overflow';
import { effectiveShapeVariant, parseWebEmbedUrl, webEmbedLabel, type ConnectorMarker, type ConnectorRouting, type ElementPatch, type ElementStyle } from '@/domain';
import ColorPalette from './ColorPalette.vue';
import { fillMode, NO_COLOR, normalizeHex, withFillMode, type FillMode } from '@/renderer/lib/color';
import { docToScreen } from '@/renderer/lib/viewport';
import { FONT_FAMILY_CSS } from '@/renderer/lib/constants';
import { bulletsActive, toggleBullets } from '@/renderer/lib/bullets';
import { ROUNDABLE_POLYGONS } from '@/renderer/lib/geometry';
import { matchesShape, SHAPE_CATALOG, SWAPPABLE_KINDS, type ShapeEntry } from '@/renderer/lib/shapes';
import { isResourceCard } from '@/catalog';
import ResourceCardEditor from './ResourceCardEditor.vue';
import ConnectorMarkerIcon from './ConnectorMarkerIcon.vue';
import { dispatchAnnotationFormat, type AnnotationFormatCommand } from '@/renderer/lib/annotation';

type Segment = 'shape' | 'radius' | 'color' | 'text-color' | 'line' | 'font' | 'size' | 'table' | 'link' | 'resource' | 'author' | 'align' | 'more' | 'actions' | 'route' | 'start' | 'end';

const store = useWhiteboard();
const s = store.state;
const uid = useId();
const info = computed(() => s.selectionInfo);
const single = computed(() => s.document.elements.find((e) => e.id === info.value.singleId));
const definition = computed(() => s.document.componentSets.flatMap((set) => set.components).find((c) => c.type === single.value?.componentType));

const SIZE_PRESETS = [{ label: L('Klein'), value: 14 }, { label: L('Mittel'), value: 20 }, { label: L('Groß'), value: 28 }, { label: L('Sehr groß'), value: 40 }] as const;
const HEADING_LEVELS = [1, 2, 3, 4] as const;
const ALIGNMENTS: ReadonlyArray<{ value: ElementStyle['textAlign']; label: string; icon: IconName }> = [
  { value: 'left', label: L('Links'), icon: 'align-left' },
  { value: 'center', label: L('Mitte'), icon: 'align-center' },
  { value: 'right', label: L('Rechts'), icon: 'align-right' },
];
const FILL_MODES: ReadonlyArray<{ value: FillMode; label: string }> = [
  { value: 'fill', label: L('Füllung') },
  { value: 'semi', label: L('Transparent') },
  { value: 'none', label: L('Keine Füllung') },
];
type LineMode = 'solid' | 'dashed' | 'animated' | 'none';
const LINE_MODES: ReadonlyArray<{ value: LineMode; label: string; icon: IconName }> = [
  { value: 'solid', label: L('Durchgezogen'), icon: 'line-solid' },
  { value: 'dashed', label: L('Gestrichelt'), icon: 'line-dashed' },
  { value: 'animated', label: L('Animiert'), icon: 'line-animated' },
  { value: 'none', label: L('Keine'), icon: 'none' },
];
const WIDTHS = [{ value: 1, label: L('Dünn') }, { value: 2, label: L('Mittel') }, { value: 4, label: L('Dick') }] as const;
const CONNECTOR_WIDTHS = [{ value: 2, label: L('Dünn') }, { value: 4, label: L('Dick') }] as const;
const ROUTES: ReadonlyArray<{ value: ConnectorRouting; label: string }> = [
  { value: 'elbowed', label: L('Rechtwinklig') }, { value: 'curved', label: L('Gebogen') }, { value: 'straight', label: L('Gerade') },
];
const MARKERS: ReadonlyArray<{ value: ConnectorMarker; label: string }> = [
  { value: 'none', label: L('Keine') }, { value: 'line-arrow', label: L('Linienpfeil') },
  { value: 'solid-arrow', label: L('Gefüllter Pfeil') }, { value: 'triangle', label: L('Dreieck') },
  { value: 'solid-triangle', label: L('Gefülltes Dreieck') }, { value: 'reverse-triangle', label: L('Umgekehrtes Dreieck') },
  { value: 'circle', label: L('Kreis') }, { value: 'solid-circle', label: L('Gefüllter Kreis') },
  { value: 'diamond', label: L('Raute') }, { value: 'zero-or-one', label: L('Null oder eins') },
  { value: 'exactly-one', label: L('Genau eins') }, { value: 'zero-or-many', label: L('Null oder viele') },
  { value: 'one-or-many', label: L('Eins oder viele') }, { value: 'many', label: L('Viele') },
];

// --- Visibility and placement ----------------------------------------------------
/** #44: the bar stays usable while the selected element's text is edited; style changes go to the text draft. */
const editing = computed(() => Boolean(s.textEdit));
const textEditAllowsBar = computed(() => !s.textEdit || (s.textEdit.elementId !== null && s.textEdit.elementId === info.value.singleId));
const visible = computed(() => Boolean(info.value.count && s.frame && s.canWrite && !s.transitioning && textEditAllowsBar.value && !s.hasElementPreview && !s.draftElement && !s.marquee));
const connectorOnly = computed(() => info.value.count === 1 && info.value.kinds.length === 1 && info.value.kinds[0] === 'connector');
const stickyOnly = computed(() => info.value.count === 1 && info.value.kinds.length === 1 && info.value.kinds[0] === 'sticky-note');
const stickyTaskExists = computed(() => Boolean(single.value && (s.document.tasks ?? []).some((task) => task.sourceElementId === single.value?.id)));
const resourceCardOnly = computed(() => info.value.count === 1 && isResourceCard(single.value));
const annotationOnly = computed(() => info.value.count === 1 && info.value.kinds.length === 1 && info.value.kinds[0] === 'annotation');
const tableOnly = computed(() => info.value.count === 1 && info.value.kinds.length === 1 && info.value.kinds[0] === 'table');
const webEmbedOnly = computed(() => info.value.count === 1 && info.value.kinds.length === 1 && info.value.kinds[0] === 'web-embed');
/** Corner radius applies when every selected element is a rounded rectangle. */
const selectedElements = computed(() => s.document.elements.filter((element) => s.selection.includes(element.id)));
const roundedOnly = computed(() => selectedElements.value.length > 0 && selectedElements.value.every((element) => { const variant = effectiveShapeVariant(element); return variant === 'rounded' || (variant != null && ROUNDABLE_POLYGONS.includes(variant)); }));
const radiusMax = computed(() => Math.max(1, Math.floor(Math.min(...selectedElements.value.map((element) => Math.min(element.width, element.height))) / 2)));
/** Rounded rectangles start with a soft corner; diamond and triangles start sharp. */
const defaultRadius = computed(() => selectedElements.value.every((element) => effectiveShapeVariant(element) === 'rounded') ? Math.round(Math.min(...selectedElements.value.map((element) => Math.min(element.width, element.height))) / 6) : 0);
const radiusValue = computed(() => Math.min(radiusMax.value, Math.round(info.value.values.cornerRadius ?? defaultRadius.value)));
const radiusMixed = computed(() => info.value.mixed.includes('cornerRadius'));
/** Live preview through the property draft; committed once on release (same flow as the font size). */
function setRadius(value: number): void { if (Number.isFinite(value)) store.setPropertyDraft({ style: { cornerRadius: Math.max(0, Math.min(radiusMax.value, Math.round(value))) } }); }
function commitRadius(): void { void store.commitPropertyDraft(); }
const textCapable = computed(() => !resourceCardOnly.value && !annotationOnly.value && info.value.kinds.some((kind) => !['image', 'path', 'connector', 'web-embed'].includes(kind)));
const textColorCapable = computed(() => !resourceCardOnly.value && info.value.kinds.some((kind) => !['image', 'path', 'web-embed', 'frame'].includes(kind)));

const bar = ref<HTMLElement | null>(null);
const barTrack = ref<HTMLElement | null>(null);
const { start: overflowStart, end: overflowEnd, page: pageBar, reveal: revealControl } = useHorizontalOverflow(barTrack);
const barSize = ref({ width: 0, height: 56 });
/** The bar stays invisible until its width is known, so it never jumps sideways on first paint. */
const measured = ref(false);
watch(bar, (element) => {
  measured.value = false;
  if (!element) return;
  barSize.value = { width: element.offsetWidth, height: element.offsetHeight };
  measured.value = true;
});
useResizeObserver(bar, ([entry]) => {
  const element = entry?.target;
  if (!(element instanceof HTMLElement)) return;
  barSize.value = { width: element.offsetWidth, height: element.offsetHeight };
  measured.value = true;
});

/** Top edge of the rotated selection frame in canvas-local coordinates (same space as `position`). */
function selectionTopLocal(): number | null {
  const frame = s.frame;
  if (!frame) return null;
  const angle = (frame.rotation * Math.PI) / 180;
  const extentY = Math.abs((frame.width / 2) * Math.sin(angle)) + Math.abs((frame.height / 2) * Math.cos(angle));
  return docToScreen(s.viewport, { x: frame.cx, y: frame.cy - extentY }).y;
}

/** Centered over the selection, below it when the top chrome leaves no room, always inside the canvas. */
const position = computed(() => {
  const frame = s.frame;
  if (!frame) return { left: 0, top: 0 };
  const angle = (frame.rotation * Math.PI) / 180;
  const extentY = Math.abs((frame.width / 2) * Math.sin(angle)) + Math.abs((frame.height / 2) * Math.cos(angle));
  const top = docToScreen(s.viewport, { x: frame.cx, y: frame.cy - extentY });
  const bottom = docToScreen(s.viewport, { x: frame.cx, y: frame.cy + extentY });
  const { width, height } = barSize.value;
  const toolOptionsOpen = s.tool === 'path' || s.tool === 'eraser' || s.tool === 'connector';
  const minTop = s.viewportSize.width <= 1040 ? (toolOptionsOpen ? 216 : 144) : (toolOptionsOpen ? 148 : 80);
  const gap = 48;
  let y = top.y - gap - height;
  if (y < minTop) y = bottom.y + gap;
  y = Math.max(minTop, Math.min(y, s.viewportSize.height - height - 84));
  const x = Math.max(12, Math.min(top.x - width / 2, s.viewportSize.width - width - 12));
  return { left: x, top: y };
});

// --- Popovers ----------------------------------------------------------------------
const openSegment = ref<Segment | null>(null);
const triggers = ref<Partial<Record<Segment, HTMLButtonElement>>>({});
const popover = ref<HTMLElement | null>(null);
const popoverAt = ref({ left: 0, top: 0, maxHeight: 0 });

function setTrigger(segment: Segment, element: unknown): void {
  if (element instanceof HTMLButtonElement) triggers.value[segment] = element;
}

async function toggle(segment: Segment): Promise<void> {
  if (openSegment.value === segment) { close(true); return; }
  openSegment.value = segment;
  await nextTick();
  placePopover();
  popover.value?.querySelector<HTMLElement>('input, select, textarea, button:not(:disabled)')?.focus();
}

/**
 * Opens on the same side as the context bar, so the popover never covers the selected shape: above the
 * selection (8 px above the higher of bar and selection top) while the bar sits above it, and 8 px below
 * the bar once the bar is pushed below the selection for lack of room. When the preferred side cannot show
 * even one row, it opens on the side of the bar with more room instead of off-screen (#86). Clamped to the
 * viewport and scrolls internally when tight. Reads live rects, so every recompute reflects the current
 * viewport (zoom/pan/scroll).
 */
function placePopover(): void {
  const trigger = openSegment.value ? triggers.value[openSegment.value] : null;
  const box = popover.value?.getBoundingClientRect();
  const barBox = bar.value?.getBoundingClientRect();
  if (!trigger || !box || !barBox) return;
  const rect = trigger.getBoundingClientRect();
  const left = Math.max(8, Math.min(rect.left, window.innerWidth - box.width - 8));
  // Convert the selection's top edge from canvas-local to window coordinates via the bar's own offset.
  const selTopLocal = selectionTopLocal();
  const windowOffset = barBox.top - position.value.top;
  const selectionTop = selTopLocal === null ? barBox.top : selTopLocal + windowOffset;
  const natural = (popover.value?.scrollHeight ?? box.height) + 2; // unclamped height, even after an earlier max-height
  const belowBar = Math.max(0, window.innerHeight - barBox.bottom - 16); // 8 px gap + 8 px bottom margin
  const placeBelow = () => { popoverAt.value = { left, top: barBox.bottom + 8, maxHeight: belowBar }; };
  // Above the anchor the popover must not reach under the top chrome (tool bars), so only the space below it counts.
  const topLimit = s.viewportSize.width <= 1040 ? 144 : 80;
  const anchorTop = Math.min(barBox.top, selectionTop);
  const spaceAbove = Math.max(0, anchorTop - 8 - topLimit);
  const placeAbove = () => { popoverAt.value = { left, top: anchorTop - 8 - Math.min(natural, spaceAbove), maxHeight: spaceAbove }; };
  const barBelowSelection = barBox.top > selectionTop;
  // Preferred side first; when the popover would not fit completely there, open on the other side of the bar (#86).
  const preferredFits = barBelowSelection ? belowBar >= natural : spaceAbove >= natural;
  const otherFits = barBelowSelection ? spaceAbove >= natural : belowBar >= natural;
  if (preferredFits) { barBelowSelection ? placeBelow() : placeAbove(); return; }
  if (otherFits) { barBelowSelection ? placeAbove() : placeBelow(); return; }
  // Neither side shows it completely: use the larger one and scroll inside.
  if (belowBar >= spaceAbove) placeBelow(); else placeAbove();
}

function close(returnFocus: boolean): void {
  const segment = openSegment.value;
  openSegment.value = null;
  if (returnFocus && segment) triggers.value[segment]?.focus();
}

watch(() => s.selection.join('|'), () => close(false));
watch(visible, (value) => { if (!value) close(false); });

/** Keep an open popover anchored when the selection frame, viewport (zoom/pan) or bar size changes. */
watch([position, barSize], () => { if (openSegment.value) void nextTick(placePopover); }, { deep: true });

/** Document scroll and window resize can move the bar on screen without touching the viewport state. */
function onViewportShift(): void { if (openSegment.value) placePopover(); }
useEventListener(window, 'scroll', onViewportShift, true);
useEventListener(window, 'resize', onViewportShift);

/** Only the canvas dismisses a popover; notices and draft recovery stay usable next to it. */
function onDocumentPointerDown(event: PointerEvent): void {
  if (openSegment.value && event.target instanceof Element && event.target.closest('[data-testid="whiteboard-canvas"]')) close(false);
}

function onKeydown(event: KeyboardEvent): void {
  if (event.key === 'Escape' && openSegment.value) {
    event.preventDefault();
    event.stopPropagation();
    close(true);
  }
}

function onBarKeydown(event: KeyboardEvent): void {
  if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
  const buttons = Array.from(barTrack.value?.querySelectorAll<HTMLButtonElement>(':scope > .segment:not(:disabled), :scope > .tool-btn:not(:disabled)') ?? []);
  const index = buttons.findIndex((button) => button === document.activeElement);
  if (index < 0) return;
  event.preventDefault();
  buttons[(index + (event.key === 'ArrowRight' ? 1 : -1) + buttons.length) % buttons.length]?.focus();
}

useEventListener(document, 'pointerdown', onDocumentPointerDown, true);

// --- Values --------------------------------------------------------------------------
function style(patch: Partial<ElementStyle>): void {
  if (tableOnly.value) {
    store.formatTableSelection({
      ...(patch.fill !== undefined && patch.fill !== 'transparent' ? { fill: patch.fill } : {}),
      ...(patch.stroke !== undefined && patch.stroke !== 'transparent' ? { color: patch.stroke } : {}),
      ...(patch.textColor !== undefined && patch.textColor !== 'transparent' ? { color: patch.textColor } : {}),
      ...(patch.fontSize !== undefined ? { fontSize: patch.fontSize } : {}),
      ...(patch.fontFamily !== undefined ? { fontFamily: patch.fontFamily } : {}),
      ...(patch.fontWeight !== undefined ? { fontWeight: patch.fontWeight } : {}),
      ...(patch.textDecoration !== undefined ? { textDecoration: patch.textDecoration } : {}),
      ...(patch.listStyle !== undefined ? { listStyle: patch.listStyle } : {}),
      ...(patch.textAlign !== undefined ? { textAlign: patch.textAlign } : {}),
    });
    return;
  }
  // While the text is edited, style changes live in the text draft and are committed together with the text.
  if (s.textEdit) store.setPropertyDraft({ style: patch });
  else store.applyPatch({ style: patch });
}
function setFontSize(value: number): void {
  if (!Number.isFinite(value)) return;
  if (!tableOnly.value) store.setPropertyDraft({ style: { fontSize: value } });
}
function commitFontSize(value: number): void { if (tableOnly.value) style({ fontSize: value }); else void store.commitPropertyDraft(); }
function connectorPatch(patch: ElementPatch): void { if (!editing.value) store.applyPatch(patch); }
function unavailable(label: string): string { return editing.value ? t('{label} (während der Textbearbeitung nicht verfügbar)', { label }) : label; }
// Document-level actions are unavailable during text editing; close their popovers.
watch(editing, (value) => { if (value && openSegment.value && ['shape', 'radius', 'link', 'resource', 'more', 'actions'].includes(openSegment.value)) close(false); });
function widget(key: string, value: string): void {
  if (single.value) store.setPropertyDraft({ metadata: { ...single.value.metadata, [`widget:${single.value.componentType}:${key}`]: value } });
}

const swatchColor = computed(() => {
  const fill = info.value.values.fill;
  return info.value.hasFill && fill && fill !== 'transparent' ? fill : info.value.values.stroke ?? '#1e1e1e';
});
const markerLabel = (value: ConnectorMarker | undefined) => t(MARKERS.find((entry) => entry.value === value)?.label ?? 'Keine');
const routeLabel = computed(() => t(ROUTES.find((entry) => entry.value === info.value.values.connectorRouting)?.label ?? 'Gerade'));
const sizeLabel = computed(() => {
  if (info.value.mixed.includes('fontSize')) return t('Gemischt');
  const size = info.value.values.fontSize ?? 20;
  return t(SIZE_PRESETS.find((preset) => preset.value === size)?.label ?? `${size} px`);
});
const alignIcon = computed<IconName>(() => ALIGNMENTS.find((a) => a.value === info.value.values.textAlign)?.icon ?? 'align-left');
type FontFamilyValue = 'sans' | 'roboto' | 'scribbled' | 'mono';
const FONT_OPTIONS: readonly { value: FontFamilyValue; label: string }[] = [
  { value: 'sans', label: L('Inter (Serifenlos)') },
  { value: 'roboto', label: L('Roboto (Sans Serif)') },
  { value: 'scribbled', label: 'Scribbled' },
  { value: 'mono', label: 'JetBrains Mono (Monospace)' },
];
const fontMixed = computed(() => info.value.mixed.includes('fontFamily'));
const currentFont = computed<FontFamilyValue>(() => (info.value.values.fontFamily as FontFamilyValue | undefined) ?? 'sans');
const fontGlyphStyle = computed(() => ({ fontFamily: FONT_FAMILY_CSS[currentFont.value], fontStyle: 'normal' }));
const linkDraft = ref('');
watch(() => webEmbedOnly.value ? single.value?.embedUrl : single.value?.documentationUrl, (url) => { linkDraft.value = url ?? ''; }, { immediate: true });
function saveLink(): void {
  const url = linkDraft.value.trim();
  const current = webEmbedOnly.value ? single.value?.embedUrl : single.value?.documentationUrl;
  if (url === (current ?? '') || (webEmbedOnly.value && !url)) return;
  if (webEmbedOnly.value) {
    const parsed = parseWebEmbedUrl(url);
    if (!parsed.ok) return;
    linkDraft.value = parsed.url;
    store.applyPatch({ embedUrl: parsed.url, label: webEmbedLabel(parsed.url) });
  } else store.applyPatch({ documentationUrl: url || null });
}
// Bullet list for sticky notes: only the selected lines of the text get the bullet (the caret line without a selection).
const selectionTick = ref(0);
useEventListener(document, 'selectionchange', () => { if (s.textEdit) selectionTick.value += 1; });
const stickyEditor = (): HTMLTextAreaElement | null => document.querySelector<HTMLTextAreaElement>('[data-testid="canvas-text-editor"]');
const stickyBulletsActive = computed(() => {
  void selectionTick.value;
  const editor = s.textEdit ? stickyEditor() : null;
  if (s.textEdit) return editor ? bulletsActive(s.textEdit.draft, editor.selectionStart, editor.selectionEnd) : false;
  const text = single.value?.text ?? '';
  return bulletsActive(text, 0, text.length);
});
function toggleStickyBullets(): void {
  const editor = s.textEdit ? stickyEditor() : null;
  if (s.textEdit && editor) {
    const result = toggleBullets(s.textEdit.draft, editor.selectionStart, editor.selectionEnd);
    store.setTextDraft(result.text);
    void nextTick(() => { editor.focus(); editor.setSelectionRange(result.start, result.end); selectionTick.value += 1; });
    return;
  }
  const text = single.value?.text ?? '';
  const result = toggleBullets(text, 0, text.length);
  store.applyPatch({ text: result.text });
}
const authorDraft = ref('');
watch(() => single.value?.author, (author) => { authorDraft.value = author ?? ''; }, { immediate: true });
function saveAuthor(): void {
  const author = authorDraft.value.trim();
  if (s.textEdit) { store.setTextAuthor(author || null); return; }
  if (author === (single.value?.author ?? '')) return;
  store.applyPatch({ author: author || null });
}
const panelId = (segment: Segment) => `${uid}-${segment}`;

// --- Selection actions -------------------------------------------------------------
const selectedIds = computed(() => new Set(s.selection));
const canMoveBackward = computed(() => s.document.elements.some((element, index, elements) => (
  selectedIds.value.has(element.id) && index > 0 && !selectedIds.value.has(elements[index - 1]!.id)
)));
const canMoveForward = computed(() => s.document.elements.some((element, index, elements) => (
  selectedIds.value.has(element.id) && index < elements.length - 1 && !selectedIds.value.has(elements[index + 1]!.id)
)));
function runSelectionAction(action: 'back' | 'backward' | 'forward' | 'front' | 'clone' | 'delete'): void {
  if (editing.value) return;
  if (action === 'delete') {
    close(false);
    store.deleteSelection();
    return;
  }
  close(true);
  if (action === 'clone') store.duplicateSelection();
  else store.reorder(action);
}
async function createStickyTask(): Promise<void> {
  const elementId = info.value.singleId;
  if (!elementId || stickyTaskExists.value) return;
  if (editing.value) {
    if (!store.commitTextEdit()) return;
    await store.whenIdle();
  }
  await store.createTaskFromStickyNote(elementId);
}

// --- Shape swap (#40) ------------------------------------------------------------------
const shapeQuery = ref('');
const swappable = computed(() => info.value.kinds.length > 0 && info.value.kinds.every((kind) => SWAPPABLE_KINDS.has(kind)));
const currentShape = computed(() => SHAPE_CATALOG.find((entry) => entry.id === (single.value ? effectiveShapeVariant(single.value) : null)) ?? SHAPE_CATALOG[1]);
const shapes = computed(() => SHAPE_CATALOG.filter((entry) => matchesShape(entry, shapeQuery.value)));
watch(openSegment, () => { shapeQuery.value = ''; });
function pickShape(entry: ShapeEntry): void {
  store.replaceShape(entry.id);
  close(true);
}

// --- Fill and line modes (#38) ------------------------------------------------------
const lastFill = ref('#f6c9c4');
const lastStroke = ref('#1e1e1e');
const currentFillMode = computed(() => fillMode(info.value.values.fill));
const fillBase = computed(() => (currentFillMode.value === 'none' ? null : normalizeHex(info.value.values.fill ?? '')));
const lineMode = computed<LineMode | null>(() => {
  if (info.value.mixed.includes('stroke') || info.value.mixed.includes('strokeDash')) return null;
  if (info.value.values.stroke === NO_COLOR) return 'none';
  return ['solid', 'dashed', 'animated'].includes(info.value.values.strokeDash ?? '') ? info.value.values.strokeDash as LineMode : null;
});
const strokeBase = computed(() => (lineMode.value === 'none' ? null : normalizeHex(info.value.values.stroke ?? '')));
const textColorBase = computed(() => normalizeHex(info.value.values.textColor ?? info.value.values.stroke ?? '') ?? '#242424');
watch(fillBase, (value) => { if (value) lastFill.value = value; }, { immediate: true });
watch(strokeBase, (value) => { if (value) lastStroke.value = value; }, { immediate: true });

function setFillMode(mode: FillMode): void { style({ fill: withFillMode(fillBase.value ?? lastFill.value, mode) }); }
function pickFill(hex: string): void {
  lastFill.value = hex;
  style({ fill: withFillMode(hex, currentFillMode.value === 'none' ? 'fill' : currentFillMode.value) });
}
function setLineMode(mode: LineMode): void {
  if (mode === 'none') style({ stroke: NO_COLOR });
  else style({ strokeDash: mode, ...(info.value.values.stroke === NO_COLOR ? { stroke: lastStroke.value } : {}) });
}
function pickStroke(hex: string): void { lastStroke.value = hex; style({ stroke: hex }); }
/** While typing in a shape the caret returns to the text after picking a color, so writing can continue. */
function pickTextColor(hex: string): void {
  style({ textColor: hex });
  if (s.textEdit && s.textEdit.kind !== 'annotation') void nextTick(() => document.querySelector<HTMLTextAreaElement>('[data-testid="canvas-text-editor"]')?.focus());
}
function relayout(): void { void nextTick(placePopover); }
function formatAnnotation(command: AnnotationFormatCommand, value?: string): void {
  if (!editing.value || s.textEdit?.kind !== 'annotation') return;
  dispatchAnnotationFormat(command, value);
}
function formatHeading(level: (typeof HEADING_LEVELS)[number]): void { formatAnnotation(`heading-${level}`); }
</script>

<template>
  <div
    v-if="visible"
    ref="bar"
    class="context-bar"
    role="toolbar"
    :aria-label="t('Eigenschaften')"
    data-testid="properties-panel"
    :style="{ left: `${position.left}px`, top: `${position.top}px`, visibility: measured ? undefined : 'hidden' }"
    @keydown="onBarKeydown"
    @compositionstart="store.setInputComposing(true)"
    @compositionend="store.setInputComposing(false)"
  >
    <!-- Pointer affordance only, as in the main toolbar: arrow keys scroll the focused control into view (#78). -->
    <button v-show="overflowStart" type="button" class="bar-overflow start" data-testid="properties-scroll-start" tabindex="-1" aria-hidden="true" @pointerdown.prevent @click="pageBar(-1)"><AppIcon name="chevron-left" :size="18" /></button>
    <div ref="barTrack" class="context-track" @focusin="revealControl($event.target as Element | null)">
      <template v-if="swappable">
        <button :ref="(el) => setTrigger('shape', el)" type="button" class="segment" :aria-label="t('Form ändern')" :disabled="editing" :aria-expanded="openSegment === 'shape'" :aria-controls="panelId('shape')" :title="unavailable(t('Form ändern'))" @click="toggle('shape')">
          <svg class="shape-icon" viewBox="0 0 24 24" aria-hidden="true"><path v-for="d in currentShape?.icon ?? []" :key="d" :d="d" /></svg><AppIcon class="chev" name="chevron-down" :size="14" />
        </button>
        <span class="sep" aria-hidden="true" />
      </template>
      <button v-if="roundedOnly" :ref="(el) => setTrigger('radius', el)" type="button" class="segment" :aria-label="t('Eckenradius: {radiusValue}', { radiusValue: radiusMixed ? t('Gemischt') : radiusValue + ' px' })" :disabled="editing" :aria-expanded="openSegment === 'radius'" :aria-controls="panelId('radius')" :title="unavailable(t('Eckenradius'))" @click="toggle('radius')">
          <svg class="shape-icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M5 19V12a7 7 0 0 1 7-7h7" /></svg><AppIcon class="chev" name="chevron-down" :size="14" />
        </button>
        <button v-if="info.hasFill || connectorOnly" :ref="(el) => setTrigger('color', el)" type="button" class="segment" :aria-label="t('Farbe')" :aria-expanded="openSegment === 'color'" :aria-controls="panelId('color')" :title="t('Farbe')" @click="toggle('color')">
        <span class="color-dot" :style="{ background: swatchColor }" aria-hidden="true" /><AppIcon class="chev" name="chevron-down" :size="14" />
      </button>
      <button v-if="textColorCapable" :ref="(el) => setTrigger('text-color', el)" type="button" class="segment" :aria-label="t('Schriftfarbe')" :aria-expanded="openSegment === 'text-color'" :aria-controls="panelId('text-color')" :title="t('Schriftfarbe')" @click="toggle('text-color')">
        <span class="text-color-glyph" :style="{ '--text-color': textColorBase }" aria-hidden="true">A</span><AppIcon class="chev" name="chevron-down" :size="14" />
      </button>
      <button v-if="!stickyOnly && !tableOnly" :ref="(el) => setTrigger('line', el)" type="button" class="segment" :aria-label="t('Linie')" :aria-expanded="openSegment === 'line'" :aria-controls="panelId('line')" :title="t('Linie')" @click="toggle('line')">
        <AppIcon name="stroke" /><AppIcon class="chev" name="chevron-down" :size="14" />
      </button>
      <template v-if="connectorOnly">
        <span class="sep" aria-hidden="true" />
        <button type="button" class="tool-btn" :aria-label="t('Text hinzufügen oder bearbeiten')" :aria-pressed="editing ? true : undefined" :disabled="editing" :title="editing ? t('Text wird bearbeitet') : t('Text hinzufügen oder bearbeiten')" @click="store.startTextEdit(info.singleId ?? undefined)"><AppIcon name="text" /></button>
        <span class="sep" aria-hidden="true" />
        <button :ref="(el) => setTrigger('route', el)" type="button" class="segment" :aria-label="t('Linienform: {routeLabel}', { routeLabel })" :disabled="editing" :aria-expanded="openSegment === 'route'" :aria-controls="panelId('route')" :title="unavailable(t('Linienform'))" @click="toggle('route')">
          <svg class="connector-icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M5 19V10c0-3 2-5 5-5h9" /></svg><AppIcon class="chev" name="chevron-down" :size="14" />
        </button>
        <span class="sep" aria-hidden="true" />
        <button :ref="(el) => setTrigger('start', el)" type="button" class="segment" :aria-label="t('Startpunkt: {startMarker}', { startMarker: markerLabel(info.values.startMarker) })" :disabled="editing" :aria-expanded="openSegment === 'start'" :aria-controls="panelId('start')" :title="unavailable(t('Startpunkt'))" @click="toggle('start')">
          <ConnectorMarkerIcon class="toolbar-marker-icon start-marker-preview" :marker="info.values.startMarker ?? 'none'" /><AppIcon class="chev" name="chevron-down" :size="14" />
        </button>
        <button :ref="(el) => setTrigger('end', el)" type="button" class="segment" :aria-label="t('Endpunkt: {endMarker}', { endMarker: markerLabel(info.values.endMarker) })" :disabled="editing" :aria-expanded="openSegment === 'end'" :aria-controls="panelId('end')" :title="unavailable(t('Endpunkt'))" @click="toggle('end')">
          <ConnectorMarkerIcon class="toolbar-marker-icon" :marker="info.values.endMarker ?? 'none'" /><AppIcon class="chev" name="chevron-down" :size="14" />
        </button>
      </template>
      <template v-if="annotationOnly">
        <span class="sep" aria-hidden="true" />
        <button type="button" class="tool-btn heading-button" :disabled="!editing" :aria-label="t('Absatz')" :title="editing ? t('Absatz') : t('Zum Formatieren Text bearbeiten')" @pointerdown.prevent @click="formatAnnotation('paragraph')">P</button>
        <button v-for="level in HEADING_LEVELS" :key="level" type="button" class="tool-btn heading-button" :disabled="!editing" :aria-label="t('Überschrift {level}', { level })" :title="editing ? t('Überschrift {level}', { level }) : t('Zum Formatieren Text bearbeiten')" @pointerdown.prevent @click="formatHeading(level)">H<sub>{{ level }}</sub></button>
        <span class="sep" aria-hidden="true" />
        <button type="button" class="tool-btn format-letter" :disabled="!editing" :aria-label="t('Fett')" :title="t('Fett')" @pointerdown.prevent @click="formatAnnotation('bold')">B</button>
        <button type="button" class="tool-btn format-letter italic" :disabled="!editing" :aria-label="t('Kursiv')" :title="t('Kursiv')" @pointerdown.prevent @click="formatAnnotation('italic')">I</button>
        <button type="button" class="tool-btn format-letter underline" :disabled="!editing" :aria-label="t('Unterstrichen')" :title="t('Unterstrichen')" @pointerdown.prevent @click="formatAnnotation('underline')">U</button>
        <label class="annotation-color" :class="{ disabled: !editing }" :title="t('Textfarbe')"><span aria-hidden="true">A</span><input type="color" value="#242424" :aria-label="t('Textfarbe')" :disabled="!editing" @input="formatAnnotation('color', ($event.target as HTMLInputElement).value)" /></label>
        <span class="sep" aria-hidden="true" />
        <button type="button" class="tool-btn list-toggle" :disabled="!editing" :aria-label="t('Aufzählung')" :title="t('Aufzählung')" @pointerdown.prevent @click="formatAnnotation('bullet')"><span aria-hidden="true">•</span><span aria-hidden="true">☰</span></button>
        <button type="button" class="tool-btn numbered-toggle" :disabled="!editing" :aria-label="t('Nummerierte Liste')" :title="t('Nummerierte Liste')" @pointerdown.prevent @click="formatAnnotation('numbered')"><span aria-hidden="true">1.</span><span aria-hidden="true">☰</span></button>
        <button type="button" class="tool-btn quote-toggle" :disabled="!editing" :aria-label="t('Zitat')" :title="t('Zitat')" @pointerdown.prevent @click="formatAnnotation('quote')">❝</button>
        <span class="sep" aria-hidden="true" />
        <button v-if="!editing" type="button" class="tool-btn" :aria-label="t('Annotation bearbeiten')" :title="t('Annotation bearbeiten')" @click="store.startTextEdit(info.singleId ?? undefined)"><AppIcon name="text" /></button>
      </template>
      <template v-if="textCapable">
        <span class="sep" aria-hidden="true" />
        <button :ref="(el) => setTrigger('font', el)" type="button" class="segment" :aria-label="t('Schriftart')" :aria-expanded="openSegment === 'font'" :aria-controls="panelId('font')" :title="t('Schriftart')" @click="toggle('font')">
          <span class="font-glyph" :style="fontGlyphStyle" data-testid="font-glyph" aria-hidden="true">Aa</span><AppIcon class="chev" name="chevron-down" :size="14" />
        </button>
        <span class="sep" aria-hidden="true" />
        <button :ref="(el) => setTrigger('size', el)" type="button" class="segment size-segment" :aria-label="t('Schriftgröße: {sizeLabel}', { sizeLabel })" :aria-expanded="openSegment === 'size'" :aria-controls="panelId('size')" @click="toggle('size')">
          <span class="size-label">{{ sizeLabel }}</span><AppIcon class="chev" name="chevron-down" :size="14" />
        </button>
        <span class="sep" aria-hidden="true" />
        <button v-if="info.canEditText && !stickyOnly && !resourceCardOnly && !tableOnly && !webEmbedOnly" type="button" class="tool-btn" :aria-label="t('Text bearbeiten')" :aria-pressed="editing ? true : undefined" :disabled="editing" :title="editing ? t('Text wird bearbeitet') : t('Text bearbeiten')" @click="store.startTextEdit(info.singleId ?? undefined)">
          <AppIcon name="text" />
        </button>
      </template>
      <template v-if="stickyOnly">
        <span class="sep" aria-hidden="true" />
        <button type="button" class="tool-btn format-letter" :aria-label="t('Fett')" :aria-pressed="info.values.fontWeight === 'bold'" :title="t('Fett')" @click="style({ fontWeight: info.values.fontWeight === 'bold' ? 'normal' : 'bold' })">B</button>
        <button type="button" class="tool-btn format-letter strike" :aria-label="t('Durchgestrichen')" :aria-pressed="info.values.textDecoration === 'line-through'" :title="t('Durchgestrichen')" @click="style({ textDecoration: info.values.textDecoration === 'line-through' ? 'none' : 'line-through' })">S</button>
      </template>
      <template v-if="tableOnly">
        <button type="button" class="tool-btn format-letter" :aria-label="t('Fett')" :aria-pressed="info.values.fontWeight === 'bold'" :title="t('Fett')" @click="style({ fontWeight: info.values.fontWeight === 'bold' ? 'normal' : 'bold' })">B</button>
        <button type="button" class="tool-btn format-letter strike" :aria-label="t('Durchgestrichen')" :aria-pressed="info.values.textDecoration === 'line-through'" :title="t('Durchgestrichen')" @click="style({ textDecoration: info.values.textDecoration === 'line-through' ? 'none' : 'line-through' })">S</button>
        <button type="button" class="tool-btn list-toggle" :aria-label="t('Aufzählung')" :aria-pressed="info.values.listStyle === 'bullet'" :title="t('Aufzählung')" @click="style({ listStyle: info.values.listStyle === 'bullet' ? 'none' : 'bullet' })"><span aria-hidden="true">•</span><span aria-hidden="true">☰</span></button>
        <button :ref="(el) => setTrigger('table', el)" type="button" class="tool-btn" :aria-label="t('Tabellenstruktur')" :aria-expanded="openSegment === 'table'" :aria-controls="panelId('table')" :title="t('Zeilen und Spalten')" @click="toggle('table')"><AppIcon name="table" /></button>
      </template>
      <button v-if="resourceCardOnly" :disabled="editing" :ref="(el) => setTrigger('resource', el)" type="button" class="tool-btn" :aria-label="t('Ressourcenkarte bearbeiten')" :aria-expanded="openSegment === 'resource'" :aria-controls="panelId('resource')" :title="unavailable(t('Ressourcenkarte bearbeiten'))" @click="toggle('resource')">
        <AppIcon name="more" />
      </button>
      <button v-if="info.count === 1 && !connectorOnly && !resourceCardOnly && !tableOnly" :disabled="editing" :ref="(el) => setTrigger('link', el)" type="button" class="tool-btn" :class="{ on: Boolean(webEmbedOnly ? single?.embedUrl : single?.documentationUrl) }" :aria-label="webEmbedOnly ? t('Webadresse') : t('Dokumentationslink')" :aria-expanded="openSegment === 'link'" :aria-controls="panelId('link')" :title="unavailable(webEmbedOnly ? t('Webadresse') : t('Dokumentationslink'))" @click="toggle('link')">
        <AppIcon name="link" />
      </button>
      <button v-if="stickyOnly" type="button" class="tool-btn list-toggle" :aria-label="t('Aufzählung')" :aria-pressed="stickyBulletsActive" :title="t('Aufzählung')" @mousedown.prevent @click="toggleStickyBullets"><span aria-hidden="true">•</span><span aria-hidden="true">☰</span></button>
      <button v-if="stickyOnly" :ref="(el) => setTrigger('author', el)" type="button" class="tool-btn author-button" :aria-label="t('Autor bearbeiten')" :aria-expanded="openSegment === 'author'" :aria-controls="panelId('author')" :title="t('Autor bearbeiten')" @click="toggle('author')"><AppIcon name="user" /></button>
      <button v-if="stickyOnly" type="button" class="tool-btn" :disabled="stickyTaskExists || s.transitioning" :aria-label="stickyTaskExists ? t('Aufgabe bereits erstellt') : t('Aufgabe erstellen')" :title="stickyTaskExists ? t('Aufgabe bereits erstellt') : t('Aufgabe erstellen')" @click="createStickyTask"><AppIcon name="file-plus" /></button>
      <template v-if="textCapable && !stickyOnly">
        <span class="sep" aria-hidden="true" />
        <button :ref="(el) => setTrigger('align', el)" type="button" class="segment" :aria-label="t('Textausrichtung')" :aria-expanded="openSegment === 'align'" :aria-controls="panelId('align')" :title="t('Textausrichtung')" @click="toggle('align')">
          <AppIcon :name="alignIcon" /><AppIcon class="chev" name="chevron-down" :size="14" />
        </button>
      </template>
      <template v-if="definition?.widgets?.length">
        <span class="sep" aria-hidden="true" />
        <button :ref="(el) => setTrigger('more', el)" type="button" class="tool-btn" :aria-label="t('Komponenteneinstellungen')" :disabled="editing" :aria-expanded="openSegment === 'more'" :aria-controls="panelId('more')" :title="unavailable(t('Komponenteneinstellungen'))" @click="toggle('more')">
          <AppIcon name="more" />
        </button>
      </template>
      <span class="sep" aria-hidden="true" />
      <button :ref="(el) => setTrigger('actions', el)" type="button" class="tool-btn" :aria-label="t('Elementaktionen')" :disabled="editing" :aria-expanded="openSegment === 'actions'" :aria-controls="panelId('actions')" :title="unavailable(t('Elementaktionen'))" @click="toggle('actions')">
        <AppIcon name="more" />
      </button>
    </div>
    <button v-show="overflowEnd" type="button" class="bar-overflow end" data-testid="properties-scroll-end" tabindex="-1" aria-hidden="true" @pointerdown.prevent @click="pageBar(1)"><AppIcon name="chevron-right" :size="18" /></button>
  </div>

  <div
    v-if="visible && openSegment"
    :id="panelId(openSegment)"
    ref="popover"
    class="context-popover"
    :class="{ compact: openSegment === 'align' }"
    role="group"
    data-focus-scope
    :aria-label="openSegment === 'shape' ? t('Form ändern') : openSegment === 'radius' ? t('Eckenradius') : openSegment === 'color' ? t('Farbe') : openSegment === 'text-color' ? t('Schriftfarbe') : openSegment === 'line' ? t('Linie') : openSegment === 'font' ? t('Schriftart') : openSegment === 'size' ? t('Schriftgröße') : openSegment === 'table' ? t('Tabellenstruktur') : openSegment === 'link' ? t('Link') : openSegment === 'resource' ? t('Ressourcenkarte bearbeiten') : openSegment === 'author' ? t('Autor bearbeiten') : openSegment === 'align' ? t('Textausrichtung') : openSegment === 'actions' ? t('Elementaktionen') : openSegment === 'route' ? t('Linienform') : openSegment === 'start' ? t('Startpunkt') : openSegment === 'end' ? t('Endpunkt') : t('Komponenteneinstellungen')"
    :style="{ left: `${popoverAt.left}px`, top: `${popoverAt.top}px`, maxHeight: popoverAt.maxHeight ? `${popoverAt.maxHeight}px` : undefined }"
    @keydown="onKeydown"
    @compositionstart="store.setInputComposing(true)"
    @compositionend="store.setInputComposing(false)"
  >
    <template v-if="openSegment === 'shape'">
      <label class="shape-search">
        <AppIcon name="search" :size="18" />
        <input v-model="shapeQuery" class="search-input" type="search" :aria-label="t('Form suchen')" :placeholder="t('Form suchen')" autocomplete="off" spellcheck="false" />
      </label>
      <div class="shape-grid" role="group" :aria-label="t('Formen')">
        <button
          v-for="entry in shapes"
          :key="entry.id"
          type="button"
          class="shape-btn"
          :aria-label="t(entry.label)"
          :title="t(entry.label)"
          :aria-pressed="entry === currentShape"
          @click="pickShape(entry)"
        >
          <svg viewBox="0 0 24 24" aria-hidden="true"><path v-for="d in entry.icon" :key="d" :d="d" /></svg>
        </button>
        <p v-if="!shapes.length" class="shape-empty">{{ t('Keine Form gefunden') }}</p>
      </div>
    </template>

    <template v-else-if="openSegment === 'radius'">
      <label class="field radius-field">{{ t('Eckenradius') }}
        <span class="radius-row"><input class="radius-range" type="range" min="0" :max="radiusMax" step="1" :value="radiusValue" :aria-label="t('Eckenradius')" :aria-valuetext="`${radiusValue} px`" @input="setRadius(($event.target as HTMLInputElement).valueAsNumber)" @change="commitRadius" /><output class="radius-output">{{ radiusMixed ? '–' : radiusValue }} px</output></span>
      </label>
      <div class="choices" role="group" :aria-label="t('Eckenradius-Vorgaben')">
        <button v-for="preset in [0, 8, 16, 32]" :key="preset" type="button" class="choice" :aria-pressed="!radiusMixed && radiusValue === Math.min(preset, radiusMax)" @click="setRadius(preset); commitRadius()">{{ preset === 0 ? t('Eckig') : `${preset} px` }}</button>
      </div>
    </template>

    <template v-else-if="openSegment === 'color'">
      <div v-if="!connectorOnly && !stickyOnly && !tableOnly" class="modes" role="group" :aria-label="t('Füllart')">
        <button v-for="mode in FILL_MODES" :key="mode.value" type="button" class="mode" :aria-pressed="currentFillMode === mode.value && !info.mixed.includes('fill')" @click="setFillMode(mode.value)">
          <svg class="mode-icon" viewBox="0 0 20 20" aria-hidden="true"><rect x="2.5" y="2.5" width="15" height="15" rx="3.5" fill="none" stroke="currentColor" stroke-width="1.6" /><rect v-if="mode.value !== 'none'" x="6" y="6" width="8" height="8" rx="1.5" fill="currentColor" :fill-opacity="mode.value === 'semi' ? 0.35 : 1" /><rect v-else x="6" y="6" width="8" height="8" rx="1.5" fill="none" stroke="currentColor" stroke-width="1.4" /></svg>
          {{ t(mode.label) }}
        </button>
      </div>
      <ColorPalette v-if="connectorOnly" :value="strokeBase" :prefix="t('Linie')" :group-label="t('Linienfarbe')" :mixed="info.mixed.includes('stroke')" @pick="pickStroke" @layout="relayout" />
      <ColorPalette v-else :value="fillBase" :prefix="t('Füllung')" :group-label="t('Füllfarbe')" :mixed="info.mixed.includes('fill')" @pick="pickFill" @layout="relayout" />
    </template>

    <ColorPalette v-else-if="openSegment === 'text-color'" :value="textColorBase" :prefix="t('Schrift')" :group-label="t('Schriftfarbe')" :mixed="info.mixed.includes('textColor')" @pick="pickTextColor" @layout="relayout" />

    <template v-else-if="openSegment === 'line'">
      <div class="modes" role="group" :aria-label="t('Linienstil')">
        <button v-for="mode in (connectorOnly ? LINE_MODES.filter((entry) => entry.value !== 'none') : LINE_MODES)" :key="mode.value" type="button" class="mode" :aria-pressed="lineMode === mode.value" @click="setLineMode(mode.value)">
          <AppIcon :name="mode.icon" :size="18" />{{ t(mode.label) }}
        </button>
      </div>
      <ColorPalette v-if="!connectorOnly" :value="strokeBase" :prefix="t('Kontur')" :group-label="t('Konturfarbe')" :mixed="info.mixed.includes('stroke')" @pick="pickStroke" @layout="relayout" />
      <div class="widths" role="group" :aria-label="t('Linienstärke')">
        <button v-for="width in (connectorOnly ? CONNECTOR_WIDTHS : WIDTHS)" :key="width.value" type="button" class="mode width" :aria-label="t('Linienstärke {label}', { label: t(width.label) })" :title="t(width.label)" :aria-pressed="info.values.strokeWidth === width.value && !info.mixed.includes('strokeWidth')" @click="style({ strokeWidth: width.value })">
          <svg viewBox="0 0 28 12" aria-hidden="true"><line x1="3" y1="6" x2="25" y2="6" stroke="currentColor" :stroke-width="width.value" stroke-linecap="round" /></svg>
        </button>
      </div>
    </template>

    <div v-else-if="openSegment === 'route'" class="choices column" role="group" :aria-label="t('Linienform')">
      <button v-for="route in ROUTES" :key="route.value" type="button" class="choice connector-choice" :aria-pressed="info.values.connectorRouting === route.value" @click="connectorPatch({ connectorRouting: route.value }); close(true)">
        <svg class="connector-choice-icon" viewBox="0 0 48 24" aria-hidden="true"><path v-if="route.value === 'straight'" d="M5 19L43 5" /><path v-else-if="route.value === 'curved'" d="M5 19C20 19 28 5 43 5" /><path v-else d="M5 19H24V5H43" /></svg>{{ t(route.label) }}
      </button>
    </div>

    <div v-else-if="openSegment === 'start' || openSegment === 'end'" class="choices marker-grid" role="group" :aria-label="openSegment === 'start' ? t('Startpunkt') : t('Endpunkt')">
      <button v-for="marker in MARKERS" :key="marker.value" type="button" class="choice marker-choice" :aria-label="t(marker.label)" :title="t(marker.label)" :aria-pressed="(openSegment === 'start' ? info.values.startMarker : info.values.endMarker) === marker.value" @click="connectorPatch(openSegment === 'start' ? { startMarker: marker.value } : { endMarker: marker.value }); close(true)">
        <ConnectorMarkerIcon :marker="marker.value" />
      </button>
    </div>

    <div v-else-if="openSegment === 'font'" class="choices column" role="group" :aria-label="t('Schriftart')">
      <button v-for="font in FONT_OPTIONS" :key="font.value" type="button" class="choice" :aria-pressed="!fontMixed && currentFont === font.value" :data-font="font.value" @click="style({ fontFamily: font.value })"><span class="font-sample" :style="{ fontFamily: FONT_FAMILY_CSS[font.value] }" aria-hidden="true">Aa</span> {{ t(font.label) }}</button>
    </div>

    <template v-else-if="openSegment === 'size'">
      <div class="choices column" role="group" :aria-label="t('Größenvorgaben')">
        <button v-for="preset in SIZE_PRESETS" :key="preset.value" type="button" class="choice" :aria-pressed="info.values.fontSize === preset.value && !info.mixed.includes('fontSize')" @click="style({ fontSize: preset.value })">{{ t(preset.label) }} <span class="muted">{{ preset.value }} px</span></button>
      </div>
      <label class="field">{{ t('Schriftgröße') }}<input :aria-label="t('Schriftgröße')" class="ctx-input" type="number" min="1" max="1000" :value="info.mixed.includes('fontSize') ? '' : info.values.fontSize" :placeholder="info.mixed.includes('fontSize') ? t('Verschieden') : undefined" @input="setFontSize(($event.target as HTMLInputElement).valueAsNumber)" @change="commitFontSize(($event.target as HTMLInputElement).valueAsNumber)" /></label>
    </template>

    <div v-else-if="openSegment === 'table'" class="choices table-actions" role="group" :aria-label="t('Zeilen und Spalten bearbeiten')">
      <button type="button" class="choice" @click="store.changeTableStructure('row-before')">{{ t('Zeile oberhalb einfügen') }}</button>
      <button type="button" class="choice" @click="store.changeTableStructure('row-after')">{{ t('Zeile unterhalb einfügen') }}</button>
      <button type="button" class="choice" @click="store.changeTableStructure('column-before')">{{ t('Spalte links einfügen') }}</button>
      <button type="button" class="choice" @click="store.changeTableStructure('column-after')">{{ t('Spalte rechts einfügen') }}</button>
      <button type="button" class="choice" @click="store.changeTableStructure('row-duplicate')">{{ t('Zeile duplizieren') }}</button>
      <button type="button" class="choice" @click="store.changeTableStructure('column-duplicate')">{{ t('Spalte duplizieren') }}</button>
      <button type="button" class="choice" @click="store.changeTableStructure('row-up')">{{ t('Zeile nach oben') }}</button>
      <button type="button" class="choice" @click="store.changeTableStructure('row-down')">{{ t('Zeile nach unten') }}</button>
      <button type="button" class="choice" @click="store.changeTableStructure('column-left')">{{ t('Spalte nach links') }}</button>
      <button type="button" class="choice" @click="store.changeTableStructure('column-right')">{{ t('Spalte nach rechts') }}</button>
      <button type="button" class="choice danger" @click="store.changeTableStructure('row-delete')">{{ t('Zeile löschen') }}</button>
      <button type="button" class="choice danger" @click="store.changeTableStructure('column-delete')">{{ t('Spalte löschen') }}</button>
    </div>

    <ResourceCardEditor v-else-if="openSegment === 'resource' && single" :element="single" :document="s.document" @saved="close(true)" @cancel="close(true)" />

    <template v-else-if="openSegment === 'link'">
      <label class="field">{{ webEmbedOnly ? t('Webadresse') : stickyOnly ? t('Link') : t('Dokumentationslink') }}<input v-model="linkDraft" class="ctx-input wide" type="url" :aria-label="webEmbedOnly ? t('Webadresse') : stickyOnly ? t('Link') : t('Dokumentationslink')" placeholder="https://" @change="saveLink" @keydown.enter.prevent="saveLink" /></label>
      <button v-if="webEmbedOnly && single?.embedUrl" type="button" class="ctx-btn" @click="store.openDocumentationLink(single.embedUrl)">{{ t('Webseite extern öffnen ↗') }}</button>
      <button v-else-if="single?.documentationUrl" type="button" class="ctx-btn" @click="store.openDocumentationLink(single.documentationUrl)">{{ stickyOnly ? t('Link öffnen') : t('Dokumentation öffnen') }} ↗</button>
    </template>

    <template v-else-if="openSegment === 'author'">
      <label class="field">{{ t('Autor') }}<input v-model="authorDraft" class="ctx-input wide" type="text" :aria-label="t('Autor')" :placeholder="t('Name')" maxlength="240" @change="saveAuthor" @keydown.enter.prevent="saveAuthor" /></label>
    </template>

    <div v-else-if="openSegment === 'align'" class="choices" role="group" :aria-label="t('Textausrichtung')">
      <button v-for="align in ALIGNMENTS" :key="align.value" type="button" class="choice icon-choice" :aria-label="t(align.label)" :title="t(align.label)" :aria-pressed="info.values.textAlign === align.value && !info.mixed.includes('textAlign')" @click="style({ textAlign: align.value })"><AppIcon :name="align.icon" /></button>
    </div>

    <div v-else-if="openSegment === 'actions'" class="action-strip">
      <button type="button" class="action-button" :aria-label="t('Ganz nach hinten')" :title="t('Ganz nach hinten')" :disabled="!canMoveBackward" @click="runSelectionAction('back')"><AppIcon name="order-back" /></button>
      <button type="button" class="action-button" :aria-label="t('Eine Ebene zurück')" :title="t('Eine Ebene zurück')" :disabled="!canMoveBackward" @click="runSelectionAction('backward')"><AppIcon name="order-backward" /></button>
      <button type="button" class="action-button" :aria-label="t('Eine Ebene vor')" :title="t('Eine Ebene vor')" :disabled="!canMoveForward" @click="runSelectionAction('forward')"><AppIcon name="order-forward" /></button>
      <button type="button" class="action-button" :aria-label="t('Ganz nach vorn')" :title="t('Ganz nach vorn')" :disabled="!canMoveForward" @click="runSelectionAction('front')"><AppIcon name="order-front" /></button>
      <span class="action-separator" aria-hidden="true" />
      <button type="button" class="action-button" :aria-label="t('Klonen')" :title="t('Klonen')" @click="runSelectionAction('clone')"><AppIcon name="duplicate" /></button>
      <button type="button" class="action-button danger" :aria-label="t('Löschen')" :title="t('Löschen')" @click="runSelectionAction('delete')"><AppIcon name="trash" /></button>
    </div>

    <template v-else-if="openSegment === 'more'">
      <template v-for="item in definition?.widgets" :key="item.key">
        <label class="field">{{ t(item.label) }}<select v-if="item.kind === 'select'" class="ctx-input wide" :value="single?.metadata?.[`widget:${single.componentType}:${item.key}`] ?? ''" @change="widget(item.key, ($event.target as HTMLSelectElement).value); store.commitPropertyDraft()"><option value="" disabled>{{ t('Bitte auswählen') }}</option><option v-for="option in item.options" :key="option">{{ option }}</option></select><input v-else class="ctx-input wide" :type="item.kind === 'number' ? 'number' : 'text'" :value="single?.metadata?.[`widget:${single.componentType}:${item.key}`] ?? ''" @input="widget(item.key, ($event.target as HTMLInputElement).value)" @change="store.commitPropertyDraft()" /></label>
      </template>
    </template>
  </div>
</template>

<style scoped>
.context-bar {
  position: absolute;
  z-index: 20;
  display: flex;
  align-items: stretch;
  height: var(--chrome-height);
  max-width: calc(100vw - 24px);
  overflow: hidden;
  background: var(--menu-surface);
  border: 1px solid var(--border-subtle);
  border-radius: 16px;
  box-shadow: var(--shadow-panel);
  color: var(--menu-text);
}

.context-track {
  display: flex;
  flex: 1 1 auto;
  align-items: center;
  gap: 2px;
  min-width: 0;
  padding: 0 7px;
  overflow-x: auto;
  overflow-y: hidden;
  scrollbar-width: none;
}

/* Edge buttons take their own room beside the scroller instead of covering controls (#78). */
.bar-overflow {
  display: grid;
  flex: none;
  place-items: center;
  width: 32px;
  padding: 0;
  border: 0;
  background: transparent;
  color: var(--menu-muted);
  cursor: pointer;
}

.bar-overflow.start { border-right: 1px solid var(--menu-separator); }
.bar-overflow.end { border-left: 1px solid var(--menu-separator); }
.bar-overflow:hover { background: var(--menu-hover); color: var(--menu-text); }

.segment,
.tool-btn {
  display: flex;
  flex: none;
  align-items: center;
  justify-content: center;
  gap: 4px;
  min-width: var(--chrome-control);
  height: var(--chrome-control);
  padding: 0 8px;
  background: transparent;
  border: 0;
  border-radius: 10px;
  color: inherit;
  cursor: pointer;
}

.segment:hover:not(:disabled),
.tool-btn:hover:not(:disabled) {
  background: var(--menu-hover);
}

/* #44: actions unavailable during text editing stay visible so the bar keeps its structure. */
.segment:disabled,
.tool-btn:disabled {
  color: var(--menu-muted);
  cursor: not-allowed;
  opacity: 0.55;
}

.tool-btn[aria-pressed='true']:disabled {
  background: var(--menu-selected);
  color: var(--menu-selected-text);
  opacity: 0.8;
}

.segment[aria-expanded='true'],
.tool-btn[aria-expanded='true'] {
  background: var(--menu-selected);
  color: var(--menu-selected-text);
}

.segment:focus-visible,
.tool-btn:focus-visible,
.choice:focus-visible,
.mode:focus-visible,
.ctx-btn:focus-visible,
.ctx-input:focus-visible {
  outline: 2px solid var(--menu-focus);
  outline-offset: -2px;
}

.tool-btn.on {
  color: var(--menu-focus);
}

.format-letter { font-size: 21px; font-weight: 700; }
.format-letter.strike { text-decoration: line-through; font-weight: 400; }
.format-letter.italic { font-style: italic; font-weight: 500; }
.format-letter.underline { text-decoration: underline; font-weight: 500; }
.heading-button{min-width:38px;padding:0 5px;font-family:Georgia,'Times New Roman',serif;font-size:19px}.heading-button sub{font-size:10px;line-height:1}.numbered-toggle{gap:2px;font-size:13px}.quote-toggle{font-family:Georgia,serif;font-size:23px}.annotation-color{position:relative;display:grid;flex:none;width:40px;height:40px;place-items:center;border-radius:10px;font-size:19px;font-weight:650;cursor:pointer}.annotation-color span{padding-bottom:3px;border-bottom:3px solid #242424}.annotation-color input{position:absolute;inset:0;width:100%;height:100%;opacity:0;cursor:pointer}.annotation-color:hover{background:var(--menu-hover)}.annotation-color.disabled{opacity:.55;cursor:not-allowed}.annotation-color.disabled input{cursor:not-allowed}
.tool-btn[aria-pressed='true'] { background: var(--menu-selected); color: var(--menu-selected-text); }
.list-toggle { gap: 2px; font-size: 16px; }
.author-button { margin-left: 2px; background: #7c3aed; color: white; }
.author-button:hover:not(:disabled) { background: #6d28d9; }
.table-actions{display:grid!important;grid-template-columns:repeat(2,minmax(170px,1fr));gap:6px}.table-actions .choice{justify-content:flex-start}.table-actions .danger{color:var(--status-error)}

.chev {
  color: var(--menu-muted);
}

.sep {
  flex: none;
  width: 1px;
  height: 28px;
  margin: 0 4px;
  background: var(--menu-separator);
}

.color-dot {
  width: 22px;
  height: 22px;
  border-radius: 50%;
  box-shadow: 0 0 0 1px color-mix(in srgb, var(--text-primary) 30%, transparent);
}

.text-color-glyph {
  padding: 0 2px 2px;
  border-bottom: 3px solid var(--text-color);
  color: var(--menu-text);
  font-size: 18px;
  font-weight: 650;
  line-height: 1;
}

.font-glyph {
  font-family: Georgia, 'Times New Roman', serif;
  font-size: 17px;
  font-style: italic;
  font-weight: 600;
}

.size-segment {
  justify-content: space-between;
  min-width: 132px;
  padding: 0 10px 0 14px;
}

.size-label {
  font-size: 14px;
}

/* --- Popover --- */
.shape-icon,
.shape-btn svg,
.connector-icon {
  width: 22px;
  height: 22px;
  fill: none;
  stroke: currentColor;
  stroke-width: 1.6;
  stroke-linecap: round;
  stroke-linejoin: round;
}

.connector-choice-icon {
  width: 48px;
  height: 24px;
  fill: none;
  stroke: currentColor;
  stroke-width: 1.8;
  stroke-linecap: round;
  stroke-linejoin: round;
}

.connector-choice-icon .filled { fill: currentColor; }
.connector-choice { min-width: 190px; }
.choices.marker-grid { display: grid; grid-template-columns: repeat(6, 64px); gap: 6px; }
.marker-choice { justify-content: center; width: 64px; min-height: 44px; padding: 0; }
.toolbar-marker-icon { width: 34px; height: 22px; }
.start-marker-preview { transform: rotate(180deg); }

.shape-search {
  display: flex;
  align-items: center;
  gap: 8px;
  height: 40px;
  padding: 0 12px;
  background: var(--menu-field);
  border: 1px solid var(--menu-field-border);
  border-radius: 10px;
  color: var(--menu-muted);
}

.shape-search:focus-within {
  border-color: var(--menu-focus);
  box-shadow: 0 0 0 3px var(--menu-selected);
}

.search-input {
  flex: 1;
  min-width: 0;
  background: transparent;
  border: 0;
  color: var(--menu-text);
  font-size: 14px;
  outline: none;
}

.search-input::placeholder {
  color: var(--menu-muted);
}

.shape-grid {
  display: grid;
  grid-template-columns: repeat(5, 56px);
  gap: 4px;
  max-height: 248px;
  overflow: auto;
}

.shape-btn {
  display: grid;
  place-items: center;
  width: 56px;
  height: 56px;
  padding: 0;
  background: transparent;
  border: 0;
  border-radius: 10px;
  color: var(--menu-text);
  cursor: pointer;
}

.shape-btn:hover {
  background: var(--menu-hover);
}

.shape-btn[aria-pressed='true'] {
  background: var(--menu-selected);
  box-shadow: inset 0 0 0 1.5px var(--menu-focus);
  color: var(--menu-selected-text);
}

.shape-btn[aria-disabled='true'] {
  color: var(--menu-muted);
  cursor: default;
}

.shape-btn[aria-disabled='true']:hover {
  background: transparent;
}

.shape-btn:focus-visible {
  outline: 2px solid var(--menu-focus);
  outline-offset: -2px;
}

.shape-empty,
.shape-note {
  color: var(--menu-muted);
  font-size: 12px;
}

.shape-empty {
  grid-column: 1 / -1;
  padding: 12px 4px;
}

.modes,
.widths {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}

.modes {
  padding-bottom: 12px;
  border-bottom: 1px solid var(--menu-separator);
}

.mode {
  display: flex;
  align-items: center;
  gap: 8px;
  min-height: 36px;
  padding: 0 12px;
  background: transparent;
  border: 0;
  border-radius: 10px;
  color: var(--menu-text);
  font-size: 14px;
  cursor: pointer;
}

.mode:hover {
  background: var(--menu-hover);
}

.mode[aria-pressed='true'] {
  background: var(--menu-selected);
  box-shadow: inset 0 0 0 1.5px var(--menu-focus);
  color: var(--menu-selected-text);
}

.mode-icon {
  width: 18px;
  height: 18px;
}

.width {
  width: 56px;
  justify-content: center;
  padding: 0;
}

.width svg {
  width: 28px;
  height: 12px;
}

.context-popover.compact { min-width: 0; }

.context-popover {
  position: fixed;
  z-index: 45;
  max-height: calc(100vh - 16px);
  overflow: auto;
  display: grid;
  gap: 8px;
  min-width: 220px;
  max-width: min(460px, calc(100vw - 16px));
  padding: 12px;
  background: var(--menu-surface);
  border: 1px solid var(--border-subtle);
  border-radius: 14px;
  box-shadow: var(--shadow-panel);
  color: var(--menu-text);
}

.action-strip {
  display: flex;
  align-items: center;
  gap: 4px;
}

.action-button {
  display: grid;
  width: 44px;
  height: 44px;
  flex: none;
  place-items: center;
  padding: 0;
  border: 0;
  border-radius: 10px;
  background: transparent;
  color: var(--menu-text);
  cursor: pointer;
}

.action-button:hover:not(:disabled) { background: var(--menu-hover); }
.action-button:disabled { color: var(--menu-muted); cursor: not-allowed; opacity: .45; }
.action-button.danger { color: var(--status-error); }
.action-button:focus-visible { outline: 2px solid var(--menu-focus); outline-offset: -2px; }
.action-separator { width: 1px; height: 30px; margin: 0 4px; background: var(--menu-separator); }

.grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 8px;
}

.field,
.group-label {
  display: grid;
  gap: 4px;
  color: var(--menu-muted);
  font-size: 11px;
  font-weight: 600;
}

.ctx-input {
  width: 100%;
  min-height: 32px;
  padding: 4px 8px;
  background: var(--menu-field);
  border: 1px solid var(--menu-field-border);
  border-radius: 8px;
  color: var(--menu-text);
  font-size: 13px;
  font-weight: 400;
}

.ctx-input::placeholder {
  color: var(--menu-muted);
}

.ctx-input:disabled {
  opacity: 0.5;
}

.ctx-input.wide {
  min-width: 240px;
}

.choices {
  display: flex;
  gap: 4px;
}

.choices.column {
  flex-direction: column;
}

.choice {
  display: flex;
  align-items: center;
  gap: 8px;
  min-height: 34px;
  padding: 0 10px;
  background: transparent;
  border: 0;
  border-radius: 8px;
  color: inherit;
  font-size: 13px;
  text-align: left;
  cursor: pointer;
}

.choice:hover {
  background: var(--menu-hover);
}

.choice[aria-pressed='true'] {
  background: var(--menu-selected);
  box-shadow: inset 0 0 0 1px var(--menu-focus);
  color: var(--menu-selected-text);
}

.icon-choice {
  justify-content: center;
  width: 40px;
  padding: 0;
}

.radius-field { min-width: 260px; }
.radius-row { display: flex; align-items: center; gap: 12px; }
.radius-range { flex: 1; min-width: 0; height: 28px; accent-color: var(--menu-focus); cursor: pointer; }
.radius-range:focus-visible { outline: 2px solid var(--menu-focus); outline-offset: 2px; }
.radius-output { min-width: 48px; color: var(--menu-text); font-size: 13px; font-variant-numeric: tabular-nums; text-align: right; }

.font-sample {
  width: 28px;
  font-size: 18px;
  font-style: normal;
}

.muted {
  margin-left: auto;
  color: var(--menu-muted);
  font-size: 12px;
}

.ctx-btn {
  min-height: 32px;
  padding: 0 10px;
  background: var(--menu-field);
  border: 1px solid var(--menu-field-border);
  border-radius: 8px;
  color: var(--menu-text);
  font-size: 12px;
  cursor: pointer;
}

.ctx-btn:hover {
  background: var(--menu-hover);
}

@media (forced-colors: active) {
  .context-bar,
  .context-popover {
    border: 1px solid CanvasText;
  }

  .bar-overflow {
    color: ButtonText;
  }

  .segment[aria-expanded='true'],
  .choice[aria-pressed='true'] {
    forced-color-adjust: none;
    background: Highlight;
    color: HighlightText;
  }
}
</style>

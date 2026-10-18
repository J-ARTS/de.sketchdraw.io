<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, useId, watch } from 'vue';
import AppIcon from './AppIcon.vue';
import type { IconName } from './icons';
import { useWhiteboard } from './use-whiteboard';
import { effectiveShapeVariant, type ConnectorMarker, type ConnectorRouting, type ElementPatch, type ElementStyle } from '@/domain';
import ColorPalette from './ColorPalette.vue';
import { fillMode, NO_COLOR, normalizeHex, withFillMode, type FillMode } from '@/renderer/lib/color';
import { docToScreen } from '@/renderer/lib/viewport';
import { FONT_FAMILY_CSS } from '@/renderer/lib/constants';
import { matchesShape, SHAPE_CATALOG, SWAPPABLE_KINDS, type ShapeEntry } from '@/renderer/lib/shapes';
import { isResourceCard } from '@/catalog';
import ResourceCardEditor from './ResourceCardEditor.vue';
import { dispatchAnnotationFormat, type AnnotationFormatCommand } from '@/renderer/lib/annotation';

type Segment = 'shape' | 'color' | 'line' | 'font' | 'size' | 'table' | 'link' | 'resource' | 'author' | 'align' | 'more' | 'actions' | 'route' | 'start' | 'end';

const store = useWhiteboard();
const s = store.state;
const uid = useId();
const info = computed(() => s.selectionInfo);
const single = computed(() => s.document.elements.find((e) => e.id === info.value.singleId));
const definition = computed(() => s.document.componentSets.flatMap((set) => set.components).find((c) => c.type === single.value?.componentType));

const SIZE_PRESETS = [{ label: 'Klein', value: 14 }, { label: 'Mittel', value: 20 }, { label: 'Groß', value: 28 }, { label: 'Sehr groß', value: 40 }] as const;
const HEADING_LEVELS = [1, 2, 3, 4] as const;
const ALIGNMENTS: ReadonlyArray<{ value: ElementStyle['textAlign']; label: string; icon: IconName }> = [
  { value: 'left', label: 'Links', icon: 'align-left' },
  { value: 'center', label: 'Mitte', icon: 'align-center' },
  { value: 'right', label: 'Rechts', icon: 'align-right' },
];
const FILL_MODES: ReadonlyArray<{ value: FillMode; label: string }> = [
  { value: 'fill', label: 'Füllung' },
  { value: 'semi', label: 'Transparent' },
  { value: 'none', label: 'Keine Füllung' },
];
type LineMode = 'solid' | 'dashed' | 'none';
const LINE_MODES: ReadonlyArray<{ value: LineMode; label: string; icon: IconName }> = [
  { value: 'solid', label: 'Durchgezogen', icon: 'line-solid' },
  { value: 'dashed', label: 'Gestrichelt', icon: 'line-dashed' },
  { value: 'none', label: 'Keine', icon: 'none' },
];
const WIDTHS = [{ value: 1, label: 'Dünn' }, { value: 2, label: 'Mittel' }, { value: 4, label: 'Dick' }] as const;
const CONNECTOR_WIDTHS = [{ value: 2, label: 'Dünn' }, { value: 4, label: 'Dick' }] as const;
const ROUTES: ReadonlyArray<{ value: ConnectorRouting; label: string }> = [
  { value: 'elbowed', label: 'Rechtwinklig' }, { value: 'curved', label: 'Gebogen' }, { value: 'straight', label: 'Gerade' },
];
const MARKERS: ReadonlyArray<{ value: ConnectorMarker; label: string }> = [
  { value: 'none', label: 'Keine' }, { value: 'line-arrow', label: 'Linienpfeil' },
  { value: 'solid-arrow', label: 'Gefüllter Pfeil' }, { value: 'triangle', label: 'Dreieck' },
  { value: 'circle', label: 'Kreis' }, { value: 'diamond', label: 'Raute' },
];

// --- Visibility and placement ----------------------------------------------------
/** #44: the bar stays usable while the selected element's text is edited; style changes go to the text draft. */
const editing = computed(() => Boolean(s.textEdit));
const textEditAllowsBar = computed(() => !s.textEdit || (s.textEdit.elementId !== null && s.textEdit.elementId === info.value.singleId));
const visible = computed(() => Boolean(info.value.count && s.frame && s.canWrite && !s.transitioning && textEditAllowsBar.value && !s.hasElementPreview && !s.draftElement && !s.marquee));
const connectorOnly = computed(() => info.value.count === 1 && info.value.kinds.length === 1 && info.value.kinds[0] === 'connector');
const stickyOnly = computed(() => info.value.count === 1 && info.value.kinds.length === 1 && info.value.kinds[0] === 'sticky-note');
const resourceCardOnly = computed(() => info.value.count === 1 && isResourceCard(single.value));
const annotationOnly = computed(() => info.value.count === 1 && info.value.kinds.length === 1 && info.value.kinds[0] === 'annotation');
const tableOnly = computed(() => info.value.count === 1 && info.value.kinds.length === 1 && info.value.kinds[0] === 'table');
const textCapable = computed(() => !resourceCardOnly.value && !annotationOnly.value && info.value.kinds.some((kind) => !['image', 'path', 'connector'].includes(kind)));

const bar = ref<HTMLElement | null>(null);
const barSize = ref({ width: 0, height: 56 });
/** The bar stays invisible until its width is known, so it never jumps sideways on first paint. */
const measured = ref(false);
let observer: ResizeObserver | undefined;
watch(bar, (element) => {
  observer?.disconnect();
  measured.value = false;
  if (!element) return;
  barSize.value = { width: element.offsetWidth, height: element.offsetHeight };
  measured.value = true;
  observer = new ResizeObserver(() => { barSize.value = { width: element.offsetWidth, height: element.offsetHeight }; });
  observer.observe(element);
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
  const minTop = s.viewportSize.width <= 1040 ? 144 : 80;
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
 * Always anchored 8 px above the selection, so the popover never covers the selected shape.
 * The anchor is the higher (smaller y) of the context bar's top and the rotated selection frame's
 * top edge: when the bar sits above the selection the bar is the higher edge; when the bar is pushed
 * below the selection for lack of room, the shape's top edge governs instead. Clamped to the viewport;
 * when the space above is tight it scrolls internally. Reads live rects, so every recompute reflects
 * the current viewport (zoom/pan/scroll).
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
  const anchorTop = Math.min(barBox.top, selectionTop); // the higher of bar and selection governs
  const spaceAbove = Math.max(0, anchorTop - 16); // room above the anchor (8 px gap + 8 px top margin)
  const natural = (popover.value?.scrollHeight ?? box.height) + 2; // unclamped height, even after an earlier max-height
  const maxHeight = spaceAbove;
  const height = Math.min(natural, maxHeight);
  popoverAt.value = { left, top: anchorTop - 8 - height, maxHeight };
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
watch(openSegment, (segment) => {
  if (segment) {
    window.addEventListener('scroll', onViewportShift, true);
    window.addEventListener('resize', onViewportShift);
  } else {
    window.removeEventListener('scroll', onViewportShift, true);
    window.removeEventListener('resize', onViewportShift);
  }
});

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
  const buttons = Array.from(bar.value?.querySelectorAll<HTMLButtonElement>(':scope > .segment:not(:disabled), :scope > .tool-btn:not(:disabled)') ?? []);
  const index = buttons.findIndex((button) => button === document.activeElement);
  if (index < 0) return;
  event.preventDefault();
  buttons[(index + (event.key === 'ArrowRight' ? 1 : -1) + buttons.length) % buttons.length]?.focus();
}

onMounted(() => document.addEventListener('pointerdown', onDocumentPointerDown, true));
onBeforeUnmount(() => {
  document.removeEventListener('pointerdown', onDocumentPointerDown, true);
  window.removeEventListener('scroll', onViewportShift, true);
  window.removeEventListener('resize', onViewportShift);
  observer?.disconnect();
});

// --- Values --------------------------------------------------------------------------
function style(patch: Partial<ElementStyle>): void {
  if (tableOnly.value) {
    store.formatTableSelection({
      ...(patch.fill !== undefined && patch.fill !== 'transparent' ? { fill: patch.fill } : {}),
      ...(patch.stroke !== undefined && patch.stroke !== 'transparent' ? { color: patch.stroke } : {}),
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
function unavailable(label: string): string { return editing.value ? `${label} (während der Textbearbeitung nicht verfügbar)` : label; }
// Document-level actions are unavailable during text editing; close their popovers.
watch(editing, (value) => { if (value && openSegment.value && ['shape', 'link', 'resource', 'author', 'more', 'actions'].includes(openSegment.value)) close(false); });
function widget(key: string, value: string): void {
  if (single.value) store.setPropertyDraft({ metadata: { ...single.value.metadata, [`widget:${single.value.componentType}:${key}`]: value } });
}

const swatchColor = computed(() => {
  const fill = info.value.values.fill;
  return info.value.hasFill && fill && fill !== 'transparent' ? fill : info.value.values.stroke ?? '#1e1e1e';
});
const markerLabel = (value: ConnectorMarker | undefined) => MARKERS.find((entry) => entry.value === value)?.label ?? 'Keine';
const routeLabel = computed(() => ROUTES.find((entry) => entry.value === info.value.values.connectorRouting)?.label ?? 'Gerade');
const sizeLabel = computed(() => {
  if (info.value.mixed.includes('fontSize')) return 'Gemischt';
  const size = info.value.values.fontSize ?? 20;
  return SIZE_PRESETS.find((preset) => preset.value === size)?.label ?? `${size} px`;
});
const alignIcon = computed<IconName>(() => ALIGNMENTS.find((a) => a.value === info.value.values.textAlign)?.icon ?? 'align-left');
type FontFamilyValue = 'sans' | 'roboto' | 'scribbled' | 'mono';
const FONT_OPTIONS: readonly { value: FontFamilyValue; label: string }[] = [
  { value: 'sans', label: 'Inter (Serifenlos)' },
  { value: 'roboto', label: 'Roboto (Sans Serif)' },
  { value: 'scribbled', label: 'Scribbled' },
  { value: 'mono', label: 'JetBrains Mono (Monospace)' },
];
const fontMixed = computed(() => info.value.mixed.includes('fontFamily'));
const currentFont = computed<FontFamilyValue>(() => (info.value.values.fontFamily as FontFamilyValue | undefined) ?? 'sans');
const fontGlyphStyle = computed(() => ({ fontFamily: FONT_FAMILY_CSS[currentFont.value], fontStyle: 'normal' }));
const linkDraft = ref('');
watch(() => single.value?.documentationUrl, (url) => { linkDraft.value = url ?? ''; }, { immediate: true });
function saveLink(): void {
  const url = linkDraft.value.trim();
  if (url === (single.value?.documentationUrl ?? '')) return;
  store.applyPatch({ documentationUrl: url || null });
}
const authorDraft = ref('');
watch(() => single.value?.author, (author) => { authorDraft.value = author ?? ''; }, { immediate: true });
function saveAuthor(): void {
  const author = authorDraft.value.trim();
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
  return info.value.values.strokeDash === 'solid' || info.value.values.strokeDash === 'dashed' ? info.value.values.strokeDash : null;
});
const strokeBase = computed(() => (lineMode.value === 'none' ? null : normalizeHex(info.value.values.stroke ?? '')));
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
    aria-label="Eigenschaften"
    data-testid="properties-panel"
    :style="{ left: `${position.left}px`, top: `${position.top}px`, visibility: measured ? undefined : 'hidden' }"
    @keydown="onBarKeydown"
    @compositionstart="store.setInputComposing(true)"
    @compositionend="store.setInputComposing(false)"
  >
    <template v-if="swappable">
      <button :ref="(el) => setTrigger('shape', el)" type="button" class="segment" aria-label="Form ändern" :disabled="editing" :aria-expanded="openSegment === 'shape'" :aria-controls="panelId('shape')" :title="unavailable('Form ändern')" @click="toggle('shape')">
        <svg class="shape-icon" viewBox="0 0 24 24" aria-hidden="true"><path v-for="d in currentShape?.icon ?? []" :key="d" :d="d" /></svg><AppIcon class="chev" name="chevron-down" :size="14" />
      </button>
      <span class="sep" aria-hidden="true" />
    </template>
    <button v-if="info.hasFill || connectorOnly" :ref="(el) => setTrigger('color', el)" type="button" class="segment" aria-label="Farbe" :aria-expanded="openSegment === 'color'" :aria-controls="panelId('color')" title="Farbe" @click="toggle('color')">
      <span class="color-dot" :style="{ background: swatchColor }" aria-hidden="true" /><AppIcon class="chev" name="chevron-down" :size="14" />
    </button>
    <button v-if="!stickyOnly && !tableOnly" :ref="(el) => setTrigger('line', el)" type="button" class="segment" aria-label="Linie" :aria-expanded="openSegment === 'line'" :aria-controls="panelId('line')" title="Linie" @click="toggle('line')">
      <AppIcon name="stroke" /><AppIcon class="chev" name="chevron-down" :size="14" />
    </button>
    <template v-if="connectorOnly">
      <span class="sep" aria-hidden="true" />
      <button type="button" class="tool-btn" aria-label="Text hinzufügen oder bearbeiten" :aria-pressed="editing ? true : undefined" :disabled="editing" :title="editing ? 'Text wird bearbeitet' : 'Text hinzufügen oder bearbeiten'" @click="store.startTextEdit(info.singleId ?? undefined)"><AppIcon name="text" /></button>
      <span class="sep" aria-hidden="true" />
      <button :ref="(el) => setTrigger('route', el)" type="button" class="segment" :aria-label="`Linienform: ${routeLabel}`" :disabled="editing" :aria-expanded="openSegment === 'route'" :aria-controls="panelId('route')" :title="unavailable('Linienform')" @click="toggle('route')">
        <svg class="connector-icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M5 19V10c0-3 2-5 5-5h9" /></svg><AppIcon class="chev" name="chevron-down" :size="14" />
      </button>
      <span class="sep" aria-hidden="true" />
      <button :ref="(el) => setTrigger('start', el)" type="button" class="segment" :aria-label="`Startpunkt: ${markerLabel(info.values.startMarker)}`" :disabled="editing" :aria-expanded="openSegment === 'start'" :aria-controls="panelId('start')" :title="unavailable('Startpunkt')" @click="toggle('start')">
        <svg class="connector-icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M19 12H5M10 7l-5 5 5 5" /></svg><AppIcon class="chev" name="chevron-down" :size="14" />
      </button>
      <button :ref="(el) => setTrigger('end', el)" type="button" class="segment" :aria-label="`Endpunkt: ${markerLabel(info.values.endMarker)}`" :disabled="editing" :aria-expanded="openSegment === 'end'" :aria-controls="panelId('end')" :title="unavailable('Endpunkt')" @click="toggle('end')">
        <svg class="connector-icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12h14M14 7l5 5-5 5" /></svg><AppIcon class="chev" name="chevron-down" :size="14" />
      </button>
    </template>
    <template v-if="annotationOnly">
      <span class="sep" aria-hidden="true" />
      <button type="button" class="tool-btn heading-button" :disabled="!editing" aria-label="Absatz" :title="editing ? 'Absatz' : 'Zum Formatieren Text bearbeiten'" @pointerdown.prevent @click="formatAnnotation('paragraph')">P</button>
      <button v-for="level in HEADING_LEVELS" :key="level" type="button" class="tool-btn heading-button" :disabled="!editing" :aria-label="`Überschrift ${level}`" :title="editing ? `Überschrift ${level}` : 'Zum Formatieren Text bearbeiten'" @pointerdown.prevent @click="formatHeading(level)">H<sub>{{ level }}</sub></button>
      <span class="sep" aria-hidden="true" />
      <button type="button" class="tool-btn format-letter" :disabled="!editing" aria-label="Fett" title="Fett" @pointerdown.prevent @click="formatAnnotation('bold')">B</button>
      <button type="button" class="tool-btn format-letter italic" :disabled="!editing" aria-label="Kursiv" title="Kursiv" @pointerdown.prevent @click="formatAnnotation('italic')">I</button>
      <button type="button" class="tool-btn format-letter underline" :disabled="!editing" aria-label="Unterstrichen" title="Unterstrichen" @pointerdown.prevent @click="formatAnnotation('underline')">U</button>
      <label class="annotation-color" :class="{ disabled: !editing }" title="Textfarbe"><span aria-hidden="true">A</span><input type="color" value="#242424" aria-label="Textfarbe" :disabled="!editing" @input="formatAnnotation('color', ($event.target as HTMLInputElement).value)" /></label>
      <span class="sep" aria-hidden="true" />
      <button type="button" class="tool-btn list-toggle" :disabled="!editing" aria-label="Aufzählung" title="Aufzählung" @pointerdown.prevent @click="formatAnnotation('bullet')"><span aria-hidden="true">•</span><span aria-hidden="true">☰</span></button>
      <button type="button" class="tool-btn numbered-toggle" :disabled="!editing" aria-label="Nummerierte Liste" title="Nummerierte Liste" @pointerdown.prevent @click="formatAnnotation('numbered')"><span aria-hidden="true">1.</span><span aria-hidden="true">☰</span></button>
      <button type="button" class="tool-btn quote-toggle" :disabled="!editing" aria-label="Zitat" title="Zitat" @pointerdown.prevent @click="formatAnnotation('quote')">❝</button>
      <span class="sep" aria-hidden="true" />
      <button v-if="!editing" type="button" class="tool-btn" aria-label="Annotation bearbeiten" title="Annotation bearbeiten" @click="store.startTextEdit(info.singleId ?? undefined)"><AppIcon name="text" /></button>
    </template>
    <template v-if="textCapable">
      <span class="sep" aria-hidden="true" />
      <button :ref="(el) => setTrigger('font', el)" type="button" class="segment" aria-label="Schriftart" :aria-expanded="openSegment === 'font'" :aria-controls="panelId('font')" title="Schriftart" @click="toggle('font')">
        <span class="font-glyph" :style="fontGlyphStyle" data-testid="font-glyph" aria-hidden="true">Aa</span><AppIcon class="chev" name="chevron-down" :size="14" />
      </button>
      <span class="sep" aria-hidden="true" />
      <button :ref="(el) => setTrigger('size', el)" type="button" class="segment size-segment" :aria-label="`Schriftgröße: ${sizeLabel}`" :aria-expanded="openSegment === 'size'" :aria-controls="panelId('size')" @click="toggle('size')">
        <span class="size-label">{{ sizeLabel }}</span><AppIcon class="chev" name="chevron-down" :size="14" />
      </button>
      <span class="sep" aria-hidden="true" />
      <button v-if="info.canEditText && !stickyOnly && !resourceCardOnly && !tableOnly" type="button" class="tool-btn" aria-label="Text bearbeiten" :aria-pressed="editing ? true : undefined" :disabled="editing" :title="editing ? 'Text wird bearbeitet' : 'Text bearbeiten'" @click="store.startTextEdit(info.singleId ?? undefined)">
        <AppIcon name="text" />
      </button>
    </template>
    <template v-if="stickyOnly">
      <span class="sep" aria-hidden="true" />
      <button type="button" class="tool-btn format-letter" aria-label="Fett" :aria-pressed="info.values.fontWeight === 'bold'" title="Fett" @click="style({ fontWeight: info.values.fontWeight === 'bold' ? 'normal' : 'bold' })">B</button>
      <button type="button" class="tool-btn format-letter strike" aria-label="Durchgestrichen" :aria-pressed="info.values.textDecoration === 'line-through'" title="Durchgestrichen" @click="style({ textDecoration: info.values.textDecoration === 'line-through' ? 'none' : 'line-through' })">S</button>
    </template>
    <template v-if="tableOnly">
      <button type="button" class="tool-btn format-letter" aria-label="Fett" :aria-pressed="info.values.fontWeight === 'bold'" title="Fett" @click="style({ fontWeight: info.values.fontWeight === 'bold' ? 'normal' : 'bold' })">B</button>
      <button type="button" class="tool-btn format-letter strike" aria-label="Durchgestrichen" :aria-pressed="info.values.textDecoration === 'line-through'" title="Durchgestrichen" @click="style({ textDecoration: info.values.textDecoration === 'line-through' ? 'none' : 'line-through' })">S</button>
      <button type="button" class="tool-btn list-toggle" aria-label="Aufzählung" :aria-pressed="info.values.listStyle === 'bullet'" title="Aufzählung" @click="style({ listStyle: info.values.listStyle === 'bullet' ? 'none' : 'bullet' })"><span aria-hidden="true">•</span><span aria-hidden="true">☰</span></button>
      <button :ref="(el) => setTrigger('table', el)" type="button" class="tool-btn" aria-label="Tabellenstruktur" :aria-expanded="openSegment === 'table'" :aria-controls="panelId('table')" title="Zeilen und Spalten" @click="toggle('table')"><AppIcon name="table" /></button>
    </template>
    <button v-if="resourceCardOnly" :disabled="editing" :ref="(el) => setTrigger('resource', el)" type="button" class="tool-btn" aria-label="Ressourcenkarte bearbeiten" :aria-expanded="openSegment === 'resource'" :aria-controls="panelId('resource')" :title="unavailable('Ressourcenkarte bearbeiten')" @click="toggle('resource')">
      <AppIcon name="more" />
    </button>
    <button v-if="info.count === 1 && !connectorOnly && !resourceCardOnly && !tableOnly" :disabled="editing" :ref="(el) => setTrigger('link', el)" type="button" class="tool-btn" :class="{ on: Boolean(single?.documentationUrl) }" aria-label="Dokumentationslink" :aria-expanded="openSegment === 'link'" :aria-controls="panelId('link')" :title="unavailable('Dokumentationslink')" @click="toggle('link')">
      <AppIcon name="link" />
    </button>
    <button v-if="stickyOnly" type="button" class="tool-btn list-toggle" aria-label="Aufzählung" :aria-pressed="info.values.listStyle === 'bullet'" title="Aufzählung" @click="style({ listStyle: info.values.listStyle === 'bullet' ? 'none' : 'bullet' })"><span aria-hidden="true">•</span><span aria-hidden="true">☰</span></button>
    <button v-if="stickyOnly" :ref="(el) => setTrigger('author', el)" type="button" class="tool-btn author-button" :disabled="editing" aria-label="Autor bearbeiten" :aria-expanded="openSegment === 'author'" :aria-controls="panelId('author')" :title="unavailable('Autor bearbeiten')" @click="toggle('author')"><AppIcon name="user" /></button>
    <template v-if="textCapable && !stickyOnly">
      <span class="sep" aria-hidden="true" />
      <button :ref="(el) => setTrigger('align', el)" type="button" class="segment" aria-label="Textausrichtung" :aria-expanded="openSegment === 'align'" :aria-controls="panelId('align')" title="Textausrichtung" @click="toggle('align')">
        <AppIcon :name="alignIcon" /><AppIcon class="chev" name="chevron-down" :size="14" />
      </button>
    </template>
    <template v-if="definition?.widgets?.length">
      <span class="sep" aria-hidden="true" />
      <button :ref="(el) => setTrigger('more', el)" type="button" class="tool-btn" aria-label="Komponenteneinstellungen" :disabled="editing" :aria-expanded="openSegment === 'more'" :aria-controls="panelId('more')" :title="unavailable('Komponenteneinstellungen')" @click="toggle('more')">
        <AppIcon name="more" />
      </button>
    </template>
    <span class="sep" aria-hidden="true" />
    <button :ref="(el) => setTrigger('actions', el)" type="button" class="tool-btn" aria-label="Elementaktionen" :disabled="editing" :aria-expanded="openSegment === 'actions'" :aria-controls="panelId('actions')" :title="unavailable('Elementaktionen')" @click="toggle('actions')">
      <AppIcon name="more" />
    </button>
  </div>

  <div
    v-if="visible && openSegment"
    :id="panelId(openSegment)"
    ref="popover"
    class="context-popover"
    role="group"
    data-focus-scope
    :aria-label="openSegment === 'shape' ? 'Form ändern' : openSegment === 'color' ? 'Farbe' : openSegment === 'line' ? 'Linie' : openSegment === 'font' ? 'Schriftart' : openSegment === 'size' ? 'Schriftgröße' : openSegment === 'table' ? 'Tabellenstruktur' : openSegment === 'link' ? 'Link' : openSegment === 'resource' ? 'Ressourcenkarte bearbeiten' : openSegment === 'author' ? 'Autor bearbeiten' : openSegment === 'align' ? 'Textausrichtung' : openSegment === 'actions' ? 'Elementaktionen' : openSegment === 'route' ? 'Linienform' : openSegment === 'start' ? 'Startpunkt' : openSegment === 'end' ? 'Endpunkt' : 'Komponenteneinstellungen'"
    :style="{ left: `${popoverAt.left}px`, top: `${popoverAt.top}px`, maxHeight: popoverAt.maxHeight ? `${popoverAt.maxHeight}px` : undefined }"
    @keydown="onKeydown"
    @compositionstart="store.setInputComposing(true)"
    @compositionend="store.setInputComposing(false)"
  >
    <template v-if="openSegment === 'shape'">
      <label class="shape-search">
        <AppIcon name="search" :size="18" />
        <input v-model="shapeQuery" class="search-input" type="search" aria-label="Form suchen" placeholder="Form suchen" autocomplete="off" spellcheck="false" />
      </label>
      <div class="shape-grid" role="group" aria-label="Formen">
        <button
          v-for="entry in shapes"
          :key="entry.id"
          type="button"
          class="shape-btn"
          :aria-label="entry.label"
          :title="entry.label"
          :aria-pressed="entry === currentShape"
          @click="pickShape(entry)"
        >
          <svg viewBox="0 0 24 24" aria-hidden="true"><path v-for="d in entry.icon" :key="d" :d="d" /></svg>
        </button>
        <p v-if="!shapes.length" class="shape-empty">Keine Form gefunden</p>
      </div>
    </template>

    <template v-else-if="openSegment === 'color'">
      <div v-if="!connectorOnly && !stickyOnly && !tableOnly" class="modes" role="group" aria-label="Füllart">
        <button v-for="mode in FILL_MODES" :key="mode.value" type="button" class="mode" :aria-pressed="currentFillMode === mode.value && !info.mixed.includes('fill')" @click="setFillMode(mode.value)">
          <svg class="mode-icon" viewBox="0 0 20 20" aria-hidden="true"><rect x="2.5" y="2.5" width="15" height="15" rx="3.5" fill="none" stroke="currentColor" stroke-width="1.6" /><rect v-if="mode.value !== 'none'" x="6" y="6" width="8" height="8" rx="1.5" fill="currentColor" :fill-opacity="mode.value === 'semi' ? 0.35 : 1" /><rect v-else x="6" y="6" width="8" height="8" rx="1.5" fill="none" stroke="currentColor" stroke-width="1.4" /></svg>
          {{ mode.label }}
        </button>
      </div>
      <ColorPalette v-if="connectorOnly" :value="strokeBase" prefix="Linie" group-label="Linienfarbe" :mixed="info.mixed.includes('stroke')" @pick="pickStroke" @layout="relayout" />
      <ColorPalette v-else :value="fillBase" prefix="Füllung" group-label="Füllfarbe" :mixed="info.mixed.includes('fill')" @pick="pickFill" @layout="relayout" />
    </template>

    <template v-else-if="openSegment === 'line'">
      <div class="modes" role="group" aria-label="Linienstil">
        <button v-for="mode in (connectorOnly ? LINE_MODES.filter((entry) => entry.value !== 'none') : LINE_MODES)" :key="mode.value" type="button" class="mode" :aria-pressed="lineMode === mode.value" @click="setLineMode(mode.value)">
          <AppIcon :name="mode.icon" :size="18" />{{ mode.label }}
        </button>
      </div>
      <ColorPalette v-if="!connectorOnly" :value="strokeBase" prefix="Kontur" group-label="Konturfarbe" :mixed="info.mixed.includes('stroke')" @pick="pickStroke" @layout="relayout" />
      <div class="widths" role="group" aria-label="Linienstärke">
        <button v-for="width in (connectorOnly ? CONNECTOR_WIDTHS : WIDTHS)" :key="width.value" type="button" class="mode width" :aria-label="`Linienstärke ${width.label}`" :title="width.label" :aria-pressed="info.values.strokeWidth === width.value && !info.mixed.includes('strokeWidth')" @click="style({ strokeWidth: width.value })">
          <svg viewBox="0 0 28 12" aria-hidden="true"><line x1="3" y1="6" x2="25" y2="6" stroke="currentColor" :stroke-width="width.value" stroke-linecap="round" /></svg>
        </button>
      </div>
    </template>

    <div v-else-if="openSegment === 'route'" class="choices column" role="group" aria-label="Linienform">
      <button v-for="route in ROUTES" :key="route.value" type="button" class="choice connector-choice" :aria-pressed="info.values.connectorRouting === route.value" @click="connectorPatch({ connectorRouting: route.value }); close(true)">
        <svg class="connector-choice-icon" viewBox="0 0 48 24" aria-hidden="true"><path v-if="route.value === 'straight'" d="M5 19L43 5" /><path v-else-if="route.value === 'curved'" d="M5 19C20 19 28 5 43 5" /><path v-else d="M5 19H24V5H43" /></svg>{{ route.label }}
      </button>
    </div>

    <div v-else-if="openSegment === 'start' || openSegment === 'end'" class="choices column" role="group" :aria-label="openSegment === 'start' ? 'Startpunkt' : 'Endpunkt'">
      <button v-for="marker in MARKERS" :key="marker.value" type="button" class="choice connector-choice" :aria-pressed="(openSegment === 'start' ? info.values.startMarker : info.values.endMarker) === marker.value" @click="connectorPatch(openSegment === 'start' ? { startMarker: marker.value } : { endMarker: marker.value }); close(true)">
        <svg class="connector-choice-icon" viewBox="0 0 48 24" aria-hidden="true"><line x1="5" y1="12" x2="40" y2="12" /><path v-if="marker.value === 'line-arrow'" d="M32 5l8 7-8 7" /><path v-else-if="marker.value === 'solid-arrow'" d="M30 4l11 8-11 8z" class="filled" /><path v-else-if="marker.value === 'triangle'" d="M29 4l12 8-12 8z" /><circle v-else-if="marker.value === 'circle'" cx="37" cy="12" r="6" /><path v-else-if="marker.value === 'diamond'" d="M29 12l6-7 7 7-7 7z" /></svg>{{ marker.label }}
      </button>
    </div>

    <div v-else-if="openSegment === 'font'" class="choices column" role="group" aria-label="Schriftart">
      <button v-for="font in FONT_OPTIONS" :key="font.value" type="button" class="choice" :aria-pressed="!fontMixed && currentFont === font.value" :data-font="font.value" @click="style({ fontFamily: font.value })"><span class="font-sample" :style="{ fontFamily: FONT_FAMILY_CSS[font.value] }" aria-hidden="true">Aa</span> {{ font.label }}</button>
    </div>

    <template v-else-if="openSegment === 'size'">
      <div class="choices column" role="group" aria-label="Größenvorgaben">
        <button v-for="preset in SIZE_PRESETS" :key="preset.value" type="button" class="choice" :aria-pressed="info.values.fontSize === preset.value && !info.mixed.includes('fontSize')" @click="style({ fontSize: preset.value })">{{ preset.label }} <span class="muted">{{ preset.value }} px</span></button>
      </div>
      <label class="field">Schriftgröße<input aria-label="Schriftgröße" class="ctx-input" type="number" min="1" max="1000" :value="info.mixed.includes('fontSize') ? '' : info.values.fontSize" :placeholder="info.mixed.includes('fontSize') ? 'Verschieden' : undefined" @input="setFontSize(($event.target as HTMLInputElement).valueAsNumber)" @change="commitFontSize(($event.target as HTMLInputElement).valueAsNumber)" /></label>
    </template>

    <div v-else-if="openSegment === 'table'" class="choices table-actions" role="group" aria-label="Zeilen und Spalten bearbeiten">
      <button type="button" class="choice" @click="store.changeTableStructure('row-before')">Zeile oberhalb einfügen</button>
      <button type="button" class="choice" @click="store.changeTableStructure('row-after')">Zeile unterhalb einfügen</button>
      <button type="button" class="choice" @click="store.changeTableStructure('column-before')">Spalte links einfügen</button>
      <button type="button" class="choice" @click="store.changeTableStructure('column-after')">Spalte rechts einfügen</button>
      <button type="button" class="choice" @click="store.changeTableStructure('row-duplicate')">Zeile duplizieren</button>
      <button type="button" class="choice" @click="store.changeTableStructure('column-duplicate')">Spalte duplizieren</button>
      <button type="button" class="choice" @click="store.changeTableStructure('row-up')">Zeile nach oben</button>
      <button type="button" class="choice" @click="store.changeTableStructure('row-down')">Zeile nach unten</button>
      <button type="button" class="choice" @click="store.changeTableStructure('column-left')">Spalte nach links</button>
      <button type="button" class="choice" @click="store.changeTableStructure('column-right')">Spalte nach rechts</button>
      <button type="button" class="choice danger" @click="store.changeTableStructure('row-delete')">Zeile löschen</button>
      <button type="button" class="choice danger" @click="store.changeTableStructure('column-delete')">Spalte löschen</button>
    </div>

    <ResourceCardEditor v-else-if="openSegment === 'resource' && single" :element="single" :document="s.document" @saved="close(true)" @cancel="close(true)" />

    <template v-else-if="openSegment === 'link'">
      <label class="field">{{ stickyOnly ? 'Link' : 'Dokumentationslink' }}<input v-model="linkDraft" class="ctx-input wide" type="url" :aria-label="stickyOnly ? 'Link' : 'Dokumentationslink'" placeholder="https://" @change="saveLink" @keydown.enter.prevent="saveLink" /></label>
      <button v-if="single?.documentationUrl" type="button" class="ctx-btn" @click="store.openDocumentationLink(single.documentationUrl)">{{ stickyOnly ? 'Link öffnen' : 'Dokumentation öffnen' }} ↗</button>
    </template>

    <template v-else-if="openSegment === 'author'">
      <label class="field">Autor<input v-model="authorDraft" class="ctx-input wide" type="text" aria-label="Autor" placeholder="Name" maxlength="240" @change="saveAuthor" @keydown.enter.prevent="saveAuthor" /></label>
    </template>

    <div v-else-if="openSegment === 'align'" class="choices" role="group" aria-label="Textausrichtung">
      <button v-for="align in ALIGNMENTS" :key="align.value" type="button" class="choice icon-choice" :aria-label="align.label" :title="align.label" :aria-pressed="info.values.textAlign === align.value && !info.mixed.includes('textAlign')" @click="style({ textAlign: align.value })"><AppIcon :name="align.icon" /></button>
    </div>

    <div v-else-if="openSegment === 'actions'" class="action-strip">
      <button type="button" class="action-button" aria-label="Ganz nach hinten" title="Ganz nach hinten" :disabled="!canMoveBackward" @click="runSelectionAction('back')"><AppIcon name="order-back" /></button>
      <button type="button" class="action-button" aria-label="Eine Ebene zurück" title="Eine Ebene zurück" :disabled="!canMoveBackward" @click="runSelectionAction('backward')"><AppIcon name="order-backward" /></button>
      <button type="button" class="action-button" aria-label="Eine Ebene vor" title="Eine Ebene vor" :disabled="!canMoveForward" @click="runSelectionAction('forward')"><AppIcon name="order-forward" /></button>
      <button type="button" class="action-button" aria-label="Ganz nach vorn" title="Ganz nach vorn" :disabled="!canMoveForward" @click="runSelectionAction('front')"><AppIcon name="order-front" /></button>
      <span class="action-separator" aria-hidden="true" />
      <button type="button" class="action-button" aria-label="Klonen" title="Klonen" @click="runSelectionAction('clone')"><AppIcon name="duplicate" /></button>
      <button type="button" class="action-button danger" aria-label="Löschen" title="Löschen" @click="runSelectionAction('delete')"><AppIcon name="trash" /></button>
    </div>

    <template v-else-if="openSegment === 'more'">
      <template v-for="item in definition?.widgets" :key="item.key">
        <label class="field">{{ item.label }}<select v-if="item.kind === 'select'" class="ctx-input wide" :value="single?.metadata?.[`widget:${single.componentType}:${item.key}`] ?? ''" @change="widget(item.key, ($event.target as HTMLSelectElement).value); store.commitPropertyDraft()"><option value="" disabled>Bitte auswählen</option><option v-for="option in item.options" :key="option">{{ option }}</option></select><input v-else class="ctx-input wide" :type="item.kind === 'number' ? 'number' : 'text'" :value="single?.metadata?.[`widget:${single.componentType}:${item.key}`] ?? ''" @input="widget(item.key, ($event.target as HTMLInputElement).value)" @change="store.commitPropertyDraft()" /></label>
      </template>
    </template>
  </div>
</template>

<style scoped>
.context-bar {
  position: absolute;
  z-index: 20;
  display: flex;
  align-items: center;
  gap: 2px;
  height: var(--chrome-height);
  max-width: calc(100vw - 24px);
  padding: 0 6px;
  overflow-x: auto;
  background: var(--menu-surface);
  border: 1px solid var(--border-subtle);
  border-radius: 16px;
  box-shadow: var(--shadow-panel);
  color: var(--menu-text);
  scrollbar-width: none;
}

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

  .segment[aria-expanded='true'],
  .choice[aria-pressed='true'] {
    forced-color-adjust: none;
    background: Highlight;
    color: HighlightText;
  }
}
</style>

<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, useId, watch } from 'vue';
import AppIcon from './AppIcon.vue';
import type { IconName } from './icons';
import { useWhiteboard } from './use-whiteboard';
import type { ElementStyle } from '@/domain';
import ColorPalette from './ColorPalette.vue';
import { fillMode, NO_COLOR, normalizeHex, withFillMode, type FillMode } from '@/renderer/lib/color';
import { docToScreen } from '@/renderer/lib/viewport';
import { matchesShape, SHAPE_CATALOG, SWAPPABLE_KINDS, type ShapeEntry } from '@/renderer/lib/shapes';

type Segment = 'shape' | 'color' | 'line' | 'font' | 'size' | 'link' | 'align' | 'more';

const store = useWhiteboard();
const s = store.state;
const uid = useId();
const info = computed(() => s.selectionInfo);
const single = computed(() => s.document.elements.find((e) => e.id === info.value.singleId));
const definition = computed(() => s.document.componentSets.flatMap((set) => set.components).find((c) => c.type === single.value?.componentType));

const SIZE_PRESETS = [{ label: 'Klein', value: 14 }, { label: 'Mittel', value: 20 }, { label: 'Groß', value: 28 }, { label: 'Sehr groß', value: 40 }] as const;
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

// --- Visibility and placement ----------------------------------------------------
const visible = computed(() => Boolean(info.value.count && s.frame && s.canWrite && !s.transitioning && !s.textEdit && !s.hasElementPreview && !s.draftElement && !s.marquee));
const textCapable = computed(() => info.value.kinds.some((kind) => !['image', 'path', 'connector'].includes(kind)));

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
  popover.value?.querySelector<HTMLElement>('input, select, textarea, button')?.focus();
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
  const buttons = Array.from(bar.value?.querySelectorAll<HTMLButtonElement>(':scope > .segment, :scope > .tool-btn') ?? []);
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
function style(patch: Partial<ElementStyle>): void { store.applyPatch({ style: patch }); }
function widget(key: string, value: string): void {
  if (single.value) store.setPropertyDraft({ metadata: { ...single.value.metadata, [`widget:${single.value.componentType}:${key}`]: value } });
}

const swatchColor = computed(() => {
  const fill = info.value.values.fill;
  return info.value.hasFill && fill && fill !== 'transparent' ? fill : info.value.values.stroke ?? '#1e1e1e';
});
const sizeLabel = computed(() => {
  if (info.value.mixed.includes('fontSize')) return 'Gemischt';
  const size = info.value.values.fontSize ?? 20;
  return SIZE_PRESETS.find((preset) => preset.value === size)?.label ?? `${size} px`;
});
const alignIcon = computed<IconName>(() => ALIGNMENTS.find((a) => a.value === info.value.values.textAlign)?.icon ?? 'align-left');
const isMono = computed(() => info.value.values.fontFamily === 'mono');
const linkDraft = ref('');
watch(() => single.value?.documentationUrl, (url) => { linkDraft.value = url ?? ''; }, { immediate: true });
function saveLink(): void {
  const url = linkDraft.value.trim();
  if (url === (single.value?.documentationUrl ?? '')) return;
  store.applyPatch({ documentationUrl: url || null });
}
const panelId = (segment: Segment) => `${uid}-${segment}`;

// --- Shape swap (#40) ------------------------------------------------------------------
const shapeQuery = ref('');
const swappable = computed(() => info.value.kinds.length > 0 && info.value.kinds.every((kind) => SWAPPABLE_KINDS.has(kind)));
const currentShape = computed(() => (info.value.kinds.length === 1 ? SHAPE_CATALOG.find((entry) => entry.kind === info.value.kinds[0]) : undefined) ?? SHAPE_CATALOG[1]);
const shapes = computed(() => SHAPE_CATALOG.filter((entry) => matchesShape(entry, shapeQuery.value)));
watch(openSegment, () => { shapeQuery.value = ''; });
function pickShape(entry: ShapeEntry): void {
  if (!entry.kind) return;
  store.replaceShape(entry.kind);
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
      <button :ref="(el) => setTrigger('shape', el)" type="button" class="segment" aria-label="Form ändern" :aria-expanded="openSegment === 'shape'" :aria-controls="panelId('shape')" title="Form ändern" @click="toggle('shape')">
        <svg class="shape-icon" viewBox="0 0 24 24" aria-hidden="true"><path v-for="d in currentShape?.icon ?? []" :key="d" :d="d" /></svg><AppIcon class="chev" name="chevron-down" :size="14" />
      </button>
      <span class="sep" aria-hidden="true" />
    </template>
    <button v-if="info.hasFill" :ref="(el) => setTrigger('color', el)" type="button" class="segment" aria-label="Farbe" :aria-expanded="openSegment === 'color'" :aria-controls="panelId('color')" title="Farbe" @click="toggle('color')">
      <span class="color-dot" :style="{ background: swatchColor }" aria-hidden="true" /><AppIcon class="chev" name="chevron-down" :size="14" />
    </button>
    <button :ref="(el) => setTrigger('line', el)" type="button" class="segment" aria-label="Linie" :aria-expanded="openSegment === 'line'" :aria-controls="panelId('line')" title="Linie" @click="toggle('line')">
      <AppIcon name="stroke" /><AppIcon class="chev" name="chevron-down" :size="14" />
    </button>
    <template v-if="textCapable">
      <span class="sep" aria-hidden="true" />
      <button :ref="(el) => setTrigger('font', el)" type="button" class="segment" aria-label="Schriftart" :aria-expanded="openSegment === 'font'" :aria-controls="panelId('font')" title="Schriftart" @click="toggle('font')">
        <span class="font-glyph" :class="{ mono: isMono }" aria-hidden="true">Aa</span><AppIcon class="chev" name="chevron-down" :size="14" />
      </button>
      <span class="sep" aria-hidden="true" />
      <button :ref="(el) => setTrigger('size', el)" type="button" class="segment size-segment" :aria-label="`Schriftgröße: ${sizeLabel}`" :aria-expanded="openSegment === 'size'" :aria-controls="panelId('size')" @click="toggle('size')">
        <span class="size-label">{{ sizeLabel }}</span><AppIcon class="chev" name="chevron-down" :size="14" />
      </button>
      <span class="sep" aria-hidden="true" />
      <button v-if="info.canEditText" type="button" class="tool-btn" aria-label="Text bearbeiten" title="Text bearbeiten" @click="store.startTextEdit(info.singleId ?? undefined)">
        <AppIcon name="text" />
      </button>
    </template>
    <button v-if="info.count === 1" :ref="(el) => setTrigger('link', el)" type="button" class="tool-btn" :class="{ on: Boolean(single?.documentationUrl) }" aria-label="Dokumentationslink" :aria-expanded="openSegment === 'link'" :aria-controls="panelId('link')" title="Dokumentationslink" @click="toggle('link')">
      <AppIcon name="link" />
    </button>
    <template v-if="textCapable">
      <span class="sep" aria-hidden="true" />
      <button :ref="(el) => setTrigger('align', el)" type="button" class="segment" aria-label="Textausrichtung" :aria-expanded="openSegment === 'align'" :aria-controls="panelId('align')" title="Textausrichtung" @click="toggle('align')">
        <AppIcon :name="alignIcon" /><AppIcon class="chev" name="chevron-down" :size="14" />
      </button>
    </template>
    <template v-if="definition?.widgets?.length">
      <span class="sep" aria-hidden="true" />
      <button :ref="(el) => setTrigger('more', el)" type="button" class="tool-btn" aria-label="Komponenteneinstellungen" :aria-expanded="openSegment === 'more'" :aria-controls="panelId('more')" title="Komponenteneinstellungen" @click="toggle('more')">
        <AppIcon name="more" />
      </button>
    </template>
  </div>

  <div
    v-if="visible && openSegment"
    :id="panelId(openSegment)"
    ref="popover"
    class="context-popover"
    role="group"
    data-focus-scope
    :aria-label="openSegment === 'shape' ? 'Form ändern' : openSegment === 'color' ? 'Farbe' : openSegment === 'line' ? 'Linie' : openSegment === 'font' ? 'Schriftart' : openSegment === 'size' ? 'Schriftgröße' : openSegment === 'link' ? 'Dokumentationslink' : openSegment === 'align' ? 'Textausrichtung' : 'Komponenteneinstellungen'"
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
          :title="entry.kind ? entry.label : `${entry.label} – folgt mit Formvarianten`"
          :aria-pressed="Boolean(entry.kind) && entry === currentShape"
          :aria-disabled="!entry.kind || undefined"
          @click="pickShape(entry)"
        >
          <svg viewBox="0 0 24 24" aria-hidden="true"><path v-for="d in entry.icon" :key="d" :d="d" /></svg>
        </button>
        <p v-if="!shapes.length" class="shape-empty">Keine Form gefunden</p>
      </div>
      <p class="shape-note">Weitere Formen folgen mit dem nächsten Dokumentformat.</p>
    </template>

    <template v-else-if="openSegment === 'color'">
      <div class="modes" role="group" aria-label="Füllart">
        <button v-for="mode in FILL_MODES" :key="mode.value" type="button" class="mode" :aria-pressed="currentFillMode === mode.value && !info.mixed.includes('fill')" @click="setFillMode(mode.value)">
          <svg class="mode-icon" viewBox="0 0 20 20" aria-hidden="true"><rect x="2.5" y="2.5" width="15" height="15" rx="3.5" fill="none" stroke="currentColor" stroke-width="1.6" /><rect v-if="mode.value !== 'none'" x="6" y="6" width="8" height="8" rx="1.5" fill="currentColor" :fill-opacity="mode.value === 'semi' ? 0.35 : 1" /><rect v-else x="6" y="6" width="8" height="8" rx="1.5" fill="none" stroke="currentColor" stroke-width="1.4" /></svg>
          {{ mode.label }}
        </button>
      </div>
      <ColorPalette :value="fillBase" prefix="Füllung" group-label="Füllfarbe" :mixed="info.mixed.includes('fill')" @pick="pickFill" @layout="relayout" />
    </template>

    <template v-else-if="openSegment === 'line'">
      <div class="modes" role="group" aria-label="Linienstil">
        <button v-for="mode in LINE_MODES" :key="mode.value" type="button" class="mode" :aria-pressed="lineMode === mode.value" @click="setLineMode(mode.value)">
          <AppIcon :name="mode.icon" :size="18" />{{ mode.label }}
        </button>
      </div>
      <ColorPalette :value="strokeBase" prefix="Kontur" group-label="Konturfarbe" :mixed="info.mixed.includes('stroke')" @pick="pickStroke" @layout="relayout" />
      <div class="widths" role="group" aria-label="Linienstärke">
        <button v-for="width in WIDTHS" :key="width.value" type="button" class="mode width" :aria-label="`Linienstärke ${width.label}`" :title="width.label" :aria-pressed="info.values.strokeWidth === width.value && !info.mixed.includes('strokeWidth')" @click="style({ strokeWidth: width.value })">
          <svg viewBox="0 0 28 12" aria-hidden="true"><line x1="3" y1="6" x2="25" y2="6" stroke="currentColor" :stroke-width="width.value" stroke-linecap="round" /></svg>
        </button>
      </div>
    </template>

    <div v-else-if="openSegment === 'font'" class="choices column" role="group" aria-label="Schriftart">
      <button type="button" class="choice" :aria-pressed="!isMono && !info.mixed.includes('fontFamily')" @click="style({ fontFamily: 'sans' })"><span class="font-sample">Aa</span> Serifenlos</button>
      <button type="button" class="choice" :aria-pressed="isMono && !info.mixed.includes('fontFamily')" @click="style({ fontFamily: 'mono' })"><span class="font-sample mono">Aa</span> Monospace</button>
    </div>

    <template v-else-if="openSegment === 'size'">
      <div class="choices column" role="group" aria-label="Größenvorgaben">
        <button v-for="preset in SIZE_PRESETS" :key="preset.value" type="button" class="choice" :aria-pressed="info.values.fontSize === preset.value && !info.mixed.includes('fontSize')" @click="style({ fontSize: preset.value })">{{ preset.label }} <span class="muted">{{ preset.value }} px</span></button>
      </div>
      <label class="field">Schriftgröße<input aria-label="Schriftgröße" class="ctx-input" type="number" min="1" max="1000" :value="info.mixed.includes('fontSize') ? '' : info.values.fontSize" :placeholder="info.mixed.includes('fontSize') ? 'Verschieden' : undefined" @input="store.setPropertyDraft({ style: { fontSize: ($event.target as HTMLInputElement).valueAsNumber } })" @change="store.commitPropertyDraft()" /></label>
    </template>

    <template v-else-if="openSegment === 'link'">
      <label class="field">Dokumentationslink<input v-model="linkDraft" class="ctx-input wide" type="url" aria-label="Dokumentationslink" placeholder="https://" @change="saveLink" @keydown.enter.prevent="saveLink" /></label>
      <button v-if="single?.documentationUrl" type="button" class="ctx-btn" @click="store.openDocumentationLink(single.documentationUrl)">Dokumentation öffnen ↗</button>
    </template>

    <div v-else-if="openSegment === 'align'" class="choices" role="group" aria-label="Textausrichtung">
      <button v-for="align in ALIGNMENTS" :key="align.value" type="button" class="choice icon-choice" :aria-label="align.label" :title="align.label" :aria-pressed="info.values.textAlign === align.value && !info.mixed.includes('textAlign')" @click="style({ textAlign: align.value })"><AppIcon :name="align.icon" /></button>
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

.segment:hover,
.tool-btn:hover {
  background: var(--menu-hover);
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

.font-glyph.mono,
.font-sample.mono {
  font-family: var(--font-mono);
  font-style: normal;
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
.shape-btn svg {
  width: 22px;
  height: 22px;
  fill: none;
  stroke: currentColor;
  stroke-width: 1.6;
  stroke-linecap: round;
  stroke-linejoin: round;
}

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
  width: 24px;
  font-family: Georgia, 'Times New Roman', serif;
  font-size: 16px;
  font-style: italic;
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

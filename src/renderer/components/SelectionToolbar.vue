<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, useId, watch } from 'vue';
import AppIcon from './AppIcon.vue';
import type { IconName } from './icons';
import { useWhiteboard } from './use-whiteboard';
import type { ElementStyle } from '@/domain';
import { FILL_COLORS, STROKE_COLORS } from '@/renderer/lib/constants';
import { docToScreen } from '@/renderer/lib/viewport';

type Segment = 'geometry' | 'color' | 'line' | 'font' | 'size' | 'link' | 'align' | 'more';

const store = useWhiteboard();
const s = store.state;
const uid = useId();
const info = computed(() => s.selectionInfo);
const single = computed(() => s.document.elements.find((e) => e.id === info.value.singleId));
const definition = computed(() => s.document.componentSets.flatMap((set) => set.components).find((c) => c.type === single.value?.componentType));

const fields = [['x', 'X'], ['y', 'Y'], ['width', 'Breite'], ['height', 'Höhe'], ['rotation', 'Winkel']] as const;
const SIZE_PRESETS = [{ label: 'Klein', value: 14 }, { label: 'Mittel', value: 20 }, { label: 'Groß', value: 28 }, { label: 'Sehr groß', value: 40 }] as const;
const ALIGNMENTS: ReadonlyArray<{ value: ElementStyle['textAlign']; label: string; icon: IconName }> = [
  { value: 'left', label: 'Links', icon: 'align-left' },
  { value: 'center', label: 'Mitte', icon: 'align-center' },
  { value: 'right', label: 'Rechts', icon: 'align-right' },
];
const DASHES: ReadonlyArray<{ value: ElementStyle['strokeDash']; label: string }> = [
  { value: 'solid', label: 'Durchgehend' },
  { value: 'dashed', label: 'Gestrichelt' },
  { value: 'dotted', label: 'Gepunktet' },
];

// --- Visibility and placement ----------------------------------------------------
const visible = computed(() => Boolean(info.value.count && s.frame && s.canWrite && !s.transitioning && !s.textEdit && !s.hasElementPreview && !s.draftElement && !s.marquee));
const textCapable = computed(() => info.value.kinds.some((kind) => !['image', 'path', 'connector'].includes(kind)));

const bar = ref<HTMLElement | null>(null);
const barSize = ref({ width: 0, height: 52 });
let observer: ResizeObserver | undefined;
watch(bar, (element) => {
  observer?.disconnect();
  if (!element) return;
  observer = new ResizeObserver(() => { barSize.value = { width: element.offsetWidth, height: element.offsetHeight }; });
  observer.observe(element);
});

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
const popoverAt = ref({ left: 0, top: 0 });

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

function placePopover(): void {
  const trigger = openSegment.value ? triggers.value[openSegment.value] : null;
  const box = popover.value?.getBoundingClientRect();
  const barBox = bar.value?.getBoundingClientRect();
  if (!trigger || !box || !barBox) return;
  const rect = trigger.getBoundingClientRect();
  const below = barBox.bottom + 8 + box.height <= window.innerHeight - 8;
  popoverAt.value = {
    left: Math.max(8, Math.min(rect.left, window.innerWidth - box.width - 8)),
    top: below ? barBox.bottom + 8 : Math.max(8, barBox.top - 8 - box.height),
  };
}

function close(returnFocus: boolean): void {
  const segment = openSegment.value;
  openSegment.value = null;
  if (returnFocus && segment) triggers.value[segment]?.focus();
}

watch(() => s.selection.join('|'), () => close(false));
watch(visible, (value) => { if (!value) close(false); });

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
onBeforeUnmount(() => { document.removeEventListener('pointerdown', onDocumentPointerDown, true); observer?.disconnect(); });

// --- Values --------------------------------------------------------------------------
function style(patch: Partial<ElementStyle>): void { store.applyPatch({ style: patch }); }
function number(field: typeof fields[number][0], event: Event): void { store.setPropertyDraft({ [field]: (event.target as HTMLInputElement).valueAsNumber }); }
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
</script>

<template>
  <div
    v-if="visible"
    ref="bar"
    class="context-bar"
    role="toolbar"
    aria-label="Eigenschaften"
    data-testid="properties-panel"
    :style="{ left: `${position.left}px`, top: `${position.top}px` }"
    @keydown="onBarKeydown"
    @compositionstart="store.setInputComposing(true)"
    @compositionend="store.setInputComposing(false)"
  >
    <button :ref="(el) => setTrigger('geometry', el)" type="button" class="segment" aria-label="Position und Größe" :aria-expanded="openSegment === 'geometry'" :aria-controls="panelId('geometry')" title="Position und Größe" @click="toggle('geometry')">
      <AppIcon name="shapes" /><AppIcon class="chev" name="chevron-down" :size="14" />
    </button>
    <span class="sep" aria-hidden="true" />
    <button :ref="(el) => setTrigger('color', el)" type="button" class="segment" aria-label="Farbe" :aria-expanded="openSegment === 'color'" :aria-controls="panelId('color')" title="Farbe" @click="toggle('color')">
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
    :aria-label="openSegment === 'geometry' ? 'Position und Größe' : openSegment === 'color' ? 'Farbe' : openSegment === 'line' ? 'Linie' : openSegment === 'font' ? 'Schriftart' : openSegment === 'size' ? 'Schriftgröße' : openSegment === 'link' ? 'Dokumentationslink' : openSegment === 'align' ? 'Textausrichtung' : 'Komponenteneinstellungen'"
    :style="{ left: `${popoverAt.left}px`, top: `${popoverAt.top}px` }"
    @keydown="onKeydown"
    @compositionstart="store.setInputComposing(true)"
    @compositionend="store.setInputComposing(false)"
  >
    <div v-if="openSegment === 'geometry'" class="grid">
      <label v-for="[field, label] in fields" :key="field" class="field">{{ label }}<input class="ctx-input" type="number" :aria-label="label" :value="info.mixed.includes(field) ? '' : info.values[field]" :placeholder="info.mixed.includes(field) ? 'Verschieden' : undefined" :min="field === 'width' || field === 'height' ? 1 : undefined" :disabled="field === 'rotation' && info.kinds.includes('container')" @input="number(field, $event)" @change="store.commitPropertyDraft()" /></label>
    </div>

    <template v-else-if="openSegment === 'color'">
      <p class="group-label">Kontur</p>
      <div class="swatches" role="group" aria-label="Konturfarbe">
        <button v-for="color in STROKE_COLORS" :key="color.value" type="button" class="swatch" :style="{ '--swatch': color.value }" :aria-label="`Kontur ${color.name}`" :aria-pressed="info.values.stroke === color.value && !info.mixed.includes('stroke')" @click="style({ stroke: color.value })" />
      </div>
      <template v-if="info.hasFill">
        <p class="group-label">Füllung</p>
        <div class="swatches" role="group" aria-label="Füllfarbe">
          <button v-for="color in FILL_COLORS" :key="color.value" type="button" class="swatch" :class="{ transparent: color.value === 'transparent' }" :style="{ '--swatch': color.value }" :aria-label="`Füllung ${color.name}`" :aria-pressed="info.values.fill === color.value && !info.mixed.includes('fill')" @click="style({ fill: color.value })" />
        </div>
      </template>
    </template>

    <template v-else-if="openSegment === 'line'">
      <label class="field">Linienstärke<input class="ctx-input" type="number" aria-label="Linienstärke" min="0" max="100" :value="info.values.strokeWidth" @input="store.setPropertyDraft({ style: { strokeWidth: ($event.target as HTMLInputElement).valueAsNumber } })" @change="store.commitPropertyDraft()" /></label>
      <p class="group-label">Linie</p>
      <div class="choices" role="group" aria-label="Linienstil">
        <button v-for="dash in DASHES" :key="dash.value" type="button" class="choice" :aria-pressed="info.values.strokeDash === dash.value && !info.mixed.includes('strokeDash')" @click="style({ strokeDash: dash.value })">{{ dash.label }}</button>
      </div>
      <label class="field">Deckkraft<input class="ctx-range" aria-label="Deckkraft" type="range" min="0" max="1" step=".05" :value="info.values.opacity" @change="style({ opacity: ($event.target as HTMLInputElement).valueAsNumber })" /></label>
    </template>

    <div v-else-if="openSegment === 'font'" class="choices column" role="group" aria-label="Schriftart">
      <button type="button" class="choice" :aria-pressed="!isMono && !info.mixed.includes('fontFamily')" @click="style({ fontFamily: 'sans' })"><span class="font-sample">Aa</span> Serifenlos</button>
      <button type="button" class="choice" :aria-pressed="isMono && !info.mixed.includes('fontFamily')" @click="style({ fontFamily: 'mono' })"><span class="font-sample mono">Aa</span> Monospace</button>
    </div>

    <template v-else-if="openSegment === 'size'">
      <div class="choices column" role="group" aria-label="Größenvorgaben">
        <button v-for="preset in SIZE_PRESETS" :key="preset.value" type="button" class="choice" :aria-pressed="info.values.fontSize === preset.value && !info.mixed.includes('fontSize')" @click="style({ fontSize: preset.value })">{{ preset.label }} <span class="muted">{{ preset.value }} px</span></button>
      </div>
      <label class="field">Schriftgröße<input aria-label="Schriftgröße" class="ctx-input" type="number" min="1" max="1000" :value="info.values.fontSize" @input="store.setPropertyDraft({ style: { fontSize: ($event.target as HTMLInputElement).valueAsNumber } })" @change="store.commitPropertyDraft()" /></label>
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
.swatch:focus-visible,
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
.context-popover {
  position: fixed;
  z-index: 35;
  display: grid;
  gap: 8px;
  min-width: 220px;
  max-width: min(320px, calc(100vw - 16px));
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

.ctx-range {
  width: 100%;
  accent-color: var(--menu-focus);
}

.swatches {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}

.swatch {
  position: relative;
  width: 26px;
  height: 26px;
  background: var(--swatch);
  border: 1px solid color-mix(in srgb, var(--text-primary) 18%, transparent);
  border-radius: 50%;
  cursor: pointer;
}

.swatch[aria-pressed='true'] {
  box-shadow: 0 0 0 2px var(--menu-surface), 0 0 0 4px var(--menu-focus);
}

.swatch.transparent {
  background: linear-gradient(135deg, transparent 46%, var(--status-error) 47%, var(--status-error) 53%, transparent 54%), var(--menu-field);
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

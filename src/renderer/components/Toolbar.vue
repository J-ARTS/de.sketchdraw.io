<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import { shapeBaseKind, type ShapeVariant } from '@/domain';
import { t } from '@/renderer/i18n';
import { shapeEntry, type ShapeEntry } from '@/renderer/lib/shapes';
import { useShapeToolbarState } from '@/renderer/lib/shape-toolbar-state';
import { TOOL_DEFS, formatCombo } from '@/renderer/lib/shortcuts';
import type { Tool } from '@/renderer/state/contract';
import AppIcon from './AppIcon.vue';
import ImageFileInput from './ImageFileInput.vue';
import ToolOptionsBar from './ToolOptionsBar.vue';
import ConnectorOptionsBar from './ConnectorOptionsBar.vue';
import WebEmbedDialog from './WebEmbedDialog.vue';
import { isMacPlatform } from './platform';
import { useHorizontalOverflow } from './use-horizontal-overflow';
import { useWhiteboard } from './use-whiteboard';

const store = useWhiteboard();
const isMac = isMacPlatform();
const root = ref<HTMLElement | null>(null);
const scroller = ref<HTMLElement | null>(null);
const { start: overflowStart, end: overflowEnd, page: pageTools, reveal } = useHorizontalOverflow(scroller);
const imageInput = ref<InstanceType<typeof ImageFileInput> | null>(null);
const focusedItem = ref<string | null>(null);
const toolbarState = useShapeToolbarState();
const { favorites, editing, announcement } = toolbarState;
const dragging = ref<ShapeVariant | null>(null);
const dropHandled = ref(false);
let longPressTimer: ReturnType<typeof setTimeout> | undefined;
let longPressStart: { x: number; y: number } | null = null;
let longPressTriggered = false;

const fixedTools = computed(() => TOOL_DEFS.filter((def) => !['rectangle', 'ellipse', 'diamond'].includes(def.tool)));
const beforeShapes = computed(() => fixedTools.value.filter((def) => ['select', 'hand'].includes(def.tool)));
const afterShapes = computed(() => fixedTools.value.filter((def) => !['select', 'hand'].includes(def.tool)));
const favoriteEntries = computed(() => favorites.value.map((id) => shapeEntry(id)).filter((entry): entry is ShapeEntry => Boolean(entry)));
const toolbarItemIds = computed(() => [
  ...beforeShapes.value.map((entry) => entry.tool),
  ...favorites.value.map((id) => `shape-${id}`),
  'more-shapes',
  ...afterShapes.value.map((entry) => entry.tool),
]);
const activeItem = computed(() => ['rectangle', 'ellipse', 'diamond'].includes(store.state.tool) ? `shape-${store.state.shapeVariant}` : store.state.tool);
const tabStop = computed(() => {
  const preferred = focusedItem.value ?? activeItem.value;
  return toolbarItemIds.value.includes(preferred) ? preferred : toolbarItemIds.value[0];
});
/** The active tool stays visible when the bar overflows, e.g. after a shortcut picked a scrolled-away tool (#78). */
function revealActive(): void { reveal(scroller.value?.querySelector(`[data-toolbar-item="${activeItem.value}"]`)); }
watch(activeItem, () => { void nextTick(revealActive); });
onMounted(revealActive);

function activateTool(tool: Tool): void {
  if (tool === 'image') { imageInput.value?.open(); return; }
  store.setTool(tool);
}
function enterEditMode(): void {
  toolbarState.startEditing();
  store.setCatalogOpen(true);
}
function leaveEditMode(): void {
  toolbarState.stopEditing();
  dragging.value = null;
}
function toggleCatalog(): void {
  if (longPressTriggered) {
    longPressTriggered = false;
    return;
  }
  const open = !store.state.catalogOpen;
  store.setCatalogOpen(open);
  if (!open && editing.value) leaveEditMode();
}
function startLongPress(event: PointerEvent): void {
  if (event.button !== 0 || editing.value) return;
  longPressTriggered = false;
  longPressStart = { x: event.clientX, y: event.clientY };
  longPressTimer = setTimeout(() => { longPressTriggered = true; enterEditMode(); }, 500);
}
function trackLongPress(event: PointerEvent): void {
  if (longPressStart && Math.hypot(event.clientX - longPressStart.x, event.clientY - longPressStart.y) > 8) cancelLongPress();
}
function cancelLongPress(): void {
  if (longPressTimer) clearTimeout(longPressTimer);
  longPressTimer = undefined;
  longPressStart = null;
}
function onDragStart(event: DragEvent, id: ShapeVariant): void {
  dragging.value = id;
  dropHandled.value = false;
  event.dataTransfer?.setData('text/x-sketchdraw-shape', id);
  if (event.dataTransfer) event.dataTransfer.effectAllowed = 'move';
}
function dropAt(event: DragEvent, index: number): void {
  event.preventDefault();
  const id = (dragging.value ?? event.dataTransfer?.getData('text/x-sketchdraw-shape')) as ShapeVariant | undefined;
  if (!id || !shapeEntry(id)) return;
  dropHandled.value = true;
  if (dragging.value) toolbarState.moveFavorite(favorites.value.indexOf(id), Math.min(index, favorites.value.length - 1));
  else toolbarState.addFavorite(id, index);
}
function onDragEnd(event: DragEvent): void {
  const active = dragging.value;
  if (active && editing.value && !dropHandled.value && root.value) {
    const box = root.value.getBoundingClientRect();
    const outside = event.clientX < box.left - 16 || event.clientX > box.right + 16 || event.clientY < box.top - 16 || event.clientY > box.bottom + 16;
    if (outside) toolbarState.removeFavorite(active);
  }
  dragging.value = null;
}
function onFavoriteKeydown(event: KeyboardEvent, id: ShapeVariant): void {
  const index = favorites.value.indexOf(id);
  if (editing.value && event.key === 'Delete') { event.preventDefault(); event.stopPropagation(); toolbarState.removeFavorite(id); return; }
  if (editing.value && event.altKey && (event.key === 'ArrowLeft' || event.key === 'ArrowRight')) {
    event.preventDefault();
    event.stopPropagation();
    toolbarState.moveFavorite(index, index + (event.key === 'ArrowRight' ? 1 : -1));
  }
}
function onFocusIn(event: FocusEvent): void {
  const target = event.target;
  if (target instanceof HTMLElement && target.dataset.toolbarItem) focusedItem.value = target.dataset.toolbarItem;
  // Browsers leave a partly visible item clipped on focus; show it completely (#78).
  reveal(target as Element | null);
}
function onFocusOut(event: FocusEvent): void {
  const next = event.relatedTarget;
  if (!(next instanceof Node) || !root.value?.contains(next)) focusedItem.value = null;
}
function onKeydown(event: KeyboardEvent): void {
  if (event.key === 'Escape' && (store.state.catalogOpen || editing.value)) {
    event.preventDefault(); event.stopPropagation(); store.setCatalogOpen(false); leaveEditMode(); return;
  }
  if (event.altKey || event.ctrlKey || event.metaKey) return;
  const buttons = Array.from(root.value?.querySelectorAll<HTMLButtonElement>('[data-toolbar-item]:not(:disabled)') ?? []);
  if (!buttons.length) return;
  const current = Math.max(buttons.findIndex((button) => button === document.activeElement), 0);
  let next: number;
  if (event.key === 'ArrowRight') next = (current + 1) % buttons.length;
  else if (event.key === 'ArrowLeft') next = (current - 1 + buttons.length) % buttons.length;
  else if (event.key === 'Home') next = 0;
  else if (event.key === 'End') next = buttons.length - 1;
  else return;
  event.preventDefault(); event.stopPropagation(); buttons[next]?.focus();
}
function fixedTip(tool: Tool): string {
  const def = TOOL_DEFS.find((item) => item.tool === tool)!;
  return t('tip.withHint', { label: t(def.label), hint: formatCombo(`${def.shift ? 'Umschalt+' : ''}${def.key}`, isMac) });
}
function toolbarShapeLabel(entry: ShapeEntry): string {
  return t(entry.id === 'square' ? 'Rechteck' : entry.id === 'circle' ? 'Ellipse' : entry.label);
}
onBeforeUnmount(cancelLongPress);
</script>

<template>
  <div ref="root" class="toolbar-wrap" @pointerdown.stop="startLongPress" @pointermove="trackLongPress" @pointerup="cancelLongPress" @pointercancel="cancelLongPress" @keydown="onKeydown" @focusin="onFocusIn" @focusout="onFocusOut">
    <div class="toolbar-frame sd-panel" :class="{ editing }">
      <!-- Pointer affordance only: keyboard users move with the arrow keys, which scroll the focused tool into view. -->
      <button v-show="overflowStart" type="button" class="overflow-btn start" data-testid="toolbar-scroll-start" tabindex="-1" aria-hidden="true" @pointerdown.stop.prevent @click="pageTools(-1)"><AppIcon name="chevron-left" :size="18" /></button>
      <div ref="scroller" class="toolbar" :class="{ editing }" data-testid="main-toolbar" role="toolbar" aria-orientation="horizontal" :aria-label="t('toolbar.label')">
        <button v-for="def in beforeShapes" :key="def.tool" type="button" class="tool sd-icon-btn" :data-tool="def.tool" :data-toolbar-item="def.tool" :tabindex="tabStop === def.tool ? 0 : -1" :disabled="!store.state.canWrite && !['select', 'hand'].includes(def.tool)" :aria-label="t(def.label)" :aria-pressed="def.tool === store.state.tool" :title="fixedTip(def.tool)" @click="activateTool(def.tool)"><AppIcon :name="def.tool" /></button>
        <span class="sep" aria-hidden="true" />
        <div class="shape-strip" data-testid="shape-favorites" @dragover.prevent @drop="dropAt($event, favorites.length)">
          <button v-for="(entry, index) in favoriteEntries" :key="entry.id" type="button" class="tool shape-tool sd-icon-btn" :class="{ dragging: dragging === entry.id }" :data-tool="shapeBaseKind(entry.id)" :data-shape="entry.id" :data-toolbar-item="`shape-${entry.id}`" :tabindex="tabStop === `shape-${entry.id}` ? 0 : -1" :disabled="!store.state.canWrite" :draggable="editing" :aria-label="editing ? t('{label}, Position {index}', { label: toolbarShapeLabel(entry), index: index + 1 }) : toolbarShapeLabel(entry)" :aria-pressed="store.state.shapeVariant === entry.id && ['rectangle', 'ellipse', 'diamond'].includes(store.state.tool)" :title="editing ? t('{label}: ziehen, Alt+Pfeil zum Verschieben, Entf zum Entfernen', { label: t(entry.label) }) : t(entry.label)" @click="store.setShapeTool(entry.id)" @keydown="onFavoriteKeydown($event, entry.id)" @dragstart="onDragStart($event, entry.id)" @dragover.prevent @drop.stop="dropAt($event, index)" @dragend="onDragEnd"><svg viewBox="0 0 24 24" aria-hidden="true"><path v-for="d in entry.icon" :key="d" :d="d" /></svg></button>
        </div>
        <button type="button" class="more-shapes" data-toolbar-item="more-shapes" data-testid="more-shapes" :tabindex="tabStop === 'more-shapes' ? 0 : -1" :aria-label="t('Weitere Formen')" :title="t('Weitere Formen')" :aria-expanded="store.state.catalogOpen" aria-controls="shape-library-panel" @click="toggleCatalog"><AppIcon name="more" /></button>
        <span class="sep" aria-hidden="true" />
        <template v-for="def in afterShapes" :key="def.tool">
          <span v-if="def.tool === 'text'" class="sep" aria-hidden="true" />
          <button type="button" class="tool sd-icon-btn" :data-tool="def.tool" :data-toolbar-item="def.tool" :tabindex="tabStop === def.tool ? 0 : -1" :disabled="!store.state.canWrite && def.tool !== 'laser'" :aria-label="t(def.label)" :aria-pressed="def.tool === 'image' ? undefined : def.tool === store.state.tool" :title="fixedTip(def.tool)" @click="activateTool(def.tool)"><AppIcon :name="def.tool" /></button>
        </template>
        <ImageFileInput ref="imageInput" />
        <WebEmbedDialog />
      </div>
      <button v-show="overflowEnd" type="button" class="overflow-btn end" data-testid="toolbar-scroll-end" tabindex="-1" aria-hidden="true" @pointerdown.stop.prevent @click="pageTools(1)"><AppIcon name="chevron-right" :size="18" /></button>
    </div>
    <ToolOptionsBar v-if="store.state.tool === 'path' || store.state.tool === 'eraser'" />
    <ConnectorOptionsBar v-else-if="store.state.tool === 'connector'" />
    <span class="sr-only" aria-live="polite">{{ announcement }}</span>
  </div>
</template>

<style scoped>
.toolbar-wrap{grid-area:tools;justify-self:center;display:flex;min-width:0;max-width:100%;align-items:center;flex-direction:column;gap:8px;pointer-events:auto}
/* The edge buttons take their own room beside the scroller, so they never cover a tool (#78). */
.toolbar-frame{display:flex;align-items:stretch;max-width:100%;min-height:var(--chrome-height);overflow:hidden}
.toolbar-frame.editing{outline:2px dashed var(--accent);outline-offset:3px}
.toolbar{display:flex;flex:1 1 auto;align-items:center;gap:4px;min-width:0;padding:0 7px;overflow-x:auto;overflow-y:hidden;scrollbar-width:none}
.overflow-btn{display:grid;flex:none;place-items:center;width:32px;padding:0;border:0;background:transparent;color:var(--text-muted);cursor:pointer}
.overflow-btn.start{border-right:1px solid var(--border-subtle)}
.overflow-btn.end{border-left:1px solid var(--border-subtle)}
.overflow-btn:hover{background:var(--surface-raised);color:var(--text-primary)}
.sep{flex:none;width:1px;height:24px;margin:0 4px;background:var(--border-subtle)}
.shape-strip{display:flex;align-items:center;gap:3px;min-height:44px}
.tool{position:relative;width:var(--chrome-control);height:var(--chrome-control);border-radius:10px;color:var(--text-primary);flex:none}
.tool[aria-pressed='true']{color:var(--accent);background:var(--accent-soft)}
.shape-tool svg{width:24px;height:24px;fill:none;stroke:currentColor;stroke-width:1.8;stroke-linecap:round;stroke-linejoin:round}
.shape-tool[aria-pressed='true'] svg path:first-child{fill:currentColor;fill-opacity:.13}
.shape-tool.dragging{opacity:.35}
.more-shapes{display:grid;place-items:center;flex:none;width:var(--chrome-control);height:var(--chrome-control);padding:0;border:0;background:transparent;color:var(--text-primary);cursor:pointer}
.more-shapes:hover,.more-shapes[aria-expanded='true']{background:transparent;color:var(--accent)}
.sr-only{position:absolute;width:1px;height:1px;padding:0;margin:-1px;overflow:hidden;clip:rect(0,0,0,0);white-space:nowrap;border:0}
@media (max-width:860px){.tool,.more-shapes{min-width:44px;min-height:44px}}
@media (prefers-reduced-motion:reduce){*{scroll-behavior:auto!important;transition:none!important}}
@media (forced-colors:active){.toolbar-frame.editing{outline:2px dashed Highlight}.shape-tool[aria-pressed='true']{outline:2px solid Highlight}.overflow-btn{color:ButtonText}}
</style>

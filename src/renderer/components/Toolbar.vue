<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue';
import { shapeBaseKind, type ShapeVariant } from '@/domain';
import { t } from '@/renderer/i18n/de';
import { matchesShape, shapeEntry, SHAPE_CATALOG, type ShapeEntry } from '@/renderer/lib/shapes';
import { DEFAULT_SHAPE_FAVORITES, MAX_SHAPE_FAVORITES, loadShapeFavorites, saveShapeFavorites } from '@/renderer/lib/shape-toolbar-preferences';
import { TOOL_DEFS, formatCombo } from '@/renderer/lib/shortcuts';
import type { Tool } from '@/renderer/state/contract';
import AppIcon from './AppIcon.vue';
import ImageFileInput from './ImageFileInput.vue';
import { isMacPlatform } from './platform';
import { useWhiteboard } from './use-whiteboard';

const store = useWhiteboard();
const isMac = isMacPlatform();
const root = ref<HTMLElement | null>(null);
const imageInput = ref<InstanceType<typeof ImageFileInput> | null>(null);
const focusedItem = ref<string | null>(null);
const favorites = ref<ShapeVariant[]>(loadShapeFavorites());
const catalogOpen = ref(false);
const editing = ref(false);
const query = ref('');
const announcement = ref('');
const dragging = ref<{ id: ShapeVariant; source: 'favorite' | 'catalog' } | null>(null);
const dropHandled = ref(false);
let longPressTimer: ReturnType<typeof setTimeout> | undefined;
let longPressStart: { x: number; y: number } | null = null;

const fixedTools = computed(() => TOOL_DEFS.filter((def) => !['rectangle', 'ellipse', 'diamond'].includes(def.tool)));
const beforeShapes = computed(() => fixedTools.value.filter((def) => ['select', 'hand'].includes(def.tool)));
const afterShapes = computed(() => fixedTools.value.filter((def) => !['select', 'hand'].includes(def.tool)));
const filteredShapes = computed(() => SHAPE_CATALOG.filter((entry) => matchesShape(entry, query.value)));
const favoriteEntries = computed(() => favorites.value.map((id) => shapeEntry(id)).filter((entry): entry is ShapeEntry => Boolean(entry)));
const toolbarItemIds = computed(() => [
  ...beforeShapes.value.map((entry) => entry.tool),
  ...favorites.value.map((id) => `shape-${id}`),
  'more-shapes',
  ...afterShapes.value.map((entry) => entry.tool),
]);
const tabStop = computed(() => {
  const active = ['rectangle', 'ellipse', 'diamond'].includes(store.state.tool) ? `shape-${store.state.shapeVariant}` : store.state.tool;
  const preferred = focusedItem.value ?? active;
  return toolbarItemIds.value.includes(preferred) ? preferred : toolbarItemIds.value[0];
});

function persist(message?: string): void {
  saveShapeFavorites(favorites.value);
  if (message) announcement.value = message;
}
function activateTool(tool: Tool): void {
  if (tool === 'image') { imageInput.value?.open(); return; }
  store.setTool(tool);
}
function activateShape(entry: ShapeEntry): void {
  if (editing.value) { addFavorite(entry.id); return; }
  store.setShapeTool(entry.id);
  catalogOpen.value = false;
}
function addFavorite(id: ShapeVariant, index = favorites.value.length): void {
  const existing = favorites.value.indexOf(id);
  if (existing >= 0) { moveFavorite(existing, Math.min(index, favorites.value.length - 1)); return; }
  if (favorites.value.length >= MAX_SHAPE_FAVORITES) {
    announcement.value = `Die Leiste kann höchstens ${MAX_SHAPE_FAVORITES} Formen enthalten.`;
    return;
  }
  const next = [...favorites.value];
  next.splice(Math.max(0, Math.min(index, next.length)), 0, id);
  favorites.value = next;
  persist(`${shapeEntry(id)?.label ?? id} wurde zur Leiste hinzugefügt.`);
}
function moveFavorite(from: number, to: number): void {
  if (from === to || from < 0 || to < 0 || from >= favorites.value.length || to >= favorites.value.length) return;
  const next = [...favorites.value];
  const [item] = next.splice(from, 1);
  next.splice(to, 0, item!);
  favorites.value = next;
  persist(`${shapeEntry(item!)?.label ?? item} steht jetzt an Position ${to + 1}.`);
}
function removeFavorite(id: ShapeVariant): void {
  if (favorites.value.length <= 1) { announcement.value = 'Mindestens eine Form muss in der Leiste bleiben.'; return; }
  favorites.value = favorites.value.filter((favorite) => favorite !== id);
  persist(`${shapeEntry(id)?.label ?? id} wurde aus der Leiste entfernt.`);
}
function resetFavorites(): void {
  favorites.value = [...DEFAULT_SHAPE_FAVORITES];
  persist('Die Standardformen wurden wiederhergestellt.');
}
function enterEditMode(): void {
  editing.value = true;
  catalogOpen.value = true;
  announcement.value = 'Bearbeitungsmodus für die Formenleiste aktiviert.';
}
function leaveEditMode(): void {
  editing.value = false;
  dragging.value = null;
  announcement.value = 'Bearbeitungsmodus beendet.';
}
function toggleCatalog(): void { catalogOpen.value = !catalogOpen.value; query.value = ''; }
function startLongPress(event: PointerEvent): void {
  if (event.button !== 0 || editing.value) return;
  longPressStart = { x: event.clientX, y: event.clientY };
  longPressTimer = setTimeout(enterEditMode, 500);
}
function trackLongPress(event: PointerEvent): void {
  if (longPressStart && Math.hypot(event.clientX - longPressStart.x, event.clientY - longPressStart.y) > 8) cancelLongPress();
}
function cancelLongPress(): void {
  if (longPressTimer) clearTimeout(longPressTimer);
  longPressTimer = undefined;
  longPressStart = null;
}
function onDragStart(event: DragEvent, id: ShapeVariant, source: 'favorite' | 'catalog'): void {
  dragging.value = { id, source };
  dropHandled.value = false;
  event.dataTransfer?.setData('text/x-sketchdraw-shape', id);
  if (event.dataTransfer) event.dataTransfer.effectAllowed = source === 'favorite' ? 'move' : 'copy';
}
function dropAt(event: DragEvent, index: number): void {
  event.preventDefault();
  const id = dragging.value?.id ?? event.dataTransfer?.getData('text/x-sketchdraw-shape') as ShapeVariant;
  if (!id) return;
  dropHandled.value = true;
  if (dragging.value?.source === 'favorite') moveFavorite(favorites.value.indexOf(id), Math.min(index, favorites.value.length - 1));
  else addFavorite(id, index);
}
function onDragEnd(event: DragEvent): void {
  const active = dragging.value;
  if (active?.source === 'favorite' && editing.value && !dropHandled.value && root.value) {
    const box = root.value.getBoundingClientRect();
    const outside = event.clientX < box.left - 16 || event.clientX > box.right + 16 || event.clientY < box.top - 16 || event.clientY > box.bottom + 16;
    if (outside) removeFavorite(active.id);
  }
  dragging.value = null;
}
function onFavoriteKeydown(event: KeyboardEvent, id: ShapeVariant): void {
  const index = favorites.value.indexOf(id);
  if (editing.value && event.key === 'Delete') { event.preventDefault(); event.stopPropagation(); removeFavorite(id); return; }
  if (editing.value && event.altKey && (event.key === 'ArrowLeft' || event.key === 'ArrowRight')) {
    event.preventDefault();
    event.stopPropagation();
    moveFavorite(index, Math.max(0, Math.min(favorites.value.length - 1, index + (event.key === 'ArrowRight' ? 1 : -1))));
  }
}
function onFocusIn(event: FocusEvent): void {
  const target = event.target;
  if (target instanceof HTMLElement && target.dataset.toolbarItem) focusedItem.value = target.dataset.toolbarItem;
}
function onFocusOut(event: FocusEvent): void {
  const next = event.relatedTarget;
  if (!(next instanceof Node) || !root.value?.contains(next)) focusedItem.value = null;
}
function onKeydown(event: KeyboardEvent): void {
  if (event.key === 'Escape' && (catalogOpen.value || editing.value)) {
    event.preventDefault(); event.stopPropagation(); catalogOpen.value = false; leaveEditMode(); return;
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
  return t('tip.withHint', { label: def.label, hint: formatCombo(def.key, isMac) });
}
function toolbarShapeLabel(entry: ShapeEntry): string {
  return entry.id === 'square' ? 'Rechteck' : entry.id === 'circle' ? 'Ellipse' : entry.label;
}
function onOutsidePointer(event: PointerEvent): void {
  if (catalogOpen.value && event.target instanceof Node && !root.value?.contains(event.target)) catalogOpen.value = false;
}
onMounted(() => document.addEventListener('pointerdown', onOutsidePointer, true));
onBeforeUnmount(() => { cancelLongPress(); document.removeEventListener('pointerdown', onOutsidePointer, true); });
</script>

<template>
  <div ref="root" class="toolbar-wrap" @pointerdown.stop="startLongPress" @pointermove="trackLongPress" @pointerup="cancelLongPress" @pointercancel="cancelLongPress" @keydown="onKeydown" @focusin="onFocusIn" @focusout="onFocusOut">
    <div class="toolbar sd-panel" :class="{ editing }" role="toolbar" aria-orientation="horizontal" :aria-label="t('toolbar.label')">
      <button v-for="def in beforeShapes" :key="def.tool" type="button" class="tool sd-icon-btn" :data-tool="def.tool" :data-toolbar-item="def.tool" :tabindex="tabStop === def.tool ? 0 : -1" :disabled="!store.state.canWrite && !['select', 'hand'].includes(def.tool)" :aria-label="def.label" :aria-pressed="def.tool === store.state.tool" :title="fixedTip(def.tool)" @click="activateTool(def.tool)"><AppIcon :name="def.tool" /></button>
      <span class="sep" aria-hidden="true" />
      <div class="shape-strip" data-testid="shape-favorites" @dragover.prevent @drop="dropAt($event, favorites.length)">
        <button v-for="(entry, index) in favoriteEntries" :key="entry.id" type="button" class="tool shape-tool sd-icon-btn" :class="{ dragging: dragging?.id === entry.id }" :data-tool="shapeBaseKind(entry.id)" :data-shape="entry.id" :data-toolbar-item="`shape-${entry.id}`" :tabindex="tabStop === `shape-${entry.id}` ? 0 : -1" :disabled="!store.state.canWrite" :draggable="editing" :aria-label="`${toolbarShapeLabel(entry)}${editing ? ', Position ' + (index + 1) : ''}`" :aria-pressed="store.state.shapeVariant === entry.id && ['rectangle', 'ellipse', 'diamond'].includes(store.state.tool)" :title="editing ? `${entry.label}: ziehen, Alt+Pfeil zum Verschieben, Entf zum Entfernen` : entry.label" @click="store.setShapeTool(entry.id)" @keydown="onFavoriteKeydown($event, entry.id)" @dragstart="onDragStart($event, entry.id, 'favorite')" @dragover.prevent @drop.stop="dropAt($event, index)" @dragend="onDragEnd"><svg viewBox="0 0 24 24" aria-hidden="true"><path v-for="d in entry.icon" :key="d" :d="d" /></svg></button>
      </div>
      <button type="button" class="more-shapes" data-toolbar-item="more-shapes" data-testid="more-shapes" :tabindex="tabStop === 'more-shapes' ? 0 : -1" aria-label="Weitere Formen" :aria-expanded="catalogOpen" @click="toggleCatalog"><span aria-hidden="true">•••</span><span class="more-label">Weitere Formen</span></button>
      <span class="sep" aria-hidden="true" />
      <template v-for="def in afterShapes" :key="def.tool">
        <span v-if="def.tool === 'text'" class="sep" aria-hidden="true" />
        <button type="button" class="tool sd-icon-btn" :data-tool="def.tool" :data-toolbar-item="def.tool" :tabindex="tabStop === def.tool ? 0 : -1" :disabled="!store.state.canWrite" :aria-label="def.label" :aria-pressed="def.tool === 'image' ? undefined : def.tool === store.state.tool" :title="fixedTip(def.tool)" @click="activateTool(def.tool)"><AppIcon :name="def.tool" /></button>
      </template>
      <ImageFileInput ref="imageInput" />
    </div>

    <section v-if="catalogOpen" class="shape-catalog sd-panel" role="dialog" aria-label="Weitere Formen" data-testid="shape-catalog" @pointerdown.stop>
      <header class="catalog-header">
        <label class="shape-search"><AppIcon name="search" :size="18" /><input v-model="query" type="search" aria-label="Form suchen" placeholder="Form suchen" autocomplete="off" /></label>
        <button type="button" class="edit-toggle" :aria-pressed="editing" @click="editing ? leaveEditMode() : enterEditMode()">{{ editing ? 'Fertig' : 'Leiste anpassen' }}</button>
      </header>
      <p v-if="editing" class="edit-help">Ziehe Formen in die Leiste. Ziehe eine Form aus der Leiste heraus, um sie zu entfernen. Alt+Pfeil ändert die Reihenfolge, Entf entfernt.</p>
      <div class="catalog-grid" role="group" aria-label="Formkatalog">
        <button v-for="entry in filteredShapes" :key="entry.id" type="button" class="catalog-shape" :class="{ favorite: favorites.includes(entry.id) }" draggable="true" :aria-label="`${entry.label}${favorites.includes(entry.id) ? ', in der Leiste' : ''}`" @click="activateShape(entry)" @dragstart="onDragStart($event, entry.id, 'catalog')" @dragend="onDragEnd"><svg viewBox="0 0 24 24" aria-hidden="true"><path v-for="d in entry.icon" :key="d" :d="d" /></svg><span>{{ entry.label }}</span><span v-if="favorites.includes(entry.id)" aria-hidden="true">✓</span></button>
        <p v-if="!filteredShapes.length" class="empty">Keine Form gefunden.</p>
      </div>
      <footer v-if="editing" class="catalog-footer"><button type="button" @click="resetFavorites">Standard wiederherstellen</button></footer>
    </section>
    <span class="sr-only" aria-live="polite">{{ announcement }}</span>
  </div>
</template>

<style scoped>
.toolbar-wrap{position:absolute;top:var(--space-3);left:50%;z-index:10;width:max-content;max-width:calc(100vw - 600px);transform:translateX(-50%)}
.toolbar{display:flex;align-items:center;gap:4px;max-width:100%;min-height:var(--chrome-height);padding:0 6px;overflow-x:auto;overflow-y:hidden}
.toolbar.editing{outline:2px dashed var(--accent);outline-offset:3px}
.sep{flex:none;width:1px;height:24px;margin:0 4px;background:var(--border-subtle)}
.shape-strip{display:flex;align-items:center;gap:3px;min-height:44px}
.tool{position:relative;width:var(--chrome-control);height:var(--chrome-control);border-radius:10px;color:var(--text-primary);flex:none}
.tool[aria-pressed='true']{color:var(--accent);background:var(--accent-soft)}
.shape-tool svg,.catalog-shape svg{width:24px;height:24px;fill:none;stroke:currentColor;stroke-width:1.8;stroke-linecap:round;stroke-linejoin:round}
.shape-tool[aria-pressed='true'] svg path:first-child{fill:currentColor;fill-opacity:.13}
.shape-tool.dragging{opacity:.35}
.more-shapes{display:flex;align-items:center;gap:8px;min-height:38px;padding:0 10px;border:1px solid var(--border-subtle);border-radius:9px;color:var(--text-primary);background:transparent;white-space:nowrap}
.more-shapes:hover,.more-shapes[aria-expanded='true']{background:var(--surface-hover)}
.more-shapes>span:first-child{font-weight:700;letter-spacing:2px}
.shape-catalog{position:absolute;top:calc(100% + 10px);left:50%;width:min(620px,calc(100vw - 24px));max-height:min(620px,calc(100vh - 110px));padding:14px;overflow:auto;transform:translateX(-50%);box-shadow:var(--shadow-3)}
.catalog-header{display:flex;align-items:center;gap:10px;position:sticky;top:-14px;z-index:1;padding:4px 0 12px;background:var(--surface-panel)}
.shape-search{display:flex;align-items:center;gap:8px;flex:1;padding:0 10px;border:1px solid var(--border-subtle);border-radius:9px}
.shape-search:focus-within{border-color:var(--accent)}
.shape-search input{width:100%;height:38px;border:0;outline:0;background:transparent;color:var(--text-primary)}
.edit-toggle,.catalog-footer button{min-height:38px;padding:0 12px;border:1px solid var(--border-subtle);border-radius:9px;background:var(--surface-raised);color:var(--text-primary)}
.edit-toggle[aria-pressed='true']{color:var(--accent);border-color:var(--accent)}
.edit-help{margin:0 0 12px;color:var(--text-secondary);font-size:var(--font-size-s)}
.catalog-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(128px,1fr));gap:6px}
.catalog-shape{display:grid;grid-template-columns:32px 1fr auto;align-items:center;gap:8px;min-height:48px;padding:6px 9px;border:1px solid transparent;border-radius:9px;background:transparent;color:var(--text-primary);text-align:left}
.catalog-shape:hover,.catalog-shape:focus-visible{background:var(--surface-hover);border-color:var(--border-subtle)}
.catalog-shape.favorite{color:var(--accent)}
.empty{grid-column:1/-1;color:var(--text-secondary)}
.catalog-footer{display:flex;justify-content:flex-end;margin-top:12px;padding-top:12px;border-top:1px solid var(--border-subtle)}
.sr-only{position:absolute;width:1px;height:1px;padding:0;margin:-1px;overflow:hidden;clip:rect(0,0,0,0);white-space:nowrap;border:0}
@media (max-width:1040px){.toolbar-wrap{top:84px;max-width:calc(100vw - 24px)}}
@media (max-width:860px){.more-label{display:none}.shape-catalog{width:calc(100vw - 24px);max-height:calc(100vh - 168px)}.tool,.more-shapes{min-width:44px;min-height:44px}}
@media (prefers-reduced-motion:reduce){*{scroll-behavior:auto!important;transition:none!important}}
@media (forced-colors:active){.toolbar.editing{outline:2px dashed Highlight}.shape-tool[aria-pressed='true'],.catalog-shape.favorite{outline:2px solid Highlight}}
</style>

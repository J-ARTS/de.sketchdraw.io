<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, ref } from 'vue';
import { useWhiteboard } from './use-whiteboard';
import { docToScreen } from '../lib/viewport';
import { fontFamilyCss } from '../lib/constants';
import { themeColor } from '../lib/theme';
import AppIcon from './AppIcon.vue';

const store = useWhiteboard();
const s = store.state;
const editingId = ref<string | null>(null);
const draft = ref('');
const preview = ref<{ x: number; y: number; width: number; height: number } | null>(null);
let gesture: { kind: 'move' | 'resize'; handle?: 'nw' | 'ne' | 'se' | 'sw'; pointerId: number; startX: number; startY: number; base: { x: number; y: number; width: number; height: number } } | null = null;
const element = computed(() => s.selection.length === 1 ? s.document.elements.find((entry) => entry.id === s.selection[0] && entry.kind === 'table') : undefined);
const table = computed(() => element.value?.table);
const style = computed(() => {
  const value = element.value;
  if (!value) return {};
  const box = preview.value ?? value; const point = docToScreen(s.viewport, box);
  return { left: `${point.x}px`, top: `${point.y}px`, width: `${box.width * s.viewport.zoom}px`, height: `${box.height * s.viewport.zoom}px`, transform: `rotate(${value.rotation}deg)`, '--table-zoom': s.viewport.zoom };
});
const gridStyle = computed(() => ({
  gridTemplateColumns: table.value?.columns.map((column) => `${column.width}fr`).join(' '),
  gridTemplateRows: table.value?.rows.map((row) => `${row.height}fr`).join(' '),
}));
const ordered = computed(() => table.value?.rows.flatMap((row, rowIndex) => table.value!.columns.map((column, columnIndex) => ({
  rowIndex, columnIndex, cell: table.value!.cells.find((entry) => entry.rowId === row.id && entry.columnId === column.id)!,
}))) ?? []);
const gridRows = computed(() => table.value?.rows.map((row, rowIndex) => ({
  id: row.id,
  cells: table.value!.columns.map((column, columnIndex) => ({ rowIndex, columnIndex, cell: table.value!.cells.find((entry) => entry.rowId === row.id && entry.columnId === column.id)! })),
})) ?? []);
const columnInsertions = computed(() => {
  const columns = table.value?.columns ?? [];
  const total = columns.reduce((sum, column) => sum + column.width, 0);
  let offset = 0;
  return columns.slice(0, -1).map((column, index) => {
    offset += column.width;
    return { index: index + 1, left: total > 0 ? `${offset / total * 100}%` : '0%' };
  });
});
const selectedIds = computed(() => { const selection = s.tableSelection; return new Set(selection && selection.elementId === element.value?.id ? selection.cellIds : []); });
function selectCell(cellId: string, rowIndex: number, columnIndex: number): void {
  if (!element.value) return;
  if (s.tool === 'comment') { store.startComment(element.value.id, cellId); return; }
  store.selectTableCells(element.value.id, [cellId], 'cell', rowIndex, columnIndex);
}
function selectRow(rowIndex: number): void {
  if (!element.value || !table.value) return;
  const id = table.value.rows[rowIndex]!.id;
  store.selectTableCells(element.value.id, table.value.cells.filter((cell) => cell.rowId === id).map((cell) => cell.id), 'row', rowIndex, 0);
}
function selectColumn(columnIndex: number): void {
  if (!element.value || !table.value) return;
  const id = table.value.columns[columnIndex]!.id;
  store.selectTableCells(element.value.id, table.value.cells.filter((cell) => cell.columnId === id).map((cell) => cell.id), 'column', 0, columnIndex);
}
async function edit(cellId: string, text: string, rowIndex: number, columnIndex: number): Promise<void> {
  selectCell(cellId, rowIndex, columnIndex); editingId.value = cellId; draft.value = text;
  await nextTick(); const input = document.querySelector<HTMLTextAreaElement>('[data-testid="table-cell-editor"]'); input?.focus(); input?.select();
}
function save(): void {
  const value = element.value; const id = editingId.value;
  if (!value || !id) return;
  const current = value.table?.cells.find((cell) => cell.id === id)?.text ?? '';
  if (draft.value !== current) store.setTableCellText(value.id, id, draft.value);
}
function commit(): void {
  save();
  editingId.value = null;
}
function navigate(delta: number): void {
  const index = ordered.value.findIndex((entry) => entry.cell.id === editingId.value);
  save();
  const next = ordered.value[Math.max(0, Math.min(ordered.value.length - 1, index + delta))];
  if (next) void edit(next.cell.id, next.cell.text, next.rowIndex, next.columnIndex);
}
function blur(cellId: string): void { if (editingId.value === cellId) commit(); }
function keydown(event: KeyboardEvent): void {
  if (event.key === 'Tab') { event.preventDefault(); navigate(event.shiftKey ? -1 : 1); }
  else if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) { event.preventDefault(); commit(); }
  else if (event.key === 'Escape') { event.preventDefault(); editingId.value = null; }
}
function startGesture(event: PointerEvent, kind: 'move' | 'resize', handle?: 'nw' | 'ne' | 'se' | 'sw'): void {
  const value = element.value; if (!value || event.button !== 0) return;
  event.preventDefault(); event.stopPropagation();
  const target = event.currentTarget;
  if (target instanceof HTMLElement) target.setPointerCapture(event.pointerId);
  gesture = { kind, handle, pointerId: event.pointerId, startX: event.clientX, startY: event.clientY, base: { x: value.x, y: value.y, width: value.width, height: value.height } };
  window.addEventListener('pointermove', updateGesture);
  window.addEventListener('pointerup', finishGesture);
  window.addEventListener('pointercancel', cancelGesture);
}
function updateGesture(event: PointerEvent): void {
  if (!gesture || event.pointerId !== gesture.pointerId) return;
  const dx = (event.clientX - gesture.startX) / s.viewport.zoom; const dy = (event.clientY - gesture.startY) / s.viewport.zoom;
  if (gesture.kind === 'move') preview.value = { ...gesture.base, x: gesture.base.x + dx, y: gesture.base.y + dy };
  else {
    const left = gesture.handle?.includes('w') ? Math.min(gesture.base.x + gesture.base.width - 80, gesture.base.x + dx) : gesture.base.x;
    const top = gesture.handle?.includes('n') ? Math.min(gesture.base.y + gesture.base.height - 48, gesture.base.y + dy) : gesture.base.y;
    const right = gesture.handle?.includes('e') ? Math.max(gesture.base.x + 80, gesture.base.x + gesture.base.width + dx) : gesture.base.x + gesture.base.width;
    const bottom = gesture.handle?.includes('s') ? Math.max(gesture.base.y + 48, gesture.base.y + gesture.base.height + dy) : gesture.base.y + gesture.base.height;
    preview.value = { x: left, y: top, width: right - left, height: bottom - top };
  }
}
function cleanupGesture(): void {
  window.removeEventListener('pointermove', updateGesture);
  window.removeEventListener('pointerup', finishGesture);
  window.removeEventListener('pointercancel', cancelGesture);
}
function cancelGesture(event?: PointerEvent): void {
  if (event && gesture && event.pointerId !== gesture.pointerId) return;
  cleanupGesture(); gesture = null; preview.value = null;
}
function finishGesture(event?: PointerEvent): void {
  if (event && gesture && event.pointerId !== gesture.pointerId) return;
  cleanupGesture();
  const value = preview.value; gesture = null; preview.value = null;
  if (value) store.applyPatch(value);
}
function insertColumnAt(index: number): void {
  selectColumn(Math.max(0, index - 1));
  store.changeTableStructure('column-after');
}
onBeforeUnmount(cleanupGesture);
</script>

<template>
  <div v-if="element && table" class="table-overlay" :style="style" data-testid="table-overlay" @pointerdown.stop>
    <button type="button" class="move-handle" aria-label="Tabelle verschieben" @pointerdown="startGesture($event, 'move')">≡</button>
    <button v-for="handle in (['nw', 'ne', 'se', 'sw'] as const)" :key="handle" type="button" class="resize-handle" :class="handle" :aria-label="`Tabelle an Ecke ${handle} skalieren`" @pointerdown="startGesture($event, 'resize', handle)" />
    <div class="column-handles" :style="{ gridTemplateColumns: gridStyle.gridTemplateColumns }">
      <button v-for="(_, index) in table.columns" :key="index" type="button" :aria-label="`Spalte ${index + 1} auswählen`" @click="selectColumn(index)"><span /></button>
    </div>
    <div class="column-insertions" role="group" aria-label="Spalten einfügen">
      <button v-for="boundary in columnInsertions" :key="boundary.index" type="button" :style="{ left: boundary.left }" :aria-label="`Spalte zwischen ${boundary.index} und ${boundary.index + 1} hinzufügen`" @click="insertColumnAt(boundary.index)"><AppIcon name="plus" :size="14" /></button>
    </div>
    <div class="row-handles" :style="{ gridTemplateRows: gridStyle.gridTemplateRows }">
      <button v-for="(_, index) in table.rows" :key="index" type="button" :aria-label="`Zeile ${index + 1} auswählen`" @click="selectRow(index)"><span /></button>
    </div>
    <div class="table-grid" :style="gridStyle" role="grid" :aria-rowcount="table.rows.length" :aria-colcount="table.columns.length">
      <div v-for="row in gridRows" :key="row.id" class="grid-row" role="row">
        <div v-for="entry in row.cells" :key="entry.cell.id" class="cell" :class="{ selected: selectedIds.has(entry.cell.id) }" :style="{ background: themeColor(entry.cell.style.fill, s.theme), color: themeColor(entry.cell.style.color, s.theme), fontSize: `${entry.cell.style.fontSize * s.viewport.zoom}px`, fontFamily: fontFamilyCss(entry.cell.style.fontFamily), fontWeight: entry.cell.style.fontWeight, textDecoration: entry.cell.style.textDecoration, textAlign: entry.cell.style.textAlign }" role="gridcell" :aria-rowindex="entry.rowIndex + 1" :aria-colindex="entry.columnIndex + 1">
          <textarea v-if="editingId === entry.cell.id" v-model="draft" data-testid="table-cell-editor" aria-label="Tabellenzelle bearbeiten" @keydown="keydown" @blur="blur(entry.cell.id)" />
          <button v-else type="button" class="cell-button" :class="{ commenting: s.tool === 'comment' }" :aria-label="s.tool === 'comment' ? `Kommentar an Zelle ${entry.rowIndex + 1}, ${entry.columnIndex + 1} anheften` : `Zelle ${entry.rowIndex + 1}, ${entry.columnIndex + 1}`" @click="selectCell(entry.cell.id, entry.rowIndex, entry.columnIndex)" @dblclick="s.tool !== 'comment' && edit(entry.cell.id, entry.cell.text, entry.rowIndex, entry.columnIndex)" @keydown.enter.prevent="s.tool === 'comment' ? selectCell(entry.cell.id, entry.rowIndex, entry.columnIndex) : edit(entry.cell.id, entry.cell.text, entry.rowIndex, entry.columnIndex)">{{ entry.cell.style.listStyle === 'bullet' && entry.cell.text ? `• ${entry.cell.text}` : entry.cell.text }}</button>
        </div>
      </div>
    </div>
    <button type="button" class="add-column" aria-label="Spalte rechts hinzufügen" @click="selectColumn(table.columns.length - 1); store.changeTableStructure('column-after')"><AppIcon name="plus" /></button>
    <button type="button" class="add-row" aria-label="Zeile unten hinzufügen" @click="selectRow(table.rows.length - 1); store.changeTableStructure('row-after')"><AppIcon name="plus" /></button>
  </div>
</template>

<style scoped>
.table-overlay{position:absolute;z-index:7;transform-origin:center;pointer-events:none}.move-handle{position:absolute;z-index:7;top:-54px;left:50%;width:46px;height:36px;transform:translateX(-50%);border:0;border-radius:10px;background:color-mix(in srgb,var(--accent) 16%,var(--surface-panel));color:var(--accent);font-size:24px;line-height:1;touch-action:none;pointer-events:auto;cursor:move}.resize-handle{position:absolute;z-index:5;width:14px;height:14px;padding:0;border:2px solid var(--accent);border-radius:3px;background:var(--surface-panel);touch-action:none;pointer-events:auto}.resize-handle.nw{left:-7px;top:-7px;cursor:nwse-resize}.resize-handle.ne{right:-7px;top:-7px;cursor:nesw-resize}.resize-handle.se{right:-7px;bottom:-7px;cursor:nwse-resize}.resize-handle.sw{left:-7px;bottom:-7px;cursor:nesw-resize}.table-grid{position:absolute;inset:0;display:grid;pointer-events:auto}.grid-row{display:contents}.cell{position:relative;min-width:0;min-height:0;border:1px solid var(--border-default);overflow:hidden}.cell.selected{border:2px solid var(--accent);box-shadow:inset 0 0 0 1px var(--surface-panel)}.cell-button,.cell textarea{width:100%;height:100%;padding:calc(10px * var(--table-zoom));box-sizing:border-box;background:transparent;border:0;color:inherit;font:inherit;text-align:inherit;white-space:pre-wrap;overflow:hidden;resize:none}.cell-button{display:block;cursor:text}.cell textarea{outline:2px solid var(--accent);outline-offset:-2px}.column-handles,.row-handles{position:absolute;display:grid;pointer-events:auto}.column-handles{left:0;right:0;top:-18px;height:18px}.row-handles{top:0;bottom:0;left:-18px;width:18px}.column-handles button,.row-handles button{display:grid;place-items:center;padding:0;background:transparent;border:0;cursor:pointer}.column-handles span,.row-handles span{display:block;border-radius:999px;background:var(--accent)}.column-handles span{width:24px;height:5px}.row-handles span{width:5px;height:24px}.column-insertions{position:absolute;z-index:6;inset:0;pointer-events:none}.column-insertions button{position:absolute;top:-37px;display:grid;width:24px;height:24px;padding:0;place-items:center;transform:translateX(-50%);border:1px solid var(--accent);border-radius:50%;background:var(--surface-panel);color:var(--accent);opacity:.78;pointer-events:auto;cursor:pointer}.column-insertions button:hover,.column-insertions button:focus-visible{opacity:1;background:var(--accent-soft)}.add-column,.add-row{position:absolute;display:grid;place-items:center;background:color-mix(in srgb,var(--accent) 25%,var(--surface-panel));border:0;border-radius:10px;color:var(--accent);pointer-events:auto;cursor:pointer}.add-column{left:calc(100% + 10px);top:0;width:44px;height:100%}.add-row{left:0;top:calc(100% + 10px);width:100%;height:44px}
.cell-button.commenting{cursor:crosshair;background:color-mix(in srgb,var(--accent) 8%,transparent)}
</style>

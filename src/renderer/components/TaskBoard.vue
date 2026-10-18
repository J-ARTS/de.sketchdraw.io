<script setup lang="ts">
import { intlLocale, L, t } from '@/renderer/i18n';
import { computed, nextTick, onBeforeUnmount, ref, watch } from 'vue';
import type { SketchTask, TaskStatus, TaskType } from '@/domain';
import { useWhiteboard } from './use-whiteboard';
import { wrapTabFocus } from '@/renderer/lib/focus';
import AppIcon from './AppIcon.vue';
import AppSelect from './AppSelect.vue';
import AppDatePicker from './AppDatePicker.vue';
import TaskCard from './TaskCard.vue';

const store = useWhiteboard(); const s = store.state;
const query = ref(''); const selectedId = ref<string | null>(null);
const creating = ref(false); const title = ref(''); const description = ref(''); const titleError = ref(false);
const type = ref<TaskType | ''>(''); const assignee = ref(''); const dueDate = ref('');
const columns: ReadonlyArray<{ status: TaskStatus; label: string }> = [
  { status: 'todo', label: L('Offen') }, { status: 'doing', label: L('In Arbeit') },
  { status: 'review', label: L('Prüfung') }, { status: 'done', label: L('Erledigt') },
];
const statusOptions = computed(() => columns.map((column) => ({ value: column.status, label: t(column.label) })));
const TYPE_OPTIONS: ReadonlyArray<{ value: TaskType | ''; label: string }> = [
  { value: '', label: L('Kein Typ') }, { value: 'feature', label: L('Funktion') }, { value: 'bug', label: L('Fehler') }, { value: 'design', label: L('Design') },
  { value: 'research', label: L('Recherche') }, { value: 'docs', label: L('Dokumentation') }, { value: 'ops', label: L('Betrieb') },
];
const typeOptions = computed(() => TYPE_OPTIONS.map((option) => ({ ...option, label: t(option.label) })));
const tasks = computed(() => (s.document.tasks ?? []).filter((task) => `${task.title} ${task.description} ${task.assignee ?? ''}`.toLocaleLowerCase('de').includes(query.value.trim().toLocaleLowerCase('de'))));
const selected = computed(() => (s.document.tasks ?? []).find((task) => task.id === selectedId.value) ?? null);
const dialogOpen = computed(() => creating.value || selected.value !== null);
const knownAssignees = computed(() => [...new Set((s.document.tasks ?? []).map((task) => task.assignee).filter((name): name is string => Boolean(name)))].sort((a, b) => a.localeCompare(b, intlLocale())));
function tasksFor(status: TaskStatus): SketchTask[] { return tasks.value.filter((task) => task.status === status).sort((a, b) => a.rank - b.rank || a.createdAt.localeCompare(b.createdAt)); }
function columnLabel(status: TaskStatus): string { return t(columns.find((entry) => entry.status === status)?.label ?? status); }
function open(task: SketchTask): void {
  creating.value = false; selectedId.value = task.id; title.value = task.title; description.value = task.description; titleError.value = false;
  type.value = task.type ?? ''; assignee.value = task.assignee ?? ''; dueDate.value = task.dueDate ?? '';
}
function startCreate(): void { selectedId.value = null; creating.value = true; title.value = ''; description.value = ''; titleError.value = false; type.value = ''; assignee.value = ''; dueDate.value = ''; }
function closeDialog(): void { creating.value = false; selectedId.value = null; titleError.value = false; }
async function save(): Promise<void> {
  const normalizedTitle = title.value.trim();
  if (!normalizedTitle) { titleError.value = true; titleInput.value?.focus(); return; }
  if (creating.value) {
    const input = { title: normalizedTitle, description: description.value, ...(type.value ? { type: type.value } : {}), ...(assignee.value.trim() ? { assignee: assignee.value } : {}), ...(dueDate.value ? { dueDate: dueDate.value } : {}) };
    if (await store.createTask(input)) closeDialog();
    return;
  }
  if (selected.value && await store.updateTask(selected.value.id, { title: normalizedTitle, description: description.value, type: type.value || null, assignee: assignee.value.trim() || null, dueDate: dueDate.value || null })) closeDialog();
}
async function removeSelected(): Promise<void> { if (selected.value && await store.deleteTask(selected.value.id)) closeDialog(); }
function sourceLabel(task: SketchTask): string | null {
  if (task.sourceThreadId) return t('Kommentar öffnen');
  if (task.sourceElementId) return t('Notiz öffnen');
  if (task.external) return t('In Jira öffnen');
  return null;
}
function openSource(task: SketchTask): void {
  closeDialog();
  if (task.sourceThreadId) store.openComment(task.sourceThreadId);
  else if (task.sourceElementId) { store.showCanvas(); store.focusElement(task.sourceElementId); }
  else if (task.external) void store.openDocumentationLink(task.external.url);
}
watch(selected, (task) => { if (!task) selectedId.value = null; });

// --- Card menu (#105): edit, open source, move (keyboard alternative to dragging), delete -------------------------
type MenuAction = { id: string; label: string; danger?: boolean; run: () => void };
const menu = ref<{ taskId: string; right: number; top: number } | null>(null);
const menuEl = ref<HTMLElement | null>(null);
const menuTask = computed(() => (s.document.tasks ?? []).find((task) => task.id === menu.value?.taskId) ?? null);
const menuActions = computed<MenuAction[]>(() => {
  const task = menuTask.value;
  if (!task) return [];
  const actions: MenuAction[] = [{ id: 'edit', label: L('Bearbeiten'), run: () => open(task) }];
  const source = sourceLabel(task);
  if (source) actions.push({ id: 'source', label: source, run: () => openSource(task) });
  for (const column of columns) {
    if (column.status !== task.status) actions.push({ id: `move-${column.status}`, label: t('Nach „{label}“ verschieben', { label: t(column.label) }), run: () => { void store.moveTask(task.id, column.status, tasksFor(column.status).length); } });
  }
  actions.push({ id: 'delete', label: L('Löschen'), danger: true, run: () => { void store.deleteTask(task.id); } });
  return actions;
});
async function openMenu(task: SketchTask, event: MouseEvent): Promise<void> {
  if (menu.value?.taskId === task.id) { closeMenu(true); return; }
  const rect = (event.currentTarget as HTMLElement).getBoundingClientRect();
  menu.value = { taskId: task.id, right: Math.max(8, window.innerWidth - rect.right), top: rect.bottom + 6 };
  await nextTick();
  const box = menuEl.value?.getBoundingClientRect();
  if (box && menu.value && box.bottom > window.innerHeight - 8) menu.value.top = Math.max(8, rect.top - 6 - box.height);
  menuEl.value?.querySelector<HTMLElement>('[role="menuitem"]')?.focus();
}
function closeMenu(returnFocus: boolean): void {
  const id = menu.value?.taskId;
  menu.value = null;
  if (returnFocus && id) void nextTick(() => board.value?.querySelector<HTMLElement>(`[data-task-card="${CSS.escape(id)}"] .card-menu-btn`)?.focus());
}
function runMenu(action: MenuAction): void {
  const keepFocus = action.id === 'edit' || action.id === 'source';
  closeMenu(!keepFocus && action.id !== 'delete');
  action.run();
  if (action.id === 'delete') void nextTick(() => searchInput.value?.focus());
}
function onMenuKeydown(event: KeyboardEvent): void {
  const items = Array.from(menuEl.value?.querySelectorAll<HTMLElement>('[role="menuitem"]') ?? []);
  const current = items.findIndex((item) => item === document.activeElement);
  const next = { ArrowDown: (current + 1) % items.length, ArrowUp: (current - 1 + items.length) % items.length, Home: 0, End: items.length - 1 }[event.key];
  if (event.key === 'Escape' || event.key === 'Tab') { event.preventDefault(); event.stopPropagation(); closeMenu(true); return; }
  if (next === undefined) return;
  event.preventDefault();
  items[next]?.focus();
}
function onDocumentPointerDown(event: PointerEvent): void {
  if (menu.value && event.target instanceof Node && !menuEl.value?.contains(event.target) && !(event.target instanceof Element && event.target.closest('.card-menu-btn'))) closeMenu(false);
}
document.addEventListener('pointerdown', onDocumentPointerDown, true);

// --- Pointer drag & drop (#106): dashed placeholder at the origin, tilted card under the pointer ------------------
interface DragState { task: SketchTask; from: TaskStatus; fromIndex: number; width: number; height: number; offsetX: number; offsetY: number; x: number; y: number; over: TaskStatus | null; overIndex: number }
const drag = ref<DragState | null>(null);
let pending: { task: SketchTask; from: TaskStatus; fromIndex: number; startX: number; startY: number; el: HTMLElement } | null = null;
let suppressClick = false;

function onCardPointerDown(event: PointerEvent, task: SketchTask, status: TaskStatus, index: number): void {
  if (event.button !== 0 || !s.canWrite || (event.target instanceof Element && event.target.closest('.card-menu-btn'))) return;
  pending = { task, from: status, fromIndex: index, startX: event.clientX, startY: event.clientY, el: event.currentTarget as HTMLElement };
  window.addEventListener('pointermove', onPointerMove);
  window.addEventListener('pointerup', onPointerUp);
  window.addEventListener('pointercancel', cancelDrag);
  window.addEventListener('keydown', onDragKeydown, true);
}
function onPointerMove(event: PointerEvent): void {
  if (!drag.value && pending) {
    if (Math.hypot(event.clientX - pending.startX, event.clientY - pending.startY) < 5) return;
    const rect = pending.el.getBoundingClientRect();
    drag.value = { task: pending.task, from: pending.from, fromIndex: pending.fromIndex, width: rect.width, height: rect.height, offsetX: pending.startX - rect.left, offsetY: pending.startY - rect.top, x: event.clientX, y: event.clientY, over: pending.from, overIndex: pending.fromIndex };
    closeMenu(false);
    document.body.classList.add('task-dragging');
  }
  const current = drag.value;
  if (!current) return;
  event.preventDefault();
  current.x = event.clientX; current.y = event.clientY;
  const column = document.elementsFromPoint(event.clientX, event.clientY).map((element) => element.closest<HTMLElement>('.task-column')).find(Boolean);
  if (!column) { current.over = null; return; }
  const others = Array.from(column.querySelectorAll<HTMLElement>('li[data-task-item]:not(.drag-source)'));
  const index = others.findIndex((item) => { const box = item.getBoundingClientRect(); return event.clientY < box.top + box.height / 2; });
  current.over = column.dataset.status as TaskStatus;
  current.overIndex = index < 0 ? others.length : index;
}
function stopListening(): void {
  pending = null;
  window.removeEventListener('pointermove', onPointerMove);
  window.removeEventListener('pointerup', onPointerUp);
  window.removeEventListener('pointercancel', cancelDrag);
  window.removeEventListener('keydown', onDragKeydown, true);
  document.body.classList.remove('task-dragging');
}
function onPointerUp(): void {
  const current = drag.value;
  stopListening();
  drag.value = null;
  if (!current) return; // a plain click
  suppressClick = true;
  setTimeout(() => { suppressClick = false; }, 0);
  if (current.over && !isNoop(current)) void store.moveTask(current.task.id, current.over, current.overIndex);
}
function cancelDrag(): void { stopListening(); drag.value = null; }
function onDragKeydown(event: KeyboardEvent): void {
  if (event.key !== 'Escape' || !drag.value) return;
  event.preventDefault(); event.stopPropagation();
  cancelDrag();
}
function isNoop(state: DragState): boolean { return state.over === state.from && state.overIndex === state.fromIndex; }
/** Index among the column's cards without the dragged one, where the insertion line belongs. */
function indicatorAt(status: TaskStatus): number | null {
  const current = drag.value;
  return current && current.over === status && !isNoop(current) ? current.overIndex : null;
}
function othersBefore(status: TaskStatus, task: SketchTask): number { return tasksFor(status).filter((entry) => entry.id !== drag.value?.task.id).findIndex((entry) => entry.id === task.id); }
function openFromCard(task: SketchTask): void { if (!suppressClick) open(task); }

// #80/#81: a native modal dialog takes focus, keeps it inside, closes on Escape and sits above all chrome.
const board = ref<HTMLElement | null>(null);
const searchInput = ref<HTMLInputElement | null>(null);
const newTaskButton = ref<HTMLButtonElement | null>(null);
const taskDialog = ref<HTMLDialogElement | null>(null);
const titleInput = ref<HTMLInputElement | null>(null);
let returnTaskId: string | null = null;
let returnToCreate = false;
watch(dialogOpen, async (open) => {
  await nextTick();
  if (open) {
    returnTaskId = selectedId.value;
    returnToCreate = creating.value;
    if (!taskDialog.value?.open) taskDialog.value?.showModal();
    titleInput.value?.focus();
    return;
  }
  taskDialog.value?.close();
  // Return focus to the task's card (it may have moved column), or to the search when the task is gone.
  const card = returnTaskId ? board.value?.querySelector<HTMLElement>(`.card-open[data-task-id="${CSS.escape(returnTaskId)}"]`) : null;
  (card ?? (returnToCreate ? newTaskButton.value : null) ?? searchInput.value)?.focus();
  returnTaskId = null;
  returnToCreate = false;
});
watch(title, (value) => { if (value.trim()) titleError.value = false; });
onBeforeUnmount(() => { taskDialog.value?.close(); stopListening(); document.removeEventListener('pointerdown', onDocumentPointerDown, true); });
</script>

<template>
  <section ref="board" class="task-board" data-testid="task-board" aria-labelledby="task-board-title">
    <header class="board-head"><div><span class="eyebrow">SKETCHDRAW WORKSPACE</span><h1 id="task-board-title">{{ t('Aufgaben') }}</h1></div><div class="head-actions"><label class="board-search"><AppIcon name="search" :size="18" /><input ref="searchInput" v-model="query" type="search" :placeholder="t('Aufgaben suchen')" :aria-label="t('Aufgaben suchen')" /></label><button v-if="s.pluginSettings?.atlassian.enabled" type="button" class="sd-btn" :disabled="s.pluginBusy" @click="store.syncJiraTasks()">{{ t('Jira synchronisieren') }}</button><button type="button" class="sd-icon-btn board-close" :aria-label="t('Aufgabenboard schließen')" :title="t('Aufgabenboard schließen')" @click="store.showCanvas()"><AppIcon name="close" /></button></div></header>
    <div class="columns" :aria-label="t('Kanban-Board')">
      <section v-for="column in columns" :key="column.status" class="task-column" :class="{ 'drop-target': drag?.over === column.status }" :data-status="column.status" :aria-label="t(column.label)">
        <header><h2><span class="status-dot" aria-hidden="true" />{{ t(column.label) }}</h2><span>{{ tasksFor(column.status).length }}</span></header>
        <ol>
          <template v-for="(task, index) in tasksFor(column.status)" :key="task.id">
            <li v-if="indicatorAt(column.status) !== null && indicatorAt(column.status) === othersBefore(column.status, task)" class="drop-indicator" aria-hidden="true" />
            <li class="task-item" :class="{ 'drag-source': drag?.task.id === task.id }" :data-task-item="task.id" :data-task-card="task.id">
              <TaskCard
                :task="task"
                :menu-open="menu?.taskId === task.id"
                :aria-label="t('{title}, Status {label}', { title: task.title, label: t(column.label) })"
                @open="openFromCard(task)"
                @menu="openMenu(task, $event)"
                @pointerdown="onCardPointerDown($event, task, column.status, index)"
              />
            </li>
          </template>
          <li v-if="indicatorAt(column.status) !== null && indicatorAt(column.status)! >= tasksFor(column.status).filter((entry) => entry.id !== drag?.task.id).length" class="drop-indicator" aria-hidden="true" />
        </ol>
        <p v-if="!tasksFor(column.status).length && drag?.over !== column.status" class="column-empty">{{ t('Keine Aufgaben') }}</p>
      </section>
    </div>
    <button ref="newTaskButton" type="button" class="new-task-fab" :aria-label="t('Neue Aufgabe')" :title="t('Neue Aufgabe')" @click="startCreate"><AppIcon name="plus" :size="24" /></button>

    <div v-if="drag" class="drag-ghost" :style="{ width: `${drag.width}px`, left: `${drag.x - drag.offsetX}px`, top: `${drag.y - drag.offsetY}px`, transformOrigin: `${drag.offsetX}px ${drag.offsetY}px` }" aria-hidden="true">
      <TaskCard :task="drag.task" ghost />
    </div>
    <span class="visually-hidden" role="status" aria-live="polite">{{ drag ? (drag.over ? t('{title} wird verschoben nach {column}', { title: drag.task.title, column: columnLabel(drag.over) }) : t('{title} wird verschoben', { title: drag.task.title })) : '' }}</span>

    <div v-if="menu && menuTask" ref="menuEl" class="card-menu" role="menu" :aria-label="t('Aktionen für {title}', { title: menuTask.title })" :style="{ right: `${menu.right}px`, top: `${menu.top}px` }" @keydown="onMenuKeydown">
      <template v-for="action in menuActions" :key="action.id">
        <span v-if="action.id === 'delete'" class="menu-sep" role="separator" />
        <button type="button" role="menuitem" tabindex="-1" class="card-menu-item" :class="{ danger: action.danger }" :data-testid="`task-menu-${action.id}`" @click="runMenu(action)">{{ t(action.label) }}</button>
      </template>
    </div>

    <dialog ref="taskDialog" class="task-dialog" aria-labelledby="task-dialog-title" @cancel.prevent="closeDialog" @pointerdown.self="closeDialog" @keydown.stop="taskDialog && wrapTabFocus($event, taskDialog)">
      <form v-if="dialogOpen" class="task-form sd-panel" @submit.prevent="save"><header><div><h2 id="task-dialog-title" class="sd-panel-title">{{ creating ? t('Neue Aufgabe') : t('Aufgabe bearbeiten') }}</h2><span v-if="selected?.external" class="external-badge">{{ selected.external.key }} · {{ selected.external.remoteStatus }}</span></div><button type="button" class="sd-icon-btn sd-panel-close" :aria-label="t('Schließen')" @click="closeDialog"><AppIcon name="close" /></button></header><div class="task-fields"><label>{{ t('Titel') }}<input ref="titleInput" v-model="title" maxlength="50000" required :aria-invalid="titleError || undefined" aria-describedby="task-title-error" /></label><span v-if="titleError" id="task-title-error" class="form-error">{{ t('Bitte gib einen Titel ein.') }}</span><label>{{ t('Beschreibung') }}<textarea v-model="description" maxlength="50000" /></label>
        <div class="field-row"><AppSelect :label="t('Typ')" :model-value="type" :options="typeOptions" @update:model-value="type = $event as TaskType | ''" /><AppDatePicker v-model="dueDate" :label="t('Fällig am')" /></div>
        <label>{{ t('Zugewiesen an') }}<input v-model="assignee" list="task-assignees" maxlength="120" autocomplete="off" :placeholder="t('Name')" /></label><datalist id="task-assignees"><option v-for="name in knownAssignees" :key="name" :value="name" /></datalist>
        <AppSelect v-if="selected" :label="t('Status')" :model-value="selected.status" :options="statusOptions" @update:model-value="store.updateTask(selected.id, { status: $event as TaskStatus })" /></div><div class="dialog-actions"><button v-if="selected" type="button" class="sd-btn danger" @click="removeSelected">{{ t('Löschen') }}</button><button v-if="selected && sourceLabel(selected)" type="button" class="sd-btn" @click="openSource(selected)">{{ sourceLabel(selected) }}</button><button type="button" class="sd-btn" @click="closeDialog">{{ t('Abbrechen') }}</button><button class="sd-btn sd-btn--primary" type="submit">{{ creating ? t('Aufgabe erstellen') : t('Speichern') }}</button></div></form>
    </dialog>
  </section>
</template>

<style scoped>
.task-board{position:absolute;inset:0;z-index:4;overflow:auto;padding:88px var(--chrome-inset) 104px;background:radial-gradient(circle at 50% 0,color-mix(in srgb,var(--accent) 8%,var(--surface-canvas)),var(--surface-canvas) 50%)}.board-head{display:flex;align-items:end;justify-content:space-between;gap:20px;margin:0 0 22px}.eyebrow{font-size:10px;letter-spacing:.14em;color:var(--accent);font-weight:700}.board-head h1{margin:5px 0 0;font-size:32px}.head-actions{display:flex;align-items:center;gap:10px}.board-close{flex:none;width:42px;height:42px;border:1px solid var(--border-subtle);border-radius:12px;background:var(--surface-panel);color:var(--text-primary)}.board-close:hover{border-color:var(--accent);background:var(--accent-soft);color:var(--accent)}.board-search{display:flex;align-items:center;gap:8px;width:260px;height:42px;padding:0 12px;border:1px solid var(--border-subtle);border-radius:12px;background:var(--surface-panel)}.board-search:focus-within{outline:2px solid var(--focus-ring);outline-offset:2px}.board-search input{width:100%;border:0;background:transparent;color:var(--text-primary);outline:0}.columns{display:grid;grid-template-columns:repeat(4,minmax(230px,1fr));gap:14px;margin:0}.task-column{min-height:520px;padding:10px;border:1px solid var(--border-subtle);border-radius:18px;background:color-mix(in srgb,var(--surface-panel) 80%,transparent);transition:background-color .15s ease,border-color .15s ease}.task-column.drop-target{border-color:color-mix(in srgb,var(--accent) 45%,var(--border-subtle));background:color-mix(in srgb,var(--accent-soft) 55%,var(--surface-panel))}.task-column>header{display:flex;align-items:center;justify-content:space-between;padding:4px 4px 12px}.task-column h2{display:flex;align-items:center;gap:8px;font-size:14px}.status-dot{width:10px;height:10px;border-radius:50%;background:#ff5ca8}.task-column[data-status='doing'] .status-dot{background:#f5a752}.task-column[data-status='review'] .status-dot{background:#49a7ff}.task-column[data-status='done'] .status-dot{background:#42c978}.task-column ol{display:grid;gap:12px}.column-empty{margin:40px 0;text-align:center;color:var(--text-muted)}
/* #106: the origin keeps a dashed block of the card's size; the card itself follows the pointer, tilted. */
.task-item.drag-source{border:2px dashed color-mix(in srgb,var(--accent) 45%,var(--border-default));border-radius:18px;background:color-mix(in srgb,var(--accent-soft) 35%,transparent)}.task-item.drag-source>*{visibility:hidden}.drop-indicator{height:4px;margin:-8px 6px;border-radius:999px;background:var(--accent)}.drag-ghost{position:fixed;z-index:60;pointer-events:none;transform:rotate(4deg) scale(1.02);border-radius:18px}
:global(body.task-dragging),:global(body.task-dragging *){cursor:grabbing!important;user-select:none!important}
.card-menu{position:fixed;z-index:70;display:grid;min-width:220px;padding:6px;border:1px solid var(--border-subtle);border-radius:14px;background:var(--surface-panel);box-shadow:var(--shadow-panel)}.card-menu-item{min-height:36px;padding:0 12px;border:0;border-radius:9px;background:transparent;color:var(--text-primary);font-size:13px;text-align:left;cursor:pointer}.card-menu-item:hover,.card-menu-item:focus-visible{background:var(--surface-raised);outline:none}.card-menu-item:focus-visible{box-shadow:inset 0 0 0 2px var(--focus-ring)}.card-menu-item.danger{color:var(--status-error)}.menu-sep{height:1px;margin:5px 6px;background:var(--border-subtle)}
.new-task-fab{position:fixed;z-index:6;right:max(28px,env(safe-area-inset-right));bottom:max(28px,env(safe-area-inset-bottom));display:grid;width:56px;height:56px;padding:0;place-items:center;border:0;border-radius:50%;background:var(--accent);color:var(--accent-contrast);box-shadow:var(--shadow-panel),0 12px 28px color-mix(in srgb,var(--accent) 30%,transparent);cursor:pointer}.new-task-fab:hover{transform:translateY(-1px);filter:brightness(1.05)}.new-task-fab:active{transform:translateY(0)}.new-task-fab:focus-visible{outline:3px solid var(--focus-ring);outline-offset:3px}.task-dialog{width:min(520px,calc(100vw - 32px));max-width:none;max-height:calc(100dvh - 32px);padding:0;border:0;background:transparent;color:var(--text-primary);overflow:visible}.task-dialog::backdrop{background:var(--scrim)}.task-form{display:flex;flex-direction:column;max-height:calc(100dvh - 32px);overflow:hidden}.task-form header{display:flex;flex:none;align-items:center;justify-content:space-between;gap:12px;padding:16px 16px 4px}.task-fields{min-height:0;overflow-y:auto;padding:0 16px 4px}.task-form label{display:grid;gap:6px;margin-top:12px;font-size:12px;color:var(--text-muted)}.field-row{display:grid;grid-template-columns:1fr 1fr;gap:12px}.task-form input,.task-form textarea,.task-form select{min-height:42px;padding:9px 10px;border:1px solid var(--border-subtle);border-radius:9px;background:var(--surface-raised);color:var(--text-primary)}.task-form input[aria-invalid='true']{border-color:var(--status-error)}.task-form textarea{min-height:120px;resize:vertical}.form-error{display:block;margin-top:5px;color:var(--status-error);font-size:11px}.dialog-actions{display:flex;flex:none;flex-wrap:wrap;justify-content:flex-end;gap:8px;padding:14px 16px 16px;border-top:1px solid var(--border-subtle)}.sd-btn.danger{margin-right:auto;color:var(--status-error)}@media(max-width:1100px){.columns{grid-template-columns:repeat(2,minmax(240px,1fr))}}@media(max-width:720px){.task-board{padding:82px var(--chrome-inset) 92px}.board-head{align-items:stretch;flex-direction:column}.head-actions{align-items:center;flex-direction:row;flex-wrap:wrap}.board-search{width:auto;flex:1 1 210px}.new-task-fab{right:max(16px,env(safe-area-inset-right));bottom:max(18px,env(safe-area-inset-bottom));width:52px;height:52px}.columns{grid-template-columns:1fr}.task-column{min-height:280px}.field-row{grid-template-columns:1fr}}
.external-badge{display:inline-flex;margin-bottom:7px;padding:3px 7px;border-radius:999px;background:color-mix(in srgb,#1868db 12%,var(--surface-raised));color:color-mix(in srgb,#1868db 70%,var(--text-primary));font-size:10px;font-weight:750}
</style>

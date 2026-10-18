<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, ref, watch } from 'vue';
import type { SketchTask, TaskStatus } from '@/domain';
import { useWhiteboard } from './use-whiteboard';
import { wrapTabFocus } from '@/renderer/lib/focus';
import AppIcon from './AppIcon.vue';

const store = useWhiteboard(); const s = store.state;
const query = ref(''); const selectedId = ref<string | null>(null); const dragId = ref<string | null>(null);
const creating = ref(false); const title = ref(''); const description = ref(''); const titleError = ref(false);
const columns: ReadonlyArray<{ status: TaskStatus; label: string }> = [
  { status: 'todo', label: 'Offen' }, { status: 'doing', label: 'In Arbeit' },
  { status: 'review', label: 'Prüfung' }, { status: 'done', label: 'Erledigt' },
];
const tasks = computed(() => (s.document.tasks ?? []).filter((task) => `${task.title} ${task.description}`.toLocaleLowerCase('de').includes(query.value.trim().toLocaleLowerCase('de'))));
const selected = computed(() => (s.document.tasks ?? []).find((task) => task.id === selectedId.value) ?? null);
const dialogOpen = computed(() => creating.value || selected.value !== null);
function tasksFor(status: TaskStatus): SketchTask[] { return tasks.value.filter((task) => task.status === status).sort((a, b) => a.rank - b.rank || a.createdAt.localeCompare(b.createdAt)); }
function open(task: SketchTask): void { creating.value = false; selectedId.value = task.id; title.value = task.title; description.value = task.description; titleError.value = false; }
function startCreate(): void { selectedId.value = null; creating.value = true; title.value = ''; description.value = ''; titleError.value = false; }
function closeDialog(): void { creating.value = false; selectedId.value = null; titleError.value = false; }
async function save(): Promise<void> {
  const normalizedTitle = title.value.trim();
  if (!normalizedTitle) { titleError.value = true; titleInput.value?.focus(); return; }
  if (creating.value) {
    if (await store.createTask({ title: normalizedTitle, description: description.value })) closeDialog();
    return;
  }
  if (selected.value && await store.updateTask(selected.value.id, { title: normalizedTitle, description: description.value })) closeDialog();
}
async function removeSelected(): Promise<void> { if (selected.value && await store.deleteTask(selected.value.id)) closeDialog(); }
function move(task: SketchTask, delta: number): void { const index = columns.findIndex((entry) => entry.status === task.status); const next = columns[index + delta]; if (next) void store.updateTask(task.id, { status: next.status }); }
function drop(status: TaskStatus): void { const id = dragId.value; dragId.value = null; if (id) void store.updateTask(id, { status }); }
function sourceLabel(task: SketchTask): string | null {
  if (task.sourceThreadId) return 'Kommentar öffnen';
  if (task.sourceElementId) return 'Notiz öffnen';
  if (task.external) return 'In Jira öffnen';
  return null;
}
function openSource(task: SketchTask): void {
  closeDialog();
  if (task.sourceThreadId) store.openComment(task.sourceThreadId);
  else if (task.sourceElementId) { store.showCanvas(); store.focusElement(task.sourceElementId); }
  else if (task.external) void store.openDocumentationLink(task.external.url);
}
watch(selected, (task) => { if (!task) selectedId.value = null; });

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
onBeforeUnmount(() => taskDialog.value?.close());
</script>

<template>
  <section ref="board" class="task-board" data-testid="task-board" aria-labelledby="task-board-title">
    <header class="board-head"><div><span class="eyebrow">SKETCHDRAW WORKSPACE</span><h1 id="task-board-title">Aufgaben</h1></div><div class="head-actions"><label class="board-search"><AppIcon name="search" :size="18" /><input ref="searchInput" v-model="query" type="search" placeholder="Aufgaben suchen" aria-label="Aufgaben suchen" /></label><button ref="newTaskButton" class="sd-btn sd-btn--primary" @click="startCreate"><AppIcon name="plus" :size="16" />Neue Aufgabe</button><button v-if="s.pluginSettings?.atlassian.enabled" class="sd-btn" :disabled="s.pluginBusy" @click="store.syncJiraTasks()">Jira synchronisieren</button><button class="sd-btn" @click="store.showCanvas()">Zur Zeichenfläche</button></div></header>
    <div class="columns" aria-label="Kanban-Board">
      <section v-for="column in columns" :key="column.status" class="task-column" :data-status="column.status" @dragover.prevent @drop="drop(column.status)">
        <header><h2><span class="status-dot" aria-hidden="true" />{{ column.label }}</h2><span>{{ tasksFor(column.status).length }}</span></header>
        <ol><li v-for="task in tasksFor(column.status)" :key="task.id"><article class="task-card" draggable="true" :aria-label="`${task.title}, Status ${column.label}`" @dragstart="dragId = task.id" @dragend="dragId = null"><button class="card-open" :data-task-id="task.id" @click="open(task)"><span v-if="task.external" class="external-badge">{{ task.external.key }} · {{ task.external.remoteStatus }}</span><strong>{{ task.title }}</strong><p>{{ task.description }}</p></button><div class="card-foot"><button :disabled="column.status === 'todo'" :aria-label="`${task.title} zurück verschieben`" @click="move(task,-1)">←</button><button v-if="sourceLabel(task)" @click="openSource(task)">{{ sourceLabel(task) }}</button><span v-else aria-hidden="true" /><button :disabled="column.status === 'done'" :aria-label="`${task.title} weiter verschieben`" @click="move(task,1)">→</button></div></article></li></ol>
        <p v-if="!tasksFor(column.status).length" class="column-empty">Keine Aufgaben</p>
      </section>
    </div>
    <dialog ref="taskDialog" class="task-dialog" aria-labelledby="task-dialog-title" @cancel.prevent="closeDialog" @pointerdown.self="closeDialog" @keydown.stop="taskDialog && wrapTabFocus($event, taskDialog)">
      <form v-if="dialogOpen" class="task-form sd-panel" @submit.prevent="save"><header><div><h2 id="task-dialog-title">{{ creating ? 'Neue Aufgabe' : 'Aufgabe bearbeiten' }}</h2><span v-if="selected?.external" class="external-badge">{{ selected.external.key }} · {{ selected.external.remoteStatus }}</span></div><button type="button" class="sd-icon-btn" aria-label="Schließen" @click="closeDialog"><AppIcon name="close" /></button></header><div class="task-fields"><label>Titel<input ref="titleInput" v-model="title" maxlength="50000" required :aria-invalid="titleError || undefined" aria-describedby="task-title-error" /></label><span v-if="titleError" id="task-title-error" class="form-error">Bitte gib einen Titel ein.</span><label>Beschreibung<textarea v-model="description" maxlength="50000" /></label><label v-if="selected">Status<select :value="selected.status" @change="store.updateTask(selected.id, { status: ($event.target as HTMLSelectElement).value as TaskStatus })"><option v-for="column in columns" :key="column.status" :value="column.status">{{ column.label }}</option></select></label></div><div class="dialog-actions"><button v-if="selected" type="button" class="sd-btn danger" @click="removeSelected">Löschen</button><button v-if="selected && sourceLabel(selected)" type="button" class="sd-btn" @click="openSource(selected)">{{ sourceLabel(selected) }}</button><button type="button" class="sd-btn" @click="closeDialog">Abbrechen</button><button class="sd-btn sd-btn--primary" type="submit">{{ creating ? 'Aufgabe erstellen' : 'Speichern' }}</button></div></form>
    </dialog>
  </section>
</template>

<style scoped>
.task-board{position:absolute;inset:0;z-index:4;overflow:auto;padding:88px 28px 28px;background:radial-gradient(circle at 50% 0,color-mix(in srgb,var(--accent) 8%,var(--surface-canvas)),var(--surface-canvas) 50%)}.board-head{display:flex;align-items:end;justify-content:space-between;gap:20px;max-width:1500px;margin:0 auto 22px}.eyebrow{font-size:10px;letter-spacing:.14em;color:var(--accent);font-weight:700}.board-head h1{margin:5px 0 0;font-size:32px}.head-actions{display:flex;align-items:center;gap:10px}.head-actions>.sd-btn--primary{display:inline-flex;align-items:center;gap:6px}.board-search{display:flex;align-items:center;gap:8px;width:260px;height:42px;padding:0 12px;border:1px solid var(--border-subtle);border-radius:12px;background:var(--surface-panel)}.board-search:focus-within{outline:2px solid var(--focus-ring);outline-offset:2px}.board-search input{width:100%;border:0;background:transparent;color:var(--text-primary);outline:0}.columns{display:grid;grid-template-columns:repeat(4,minmax(230px,1fr));gap:14px;max-width:1500px;margin:auto}.task-column{min-height:520px;padding:10px;border:1px solid var(--border-subtle);border-radius:16px;background:color-mix(in srgb,var(--surface-panel) 80%,transparent)}.task-column>header{display:flex;align-items:center;justify-content:space-between;padding:4px 4px 12px}.task-column h2{display:flex;align-items:center;gap:8px;font-size:14px}.status-dot{width:10px;height:10px;border-radius:50%;background:#ff5ca8}.task-column[data-status='doing'] .status-dot{background:#f5a752}.task-column[data-status='review'] .status-dot{background:#49a7ff}.task-column[data-status='done'] .status-dot{background:#42c978}.task-column ol{display:grid;gap:10px}.task-card{overflow:hidden;border:1px solid var(--border-subtle);border-radius:14px;background:var(--surface-panel);box-shadow:var(--shadow-panel)}.task-card:focus-within{outline:2px solid var(--accent)}.card-open{display:block;width:100%;padding:14px;border:0;background:transparent;color:var(--text-primary);text-align:left}.card-open strong{display:block;margin-bottom:7px}.card-open p{display:-webkit-box;margin:0;overflow:hidden;color:var(--text-muted);line-height:1.45;-webkit-line-clamp:3;-webkit-box-orient:vertical}.card-foot{display:flex;align-items:center;justify-content:space-between;padding:8px;border-top:1px solid var(--border-subtle)}.card-foot button{min-height:30px;padding:0 8px;border:0;border-radius:7px;background:transparent;color:var(--accent)}.card-foot button:hover{background:var(--accent-soft)}.column-empty{margin:40px 0;text-align:center;color:var(--text-muted)}.task-dialog{width:min(520px,calc(100vw - 32px));max-width:none;max-height:calc(100dvh - 32px);padding:0;border:0;background:transparent;color:var(--text-primary);overflow:visible}.task-dialog::backdrop{background:var(--scrim)}.task-form{display:flex;flex-direction:column;max-height:calc(100dvh - 32px);overflow:hidden}.task-form header{display:flex;flex:none;align-items:center;justify-content:space-between;gap:12px;padding:16px 16px 4px}.task-fields{min-height:0;overflow-y:auto;padding:0 16px 4px}.task-form label{display:grid;gap:6px;margin-top:12px;font-size:12px;color:var(--text-muted)}.task-form input,.task-form textarea,.task-form select{min-height:42px;padding:9px 10px;border:1px solid var(--border-subtle);border-radius:9px;background:var(--surface-raised);color:var(--text-primary)}.task-form input[aria-invalid='true']{border-color:var(--status-error)}.task-form textarea{min-height:120px;resize:vertical}.form-error{display:block;margin-top:5px;color:var(--status-error);font-size:11px}.dialog-actions{display:flex;flex:none;flex-wrap:wrap;justify-content:flex-end;gap:8px;padding:14px 16px 16px;border-top:1px solid var(--border-subtle)}.sd-btn.danger{margin-right:auto;color:var(--status-error)}@media(max-width:1100px){.columns{grid-template-columns:repeat(2,minmax(240px,1fr))}}@media(max-width:720px){.task-board{padding:82px 12px 20px}.board-head{align-items:stretch;flex-direction:column}.head-actions{align-items:stretch;flex-direction:column}.board-search{width:auto}.columns{grid-template-columns:1fr}.task-column{min-height:280px}}
.external-badge{display:inline-flex;margin-bottom:7px;padding:3px 7px;border-radius:999px;background:color-mix(in srgb,#1868db 12%,var(--surface-raised));color:color-mix(in srgb,#1868db 70%,var(--text-primary));font-size:10px;font-weight:750}
</style>

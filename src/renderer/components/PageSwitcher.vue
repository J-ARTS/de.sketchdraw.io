<script setup lang="ts">
import { computed, nextTick, ref, useId } from 'vue';
import { useEventListener } from '@vueuse/core';
import AppIcon from './AppIcon.vue';
import { useWhiteboard } from './use-whiteboard';
import { t } from '@/renderer/i18n/de';
import type { PageSummary } from '@/renderer/state/contract';

type MenuAction = 'copy' | 'rename' | 'duplicate' | 'moveUp' | 'moveDown' | 'delete';
/** `pending`: needs the multi-page schema (#34); `rule`: not possible for this page. */
interface MenuEntry { id: MenuAction; label: string; blocked: 'pending' | 'rule' | null; separatorBefore?: boolean }

const store = useWhiteboard();
const s = store.state;
const uid = useId();
const panelId = `${uid}-pages`;
const headingId = `${uid}-pages-heading`;
const MENU_WIDTH = 224;

const pages = computed(() => s.pages);
const activePage = computed(() => pages.value.find((page) => page.id === s.activePageId) ?? pages.value[0]);
const currentName = computed(() => s.workspaceView === 'tasks' ? 'Aufgaben' : activePage.value?.name ?? '');
const editable = computed(() => s.pagesEditable && s.canWrite);
/** Renaming the current page works independently of the schema-v2 structural actions. */
const canRename = computed(() => s.canWrite && !s.transitioning);

const open = ref(false);
const root = ref<HTMLElement | null>(null);
const trigger = ref<HTMLButtonElement | null>(null);
const panel = ref<HTMLElement | null>(null);

async function openPanel(): Promise<void> {
  open.value = true;
  await nextTick();
  rowButton(s.activePageId)?.focus();
}

function closePanel(returnFocus: boolean): void {
  if (!open.value) return;
  menu.value = null;
  cancelRename();
  open.value = false;
  if (returnFocus) trigger.value?.focus();
}

function togglePanel(): void {
  if (open.value) closePanel(true);
  else void openPanel();
}

function rowButton(id: string): HTMLButtonElement | null {
  return panel.value?.querySelector<HTMLButtonElement>(`[data-page-id="${CSS.escape(id)}"]`) ?? null;
}

/** The panel stays open like a page sidebar, so a second click can start a rename. */
function selectPage(id: string): void {
  store.showCanvas();
  store.selectPage(id);
}
function selectTasks(): void { store.openTaskBoard(); closePanel(true); }

// --- Rename (double click / F2) ----------------------------------------------
const editingId = ref<string | null>(null);
const nameDraft = ref('');
const renameInput = ref<HTMLInputElement[] | HTMLInputElement | null>(null);

async function startRename(page: PageSummary): Promise<void> {
  if (!canRename.value) return;
  editingId.value = page.id;
  nameDraft.value = page.name;
  await nextTick();
  const input = Array.isArray(renameInput.value) ? renameInput.value[0] : renameInput.value;
  input?.focus();
  input?.select();
}

function commitRename(): void {
  const id = editingId.value;
  if (!id) return;
  const name = nameDraft.value.trim();
  const page = pages.value.find((entry) => entry.id === id);
  editingId.value = null;
  if (page && name && name !== page.name) store.renamePage(id, name);
  void nextTick(() => rowButton(id)?.focus());
}

function cancelRename(): void {
  const id = editingId.value;
  editingId.value = null;
  if (id) void nextTick(() => rowButton(id)?.focus());
}

// --- Context menu --------------------------------------------------------------
const menu = ref<{ id: string; x: number; y: number } | null>(null);
const menuEl = ref<HTMLElement | null>(null);

const menuEntries = computed<MenuEntry[]>(() => {
  const id = menu.value?.id;
  const index = pages.value.findIndex((page) => page.id === id);
  const pending = editable.value ? null : 'pending';
  return [
    { id: 'copy', label: t('pages.copy'), blocked: null },
    { id: 'rename', label: t('pages.rename'), blocked: canRename.value ? null : 'rule', separatorBefore: true },
    { id: 'duplicate', label: t('pages.duplicate'), blocked: pending },
    { id: 'moveUp', label: t('pages.moveUp'), blocked: pending ?? (index <= 0 ? 'rule' : null), separatorBefore: true },
    { id: 'moveDown', label: t('pages.moveDown'), blocked: pending ?? (index >= pages.value.length - 1 ? 'rule' : null) },
    { id: 'delete', label: t('pages.delete'), blocked: pending ?? (pages.value.length <= 1 ? 'rule' : null), separatorBefore: true },
  ];
});

function menuItems(): HTMLButtonElement[] {
  return Array.from(menuEl.value?.querySelectorAll<HTMLButtonElement>('[role="menuitem"]') ?? []);
}

async function openMenu(id: string, at: { x: number; y: number }): Promise<void> {
  cancelRename();
  menu.value = { id, x: at.x, y: at.y };
  await nextTick();
  const box = menuEl.value?.getBoundingClientRect();
  if (box && menu.value) {
    menu.value.x = Math.max(8, Math.min(menu.value.x, window.innerWidth - box.width - 8));
    menu.value.y = Math.max(8, Math.min(menu.value.y, window.innerHeight - box.height - 8));
  }
  menuItems()[0]?.focus();
}

function openMenuFromButton(id: string, event: MouseEvent): void {
  const rect = (event.currentTarget as HTMLElement).getBoundingClientRect();
  void openMenu(id, { x: rect.left, y: rect.bottom + 6 });
}

function openMenuFromRow(id: string, event: MouseEvent): void {
  void openMenu(id, { x: event.clientX, y: event.clientY });
}

function closeMenu(returnFocus: boolean): void {
  const id = menu.value?.id;
  menu.value = null;
  if (returnFocus && id) void nextTick(() => panel.value?.querySelector<HTMLButtonElement>(`[data-more-id="${CSS.escape(id)}"]`)?.focus());
}

function runMenu(entry: MenuEntry): void {
  const id = menu.value?.id;
  if (!id || entry.blocked === 'rule') return;
  const page = pages.value.find((p) => p.id === id);
  const index = pages.value.findIndex((p) => p.id === id);
  closeMenu(entry.id !== 'rename');
  if (!page) return;
  switch (entry.id) {
    case 'copy': void store.copyPage(id); break;
    case 'rename': void startRename(page); break;
    case 'duplicate': store.duplicatePage(id); break;
    case 'moveUp': store.movePage(id, index - 1); break;
    case 'moveDown': store.movePage(id, index + 1); break;
    case 'delete': store.deletePage(id); break;
  }
}

function onMenuKeydown(event: KeyboardEvent): void {
  const items = menuItems();
  const current = items.findIndex((item) => item === document.activeElement);
  let next: number;
  switch (event.key) {
    case 'ArrowDown': next = (current + 1) % items.length; break;
    case 'ArrowUp': next = (current - 1 + items.length) % items.length; break;
    case 'Home': next = 0; break;
    case 'End': next = items.length - 1; break;
    case 'Escape':
    case 'Tab':
      event.preventDefault();
      event.stopPropagation();
      closeMenu(true);
      return;
    default:
      return;
  }
  event.preventDefault();
  event.stopPropagation();
  items[next]?.focus();
}

// --- Keyboard in the list ------------------------------------------------------
function onRowKeydown(page: PageSummary, index: number, event: KeyboardEvent): void {
  const buttons = Array.from(panel.value?.querySelectorAll<HTMLButtonElement>('[data-page-id]') ?? []);
  if (event.altKey && (event.key === 'ArrowUp' || event.key === 'ArrowDown')) {
    event.preventDefault();
    const target = index + (event.key === 'ArrowUp' ? -1 : 1);
    if (target >= 0 && target < pages.value.length) store.movePage(page.id, target);
    return;
  }
  if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
    event.preventDefault();
    buttons[(index + (event.key === 'ArrowDown' ? 1 : -1) + buttons.length) % buttons.length]?.focus();
  } else if (event.key === 'F2') {
    event.preventDefault();
    void startRename(page);
  } else if (event.key === 'ContextMenu' || (event.shiftKey && event.key === 'F10')) {
    event.preventDefault();
    const rect = (event.currentTarget as HTMLElement).getBoundingClientRect();
    void openMenu(page.id, { x: rect.left + 24, y: rect.bottom });
  }
}

function onPanelKeydown(event: KeyboardEvent): void {
  if (event.key !== 'Escape' || event.defaultPrevented) return;
  event.preventDefault();
  event.stopPropagation();
  closePanel(true);
}

// --- Drag & drop reordering ------------------------------------------------------
const dragId = ref<string | null>(null);
const dropIndex = ref<number | null>(null);

function onDragStart(page: PageSummary, event: DragEvent): void {
  if (!editable.value) { event.preventDefault(); return; }
  dragId.value = page.id;
  event.dataTransfer?.setData('text/plain', page.name);
  if (event.dataTransfer) event.dataTransfer.effectAllowed = 'move';
}

function onDragOver(index: number, event: DragEvent): void {
  if (!dragId.value) return;
  event.preventDefault();
  const rect = (event.currentTarget as HTMLElement).getBoundingClientRect();
  dropIndex.value = event.clientY < rect.top + rect.height / 2 ? index : index + 1;
}

function onDrop(event: DragEvent): void {
  if (!dragId.value || dropIndex.value === null) return;
  event.preventDefault();
  const from = pages.value.findIndex((page) => page.id === dragId.value);
  const to = dropIndex.value > from ? dropIndex.value - 1 : dropIndex.value;
  if (from >= 0 && to !== from) store.movePage(dragId.value, to);
  onDragEnd();
}

function onDragEnd(): void {
  dragId.value = null;
  dropIndex.value = null;
}

// --- Dismissal ----------------------------------------------------------------------
function onFocusOut(event: FocusEvent): void {
  const next = event.relatedTarget;
  if (open.value && next instanceof Node && !root.value?.contains(next)) closePanel(false);
}

function onDocumentPointerDown(event: PointerEvent): void {
  if (!open.value || !(event.target instanceof Node)) return;
  if (!root.value?.contains(event.target)) closePanel(false);
  else if (menu.value && !menuEl.value?.contains(event.target)) closeMenu(false);
}

useEventListener(document, 'pointerdown', onDocumentPointerDown, true);

</script>

<template>
  <div ref="root" class="page-switcher" @focusout="onFocusOut">
    <button
      ref="trigger"
      type="button"
      class="segment"
      data-testid="page-switcher"
      aria-haspopup="dialog"
      :aria-expanded="open"
      :aria-controls="panelId"
      :aria-label="t('pages.open', { count: pages.length, name: currentName })"
      @click="togglePanel"
    >
      <span class="pages-icon" aria-hidden="true">
        <AppIcon name="pages" :size="24" />
        <span class="pages-count">{{ pages.length }}</span>
      </span>
      <span class="segment-name">{{ currentName }}</span>
    </button>

    <div
      v-if="open"
      :id="panelId"
      ref="panel"
      class="page-panel sd-panel"
      role="dialog"
      data-focus-scope
      :aria-labelledby="headingId"
      @keydown="onPanelKeydown"
    >
      <div class="panel-head">
        <h2 :id="headingId" class="panel-title">{{ t('pages.label') }}</h2>
        <button
          type="button"
          class="sd-icon-btn head-btn"
          data-testid="page-add"
          :aria-disabled="!editable || undefined"
          :aria-label="t('pages.add')"
          :title="t('pages.add')"
          @click="store.addPage()"
        >
          <AppIcon name="plus" :size="18" />
        </button>
      </div>

      <ul class="page-list" :aria-label="t('pages.list')" @dragleave.self="dropIndex = null">
        <li
          v-for="(page, index) in pages"
          :key="page.id"
          class="page-row"
          :class="{
            active: page.id === s.activePageId,
            dragging: dragId === page.id,
            'drop-before': dragId && dropIndex === index,
            'drop-after': dragId && dropIndex === index + 1 && index === pages.length - 1,
          }"
          :draggable="editable && editingId !== page.id"
          @dragstart="onDragStart(page, $event)"
          @dragover="onDragOver(index, $event)"
          @drop="onDrop"
          @dragend="onDragEnd"
          @contextmenu.prevent="openMenuFromRow(page.id, $event)"
        >
          <span class="grip" :class="{ usable: editable }" aria-hidden="true"><AppIcon name="grip" :size="16" /></span>
          <input
            v-if="editingId === page.id"
            ref="renameInput"
            v-model="nameDraft"
            class="rename-input"
            type="text"
            maxlength="120"
            autocomplete="off"
            spellcheck="false"
            :aria-label="t('pages.renameField')"
            @keydown.enter.prevent="commitRename"
            @keydown.esc.stop.prevent="cancelRename"
            @blur="commitRename"
          />
          <button
            v-else
            type="button"
            class="page-btn"
            :data-page-id="page.id"
            :aria-current="page.id === s.activePageId ? 'page' : undefined"
            aria-keyshortcuts="F2 Alt+ArrowUp Alt+ArrowDown"
            @click="selectPage(page.id)"
            @dblclick="startRename(page)"
            @keydown="onRowKeydown(page, index, $event)"
          >
            <span class="page-name">{{ page.name }}</span>
          </button>
          <button
            type="button"
            class="more-btn"
            :data-more-id="page.id"
            aria-haspopup="menu"
            :aria-expanded="menu?.id === page.id"
            :aria-label="t('pages.more', { name: page.name })"
            @click="openMenuFromButton(page.id, $event)"
          >
            <AppIcon name="more" :size="18" />
          </button>
        </li>
      </ul>

      <div class="workspace-views">
        <button type="button" class="task-board-entry" :aria-current="s.workspaceView === 'tasks' ? 'page' : undefined" data-testid="task-board-entry" @click="selectTasks"><AppIcon name="check" :size="18" /><span><strong>Aufgaben</strong><small>{{ (s.document.tasks ?? []).filter((task) => task.status !== 'done').length }} offen</small></span></button>
      </div>

      <div class="panel-foot">
        <button
          type="button"
          class="foot-btn"
          data-testid="page-paste"
          :aria-disabled="!editable || undefined"
          @click="store.pastePage()"
        >
          <AppIcon name="paste" :size="18" />
          <span>{{ t('pages.paste') }}</span>
        </button>
        <p v-if="editable" class="foot-note">{{ t('pages.hint') }}</p>
      </div>

      <div
        v-if="menu"
        ref="menuEl"
        class="page-menu"
        role="menu"
        data-testid="page-menu"
        :aria-label="t('pages.menu')"
        :style="{ left: `${menu.x}px`, top: `${menu.y}px`, minWidth: `${MENU_WIDTH}px` }"
        @keydown="onMenuKeydown"
      >
        <template v-for="entry in menuEntries" :key="entry.id">
          <span v-if="entry.separatorBefore" class="menu-sep" role="separator" />
          <button
            type="button"
            role="menuitem"
            tabindex="-1"
            class="page-menu-item"
            :data-testid="`page-menu-${entry.id}`"
            :aria-disabled="entry.blocked ? true : undefined"
            @click="runMenu(entry)"
          >
            {{ entry.label }}
          </button>
        </template>
      </div>
    </div>
  </div>
</template>

<style scoped>
.page-switcher {
  position: relative;
  display: flex;
  align-items: center;
}

.segment {
  display: flex;
  align-items: center;
  gap: 10px;
  min-height: var(--chrome-control);
  padding: 0 10px 0 8px;
  background: transparent;
  border: 0;
  border-radius: 10px;
  color: var(--text-primary);
  font-size: var(--font-size-l);
  font-weight: 600;
  cursor: pointer;
  transition: background-color var(--duration-short) ease;
}

.segment:hover {
  background: var(--surface-raised);
}

.segment[aria-expanded='true'] {
  background: var(--accent-soft);
  color: var(--accent-ink);
}

.pages-icon {
  position: relative;
  display: grid;
  place-items: center;
  width: 24px;
  height: 24px;
}

/* The count sits inside the front sheet of the "pages" glyph (x 4–16, y 8–20). */
.pages-count {
  position: absolute;
  top: 8px;
  left: 4px;
  display: grid;
  place-items: center;
  width: 12px;
  height: 12px;
  font-size: 9px;
  font-weight: 700;
  font-variant-numeric: tabular-nums;
  line-height: 1;
}

.segment-name {
  max-width: clamp(80px, 14vw, 180px);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

/* --- Page panel --- */
.page-panel {
  position: absolute;
  top: calc(100% + 16px);
  left: -8px;
  z-index: 30;
  width: 288px;
  padding: 6px;
}

.panel-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 2px 2px 6px 10px;
}

.panel-title {
  font-size: var(--font-size-m);
  font-weight: 650;
}

.head-btn {
  width: 32px;
  height: 32px;
  border-radius: 8px;
}

.head-btn[aria-disabled='true'],
.foot-btn[aria-disabled='true'] {
  color: var(--text-muted);
}

.page-list {
  display: grid;
  gap: 2px;
  max-height: min(360px, calc(100vh - 220px));
  overflow: auto;
}

.page-row {
  position: relative;
  display: flex;
  align-items: center;
  gap: 2px;
  min-height: 40px;
  padding: 0 4px 0 2px;
  border-radius: 10px;
}

.page-row:hover {
  background: var(--surface-raised);
}

.page-row.active {
  background: var(--accent-soft);
}

.page-row.dragging {
  opacity: 0.45;
}

.page-row.drop-before::before,
.page-row.drop-after::after {
  content: '';
  position: absolute;
  left: 8px;
  right: 8px;
  height: 2px;
  border-radius: 2px;
  background: var(--accent);
}

.page-row.drop-before::before {
  top: -2px;
}

.page-row.drop-after::after {
  bottom: -2px;
}

.grip {
  display: grid;
  place-items: center;
  width: 18px;
  color: var(--text-subtle);
  opacity: 0;
}

.grip.usable {
  cursor: grab;
}

.page-row:hover .grip,
.page-row:focus-within .grip {
  opacity: 1;
}

.page-btn {
  display: flex;
  flex: 1;
  align-items: center;
  gap: 8px;
  min-width: 0;
  min-height: 36px;
  padding: 0 6px;
  background: transparent;
  border: 0;
  border-radius: 8px;
  color: var(--text-primary);
  font-size: var(--font-size-m);
  text-align: left;
  cursor: pointer;
}

.page-btn:focus-visible {
  outline-offset: -2px;
}

.page-name {
  flex: 1;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.page-row.active .page-name {
  color: var(--accent-ink);
  font-weight: 600;
}

.rename-input {
  flex: 1;
  min-width: 0;
  height: 32px;
  padding: 0 8px;
  background: var(--surface-panel);
  border: 1px solid var(--accent);
  border-radius: 8px;
  box-shadow: 0 0 0 3px var(--accent-soft);
  font-size: var(--font-size-m);
  font-weight: 600;
}

.more-btn {
  display: grid;
  place-items: center;
  flex: none;
  width: 30px;
  height: 30px;
  padding: 0;
  background: transparent;
  border: 0;
  border-radius: 8px;
  color: var(--text-muted);
  cursor: pointer;
  opacity: 0;
}

.page-row:hover .more-btn,
.page-row:focus-within .more-btn,
.page-row.active .more-btn,
.more-btn[aria-expanded='true'] {
  opacity: 1;
}

.more-btn:hover,
.more-btn[aria-expanded='true'] {
  background: color-mix(in srgb, var(--text-primary) 8%, transparent);
  color: var(--text-primary);
}

.workspace-views{margin-top:6px;padding:6px 2px;border-top:1px solid var(--border-subtle)}
.task-board-entry{display:flex;align-items:center;gap:10px;width:100%;min-height:48px;padding:6px 10px;border:0;border-radius:10px;background:transparent;color:var(--text-primary);text-align:left}
.task-board-entry:hover,.task-board-entry[aria-current='page']{background:var(--accent-soft);color:var(--accent-ink)}
.task-board-entry>span{display:grid;gap:2px}.task-board-entry small{color:var(--text-muted);font-size:11px}
.panel-foot {
  display: grid;
  gap: 2px;
  margin-top: 6px;
  padding-top: 6px;
  border-top: 1px solid var(--border-subtle);
}

.foot-btn {
  display: flex;
  align-items: center;
  gap: 10px;
  min-height: 36px;
  padding: 0 10px;
  background: transparent;
  border: 0;
  border-radius: 10px;
  color: var(--text-primary);
  font-size: var(--font-size-m);
  text-align: left;
  cursor: pointer;
}

.foot-btn:hover {
  background: var(--surface-raised);
}

.foot-note {
  padding: 2px 10px 4px;
  color: var(--text-muted);
  font-size: 11px;
}

/* --- Context menu (light panel style, follows the theme) --- */
.page-menu {
  position: fixed;
  z-index: 100;
  padding: 8px;
  background: var(--menu-surface);
  border: 1px solid var(--border-subtle);
  border-radius: 16px;
  box-shadow: var(--shadow-panel);
  color: var(--menu-text);
}

.page-menu-item {
  display: block;
  width: 100%;
  min-height: 38px;
  padding: 0 14px;
  background: transparent;
  border: 0;
  border-radius: 10px;
  color: inherit;
  font-size: 14px;
  text-align: left;
  white-space: nowrap;
  cursor: pointer;
}

.page-menu-item:hover,
.page-menu-item:focus-visible {
  background: var(--menu-hover);
}

.page-menu-item:focus-visible {
  outline: 2px solid var(--accent);
  outline-offset: -2px;
}

.page-menu-item[aria-disabled='true'] {
  color: var(--menu-muted);
  cursor: default;
}

.menu-sep {
  display: block;
  height: 1px;
  margin: 6px 6px;
  background: var(--menu-separator);
}

@media (max-width: 640px) {
  .segment-name {
    display: none;
  }
}

@media (forced-colors: active) {
  .page-menu {
    border: 1px solid CanvasText;
  }

  .page-row.active,
  .page-menu-item:focus-visible {
    forced-color-adjust: none;
    background: Highlight;
    color: HighlightText;
  }
}
</style>

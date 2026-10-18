<script setup lang="ts">
import { computed, nextTick, ref, useId, watch, type Ref } from 'vue';
import { useEventListener } from '@vueuse/core';
import AppIcon from './AppIcon.vue';
import PageSwitcher from './PageSwitcher.vue';
import type { IconName } from './icons';
import { isMacPlatform, modHint } from './platform';
import { useWhiteboard } from './use-whiteboard';
import { t } from '@/renderer/i18n/de';

type FileItemId = 'new' | 'open' | 'save' | 'saveAs' | 'export' | 'interopImport' | 'interopExport';
type ViewItemId = 'collaboration' | 'catalog' | 'code' | 'plugins';
interface FileItem { id: FileItemId; label: string; icon: IconName; hint: string; separator?: boolean }
interface ViewItem { id: ViewItemId; label: string; icon: IconName; checked: boolean; separator?: boolean }

const props = defineProps<{ collaborationOpen: boolean; pluginsOpen: boolean }>();
const emit = defineEmits<{ interop: [mode: 'import' | 'export']; collaboration: []; plugins: [] }>();

const store = useWhiteboard();
const s = store.state;
const isMac = isMacPlatform();
const uid = useId();
const fileMenuId = `${uid}-file-menu`;
const viewMenuId = `${uid}-view-menu`;
const titleInputId = `${uid}-title`;

const statusIsProblem = computed(() => s.saveStatus === 'error' || s.saveStatus === 'conflict');

// --- Document title ---------------------------------------------------------
const titleDraft = ref(s.title);
const titleFocused = ref(false);
watch(titleDraft, (value) => store.updateTitleDraft(value), { flush: 'sync' });
watch(
  () => s.title,
  (title) => {
    if (!titleFocused.value) titleDraft.value = title;
  },
);

function syncTitleDraft(): void {
  void store.whenIdle().then(() => nextTick(() => { titleDraft.value = s.title; }));
}

function commitTitle(): void {
  const next = titleDraft.value.trim();
  if (next !== '' && next !== s.title) store.setTitle(next);
  syncTitleDraft();
}

function onTitleKeydown(event: KeyboardEvent): void {
  if (event.isComposing) return;
  if (event.key === 'Enter') {
    event.preventDefault();
    commitTitle();
  } else if (event.key === 'Escape' && titleDraft.value !== s.title) {
    event.preventDefault();
    event.stopPropagation();
    titleDraft.value = s.title;
  }
}

function onTitleBlur(): void {
  titleFocused.value = false;
  commitTitle();
}

// --- Menus ------------------------------------------------------------------
const fileItems: readonly FileItem[] = [
  { id: 'new', label: t('file.new'), icon: 'file-plus', hint: '' },
  { id: 'open', label: t('file.open'), icon: 'folder-open', hint: modHint(isMac, 'O') },
  { id: 'save', label: t('file.save'), icon: 'save', hint: modHint(isMac, 'S') },
  { id: 'saveAs', label: t('file.saveAs'), icon: 'save-as', hint: modHint(isMac, 'S', true) },
  { id: 'export', label: t('menu.export'), icon: 'download', hint: '', separator: true },
  { id: 'interopImport', label: t('menu.interopImport'), icon: 'folder-open', hint: '' },
  { id: 'interopExport', label: t('menu.interopExport'), icon: 'download', hint: '' },
];

const viewItems = computed<ViewItem[]>(() => [
  { id: 'collaboration', label: t('menu.collaboration'), icon: 'users', checked: props.collaborationOpen },
  { id: 'catalog', label: t('menu.catalog'), icon: 'component', checked: s.catalogOpen, separator: true },
  { id: 'code', label: t('menu.code'), icon: 'code', checked: s.codeOpen },
  { id: 'plugins', label: 'Plugin-Einstellungen', icon: 'component', checked: props.pluginsOpen, separator: true },
]);

type MenuName = 'file' | 'view';
const openMenuName = ref<MenuName | null>(null);
const fileTrigger = ref<HTMLButtonElement | null>(null), viewTrigger = ref<HTMLButtonElement | null>(null);
const fileList = ref<HTMLElement | null>(null), viewList = ref<HTMLElement | null>(null);
const triggers: Record<MenuName, Ref<HTMLButtonElement | null>> = { file: fileTrigger, view: viewTrigger };
const lists: Record<MenuName, Ref<HTMLElement | null>> = { file: fileList, view: viewList };

function itemsOf(name: MenuName): HTMLElement[] {
  return Array.from(lists[name].value?.querySelectorAll<HTMLElement>('[role^="menuitem"]') ?? []);
}

async function openMenu(name: MenuName, target: 'first' | 'last'): Promise<void> {
  openMenuName.value = name;
  await nextTick();
  const items = itemsOf(name);
  (target === 'last' ? items[items.length - 1] : items[0])?.focus();
}

function closeMenu(returnFocus: boolean): void {
  const name = openMenuName.value;
  if (!name) return;
  openMenuName.value = null;
  if (returnFocus) triggers[name].value?.focus();
}

function onTriggerClick(name: MenuName): void {
  if (openMenuName.value === name) closeMenu(true);
  else void openMenu(name, 'first');
}

function onTriggerKeydown(name: MenuName, event: KeyboardEvent): void {
  if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return;
  event.preventDefault();
  void openMenu(name, event.key === 'ArrowUp' ? 'last' : 'first');
}

function onMenuKeydown(name: MenuName, event: KeyboardEvent): void {
  const items = itemsOf(name);
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

/** A menu stays open only while focus or pointer is on its trigger or its list. */
function belongsTo(name: MenuName, node: unknown): boolean {
  return node instanceof Node && Boolean(triggers[name].value?.contains(node) || lists[name].value?.contains(node));
}

function onFocusOut(name: MenuName, event: FocusEvent): void {
  if (openMenuName.value === name && !belongsTo(name, event.relatedTarget)) openMenuName.value = null;
}

function onDocumentPointerDown(event: PointerEvent): void {
  const name = openMenuName.value;
  if (name && !belongsTo(name, event.target)) openMenuName.value = null;
}

function runFile(id: FileItemId): void {
  closeMenu(true);
  switch (id) {
    case 'new': void store.newDocument(); break;
    case 'open': void store.openDocument(); break;
    case 'save': void store.save(); break;
    case 'saveAs': void store.saveAs(); break;
    case 'export': void store.exportDocument('sketchdraw'); break;
    case 'interopImport': emit('interop', 'import'); break;
    case 'interopExport': emit('interop', 'export'); break;
  }
}

function runView(id: ViewItemId): void {
  closeMenu(true);
  switch (id) {
    case 'collaboration': emit('collaboration'); break;
    case 'catalog': store.toggleCatalog(); break;
    case 'code': store.toggleCode(); break;
    case 'plugins': emit('plugins'); break;
  }
}

useEventListener(document, 'pointerdown', onDocumentPointerDown, true);
</script>

<template>
  <header class="doc-card sd-panel" @focusout="onFocusOut('file', $event)">
    <span class="doc-icon" aria-hidden="true"><AppIcon name="file" :size="20" /></span>
    <div class="doc-text">
      <div class="doc-title-row">
        <label class="visually-hidden" :for="titleInputId">{{ t('title.label') }}</label>
        <input
          :id="titleInputId"
          v-model="titleDraft"
          class="title-input"
          :disabled="!s.canWrite"
          type="text"
          data-testid="document-title"
          autocomplete="off"
          spellcheck="false"
          @compositionstart="store.setInputComposing(true)"
          @compositionend="store.setInputComposing(false)"
          @focus="titleFocused = true"
          @blur="onTitleBlur"
          @keydown="onTitleKeydown"
        />
        <button
          ref="fileTrigger"
          type="button"
          class="chevron-btn"
          data-testid="file-menu-button"
          aria-haspopup="menu"
          :aria-expanded="openMenuName === 'file'"
          :aria-controls="fileMenuId"
          :aria-label="t('file.menuLabel')"
          :title="t('file.menuLabel')"
          @click="onTriggerClick('file')"
          @keydown="onTriggerKeydown('file', $event)"
        >
          <AppIcon name="chevron-down" :size="16" />
        </button>
      </div>
      <p
        class="status"
        :class="{ problem: statusIsProblem }"
        data-testid="save-status"
        :data-status="s.saveStatus"
        aria-live="off"
      ><span class="status-dot" aria-hidden="true" /><span>{{ s.saveStatusText }}</span></p>
    </div>
    <span class="doc-divider" aria-hidden="true" />
    <PageSwitcher />

    <div
      v-if="openMenuName === 'file'"
      :id="fileMenuId"
      ref="fileList"
      class="menu file-menu sd-panel"
      role="menu"
      data-focus-scope
      :aria-label="t('file.menuLabel')"
      @keydown="onMenuKeydown('file', $event)"
    >
      <template v-for="item in fileItems" :key="item.id">
        <span v-if="item.separator" class="rule" role="separator" />
        <button
          type="button"
          role="menuitem"
          tabindex="-1"
          class="menu-item"
          :data-testid="`file-menu-${item.id}`"
          @click="runFile(item.id)"
        >
          <AppIcon :name="item.icon" :size="18" />
          <span class="menu-label">{{ item.label }}</span>
          <span v-if="item.hint" class="menu-hint">{{ item.hint }}</span>
        </button>
      </template>
    </div>
  </header>

  <div class="workspace-bar sd-panel" role="group" :aria-label="t('chrome.actions')">
    <button
      type="button"
      class="sd-icon-btn bar-btn"
      data-objects-toggle
      data-testid="objects-toggle"
      aria-controls="objects-drawer"
      aria-keyshortcuts="O"
      :aria-expanded="s.objectsOpen"
      :aria-label="t('chrome.objects')"
      :title="t('tip.withHint', { label: t('chrome.objects'), hint: 'O' })"
      @click="store.toggleObjects()"
    >
      <AppIcon name="objects" />
    </button>
    <button
      type="button"
      class="sd-icon-btn bar-btn"
      data-testid="help-button"
      aria-keyshortcuts="?"
      :aria-label="t('chrome.help')"
      :title="t('tip.withHint', { label: t('chrome.help'), hint: '?' })"
      @click="store.openHelp()"
    >
      <AppIcon name="help" />
    </button>
    <button
      type="button"
      class="sd-icon-btn bar-btn theme-btn"
      data-testid="theme-toggle"
      :aria-pressed="s.theme === 'dark'"
      :aria-label="t('chrome.theme')"
      :title="t('chrome.theme')"
      @click="store.setTheme(s.theme === 'dark' ? 'light' : 'dark')"
    >
      <AppIcon :name="s.theme === 'dark' ? 'moon' : 'sun'" />
    </button>
    <span class="bar-sep" aria-hidden="true" />
    <div class="view-wrap" @focusout="onFocusOut('view', $event)">
      <button
        ref="viewTrigger"
        type="button"
        class="profile-btn"
        data-testid="workspace-menu-button"
        aria-haspopup="menu"
        :aria-expanded="openMenuName === 'view'"
        :aria-controls="viewMenuId"
        :aria-label="t('menu.workspace')"
        :title="t('menu.workspace')"
        @click="onTriggerClick('view')"
        @keydown="onTriggerKeydown('view', $event)"
      >
        <span class="avatar" aria-hidden="true"><AppIcon name="user" :size="18" /></span>
        <AppIcon name="chevron-down" :size="16" />
      </button>
      <div
        v-if="openMenuName === 'view'"
        :id="viewMenuId"
        ref="viewList"
        class="menu view-menu sd-panel"
        role="menu"
        data-focus-scope
        :aria-label="t('menu.workspace')"
        @keydown="onMenuKeydown('view', $event)"
      >
        <template v-for="item in viewItems" :key="item.id">
          <span v-if="item.separator" class="rule" role="separator" />
          <button
            type="button"
            role="menuitemcheckbox"
            tabindex="-1"
            class="menu-item"
            :aria-checked="item.checked"
            @click="runView(item.id)"
          >
            <AppIcon :name="item.icon" :size="18" />
            <span class="menu-label">{{ item.label }}</span>
            <AppIcon v-if="item.checked" class="menu-check" name="check" :size="16" />
          </button>
        </template>
      </div>
    </div>
  </div>
</template>

<style scoped>
/* --- Document card (top left) --- */
.doc-card {
  position: absolute;
  top: var(--space-3);
  left: var(--space-3);
  z-index: 40;
  display: flex;
  align-items: center;
  gap: var(--space-3);
  height: var(--chrome-height);
  max-width: calc(100vw - 2 * var(--space-3));
  padding: 0 var(--space-3) 0 var(--space-2);
}

.doc-icon {
  display: grid;
  place-items: center;
  flex: none;
  width: var(--chrome-control);
  height: var(--chrome-control);
  border-radius: 10px;
  background: var(--accent-soft);
  color: var(--accent);
}

.doc-divider {
  align-self: stretch;
  width: 1px;
  background: var(--border-subtle);
}

.doc-text {
  display: flex;
  flex-direction: column;
  min-width: 0;
}

.doc-title-row {
  display: flex;
  align-items: center;
  gap: 2px;
}

.title-input {
  field-sizing: content;
  min-width: 64px;
  max-width: clamp(120px, 22vw, 260px);
  margin-left: -6px;
  padding: 1px 6px;
  background: transparent;
  border: 1px solid transparent;
  border-radius: 6px;
  font-size: var(--font-size-l);
  font-weight: 650;
  letter-spacing: -0.01em;
  text-overflow: ellipsis;
}

.title-input:hover:not(:disabled) {
  background: var(--surface-raised);
}

.title-input:focus {
  background: var(--surface-panel);
  border-color: var(--border-default);
}

.chevron-btn {
  display: grid;
  place-items: center;
  flex: none;
  width: 24px;
  height: 24px;
  padding: 0;
  background: transparent;
  border: 0;
  border-radius: 6px;
  color: var(--text-muted);
  cursor: pointer;
}

.chevron-btn:hover,
.chevron-btn[aria-expanded='true'] {
  background: var(--surface-raised);
  color: var(--text-primary);
}

.status {
  display: flex;
  align-items: center;
  gap: 6px;
  color: var(--text-muted);
  font-size: var(--font-size-s);
  white-space: nowrap;
}

.status.problem {
  color: var(--status-error);
  font-weight: 600;
}

.status-dot {
  flex: none;
  width: 7px;
  height: 7px;
  border-radius: 50%;
  background: var(--text-muted);
}

.status[data-status='saved'] .status-dot,
.status[data-status='handed-off'] .status-dot {
  background: var(--status-ok);
}

.status[data-status='unsaved-new'] .status-dot,
.status[data-status='dirty'] .status-dot {
  background: transparent;
  box-shadow: inset 0 0 0 1.5px var(--text-muted);
}

.status[data-status='saving'] .status-dot {
  background: var(--accent);
}

.status.problem .status-dot {
  background: var(--status-error);
}

/* --- Workspace bar (top right) --- */
.workspace-bar {
  position: absolute;
  top: var(--space-3);
  right: var(--space-3);
  z-index: 40;
  display: flex;
  align-items: center;
  gap: 2px;
  height: var(--chrome-height);
  padding: 0 6px;
}

.bar-btn {
  width: var(--chrome-control);
  height: var(--chrome-control);
  border-radius: 10px;
}

.bar-btn[aria-expanded='true'] {
  background: var(--accent-soft);
  color: var(--accent);
  box-shadow: inset 0 0 0 1px var(--accent);
}

/* The icon itself shows the active theme, so the toggle keeps a neutral surface. */
.theme-btn[aria-pressed='true'] {
  background: transparent;
  box-shadow: none;
  color: var(--text-primary);
}

.theme-btn[aria-pressed='true']:hover {
  background: var(--surface-raised);
}

.bar-sep {
  width: 1px;
  height: 24px;
  margin: 0 6px;
  background: var(--border-subtle);
}

.view-wrap {
  position: relative;
}

.profile-btn {
  display: flex;
  align-items: center;
  gap: 4px;
  padding: 3px 6px 3px 3px;
  background: transparent;
  border: 0;
  border-radius: 999px;
  color: var(--text-muted);
  cursor: pointer;
}

.profile-btn:hover,
.profile-btn[aria-expanded='true'] {
  background: var(--surface-raised);
}

.avatar {
  display: grid;
  place-items: center;
  width: 34px;
  height: 34px;
  border-radius: 50%;
  background: linear-gradient(135deg, #8b5cf6 0%, #6b4ce6 45%, #ec4899 100%);
  box-shadow: 0 0 0 2px var(--surface-panel), 0 0 0 3px var(--accent-soft);
  color: #ffffff;
}

/* --- Shared dropdown menu --- */
.menu {
  position: absolute;
  top: calc(100% + var(--space-2));
  z-index: 30;
  min-width: 248px;
  padding: 6px;
}

.file-menu {
  left: 0;
}

.view-menu {
  right: -6px;
  top: calc(100% + 14px);
}

.menu-item {
  display: flex;
  align-items: center;
  gap: 12px;
  width: 100%;
  min-height: 38px;
  padding: 0 12px;
  background: transparent;
  border: 0;
  border-radius: 10px;
  color: var(--text-primary);
  font-size: var(--font-size-m);
  font-weight: 500;
  text-align: left;
  cursor: pointer;
}

.menu-item > .app-icon {
  color: var(--text-muted);
}

.menu-item:hover,
.menu-item:focus-visible {
  background: var(--surface-raised);
}

.menu-item:focus-visible {
  outline-offset: -2px;
}

.menu-item[aria-checked='true'] {
  background: var(--accent-soft);
  color: var(--accent-ink);
}

.menu-item[aria-checked='true'] > .app-icon {
  color: var(--accent);
}

.menu-label {
  flex: 1;
}

.menu-hint {
  color: var(--text-muted);
  font-family: var(--font-mono);
  font-size: 11px;
}

.rule {
  display: block;
  height: 1px;
  margin: 6px 10px;
  background: var(--border-subtle);
}

@media (max-width: 640px) {
  .title-input {
    max-width: 30vw;
  }

  .status {
    display: none;
  }

  .bar-btn {
    width: 36px;
    height: 36px;
  }
}

@media (forced-colors: active) {
  .menu-item:hover,
  .menu-item:focus-visible,
  .menu-item[aria-checked='true'] {
    forced-color-adjust: none;
    background: Highlight;
    color: HighlightText;
  }

  .status-dot {
    border: 1px solid CanvasText;
  }
}
</style>

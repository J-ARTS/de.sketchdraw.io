<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, useId, watch } from 'vue';
import AppIcon from './AppIcon.vue';
import type { IconName } from './icons';
import { isMacPlatform, modHint } from './platform';
import { useWhiteboard } from './use-whiteboard';
import { t } from '@/renderer/i18n/de';
import type { SaveStatus } from '@/renderer/state/contract';

type MenuItemId = 'new' | 'open' | 'save' | 'saveAs' | 'export' | 'interopImport' | 'interopExport';
interface MenuItem { id: MenuItemId; label: string; icon: IconName; hint: string }

const store = useWhiteboard();
const emit = defineEmits<{ interop: [mode: 'import' | 'export'] }>();
const isMac = isMacPlatform();
const uid = useId();
const menuId = `${uid}-file-menu`;
const titleInputId = `${uid}-title`;

const STATUS_ICONS: Readonly<Record<SaveStatus, IconName>> = {
  'unsaved-new': 'dot',
  dirty: 'dot',
  saving: 'saving',
  saved: 'check',
  'handed-off': 'download',
  error: 'warning',
  conflict: 'warning',
};
const statusIcon = computed(() => STATUS_ICONS[store.state.saveStatus]);
const statusIsProblem = computed(() => store.state.saveStatus === 'error' || store.state.saveStatus === 'conflict');

const titleDraft = ref(store.state.title);
const titleFocused = ref(false);
watch(titleDraft, (value) => store.updateTitleDraft(value), { flush: 'sync' });
watch(
  () => store.state.title,
  (title) => {
    if (!titleFocused.value) titleDraft.value = title;
  },
);

function syncTitleDraft(): void {
  void store.whenIdle().then(() => nextTick(() => { titleDraft.value = store.state.title; }));
}

function commitTitle(): void {
  const next = titleDraft.value.trim();
  if (next !== '' && next !== store.state.title) store.setTitle(next);
  syncTitleDraft();
}

function onTitleKeydown(event: KeyboardEvent): void {
  if (event.isComposing) return;
  if (event.key === 'Enter') {
    event.preventDefault();
    commitTitle();
  } else if (event.key === 'Escape' && titleDraft.value !== store.state.title) {
    event.preventDefault();
    event.stopPropagation();
    titleDraft.value = store.state.title;
  }
}

function onTitleBlur(): void {
  titleFocused.value = false;
  commitTitle();
}

const menuItems: readonly MenuItem[] = [
  { id: 'interopImport', label: 'SVG / draw.io importieren', icon: 'folder-open', hint: '' },
  { id: 'interopExport', label: 'SVG / draw.io exportieren', icon: 'download', hint: '' },
  { id: 'export', label: 'Kopie exportieren', icon: 'download', hint: '' },
  { id: 'new', label: t('file.new'), icon: 'file-plus', hint: '' },
  { id: 'open', label: t('file.open'), icon: 'folder-open', hint: modHint(isMac, 'O') },
  { id: 'save', label: t('file.save'), icon: 'save', hint: modHint(isMac, 'S') },
  { id: 'saveAs', label: t('file.saveAs'), icon: 'save-as', hint: modHint(isMac, 'S', true) },
];

const menuOpen = ref(false);
const wrap = ref<HTMLElement | null>(null);
const menuButton = ref<HTMLButtonElement | null>(null);
const menuEl = ref<HTMLElement | null>(null);

function itemButtons(): HTMLButtonElement[] {
  return Array.from(menuEl.value?.querySelectorAll<HTMLButtonElement>('[role="menuitem"]') ?? []);
}

async function openMenu(target: 'first' | 'last'): Promise<void> {
  menuOpen.value = true;
  await nextTick();
  const buttons = itemButtons();
  (target === 'last' ? buttons[buttons.length - 1] : buttons[0])?.focus();
}

function closeMenu(returnFocus: boolean): void {
  if (!menuOpen.value) return;
  menuOpen.value = false;
  if (returnFocus) menuButton.value?.focus();
}

function onMenuButtonClick(): void {
  if (menuOpen.value) closeMenu(true);
  else void openMenu('first');
}

function onMenuButtonKeydown(event: KeyboardEvent): void {
  if (event.key === 'ArrowDown') {
    event.preventDefault();
    void openMenu('first');
  } else if (event.key === 'ArrowUp') {
    event.preventDefault();
    void openMenu('last');
  }
}

function onMenuKeydown(event: KeyboardEvent): void {
  const buttons = itemButtons();
  const current = buttons.findIndex((button) => button === document.activeElement);
  let next: number;
  switch (event.key) {
    case 'ArrowDown': next = (current + 1) % buttons.length; break;
    case 'ArrowUp': next = (current - 1 + buttons.length) % buttons.length; break;
    case 'Home': next = 0; break;
    case 'End': next = buttons.length - 1; break;
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
  buttons[next]?.focus();
}

function runItem(id: MenuItemId): void {
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

function onFocusOut(event: FocusEvent): void {
  const next = event.relatedTarget;
  if (menuOpen.value && !(next instanceof Node && wrap.value?.contains(next))) menuOpen.value = false;
}

function onDocumentPointerDown(event: PointerEvent): void {
  if (menuOpen.value && event.target instanceof Node && !wrap.value?.contains(event.target)) menuOpen.value = false;
}

onMounted(() => document.addEventListener('pointerdown', onDocumentPointerDown, true));
onBeforeUnmount(() => document.removeEventListener('pointerdown', onDocumentPointerDown, true));
</script>

<template>
  <header class="titlebar sd-panel">
    <div class="row">
      <div ref="wrap" class="menu-wrap" @focusout="onFocusOut">
        <button
          ref="menuButton"
          type="button"
          class="sd-btn menu-button"
          data-testid="file-menu-button"
          aria-haspopup="menu"
          :aria-expanded="menuOpen"
          :aria-controls="menuId"
          :aria-label="t('file.menuLabel')"
          @click="onMenuButtonClick"
          @keydown="onMenuButtonKeydown"
        >
          <AppIcon name="file" />
          <span>{{ t('file.menu') }}</span>
        </button>
        <div
          v-if="menuOpen"
          :id="menuId"
          ref="menuEl"
          class="menu sd-panel"
          role="menu"
          data-focus-scope
          :aria-label="t('file.menuLabel')"
          @keydown="onMenuKeydown"
        >
          <button
            v-for="item in menuItems"
            :key="item.id"
            type="button"
            role="menuitem"
            tabindex="-1"
            class="menu-item"
            :data-testid="`file-menu-${item.id}`"
            @click="runItem(item.id)"
          >
            <AppIcon :name="item.icon" />
            <span class="menu-label">{{ item.label }}</span>
            <span v-if="item.hint" class="menu-hint">{{ item.hint }}</span>
          </button>
        </div>
      </div>
      <label class="visually-hidden" :for="titleInputId">{{ t('title.label') }}</label>
      <input
        :id="titleInputId"
        v-model="titleDraft"
        class="sd-input title-input"
        :disabled="!store.state.canWrite"
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
    </div>
    <p
      class="status"
      :class="{ problem: statusIsProblem }"
      data-testid="save-status"
      :data-status="store.state.saveStatus"
      aria-live="off"
    >
      <AppIcon :name="statusIcon" :size="16" />
      <span>{{ store.state.saveStatusText }}</span>
    </p>
  </header>

  <div class="actions sd-panel" role="group" :aria-label="t('chrome.actions')">
    <button
      type="button"
      class="sd-icon-btn"
      data-objects-toggle
      data-testid="objects-toggle"
      aria-controls="objects-drawer"
      aria-keyshortcuts="O"
      :aria-expanded="store.state.objectsOpen"
      :aria-label="t('chrome.objects')"
      :title="t('tip.withHint', { label: t('chrome.objects'), hint: 'O' })"
      @click="store.toggleObjects()"
    >
      <AppIcon name="objects" />
    </button>
    <button
      type="button"
      class="sd-icon-btn"
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
      class="sd-icon-btn"
      data-testid="theme-toggle"
      :aria-pressed="store.state.theme === 'dark'"
      :aria-label="t('chrome.theme')"
      :title="t('chrome.theme')"
      @click="store.setTheme(store.state.theme === 'dark' ? 'light' : 'dark')"
    >
      <AppIcon name="moon" />
    </button>
  </div>
</template>

<style scoped>
.titlebar {
  position: absolute;
  top: var(--space-3);
  left: var(--space-3);
  z-index: 10;
  padding: var(--space-1) var(--space-2) var(--space-1) var(--space-1);
}

.row {
  display: flex;
  align-items: center;
  gap: var(--space-2);
}

.title-input {
  width: clamp(120px, 14vw, 200px);
  border-color: transparent;
  background: transparent;
  font-weight: 600;
  text-overflow: ellipsis;
}

.title-input:hover,
.title-input:focus {
  border-color: var(--border-default);
  background: var(--surface-panel);
}

.status {
  display: flex;
  align-items: center;
  gap: var(--space-1);
  margin: 0 0 var(--space-1) var(--space-2);
  color: var(--text-muted);
  font-size: var(--font-size-s);
}

.status.problem {
  color: var(--status-error);
  font-weight: 600;
}

.menu-wrap {
  position: relative;
}

.menu-button {
  border-color: transparent;
}

.menu {
  position: absolute;
  top: calc(100% + var(--space-1));
  left: 0;
  z-index: 30;
  min-width: 220px;
  padding: var(--space-1);
}

.menu-item {
  display: flex;
  align-items: center;
  gap: var(--space-2);
  width: 100%;
  min-height: var(--control-size);
  padding: 0 var(--space-2);
  background: transparent;
  border: 1px solid transparent;
  border-radius: var(--radius-1);
  color: inherit;
  cursor: pointer;
  text-align: left;
}

.menu-item:hover,
.menu-item:focus-visible {
  background: var(--accent-soft);
}

.menu-label {
  flex: 1;
}

.menu-hint {
  color: var(--text-muted);
  font-family: var(--font-mono);
  font-size: var(--font-size-s);
}

.actions {
  position: absolute;
  top: var(--space-3);
  right: var(--space-3);
  z-index: 40;
  display: flex;
  gap: 2px;
  padding: var(--space-1);
}

.actions .sd-icon-btn[aria-expanded='true'] {
  background: var(--accent-soft);
  border-color: var(--accent);
  box-shadow: inset 0 -3px 0 var(--accent);
}

@media (forced-colors: active) {
  .menu-item:hover,
  .menu-item:focus-visible {
    background: Highlight;
    color: HighlightText;
  }
}
</style>

<!-- @component The tab of the shape library with the user's own components: insert, rename, delete, export and import. -->
<script setup lang="ts">
import { t, tn } from '@/renderer/i18n';
import { computed, nextTick, ref, watch } from 'vue';
import { onClickOutside } from '@vueuse/core';
import { CUSTOM_COMPONENT_DRAG_MIME, CUSTOM_COMPONENT_LIMITS, useCustomComponents, type CustomComponent } from '@/renderer/lib/custom-components';
import AppIcon from '@/renderer/design-system/atoms/AppIcon.vue';
import AppIconButton from '@/renderer/design-system/atoms/AppIconButton.vue';
import PayloadPreview from '@/renderer/design-system/organisms/PayloadPreview.vue';
import { useWhiteboard } from '@/renderer/design-system/composables/use-whiteboard';

/** The "own components" tab of the library (#188): insert by click or drag, rename, delete. */
const props = defineProps<{ query: string }>();

const store = useWhiteboard();
const s = store.state;
const library = useCustomComponents();
const root = ref<HTMLElement | null>(null);
const draft = ref('');
const confirmingId = ref<string | null>(null);
const announcement = ref('');

// --- Export and import of the whole library (#244), behind the "…" button ---
const moreButton = ref<InstanceType<typeof AppIconButton> | null>(null);
const moreWrap = ref<HTMLElement | null>(null);
const menuEl = ref<HTMLElement | null>(null);
const fileInput = ref<HTMLInputElement | null>(null);
const menuOpen = ref(false);
const importing = ref(false);
const hasComponents = computed(() => library.components.value.length > 0);
const summary = computed(() => {
  const total = library.components.value.length;
  if (!total) return '';
  const shown = filtered.value.length;
  return shown === total
    ? tn(total, '{count} Komponente', '{count} Komponenten')
    : t('{shown} von {total} Komponenten', { shown, total });
});

const menuItems = (): HTMLButtonElement[] => Array.from(menuEl.value?.querySelectorAll<HTMLButtonElement>('[role="menuitem"]') ?? []);
async function openMenu(): Promise<void> {
  if (library.renamingId.value) library.renamingId.value = null;
  confirmingId.value = null;
  menuOpen.value = true;
  await nextTick();
  menuItems()[0]?.focus();
}
function closeMenu(returnFocus: boolean): void {
  if (!menuOpen.value) return;
  menuOpen.value = false;
  if (returnFocus) void nextTick(() => moreButton.value?.focus());
}
function toggleMenu(): void {
  if (menuOpen.value) closeMenu(true);
  else void openMenu();
}
onClickOutside(moreWrap, () => closeMenu(false));
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
function chooseImport(): void {
  closeMenu(true);
  // The file dialog needs the click itself; the input is emptied so the same file can be picked again.
  if (fileInput.value) { fileInput.value.value = ''; fileInput.value.click(); }
}
async function onFilePicked(event: Event): Promise<void> {
  const file = (event.target as HTMLInputElement).files?.[0];
  if (!file || importing.value) return;
  importing.value = true;
  try { await store.importCustomComponents(file); } finally { importing.value = false; }
}
function chooseExport(): void {
  if (!hasComponents.value) return;
  closeMenu(true);
  void store.exportCustomComponents();
}

const filtered = computed(() => {
  const needle = props.query.trim().toLocaleLowerCase();
  return needle ? library.components.value.filter((component) => component.name.toLocaleLowerCase().includes(needle)) : library.components.value;
});

const tile = (id: string): HTMLElement | null => root.value?.querySelector<HTMLElement>(`[data-component-id="${CSS.escape(id)}"]`) ?? null;
function focusIn(id: string, selector: string): void {
  void nextTick(() => tile(id)?.querySelector<HTMLElement>(selector)?.focus());
}

watch(library.renamingId, async (id) => {
  if (!id) return;
  confirmingId.value = null;
  draft.value = library.get(id)?.name ?? '';
  await nextTick();
  const input = tile(id)?.querySelector<HTMLInputElement>('.custom-name-input');
  input?.focus();
  input?.select();
  input?.scrollIntoView({ block: 'nearest' });
}, { immediate: true });

function insert(component: CustomComponent): void {
  void store.insertCustomComponent(component.id);
}
function drag(event: DragEvent, component: CustomComponent): void {
  event.dataTransfer?.setData(CUSTOM_COMPONENT_DRAG_MIME, component.id);
  if (event.dataTransfer) event.dataTransfer.effectAllowed = 'copy';
}
function startRename(id: string): void {
  library.renamingId.value = id;
}
/** Enter and leaving the field both keep the typed name; an empty name keeps the old one. */
function commitRename(id: string, returnFocus: boolean): void {
  if (library.renamingId.value !== id) return;
  const before = library.get(id)?.name ?? '';
  const changed = library.rename(id, draft.value);
  const after = library.get(id)?.name ?? before;
  library.renamingId.value = null;
  if (!changed) announcement.value = t('Der Name wurde nicht geändert.');
  else if (after !== before) announcement.value = t('Umbenannt in „{name}“.', { name: after });
  if (returnFocus) focusIn(id, '.rename-action');
}
function cancelRename(id: string): void {
  if (library.renamingId.value !== id) return;
  library.renamingId.value = null;
  focusIn(id, '.rename-action');
}
function askDelete(id: string): void {
  if (library.renamingId.value) library.renamingId.value = null;
  confirmingId.value = id;
  focusIn(id, '.confirm-delete');
}
function cancelDelete(id: string): void {
  confirmingId.value = null;
  focusIn(id, '.delete-action');
}
function confirmDelete(component: CustomComponent): void {
  const index = filtered.value.findIndex((entry) => entry.id === component.id);
  const neighbour = filtered.value[index + 1] ?? filtered.value[index - 1];
  confirmingId.value = null;
  if (!library.remove(component.id)) { announcement.value = t('Die Komponente konnte nicht gelöscht werden.'); return; }
  announcement.value = t('„{name}“ wurde gelöscht.', { name: component.name });
  // Focus stays in the list; without a neighbour it goes to the tab, so it is not lost with the removed tile.
  if (neighbour) focusIn(neighbour.id, '.custom-insert');
  else void nextTick(() => document.getElementById('library-tab-custom')?.focus());
}
</script>

<template>
  <div ref="root" class="custom-library" data-testid="custom-components">
    <p class="visually-hidden" role="status" aria-live="polite">{{ announcement }}</p>
    <div class="custom-bar">
      <span class="custom-summary" data-testid="custom-components-summary">{{ summary }}</span>
      <div ref="moreWrap" class="custom-more">
        <AppIconButton
          ref="moreButton"
          icon="more"
          class="custom-more-button"
          data-testid="custom-components-more"
          :label="t('Eigene Komponenten importieren oder exportieren')"
          aria-haspopup="menu"
          :aria-expanded="menuOpen"
          aria-controls="custom-components-menu"
          @click="toggleMenu"
        />
        <div v-if="menuOpen" id="custom-components-menu" ref="menuEl" class="custom-menu" role="menu" data-testid="custom-components-menu" :aria-label="t('Eigene Komponenten importieren oder exportieren')" @keydown="onMenuKeydown">
          <button type="button" role="menuitem" tabindex="-1" class="custom-menu-item" data-testid="custom-components-import" @click="chooseImport">{{ t('Komponenten importieren…') }}</button>
          <button type="button" role="menuitem" tabindex="-1" class="custom-menu-item" data-testid="custom-components-export" :aria-disabled="hasComponents ? undefined : true" @click="chooseExport">{{ t('Komponenten exportieren…') }}</button>
        </div>
      </div>
      <input ref="fileInput" class="visually-hidden" type="file" accept=".json,application/json" tabindex="-1" aria-hidden="true" data-testid="custom-components-file" @change="onFilePicked" />
    </div>
    <p v-if="!library.components.value.length" class="custom-empty" data-testid="custom-components-empty">
      <AppIcon name="component-add" :size="28" />
      <strong>{{ t('Noch keine eigenen Komponenten') }}</strong>
      <span>{{ t('Markiere Elemente auf der Zeichenfläche und wähle in der Auswahlleiste unter „…“ die Aktion „Als Komponente speichern“.') }}</span>
      <span>{{ t('Eine exportierte Bibliothek lässt sich oben unter „…“ importieren.') }}</span>
    </p>
    <p v-else-if="!filtered.length" class="custom-empty"><span>{{ t('Keine eigene Komponente gefunden.') }}</span></p>
    <template v-else>
      <ul class="custom-grid" :aria-label="t('Eigene Komponenten')">
        <li v-for="component in filtered" :key="component.id" class="custom-tile" :class="{ confirming: confirmingId === component.id }" :data-component-id="component.id">
          <button type="button" class="custom-insert" :disabled="s.transitioning || !s.canWrite" draggable="true" :aria-label="t('„{name}“ einfügen', { name: component.name })" :title="t('„{name}“ einfügen', { name: component.name })" @click="insert(component)" @dragstart="drag($event, component)">
            <PayloadPreview class="custom-preview" :payload="component.payload" :theme="s.theme" />
          </button>
          <div v-if="confirmingId === component.id" class="custom-meta" role="group" :aria-label="t('„{name}“ löschen?', { name: component.name })" @keydown.escape.prevent.stop="cancelDelete(component.id)">
            <button type="button" class="confirm-button confirm-delete" @click="confirmDelete(component)">{{ t('Löschen') }}</button>
            <button type="button" class="confirm-button" @click="cancelDelete(component.id)">{{ t('Abbrechen') }}</button>
          </div>
          <div v-else class="custom-meta">
            <input
              v-if="library.renamingId.value === component.id"
              v-model="draft"
              class="custom-name-input"
              type="text"
              :aria-label="t('Name der Komponente')"
              :maxlength="CUSTOM_COMPONENT_LIMITS.MAX_NAME_LENGTH"
              autocomplete="off"
              spellcheck="false"
              @keydown.enter.prevent="commitRename(component.id, true)"
              @keydown.escape.prevent.stop="cancelRename(component.id)"
              @blur="commitRename(component.id, false)"
            />
            <template v-else>
              <span class="custom-name" :title="component.name" @dblclick="startRename(component.id)">{{ component.name }}</span>
              <button type="button" class="tile-action rename-action" :aria-label="t('„{name}“ umbenennen', { name: component.name })" :title="t('Umbenennen')" @click="startRename(component.id)"><AppIcon name="rename" :size="16" /></button>
              <button type="button" class="tile-action delete-action" :aria-label="t('„{name}“ löschen', { name: component.name })" :title="t('Löschen')" @click="askDelete(component.id)"><AppIcon name="trash" :size="16" /></button>
            </template>
          </div>
        </li>
      </ul>
      <p class="custom-hint">{{ t('Klicken fügt die Komponente in der Mitte ein, Ziehen an der gewünschten Stelle.') }}</p>
    </template>
  </div>
</template>

<style scoped>
.custom-library{padding:8px 20px 8px}
.custom-bar{display:flex;align-items:center;justify-content:space-between;gap:8px;min-height:40px;margin-bottom:8px}
.custom-summary{min-width:0;overflow:hidden;color:var(--text-muted);font-size:12px;text-overflow:ellipsis;white-space:nowrap}
.custom-more{position:relative;flex:none}
.custom-menu{position:absolute;top:calc(100% + 4px);right:0;z-index:20;min-width:232px;padding:8px;border:1px solid var(--border-subtle);border-radius:16px;background:var(--menu-surface);box-shadow:var(--shadow-panel);color:var(--menu-text)}
.custom-menu-item{display:block;width:100%;min-height:38px;padding:0 14px;border:0;border-radius:10px;background:transparent;color:inherit;font-size:14px;text-align:left;white-space:nowrap;cursor:pointer}
.custom-menu-item:hover,.custom-menu-item:focus-visible{background:var(--menu-hover)}
.custom-menu-item:focus-visible{outline:2px solid var(--accent);outline-offset:-2px}
.custom-menu-item[aria-disabled='true']{color:var(--menu-muted);cursor:default}
.custom-menu-item[aria-disabled='true']:hover{background:transparent}
.custom-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:12px;margin:0;padding:0;list-style:none}
.custom-tile{display:flex;min-width:0;flex-direction:column;border:1px solid var(--border-subtle);border-radius:12px;background:var(--surface-raised);overflow:hidden}
.custom-tile:hover,.custom-tile:focus-within{border-color:var(--accent)}
.custom-tile.confirming{border-color:var(--status-error)}
.custom-insert{display:block;width:100%;height:112px;padding:10px;border:0;border-bottom:1px solid var(--border-subtle);background:var(--surface-canvas);cursor:grab}
.custom-insert:active{cursor:grabbing}
.custom-insert:disabled{cursor:not-allowed;opacity:.55}
.custom-insert:focus-visible{outline:2px solid var(--accent);outline-offset:-2px}
.custom-meta{display:flex;align-items:center;gap:2px;min-height:44px;padding:4px 4px 4px 10px}
.custom-name{flex:1;min-width:0;overflow:hidden;color:var(--text-primary);font-size:12px;font-weight:600;text-overflow:ellipsis;white-space:nowrap}
.custom-name-input{flex:1;min-width:0;height:32px;margin-right:6px;padding:0 8px;border:1px solid var(--accent);border-radius:8px;outline:0;background:var(--surface-panel);color:var(--text-primary);font:inherit;font-size:12px;font-weight:600}
.custom-name-input:focus-visible{box-shadow:0 0 0 2px var(--accent-soft)}
.tile-action{display:grid;flex:none;width:32px;height:32px;padding:0;place-items:center;border:0;border-radius:8px;background:transparent;color:var(--text-muted);cursor:pointer}
.tile-action:hover{background:var(--surface-panel);color:var(--text-primary)}
.tile-action.delete-action:hover{color:var(--status-error)}
.tile-action:focus-visible,.confirm-button:focus-visible{outline:2px solid var(--accent);outline-offset:-2px}
.custom-tile.confirming .custom-meta{gap:6px;padding:4px 6px}
.confirm-button{flex:1;min-width:0;min-height:32px;padding:0 8px;border:1px solid var(--border-subtle);border-radius:8px;background:var(--surface-panel);color:var(--text-primary);font-size:11px;cursor:pointer}
.confirm-button.confirm-delete{border-color:var(--status-error);color:var(--status-error)}
.custom-empty{display:grid;justify-items:center;gap:8px;margin:0;padding:36px 16px;color:var(--text-muted);font-size:12px;line-height:1.5;text-align:center}
.custom-empty strong{color:var(--text-primary);font-size:14px}
.custom-hint{margin:12px 4px 8px;color:var(--text-muted);font-size:11px;line-height:1.5}
.visually-hidden{position:absolute;width:1px;height:1px;padding:0;margin:-1px;overflow:hidden;clip:rect(0,0,0,0);white-space:nowrap;border:0}
@media(max-width:760px){.custom-library{padding-inline:14px}.tile-action{width:40px;height:40px}.confirm-button{min-height:40px}}
@media(forced-colors:active){.custom-tile.confirming{outline:2px solid Highlight}.custom-menu{border-color:CanvasText}.custom-menu-item:focus-visible{forced-color-adjust:none;background:Highlight;color:HighlightText}}
</style>

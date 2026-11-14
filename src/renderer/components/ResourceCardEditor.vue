<script setup lang="ts">
import { t, tm } from '@/renderer/i18n';
import { computed, nextTick, onBeforeUnmount, onMounted, ref, shallowRef, watch } from 'vue';
import {
  MAX_RESOURCE_CARD_LINKS,
  RESOURCE_CARD_COMPONENT_TYPE,
  builtInComponentSets,
  isSafeResourceLinkUrl,
  nextResourceCardLinkId,
  resourceCardIconType,
  resourceCardLinks,
  resourceCardMetadataPatch,
  searchCatalogComponents,
  type ResourceCardLink,
} from '@/catalog';
import type { ComponentDefinition, ComponentSet, SketchDocument, SketchElement } from '@/domain';
import { loadOfficialLibrary, searchOfficial, type OfficialProvider } from '@/renderer/lib/official-library';
import { wrapTabFocus } from '@/renderer/lib/focus';
import AppIcon from './AppIcon.vue';
import AppSelect from './AppSelect.vue';
import SafeIcon from './SafeIcon';
import { useWhiteboard } from './use-whiteboard';

/**
 * The resource card dialog (#190): name, description, icon and links of one card. Modal, because the icon
 * grid and the link rows need more room than a popover at the selection bar has on small windows.
 */
const props = defineProps<{ element: SketchElement; document: SketchDocument }>();
const emit = defineEmits<{ saved: []; cancel: [] }>();
const store = useWhiteboard();

type IconLibrary = 'quick' | OfficialProvider;
interface IconItem { set: ComponentSet; component: ComponentDefinition }
/** More icons than this are not drawn at once; the search narrows a full provider library down. */
const ICON_LIMIT = 120;

const dialog = ref<HTMLDialogElement>();
const nameInput = ref<HTMLInputElement>();
const title = ref('');
const description = ref('');
const iconType = ref('generic.service');
/** The set of an icon picked in this dialog; a provider library's set is added to the document on save. */
const pickedSet = shallowRef<ComponentSet | null>(null);
const iconLibrary = ref<IconLibrary>('quick');
const iconQuery = ref('');
const officialSets = shallowRef<Partial<Record<OfficialProvider, ComponentSet[]>>>({});
const libraryLoading = ref(false);
const libraryError = ref(false);
const links = ref<ResourceCardLink[]>([]);
const error = ref('');
const announcement = ref('');
const busy = ref(false);
const draggedLink = ref<number | null>(null);
let closing = false;

const libraryOptions = computed(() => [
  { value: 'quick', label: t('Schnellauswahl') },
  { value: 'aws', label: 'AWS' },
  { value: 'azure', label: 'Azure' },
  { value: 'gcp', label: 'Google Cloud' },
  { value: 'kubernetes', label: 'Kubernetes' },
]);

const sets = computed(() => [
  ...props.document.componentSets,
  ...builtInComponentSets.filter((set) => !props.document.componentSets.some((existing) => existing.id === set.id)),
]);
const matches = computed<IconItem[]>(() => {
  const library = iconLibrary.value;
  const loaded = library === 'quick' ? undefined : officialSets.value[library];
  const found: IconItem[] = library === 'quick'
    ? searchCatalogComponents(sets.value, iconQuery.value, 'all')
    : loaded ? searchOfficial(loaded, iconQuery.value, ICON_LIMIT + 1) : searchCatalogComponents(sets.value, iconQuery.value, library);
  return found.filter((item) => item.component.type !== RESOURCE_CARD_COMPONENT_TYPE && Boolean(item.component.iconSvg));
});
const icons = computed(() => matches.value.slice(0, iconLibrary.value === 'quick' ? 32 : ICON_LIMIT));
const iconsCapped = computed(() => iconLibrary.value !== 'quick' && matches.value.length > ICON_LIMIT);

watch(iconLibrary, async (library) => {
  libraryError.value = false;
  if (library === 'quick' || officialSets.value[library]) return;
  libraryLoading.value = true;
  try { officialSets.value = { ...officialSets.value, [library]: await loadOfficialLibrary(library) }; }
  catch { libraryError.value = true; }
  finally { libraryLoading.value = false; }
});

function reset(): void {
  title.value = props.element.text || props.element.label || t('Ressourcenkarte');
  description.value = props.element.description ?? '';
  iconType.value = resourceCardIconType(props.element);
  pickedSet.value = null;
  links.value = resourceCardLinks(props.element).map((link) => ({ ...link }));
  iconLibrary.value = 'quick';
  iconQuery.value = '';
  error.value = '';
}
watch(() => props.element.id, reset, { immediate: true });

function pickIcon(item: IconItem): void {
  iconType.value = item.component.type;
  pickedSet.value = item.set;
}

function addLink(): void {
  if (links.value.length >= MAX_RESOURCE_CARD_LINKS) return;
  links.value.push({ id: nextResourceCardLinkId(links.value), label: '', url: 'https://' });
  const index = links.value.length - 1;
  void nextTick(() => dialog.value?.querySelector<HTMLInputElement>(`[data-testid="resource-link-row-${index}"] input`)?.focus());
}
function removeLink(index: number): void {
  links.value.splice(index, 1);
  announcement.value = t('Link {index} entfernt.', { index: index + 1 });
  void nextTick(() => {
    const row = dialog.value?.querySelector<HTMLElement>(`[data-testid="resource-link-row-${Math.min(index, links.value.length - 1)}"] .remove`);
    (row ?? dialog.value?.querySelector<HTMLElement>('.add-link'))?.focus();
  });
}
function moveLink(from: number, to: number): boolean {
  if (to < 0 || to >= links.value.length || from === to) return false;
  const next = [...links.value];
  const [link] = next.splice(from, 1);
  next.splice(to, 0, link!);
  links.value = next;
  announcement.value = t('Link an Position {position} von {count} verschoben.', { position: to + 1, count: next.length });
  return true;
}
/** The grip moves its row with the arrow keys; the focus follows the row. */
function onGripKeydown(event: KeyboardEvent, index: number): void {
  const to = event.key === 'ArrowUp' ? index - 1 : event.key === 'ArrowDown' ? index + 1 : null;
  if (to === null) return;
  event.preventDefault();
  if (moveLink(index, to)) void nextTick(() => dialog.value?.querySelector<HTMLElement>(`[data-testid="resource-link-row-${to}"] .grip`)?.focus());
}
function onGripDragStart(event: DragEvent, index: number): void {
  draggedLink.value = index;
  if (event.dataTransfer) { event.dataTransfer.effectAllowed = 'move'; event.dataTransfer.setData('text/plain', String(index)); }
}
function onRowDrop(index: number): void {
  if (draggedLink.value !== null) moveLink(draggedLink.value, index);
  draggedLink.value = null;
}

function cancel(): void {
  if (!busy.value) { closing = true; emit('cancel'); }
}
/** Keys stay in the dialog (the workspace shortcuts must not see them); Tab cycles inside it. */
function onKeydown(event: KeyboardEvent): void {
  if (dialog.value) wrapTabFocus(event, dialog.value);
}
/** Engines may close a modal without a cancel event (repeated Escape); the owner's state follows. */
function onNativeClose(): void {
  if (!closing) emit('cancel');
}
async function save(): Promise<void> {
  if (busy.value) return;
  const nextTitle = title.value.trim();
  if (!nextTitle) { error.value = t('Bitte einen Namen eingeben.'); nameInput.value?.focus(); return; }
  busy.value = true;
  try {
    const metadata = resourceCardMetadataPatch(props.element.metadata, iconType.value, links.value);
    const saved = await store.updateResourceCard(props.element.id, {
      text: nextTitle,
      label: nextTitle,
      description: description.value.trim() || null,
      metadata,
    }, pickedSet.value ?? undefined);
    if (!saved) { error.value = t('Die Ressourcenkarte konnte nicht gespeichert werden.'); return; }
    error.value = '';
    closing = true;
    emit('saved');
  } catch (cause) {
    error.value = cause instanceof Error ? tm(cause.message) : t('Die Ressourcenkarte konnte nicht gespeichert werden.');
  } finally {
    busy.value = false;
  }
}

onMounted(async () => {
  dialog.value?.showModal();
  await nextTick();
  nameInput.value?.focus();
  nameInput.value?.select();
});
onBeforeUnmount(() => { closing = true; dialog.value?.close(); });
</script>

<template>
  <dialog ref="dialog" class="resource-dialog sd-panel" aria-labelledby="resource-card-dialog-title" aria-describedby="resource-card-dialog-subtitle" @cancel.prevent="cancel" @close="onNativeClose" @keydown.stop="onKeydown">
    <form class="resource-editor" data-testid="resource-card-editor" novalidate @submit.prevent="save">
      <header class="dialog-header">
        <span class="badge badge-large" aria-hidden="true"><AppIcon name="layers" :size="24" /></span>
        <div class="dialog-heading">
          <h2 id="resource-card-dialog-title">{{ t('Ressourcenkarte') }}</h2>
          <p id="resource-card-dialog-subtitle">{{ t('Inhalt und Verweise bearbeiten') }}</p>
        </div>
        <button type="button" class="close" :aria-label="t('Dialog schließen')" :disabled="busy" @click="cancel"><AppIcon name="close" :size="18" /></button>
      </header>

      <div class="dialog-body">
        <label class="field"><span>{{ t('Name') }}</span><input ref="nameInput" v-model="title" type="text" maxlength="200" autocomplete="off" /></label>
        <label class="field"><span>{{ t('Beschreibung') }}</span><textarea v-model="description" rows="2" maxlength="500" /></label>

        <section class="icon-section" aria-labelledby="resource-card-icon-heading">
          <div class="section-head">
            <h3 id="resource-card-icon-heading">{{ t('Icon') }}</h3>
            <AppSelect v-model="iconLibrary" class="library-select" compact :options="libraryOptions" :label="t('Icon-Bibliothek')" />
          </div>
          <label class="search">
            <AppIcon name="search" :size="18" />
            <input v-model="iconQuery" type="search" :aria-label="t('Icons durchsuchen')" :placeholder="t('Icon suchen')" autocomplete="off" spellcheck="false" />
          </label>
          <p v-if="libraryLoading" class="note" role="status">{{ t('Bibliothek wird geladen …') }}</p>
          <p v-else-if="libraryError" class="note" role="alert">{{ t('Die vollständige Bibliothek konnte nicht geladen werden; es werden die Startsymbole gezeigt.') }}</p>
          <div class="icon-grid" role="group" :aria-label="t('Icon auswählen')" tabindex="-1">
            <button
              v-for="item in icons"
              :key="`${item.set.id}:${item.component.type}`"
              type="button"
              class="icon-tile"
              :class="{ selected: iconType === item.component.type }"
              :aria-label="t('Icon {name}', { name: item.component.name })"
              :aria-pressed="iconType === item.component.type"
              :title="item.component.name"
              @click="pickIcon(item)"
            >
              <span v-if="iconType === item.component.type" class="check" aria-hidden="true"><AppIcon name="check" :size="12" /></span>
              <SafeIcon :source="item.component.iconSvg" :size="30" />
              <span class="icon-name">{{ item.component.name }}</span>
            </button>
            <p v-if="!icons.length && !libraryLoading" class="note empty">{{ t('Keine passenden Symbole gefunden.') }}</p>
          </div>
          <p v-if="iconsCapped" class="note">{{ t('Die ersten {count} Symbole werden gezeigt. Die Suche grenzt weiter ein.', { count: ICON_LIMIT }) }}</p>
        </section>

        <section class="links-section" aria-labelledby="resource-card-links-heading">
          <div class="section-head">
            <span class="badge" aria-hidden="true"><AppIcon name="link" :size="18" /></span>
            <h3 id="resource-card-links-heading">{{ t('Links') }}</h3>
            <button type="button" class="add-link" :disabled="links.length >= MAX_RESOURCE_CARD_LINKS" @click="addLink"><AppIcon name="plus" :size="16" />{{ t('Link hinzufügen') }}</button>
          </div>
          <p v-if="!links.length" class="note">{{ t('Noch keine Links. Du kannst bis zu {max} hinzufügen.', { max: MAX_RESOURCE_CARD_LINKS }) }}</p>
          <div
            v-for="(link, index) in links"
            :key="link.id"
            class="link-row"
            :class="{ dragging: draggedLink === index }"
            :data-testid="`resource-link-row-${index}`"
            @dragover.prevent
            @drop.prevent="onRowDrop(index)"
          >
            <button type="button" class="grip" draggable="true" :disabled="links.length < 2" :aria-label="t('Link {index} verschieben', { index: index + 1 })" :title="t('Ziehen oder Pfeiltasten: Reihenfolge ändern')" @keydown="onGripKeydown($event, index)" @dragstart="onGripDragStart($event, index)" @dragend="draggedLink = null"><AppIcon name="grip" :size="18" /></button>
            <label class="link-label"><span>{{ t('Bezeichnung') }}</span><input v-model="link.label" type="text" maxlength="80" :aria-label="t('Link {index} Bezeichnung', { index: index + 1 })" :placeholder="t('Dokumentation')" /></label>
            <label class="link-url"><span>{{ t('Adresse') }}</span><input v-model="link.url" type="url" maxlength="2000" :aria-label="t('Link {index} Adresse', { index: index + 1 })" placeholder="https://…" /></label>
            <button type="button" class="row-action" :disabled="!isSafeResourceLinkUrl(link.url)" :aria-label="t('Link {index} öffnen', { index: index + 1 })" :title="t('Im Browser öffnen')" @click="store.openDocumentationLink(link.url)"><AppIcon name="external-link" :size="18" /></button>
            <button type="button" class="row-action remove" :aria-label="t('Link {index} entfernen', { index: index + 1 })" :title="t('Entfernen')" @click="removeLink(index)"><AppIcon name="trash" :size="18" /></button>
          </div>
        </section>
      </div>

      <p class="visually-hidden" role="status" aria-live="polite">{{ announcement }}</p>
      <footer class="dialog-footer">
        <p v-if="error" class="form-error" role="alert">{{ error }}</p>
        <button type="button" class="sd-btn footer-button" :disabled="busy" @click="cancel">{{ t('Abbrechen') }}</button>
        <button type="submit" class="sd-btn sd-btn--primary footer-button" :disabled="busy">{{ t('Änderungen speichern') }}</button>
      </footer>
    </form>
  </dialog>
</template>

<style scoped>
.resource-dialog{width:min(560px,calc(100vw - 32px));max-height:calc(100vh - 32px);padding:0;overflow:hidden;border-radius:20px;color:var(--text-primary)}
.resource-dialog[open]{display:flex}
.resource-dialog::backdrop{background:var(--scrim)}
.resource-editor{display:flex;min-height:0;width:100%;flex-direction:column}
.dialog-header{display:flex;flex:none;align-items:center;gap:14px;padding:20px 24px 14px}
.dialog-heading{flex:1;min-width:0}
.dialog-heading h2{margin:0;font-size:19px;font-weight:700;line-height:1.2}
.dialog-heading p{margin:3px 0 0;color:var(--text-muted);font-size:13px}
.badge{display:grid;flex:none;width:32px;height:32px;place-items:center;border-radius:9px;background:var(--accent-soft);color:var(--accent)}
.badge-large{width:44px;height:44px;border-radius:12px}
.close{display:grid;flex:none;width:36px;height:36px;padding:0;place-items:center;border:1px solid var(--border-subtle);border-radius:10px;background:var(--surface-panel);color:var(--text-primary);cursor:pointer}
.close:hover:not(:disabled){background:var(--surface-raised)}
.dialog-body{display:grid;flex:1;min-height:0;gap:16px;padding:6px 24px 20px;overflow-y:auto;scroll-padding:32px 0 12px}
.field{display:grid;gap:7px}
.field>span,.section-head h3{font-size:13px;font-weight:650}
.field input,.field textarea,.search,.link-row input{box-sizing:border-box;border:1px solid var(--border-default);border-radius:10px;background:var(--surface-panel);color:var(--text-primary);font:inherit;font-size:14px}
.field input{width:100%;height:44px;padding:0 14px}
.field textarea{width:100%;min-height:64px;padding:11px 14px;resize:vertical;line-height:1.4}
.field input:focus,.field textarea:focus,.link-row input:focus,.search:focus-within{border-color:var(--accent);outline:0;background:var(--accent-soft);box-shadow:0 0 0 1px var(--accent)}
.section-head{display:flex;align-items:center;gap:10px;min-height:36px}
.section-head h3{flex:1;margin:0;font-size:16px}
.library-select{flex:none;width:168px}
/* The heading "Icon" beside it already says what the select is for; its own label stays for screen readers. */
.library-select :deep(.app-field-label){position:absolute;width:1px;height:1px;margin:-1px;padding:0;overflow:hidden;clip-path:inset(50%);white-space:nowrap;border:0}
.icon-section,.links-section{display:grid;gap:10px}
.links-section{padding-top:16px;border-top:1px solid var(--border-subtle)}
.search{display:flex;align-items:center;gap:10px;height:42px;padding:0 12px;color:var(--text-muted)}
.search input{min-width:0;width:100%;height:100%;border:0;outline:0;background:transparent;color:var(--text-primary);font:inherit;font-size:14px}
.search input::placeholder{color:var(--text-muted)}
.icon-grid{display:grid;grid-template-columns:repeat(6,minmax(0,1fr));gap:8px;max-height:176px;padding:2px;overflow-y:auto}
.icon-tile{position:relative;display:flex;min-width:0;height:78px;flex-direction:column;align-items:center;justify-content:center;gap:6px;padding:8px 4px 6px;border:1px solid var(--border-subtle);border-radius:11px;background:var(--surface-panel);color:var(--text-primary);cursor:pointer}
.icon-tile:hover{border-color:var(--border-default);background:var(--surface-raised)}
.icon-tile.selected{border-color:var(--accent);background:var(--accent-soft);box-shadow:inset 0 0 0 1px var(--accent)}
.icon-name{width:100%;overflow:hidden;font-size:11px;line-height:1.2;text-align:center;text-overflow:ellipsis;white-space:nowrap}
.check{position:absolute;top:4px;right:4px;display:grid;width:16px;height:16px;place-items:center;border-radius:50%;background:var(--accent);color:var(--accent-contrast)}
.note{margin:0;color:var(--text-muted);font-size:12px;line-height:1.5}
.note.empty{grid-column:1/-1;padding:18px 0;text-align:center}
.add-link{display:inline-flex;flex:none;align-items:center;gap:6px;min-height:36px;padding:0 12px;border:1px solid transparent;border-radius:10px;background:var(--accent-soft);color:var(--accent-ink);font:inherit;font-size:13px;font-weight:650;cursor:pointer}
.add-link:hover:not(:disabled){border-color:var(--accent)}
.add-link:disabled{opacity:.45;cursor:not-allowed}
.link-row{display:grid;grid-template-columns:28px minmax(0,3fr) minmax(0,5fr) 40px 40px;align-items:end;gap:8px}
.link-row.dragging{opacity:.5}
.link-row label{display:grid;min-width:0;gap:5px}
.link-row label>span{padding-left:2px;color:var(--text-muted);font-size:11px}
.link-row input{width:100%;height:40px;padding:0 12px}
.grip,.row-action{display:grid;height:40px;padding:0;place-items:center;border:1px solid var(--border-subtle);border-radius:10px;background:var(--surface-panel);color:var(--text-primary);cursor:pointer}
.grip{border-color:transparent;background:transparent;color:var(--text-muted);cursor:grab}
.grip:active{cursor:grabbing}
.grip:disabled{opacity:.35;cursor:default}
.row-action:hover:not(:disabled),.grip:hover:not(:disabled){background:var(--surface-raised)}
.row-action:disabled{opacity:.4;cursor:not-allowed}
.row-action.remove:hover{border-color:var(--status-error);color:var(--status-error)}
.close:focus-visible,.icon-tile:focus-visible,.add-link:focus-visible,.grip:focus-visible,.row-action:focus-visible{outline:2px solid var(--accent);outline-offset:2px}
.dialog-footer{display:flex;flex:none;flex-wrap:wrap;align-items:center;justify-content:flex-end;gap:10px;padding:14px 24px 20px;border-top:1px solid var(--border-subtle);background:var(--surface-panel)}
.form-error{flex:1 1 100%;margin:0;color:var(--status-error);font-size:12px}
.footer-button{min-height:42px;padding:0 18px;border-radius:10px;font-size:14px}
@media(max-width:560px){
  .dialog-header{padding:16px 16px 12px}.dialog-body{padding:4px 16px 16px}.dialog-footer{padding:12px 16px 16px}
  .icon-grid{grid-template-columns:repeat(4,minmax(0,1fr))}
  .link-row{grid-template-columns:28px minmax(0,1fr) 40px 40px}.link-row .link-label{grid-column:2}.link-row .link-url{grid-column:1/-1;grid-row:2}
  .library-select{width:140px}
}
@media(forced-colors:active){.icon-tile.selected{outline:2px solid Highlight}}
</style>

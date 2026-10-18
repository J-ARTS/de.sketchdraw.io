<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import {
  MAX_RESOURCE_CARD_LINKS,
  builtInComponentSets,
  isSafeResourceLinkUrl,
  nextResourceCardLinkId,
  resourceCardIconType,
  resourceCardLinks,
  resourceCardMetadataPatch,
  searchCatalogComponents,
  type ResourceCardLink,
} from '@/catalog';
import type { SketchDocument, SketchElement } from '@/domain';
import SafeIcon from './SafeIcon';
import { useWhiteboard } from './use-whiteboard';

const props = defineProps<{ element: SketchElement; document: SketchDocument }>();
const emit = defineEmits<{ saved: []; cancel: [] }>();
const store = useWhiteboard();
const title = ref('');
const description = ref('');
const iconType = ref('generic.service');
const iconQuery = ref('');
const links = ref<ResourceCardLink[]>([]);
const error = ref('');

const sets = computed(() => [
  ...props.document.componentSets,
  ...builtInComponentSets.filter((set) => !props.document.componentSets.some((existing) => existing.id === set.id)),
]);
const icons = computed(() => searchCatalogComponents(sets.value, iconQuery.value, 'all')
  .filter((item) => item.component.type !== 'generic.resource-card' && Boolean(item.component.iconSvg))
  .slice(0, 32));

function reset(): void {
  title.value = props.element.text || props.element.label || 'Ressourcenkarte';
  description.value = props.element.description ?? '';
  iconType.value = resourceCardIconType(props.element);
  links.value = resourceCardLinks(props.element).map((link) => ({ ...link }));
  iconQuery.value = '';
  error.value = '';
}

watch(() => props.element.id, reset, { immediate: true });

function addLink(): void {
  if (links.value.length >= MAX_RESOURCE_CARD_LINKS) return;
  links.value.push({ id: nextResourceCardLinkId(links.value), label: '', url: 'https://' });
}
function removeLink(index: number): void {
  links.value.splice(index, 1);
}
function save(): void {
  const nextTitle = title.value.trim();
  if (!nextTitle) { error.value = 'Bitte einen Namen eingeben.'; return; }
  try {
    const metadata = resourceCardMetadataPatch(props.element.metadata, iconType.value, links.value);
    store.applyPatch({
      text: nextTitle,
      label: nextTitle,
      description: description.value.trim() || null,
      metadata,
    });
    error.value = '';
    emit('saved');
  } catch (cause) {
    error.value = cause instanceof Error ? cause.message : 'Die Ressourcenkarte konnte nicht gespeichert werden.';
  }
}
</script>

<template>
  <form class="resource-editor" data-testid="resource-card-editor" @submit.prevent="save">
    <header>
      <div><strong>Ressourcenkarte</strong><span>Inhalt und Verweise bearbeiten</span></div>
    </header>

    <label class="field"><span>Name</span><input v-model="title" type="text" maxlength="200" autocomplete="off" /></label>
    <label class="field"><span>Beschreibung</span><textarea v-model="description" rows="2" maxlength="500" /></label>

    <fieldset>
      <legend>Icon</legend>
      <input v-model="iconQuery" class="icon-search" type="search" aria-label="Icons durchsuchen" placeholder="Icon suchen" autocomplete="off" />
      <div class="icon-grid" role="group" aria-label="Icon auswählen">
        <button
          v-for="item in icons"
          :key="`${item.set.id}:${item.component.type}`"
          type="button"
          :class="{ selected: iconType === item.component.type }"
          :aria-label="`Icon ${item.component.name}`"
          :aria-pressed="iconType === item.component.type"
          :title="item.component.name"
          @click="iconType = item.component.type"
        ><SafeIcon :source="item.component.iconSvg" :size="28" /><span>{{ item.component.name }}</span></button>
      </div>
    </fieldset>

    <fieldset class="links-fieldset">
      <legend class="visually-hidden">Links</legend>
      <div class="legend-row"><strong>Links</strong><button type="button" class="add-link" :disabled="links.length >= MAX_RESOURCE_CARD_LINKS" @click="addLink">+ Link hinzufügen</button></div>
      <p v-if="!links.length" class="empty-links">Noch keine Links. Du kannst bis zu {{ MAX_RESOURCE_CARD_LINKS }} hinzufügen.</p>
      <div v-for="(link, index) in links" :key="link.id" class="link-row" :data-testid="`resource-link-row-${index}`">
        <label><span>Bezeichnung</span><input v-model="link.label" type="text" maxlength="80" :aria-label="`Link ${index + 1} Bezeichnung`" placeholder="Dokumentation" /></label>
        <label><span>Adresse</span><input v-model="link.url" type="url" maxlength="2000" :aria-label="`Link ${index + 1} Adresse`" placeholder="https://…" /></label>
        <button v-if="isSafeResourceLinkUrl(link.url)" type="button" class="row-action" :aria-label="`Link ${index + 1} öffnen`" @click="store.openDocumentationLink(link.url)">↗</button>
        <button type="button" class="row-action remove" :aria-label="`Link ${index + 1} entfernen`" @click="removeLink(index)">×</button>
      </div>
    </fieldset>

    <p v-if="error" class="form-error" role="alert">{{ error }}</p>
    <footer><button type="button" class="sd-btn" @click="emit('cancel')">Abbrechen</button><button type="submit" class="sd-btn primary">Speichern</button></footer>
  </form>
</template>

<style scoped>
.resource-editor{display:grid;width:min(420px,calc(100vw - 32px));gap:14px;padding:18px;color:var(--text-primary)}
header div{display:grid;gap:2px}header strong{font-size:16px}header span,.field>span,.link-row label>span{color:var(--text-muted);font-size:11px}.field{display:grid;gap:6px}.field input,.field textarea,.icon-search,.link-row input{width:100%;box-sizing:border-box;border:1px solid var(--border-default);border-radius:8px;background:var(--surface-raised);color:var(--text-primary);font:inherit}.field input,.icon-search,.link-row input{height:36px;padding:0 10px}.field textarea{padding:9px 10px;resize:vertical}fieldset{min-width:0;margin:0;padding:0;border:0}legend{font-size:12px;font-weight:700}.icon-search{margin:8px 0}.icon-grid{display:grid;grid-template-columns:repeat(6,minmax(0,1fr));max-height:150px;gap:5px;overflow:auto}.icon-grid button{display:grid;min-width:0;min-height:58px;place-items:center;gap:2px;padding:5px;border:1px solid var(--border-subtle);border-radius:8px;background:var(--surface-raised);color:var(--text-primary);cursor:pointer}.icon-grid button:hover,.icon-grid button:focus-visible,.icon-grid button.selected{border-color:var(--accent);background:var(--accent-soft)}.icon-grid span{width:100%;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:8px}.legend-row{display:flex;align-items:center;justify-content:space-between}.legend-row strong{font-size:12px}.add-link{border:0;background:transparent;color:var(--accent);font-size:11px;font-weight:700;cursor:pointer}.add-link:disabled{color:var(--text-muted);cursor:not-allowed}.empty-links{margin:8px 0 0;color:var(--text-muted);font-size:11px}.link-row{display:grid;grid-template-columns:minmax(85px,.7fr) minmax(130px,1.3fr) 30px 30px;align-items:end;gap:6px;margin-top:8px}.link-row label{display:grid;min-width:0;gap:4px}.row-action{height:36px;border:1px solid var(--border-default);border-radius:8px;background:var(--surface-raised);color:var(--accent);cursor:pointer}.row-action.remove{color:var(--status-error)}.form-error{margin:0;color:var(--status-error);font-size:11px}footer{display:flex;justify-content:flex-end;gap:8px}.primary{border-color:var(--accent);background:var(--accent);color:var(--accent-contrast)}.visually-hidden{position:absolute;width:1px;height:1px;padding:0;margin:-1px;overflow:hidden;clip:rect(0,0,0,0);white-space:nowrap;border:0}@media(max-width:520px){.icon-grid{grid-template-columns:repeat(5,minmax(0,1fr))}.link-row{grid-template-columns:1fr 30px 30px}.link-row label:first-child{grid-column:1/-1}.link-row label:nth-child(2){grid-column:1/2}}
</style>

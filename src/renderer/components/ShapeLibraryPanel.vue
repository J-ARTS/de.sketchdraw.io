<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, reactive, ref, shallowRef, watch } from 'vue';
import { RESOURCE_CARD_COMPONENT_TYPE, builtInComponentSets, searchCatalogComponents, type CatalogSearchResult } from '@/catalog';
import type { ComponentDefinition, ComponentSet, ShapeVariant } from '@/domain';
import { loadAllOfficialLibraries, loadOfficialLibrary, officialIconCount, searchOfficial, type OfficialProvider } from '@/renderer/lib/official-library';
import { matchesShape, SHAPE_CATALOG, type ShapeEntry } from '@/renderer/lib/shapes';
import { useShapeToolbarState } from '@/renderer/lib/shape-toolbar-state';
import { beginComponentDrag, clearComponentDrag, COMPONENT_DRAG_MIME } from '@/renderer/lib/component-drag';
import AppIcon from './AppIcon.vue';
import SafeIcon from './SafeIcon';
import { useWhiteboard } from './use-whiteboard';

const store = useWhiteboard();
const s = store.state;
const toolbarState = useShapeToolbarState();
const query = ref('');
const activeLibrary = ref<ComponentDefinition['provider'] | null>(null);
const searchInput = ref<HTMLInputElement | null>(null);
const opener = ref<HTMLElement | null>(null);
const expanded = reactive<Record<string, boolean>>({
  connectors: false,
  basic: true,
  flowchart: false,
  advanced: true,
  architecture: false,
});

const shapeGroups: ReadonlyArray<{ id: string; label: string; variants: readonly ShapeVariant[] }> = [
  { id: 'basic', label: 'Grundformen', variants: ['square', 'circle', 'diamond', 'triangle', 'triangle-down', 'rounded'] },
  { id: 'flowchart', label: 'Flussdiagramm', variants: ['chevron', 'process', 'document', 'documents', 'manual-input', 'parallelogram', 'parallelogram-reverse', 'off-page', 'loop-limit'] },
  { id: 'advanced', label: 'Erweitert', variants: ['hexagon', 'cylinder', 'tube', 'internal-storage', 'trapezoid', 'summing', 'or', 'folder', 'note', 'pentagon'] },
];

const providers: ReadonlyArray<{ id: ComponentDefinition['provider']; label: string }> = [
  { id: 'aws', label: 'AWS' },
  { id: 'azure', label: 'Azure' },
  { id: 'gcp', label: 'Google Cloud' },
  { id: 'kubernetes', label: 'Kubernetes' },
];

const sets = computed(() => [
  ...s.document.componentSets,
  ...builtInComponentSets.filter((set) => !s.document.componentSets.some((existing) => existing.id === set.id)),
]);

// Full official libraries (#92) load on demand; the 8-icon starter sets only fill the gap while loading.
const SEARCH_LIMIT = 120;
const OFFICIAL_SET = /^sketchdraw\.(aws|azure|gcp|kubernetes)(\.|$)/;
const officialSets = shallowRef<Partial<Record<OfficialProvider, ComponentSet[]>>>({});
const officialAll = shallowRef<ComponentSet[] | null>(null);
const libraryLoading = ref(false);
const libraryError = ref(false);
const expandedCategories = reactive<Record<string, boolean>>({});
const scroller = ref<HTMLElement | null>(null);
watch(activeLibrary, async (provider) => {
  libraryError.value = false;
  if (scroller.value) scroller.value.scrollTop = 0;
  if (!provider || provider === 'generic' || provider === 'custom' || officialSets.value[provider]) return;
  libraryLoading.value = true;
  try { officialSets.value = { ...officialSets.value, [provider]: await loadOfficialLibrary(provider) }; }
  catch { libraryError.value = true; }
  finally { libraryLoading.value = false; }
});
const searching = computed(() => query.value.trim().length > 0);
watch(searching, async (active) => {
  if (!active || officialAll.value) return;
  try { officialAll.value = await loadAllOfficialLibraries(); } catch { /* starter sets stay searchable */ }
});
const allComponents = computed(() => {
  const official = officialAll.value;
  const base = searchCatalogComponents(official ? sets.value.filter((set) => !OFFICIAL_SET.test(set.id)) : sets.value, query.value, 'all');
  return official ? [...base, ...searchOfficial(official, query.value, SEARCH_LIMIT)] : base;
});
const allComponentsCapped = computed(() => Boolean(officialAll.value) && allComponents.value.length >= SEARCH_LIMIT);
const genericComponents = computed(() => searchCatalogComponents(sets.value, query.value, 'generic'));
const libraryComponents = computed(() => {
  const provider = activeLibrary.value;
  if (!provider) return [];
  const loaded = officialSets.value[provider as OfficialProvider];
  if (!loaded) return searchCatalogComponents(sets.value, query.value, provider);
  const own = s.document.componentSets.filter((set) => !OFFICIAL_SET.test(set.id));
  return [...searchOfficial(loaded, query.value), ...searchCatalogComponents(own, query.value, provider)];
});
const filteredShapes = computed(() => SHAPE_CATALOG.filter((entry) => matchesShape(entry, query.value)));
const annotationMatches = computed(() => {
  const needle = query.value.trim().toLocaleLowerCase('de');
  return !needle || ['annotation', 'textblock', 'dokumentation', 'kommentar', 'rich text'].some((term) => term.includes(needle));
});
const tableMatches = computed(() => {
  const needle = query.value.trim().toLocaleLowerCase('de');
  return !needle || ['tabelle', 'table', 'grid', 'zellen', 'zeilen', 'spalten'].some((term) => term.includes(needle));
});
const libraryLabel = computed(() => providers.find((entry) => entry.id === activeLibrary.value)?.label ?? 'Bibliothek');
const groupedLibraryComponents = computed(() => {
  const groups = new Map<string, CatalogSearchResult[]>();
  for (const item of libraryComponents.value) {
    const current = groups.get(item.component.category) ?? [];
    current.push(item);
    groups.set(item.component.category, current);
  }
  return [...groups.entries()].map(([category, items]) => ({ category, items }));
});
/** Categories start collapsed except the first; a search opens every matching category. */
function categoryOpen(category: string, index: number): boolean {
  return searching.value || (expandedCategories[category] ?? index === 0);
}
function toggleCategory(category: string, index: number): void {
  expandedCategories[category] = !categoryOpen(category, index);
}
function providerCount(provider: ComponentDefinition['provider']): number {
  return officialIconCount(provider as OfficialProvider) || providerItems(provider).length;
}

function entriesFor(group: (typeof shapeGroups)[number]): ShapeEntry[] {
  const allowed = new Set(group.variants);
  return SHAPE_CATALOG.filter((entry) => allowed.has(entry.id));
}
function providerItems(provider: ComponentDefinition['provider']): CatalogSearchResult[] {
  return searchCatalogComponents(sets.value, '', provider);
}
function providerPreview(provider: ComponentDefinition['provider']): string | undefined {
  return providerItems(provider)[0]?.component.iconSvg;
}
function toggleSection(id: string): void {
  expanded[id] = !expanded[id];
}
function close(): void {
  toolbarState.stopEditing();
  store.setCatalogOpen(false);
}
function activateShape(entry: ShapeEntry): void {
  if (toolbarState.editing.value) {
    toolbarState.addFavorite(entry.id);
    return;
  }
  store.setShapeTool(entry.id);
  store.setCatalogOpen(false);
}
function activateConnector(): void {
  store.setTool('connector');
  store.setCatalogOpen(false);
}
function activateAnnotation(): void {
  store.setTool('annotation');
  store.setCatalogOpen(false);
}
function activateTable(): void {
  store.setTool('table');
  store.setCatalogOpen(false);
}
function activateComponent(item: CatalogSearchResult): void {
  store.insertComponent(item.set, item.component.type);
}
function dragComponent(event: DragEvent, item: CatalogSearchResult): void {
  beginComponentDrag({ set: item.set, type: item.component.type });
  event.dataTransfer?.setData(COMPONENT_DRAG_MIME, item.component.type);
  if (event.dataTransfer) event.dataTransfer.effectAllowed = 'copy';
}
function dragShape(event: DragEvent, entry: ShapeEntry): void {
  event.dataTransfer?.setData('text/x-sketchdraw-shape', entry.id);
  if (event.dataTransfer) event.dataTransfer.effectAllowed = 'copy';
}
function toggleEditing(): void {
  if (toolbarState.editing.value) toolbarState.stopEditing();
  else toolbarState.startEditing();
}
function onKeydown(event: KeyboardEvent): void {
  if (event.key !== 'Escape') return;
  event.preventDefault();
  event.stopPropagation();
  close();
}

onMounted(async () => {
  opener.value = document.activeElement instanceof HTMLElement ? document.activeElement : null;
  await nextTick();
  searchInput.value?.focus();
});
onBeforeUnmount(() => {
  const target = opener.value;
  if (target?.isConnected) queueMicrotask(() => target.focus());
});
</script>

<template>
  <aside id="shape-library-panel" class="shape-library sd-panel" aria-label="Formen und Komponenten" data-testid="shape-library-sidebar" @keydown="onKeydown">
    <header class="library-header">
      <div class="library-title-row">
        <button v-if="activeLibrary" type="button" class="header-action" aria-label="Zurück zu allen Formen" @click="activeLibrary = null"><span aria-hidden="true">←</span></button>
        <h2>{{ activeLibrary ? libraryLabel : 'Formen' }}</h2>
        <button type="button" class="header-action close-button" aria-label="Formen schließen" @click="close">×</button>
      </div>
      <label class="library-search">
        <AppIcon name="search" :size="20" />
        <span class="visually-hidden">Formen durchsuchen</span>
        <input ref="searchInput" v-model="query" type="search" aria-label="Formen durchsuchen" placeholder="Formen durchsuchen" autocomplete="off" spellcheck="false" />
      </label>
      <div class="customize-row">
        <p v-if="toolbarState.editing.value">Form anklicken oder in die obere Leiste ziehen.</p>
        <span v-else>Lieblingsformen direkt in der oberen Leiste ablegen.</span>
        <button type="button" :aria-pressed="toolbarState.editing.value" @click="toggleEditing">{{ toolbarState.editing.value ? 'Fertig' : 'Leiste anpassen' }}</button>
      </div>
    </header>

    <div ref="scroller" class="library-scroll">
      <template v-if="activeLibrary">
        <p v-if="libraryLoading" class="empty-state" role="status">Bibliothek wird geladen …</p>
        <p v-if="libraryError" class="empty-state" role="alert">Die vollständige Bibliothek konnte nicht geladen werden; es werden die Startsymbole gezeigt.</p>
        <section v-for="(group, index) in groupedLibraryComponents" :key="group.category" class="component-group">
          <h3><button type="button" class="category-toggle" :aria-expanded="categoryOpen(group.category, index)" @click="toggleCategory(group.category, index)"><span>{{ group.category }}</span><span class="category-count">{{ group.items.length }}</span><span class="category-chevron" aria-hidden="true">⌄</span></button></h3>
          <div v-if="categoryOpen(group.category, index)" class="component-grid">
            <button v-for="item in group.items" :key="`${item.set.id}:${item.component.type}`" type="button" class="component-tile" :class="{ 'resource-card-tile': item.component.type === RESOURCE_CARD_COMPONENT_TYPE }" :disabled="s.transitioning || !s.canWrite" draggable="true" @click="activateComponent(item)" @dragstart="dragComponent($event, item)" @dragend="clearComponentDrag">
              <span v-if="item.component.type === RESOURCE_CARD_COMPONENT_TYPE" class="resource-card-preview" aria-hidden="true"><SafeIcon :source="item.component.iconSvg" :size="28" /><span><b>Resource Name</b><small>Description</small></span></span>
              <SafeIcon v-else :source="item.component.iconSvg" :size="42" />
              <span>{{ item.component.name }}</span>
              <small>{{ item.component.provider === 'gcp' ? 'GCP' : item.component.provider.toUpperCase() }}</small>
            </button>
          </div>
        </section>
        <p v-if="!libraryComponents.length && !libraryLoading" class="empty-state">Keine passenden Symbole gefunden.</p>
      </template>

      <template v-else-if="searching">
        <section class="search-results">
          <h3 v-if="annotationMatches || tableMatches || filteredShapes.length">Formen</h3>
          <div class="shape-grid">
            <button v-if="annotationMatches" type="button" class="shape-tile" :disabled="!s.canWrite" aria-label="Annotation" @click="activateAnnotation"><AppIcon name="annotation" :size="30" /><span>Annotation</span></button>
            <button v-if="tableMatches" type="button" class="shape-tile" :disabled="!s.canWrite" aria-label="Tabelle" @click="activateTable"><AppIcon name="table" :size="30" /><span>Tabelle</span></button>
            <button v-for="entry in filteredShapes" :key="entry.id" type="button" class="shape-tile" :class="{ favorite: toolbarState.favorites.value.includes(entry.id) }" draggable="true" :aria-label="`${entry.label}${toolbarState.favorites.value.includes(entry.id) ? ', in der Leiste' : ''}`" @click="activateShape(entry)" @dragstart="dragShape($event, entry)">
              <svg viewBox="0 0 24 24" aria-hidden="true"><path v-for="path in entry.icon" :key="path" :d="path" /></svg>
              <span>{{ entry.label }}</span><span v-if="toolbarState.favorites.value.includes(entry.id)" class="favorite-mark" aria-hidden="true">✓</span>
            </button>
          </div>
          <h3>Architektur</h3>
          <div class="component-grid search-components">
            <button v-for="item in allComponents" :key="`${item.set.id}:${item.component.type}`" type="button" class="component-tile" :class="{ 'resource-card-tile': item.component.type === RESOURCE_CARD_COMPONENT_TYPE }" :disabled="s.transitioning || !s.canWrite" draggable="true" @click="activateComponent(item)" @dragstart="dragComponent($event, item)" @dragend="clearComponentDrag">
              <span v-if="item.component.type === RESOURCE_CARD_COMPONENT_TYPE" class="resource-card-preview" aria-hidden="true"><SafeIcon :source="item.component.iconSvg" :size="28" /><span><b>Resource Name</b><small>Description</small></span></span>
              <SafeIcon v-else :source="item.component.iconSvg" :size="40" /><span>{{ item.component.name }}</span><small>{{ item.component.provider.toUpperCase() }}</small>
            </button>
          </div>
          <p v-if="allComponentsCapped" class="empty-state">Die ersten {{ SEARCH_LIMIT }} Treffer werden gezeigt. Weitere findest du in der jeweiligen Bibliothek.</p>
          <p v-if="!annotationMatches && !tableMatches && !filteredShapes.length && !allComponents.length" class="empty-state">Keine Form oder Komponente gefunden.</p>
        </section>
      </template>

      <template v-else>
        <section class="accordion-section">
          <button type="button" class="accordion-trigger" :aria-expanded="expanded.connectors" aria-controls="shape-section-connectors" @click="toggleSection('connectors')"><span>Verbinder</span><span aria-hidden="true">⌄</span></button>
          <div v-if="expanded.connectors" id="shape-section-connectors" class="shape-grid">
            <button type="button" class="shape-tile" :disabled="!s.canWrite" @click="activateConnector"><AppIcon name="connector" :size="28" /><span>Verbinder</span></button>
          </div>
        </section>
        <section v-for="group in shapeGroups" :key="group.id" class="accordion-section">
          <button type="button" class="accordion-trigger" :aria-expanded="expanded[group.id]" :aria-controls="`shape-section-${group.id}`" @click="toggleSection(group.id)"><span>{{ group.label }}</span><span aria-hidden="true">⌄</span></button>
          <div v-if="expanded[group.id]" :id="`shape-section-${group.id}`" class="shape-grid">
            <button v-if="group.id === 'basic'" type="button" class="shape-tile" :disabled="!s.canWrite" aria-label="Annotation" @click="activateAnnotation"><AppIcon name="annotation" :size="30" /><span>Annotation</span></button>
            <button v-if="group.id === 'basic'" type="button" class="shape-tile" :disabled="!s.canWrite" aria-label="Tabelle" @click="activateTable"><AppIcon name="table" :size="30" /><span>Tabelle</span></button>
            <button v-for="entry in entriesFor(group)" :key="entry.id" type="button" class="shape-tile" :class="{ favorite: toolbarState.favorites.value.includes(entry.id) }" draggable="true" :aria-label="`${entry.label}${toolbarState.favorites.value.includes(entry.id) ? ', in der Leiste' : ''}`" @click="activateShape(entry)" @dragstart="dragShape($event, entry)">
              <svg viewBox="0 0 24 24" aria-hidden="true"><path v-for="path in entry.icon" :key="path" :d="path" /></svg>
              <span>{{ entry.label }}</span><span v-if="toolbarState.favorites.value.includes(entry.id)" class="favorite-mark" aria-hidden="true">✓</span>
            </button>
          </div>
        </section>
        <section class="accordion-section">
          <button type="button" class="accordion-trigger" :aria-expanded="expanded.architecture" aria-controls="shape-section-architecture" @click="toggleSection('architecture')"><span>Architektur</span><span aria-hidden="true">⌄</span></button>
          <div v-if="expanded.architecture" id="shape-section-architecture" class="component-grid">
            <button v-for="item in genericComponents" :key="`${item.set.id}:${item.component.type}`" type="button" class="component-tile" :class="{ 'resource-card-tile': item.component.type === RESOURCE_CARD_COMPONENT_TYPE }" :disabled="s.transitioning || !s.canWrite" draggable="true" @click="activateComponent(item)" @dragstart="dragComponent($event, item)" @dragend="clearComponentDrag"><span v-if="item.component.type === RESOURCE_CARD_COMPONENT_TYPE" class="resource-card-preview" aria-hidden="true"><SafeIcon :source="item.component.iconSvg" :size="28" /><span><b>Resource Name</b><small>Description</small></span></span><SafeIcon v-else :source="item.component.iconSvg" :size="38" /><span>{{ item.component.name }}</span><small>{{ item.component.category }}</small></button>
          </div>
        </section>

        <section class="other-libraries" aria-labelledby="other-libraries-heading">
          <h3 id="other-libraries-heading">Weitere Bibliotheken</h3>
          <button v-for="providerItem in providers" :key="providerItem.id" type="button" class="provider-row" @click="activeLibrary = providerItem.id">
            <span class="provider-logo"><SafeIcon :source="providerPreview(providerItem.id)" :size="48" /></span>
            <span><strong>{{ providerItem.label }}</strong><small>{{ providerCount(providerItem.id) }} Symbole</small></span>
            <span aria-hidden="true">›</span>
          </button>
        </section>
      </template>
    </div>

    <footer v-if="toolbarState.editing.value" class="library-footer">
      <button type="button" class="reset-button" @click="toolbarState.resetFavorites">Standard wiederherstellen</button>
    </footer>
  </aside>
</template>

<style scoped>
.shape-library{position:absolute;z-index:22;top:var(--panel-top);right:18px;bottom:18px;width:min(420px,calc(100vw - 36px));display:flex;flex-direction:column;overflow:hidden;border-radius:22px;box-shadow:var(--shadow-panel)}
.library-header{flex:none;padding:8px 24px 12px;border-bottom:1px solid var(--border-subtle);background:var(--surface-panel)}
.library-title-row{display:flex;align-items:center;gap:10px;margin-bottom:8px}.library-title-row h2{font-size:24px;line-height:1.2;font-weight:700}.close-button{margin-left:auto}.header-action{display:grid;width:36px;height:36px;padding:0;place-items:center;border:0;border-radius:10px;background:transparent;color:var(--text-primary);font-size:28px;line-height:1;cursor:pointer}.header-action:hover{background:var(--surface-raised)}
.library-search{display:flex;align-items:center;gap:10px;height:48px;padding:0 12px;border:1px solid transparent;border-radius:12px;background:var(--surface-raised);color:var(--text-muted)}.library-search:focus-within{border-color:var(--accent)}.library-search input{min-width:0;width:100%;height:100%;border:0;outline:0;background:transparent;color:var(--text-primary);font:inherit;font-size:16px}.library-search input::placeholder{color:var(--text-muted)}
.customize-row{display:flex;align-items:center;gap:8px;margin-top:12px;color:var(--text-muted);font-size:11px}.customize-row p,.customize-row span{flex:1;margin:0}.customize-row button,.reset-button{flex:none;min-height:34px;padding:0 10px;border:1px solid var(--border-subtle);border-radius:9px;background:var(--surface-raised);color:var(--text-primary);cursor:pointer}.customize-row button[aria-pressed=true]{border-color:var(--accent);color:var(--accent);background:var(--accent-soft)}
.library-scroll{flex:1;min-height:0;overflow:auto;background:var(--surface-panel)}.accordion-section{border-bottom:1px solid var(--border-subtle)}.accordion-trigger{display:flex;align-items:center;justify-content:space-between;width:100%;min-height:66px;padding:0 24px;border:0;background:transparent;color:var(--text-primary);font-size:17px;font-weight:650;text-align:left;cursor:pointer}.accordion-trigger:hover{background:var(--surface-raised)}.accordion-trigger>span:last-child{font-size:24px;transition:transform .16s ease}.accordion-trigger[aria-expanded=true]>span:last-child{transform:rotate(180deg)}
.shape-grid{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:8px;padding:0 20px 18px}.shape-tile{position:relative;display:flex;min-width:0;min-height:78px;flex-direction:column;align-items:center;justify-content:center;gap:7px;padding:8px 4px;border:1px solid transparent;border-radius:11px;background:transparent;color:var(--text-primary);font-size:10px;text-align:center;cursor:pointer}.shape-tile:hover,.shape-tile:focus-visible{border-color:var(--border-subtle);background:var(--surface-raised)}.shape-tile.favorite{color:var(--accent)}.shape-tile svg{width:30px;height:30px;fill:none;stroke:currentColor;stroke-width:1.7;stroke-linecap:round;stroke-linejoin:round}.favorite-mark{position:absolute;top:4px;right:7px;font-weight:700}
.component-group,.search-results{padding:20px 20px 4px}.component-group h3,.search-results h3{margin:0 4px 12px;font-size:13px;color:var(--text-muted);text-transform:uppercase;letter-spacing:.04em}.component-group{padding-top:8px;padding-bottom:0;border-bottom:1px solid var(--border-subtle)}.component-group h3{margin:0}.category-toggle{display:flex;align-items:center;gap:8px;width:100%;min-height:44px;padding:0 4px;border:0;border-radius:8px;background:transparent;color:inherit;font:inherit;letter-spacing:inherit;text-align:left;text-transform:inherit;cursor:pointer}.category-toggle:hover{color:var(--text-primary)}.category-toggle>span:first-child{flex:1}.category-count{min-width:24px;padding:1px 7px;border-radius:999px;background:var(--surface-raised);font-size:11px;text-align:center}.category-chevron{font-size:18px;transition:transform .16s ease}.category-toggle[aria-expanded=true] .category-chevron{transform:rotate(180deg)}
.component-grid{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:8px;padding:0 20px 18px}.component-group .component-grid{padding:0 0 16px}.search-results .component-grid{padding:0}.component-tile{display:flex;min-width:0;min-height:112px;flex-direction:column;align-items:center;justify-content:center;gap:6px;padding:10px 7px;border:1px solid var(--border-subtle);border-radius:12px;background:var(--surface-raised);color:var(--text-primary);text-align:center;cursor:grab}.component-tile:active{cursor:grabbing}.component-tile:hover,.component-tile:focus-visible{border-color:var(--accent);background:var(--accent-soft)}.component-tile span{width:100%;overflow:hidden;text-overflow:ellipsis;font-size:11px;font-weight:650}.component-tile small{font-size:9px;color:var(--text-muted)}.search-components{margin-bottom:16px}
.component-grid .resource-card-tile{grid-column:1/-1;min-height:126px;padding:10px}.resource-card-preview{display:grid!important;grid-template-columns:38px minmax(0,1fr);align-items:center;gap:10px;width:100%!important;min-height:62px;padding:10px 10px 18px;box-sizing:border-box;border:1px solid var(--border-default);border-radius:7px;background:var(--surface-panel);box-shadow:inset 0 -10px var(--accent-soft);text-align:left}.resource-card-preview>span{display:grid;gap:3px;font-size:12px!important}.resource-card-preview b{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.resource-card-preview small{text-transform:uppercase}
.other-libraries{padding:20px 0;border-top:1px solid var(--border-subtle)}.other-libraries h3{padding:0 24px 12px;font-size:16px}.provider-row{display:grid;grid-template-columns:62px 1fr auto;align-items:center;gap:12px;width:100%;min-height:82px;padding:10px 24px;border:0;background:transparent;color:var(--text-primary);text-align:left;cursor:pointer}.provider-row:hover{background:var(--surface-raised)}.provider-logo{display:grid;width:58px;height:58px;place-items:center;border-radius:11px;background:var(--surface-raised)}.provider-row strong,.provider-row small{display:block}.provider-row strong{font-size:15px}.provider-row small{margin-top:4px;color:var(--text-muted);font-size:13px}.provider-row>span:last-child{font-size:25px;color:var(--text-muted)}
.empty-state{padding:18px 24px;color:var(--text-muted);font-size:11px;line-height:1.5}.library-footer{flex:none;display:grid;gap:10px;padding:12px 20px;border-top:1px solid var(--border-subtle);background:var(--surface-panel)}.reset-button{justify-self:start}.visually-hidden{position:absolute;width:1px;height:1px;padding:0;margin:-1px;overflow:hidden;clip:rect(0,0,0,0);white-space:nowrap;border:0}
@media(max-width:760px){.shape-library{right:12px;bottom:12px;width:calc(100vw - 24px)}.library-header{padding:8px 16px 12px}.shape-grid{grid-template-columns:repeat(3,minmax(0,1fr));padding-inline:14px}.component-grid{padding-inline:14px}.provider-row{padding-inline:16px}}
@media(prefers-reduced-motion:reduce){.accordion-trigger>span:last-child{transition:none}}
@media(forced-colors:active){.shape-tile.favorite{outline:2px solid Highlight}.customize-row button[aria-pressed=true]{outline:2px solid Highlight}}
</style>

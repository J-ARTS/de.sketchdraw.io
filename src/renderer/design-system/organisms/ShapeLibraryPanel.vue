<!-- @component The shape library: basic shapes, cloud components, diagram libraries and the user's own components. -->
<script setup lang="ts">
import { L, t } from '@/renderer/i18n';
import { computed, nextTick, onBeforeUnmount, onMounted, reactive, ref, shallowRef, watch } from 'vue';
import { ISOMETRIC_SET_ID, RESOURCE_CARD_COMPONENT_TYPE, RESOURCE_CARD_LOOKS, builtInComponentSets, resourceCardLookPatch, searchCatalogComponents, type CatalogSearchResult, type ResourceCardLook } from '@/catalog';
import type { ComponentDefinition, ComponentSet, ElementPatch, ShapeVariant } from '@/domain';
import { loadAllOfficialLibraries, loadOfficialLibrary, officialIconCount, searchOfficial, type OfficialProvider } from '@/renderer/lib/official-library';
import { matchesShape, SHAPE_CATALOG, type ShapeEntry } from '@/renderer/lib/shapes';
import { useShapeToolbarState } from '@/renderer/lib/shape-toolbar-state';
import { beginComponentDrag, clearComponentDrag, COMPONENT_DRAG_MIME } from '@/renderer/lib/component-drag';
import { useCustomComponents } from '@/renderer/lib/custom-components';
import { DIAGRAM_LIBRARIES, diagramLibrary, type DiagramLibraryId } from '@/renderer/lib/diagram-libraries';
import AppIcon from '@/renderer/design-system/atoms/AppIcon.vue';
import CustomComponentsTab from '@/renderer/design-system/organisms/CustomComponentsTab.vue';
import DiagramLibraryView from '@/renderer/design-system/organisms/DiagramLibraryView.vue';
import SafeIcon from '@/renderer/design-system/atoms/SafeIcon';
import { isLucideComponent, LUCIDE_SET_PREFIX } from '@/catalog/lucide-sets';
import { loadLucideLibrary, lucideIconCount } from '@/renderer/lib/lucide-library';
import { useWhiteboard } from '@/renderer/design-system/composables/use-whiteboard';

const store = useWhiteboard();
const s = store.state;
const toolbarState = useShapeToolbarState();
/** The user's own components (#188) have their own tab beside the shapes. */
const customLibrary = useCustomComponents();
const tab = customLibrary.tab;
const query = ref('');
const activeLibrary = ref<ComponentDefinition['provider'] | null>(null);
/** A library of diagram templates (#191): ER, BPMN, sequence. */
const activeDiagramLibrary = ref<DiagramLibraryId | null>(null);
/** The library of isometric icons (#212). */
const isometricOpen = ref(false);
/** The library of Lucide icons (#227); its icons load when it is opened or when something is searched. */
const lucideOpen = ref(false);
const lucideSets = shallowRef<ComponentSet[] | null>(null);
const LUCIDE_SEARCH_LIMIT = 300;
const LUCIDE_PREVIEW = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 12a4 4 0 0 0-8 0 8 8 0 1 0 16 0 11.97 11.97 0 0 0-4-8.944"/><path d="M10 12a4 4 0 0 0 8 0 8 8 0 1 0-16 0 11.97 11.97 0 0 0 4.063 9"/></svg>';
const DIAGRAM_ICONS: Record<DiagramLibraryId, 'table' | 'shapes' | 'connect'> = { er: 'table', bpmn: 'shapes', sequence: 'connect' };
const subLibrary = computed(() => Boolean(activeLibrary.value || activeDiagramLibrary.value || isometricOpen.value || lucideOpen.value));
function leaveSubLibrary(): void { activeLibrary.value = null; activeDiagramLibrary.value = null; isometricOpen.value = false; lucideOpen.value = false; query.value = ''; }
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
  { id: 'basic', label: L('Grundformen'), variants: ['square', 'circle', 'diamond', 'triangle', 'triangle-down', 'rounded'] },
  { id: 'flowchart', label: L('Flussdiagramm'), variants: ['chevron', 'process', 'document', 'documents', 'manual-input', 'parallelogram', 'parallelogram-reverse', 'off-page', 'loop-limit'] },
  { id: 'advanced', label: L('Erweitert'), variants: ['hexagon', 'cylinder', 'tube', 'internal-storage', 'trapezoid', 'summing', 'or', 'folder', 'note', 'pentagon'] },
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
watch(isometricOpen, () => { if (scroller.value) scroller.value.scrollTop = 0; });
async function ensureLucide(): Promise<void> {
  if (lucideSets.value) return;
  lucideSets.value = await loadLucideLibrary();
}
watch(lucideOpen, async (open) => {
  if (scroller.value) scroller.value.scrollTop = 0;
  if (!open) return;
  libraryError.value = false;
  if (lucideSets.value) return;
  libraryLoading.value = true;
  try { await ensureLucide(); }
  catch { libraryError.value = true; }
  finally { libraryLoading.value = false; }
});
const searching = computed(() => query.value.trim().length > 0);
/** The own components are shown; a provider library (AWS, …) opened from the shapes tab takes precedence. */
const searchLabel = computed(() => activeDiagramLibrary.value ? t('Vorlagen durchsuchen') : tab.value === 'custom' && !subLibrary.value ? t('Eigene Komponenten durchsuchen') : t('Formen durchsuchen'));
const customTab = computed(() => tab.value === 'custom' && !subLibrary.value);
watch(searching, async (active) => {
  if (!active || officialAll.value) return;
  try { officialAll.value = await loadAllOfficialLibraries(); } catch { /* starter sets stay searchable */ }
  try { await ensureLucide(); } catch { /* the search goes on without the Lucide icons */ }
});
const allComponents = computed(() => {
  const official = officialAll.value;
  const lucide = lucideSets.value;
  // Sets a document carries along are replaced by the loaded library, so no icon is listed twice.
  const base = searchCatalogComponents(sets.value.filter((set) => !(official && OFFICIAL_SET.test(set.id)) && !(lucide && set.id.startsWith(LUCIDE_SET_PREFIX))), query.value, 'all');
  const found = official ? [...base, ...searchOfficial(official, query.value, SEARCH_LIMIT)] : base;
  return lucide ? [...found, ...searchOfficial(lucide, query.value, SEARCH_LIMIT)] : found;
});
const allComponentsCapped = computed(() => Boolean(officialAll.value || lucideSets.value) && allComponents.value.length >= SEARCH_LIMIT);
/** The catalogue names its categories in English; the library shows them in the language of the interface. */
const ISOMETRIC_CATEGORIES: Record<string, string> = { 'Services and data': L('Dienste und Daten'), 'Compute and network': L('Rechnen und Netz'), 'Clients and environment': L('Clients und Umgebung') };
/** The isometric icons are a library of their own and stay out of the short list of generic components. */
const isometricSets = computed(() => sets.value.filter((set) => set.id === ISOMETRIC_SET_ID));
/**
 * The section "Cards" (called "Azure Diagrams" until #256) offers the resource cards only (#225). The generic starter symbols stay defined, so
 * existing diagrams, the text syntax and the icon of a resource card keep working, and the search still finds them.
 */
const cardComponents = computed(() => searchCatalogComponents(sets.value.filter((set) => set.id !== ISOMETRIC_SET_ID && !set.id.startsWith(LUCIDE_SET_PREFIX)), query.value, 'generic').filter((item) => item.component.type === RESOURCE_CARD_COMPONENT_TYPE));
const libraryComponents = computed(() => {
  if (isometricOpen.value) return searchCatalogComponents(isometricSets.value, query.value, 'generic');
  // Browsing shows every category; a search word that matches hundreds of icons is cut off, as nobody scrolls them.
  if (lucideOpen.value) return lucideSets.value ? searchOfficial(lucideSets.value, query.value, searching.value ? LUCIDE_SEARCH_LIMIT : Number.POSITIVE_INFINITY) : [];
  const provider = activeLibrary.value;
  if (!provider) return [];
  const loaded = officialSets.value[provider as OfficialProvider];
  if (!loaded) return searchCatalogComponents(sets.value, query.value, provider);
  const own = s.document.componentSets.filter((set) => !OFFICIAL_SET.test(set.id));
  return [...searchOfficial(loaded, query.value), ...searchCatalogComponents(own, query.value, provider)];
});
const lucideCapped = computed(() => lucideOpen.value && searching.value && libraryComponents.value.length >= LUCIDE_SEARCH_LIMIT);
const filteredShapes = computed(() => SHAPE_CATALOG.filter((entry) => matchesShape(entry, query.value)));
const annotationMatches = computed(() => {
  const needle = query.value.trim().toLocaleLowerCase('de');
  return !needle || ['annotation', 'textblock', 'dokumentation', t('kommentar'), 'rich text'].some((term) => term.includes(needle));
});
const tableMatches = computed(() => {
  const needle = query.value.trim().toLocaleLowerCase('de');
  return !needle || ['tabelle', 'table', 'grid', 'zellen', 'zeilen', 'spalten'].some((term) => term.includes(needle));
});
const libraryLabel = computed(() => isometricOpen.value ? t('Isometrische Icons') : lucideOpen.value ? t('Lucide Icons') : activeDiagramLibrary.value ? t(diagramLibrary(activeDiagramLibrary.value).name) : providers.find((entry) => entry.id === activeLibrary.value)?.label ?? 'Bibliothek');
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
  return searching.value || isometricOpen.value && expandedCategories[category] === undefined || (expandedCategories[category] ?? index === 0);
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
/**
 * Picking a tool tile keeps the library open, like the component tiles: several shapes in a row need no reopening
 * (#187). It closes with its close button, Escape or the "more shapes" button. The exception is a narrow window,
 * where the library covers the whole canvas (the media query in the styles) and the picked tool could not be used.
 */
function afterPick(): void {
  if (window.matchMedia('(max-width:760px)').matches) store.setCatalogOpen(false);
}
function activateShape(entry: ShapeEntry): void {
  if (toolbarState.editing.value) {
    toolbarState.addFavorite(entry.id);
    return;
  }
  store.setShapeTool(entry.id);
  afterPick();
}
function activateConnector(): void {
  store.setTool('connector');
  afterPick();
}
function activateAnnotation(): void {
  store.setTool('annotation');
  afterPick();
}
function activateTable(): void {
  store.setTool('table');
  afterPick();
}
function activateComponent(item: CatalogSearchResult): void {
  store.insertComponent(item.set, item.component.type);
}
/** The section "Cards" offers the resource card in each of its looks (#257); a look is a variant of the same component. */
const cardVariant = (look: ResourceCardLook): ElementPatch | undefined => (look === 'dashed' ? resourceCardLookPatch(undefined, 'dashed') : undefined);
function activateCard(item: CatalogSearchResult, look: ResourceCardLook): void {
  void store.insertComponent(item.set, item.component.type, undefined, cardVariant(look));
}
function dragCard(event: DragEvent, item: CatalogSearchResult, look: ResourceCardLook): void {
  const variant = cardVariant(look);
  beginComponentDrag({ set: item.set, type: item.component.type, ...(variant ? { variant } : {}) });
  event.dataTransfer?.setData(COMPONENT_DRAG_MIME, item.component.type);
  if (event.dataTransfer) event.dataTransfer.effectAllowed = 'copy';
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
function selectTab(next: 'shapes' | 'custom'): void {
  if (next === 'custom') toolbarState.stopEditing();
  tab.value = next;
}
/** Arrow keys move between the two tabs, as in every tab list. */
function onTabKeydown(event: KeyboardEvent): void {
  if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
  event.preventDefault();
  const next = event.key === 'Home' ? 'shapes' : event.key === 'End' ? 'custom' : tab.value === 'shapes' ? 'custom' : 'shapes';
  selectTab(next);
  void nextTick(() => document.getElementById(`library-tab-${next}`)?.focus());
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
  // A component that was just saved is waiting for its name; that field keeps the focus.
  if (!customLibrary.renamingId.value) searchInput.value?.focus();
});
onBeforeUnmount(() => {
  // The next opening starts with the shapes again.
  tab.value = 'shapes';
  customLibrary.renamingId.value = null;
  const target = opener.value;
  if (target?.isConnected) queueMicrotask(() => target.focus());
});
</script>

<template>
  <aside id="shape-library-panel" class="shape-library sd-panel" :aria-label="t('Formen und Komponenten')" data-testid="shape-library-sidebar" @keydown="onKeydown">
    <header class="library-header">
      <div class="library-title-row">
        <button v-if="subLibrary" type="button" class="header-action" :aria-label="t('Zurück zu allen Formen')" @click="leaveSubLibrary"><span aria-hidden="true">←</span></button>
        <h2 class="sd-panel-title">{{ subLibrary ? libraryLabel : t('Formen') }}</h2>
        <button type="button" class="header-action close-button sd-panel-close" :aria-label="t('Formen schließen')" @click="close"><AppIcon name="close" /></button>
      </div>
      <div v-if="!subLibrary" class="library-tabs" role="tablist" :aria-label="t('Bereiche der Bibliothek')" @keydown="onTabKeydown">
        <button id="library-tab-shapes" type="button" role="tab" class="library-tab" :aria-selected="tab === 'shapes'" aria-controls="library-tabpanel" :tabindex="tab === 'shapes' ? 0 : -1" @click="selectTab('shapes')">{{ t('Formen') }}</button>
        <button id="library-tab-custom" type="button" role="tab" class="library-tab" :aria-selected="tab === 'custom'" aria-controls="library-tabpanel" :tabindex="tab === 'custom' ? 0 : -1" @click="selectTab('custom')">{{ t('Eigene') }}<span v-if="customLibrary.components.value.length" class="tab-count">{{ customLibrary.components.value.length }}</span></button>
      </div>
      <label class="library-search">
        <AppIcon name="search" :size="20" />
        <span class="visually-hidden">{{ searchLabel }}</span>
        <input ref="searchInput" v-model="query" type="search" :aria-label="searchLabel" :placeholder="searchLabel" autocomplete="off" spellcheck="false" />
      </label>
      <div v-if="!customTab && !activeDiagramLibrary" class="customize-row">
        <p v-if="toolbarState.editing.value">{{ t('Form anklicken oder in die obere Leiste ziehen.') }}</p>
        <span v-else>{{ t('Lieblingsformen direkt in der oberen Leiste ablegen.') }}</span>
        <button type="button" :aria-pressed="toolbarState.editing.value" @click="toggleEditing">{{ toolbarState.editing.value ? t('Fertig') : t('Leiste anpassen') }}</button>
      </div>
    </header>

    <div id="library-tabpanel" ref="scroller" class="library-scroll" :role="subLibrary ? undefined : 'tabpanel'" :aria-labelledby="subLibrary ? undefined : `library-tab-${tab}`">
      <DiagramLibraryView v-if="activeDiagramLibrary" :library="diagramLibrary(activeDiagramLibrary)" :query="query" />
      <template v-else-if="activeLibrary || isometricOpen || lucideOpen">
        <p v-if="libraryLoading" class="empty-state" role="status">{{ t('Bibliothek wird geladen …') }}</p>
        <p v-if="libraryError" class="empty-state" role="alert">{{ lucideOpen ? t('Die Bibliothek konnte nicht geladen werden.') : t('Die vollständige Bibliothek konnte nicht geladen werden; es werden die Startsymbole gezeigt.') }}</p>
        <section v-for="(group, index) in groupedLibraryComponents" :key="group.category" class="component-group">
          <h3><button type="button" class="category-toggle" :aria-expanded="categoryOpen(group.category, index)" @click="toggleCategory(group.category, index)"><span>{{ isometricOpen ? t(ISOMETRIC_CATEGORIES[group.category] ?? group.category) : group.category }}</span><span class="category-count">{{ group.items.length }}</span><AppIcon class="category-chevron" name="chevron-down" :size="18" /></button></h3>
          <div v-if="categoryOpen(group.category, index)" class="component-grid" :class="{ 'line-icons': lucideOpen }">
            <button v-for="item in group.items" :key="`${item.set.id}:${item.component.type}`" type="button" class="component-tile" :class="{ 'resource-card-tile': item.component.type === RESOURCE_CARD_COMPONENT_TYPE }" :disabled="s.transitioning || !s.canWrite" draggable="true" @click="activateComponent(item)" @dragstart="dragComponent($event, item)" @dragend="clearComponentDrag">
              <span v-if="item.component.type === RESOURCE_CARD_COMPONENT_TYPE" class="resource-card-preview" aria-hidden="true"><SafeIcon :source="item.component.iconSvg" :size="28" /><span><b>{{ t('Resource Name') }}</b><small>{{ t('Description') }}</small></span></span>
              <SafeIcon v-else :source="item.component.iconSvg" :size="isometricOpen ? 56 : lucideOpen ? 28 : 42" />
              <span>{{ item.component.name }}</span>
              <small v-if="!isometricOpen && !lucideOpen">{{ item.component.provider === 'gcp' ? 'GCP' : item.component.provider.toUpperCase() }}</small>
            </button>
          </div>
        </section>
        <p v-if="lucideCapped" class="empty-state">{{ t('Die ersten {count} Treffer werden gezeigt. Mit einem genaueren Suchwort findest du den Rest.', { count: LUCIDE_SEARCH_LIMIT }) }}</p>
        <p v-if="!libraryComponents.length && !libraryLoading" class="empty-state">{{ t('Keine passenden Symbole gefunden.') }}</p>
      </template>

      <CustomComponentsTab v-else-if="customTab" :query="query" />

      <template v-else-if="searching">
        <section class="search-results">
          <h3 v-if="annotationMatches || tableMatches || filteredShapes.length">{{ t('Formen') }}</h3>
          <div class="shape-grid">
            <button v-if="annotationMatches" type="button" class="shape-tile" :disabled="!s.canWrite" :aria-label="t('Annotation')" @click="activateAnnotation"><AppIcon name="annotation" :size="30" /><span>{{ t('Annotation') }}</span></button>
            <button v-if="tableMatches" type="button" class="shape-tile" :disabled="!s.canWrite" :aria-label="t('Tabelle')" @click="activateTable"><AppIcon name="table" :size="30" /><span>{{ t('Tabelle') }}</span></button>
            <button v-for="entry in filteredShapes" :key="entry.id" type="button" class="shape-tile" :class="{ favorite: toolbarState.favorites.value.includes(entry.id) }" draggable="true" :aria-label="toolbarState.favorites.value.includes(entry.id) ? t('{label}, in der Leiste', { label: t(entry.label) }) : t(entry.label)" @click="activateShape(entry)" @dragstart="dragShape($event, entry)">
              <svg viewBox="0 0 24 24" aria-hidden="true"><path v-for="path in entry.icon" :key="path" :d="path" /></svg>
              <span>{{ t(entry.label) }}</span><span v-if="toolbarState.favorites.value.includes(entry.id)" class="favorite-mark" aria-hidden="true">✓</span>
            </button>
          </div>
          <h3>{{ t('Architektur') }}</h3>
          <div class="component-grid search-components">
            <button v-for="item in allComponents" :key="`${item.set.id}:${item.component.type}`" type="button" class="component-tile" :class="{ 'resource-card-tile': item.component.type === RESOURCE_CARD_COMPONENT_TYPE }" :disabled="s.transitioning || !s.canWrite" draggable="true" @click="activateComponent(item)" @dragstart="dragComponent($event, item)" @dragend="clearComponentDrag">
              <span v-if="item.component.type === RESOURCE_CARD_COMPONENT_TYPE" class="resource-card-preview" aria-hidden="true"><SafeIcon :source="item.component.iconSvg" :size="28" /><span><b>{{ t('Resource Name') }}</b><small>{{ t('Description') }}</small></span></span>
              <SafeIcon v-else :source="item.component.iconSvg" :size="isLucideComponent(item.component) ? 30 : 40" /><span>{{ item.component.name }}</span><small>{{ isLucideComponent(item.component) ? 'LUCIDE' : item.component.provider.toUpperCase() }}</small>
            </button>
          </div>
          <p v-if="allComponentsCapped" class="empty-state">{{ t('Die ersten {count} Treffer werden gezeigt. Weitere findest du in der jeweiligen Bibliothek.', { count: SEARCH_LIMIT }) }}</p>
          <p v-if="!annotationMatches && !tableMatches && !filteredShapes.length && !allComponents.length" class="empty-state">{{ t('Keine Form oder Komponente gefunden.') }}</p>
        </section>
        <DiagramLibraryView :query="query" />
      </template>

      <template v-else>
        <section class="accordion-section">
          <button type="button" class="accordion-trigger" :aria-expanded="expanded.connectors" aria-controls="shape-section-connectors" @click="toggleSection('connectors')"><span>{{ t('Verbinder') }}</span><AppIcon class="section-chevron" name="chevron-down" :size="22" /></button>
          <div v-if="expanded.connectors" id="shape-section-connectors" class="shape-grid">
            <button type="button" class="shape-tile" :disabled="!s.canWrite" @click="activateConnector"><AppIcon name="connector" :size="28" /><span>{{ t('Verbinder') }}</span></button>
          </div>
        </section>
        <section v-for="group in shapeGroups" :key="group.id" class="accordion-section">
          <button type="button" class="accordion-trigger" :aria-expanded="expanded[group.id]" :aria-controls="`shape-section-${group.id}`" @click="toggleSection(group.id)"><span>{{ t(group.label) }}</span><AppIcon class="section-chevron" name="chevron-down" :size="22" /></button>
          <div v-if="expanded[group.id]" :id="`shape-section-${group.id}`" class="shape-grid">
            <button v-if="group.id === 'basic'" type="button" class="shape-tile" :disabled="!s.canWrite" :aria-label="t('Annotation')" @click="activateAnnotation"><AppIcon name="annotation" :size="30" /><span>{{ t('Annotation') }}</span></button>
            <button v-if="group.id === 'basic'" type="button" class="shape-tile" :disabled="!s.canWrite" :aria-label="t('Tabelle')" @click="activateTable"><AppIcon name="table" :size="30" /><span>{{ t('Tabelle') }}</span></button>
            <button v-for="entry in entriesFor(group)" :key="entry.id" type="button" class="shape-tile" :class="{ favorite: toolbarState.favorites.value.includes(entry.id) }" draggable="true" :aria-label="toolbarState.favorites.value.includes(entry.id) ? t('{label}, in der Leiste', { label: t(entry.label) }) : t(entry.label)" @click="activateShape(entry)" @dragstart="dragShape($event, entry)">
              <svg viewBox="0 0 24 24" aria-hidden="true"><path v-for="path in entry.icon" :key="path" :d="path" /></svg>
              <span>{{ t(entry.label) }}</span><span v-if="toolbarState.favorites.value.includes(entry.id)" class="favorite-mark" aria-hidden="true">✓</span>
            </button>
          </div>
        </section>
        <section class="accordion-section">
          <button type="button" class="accordion-trigger" :aria-expanded="expanded.architecture" aria-controls="shape-section-architecture" @click="toggleSection('architecture')"><span>{{ t('Cards') }}</span><AppIcon class="section-chevron" name="chevron-down" :size="22" /></button>
          <div v-if="expanded.architecture" id="shape-section-architecture" class="component-grid">
            <template v-for="item in cardComponents" :key="`${item.set.id}:${item.component.type}`">
              <button v-for="look in RESOURCE_CARD_LOOKS" :key="look" type="button" class="component-tile resource-card-tile" :data-testid="`resource-card-tile-${look}`" :disabled="s.transitioning || !s.canWrite" draggable="true" @click="activateCard(item, look)" @dragstart="dragCard($event, item, look)" @dragend="clearComponentDrag"><span class="resource-card-preview" :class="{ dashed: look === 'dashed' }" aria-hidden="true"><SafeIcon :source="item.component.iconSvg" :size="28" /><span><b>{{ t('Resource Name') }}</b><small>{{ t('Description') }}</small></span><i v-if="look === 'dashed'" class="resource-card-bar">{{ t('Link') }}</i></span><span>{{ look === 'dashed' ? t('Ressourcenkarte, gestrichelt') : item.component.name }}</span><small>{{ item.component.category }}</small></button>
            </template>
          </div>
        </section>

        <section class="other-libraries" aria-labelledby="other-libraries-heading">
          <h3 id="other-libraries-heading">{{ t('Weitere Bibliotheken') }}</h3>
          <button v-for="diagram in DIAGRAM_LIBRARIES" :key="diagram.id" type="button" class="provider-row" :data-testid="`open-diagram-library-${diagram.id}`" @click="activeDiagramLibrary = diagram.id; query = ''">
            <span class="provider-logo diagram-logo"><AppIcon :name="DIAGRAM_ICONS[diagram.id]" :size="30" /></span>
            <span><strong>{{ t(diagram.name) }}</strong><small>{{ t(diagram.description) }}</small></span>
            <AppIcon class="row-chevron" name="chevron-right" :size="20" />
          </button>
          <button v-if="isometricSets.length" type="button" class="provider-row" data-testid="open-isometric-library" @click="isometricOpen = true; query = ''">
            <span class="provider-logo"><SafeIcon :source="isometricSets[0]!.components[0]?.iconSvg" :size="48" /></span>
            <span><strong>{{ t('Isometrische Icons') }}</strong><small>{{ t('{count} Symbole', { count: isometricSets[0]!.components.length }) }}</small></span>
            <AppIcon class="row-chevron" name="chevron-right" :size="20" />
          </button>
          <button v-if="lucideIconCount()" type="button" class="provider-row" data-testid="open-lucide-library" @click="lucideOpen = true; query = ''">
            <span class="provider-logo lucide-logo"><SafeIcon :source="LUCIDE_PREVIEW" :size="34" /></span>
            <span><strong>{{ t('Lucide Icons') }}</strong><small>{{ t('{count} Symbole', { count: lucideIconCount() }) }}</small></span>
            <AppIcon class="row-chevron" name="chevron-right" :size="20" />
          </button>
          <button v-for="providerItem in providers" :key="providerItem.id" type="button" class="provider-row" @click="activeLibrary = providerItem.id">
            <span class="provider-logo"><SafeIcon :source="providerPreview(providerItem.id)" :size="48" /></span>
            <span><strong>{{ t(providerItem.label) }}</strong><small>{{ t('{count} Symbole', { count: providerCount(providerItem.id) }) }}</small></span>
            <AppIcon class="row-chevron" name="chevron-right" :size="20" />
          </button>
        </section>
      </template>
    </div>

    <footer v-if="toolbarState.editing.value" class="library-footer">
      <button type="button" class="reset-button" @click="toolbarState.resetFavorites">{{ t('Standard wiederherstellen') }}</button>
    </footer>
  </aside>
</template>

<style scoped>
.shape-library{position:absolute;z-index:22;top:var(--panel-top);right:18px;bottom:18px;width:min(420px,calc(100vw - 36px));display:flex;flex-direction:column;overflow:hidden;border-radius:22px;box-shadow:var(--shadow-panel)}
.library-header{flex:none;padding:8px 24px 12px;border-bottom:1px solid var(--border-subtle);background:var(--surface-panel)}
.library-title-row{display:flex;align-items:center;gap:10px;margin-bottom:8px}.close-button{margin-left:auto}.header-action{display:grid;width:36px;height:36px;padding:0;place-items:center;border:0;border-radius:10px;background:transparent;color:var(--text-primary);font-size:18px;line-height:1;cursor:pointer}.header-action:hover{background:var(--surface-raised)}
.library-tabs{display:grid;grid-template-columns:1fr 1fr;gap:4px;margin-bottom:10px;padding:4px;border-radius:12px;background:var(--surface-raised)}.library-tab{display:flex;align-items:center;justify-content:center;gap:6px;min-height:34px;padding:0 10px;border:0;border-radius:9px;background:transparent;color:var(--text-muted);font:inherit;font-size:13px;font-weight:600;cursor:pointer}.library-tab:hover{color:var(--text-primary)}.library-tab[aria-selected=true]{background:var(--surface-panel);color:var(--text-primary);box-shadow:0 1px 2px rgb(0 0 0 / .12)}.library-tab:focus-visible{outline:2px solid var(--accent);outline-offset:-2px}.tab-count{min-width:20px;padding:1px 6px;border-radius:999px;background:var(--accent-soft);color:var(--accent);font-size:11px;line-height:1.5}
.library-search{display:flex;align-items:center;gap:10px;height:48px;padding:0 12px;border:1px solid transparent;border-radius:12px;background:var(--surface-raised);color:var(--text-muted)}.library-search:focus-within{border-color:var(--accent)}.library-search input{min-width:0;width:100%;height:100%;border:0;outline:0;background:transparent;color:var(--text-primary);font:inherit;font-size:16px}.library-search input::placeholder{color:var(--text-muted)}
.customize-row{display:flex;align-items:center;gap:8px;margin-top:12px;color:var(--text-muted);font-size:11px}.customize-row p,.customize-row span{flex:1;margin:0}.customize-row button,.reset-button{flex:none;min-height:34px;padding:0 10px;border:1px solid var(--border-subtle);border-radius:9px;background:var(--surface-raised);color:var(--text-primary);cursor:pointer}.customize-row button[aria-pressed=true]{border-color:var(--accent);color:var(--accent);background:var(--accent-soft)}
.library-scroll{flex:1;min-height:0;overflow:auto;background:var(--surface-panel)}.accordion-section{border-bottom:1px solid var(--border-subtle)}.accordion-trigger{display:flex;align-items:center;justify-content:space-between;width:100%;min-height:66px;padding:0 24px;border:0;background:transparent;color:var(--text-primary);font-size:17px;font-weight:650;text-align:left;cursor:pointer}.accordion-trigger:hover{background:var(--surface-raised)}/* Drawn chevrons with round ends instead of text characters, which differ from font to font (#228). */
.section-chevron,.category-chevron,.row-chevron{flex:none;stroke-width:2;color:var(--text-muted)}.section-chevron{transition:transform .16s ease}.accordion-trigger[aria-expanded=true] .section-chevron{transform:rotate(180deg)}.accordion-trigger:hover .section-chevron,.category-toggle:hover .category-chevron,.provider-row:hover .row-chevron{color:var(--text-primary)}
.shape-grid{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:8px;padding:0 20px 18px}.shape-tile{position:relative;display:flex;min-width:0;min-height:78px;flex-direction:column;align-items:center;justify-content:center;gap:7px;padding:8px 4px;border:1px solid transparent;border-radius:11px;background:transparent;color:var(--text-primary);font-size:10px;text-align:center;cursor:pointer}.shape-tile:hover,.shape-tile:focus-visible{border-color:var(--border-subtle);background:var(--surface-raised)}.shape-tile.favorite{color:var(--accent)}.shape-tile svg{width:30px;height:30px;fill:none;stroke:currentColor;stroke-width:1.7;stroke-linecap:round;stroke-linejoin:round}.favorite-mark{position:absolute;top:4px;right:7px;font-weight:700}
.component-group,.search-results{padding:20px 20px 4px}.component-group h3,.search-results h3{margin:0 4px 12px;font-size:13px;color:var(--text-muted);text-transform:uppercase;letter-spacing:.04em}.component-group{padding-top:8px;padding-bottom:0;border-bottom:1px solid var(--border-subtle)}.component-group h3{margin:0}.category-toggle{display:flex;align-items:center;gap:8px;width:100%;min-height:44px;padding:0 4px;border:0;border-radius:8px;background:transparent;color:inherit;font:inherit;letter-spacing:inherit;text-align:left;text-transform:inherit;cursor:pointer}.category-toggle:hover{color:var(--text-primary)}.category-toggle>span:first-child{flex:1}.category-count{min-width:24px;padding:1px 7px;border-radius:999px;background:var(--surface-raised);font-size:11px;text-align:center}.category-chevron{transition:transform .16s ease}.category-toggle[aria-expanded=true] .category-chevron{transform:rotate(180deg)}
.component-grid{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:8px;padding:0 20px 18px}.component-group .component-grid{padding:0 0 16px}.search-results .component-grid{padding:0}.component-tile{display:flex;min-width:0;min-height:112px;flex-direction:column;align-items:center;justify-content:center;gap:6px;padding:10px 7px;border:1px solid var(--border-subtle);border-radius:12px;background:var(--surface-raised);color:var(--text-primary);text-align:center;cursor:grab}.component-tile:active{cursor:grabbing}.component-tile:hover,.component-tile:focus-visible{border-color:var(--accent);background:var(--accent-soft)}.component-tile span{width:100%;overflow:hidden;text-overflow:ellipsis;font-size:11px;font-weight:650}.component-tile small{font-size:9px;color:var(--text-muted)}.search-components{margin-bottom:16px}
.component-grid .resource-card-tile{grid-column:1/-1;min-height:126px;padding:10px}.resource-card-preview{display:grid!important;grid-template-columns:38px minmax(0,1fr);align-items:center;gap:10px;width:100%!important;min-height:62px;padding:10px 10px 18px;box-sizing:border-box;border:1px solid var(--border-default);border-radius:7px;background:var(--surface-panel);box-shadow:inset 0 -10px var(--accent-soft);text-align:left}.resource-card-preview>span{display:grid;gap:3px;font-size:12px!important}.resource-card-preview b{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.resource-card-preview small{text-transform:uppercase}.resource-card-preview.dashed{grid-template-rows:auto auto;padding:10px;border-style:dashed;border-color:#9fb8bd;box-shadow:none;color:#64748b}.resource-card-preview.dashed small{text-transform:none}.resource-card-bar{grid-column:1/-1;padding:3px 8px;border-radius:3px;background:rgb(159 184 189 / .24);font-size:11px;font-style:normal}:root[data-theme='dark'] .resource-card-preview.dashed{color:var(--text-muted)}
.other-libraries{padding:20px 0;border-top:1px solid var(--border-subtle)}.other-libraries h3{padding:0 24px 12px;font-size:16px}.provider-row{display:grid;grid-template-columns:62px 1fr auto;align-items:center;gap:12px;width:100%;min-height:82px;padding:10px 24px;border:0;background:transparent;color:var(--text-primary);text-align:left;cursor:pointer}.provider-row:hover{background:var(--surface-raised)}.provider-logo{display:grid;width:58px;height:58px;place-items:center;border-radius:11px;background:var(--surface-raised)}.lucide-logo{color:var(--text-primary)}
/* Line icons are small and many: four to a row, in the colour of the text. */
.component-grid.line-icons{grid-template-columns:repeat(4,minmax(0,1fr));gap:6px}.component-grid.line-icons .component-tile{min-height:78px;padding:8px 4px;gap:5px}.component-grid.line-icons .component-tile span{font-size:10px;font-weight:500;white-space:nowrap}.diagram-logo{color:var(--accent)}.provider-row strong,.provider-row small{display:block}.provider-row strong{font-size:15px}.provider-row small{margin-top:4px;color:var(--text-muted);font-size:13px}
.empty-state{padding:18px 24px;color:var(--text-muted);font-size:11px;line-height:1.5}.library-footer{flex:none;display:grid;gap:10px;padding:12px 20px;border-top:1px solid var(--border-subtle);background:var(--surface-panel)}.reset-button{justify-self:start}.visually-hidden{position:absolute;width:1px;height:1px;padding:0;margin:-1px;overflow:hidden;clip:rect(0,0,0,0);white-space:nowrap;border:0}
@media(max-width:760px){.shape-library{right:12px;bottom:12px;width:calc(100vw - 24px)}.library-header{padding:8px 16px 12px}.shape-grid{grid-template-columns:repeat(3,minmax(0,1fr));padding-inline:14px}.component-grid{padding-inline:14px}.provider-row{padding-inline:16px}}
@media(prefers-reduced-motion:reduce){.section-chevron,.category-chevron{transition:none}}
@media(forced-colors:active){.library-tab[aria-selected=true]{outline:2px solid Highlight}.shape-tile.favorite{outline:2px solid Highlight}.customize-row button[aria-pressed=true]{outline:2px solid Highlight}}
</style>

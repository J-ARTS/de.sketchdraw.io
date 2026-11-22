<!-- @component The side panel for import and export (draw.io, SVG, Mermaid, PNG …). -->
<script setup lang="ts">
import AppButton from '@/renderer/design-system/atoms/AppButton.vue';
import { t, tm } from '@/renderer/i18n';
import { computed, nextTick, onBeforeUnmount, ref, shallowRef, watch } from 'vue';
import { importDrawio, importSvg, inspectDrawio, INTEROP_LIMITS, InteropError, prepareDrawioExport, prepareSvgExport, type DrawioPageInfo, type InteropDiagnostic, type InteropExportResult, type InteropFormat, type InteropImportResult } from '@/interop';
import { getDesktopBridge } from '@/platform';
import { importedPagePayload, importMermaidCode, MERMAID_SEQUENCE_INVALID } from '@/renderer/lib/mermaid-import';
import { defaultMermaidExportTarget, mermaidExportTargets, prepareMermaidCodeExport } from '@/renderer/lib/mermaid-export';
import type { DocumentAuthority } from '@/session';
import { useWhiteboard } from '@/renderer/design-system/composables/use-whiteboard';
import { bounds } from '@/renderer/lib/geometry';
import { suggestFileName } from '@/renderer/lib/savestate';
import ElementView from '@/renderer/design-system/organisms/ElementView.vue';
import AppIcon from '@/renderer/design-system/atoms/AppIcon.vue';
import AppSelect from '@/renderer/design-system/molecules/AppSelect.vue';

const props = defineProps<{ open: boolean; mode: 'import' | 'export' }>();
const emit = defineEmits<{ close: [] }>();
const store = useWhiteboard(); const bridge = getDesktopBridge();
const format = ref<InteropFormat>('drawio'); const source = ref(''); const fileName = ref('');
const sourceFileBytes = ref(0); const mermaidInput = ref<HTMLTextAreaElement | null>(null); const fileInput = ref<HTMLInputElement | null>(null);
const largeFileSource = computed(() => Boolean(fileName.value) && sourceFileBytes.value > 200 * 1024);
const pages = ref<DrawioPageInfo[]>([]); const pageIndex = ref<number | 'all' | null>(null);
const exportPageId = ref(store.state.activePageId);
const formatOptions = computed(() => [{ value: 'drawio', label: t('draw.io') }, { value: 'svg', label: 'SVG' }, { value: 'mermaid', label: 'Mermaid' }]);
// A Mermaid file holds one diagram: a sequence diagram is written as `sequenceDiagram`, the other shapes as a flowchart (#261).
const mermaidPageId = computed(() => store.state.pages.some(item => item.id === exportPageId.value) ? exportPageId.value : store.state.activePageId);
const mermaidTargets = computed(() => props.open && props.mode === 'export' && format.value === 'mermaid' ? mermaidExportTargets(store.state.document, mermaidPageId.value) : []);
const mermaidTarget = ref('');
const activeMermaidTarget = computed(() => mermaidTargets.value.find(item => item.id === mermaidTarget.value) ?? mermaidTargets.value[0] ?? null);
const mermaidTargetOptions = computed(() => mermaidTargets.value.map(item => ({ value: item.id, label: item.kind === 'sequence' ? t('Sequenzdiagramm: {names}', { names: item.names || t('ohne Namen') }) : item.kind === 'flow' ? t('Ablauf: {names}', { names: item.names || t('ohne Namen') }) : t('Flowchart der ganzen Seite') })));
function pickMermaidTarget() { mermaidTarget.value = mermaidTargets.value.length ? defaultMermaidExportTarget(store.state.document, mermaidPageId.value, store.state.selection) : ''; }
const importPageOptions = computed(() => [
  { value: '', label: t('Bitte eine der {count} Seiten auswählen', { count: pages.value.length }), disabled: true },
  { value: 'all', label: t('Alle {count} Seiten importieren', { count: pages.value.length }) },
  ...pages.value.map(item => ({ value: String(item.index), label: `${item.index + 1} · ${item.name}` })),
]);
const exportPageOptions = computed(() => store.state.pages.map(item => ({ value: item.id, label: tm(item.name) })));
const imported = shallowRef<InteropImportResult | null>(null);
const exported = shallowRef<{ result: InteropExportResult; authority: DocumentAuthority | null; revision: number; title: string } | null>(null);
const embedDocument = ref(true); const busy = ref(false); const error = ref(''); const status = ref('');
const failures = shallowRef<readonly InteropDiagnostic[]>([]); let serial = 0;
const staleExport = computed(() => exported.value !== null && (exported.value.result.format !== format.value || exported.value.authority !== store.getAuthority() || exported.value.revision !== store.state.revision || store.state.hasDraft));
const formatName = (value: InteropFormat) => value === 'svg' ? 'SVG' : value === 'mermaid' ? 'Mermaid' : 'draw.io';
/** Show the verified source page when restoring an embedded multi-page document. */
const previewElements = computed(() => {
  const result = imported.value; if (!result) return [];
  const page = result.document.pages.find(item => item.id === result.source.pageId) ?? result.document.pages[0]!;
  return result.document.elements.filter(element => element.pageId === page.id);
});
const previewBounds = computed(() => {
  const rect = imported.value ? bounds(previewElements.value) : null;
  return rect ? `${rect.x - 20} ${rect.y - 20} ${Math.max(80, rect.width + 40)} ${Math.max(80, rect.height + 40)}` : '0 0 400 200';
});
function clear() { serial++; source.value = ''; fileName.value = ''; sourceFileBytes.value = 0; pages.value = []; pageIndex.value = null; imported.value = null; exported.value = null; busy.value = false; error.value = ''; status.value = ''; failures.value = []; }
function failure(value: unknown) {
  error.value = value instanceof InteropError && value.code === 'MERMAID_DIAGRAM_UNSUPPORTED'
    ? t('Dieser Mermaid-Diagrammtyp wird nicht unterstützt. Verwende ein Flowchart (flowchart, graph) oder ein Sequenzdiagramm (sequenceDiagram). Dein Dokument bleibt erhalten.')
    : value instanceof InteropError && value.code === MERMAID_SEQUENCE_INVALID
    ? t('Der Code des Sequenzdiagramms hat Fehler und wurde nicht importiert. Dein Dokument bleibt erhalten.')
    : value instanceof InteropError ? t('Die Datei konnte nicht verarbeitet werden ({code}). Das aktuelle Dokument bleibt erhalten.', { code: value.code }) : t('Die Datei konnte nicht verarbeitet werden. Das aktuelle Dokument bleibt erhalten.');
  // The message above already says in the language of the app what an unsupported diagram type means; the raw
  // diagnostic would only repeat it in English. Other failures keep their details (the line of a syntax error).
  failures.value = value instanceof InteropError && value.code !== 'MERMAID_DIAGRAM_UNSUPPORTED' ? value.diagnostics : [];
}
function inspect() {
  imported.value = null; failures.value = []; error.value = ''; pages.value = []; pageIndex.value = null;
  if (!source.value) return;
  try {
    if (format.value === 'drawio') { pages.value = inspectDrawio(source.value); if (pages.value.length === 1) pageIndex.value = pages.value[0]!.index; }
    if (format.value !== 'drawio' || pageIndex.value !== null) convert();
  } catch (value) { failure(value); }
}
function convert() {
  error.value = ''; failures.value = []; imported.value = null;
  if (!source.value || (format.value === 'drawio' && pageIndex.value === null)) return;
  try { imported.value = format.value === 'svg' ? importSvg(source.value) : format.value === 'mermaid' ? importMermaidCode(source.value) : importDrawio(source.value, { pageIndex: pageIndex.value! }); }
  catch (value) { failure(value); }
}
function selectFormat(value: string) {
  if (value === 'drawio' || value === 'svg' || value === 'mermaid') format.value = value;
}
function selectImportPage(value: string) {
  pageIndex.value = value === '' ? null : value === 'all' ? 'all' : Number(value);
  convert();
}
function editSource(event: Event) {
  serial++; busy.value = false; source.value = (event.target as HTMLTextAreaElement).value; fileName.value = ''; sourceFileBytes.value = 0;
  imported.value = null; failures.value = []; error.value = ''; status.value = '';
}
async function startMermaidText() { clear(); await nextTick(); mermaidInput.value?.focus(); }
async function readFile(event: Event) {
  const input = event.target as HTMLInputElement; const file = input.files?.[0]; input.value = '';
  if (!file) return;
  clear(); format.value = /\.svg$/i.test(file.name) ? 'svg' : /\.(mmd|mermaid)$/i.test(file.name) ? 'mermaid' : 'drawio';
  const own = serial; const authority = store.getAuthority(); busy.value = true;
  try {
    if (file.size > INTEROP_LIMITS.MAX_INPUT_BYTES) { error.value = t('Die Datei ist zu groß (maximal 96 MiB).'); return; }
    const contents = await file.text();
    if (own !== serial || authority !== store.getAuthority()) return;
    fileName.value = file.name; sourceFileBytes.value = file.size; source.value = contents;
    await nextTick(); if (own === serial) inspect();
  } catch (value) { if (own === serial) failure(value); }
  finally { if (own === serial) busy.value = false; }
}
async function applyImport() {
  if (!imported.value || busy.value) return;
  await store.importDocument(imported.value.document);
  // Dirty cancellation keeps this preview. Successful install clears it through the authority hook.
}
/** Puts the previewed page into the page that is open, as one undo step; the document stays what it is (#248). */
const insertable = computed(() => imported.value !== null && imported.value.document.pages.length === 1 && imported.value.document.elements.length > 0);
async function insertImport() {
  const result = imported.value;
  if (!result || busy.value) return;
  const payload = importedPagePayload(result.document, result.source.pageId);
  if (payload && await store.insertElements(payload)) emit('close');
}
async function prepareExport() {
  const owner = store.getAuthority(); const own = ++serial; busy.value = true; error.value = ''; failures.value = []; exported.value = null; status.value = '';
  const selectedFormat = format.value, selectedPage = exportPageId.value, activePage = store.state.activePageId, embed = embedDocument.value, selectedTarget = activeMermaidTarget.value?.id;
  try {
    const snapshot = await store.prepareDocumentSnapshot();
    if (!snapshot || own !== serial || owner !== store.getAuthority()) return;
    const options = { embedDocument: embed, pageId: snapshot.document.pages.some(item => item.id === selectedPage) ? selectedPage : activePage };
    const result = selectedFormat === 'svg' ? prepareSvgExport(snapshot.document, options) : selectedFormat === 'mermaid' ? prepareMermaidCodeExport(snapshot.document, { ...options, ...(selectedTarget ? { target: selectedTarget } : {}) }) : prepareDrawioExport(snapshot.document, { embedDocument: embed });
    exported.value = { result, authority: owner, revision: snapshot.revision, title: snapshot.document.title };
  } catch (value) { if (own === serial) failure(value); }
  finally { if (own === serial) busy.value = false; }
}
async function writeExport() {
  const preview = exported.value;
  if (!preview || busy.value) return;
  if (preview.result.format !== format.value || preview.authority !== store.getAuthority() || preview.revision !== store.state.revision || store.state.hasDraft) { error.value = t('Bitte die Exportvorschau für den aktuellen Stand neu erstellen.'); return; }
  const own = serial; busy.value = true; error.value = '';
  try {
    const name = suggestFileName(preview.title).replace(/\.sketchdraw\.json$/, preview.result.suggestedExtension);
    const result = await bridge.exportFile(preview.result.contents, name, preview.result.format);
    if (own !== serial || preview.authority !== store.getAuthority()) return;
    if (result.status === 'error') error.value = t('Export fehlgeschlagen: {message}', { message: result.message });
    else if (result.status === 'exported') status.value = t('Exportiert: {name}', { name: result.name });
    else if (result.status === 'download-initiated') status.value = t('Als Download übergeben: {name}', { name: result.name });
    else status.value = t('Export abgebrochen. Das Dokument bleibt erhalten.');
  } catch { if (own === serial) error.value = t('Der Export konnte nicht ausgegeben werden. Das Dokument bleibt erhalten.'); }
  finally { if (own === serial) busy.value = false; }
}
watch(() => props.mode, clear);
watch(() => props.open, open => { if (!open) clear(); else exportPageId.value = store.state.activePageId; });
watch([() => props.open, () => props.mode, format, exportPageId], pickMermaidTarget, { flush: 'sync' });
watch([format, embedDocument, exportPageId, mermaidTarget], () => {
  serial++; busy.value = false; exported.value = null; imported.value = null; failures.value = []; error.value = ''; status.value = ''; pages.value = []; pageIndex.value = null;
  if (props.mode === 'import' && source.value && format.value !== 'mermaid') inspect();
}, { flush: 'sync' });
const unsubscribe = store.subscribeAuthority(() => { clear(); emit('close'); });
onBeforeUnmount(() => { unsubscribe(); clear(); });
</script>

<template>
  <aside v-if="open" class="interop-panel sd-panel" :aria-label="mode === 'import' ? t('Diagramm importieren') : t('Diagramm exportieren')" data-testid="interop-panel">
    <div class="heading"><h2 class="sd-panel-title">{{ mode === 'import' ? t('Diagramm importieren') : t('Diagramm exportieren') }}</h2><button class="sd-icon-btn sd-panel-close" :aria-label="t('Austauschansicht schließen')" @click="emit('close')"><AppIcon name="close" /></button></div>
    <div class="panel-body">
      <p class="intro">{{ mode === 'import' ? t('Prüfe die Vorschau. Dein aktuelles Dokument bleibt bis zur Übernahme erhalten.') : t('Erstelle eine Austauschdatei aus dem aktuellen Dokument.') }}</p>
      <template v-if="mode === 'import'">
        <div class="file-picker">
          <span id="interop-file-label" class="file-label">{{ t('SVG-, draw.io- oder Mermaid-Datei auswählen') }}</span>
          <div class="file-row">
            <AppButton aria-describedby="interop-file-label" data-testid="interop-choose-file" :disabled="busy || store.state.transitioning" @click="fileInput?.click()"><AppIcon name="folder-open" :size="16" /> {{ t('Datei auswählen') }}</AppButton>
            <span class="file-name" :class="{ empty: !fileName }" data-testid="interop-file-name" role="status">{{ fileName || t('Keine Datei ausgewählt') }}</span>
          </div>
          <!-- The field of the operating system stays out of sight: its text follows the system, not the app (#278). -->
          <input ref="fileInput" class="visually-hidden" type="file" tabindex="-1" aria-hidden="true" data-testid="interop-file" accept=".svg,.drawio,.xml,.mmd,.mermaid,image/svg+xml,application/xml,text/xml,text/plain" :disabled="busy || store.state.transitioning" @change="readFile" />
        </div>
      </template>
      <AppSelect id="interop-format" class="interop-select" :model-value="format" :options="formatOptions" :label="t('Format')" @update:model-value="selectFormat" />
      <p v-if="format === 'mermaid'" class="metadata-note">{{ mode === 'import' ? t('Importiert werden Flowcharts (flowchart, graph) und Sequenzdiagramme (sequenceDiagram). Andere Diagrammtypen werden nicht importiert.') : activeMermaidTarget?.kind === 'sequence' ? t('Exportiert wird das Sequenzdiagramm als Mermaid-Code (sequenceDiagram).') : activeMermaidTarget?.kind === 'flow' ? t('Exportiert wird der Ablauf als Mermaid-Flowchart, mit demselben Code wie im Code-Panel.') : t('Exportiert wird ein Flowchart aus Formen, Texten, Komponenten und den Pfeilen dazwischen. Bilder, Tabellen, Freihandlinien und Teile von Sequenzdiagrammen gehören nicht dazu.') }}</p>
      <template v-if="mode === 'import'">
        <template v-if="format === 'mermaid'">
          <template v-if="largeFileSource">
            <p class="metadata-note">{{ t('Der Inhalt dieser großen Datei wird nicht im Textfeld angezeigt. Die vollständige Datei bleibt für Vorschau und Import erhalten.') }}</p>
            <AppButton class="full" :disabled="busy || store.state.transitioning" @click="startMermaidText">{{ t('Eigenen Mermaid-Code eingeben') }}</AppButton>
          </template>
          <label v-else class="sd-field-label" for="interop-mermaid-source">{{ t('Mermaid-Code einfügen') }}<textarea id="interop-mermaid-source" ref="mermaidInput" class="sd-input mermaid-source" :value="source" rows="7" spellcheck="false" autocapitalize="off" autocomplete="off" :disabled="busy || store.state.transitioning" @input="editSource" /></label>
          <AppButton class="full" :disabled="busy || store.state.transitioning || !source.trim()" @click="inspect">{{ t('Importvorschau erstellen') }}</AppButton>
        </template>
        <AppSelect v-if="pages.length > 1" id="interop-page" class="interop-select" :model-value="pageIndex === null ? '' : String(pageIndex)" :options="importPageOptions" :label="t('Seite auswählen')" @update:model-value="selectImportPage" />
        <div v-if="imported" class="import-summary"><h3>{{ imported.document.title }}</h3><p v-if="imported.document.pages.length > 1">{{ t('{count} Seiten', { count: imported.document.pages.length }) }}</p><p>{{ t('{count} Elemente · {fidelity}', { count: imported.document.elements.length, fidelity: imported.fidelity === 'own-roundtrip' ? t('Eigener unveränderter Roundtrip') : imported.fidelity === 'supported-subset' ? t('Unterstützte Formatteilmenge') : t('Mit Annäherungen konvertiert') }) }}</p><svg class="preview" :viewBox="previewBounds" role="img" :aria-label="t('Sichere Vorschau des konvertierten Diagramms')"><ElementView v-for="element in previewElements" :key="element.id" :element="element" :document="imported.document" :theme="store.state.theme" /></svg></div>
      </template>
      <template v-else>
        <AppSelect v-if="format !== 'drawio' && store.state.pages.length > 1" id="interop-export-page" v-model="exportPageId" class="interop-select" :options="exportPageOptions" :label="format === 'svg' ? t('Seite für den SVG-Export') : t('Seite für den Mermaid-Export')" :disabled="busy" />
        <AppSelect v-if="format === 'mermaid' && mermaidTargetOptions.length > 1" id="interop-mermaid-target" v-model="mermaidTarget" class="interop-select" :options="mermaidTargetOptions" :label="t('Diagramm')" :disabled="busy" />
        <label class="embed-option"><input v-model="embedDocument" type="checkbox" :disabled="busy" /><span>{{ t('Vollständiges Sketchdraw-Modell einbetten') }}</span></label><p class="metadata-note">{{ embedDocument ? t('Enthält auch nicht sichtbare Metadaten und ungenutzte Ressourcen. Damit kann ein unveränderter eigener Export vollständig zurückgelesen werden.') : t('Nur die sichtbare native Formatprojektion. Zusätzliche Sketchdraw-Informationen können verloren gehen.') }}</p>
        <AppButton class="full" :disabled="busy || store.state.transitioning" @click="prepareExport">{{ t('Exportvorschau erstellen') }}</AppButton>
        <p v-if="exported" class="summary">{{ exported.result.embedsDocument ? t('{format} vorbereitet · mit eingebettetem Dokument.', { format: formatName(exported.result.format) }) : t('{format} vorbereitet · ohne eingebettetes Dokument.', { format: formatName(exported.result.format) }) }}</p>
        <p v-if="staleExport" class="error" role="status">{{ t('Das Dokument oder ein Entwurf wurde geändert. Bitte die Exportvorschau neu erstellen.') }}</p>
      </template>
      <section v-if="failures.length" class="diagnostics" :aria-label="t('Grund des Fehlers')"><ul><li v-for="(item, index) in failures" :key="index" :class="item.severity"><strong>{{ item.sourceId || item.elementId || item.property || item.code }}</strong><span>{{ item.message }}</span><small v-if="item.sourcePath">{{ item.sourcePath }}</small></li></ul></section>
      <AppButton intent="primary" v-if="mode === 'import' && imported" class="full" :disabled="busy || store.state.transitioning" @click="applyImport">{{ t('Als neues Dokument öffnen') }}</AppButton>
      <AppButton v-if="mode === 'import' && imported && insertable" class="full" data-testid="interop-insert" :disabled="busy || store.state.transitioning || !store.state.canWrite" @click="insertImport">{{ t('In die aktuelle Seite einfügen') }}</AppButton>
      <AppButton intent="primary" v-if="mode === 'export' && exported" class="full" :disabled="busy || staleExport || store.state.transitioning" @click="writeExport">{{ t('Datei exportieren') }}</AppButton>
      <p v-if="busy" role="status" class="summary">{{ t('Wird geprüft …') }}</p><p v-if="error" role="alert" class="error">{{ error }}</p><p v-if="status" role="status" class="summary">{{ status }}</p>
    </div>
  </aside>
</template>

<style scoped>
.mermaid-source{display:block;width:100%;margin-top:6px;min-height:150px;resize:vertical;font-family:var(--font-mono);font-size:12px;line-height:1.5;tab-size:2}
.interop-panel{position:absolute;right:12px;top:var(--panel-top);bottom:72px;width:420px;z-index:22;display:flex;flex-direction:column;overflow:hidden}.heading{padding:8px 12px;display:flex;align-items:center;justify-content:space-between;border-bottom:1px solid var(--border-subtle)}h3{font-size:12px}.panel-body{padding:16px;overflow:auto;flex:1}.intro,.metadata-note,.summary,.file-name{font-size:12px;line-height:1.7;color:var(--text-muted);margin-bottom:14px}.file-picker{display:grid;gap:8px;margin-bottom:12px}.file-label{font-size:12px;font-weight:600}.file-row{display:flex;align-items:center;gap:10px;min-width:0}.file-row :deep(button){flex:none;display:inline-flex;align-items:center;gap:6px}.file-row .file-name{margin:0;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:var(--text-primary)}.file-row .file-name.empty{color:var(--text-muted)}.sd-field-label,.interop-select{margin-top:14px}.embed-option{display:flex;align-items:flex-start;gap:8px;font-size:12px;line-height:1.6;margin:14px 0}.embed-option input{margin-top:3px;accent-color:var(--accent)}.metadata-note{font-size:11px}.full{width:100%;margin:8px 0}.import-summary{margin:16px 0}.import-summary p{font-size:11px;color:var(--text-muted);margin:6px 0}.preview{width:100%;height:180px;border:1px solid var(--border-subtle);border-radius:6px;background:var(--surface-canvas);margin-top:8px}.diagnostics{margin:16px 0;border-top:1px solid var(--border-subtle);padding-top:14px}.diagnostics ul{margin-top:8px;max-height:220px;overflow:auto}.diagnostics li{font-size:11px;padding:8px;border-left:2px solid var(--border-default);background:var(--surface-raised);margin-bottom:5px;overflow-wrap:anywhere}.diagnostics strong,.diagnostics span,.diagnostics small{display:block}.diagnostics span{margin-top:3px;line-height:1.6}.diagnostics small{color:var(--text-muted);margin-top:4px}.diagnostics .warning{border-color:var(--status-error)}.error{font-size:12px;color:var(--status-error);line-height:1.7;margin:12px 0}@media(max-width:860px){.interop-panel{width:min(420px,calc(100vw - 24px))}}
</style>

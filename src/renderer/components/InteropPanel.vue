<script setup lang="ts">
import { t, tm } from '@/renderer/i18n';
import { computed, nextTick, onBeforeUnmount, ref, shallowRef, watch } from 'vue';
import { importDrawio, importMermaid, importSvg, inspectDrawio, INTEROP_LIMITS, InteropError, prepareDrawioExport, prepareMermaidExport, prepareSvgExport, type DrawioPageInfo, type InteropDiagnostic, type InteropExportResult, type InteropFormat, type InteropImportResult } from '@/interop';
import { getDesktopBridge } from '@/platform';
import type { DocumentAuthority } from '@/session';
import { useWhiteboard } from './use-whiteboard';
import { bounds } from '../lib/geometry';
import { suggestFileName } from '../lib/savestate';
import ElementView from './ElementView.vue';
import AppIcon from './AppIcon.vue';
import AppSelect from './AppSelect.vue';

const props = defineProps<{ open: boolean; mode: 'import' | 'export' }>();
const emit = defineEmits<{ close: [] }>();
const store = useWhiteboard(); const bridge = getDesktopBridge();
const format = ref<InteropFormat>('drawio'); const source = ref(''); const fileName = ref('');
const sourceFileBytes = ref(0); const mermaidInput = ref<HTMLTextAreaElement | null>(null);
const largeFileSource = computed(() => Boolean(fileName.value) && sourceFileBytes.value > 200 * 1024);
const pages = ref<DrawioPageInfo[]>([]); const pageIndex = ref<number | 'all' | null>(null);
const exportPageId = ref(store.state.activePageId);
const formatOptions = computed(() => [{ value: 'drawio', label: t('draw.io') }, { value: 'svg', label: 'SVG' }, { value: 'mermaid', label: t('Mermaid (Flowchart)') }]);
const importPageOptions = computed(() => [
  { value: '', label: t('Bitte eine der {count} Seiten auswählen', { count: pages.value.length }), disabled: true },
  { value: 'all', label: t('Alle {count} Seiten importieren', { count: pages.value.length }) },
  ...pages.value.map(item => ({ value: String(item.index), label: `${item.index + 1} · ${item.name}` })),
]);
const exportPageOptions = computed(() => store.state.pages.map(item => ({ value: item.id, label: tm(item.name) })));
const imported = shallowRef<InteropImportResult | null>(null);
const exported = shallowRef<{ result: InteropExportResult; authority: DocumentAuthority | null; revision: number; title: string } | null>(null);
const embedDocument = ref(true); const accepted = ref(false); const busy = ref(false); const error = ref(''); const status = ref('');
const failures = shallowRef<readonly InteropDiagnostic[]>([]); let serial = 0;
const diagnostics = computed(() => failures.value.length ? failures.value : props.mode === 'import' ? imported.value?.diagnostics ?? [] : exported.value?.result.diagnostics ?? []);
const warnings = computed(() => diagnostics.value.filter(item => item.severity === 'warning'));
const requiresConfirmation = computed(() => props.mode === 'import' ? imported.value?.requiresConfirmation === true : exported.value?.result.requiresConfirmation === true);
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
function clear() { serial++; source.value = ''; fileName.value = ''; sourceFileBytes.value = 0; pages.value = []; pageIndex.value = null; imported.value = null; exported.value = null; accepted.value = false; busy.value = false; error.value = ''; status.value = ''; failures.value = []; }
function failure(value: unknown) {
  error.value = value instanceof InteropError && value.code === 'MERMAID_DIAGRAM_UNSUPPORTED'
    ? t('Dieser Mermaid-Diagrammtyp wird nicht unterstützt. Verwende ein Flowchart mit flowchart oder graph. Dein Dokument bleibt erhalten.')
    : value instanceof InteropError ? t('Die Datei konnte nicht verarbeitet werden ({code}). Das aktuelle Dokument bleibt erhalten.', { code: value.code }) : t('Die Datei konnte nicht verarbeitet werden. Das aktuelle Dokument bleibt erhalten.');
  failures.value = value instanceof InteropError ? value.diagnostics : [];
}
function inspect() {
  imported.value = null; accepted.value = false; failures.value = []; error.value = ''; pages.value = []; pageIndex.value = null;
  if (!source.value) return;
  try {
    if (format.value === 'drawio') { pages.value = inspectDrawio(source.value); if (pages.value.length === 1) pageIndex.value = pages.value[0]!.index; }
    if (format.value !== 'drawio' || pageIndex.value !== null) convert();
  } catch (value) { failure(value); }
}
function convert() {
  accepted.value = false; error.value = ''; failures.value = []; imported.value = null;
  if (!source.value || (format.value === 'drawio' && pageIndex.value === null)) return;
  try { imported.value = format.value === 'svg' ? importSvg(source.value) : format.value === 'mermaid' ? importMermaid(source.value) : importDrawio(source.value, { pageIndex: pageIndex.value! }); }
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
  imported.value = null; accepted.value = false; failures.value = []; error.value = ''; status.value = '';
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
  if (!imported.value || busy.value || requiresConfirmation.value && !accepted.value) return;
  await store.importDocument(imported.value.document);
  // Dirty cancellation keeps this preview. Successful install clears it through the authority hook.
}
async function prepareExport() {
  const owner = store.getAuthority(); const own = ++serial; busy.value = true; error.value = ''; failures.value = []; accepted.value = false; exported.value = null; status.value = '';
  const selectedFormat = format.value, selectedPage = exportPageId.value, activePage = store.state.activePageId, embed = embedDocument.value;
  try {
    const snapshot = await store.prepareDocumentSnapshot();
    if (!snapshot || own !== serial || owner !== store.getAuthority()) return;
    const options = { embedDocument: embed, pageId: snapshot.document.pages.some(item => item.id === selectedPage) ? selectedPage : activePage };
    const result = selectedFormat === 'svg' ? prepareSvgExport(snapshot.document, options) : selectedFormat === 'mermaid' ? prepareMermaidExport(snapshot.document, options) : prepareDrawioExport(snapshot.document, { embedDocument: embed });
    exported.value = { result, authority: owner, revision: snapshot.revision, title: snapshot.document.title };
  } catch (value) { if (own === serial) failure(value); }
  finally { if (own === serial) busy.value = false; }
}
async function writeExport() {
  const preview = exported.value;
  if (!preview || busy.value || requiresConfirmation.value && !accepted.value) return;
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
watch([format, embedDocument, exportPageId], () => {
  serial++; busy.value = false; accepted.value = false; exported.value = null; imported.value = null; failures.value = []; error.value = ''; status.value = ''; pages.value = []; pageIndex.value = null;
  if (props.mode === 'import' && source.value && format.value !== 'mermaid') inspect();
}, { flush: 'sync' });
const unsubscribe = store.subscribeAuthority(() => { clear(); emit('close'); });
onBeforeUnmount(() => { unsubscribe(); clear(); });
</script>

<template>
  <aside v-if="open" class="interop-panel sd-panel" :aria-label="mode === 'import' ? t('Diagramm importieren') : t('Diagramm exportieren')" data-testid="interop-panel">
    <div class="heading"><h2 class="sd-panel-title">{{ mode === 'import' ? t('Diagramm importieren') : t('Diagramm exportieren') }}</h2><button class="sd-icon-btn sd-panel-close" :aria-label="t('Austauschansicht schließen')" @click="emit('close')"><AppIcon name="close" /></button></div>
    <div class="panel-body">
      <p class="intro">{{ mode === 'import' ? t('Prüfe die Vorschau und mögliche Änderungen. Dein aktuelles Dokument bleibt bis zur Übernahme erhalten.') : t('Erstelle eine Austauschdatei aus dem aktuellen Dokument. Vor der Ausgabe zeigen wir mögliche Verluste.') }}</p>
      <template v-if="mode === 'import'">
        <label class="file-picker">{{ t('SVG-, draw.io- oder Mermaid-Datei auswählen') }}<input type="file" accept=".svg,.drawio,.xml,.mmd,.mermaid,image/svg+xml,application/xml,text/xml,text/plain" :aria-label="t('Austauschdatei auswählen')" :disabled="busy || store.state.transitioning" @change="readFile" /></label>
        <p v-if="fileName" class="file-name">{{ fileName }}</p>
      </template>
      <AppSelect id="interop-format" class="interop-select" :model-value="format" :options="formatOptions" :label="t('Format')" @update:model-value="selectFormat" />
      <p v-if="format === 'mermaid'" class="metadata-note">{{ t('Unterstützt werden Mermaid-Flowcharts mit flowchart oder graph. Andere Diagrammtypen werden nicht importiert.') }}</p>
      <template v-if="mode === 'import'">
        <template v-if="format === 'mermaid'">
          <template v-if="largeFileSource">
            <p class="metadata-note">{{ t('Der Inhalt dieser großen Datei wird nicht im Textfeld angezeigt. Die vollständige Datei bleibt für Vorschau und Import erhalten.') }}</p>
            <button class="sd-btn full" :disabled="busy || store.state.transitioning" @click="startMermaidText">{{ t('Eigenen Mermaid-Code eingeben') }}</button>
          </template>
          <label v-else class="sd-field-label" for="interop-mermaid-source">{{ t('Mermaid-Code einfügen') }}<textarea id="interop-mermaid-source" ref="mermaidInput" class="sd-input mermaid-source" :value="source" rows="7" spellcheck="false" autocapitalize="off" autocomplete="off" :disabled="busy || store.state.transitioning" @input="editSource" /></label>
          <button class="sd-btn full" :disabled="busy || store.state.transitioning || !source.trim()" @click="inspect">{{ t('Importvorschau erstellen') }}</button>
        </template>
        <AppSelect v-if="pages.length > 1" id="interop-page" class="interop-select" :model-value="pageIndex === null ? '' : String(pageIndex)" :options="importPageOptions" :label="t('Seite auswählen')" @update:model-value="selectImportPage" />
        <div v-if="imported" class="import-summary"><h3>{{ imported.document.title }}</h3><p v-if="imported.document.pages.length > 1">{{ t('{count} Seiten', { count: imported.document.pages.length }) }}</p><p>{{ t('{count} Elemente · {fidelity}', { count: imported.document.elements.length, fidelity: imported.fidelity === 'own-roundtrip' ? t('Eigener unveränderter Roundtrip') : imported.fidelity === 'supported-subset' ? t('Unterstützte Formatteilmenge') : t('Mit Annäherungen konvertiert') }) }}</p><svg class="preview" :viewBox="previewBounds" role="img" :aria-label="t('Sichere Vorschau des konvertierten Diagramms')"><ElementView v-for="element in previewElements" :key="element.id" :element="element" :document="imported.document" :theme="store.state.theme" /></svg></div>
      </template>
      <template v-else>
        <AppSelect v-if="format !== 'drawio' && store.state.pages.length > 1" id="interop-export-page" v-model="exportPageId" class="interop-select" :options="exportPageOptions" :label="format === 'svg' ? t('Seite für den SVG-Export') : t('Seite für den Mermaid-Export')" :disabled="busy" />
        <label class="embed-option"><input v-model="embedDocument" type="checkbox" :disabled="busy" /><span>{{ t('Vollständiges Sketchdraw-Modell einbetten') }}</span></label><p class="metadata-note">{{ embedDocument ? t('Enthält auch nicht sichtbare Metadaten und ungenutzte Ressourcen. Damit kann ein unveränderter eigener Export vollständig zurückgelesen werden.') : t('Nur die sichtbare native Formatprojektion. Zusätzliche Sketchdraw-Informationen können verloren gehen.') }}</p>
        <button class="sd-btn full" :disabled="busy || store.state.transitioning" @click="prepareExport">{{ t('Exportvorschau erstellen') }}</button>
        <p v-if="exported" class="summary">{{ exported.result.embedsDocument ? t('{format} vorbereitet · mit eingebettetem Dokument.', { format: formatName(exported.result.format) }) : t('{format} vorbereitet · ohne eingebettetes Dokument.', { format: formatName(exported.result.format) }) }}</p>
        <p v-if="staleExport" class="error" role="status">{{ t('Das Dokument oder ein Entwurf wurde geändert. Bitte die Exportvorschau neu erstellen.') }}</p>
      </template>
      <section v-if="diagnostics.length" class="diagnostics" :aria-label="t('Konvertierungsbericht')"><h3>{{ warnings.length ? t('{count} Hinweise auf Verluste oder Annäherungen', { count: warnings.length }) : t('Hinweise zur Konvertierung') }}</h3><ul><li v-for="(item, index) in diagnostics" :key="index" :class="item.severity"><strong>{{ item.sourceId || item.elementId || item.property || item.code }}</strong><span>{{ item.message }}</span><small v-if="item.sourcePath">{{ item.sourcePath }}</small></li></ul></section>
      <label v-if="requiresConfirmation" class="loss-confirmation"><input v-model="accepted" type="checkbox" /><span>{{ t('Ich habe die beschriebenen Verluste und Annäherungen geprüft und akzeptiere sie für diese Konvertierung.') }}</span></label>
      <button v-if="mode === 'import' && imported" class="sd-btn sd-btn--primary full" :disabled="busy || store.state.transitioning || requiresConfirmation && !accepted" @click="applyImport">{{ t('Als neues Dokument öffnen') }}</button>
      <button v-if="mode === 'export' && exported" class="sd-btn sd-btn--primary full" :disabled="busy || staleExport || store.state.transitioning || requiresConfirmation && !accepted" @click="writeExport">{{ t('Datei exportieren') }}</button>
      <p v-if="busy" role="status" class="summary">{{ t('Wird geprüft …') }}</p><p v-if="error" role="alert" class="error">{{ error }}</p><p v-if="status" role="status" class="summary">{{ status }}</p>
    </div>
  </aside>
</template>

<style scoped>
.mermaid-source{display:block;width:100%;margin-top:6px;min-height:150px;resize:vertical;font-family:var(--font-mono);font-size:12px;line-height:1.5;tab-size:2}
.interop-panel{position:absolute;right:12px;top:var(--panel-top);bottom:72px;width:420px;z-index:22;display:flex;flex-direction:column;overflow:hidden}.heading{padding:8px 12px;display:flex;align-items:center;justify-content:space-between;border-bottom:1px solid var(--border-subtle)}h3{font-size:12px}.panel-body{padding:16px;overflow:auto;flex:1}.intro,.metadata-note,.summary,.file-name{font-size:12px;line-height:1.7;color:var(--text-muted);margin-bottom:14px}.file-picker{font-size:12px;display:block;margin-bottom:12px;font-weight:600}.file-picker input{display:block;margin-top:8px;max-width:100%;font-size:11px}.sd-field-label,.interop-select{margin-top:14px}.embed-option,.loss-confirmation{display:flex;align-items:flex-start;gap:8px;font-size:12px;line-height:1.6;margin:14px 0}.embed-option input,.loss-confirmation input{margin-top:3px;accent-color:var(--accent)}.metadata-note{font-size:11px}.full{width:100%;margin:8px 0}.import-summary{margin:16px 0}.import-summary p{font-size:11px;color:var(--text-muted);margin:6px 0}.preview{width:100%;height:180px;border:1px solid var(--border-subtle);border-radius:6px;background:var(--surface-canvas);margin-top:8px}.diagnostics{margin:16px 0;border-top:1px solid var(--border-subtle);padding-top:14px}.diagnostics ul{margin-top:8px;max-height:220px;overflow:auto}.diagnostics li{font-size:11px;padding:8px;border-left:2px solid var(--border-default);background:var(--surface-raised);margin-bottom:5px;overflow-wrap:anywhere}.diagnostics strong,.diagnostics span,.diagnostics small{display:block}.diagnostics span{margin-top:3px;line-height:1.6}.diagnostics small{color:var(--text-muted);margin-top:4px}.diagnostics .warning{border-color:var(--status-error)}.error{font-size:12px;color:var(--status-error);line-height:1.7;margin:12px 0}@media(max-width:860px){.interop-panel{width:min(420px,calc(100vw - 24px))}}
</style>

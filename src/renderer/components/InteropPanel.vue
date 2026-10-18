<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, ref, shallowRef, watch } from 'vue';
import { importDrawio, importSvg, inspectDrawio, INTEROP_LIMITS, InteropError, prepareDrawioExport, prepareSvgExport, type DrawioPageInfo, type InteropDiagnostic, type InteropExportResult, type InteropFormat, type InteropImportResult } from '@/interop';
import { getDesktopBridge } from '@/platform';
import type { DocumentAuthority } from '@/session';
import { useWhiteboard } from './use-whiteboard';
import { bounds } from '../lib/geometry';
import { suggestFileName } from '../lib/savestate';
import ElementView from './ElementView.vue';
import AppIcon from './AppIcon.vue';

const props = defineProps<{ open: boolean; mode: 'import' | 'export' }>();
const emit = defineEmits<{ close: [] }>();
const store = useWhiteboard(); const bridge = getDesktopBridge();
const format = ref<InteropFormat>('drawio'); const source = ref(''); const fileName = ref('');
const pages = ref<DrawioPageInfo[]>([]); const pageIndex = ref<number | null>(null);
const imported = shallowRef<InteropImportResult | null>(null);
const exported = shallowRef<{ result: InteropExportResult; authority: DocumentAuthority | null; revision: number; title: string } | null>(null);
const embedDocument = ref(true); const accepted = ref(false); const busy = ref(false); const error = ref(''); const status = ref('');
const failures = shallowRef<readonly InteropDiagnostic[]>([]); let serial = 0;
const diagnostics = computed(() => failures.value.length ? failures.value : props.mode === 'import' ? imported.value?.diagnostics ?? [] : exported.value?.result.diagnostics ?? []);
const warnings = computed(() => diagnostics.value.filter(item => item.severity === 'warning'));
const requiresConfirmation = computed(() => props.mode === 'import' ? imported.value?.requiresConfirmation === true : exported.value?.result.requiresConfirmation === true);
const staleExport = computed(() => exported.value !== null && (exported.value.authority !== store.getAuthority() || exported.value.revision !== store.state.revision || store.state.hasDraft));
const previewBounds = computed(() => {
  const rect = imported.value ? bounds(imported.value.document.elements) : null;
  return rect ? `${rect.x - 20} ${rect.y - 20} ${Math.max(80, rect.width + 40)} ${Math.max(80, rect.height + 40)}` : '0 0 400 200';
});
function clear() { serial++; source.value = ''; fileName.value = ''; pages.value = []; pageIndex.value = null; imported.value = null; exported.value = null; accepted.value = false; busy.value = false; error.value = ''; status.value = ''; failures.value = []; }
function failure(value: unknown) {
  error.value = value instanceof InteropError ? `Die Datei konnte nicht verarbeitet werden (${value.code}). Das aktuelle Dokument bleibt erhalten.` : 'Die Datei konnte nicht verarbeitet werden. Das aktuelle Dokument bleibt erhalten.';
  failures.value = value instanceof InteropError ? value.diagnostics : [];
}
function inspect() {
  imported.value = null; accepted.value = false; failures.value = []; error.value = ''; pages.value = []; pageIndex.value = null;
  if (!source.value) return;
  try {
    if (format.value === 'drawio') { pages.value = inspectDrawio(source.value); if (pages.value.length === 1) pageIndex.value = pages.value[0]!.index; }
    if (format.value === 'svg' || pageIndex.value !== null) convert();
  } catch (value) { failure(value); }
}
function convert() {
  accepted.value = false; error.value = ''; failures.value = []; imported.value = null;
  if (!source.value || (format.value === 'drawio' && pageIndex.value === null)) return;
  try { imported.value = format.value === 'svg' ? importSvg(source.value) : importDrawio(source.value, { pageIndex: pageIndex.value! }); }
  catch (value) { failure(value); }
}
async function readFile(event: Event) {
  const input = event.target as HTMLInputElement; const file = input.files?.[0]; input.value = '';
  if (!file) return;
  clear(); const own = serial; const authority = store.getAuthority(); busy.value = true;
  try {
    if (file.size > INTEROP_LIMITS.MAX_INPUT_BYTES) { error.value = 'Die Datei ist zu groß (maximal 96 MiB).'; return; }
    const contents = await file.text();
    if (own !== serial || authority !== store.getAuthority()) return;
    fileName.value = file.name; source.value = contents; format.value = /\.svg$/i.test(file.name) ? 'svg' : 'drawio';
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
  try {
    const snapshot = await store.prepareDocumentSnapshot();
    if (!snapshot || own !== serial || owner !== store.getAuthority()) return;
    const result = format.value === 'svg' ? prepareSvgExport(snapshot.document, { embedDocument: embedDocument.value }) : prepareDrawioExport(snapshot.document, { embedDocument: embedDocument.value });
    exported.value = { result, authority: owner, revision: snapshot.revision, title: snapshot.document.title };
  } catch (value) { if (own === serial) failure(value); }
  finally { if (own === serial) busy.value = false; }
}
async function writeExport() {
  const preview = exported.value;
  if (!preview || busy.value || requiresConfirmation.value && !accepted.value) return;
  if (preview.authority !== store.getAuthority() || preview.revision !== store.state.revision || store.state.hasDraft) { error.value = 'Bitte die Exportvorschau für den aktuellen Stand neu erstellen.'; return; }
  const own = serial; busy.value = true; error.value = '';
  try {
    const name = suggestFileName(preview.title).replace(/\.sketchdraw\.json$/, preview.result.suggestedExtension);
    const result = await bridge.exportFile(preview.result.contents, name, preview.result.format);
    if (own !== serial || preview.authority !== store.getAuthority()) return;
    if (result.status === 'error') error.value = `Export fehlgeschlagen: ${result.message}`;
    else if (result.status === 'exported') status.value = `Exportiert: ${result.name}`;
    else if (result.status === 'download-initiated') status.value = `Als Download übergeben: ${result.name}`;
    else status.value = 'Export abgebrochen. Das Dokument bleibt erhalten.';
  } catch { if (own === serial) error.value = 'Der Export konnte nicht ausgegeben werden. Das Dokument bleibt erhalten.'; }
  finally { if (own === serial) busy.value = false; }
}
watch(() => props.mode, clear);
watch(() => props.open, open => { if (!open) clear(); });
watch([format, embedDocument], () => { accepted.value = false; exported.value = null; if (props.mode === 'import' && source.value && !busy.value) inspect(); });
const unsubscribe = store.subscribeAuthority(() => { clear(); emit('close'); });
onBeforeUnmount(() => { unsubscribe(); clear(); });
</script>

<template>
  <aside v-if="open" class="interop-panel sd-panel" :aria-label="mode === 'import' ? 'Diagramm importieren' : 'Diagramm exportieren'" data-testid="interop-panel">
    <div class="heading"><h2 class="sd-panel-title">{{ mode === 'import' ? 'Diagramm importieren' : 'Diagramm exportieren' }}</h2><button class="sd-icon-btn sd-panel-close" aria-label="Austauschansicht schließen" @click="emit('close')"><AppIcon name="close" /></button></div>
    <div class="panel-body">
      <p class="intro">{{ mode === 'import' ? 'Prüfe die Vorschau und mögliche Änderungen. Dein aktuelles Dokument bleibt bis zur Übernahme erhalten.' : 'Erstelle eine Austauschdatei aus dem aktuellen Dokument. Vor der Ausgabe zeigen wir mögliche Verluste.' }}</p>
      <template v-if="mode === 'import'">
        <label class="file-picker">SVG- oder draw.io-Datei auswählen<input type="file" accept=".svg,.drawio,.xml,image/svg+xml,application/xml,text/xml" aria-label="Austauschdatei auswählen" :disabled="busy || store.state.transitioning" @change="readFile" /></label>
        <p v-if="fileName" class="file-name">{{ fileName }}</p>
      </template>
      <label class="sd-field-label" for="interop-format">Format<select id="interop-format" v-model="format" class="sd-select" :disabled="busy"><option value="drawio">draw.io</option><option value="svg">SVG</option></select></label>
      <template v-if="mode === 'import'">
        <label v-if="pages.length > 1" class="sd-field-label" for="interop-page">Seite auswählen<select id="interop-page" v-model="pageIndex" class="sd-select" @change="convert"><option :value="null" disabled>Bitte eine der {{ pages.length }} Seiten auswählen</option><option v-for="item in pages" :key="item.index" :value="item.index">{{ item.index + 1 }} · {{ item.name }}</option></select></label>
        <div v-if="imported" class="import-summary"><h3>{{ imported.document.title }}</h3><p>{{ imported.document.elements.length }} Elemente · {{ imported.fidelity === 'own-roundtrip' ? 'Eigener unveränderter Roundtrip' : imported.fidelity === 'supported-subset' ? 'Unterstützte Formatteilmenge' : 'Mit Annäherungen konvertiert' }}</p><svg class="preview" :viewBox="previewBounds" role="img" aria-label="Sichere Vorschau des konvertierten Diagramms"><ElementView v-for="element in imported.document.elements" :key="element.id" :element="element" :document="imported.document" :theme="store.state.theme" /></svg></div>
      </template>
      <template v-else>
        <label class="embed-option"><input v-model="embedDocument" type="checkbox" :disabled="busy" /><span>Vollständiges Sketchdraw-Modell einbetten</span></label><p class="metadata-note">{{ embedDocument ? 'Enthält auch nicht sichtbare Metadaten und ungenutzte Ressourcen. Damit kann ein unveränderter eigener Export vollständig zurückgelesen werden.' : 'Nur die sichtbare native Formatprojektion. Zusätzliche Sketchdraw-Informationen können verloren gehen.' }}</p>
        <button class="sd-btn full" :disabled="busy || store.state.transitioning" @click="prepareExport">Exportvorschau erstellen</button>
        <p v-if="exported" class="summary">{{ format === 'svg' ? 'SVG' : 'draw.io' }} vorbereitet · {{ exported.result.embedsDocument ? 'mit' : 'ohne' }} eingebettetes Dokument.</p>
        <p v-if="staleExport" class="error" role="status">Das Dokument oder ein Entwurf wurde geändert. Bitte die Exportvorschau neu erstellen.</p>
      </template>
      <section v-if="diagnostics.length" class="diagnostics" aria-label="Konvertierungsbericht"><h3>{{ warnings.length ? `${warnings.length} Hinweise auf Verluste oder Annäherungen` : 'Hinweise zur Konvertierung' }}</h3><ul><li v-for="(item, index) in diagnostics" :key="index" :class="item.severity"><strong>{{ item.sourceId || item.elementId || item.property || item.code }}</strong><span>{{ item.message }}</span><small v-if="item.sourcePath">{{ item.sourcePath }}</small></li></ul></section>
      <label v-if="requiresConfirmation" class="loss-confirmation"><input v-model="accepted" type="checkbox" /><span>Ich habe die beschriebenen Verluste und Annäherungen geprüft und akzeptiere sie für diese Konvertierung.</span></label>
      <button v-if="mode === 'import' && imported" class="sd-btn sd-btn--primary full" :disabled="busy || store.state.transitioning || requiresConfirmation && !accepted" @click="applyImport">Als neues Dokument öffnen</button>
      <button v-if="mode === 'export' && exported" class="sd-btn sd-btn--primary full" :disabled="busy || staleExport || store.state.transitioning || requiresConfirmation && !accepted" @click="writeExport">Datei exportieren</button>
      <p v-if="busy" role="status" class="summary">Wird geprüft …</p><p v-if="error" role="alert" class="error">{{ error }}</p><p v-if="status" role="status" class="summary">{{ status }}</p>
    </div>
  </aside>
</template>

<style scoped>
.interop-panel{position:absolute;right:12px;top:var(--panel-top);bottom:72px;width:420px;z-index:22;display:flex;flex-direction:column;overflow:hidden}.heading{padding:8px 12px;display:flex;align-items:center;justify-content:space-between;border-bottom:1px solid var(--border-subtle)}h3{font-size:12px}.panel-body{padding:16px;overflow:auto;flex:1}.intro,.metadata-note,.summary,.file-name{font-size:12px;line-height:1.7;color:var(--text-muted);margin-bottom:14px}.file-picker{font-size:12px;display:block;margin-bottom:12px;font-weight:600}.file-picker input{display:block;margin-top:8px;max-width:100%;font-size:11px}.sd-field-label{margin-top:14px}.sd-select{margin-top:5px}.embed-option,.loss-confirmation{display:flex;align-items:flex-start;gap:8px;font-size:12px;line-height:1.6;margin:14px 0}.embed-option input,.loss-confirmation input{margin-top:3px;accent-color:var(--accent)}.metadata-note{font-size:11px}.full{width:100%;margin:8px 0}.import-summary{margin:16px 0}.import-summary p{font-size:11px;color:var(--text-muted);margin:6px 0}.preview{width:100%;height:180px;border:1px solid var(--border-subtle);border-radius:6px;background:var(--surface-canvas);margin-top:8px}.diagnostics{margin:16px 0;border-top:1px solid var(--border-subtle);padding-top:14px}.diagnostics ul{margin-top:8px;max-height:220px;overflow:auto}.diagnostics li{font-size:11px;padding:8px;border-left:2px solid var(--border-default);background:var(--surface-raised);margin-bottom:5px;overflow-wrap:anywhere}.diagnostics strong,.diagnostics span,.diagnostics small{display:block}.diagnostics span{margin-top:3px;line-height:1.6}.diagnostics small{color:var(--text-muted);margin-top:4px}.diagnostics .warning{border-color:var(--status-error)}.error{font-size:12px;color:var(--status-error);line-height:1.7;margin:12px 0}@media(max-width:860px){.interop-panel{width:min(420px,calc(100vw - 24px))}}
</style>

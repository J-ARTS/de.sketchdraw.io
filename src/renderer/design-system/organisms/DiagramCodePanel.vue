<!-- @component The side panel with the Mermaid code of a sequence diagram or process; typing applies to the canvas and the canvas shows in the code. -->
<script setup lang="ts">
import AppButton from '@/renderer/design-system/atoms/AppButton.vue';
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import { t } from '@/renderer/i18n';
import { diagramCodeAnchor, diagramCodeDiagnostics, diagramCodeView, type DiagramCodeKind } from '@/renderer/lib/diagram-code';
import { readFlow } from '@/renderer/lib/flow-model';
import { readSequence } from '@/renderer/lib/sequence-model';
import { docToScreen } from '@/renderer/lib/viewport';
import AppIcon from '@/renderer/design-system/atoms/AppIcon.vue';
import { useWhiteboard } from '@/renderer/design-system/composables/use-whiteboard';

/**
 * The Mermaid code of a diagram beside the canvas (#203, #206): a `sequenceDiagram` for a sequence diagram,
 * a `flowchart` for a process (BPMN). It runs along in both directions: what is typed here is applied to the
 * diagram shortly after, as soon as it can be read, and what changes on the canvas shows up here at once.
 * The panel shows the diagram a selected element belongs to and stays with the last one when the selection
 * moves elsewhere.
 */
const APPLY_DELAY = 500;
const store = useWhiteboard();
const s = store.state;

const panel = ref<HTMLElement>();
const editor = ref<HTMLTextAreaElement>();
/** An element of the diagram the panel shows. */
const anchor = ref<string | null>(null);
const text = ref('');
/** The text as it was loaded or last applied: what the canvas shows. */
const base = ref('');
/** The canvas changed while there is unapplied text here. */
const stale = ref(false);
const failed = ref(false);
const composing = ref(false);
/** The code of the canvas that `base` stands for; our own applied text reads back differently formatted. */
let shown: string | null = null;
let applying = false;
let timer: ReturnType<typeof setTimeout> | undefined;

// The preview of a running gesture counts: the code follows a message while it is dragged.
const elements = computed(() => s.displayElements);
const view = computed(() => (anchor.value ? diagramCodeView(elements.value, anchor.value) : null));
const canonical = computed(() => view.value?.code ?? null);
const names = computed(() => view.value?.names ?? '');
/** The notation stays the one of the diagram that was loaded, also while its code cannot be read. */
const kind = ref<DiagramCodeKind>('sequence');
watch(() => view.value?.kind, (now) => { if (now) kind.value = now; }, { immediate: true });
const diagnostics = computed(() => diagramCodeDiagnostics(kind.value, text.value));
const errors = computed(() => diagnostics.value.filter((entry) => entry.severity === 'error'));
const dirty = computed(() => text.value !== base.value);
const selectedAnchor = computed(() => diagramCodeAnchor(elements.value, s.selection)?.anchorId ?? null);

function load(code: string): void {
  const caret = editor.value?.selectionStart ?? 0;
  const active = document.activeElement === editor.value;
  text.value = code; base.value = code; shown = code; stale.value = false; failed.value = false;
  if (active) void nextTick(() => editor.value?.setSelectionRange(Math.min(caret, code.length), Math.min(caret, code.length)));
}
// The panel follows the selection, but never away from text that is not applied yet.
watch(selectedAnchor, (id) => { if (id && !dirty.value) anchor.value = id; }, { immediate: true });
watch(canonical, (now) => {
  if (applying) return;
  if (now === null) { if (!dirty.value) { anchor.value = null; text.value = ''; base.value = ''; shown = null; } return; }
  if (now === shown) return;
  if (dirty.value) { stale.value = true; return; }
  load(now);
}, { immediate: true });

function schedule(): void {
  clearTimeout(timer);
  if (!dirty.value || errors.value.length || composing.value || stale.value) return;
  timer = setTimeout(() => { void apply(); }, APPLY_DELAY);
}
async function apply(force = false): Promise<void> {
  clearTimeout(timer);
  if (applying || !anchor.value || !dirty.value || errors.value.length || !s.canWrite || s.transitioning || (stale.value && !force)) return;
  const sent = text.value;
  applying = true;
  try {
    const id = await store.applyDiagramCode(sent, anchor.value);
    failed.value = !id;
    if (id) {
      anchor.value = id; base.value = sent; stale.value = false;
      await nextTick();
      shown = canonical.value;
    }
  } finally {
    applying = false;
    if (text.value !== sent) schedule();
  }
}
function onInput(event: Event): void {
  text.value = (event.target as HTMLTextAreaElement).value;
  failed.value = false;
  schedule();
}
/** Leaving the editor applies at once what was waiting. */
function onBlur(): void { if (dirty.value && !errors.value.length) void apply(); }
function onKeydown(event: KeyboardEvent): void {
  if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') { event.preventDefault(); void apply(); }
  else if (event.key === 'Escape') { event.preventDefault(); document.querySelector<HTMLElement>('[data-testid="whiteboard-canvas"]')?.focus(); }
}
function reload(): void { if (canonical.value !== null) load(canonical.value); }
/** Puts the cursor on the line a message is about. */
function goTo(line: number): void {
  const area = editor.value;
  if (!area) return;
  const lines = text.value.split('\n');
  const start = lines.slice(0, line - 1).reduce((total, entry) => total + entry.length + 1, 0);
  area.focus();
  area.setSelectionRange(start, start + (lines[line - 1]?.length ?? 0));
}
const status = computed(() => {
  if (failed.value) return t('Der Code konnte nicht übernommen werden. Das Diagramm ist unverändert.');
  if (stale.value) return t('Das Diagramm hat sich auf der Zeichenfläche geändert. Dein Code ist noch nicht übernommen.');
  if (errors.value.length) return t('Nicht übernommen, solange der Code Fehler hat.');
  if (!s.canWrite) return t('Schreibgeschützt: Der Code zeigt das Diagramm, Änderungen sind gerade nicht möglich.');
  return dirty.value ? t('Wird übernommen …') : t('Code und Zeichenfläche sind auf demselben Stand.');
});

/** The panel lies over the right of the canvas: a diagram underneath it moves into the free part. */
function reveal(): void {
  const canvas = document.querySelector<HTMLElement>('[data-testid="whiteboard-canvas"]')?.getBoundingClientRect();
  const own = panel.value?.getBoundingClientRect();
  const members = anchor.value ? (kind.value === 'sequence' ? readSequence(elements.value, anchor.value)?.members : readFlow(elements.value, anchor.value)?.members) : undefined;
  const lifelines = elements.value.filter((element) => members?.has(element.id) && element.kind !== 'connector');
  // Below the canvas (narrow windows) the panel covers nothing sideways.
  if (!canvas || !own || !lifelines.length || own.left - canvas.left < 200) return;
  const left = docToScreen(s.viewport, { x: Math.min(...lifelines.map((lifeline) => lifeline.x)), y: 0 }).x;
  const right = docToScreen(s.viewport, { x: Math.max(...lifelines.map((lifeline) => lifeline.x + lifeline.width)), y: 0 }).x;
  const free = own.left - canvas.left - 24;
  // As far left as needed, but the diagram's left edge stays in view.
  const dx = Math.max(free - right, Math.min(0, 24 - left));
  if (dx < 0) store.panBy(dx, 0);
}
onMounted(() => { void nextTick(() => { reveal(); editor.value?.focus(); }); });
onBeforeUnmount(() => { clearTimeout(timer); });
</script>

<template>
  <aside ref="panel" class="diagram-code-panel sd-panel" data-testid="diagram-code-panel" :data-kind="kind" :aria-label="t('Mermaid-Code')">
    <div class="heading">
      <h2 class="sd-panel-title">{{ kind === 'sequence' ? t('Sequenzdiagramm als Mermaid-Code') : t('Ablauf als Mermaid-Code') }}</h2>
      <button type="button" class="sd-icon-btn sd-panel-close" :aria-label="t('Mermaid-Code schließen')" @click="store.toggleDiagramCode(false)"><AppIcon name="close" /></button>
    </div>
    <template v-if="anchor && (view || dirty)">
      <p class="panel-intro"><span class="names" data-testid="diagram-code-names">{{ names }}</span>{{ kind === 'sequence'
        ? t('Was du tippst, erscheint gleich auf der Zeichenfläche; Abstände, Aktivierungen und Nummern entstehen automatisch.')
        : t('Was du tippst, erscheint gleich auf der Zeichenfläche. Neue Knoten stehen neben ihrem Vorgänger, alles andere bleibt an seinem Platz.') }}</p>
      <textarea
        ref="editor" class="code-editor sd-textarea" data-testid="diagram-code-editor" :value="text" :aria-label="t('Mermaid-Code des Diagramms')" :aria-invalid="errors.length > 0" aria-describedby="diagram-code-status"
        spellcheck="false" autocapitalize="off" autocomplete="off" wrap="off" :readonly="!s.canWrite"
        @input="onInput" @blur="onBlur" @keydown="onKeydown" @compositionstart="composing = true" @compositionend="composing = false; schedule()"
      />
      <ul v-if="diagnostics.length" class="diagnostics" :aria-label="t('Meldungen zum Code')">
        <li v-for="(entry, index) in diagnostics" :key="index" :class="entry.severity">
          <button type="button" class="message" @click="goTo(entry.line)">
            <span class="where">{{ t('Zeile {line}', { line: entry.line }) }}</span>
            <span class="kind">{{ entry.severity === 'error' ? t('Fehler') : t('Hinweis') }}</span>
            <span class="what">{{ entry.message }}</span>
          </button>
        </li>
      </ul>
      <div class="panel-footer">
        <p id="diagram-code-status" class="status" :class="{ problem: failed || stale || errors.length > 0 }" role="status" data-testid="diagram-code-status">{{ status }}</p>
        <template v-if="stale">
          <AppButton data-testid="diagram-code-reload" @click="reload">{{ t('Vom Diagramm laden') }}</AppButton>
          <!-- The names in the code of a process point at its shapes as they were; over a changed process they could point elsewhere. -->
          <AppButton intent="primary" v-if="kind === 'sequence'" :disabled="errors.length > 0 || !s.canWrite" @click="apply(true)">{{ t('Meinen Code übernehmen') }}</AppButton>
        </template>
      </div>
    </template>
    <p v-else class="panel-intro" data-testid="diagram-code-empty">{{ t('Wähle einen Teil eines Sequenzdiagramms oder eines Ablaufs (BPMN) aus, um seinen Mermaid-Code zu sehen. Beide findest du unter „Weitere Formen“ in den Bibliotheken.') }}</p>
  </aside>
</template>

<style scoped>
.diagram-code-panel{position:absolute;right:12px;top:var(--panel-top);bottom:72px;width:min(440px,calc(100vw - 285px));z-index:22;display:flex;flex-direction:column;overflow:hidden}
.heading{display:flex;flex-shrink:0;align-items:center;justify-content:space-between;padding:8px 12px;border-bottom:1px solid var(--border-subtle)}
.panel-intro{margin:0;padding:12px;color:var(--text-muted);font-size:12px;line-height:1.6}
.names{display:block;overflow:hidden;color:var(--text-primary);font-size:13px;font-weight:650;text-overflow:ellipsis;white-space:nowrap}
.code-editor{flex:1;box-sizing:border-box;width:calc(100% - 24px);min-height:120px;margin:0 12px;resize:none;font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;font-size:13px;line-height:1.55;tab-size:4;white-space:pre}
.code-editor[aria-invalid='true']{border-color:var(--status-error)}
.diagnostics{display:grid;flex-shrink:0;gap:4px;max-height:132px;margin:8px 12px 0;padding:0;overflow-y:auto;list-style:none}
.message{display:grid;grid-template-columns:auto auto 1fr;gap:8px;align-items:baseline;width:100%;padding:6px 8px;border:0;border-radius:8px;background:var(--surface-raised);color:inherit;font:inherit;font-size:12px;text-align:left;cursor:pointer}
.message:hover{background:var(--accent-soft)}
.message:focus-visible{outline:2px solid var(--focus-ring);outline-offset:2px}
.where{color:var(--text-muted);font-variant-numeric:tabular-nums}
.kind{font-weight:650}
.error .kind{color:var(--status-error)}
.panel-footer{display:flex;flex-shrink:0;flex-wrap:wrap;align-items:center;justify-content:flex-end;gap:8px;padding:10px 12px 12px}
.status{flex:1 1 100%;margin:0;color:var(--text-muted);font-size:12px;line-height:1.5}
.status.problem{color:var(--status-error)}
@media (max-width:760px){
  .diagram-code-panel{left:12px;right:12px;top:auto;bottom:72px;width:auto;height:min(46vh,360px)}
}
</style>

<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref } from 'vue';
import { t } from '@/renderer/i18n';
import { wrapTabFocus } from '@/renderer/lib/focus';
import { parseSequenceCode } from '@/renderer/lib/sequence-code';
import AppIcon from './AppIcon.vue';
import { useWhiteboard } from './use-whiteboard';

/**
 * The code of a sequence diagram (#200): shown in Mermaid notation, edited as text and applied as one step.
 * Modal, because the code replaces the whole diagram and the canvas must not change underneath it.
 */
const props = defineProps<{ code: string }>();
const emit = defineEmits<{ close: [] }>();
const store = useWhiteboard();

const dialog = ref<HTMLDialogElement>();
const editor = ref<HTMLTextAreaElement>();
const text = ref(props.code);
const busy = ref(false);
const failed = ref('');
let closing = false;

const diagnostics = computed(() => parseSequenceCode(text.value).diagnostics);
const errors = computed(() => diagnostics.value.filter((entry) => entry.severity === 'error'));
const changed = computed(() => text.value !== props.code);

function cancel(): void {
  if (!busy.value) { closing = true; emit('close'); }
}
/** Keys stay in the dialog (the workspace shortcuts must not see them); Tab cycles inside it. */
function onKeydown(event: KeyboardEvent): void {
  if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') { event.preventDefault(); void apply(); return; }
  // Tab indents in the editor instead of leaving it; Escape and Shift+Tab still get out.
  if (event.key === 'Tab' && !event.shiftKey && event.target === editor.value) {
    event.preventDefault();
    const area = editor.value!;
    const { selectionStart, selectionEnd } = area;
    text.value = `${text.value.slice(0, selectionStart)}    ${text.value.slice(selectionEnd)}`;
    void nextTick(() => { area.selectionStart = area.selectionEnd = selectionStart + 4; });
    return;
  }
  if (dialog.value) wrapTabFocus(event, dialog.value);
}
function onNativeClose(): void { if (!closing) cancel(); }
/** Puts the cursor on the line a message is about. */
function goTo(line: number): void {
  const area = editor.value;
  if (!area) return;
  const lines = text.value.split('\n');
  const start = lines.slice(0, line - 1).reduce((total, entry) => total + entry.length + 1, 0);
  area.focus();
  area.setSelectionRange(start, start + (lines[line - 1]?.length ?? 0));
}
async function apply(): Promise<void> {
  if (busy.value || errors.value.length) return;
  if (!changed.value) { cancel(); return; }
  busy.value = true;
  failed.value = '';
  try {
    if (await store.applySequenceCode(text.value)) { closing = true; emit('close'); }
    else failed.value = t('Der Code konnte nicht übernommen werden. Das Diagramm ist unverändert.');
  } finally { busy.value = false; }
}

onMounted(async () => {
  dialog.value?.showModal();
  await nextTick();
  editor.value?.focus();
  editor.value?.setSelectionRange(0, 0);
});
onBeforeUnmount(() => { closing = true; dialog.value?.close(); });
</script>

<template>
  <dialog ref="dialog" class="sequence-code-dialog sd-panel" aria-labelledby="sequence-code-title" aria-describedby="sequence-code-subtitle" @cancel.prevent="cancel" @close="onNativeClose" @keydown.stop="onKeydown">
    <form class="sequence-code" data-testid="sequence-code-dialog" novalidate @submit.prevent="apply">
      <header class="dialog-header">
        <span class="badge" aria-hidden="true"><AppIcon name="code" :size="22" /></span>
        <div class="dialog-heading">
          <h2 id="sequence-code-title">{{ t('Sequenzdiagramm als Code') }}</h2>
          <p id="sequence-code-subtitle">{{ t('Schreibweise wie bei Mermaid. Abstände, Aktivierungen und Nummern entstehen automatisch.') }}</p>
        </div>
        <button type="button" class="close" :aria-label="t('Dialog schließen')" :disabled="busy" @click="cancel"><AppIcon name="close" :size="18" /></button>
      </header>

      <div class="dialog-body">
        <textarea ref="editor" v-model="text" class="code sd-textarea" data-testid="sequence-code" :aria-label="t('Code des Sequenzdiagramms')" :aria-invalid="errors.length > 0" aria-describedby="sequence-code-messages" spellcheck="false" autocapitalize="off" autocomplete="off" wrap="off" rows="16" />
        <div id="sequence-code-messages" class="messages" aria-live="polite">
          <ul v-if="diagnostics.length" :aria-label="t('Meldungen zum Code')">
            <li v-for="(entry, index) in diagnostics" :key="index" :class="entry.severity">
              <button type="button" class="message" @click="goTo(entry.line)">
                <span class="where">{{ t('Zeile {line}', { line: entry.line }) }}</span>
                <span class="kind">{{ entry.severity === 'error' ? t('Fehler') : t('Hinweis') }}</span>
                <span class="what">{{ entry.message }}</span>
              </button>
            </li>
          </ul>
          <p v-else class="fine">{{ t('Der Code ist lesbar.') }}</p>
          <p v-if="failed" class="failed" role="alert">{{ failed }}</p>
        </div>
      </div>

      <footer class="dialog-footer">
        <span class="hint">{{ t('Beispiel: A->>B: Aufruf · B-->>A: Antwort · A-)B: asynchron · loop … end') }}</span>
        <button type="button" class="sd-btn footer-button" :disabled="busy" @click="cancel">{{ t('Abbrechen') }}</button>
        <button type="submit" class="sd-btn sd-btn--primary footer-button" data-testid="sequence-code-apply" :disabled="busy || errors.length > 0">{{ t('Übernehmen') }}</button>
      </footer>
    </form>
  </dialog>
</template>

<style scoped>
.sequence-code-dialog{width:min(720px,calc(100vw - 32px));max-height:calc(100vh - 32px);padding:0;overflow:hidden;border-radius:20px;color:var(--text-primary)}
.sequence-code-dialog[open]{display:flex}
.sequence-code-dialog::backdrop{background:var(--scrim)}
.sequence-code{display:flex;flex:1;flex-direction:column;min-width:0;min-height:0}
.dialog-header{display:flex;flex:none;align-items:center;gap:14px;padding:20px 24px 14px}
.badge{display:grid;flex:none;place-items:center;width:44px;height:44px;border-radius:12px;background:var(--accent-soft);color:var(--accent)}
.dialog-heading{flex:1;min-width:0}
.dialog-heading h2{margin:0;font-size:19px;font-weight:700;line-height:1.2}
.dialog-heading p{margin:3px 0 0;color:var(--text-muted);font-size:13px}
.close{display:grid;flex:none;width:36px;height:36px;padding:0;place-items:center;border:1px solid var(--border-subtle);border-radius:10px;background:var(--surface-panel);color:var(--text-primary);cursor:pointer}
.close:hover:not(:disabled){background:var(--surface-raised)}
.close:focus-visible,.message:focus-visible{outline:2px solid var(--focus-ring);outline-offset:2px}
.dialog-body{display:flex;flex:1;flex-direction:column;gap:12px;min-height:0;padding:6px 24px 16px;overflow-y:auto}
.code{flex:1;width:100%;min-height:240px;resize:vertical;font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;font-size:13px;line-height:1.55;tab-size:4;white-space:pre}
.code[aria-invalid='true']{border-color:var(--status-error)}
.messages ul{display:grid;gap:4px;margin:0;padding:0;list-style:none;max-height:132px;overflow-y:auto}
.message{display:grid;grid-template-columns:auto auto 1fr;gap:10px;align-items:baseline;width:100%;padding:6px 10px;border:0;border-radius:8px;background:var(--surface-raised);color:inherit;font:inherit;font-size:13px;text-align:left;cursor:pointer}
.message:hover{background:var(--accent-soft)}
.where{color:var(--text-muted);font-variant-numeric:tabular-nums}
.kind{font-weight:650}
.error .kind{color:var(--status-error)}
.hint .kind{color:var(--text-muted)}
.fine{margin:0;color:var(--text-muted);font-size:13px}
.failed{margin:8px 0 0;color:var(--status-error);font-size:13px}
.dialog-footer{display:flex;flex:none;flex-wrap:wrap;align-items:center;justify-content:flex-end;gap:10px;padding:14px 24px 20px;border-top:1px solid var(--border-subtle)}
.hint{flex:1;min-width:200px;color:var(--text-muted);font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;font-size:12px}
.footer-button{min-width:120px}
@media (max-width:560px){
  .dialog-header{padding:16px 16px 12px}.dialog-body{padding:4px 16px 12px}.dialog-footer{padding:12px 16px 16px}.hint{display:none}
}
</style>

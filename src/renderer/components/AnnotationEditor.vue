<script setup lang="ts">
import { t } from '@/renderer/i18n';
import { nextTick, onMounted, ref } from 'vue';
import { useEventListener } from '@vueuse/core';
import { annotationPlainText } from '@/domain';
import { ANNOTATION_FORMAT_EVENT, annotationFromEditable, annotationToEditorHtml, type AnnotationFormatCommand } from '@/renderer/lib/annotation';
import { useWhiteboard } from './use-whiteboard';

const store = useWhiteboard();
const s = store.state;
const root = ref<HTMLElement | null>(null);
let savedRange: Range | null = null;

function syncDraft(): void {
  const element = root.value;
  if (!element) return;
  const annotation = annotationFromEditable(element);
  store.setAnnotationDraft(annotation, annotationPlainText(annotation));
}

function rememberSelection(): void {
  const element = root.value;
  const selection = window.getSelection();
  if (!element || !selection?.rangeCount) return;
  const range = selection.getRangeAt(0);
  if (element.contains(range.commonAncestorContainer)) savedRange = range.cloneRange();
}

function restoreSelection(range = savedRange): void {
  const selection = window.getSelection();
  if (!selection || !range || !root.value?.contains(range.commonAncestorContainer)) return;
  selection.removeAllRanges();
  selection.addRange(range);
}

function format(event: Event): void {
  const detail = (event as CustomEvent<{ command: AnnotationFormatCommand; value?: string }>).detail;
  if (!detail || !root.value) return;
  const range = savedRange?.cloneRange() ?? null;
  root.value.focus({ preventScroll: true });
  restoreSelection(range);
  const block = detail.command.startsWith('heading-') ? `H${detail.command.at(-1)}`
    : detail.command === 'paragraph' ? 'P'
      : detail.command === 'quote' ? 'BLOCKQUOTE' : null;
  if (block) document.execCommand('formatBlock', false, block);
  else if (detail.command === 'bold' || detail.command === 'italic' || detail.command === 'underline') document.execCommand(detail.command);
  else if (detail.command === 'bullet') document.execCommand('insertUnorderedList');
  else if (detail.command === 'numbered') document.execCommand('insertOrderedList');
  else if (detail.command === 'color' && detail.value) document.execCommand('foreColor', false, detail.value);
  syncDraft();
  rememberSelection();
}

function onPaste(event: ClipboardEvent): void {
  event.preventDefault();
  document.execCommand('insertText', false, event.clipboardData?.getData('text/plain') ?? '');
  syncDraft();
}

function onKeydown(event: KeyboardEvent): void {
  if (event.key === 'Enter' && (event.metaKey || event.ctrlKey) && !event.isComposing) {
    event.preventDefault();
    store.commitTextEdit();
  }
}

useEventListener(window, ANNOTATION_FORMAT_EVENT, format);
useEventListener(document, 'selectionchange', rememberSelection);

onMounted(async () => {
  const edit = store.state.textEdit;
  if (root.value && edit?.annotationDraft) root.value.innerHTML = annotationToEditorHtml(edit.annotationDraft);
  await nextTick();
  root.value?.focus({ preventScroll: true });
  const selection = window.getSelection();
  if (root.value && selection) {
    const range = document.createRange();
    range.selectNodeContents(root.value);
    selection.removeAllRanges();
    selection.addRange(range);
    savedRange = range.cloneRange();
  }
});
</script>

<template>
  <div
    ref="root"
    class="annotation-editor"
    data-testid="annotation-editor"
    :contenteditable="s.transitioning || !s.canWrite ? 'false' : 'true'"
    role="textbox"
    :aria-label="t('Annotation bearbeiten')"
    aria-multiline="true"
    :aria-disabled="s.transitioning || !s.canWrite"
    aria-keyshortcuts="Escape Control+Enter Meta+Enter"
    spellcheck="true"
    @input="syncDraft"
    @paste="onPaste"
    @keydown="onKeydown"
    @compositionstart="store.setComposing(true)"
    @compositionend="store.setComposing(false); syncDraft()"
  />
</template>

<style scoped>
.annotation-editor{width:100%;height:100%;box-sizing:border-box;padding:calc(28px * var(--annotation-zoom));overflow:auto;background:transparent;color:var(--edit-color);caret-color:var(--edit-color);font:inherit;line-height:1.5;outline:0;pointer-events:auto;white-space:normal;overflow-wrap:anywhere}.annotation-editor :deep(p),.annotation-editor :deep(h1),.annotation-editor :deep(h2),.annotation-editor :deep(h3),.annotation-editor :deep(h4),.annotation-editor :deep(blockquote),.annotation-editor :deep(ul),.annotation-editor :deep(ol){margin-top:0;margin-bottom:.72em}.annotation-editor :deep(h1){font-size:1.8em;line-height:1.16}.annotation-editor :deep(h2){font-size:1.5em}.annotation-editor :deep(h3){font-size:1.28em}.annotation-editor :deep(h4){font-size:1.12em}.annotation-editor :deep(blockquote){margin-left:0;padding:.35em 1em;border-left:.25em solid #1d4ed8;border-radius:0 8px 8px 0;background:#e3efff;color:#1e293b}.annotation-editor :deep(ul),.annotation-editor :deep(ol){padding-left:1.5em;list-style-position:outside}.annotation-editor :deep(ul){list-style-type:disc}.annotation-editor :deep(ol){list-style-type:decimal}
</style>

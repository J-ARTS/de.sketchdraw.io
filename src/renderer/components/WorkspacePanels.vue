<script setup lang="ts">
import { t } from '@/renderer/i18n';
import { nextTick, ref } from 'vue';
import { useWhiteboard } from './use-whiteboard';
import AppIcon from './AppIcon.vue';
import ShapeLibraryPanel from './ShapeLibraryPanel.vue';
const store = useWhiteboard(); const s = store.state;
const resetConfirm = ref(false); const codeEditor = ref<HTMLTextAreaElement>();
function diagnostic(line: number, column: number) {
  const offset = s.code.text.split('\n').slice(0, line - 1).reduce((total, text) => total + text.length + 1, 0) + column - 1;
  codeEditor.value?.focus(); codeEditor.value?.setSelectionRange(offset, offset + 1);
}

// Objects: the list order is the stacking order (first = back). Drag and drop or Alt+Up/Down changes it.
const dragId = ref<string | null>(null);
const dropAt = ref<{ id: string; after: boolean } | null>(null);
function onDragStart(event: DragEvent, id: string): void {
  if (!s.canWrite) { event.preventDefault(); return; }
  dragId.value = id;
  if (event.dataTransfer) { event.dataTransfer.effectAllowed = 'move'; event.dataTransfer.setData('text/plain', id); }
}
function onDragOver(event: DragEvent, id: string): void {
  if (!dragId.value || dragId.value === id) { dropAt.value = null; return; }
  event.preventDefault();
  const box = (event.currentTarget as HTMLElement).getBoundingClientRect();
  dropAt.value = { id, after: event.clientY > box.top + box.height / 2 };
}
function onDrop(id: string, index: number): void {
  const source = dragId.value; const at = dropAt.value;
  onDragEnd();
  if (!source || source === id || !at) return;
  const from = s.objectList.findIndex((item) => item.id === source);
  let target = at.after ? index + 1 : index;
  if (from < target) target -= 1;
  store.moveObject(source, target);
}
function onDragEnd(): void { dragId.value = null; dropAt.value = null; }
function onObjectKeydown(event: KeyboardEvent, id: string, index: number): void {
  if (!event.altKey || !['ArrowUp', 'ArrowDown'].includes(event.key) || !s.canWrite) return;
  event.preventDefault();
  void store.moveObject(id, index + (event.key === 'ArrowUp' ? -1 : 1)).then(() => nextTick(() => document.querySelector<HTMLElement>(`[data-object-id="${id}"] button`)?.focus()));
}
</script>

<template>
  <aside v-if="s.codeOpen" class="workspace-panel code-panel sd-panel" :aria-label="t('Diagramm als Code')">
    <div class="heading"><h2 class="sd-panel-title">{{ t('Diagramm als Code') }} <span v-if="s.code.dirty" :aria-label="t('Ungespeicherter Codeentwurf')">●</span></h2><button class="sd-icon-btn sd-panel-close" :aria-label="t('Codeansicht schließen')" @click="store.toggleCode()"><AppIcon name="close" /></button></div>
    <p class="panel-intro">{{ t('Canvas und Code, ein Diagramm. Änderungen werden mit „Übernehmen“ geprüft.') }}</p>
    <p v-if="s.code.dirty && s.code.baseRevision !== s.revision" class="conflict" role="status">{{ t('Das Canvas hat sich geändert. Dein Code bleibt erhalten. Kopiere deine Änderungen vor dem bewussten Neuladen.') }}</p>
    <textarea ref="codeEditor" class="code-editor sd-textarea" :aria-label="t('Diagrammcode')" data-testid="diagram-code" @compositionstart="store.setInputComposing(true)" @compositionend="store.setInputComposing(false)" spellcheck="false" autocapitalize="off" :disabled="s.transitioning || !s.canWrite" :value="s.code.text" @input="store.setCodeDraft(($event.target as HTMLTextAreaElement).value)" />
    <ul v-if="s.code.diagnostics.length" class="diagnostics" :aria-label="t('Codefehler')"><li v-for="(item, i) in s.code.diagnostics" :key="i"><button @click="diagnostic(item.line, item.column)">{{ t('Zeile {line}, Spalte {column}: {message}', { line: item.line, column: item.column, message: item.message }) }}</button></li></ul>
    <div v-if="resetConfirm" class="reset-confirm"><p>{{ t('Deinen Codeentwurf verwerfen und den aktuellen Canvas-Code laden?') }}</p><button class="sd-btn sd-btn--danger" @click="store.resetCodeDraft(); resetConfirm = false">{{ t('Entwurf verwerfen') }}</button><button class="sd-btn" @click="resetConfirm = false">{{ t('Behalten') }}</button></div>
    <div class="panel-footer"><button class="sd-btn" :disabled="s.transitioning || !s.canWrite" @click="s.code.dirty ? resetConfirm = true : store.resetCodeDraft()">{{ t('Vom Canvas laden') }}</button><button class="sd-btn sd-btn--primary" :disabled="!s.code.dirty || s.transitioning || !s.canWrite" @click="store.applyCode()">{{ t('Übernehmen') }}</button></div>
  </aside>
  <ShapeLibraryPanel v-if="s.catalogOpen" />
  <aside v-if="s.objectsOpen && !s.codeOpen && !s.catalogOpen" id="objects-drawer" class="workspace-panel sd-panel" :aria-label="t('Objekte')">
    <div class="heading"><h2 class="sd-panel-title">{{ t('Objekte') }} <span>{{ s.objectList.length }}</span></h2><button class="sd-icon-btn sd-panel-close" :aria-label="t('Objekte schließen')" @click="store.toggleObjects(false)"><AppIcon name="close" /></button></div>
    <p v-if="!s.objectList.length" class="panel-intro">{{ t('Deine Elemente erscheinen hier. Mit einem Klick wählst du sie aus.') }}</p>
    <ul class="object-list" data-testid="object-list"><li v-for="(item, index) in s.objectList" :key="item.id" :draggable="s.canWrite" :data-object-id="item.id" :class="{ dragging: dragId === item.id, 'drop-before': dropAt?.id === item.id && dropAt.after === false, 'drop-after': dropAt?.id === item.id && dropAt.after === true }" @dragstart="onDragStart($event, item.id)" @dragover="onDragOver($event, item.id)" @drop.prevent="onDrop(item.id, index)" @dragend="onDragEnd"><button :aria-pressed="item.selected" :aria-keyshortcuts="s.canWrite ? 'Alt+ArrowUp Alt+ArrowDown' : undefined" :title="s.canWrite ? t('Ziehen oder Alt+↑/↓ ändert die Reihenfolge') : undefined" :style="{ paddingLeft: `${12 + Math.min(item.depth, 8) * 12}px` }" @click="store.select([item.id], $event.shiftKey)" @dblclick="store.focusElement(item.id)" @keydown="onObjectKeydown($event, item.id, index)"><span class="object-dot" aria-hidden="true">{{ item.kind === 'container' ? '▣' : '◇' }}</span>{{ item.name }}</button></li></ul>
  </aside>
</template>

<style scoped>
.workspace-panel{position:absolute;right:12px;top:var(--panel-top);bottom:72px;width:320px;z-index:22;display:flex;flex-direction:column;overflow:hidden}.code-panel{width:min(520px,calc(100vw - 285px))}.heading{padding:8px 12px;display:flex;justify-content:space-between;align-items:center;border-bottom:1px solid var(--border-subtle);flex-shrink:0}h2 span{color:var(--accent);margin-left:8px}.panel-intro{font-size:12px;color:var(--text-muted);padding:12px;line-height:1.6}.code-editor{flex:1;min-height:100px;resize:none;border:0;border-radius:0;background:var(--surface-panel);font:12px/1.7 var(--font-mono);tab-size:2;padding:12px;white-space:pre;overflow:auto}.panel-footer{display:flex;justify-content:space-between;gap:8px;border-top:1px solid var(--border-subtle);padding:12px}.conflict,.reset-confirm{background:var(--status-error-soft);font-size:12px;padding:12px}.reset-confirm button{margin-top:8px}.diagnostics{max-height:160px;overflow:auto;border-top:1px solid var(--border-subtle)}.diagnostics button{background:transparent;border:0;text-align:left;color:var(--status-error);font-size:12px;padding:8px 12px;cursor:pointer;width:100%;min-height:32px}.object-list{overflow:auto;flex:1}.object-list button:hover{background:var(--surface-raised)}.object-list button{display:flex;align-items:center;gap:10px;min-height:40px;width:100%;padding:8px;border:0;background:transparent;text-align:left;cursor:pointer;font-size:12px;overflow-wrap:anywhere}.object-list button[aria-pressed=true]{background:var(--accent-soft);color:var(--accent)}.object-dot{font-size:20px;flex-shrink:0}@media (max-width:860px){.workspace-panel,.code-panel{width:min(420px,calc(100vw - 24px))}}
.object-list li{position:relative}.object-list li.dragging{opacity:.45}.object-list li.drop-before::before,.object-list li.drop-after::after{content:'';position:absolute;left:8px;right:8px;height:2px;border-radius:2px;background:var(--accent);pointer-events:none}.object-list li.drop-before::before{top:-1px}.object-list li.drop-after::after{bottom:-1px}
</style>

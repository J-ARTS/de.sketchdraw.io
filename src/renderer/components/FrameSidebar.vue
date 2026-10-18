<script setup lang="ts">
import { nextTick, ref } from 'vue';
import AppIcon from './AppIcon.vue';
import FramePreview from './FramePreview.vue';
import { useWhiteboard } from './use-whiteboard';

const store = useWhiteboard();
const s = store.state;
const editingId = ref<string | null>(null);
const nameDraft = ref('');
const draggingId = ref<string | null>(null);

async function edit(id: string, name: string): Promise<void> {
  editingId.value = id; nameDraft.value = name;
  await nextTick();
  const input = document.querySelector<HTMLInputElement>('.frame-sidebar input[aria-label="Folienname"]');
  input?.focus(); input?.select();
}
function commit(): void {
  if (editingId.value) store.renameFrame(editingId.value, nameDraft.value);
  editingId.value = null;
}
function drop(toIndex: number): void {
  if (draggingId.value) store.moveFrame(draggingId.value, toIndex);
  draggingId.value = null;
}
function cardKey(event: KeyboardEvent, id: string, index: number): void {
  if (event.altKey && (event.key === 'ArrowUp' || event.key === 'ArrowDown')) {
    event.preventDefault(); store.moveFrame(id, index + (event.key === 'ArrowDown' ? 1 : -1));
  }
}
</script>

<template>
  <aside v-if="s.frameSidebarOpen && s.workspaceView === 'canvas'" class="frame-sidebar sd-panel" data-testid="frame-sidebar" aria-label="Folien">
    <header><div><span class="eyebrow">PRÄSENTATION</span><h2>Folien</h2></div><button class="sd-icon-btn" aria-label="Folienleiste schließen" @click="store.toggleFrameSidebar(false)"><AppIcon name="close" /></button></header>
    <button class="present sd-btn" :disabled="!s.frameSlides.length" @click="store.startPresentation()"><AppIcon name="maximize" /> Präsentieren</button>
    <p v-if="!s.frameSlides.length" class="empty">Ziehe mit <kbd>F</kbd> einen Frame auf. Jeder Frame wird hier als Folie angezeigt.</p>
    <ol v-else class="slides">
      <li v-for="(frame, index) in s.frameSlides" :key="frame.id" :class="{ active: s.selection.includes(frame.id) }" draggable="true" @dragstart="draggingId = frame.id" @dragover.prevent @drop.prevent="drop(index)">
        <button class="slide-card" :aria-label="`${frame.label || `Folie ${index + 1}`}, Folie ${index + 1} auswählen`" @click="store.focusFrame(frame.id)" @dblclick="edit(frame.id, frame.label || `Folie ${index + 1}`)" @keydown="cardKey($event, frame.id, index)">
          <span class="index">{{ index + 1 }}</span>
          <span class="thumb"><FramePreview :frame="frame" :document="s.document" :theme="s.theme" /></span>
        </button>
        <div class="slide-meta">
          <input v-if="editingId === frame.id" v-model="nameDraft" maxlength="120" aria-label="Folienname" @keydown.enter.prevent="commit" @keydown.escape.prevent="editingId = null" @blur="commit" />
          <button v-else class="name" :title="'Doppelklick zum Umbenennen'" @dblclick="edit(frame.id, frame.label || `Folie ${index + 1}`)">{{ frame.label || `Folie ${index + 1}` }}</button>
          <span>{{ Math.round(frame.width) }} × {{ Math.round(frame.height) }}</span>
          <button class="grip sd-icon-btn" aria-label="Folie ziehen; Alt und Pfeiltasten ändern die Reihenfolge"><AppIcon name="grip" /></button>
        </div>
      </li>
    </ol>
    <p class="hint">Doppelklick benennt um · Ziehen oder Alt+↑/↓ sortiert</p>
  </aside>
</template>

<style scoped>
.frame-sidebar{position:absolute;top:var(--panel-top);right:16px;bottom:16px;z-index:22;width:280px;display:flex;flex-direction:column;padding:14px;overflow:hidden}.frame-sidebar header{display:flex;align-items:center;justify-content:space-between;margin-bottom:10px}.frame-sidebar h2{font-size:18px;margin:2px 0 0}.eyebrow{font-size:9px;letter-spacing:.16em;color:var(--accent);font-weight:750}.present{display:flex;align-items:center;justify-content:center;gap:8px;width:100%;margin-bottom:12px}.present :deep(svg){width:17px}.empty{padding:28px 18px;text-align:center;color:var(--text-muted);font-size:12px;line-height:1.6}.empty kbd{padding:2px 6px;border:1px solid var(--border-default);border-radius:5px}.slides{display:grid;gap:12px;overflow:auto;list-style:none;padding:2px;margin:0}.slides li{position:relative;padding:8px;border:1px solid var(--border-subtle);border-radius:12px;background:var(--surface-raised)}.slides li.active{border-color:var(--accent);box-shadow:0 0 0 2px var(--accent-soft)}.slide-card{position:relative;width:100%;padding:0;border:0;border-radius:8px;overflow:hidden;background:var(--surface-canvas);aspect-ratio:16/9;cursor:pointer}.thumb{position:absolute;inset:0}.index{position:absolute;top:6px;left:6px;z-index:2;display:grid;place-items:center;min-width:22px;height:22px;padding:0 5px;border-radius:6px;background:color-mix(in srgb,var(--surface-panel) 88%,transparent);font-size:11px;font-weight:700}.slide-meta{display:grid;grid-template-columns:minmax(0,1fr) auto 30px;align-items:center;gap:5px;margin-top:7px}.slide-meta input,.name{min-width:0;width:100%;border:0;background:transparent;color:var(--text-primary);font:inherit;font-size:12px;font-weight:650;text-align:left;padding:3px}.slide-meta input{outline:1px solid var(--accent);border-radius:4px}.slide-meta>span{font-size:9px;color:var(--text-muted)}.grip{width:28px;height:28px;color:var(--text-muted)}.hint{margin:10px 0 0;text-align:center;font-size:9px;color:var(--text-muted)}
@media(max-width:760px){.frame-sidebar{right:8px;bottom:8px;width:min(270px,calc(100vw - 16px))}}
</style>

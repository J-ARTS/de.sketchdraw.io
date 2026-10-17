<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import { useWhiteboard } from './use-whiteboard';
import ElementView from './ElementView.vue';
import { docToScreen } from '../lib/viewport';
import type { PointerInput } from '../state/contract';

const store = useWhiteboard();
const s = store.state;
const canvas = ref<SVGSVGElement>();
const editor = ref<HTMLTextAreaElement>();
let observer: ResizeObserver | undefined;
let activePointer: number | null = null;
const transform = computed(() => `translate(${s.viewport.panX} ${s.viewport.panY}) scale(${s.viewport.zoom})`);
const editStyle = computed(() => {
  if (!s.textEdit) return {};
  const { x, y } = docToScreen(s.viewport, s.textEdit.box);
  return { left: `${x}px`, top: `${y}px`, width: `${Math.max(120, s.textEdit.box.width * s.viewport.zoom)}px`, minHeight: `${Math.max(48, s.textEdit.box.height * s.viewport.zoom)}px`, fontSize: `${s.textEdit.style.fontSize * s.viewport.zoom}px`, transform: `rotate(${s.textEdit.rotation}deg)` };
});
function input(event: PointerEvent | MouseEvent): PointerInput {
  const box = canvas.value!.getBoundingClientRect();
  return { x: event.clientX - box.left, y: event.clientY - box.top, button: event.button, pointerType: 'pointerType' in event ? event.pointerType as PointerInput['pointerType'] : 'mouse', shiftKey: event.shiftKey, altKey: event.altKey, metaOrCtrl: event.metaKey || event.ctrlKey, detail: event.detail };
}
function down(event: PointerEvent) {
  if (activePointer !== null) return;
  canvas.value?.focus({ preventScroll: true });
  event.preventDefault(); activePointer = event.pointerId;
  canvas.value?.setPointerCapture(event.pointerId); store.pointerDown(input(event));
}
function up(event: PointerEvent) {
  if (activePointer !== event.pointerId) return;
  store.pointerUp(input(event)); activePointer = null;
  if (canvas.value?.hasPointerCapture(event.pointerId)) canvas.value.releasePointerCapture(event.pointerId);
}
function cancel(event: PointerEvent) { if (activePointer === event.pointerId) { activePointer = null; store.pointerCancel(); } }
function wheel(event: WheelEvent) {
  const box = canvas.value!.getBoundingClientRect();
  store.wheel({ x: event.clientX - box.left, y: event.clientY - box.top, deltaX: event.deltaX, deltaY: event.deltaY, deltaMode: event.deltaMode, ctrlKey: event.ctrlKey || event.metaKey, shiftKey: event.shiftKey });
}
watch(() => s.textEdit, async (value) => { if (value) { await nextTick(); editor.value?.focus(); editor.value?.select(); } else canvas.value?.focus({ preventScroll: true }); });
onMounted(() => {
  observer = new ResizeObserver(([entry]) => { if (entry) store.setViewportSize(entry.contentRect.width, entry.contentRect.height); });
  if (canvas.value) { observer.observe(canvas.value); canvas.value.focus(); }
});
onBeforeUnmount(() => observer?.disconnect());
</script>

<template>
  <div class="canvas-wrap">
    <svg ref="canvas" class="whiteboard-canvas" data-testid="whiteboard-canvas" tabindex="0" role="application" aria-label="Zeichenfläche" aria-describedby="canvas-help" :style="{ cursor: s.cursor }" @pointerdown="down" @pointermove="activePointer === $event.pointerId && store.pointerMove(input($event))" @pointerup="up" @pointercancel="cancel" @lostpointercapture="cancel" @dblclick="store.doubleClick(input($event))" @wheel.prevent="wheel" @focus="store.canvasFocusChanged(true)" @blur="store.canvasFocusChanged(false)" @contextmenu.prevent>
      <defs><pattern id="canvas-dots" :x="s.viewport.panX % (24 * s.viewport.zoom)" :y="s.viewport.panY % (24 * s.viewport.zoom)" :width="24 * s.viewport.zoom" :height="24 * s.viewport.zoom" patternUnits="userSpaceOnUse"><circle cx="1" cy="1" r=".7" fill="var(--border-subtle)" /></pattern></defs>
      <rect width="100%" height="100%" fill="url(#canvas-dots)" />
      <g :transform="transform" pointer-events="none">
        <ElementView v-for="element in s.displayElements" :key="element.id" :element="element" :document="s.document" :theme="s.theme" :editing="s.textEdit?.elementId === element.id" />
        <ElementView v-if="s.draftElement" :element="s.draftElement" :document="s.document" :theme="s.theme" />
        <rect v-if="s.marquee" v-bind="s.marquee" fill="var(--accent-soft)" fill-opacity=".4" stroke="var(--accent)" :stroke-width="1 / s.viewport.zoom" />
        <rect v-if="s.frame && !s.textEdit" :x="s.frame.cx - s.frame.width / 2 - 4 / s.viewport.zoom" :y="s.frame.cy - s.frame.height / 2 - 4 / s.viewport.zoom" :width="s.frame.width + 8 / s.viewport.zoom" :height="s.frame.height + 8 / s.viewport.zoom" :transform="`rotate(${s.frame.rotation} ${s.frame.cx} ${s.frame.cy})`" fill="none" stroke="var(--accent)" :stroke-width="1 / s.viewport.zoom" />
      </g>
      <g v-if="!s.textEdit && s.canWrite" pointer-events="none">
        <rect v-for="handle in s.handles" :key="handle.id" :data-handle="handle.id" :x="handle.x - 5" :y="handle.y - 5" width="10" height="10" :rx="handle.id === 'rotate' ? 5 : 2" fill="var(--surface-panel)" stroke="var(--accent)" stroke-width="1.5" />
      </g>
    </svg>
    <div v-if="s.empty && !s.draftElement && !s.textEdit" class="empty-canvas" aria-hidden="true"><span class="eyebrow">DEIN VISUAL WORKSPACE</span><h1>Gedanken brauchen Raum.</h1><p>Wähle ein Werkzeug und leg los.<br>Mit <kbd>R</kbd> zeichnest du dein erstes Rechteck.</p><span class="empty-arrow">↖</span></div>
    <div v-if="s.textEdit" class="text-edit-wrap" :style="editStyle">
      <textarea ref="editor" class="canvas-text-editor" data-testid="canvas-text-editor" aria-label="Text auf der Zeichenfläche" :value="s.textEdit.draft" :disabled="s.transitioning || !s.canWrite" @input="store.setTextDraft(($event.target as HTMLTextAreaElement).value)" @compositionstart="store.setComposing(true)" @compositionend="store.setComposing(false)" />
      <div class="text-edit-actions"><button class="sd-btn" :disabled="s.transitioning || !s.canWrite || s.textEdit.composing" @click="store.commitTextEdit()">Übernehmen</button><button class="sd-btn" :disabled="s.transitioning || !s.canWrite" @click="store.cancelTextEdit()">Abbrechen</button></div>
      <div v-if="s.textEdit.conflict" class="draft-conflict" role="alert"><p>{{ s.textEdit.conflict }}</p><button class="sd-btn" @click="store.resolveTextConflict('insert-new')">Als neuen Text einfügen</button><button class="sd-btn" @click="store.resolveTextConflict('keep-mine')">Meinen Text übernehmen</button><button class="sd-btn" @click="store.resolveTextConflict('use-current')">Entwurf verwerfen</button></div>
    </div>
    <p id="canvas-help" class="visually-hidden">Mit V auswählen, mit R ein Rechteck zeichnen. Pfeiltasten bewegen die Auswahl. Bild auf und Bild ab wählen Elemente. Weitere Tastenkürzel unter Hilfe.</p>
  </div>
</template>

<style scoped>
.canvas-wrap,.whiteboard-canvas{position:absolute;inset:0;width:100%;height:100%}.whiteboard-canvas{touch-action:none;outline:none!important}.whiteboard-canvas:focus-visible{box-shadow:inset 0 0 0 2px var(--accent)}
.empty-canvas{position:absolute;top:38%;left:50%;transform:translateX(-50%);text-align:center;pointer-events:none;color:var(--text-muted);width:min(480px,80vw)}.eyebrow{font-size:10px;letter-spacing:.2em;font-weight:650;color:var(--accent)}h1{font-size:clamp(24px,3vw,36px);letter-spacing:-.04em;font-weight:550;color:var(--text-primary);margin:16px 0}p{font-size:13px;line-height:1.8}.empty-arrow{display:block;transform:rotate(-12deg);font-size:40px;margin-top:30px;color:var(--border-default)}kbd{border:1px solid var(--border-subtle);border-radius:4px;padding:1px 5px;background:var(--surface-panel)}
.text-edit-wrap{position:absolute;z-index:8;transform-origin:center}.canvas-text-editor{width:100%;min-height:inherit;resize:vertical;background:var(--surface-panel);color:var(--text-primary);border:2px solid var(--accent);font:inherit;line-height:1.25;padding:4px;display:block}.text-edit-actions{display:flex;gap:4px;margin-top:5px;font-size:12px}.draft-conflict{min-width:260px;background:var(--surface-panel);border:1px solid var(--status-error);padding:12px;font-size:12px}
</style>

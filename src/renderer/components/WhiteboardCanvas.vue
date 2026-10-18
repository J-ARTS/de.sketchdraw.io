<script setup lang="ts">
import { computed, nextTick, onMounted, ref, watch } from 'vue';
import { useResizeObserver } from '@vueuse/core';
import { useWhiteboard } from './use-whiteboard';
import ElementView from './ElementView.vue';
import QuickConnect from './QuickConnect.vue';
import AnnotationEditor from './AnnotationEditor.vue';
import TableOverlay from './TableOverlay.vue';
import LaserPointerOverlay from './LaserPointerOverlay.vue';
import { docToScreen } from '../lib/viewport';
import { themeColor } from '../lib/theme';
import { fontFamilyCss } from '../lib/constants';
import type { PointerInput } from '../state/contract';

const store = useWhiteboard();
const s = store.state;
const canvas = ref<SVGSVGElement>();
const editor = ref<HTMLTextAreaElement>();
const laser = ref<InstanceType<typeof LaserPointerOverlay>>();
const eraserPointer = ref<{ x: number; y: number } | null>(null);
let activePointer: number | null = null;
let laserGesture = false;
const transform = computed(() => `translate(${s.viewport.panX} ${s.viewport.panY}) scale(${s.viewport.zoom})`);
const eraserCursorVisible = computed(() => s.tool === 'eraser' && s.canWrite && !s.transitioning && eraserPointer.value !== null);
const connectorFrom = computed(() => s.connectorTargets ? s.document.elements.find((element) => element.id === s.connectorTargets!.fromId) : undefined);
const connectorTo = computed(() => s.connectorTargets?.toId ? s.document.elements.find((element) => element.id === s.connectorTargets!.toId) : undefined);
/** In-place editor over the rendered text (#41): same box, font, size, color and alignment as ElementView. */
const editStyle = computed(() => {
  const edit = s.textEdit;
  if (!edit) return {};
  const zoom = s.viewport.zoom;
  const { x, y } = docToScreen(s.viewport, edit.box);
  const free = edit.kind === 'text';
  const sticky = edit.kind === 'sticky-note';
  const annotation = edit.kind === 'annotation';
  const topInset = sticky ? 20 : annotation ? 0 : edit.kind === 'container' ? 8 : edit.kind === 'component' ? edit.box.height * 0.58 : 0;
  const sideInset = sticky ? 20 : free || annotation ? 0 : 8;
  return {
    left: `${x}px`, top: `${y}px`,
    width: `${Math.max(free ? 120 : 24, edit.box.width * zoom)}px`,
    ...(free ? { minHeight: `${edit.style.fontSize * 1.25 * zoom}px` } : { height: `${Math.max(24, edit.box.height * zoom)}px` }),
    alignItems: free || topInset ? 'flex-start' : 'center',
    padding: free ? '0' : `${topInset * zoom}px ${sideInset * zoom}px ${sticky ? 56 * zoom : 0}px`,
    boxSizing: 'border-box' as const,
    transform: `rotate(${edit.rotation}deg)`,
    fontSize: `${edit.style.fontSize * zoom}px`,
    fontFamily: fontFamilyCss(edit.style.fontFamily),
    fontWeight: edit.style.fontWeight ?? 'normal',
    textDecoration: edit.style.textDecoration ?? 'none',
    textAlign: edit.style.textAlign,
    '--edit-color': themeColor(edit.style.stroke, s.theme),
    '--annotation-zoom': zoom,
  };
});
function autosize(): void {
  const el = editor.value;
  if (!el) return;
  el.style.height = 'auto';
  el.style.height = `${el.scrollHeight}px`;
}
function onEditorKeydown(event: KeyboardEvent): void {
  if (event.key === 'Enter' && (event.metaKey || event.ctrlKey) && !event.isComposing) {
    event.preventDefault();
    store.commitTextEdit();
  }
}
function input(event: PointerEvent | MouseEvent): PointerInput {
  const box = canvas.value!.getBoundingClientRect();
  return { x: event.clientX - box.left, y: event.clientY - box.top, button: event.button, pointerType: 'pointerType' in event ? event.pointerType as PointerInput['pointerType'] : 'mouse', shiftKey: event.shiftKey, altKey: event.altKey, metaOrCtrl: event.metaKey || event.ctrlKey, detail: event.detail };
}
function down(event: PointerEvent) {
  if (activePointer !== null) return;
  canvas.value?.focus({ preventScroll: true });
  event.preventDefault(); activePointer = event.pointerId;
  canvas.value?.setPointerCapture(event.pointerId);
  const value = input(event);
  eraserPointer.value = { x: value.x, y: value.y };
  laserGesture = s.tool === 'laser' && event.button === 0;
  if (laserGesture) laser.value?.start(value);
  else store.pointerDown(value);
}
function move(event: PointerEvent) {
  const value = input(event);
  eraserPointer.value = { x: value.x, y: value.y };
  if (laserGesture && activePointer === event.pointerId) laser.value?.add(value);
  else store.pointerMove(value);
}
function enter(event: PointerEvent) {
  const value = input(event);
  eraserPointer.value = { x: value.x, y: value.y };
}
function leave() { eraserPointer.value = null; }
function up(event: PointerEvent) {
  if (activePointer !== event.pointerId) return;
  const value = input(event);
  if (laserGesture) laser.value?.end(value);
  else store.pointerUp(value);
  laserGesture = false; activePointer = null;
  if (canvas.value?.hasPointerCapture(event.pointerId)) canvas.value.releasePointerCapture(event.pointerId);
}
function cancel(event: PointerEvent) { if (activePointer === event.pointerId) { activePointer = null; if (laserGesture) laser.value?.cancel(); else store.pointerCancel(); laserGesture = false; } }
function doubleClick(event: MouseEvent) { if (s.tool !== 'laser') store.doubleClick(input(event)); }
function wheel(event: WheelEvent) {
  const box = canvas.value!.getBoundingClientRect();
  store.wheel({ x: event.clientX - box.left, y: event.clientY - box.top, deltaX: event.deltaX, deltaY: event.deltaY, deltaMode: event.deltaMode, ctrlKey: event.ctrlKey || event.metaKey, shiftKey: event.shiftKey });
}
watch(() => s.textEdit, async (value) => { if (value) { await nextTick(); if (value.kind !== 'annotation') { autosize(); editor.value?.focus(); editor.value?.select(); } } else canvas.value?.focus({ preventScroll: true }); });
watch(() => [s.textEdit?.draft, s.viewport.zoom], () => { void nextTick(autosize); });
useResizeObserver(canvas, ([entry]) => { if (entry) store.setViewportSize(entry.contentRect.width, entry.contentRect.height); });
onMounted(() => canvas.value?.focus());
</script>

<template>
  <div class="canvas-wrap">
    <svg ref="canvas" class="whiteboard-canvas" data-testid="whiteboard-canvas" tabindex="0" role="application" aria-label="Zeichenfläche" aria-describedby="canvas-help" :style="{ cursor: s.cursor }" @pointerenter="enter" @pointerleave="leave" @pointerdown="down" @pointermove="move" @pointerup="up" @pointercancel="cancel" @lostpointercapture="cancel" @dblclick="doubleClick" @wheel.prevent="wheel" @focus="store.canvasFocusChanged(true)" @blur="store.canvasFocusChanged(false)" @contextmenu.prevent>
      <defs><pattern id="canvas-dots" :x="s.viewport.panX % (24 * s.viewport.zoom)" :y="s.viewport.panY % (24 * s.viewport.zoom)" :width="24 * s.viewport.zoom" :height="24 * s.viewport.zoom" patternUnits="userSpaceOnUse"><circle cx="1" cy="1" r=".8" fill="var(--canvas-grid)" /></pattern></defs>
      <rect width="100%" height="100%" fill="url(#canvas-dots)" />
      <g :transform="transform" pointer-events="none">
        <ElementView :data-render-state="s.hasElementPreview ? 'preview' : 'document'" v-for="element in s.displayElements" :key="element.id" :element="element" :document="s.document" :theme="s.theme" :editing="s.textEdit?.elementId === element.id" :interactive="element.kind === 'web-embed' && s.tool === 'select' && s.selection.length === 1 && s.selection[0] === element.id" @open-link="store.openDocumentationLink" />
        <ElementView data-render-state="draft" v-if="s.draftElement" :element="s.draftElement" :document="s.document" :theme="s.theme" />
        <rect v-if="connectorFrom" data-testid="connector-source-highlight" :x="connectorFrom.x - 5 / s.viewport.zoom" :y="connectorFrom.y - 5 / s.viewport.zoom" :width="connectorFrom.width + 10 / s.viewport.zoom" :height="connectorFrom.height + 10 / s.viewport.zoom" :transform="`rotate(${connectorFrom.rotation} ${connectorFrom.x + connectorFrom.width / 2} ${connectorFrom.y + connectorFrom.height / 2})`" fill="none" stroke="var(--accent)" :stroke-width="2 / s.viewport.zoom" stroke-dasharray="5 4" />
        <rect v-if="connectorTo" data-testid="connector-target-highlight" :x="connectorTo.x - 6 / s.viewport.zoom" :y="connectorTo.y - 6 / s.viewport.zoom" :width="connectorTo.width + 12 / s.viewport.zoom" :height="connectorTo.height + 12 / s.viewport.zoom" :transform="`rotate(${connectorTo.rotation} ${connectorTo.x + connectorTo.width / 2} ${connectorTo.y + connectorTo.height / 2})`" fill="none" stroke="var(--status-ok)" :stroke-width="3 / s.viewport.zoom" />
        <rect v-if="s.marquee" v-bind="s.marquee" fill="var(--accent-soft)" fill-opacity=".4" stroke="var(--accent)" :stroke-width="1 / s.viewport.zoom" />
        <rect v-if="s.frame" :x="s.frame.cx - s.frame.width / 2 - 4 / s.viewport.zoom" :y="s.frame.cy - s.frame.height / 2 - 4 / s.viewport.zoom" :width="s.frame.width + 8 / s.viewport.zoom" :height="s.frame.height + 8 / s.viewport.zoom" :transform="`rotate(${s.frame.rotation} ${s.frame.cx} ${s.frame.cy})`" fill="none" stroke="var(--accent)" :stroke-width="1 / s.viewport.zoom" />
      </g>
      <g v-if="!s.textEdit && s.canWrite" pointer-events="none">
        <template v-for="handle in s.handles" :key="handle.id">
          <circle v-if="handle.kind === 'connector-point'" :data-handle="handle.id" :data-testid="`connector-handle-${handle.id.split(':')[1]}`" :cx="handle.x" :cy="handle.y" r="6" fill="var(--surface-panel)" stroke="var(--accent)" stroke-width="2" />
          <circle v-else-if="handle.kind === 'connector-segment'" :data-handle="handle.id" :data-testid="`connector-add-handle-${handle.id.split(':')[1]}`" :cx="handle.x" :cy="handle.y" r="4" fill="var(--accent-soft)" stroke="var(--accent)" stroke-width="1.5" opacity=".8" />
          <rect v-else :data-handle="handle.id" :x="handle.x - 5" :y="handle.y - 5" width="10" height="10" :rx="handle.id === 'rotate' ? 5 : 2" fill="var(--surface-panel)" stroke="var(--accent)" stroke-width="1.5" />
        </template>
      </g>
      <g v-if="eraserCursorVisible && eraserPointer" class="eraser-cursor" data-testid="eraser-cursor" :data-radius="s.eraserRadius" pointer-events="none" aria-hidden="true">
        <circle :cx="eraserPointer.x" :cy="eraserPointer.y" :r="s.eraserRadius" fill="none" stroke="var(--text-primary)" stroke-width="1.5" stroke-dasharray="5 4" opacity=".82" />
        <circle :cx="eraserPointer.x" :cy="eraserPointer.y" r="2.5" fill="var(--text-primary)" />
      </g>
      <LaserPointerOverlay ref="laser" />
    </svg>
    <QuickConnect />
    <TableOverlay />
    <div v-if="s.empty && !s.draftElement && !s.textEdit" class="empty-canvas" aria-hidden="true"><span class="eyebrow">DEIN VISUAL WORKSPACE</span><h1>Gedanken brauchen Raum.</h1><p>Wähle ein Werkzeug und leg los.<br>Mit <kbd>R</kbd> zeichnest du dein erstes Rechteck.</p><span class="empty-arrow">↖</span></div>
    <div v-if="s.textEdit" class="text-edit-wrap" :class="{ free: s.textEdit.kind === 'text' }" :style="editStyle">
      <AnnotationEditor v-if="s.textEdit.kind === 'annotation'" />
      <textarea v-else ref="editor" rows="1" class="canvas-text-editor" data-testid="canvas-text-editor" aria-label="Text auf der Zeichenfläche" aria-keyshortcuts="Escape Control+Enter Meta+Enter" :placeholder="s.textEdit.kind === 'sticky-note' ? 'Schreib etwas, @erwähne jemanden' : undefined" :style="{ fontWeight: s.textEdit.style.fontWeight ?? 'normal', textDecoration: s.textEdit.style.textDecoration ?? 'none' }" :value="s.textEdit.draft" :disabled="s.transitioning || !s.canWrite" @input="store.setTextDraft(($event.target as HTMLTextAreaElement).value)" @keydown="onEditorKeydown" @compositionstart="store.setComposing(true)" @compositionend="store.setComposing(false)" />
      <div v-if="s.textEdit.conflict" class="draft-conflict" role="alert"><p>{{ s.textEdit.conflict }}</p><button class="sd-btn" @click="store.resolveTextConflict('insert-new')">Als neuen Text einfügen</button><button class="sd-btn" @click="store.resolveTextConflict('keep-mine')">Meinen Text übernehmen</button><button class="sd-btn" @click="store.resolveTextConflict('use-current')">Entwurf verwerfen</button></div>
    </div>
    <p id="canvas-help" class="visually-hidden">Mit V auswählen, mit R ein Rechteck und mit F einen Präsentationsframe zeichnen. Mit Alt+Umschalt+P startest du die Präsentation. Pfeiltasten bewegen die Auswahl. Bild auf und Bild ab wählen Elemente. Weitere Tastenkürzel unter Hilfe.</p>
  </div>
</template>

<style scoped>
.canvas-wrap,.whiteboard-canvas{position:absolute;inset:0;width:100%;height:100%}.whiteboard-canvas{touch-action:none;outline:none!important}.whiteboard-canvas:focus-visible{box-shadow:inset 0 0 0 2px var(--accent)}
.empty-canvas{position:absolute;top:38%;left:50%;transform:translateX(-50%);text-align:center;pointer-events:none;color:var(--text-muted);width:min(480px,80vw)}.eyebrow{font-size:10px;letter-spacing:.2em;font-weight:650;color:var(--accent)}h1{font-size:clamp(24px,3vw,36px);letter-spacing:-.04em;font-weight:550;color:var(--text-primary);margin:16px 0}p{font-size:13px;line-height:1.8}.empty-arrow{display:block;transform:rotate(-12deg);font-size:40px;margin-top:30px;color:var(--border-default)}kbd{border:1px solid var(--border-subtle);border-radius:4px;padding:1px 5px;background:var(--surface-panel)}
.text-edit-wrap{position:absolute;z-index:8;display:flex;transform-origin:center;pointer-events:none}.canvas-text-editor{display:block;width:100%;max-height:100%;margin:0;padding:0;overflow:hidden;resize:none;background:transparent;border:0;outline:none;color:var(--edit-color);caret-color:var(--edit-color);font:inherit;line-height:1.25;text-align:inherit;pointer-events:auto}.text-edit-wrap.free .canvas-text-editor{max-height:none}.canvas-text-editor::placeholder{color:color-mix(in srgb,var(--edit-color) 55%,transparent);opacity:1}.canvas-text-editor::selection{background:color-mix(in srgb,var(--accent) 30%,transparent)}.draft-conflict{position:absolute;top:calc(100% + 8px);left:0;min-width:260px;background:var(--surface-panel);border:1px solid var(--status-error);border-radius:var(--radius-1);padding:12px;font-size:12px;pointer-events:auto}
</style>

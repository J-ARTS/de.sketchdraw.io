<!-- @component The canvas: it draws the page, takes pointer and keyboard input and hosts the text editor and the layers over the elements. -->
<script setup lang="ts">
import { figureLayout, isIconFigure } from '@/catalog';
import AppButton from '@/renderer/design-system/atoms/AppButton.vue';
import { t } from '@/renderer/i18n';
import { computed, nextTick, onMounted, ref, watch } from 'vue';
import { paperGridStep } from '@/renderer/lib/preferences';
import { useResizeObserver } from '@vueuse/core';
import { useWhiteboard } from '@/renderer/design-system/composables/use-whiteboard';
import ElementView from '@/renderer/design-system/organisms/ElementView.vue';
import QuickConnect from '@/renderer/design-system/organisms/QuickConnect.vue';
import AnnotationEditor from '@/renderer/design-system/organisms/AnnotationEditor.vue';
import TableOverlay from '@/renderer/design-system/organisms/TableOverlay.vue';
import LaserPointerOverlay from '@/renderer/design-system/organisms/LaserPointerOverlay.vue';
import RemoteCursors from '@/renderer/design-system/organisms/RemoteCursors.vue';
import SmartGuides from '@/renderer/design-system/organisms/SmartGuides.vue';
import { awsGroupOf, defaultCardTextColor, groupChrome, RESOURCE_CARD_TEXT_COLOR, resourceCardFieldBox, resourceCardLayout } from '@/catalog';
import { createElement, type SketchElement } from '@/domain';
import { docToScreen, screenToDoc } from '@/renderer/lib/viewport';
import { themeColor } from '@/renderer/lib/theme';
import { DOCK_POINTS, rotatePoint } from '@/renderer/lib/geometry';
import { defaultSizeFor, DEFAULT_STYLE, STYLE_BY_KIND, fontFamilyCss } from '@/renderer/lib/constants';
import type { PointerInput } from '@/renderer/state/contract';
import { COMPONENT_DRAG_MIME, peekComponentDrag, takeComponentDrag } from '@/renderer/lib/component-drag';
import { CUSTOM_COMPONENT_DRAG_MIME } from '@/renderer/lib/custom-components';
import { diagramTemplate, TEMPLATE_DRAG_MIME } from '@/renderer/lib/diagram-libraries';

const store = useWhiteboard();
const s = store.state;
const canvas = ref<SVGSVGElement>();
const editor = ref<HTMLTextAreaElement>();
const laser = ref<InstanceType<typeof LaserPointerOverlay>>();
const toolPointer = ref<{ x: number; y: number } | null>(null);
let activePointer: number | null = null;
let laserGesture = false;
const transform = computed(() => `translate(${s.viewport.panX} ${s.viewport.panY}) scale(${s.viewport.zoom})`);
const pencilCursorVisible = computed(() => s.tool === 'path' && s.canWrite && !s.transitioning && toolPointer.value !== null);
const eraserCursorVisible = computed(() => s.tool === 'eraser' && s.canWrite && !s.transitioning && toolPointer.value !== null);
const SILHOUETTE_TOOLS: readonly string[] = ['rectangle', 'ellipse', 'diamond', 'container', 'sticky-note', 'frame'];
/** Translucent preview of the shape that a drag with the active shape tool will create, like the eraser ring. */
const shapeSilhouette = computed<SketchElement | null>(() => {
  const point = toolPointer.value;
  if (!point || !SILHOUETTE_TOOLS.includes(s.tool) || !s.canWrite || s.transitioning || s.draftElement || s.textEdit) return null;
  const size = defaultSizeFor(s.tool, s.shapeVariant);
  if (!size) return null;
  const at = screenToDoc(s.viewport, point);
  const kind = s.tool as 'rectangle' | 'ellipse' | 'diamond' | 'container' | 'sticky-note' | 'frame';
  try {
    return createElement(kind, {
      id: 'shape-silhouette', x: at.x, y: at.y, width: size.width, height: size.height,
      style: { ...DEFAULT_STYLE, ...STYLE_BY_KIND[kind] }, ...(['rectangle', 'ellipse', 'diamond'].includes(kind) ? { shapeVariant: s.shapeVariant } : {}),
    });
  } catch { return null; }
});
const connectorFrom = computed(() => s.connectorTargets ? s.document.elements.find((element) => element.id === s.connectorTargets!.fromId) : undefined);
const connectorTo = computed(() => s.connectorTargets?.toId ? s.document.elements.find((element) => element.id === s.connectorTargets!.toId) : undefined);
const connectorDockElements = computed(() => {
  const ids = new Set<string>();
  if (s.connectorHoverTargetId) ids.add(s.connectorHoverTargetId);
  if (s.connectorTargets?.fromId) ids.add(s.connectorTargets.fromId);
  if (s.connectorTargets?.toId) ids.add(s.connectorTargets.toId);
  return [...ids].flatMap((id) => {
    const element = s.displayElements.find((entry) => entry.id === id);
    return element && element.kind !== 'connector' ? [element] : [];
  });
});
const connectorDockSides = DOCK_POINTS;
const dropTarget = computed(() => s.dropTargetId ? s.displayElements.find((element) => element.id === s.dropTargetId) : undefined);
/** In-place editor over the rendered text (#41): same box, font, size, color and alignment as ElementView. */
const editStyle = computed(() => {
  const edit = s.textEdit;
  if (!edit) return {};
  const zoom = s.viewport.zoom;
  // A text of a resource card (#189): the box is the text itself, drawn like the card draws it. The card is taken
  // as it is shown, with the draft in it, so the box covers every line that was typed and moves with the card (#254).
  if (edit.field) {
    const card = s.displayElements.find((element) => element.id === edit.elementId);
    const line = resourceCardLayout(card ?? { width: edit.box.width, height: edit.box.height, style: edit.style })[edit.field];
    let box = edit.box;
    if (card) {
      const local = resourceCardFieldBox(card, edit.field);
      const middle = rotatePoint({ x: card.x + local.x + local.width / 2, y: card.y + local.y + local.height / 2 }, { x: card.x + card.width / 2, y: card.y + card.height / 2 }, card.rotation);
      box = { x: middle.x - local.width / 2, y: middle.y - local.height / 2, width: local.width, height: local.height };
    }
    const at = docToScreen(s.viewport, box);
    return {
      left: `${at.x}px`, top: `${at.y}px`, width: `${Math.max(24, box.width * zoom)}px`, height: `${Math.max(16, box.height * zoom)}px`,
      alignItems: 'center', padding: '0', boxSizing: 'border-box' as const,
      transform: `rotate(${edit.rotation}deg)`,
      fontSize: `${line.fontSize * zoom}px`,
      lineHeight: String(line.lineHeight / line.fontSize),
      fontFamily: fontFamilyCss(edit.style.fontFamily),
      fontWeight: edit.field === 'title' ? '600' : '500',
      textAlign: 'left' as const,
      '--edit-color': themeColor(edit.style.textColor ?? RESOURCE_CARD_TEXT_COLOR, s.theme),
      '--annotation-zoom': zoom,
    };
  }
  const { x, y } = docToScreen(s.viewport, edit.box);
  const free = edit.kind === 'text';
  const sticky = edit.kind === 'sticky-note';
  const annotation = edit.kind === 'annotation';
  // AWS group frames (#143) edit their label in the header, next to the tile.
  const group = edit.kind === 'container' ? awsGroupOf(s.document.elements.find((element) => element.id === edit.elementId)) : undefined;
  const chrome = group ? groupChrome(group, edit.box.width, edit.style.fontSize) : null;
  // A free-standing symbol (isometric icons) edits its label where it stands, below the symbol.
  const edited = edit.kind === 'component' ? s.document.elements.find((element) => element.id === edit.elementId) : undefined;
  const figureElement = edited && isIconFigure(edited) ? { ...edited, width: edit.box.width, height: edit.box.height } : null;
  const topInset = chrome ? chrome.label.top : sticky ? 20 : annotation ? 0 : edit.kind === 'container' ? 8 : figureElement ? figureLayout(figureElement, (figureElement.text ?? '').split('\n').length).labelTop : edit.kind === 'component' ? edit.box.height * 0.58 : 0;
  const sideInset = sticky ? 20 : free || annotation ? 0 : 8;
  return {
    left: `${x}px`, top: `${y}px`,
    width: `${Math.max(free ? 120 : 24, edit.box.width * zoom)}px`,
    ...(free ? { minHeight: `${edit.style.fontSize * 1.25 * zoom}px` } : { height: `${Math.max(24, edit.box.height * zoom)}px` }),
    alignItems: free || topInset ? 'flex-start' : 'center',
    padding: free ? '0' : chrome ? `${topInset * zoom}px ${(edit.box.width - chrome.label.right) * zoom}px 0 ${chrome.label.left * zoom}px` : `${topInset * zoom}px ${sideInset * zoom}px ${sticky ? 56 * zoom : 0}px`,
    boxSizing: 'border-box' as const,
    transform: `rotate(${edit.rotation}deg)`,
    fontSize: `${edit.style.fontSize * zoom}px`,
    fontFamily: fontFamilyCss(edit.style.fontFamily),
    fontWeight: edit.style.fontWeight ?? 'normal',
    textDecoration: edit.style.textDecoration ?? 'none',
    textAlign: edit.style.textAlign,
    '--edit-color': themeColor(edit.style.textColor ?? defaultCardTextColor(edited, s.document.componentSets) ?? edit.style.stroke, s.theme),
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
  // In a text of a resource card Enter alone takes the text over; Shift+Enter or Alt+Enter starts a new line (#254).
  if (event.key === 'Enter' && !event.isComposing && s.textEdit?.field && event.altKey && !event.metaKey && !event.ctrlKey) {
    // Alt+Enter has no meaning of its own in a text field; it is given the one Shift+Enter has.
    event.preventDefault();
    const field = event.target as HTMLTextAreaElement;
    field.setRangeText('\n', field.selectionStart, field.selectionEnd, 'end');
    field.dispatchEvent(new Event('input', { bubbles: true }));
    return;
  }
  if (event.key === 'Enter' && !event.isComposing && (event.metaKey || event.ctrlKey || (s.textEdit?.field && !event.shiftKey))) {
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
  // Ctrl/Cmd+click on linked text opens its address.
  if ((event.ctrlKey || event.metaKey) && event.button === 0) {
    const url = (event.target as Element | null)?.closest?.('[data-text-link]')?.getAttribute('data-text-link');
    if (url) { event.preventDefault(); void store.openDocumentationLink(url); return; }
  }
  canvas.value?.focus({ preventScroll: true });
  event.preventDefault(); activePointer = event.pointerId;
  canvas.value?.setPointerCapture(event.pointerId);
  const value = input(event);
  toolPointer.value = { x: value.x, y: value.y };
  laserGesture = s.tool === 'laser' && event.button === 0;
  if (laserGesture) laser.value?.start(value);
  else store.pointerDown(value);
}
function move(event: PointerEvent) {
  const value = input(event);
  toolPointer.value = { x: value.x, y: value.y };
  if (laserGesture && activePointer === event.pointerId) laser.value?.add(value);
  else store.pointerMove(value);
}
function enter(event: PointerEvent) {
  const value = input(event);
  toolPointer.value = { x: value.x, y: value.y };
  store.pointerMove(value);
}
function leave() { toolPointer.value = null; store.pointerLeave(); }
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
function dragOver(event: DragEvent): void {
  if (!peekComponentDrag() && !event.dataTransfer?.types.includes(COMPONENT_DRAG_MIME) && !event.dataTransfer?.types.includes(CUSTOM_COMPONENT_DRAG_MIME) && !event.dataTransfer?.types.includes(TEMPLATE_DRAG_MIME)) return;
  event.preventDefault();
  if (event.dataTransfer) event.dataTransfer.dropEffect = 'copy';
}
function dropComponent(event: DragEvent): void {
  // One of the user's own components (#188) travels by its id.
  const customId = event.dataTransfer?.getData(CUSTOM_COMPONENT_DRAG_MIME);
  if (customId && canvas.value) {
    event.preventDefault();
    const area = canvas.value.getBoundingClientRect();
    void store.insertCustomComponent(customId, { x: event.clientX - area.left, y: event.clientY - area.top });
    return;
  }
  // A template of a diagram library (#191) travels by its id as well.
  const template = diagramTemplate(event.dataTransfer?.getData(TEMPLATE_DRAG_MIME) ?? '');
  if (template && canvas.value) {
    event.preventDefault();
    const area = canvas.value.getBoundingClientRect();
    void store.insertElements(template.build(), { x: event.clientX - area.left, y: event.clientY - area.top }, t(template.name));
    return;
  }
  const payload = takeComponentDrag();
  if (!payload || !canvas.value) return;
  event.preventDefault();
  const box = canvas.value.getBoundingClientRect();
  void store.insertComponent(payload.set, payload.type, { x: event.clientX - box.left, y: event.clientY - box.top }, payload.variant);
}
watch(() => s.textEdit, async (value) => { if (value) { await nextTick(); if (value.kind !== 'annotation') { autosize(); editor.value?.focus(); editor.value?.select(); } } else canvas.value?.focus({ preventScroll: true }); });
watch(() => [s.textEdit?.draft, s.viewport.zoom], () => { void nextTick(autosize); });
useResizeObserver(canvas, ([entry]) => { if (entry) store.setViewportSize(entry.contentRect.width, entry.contentRect.height); });
/** Distance of the grid lines on screen for the current zoom. */
const gridStep = computed(() => paperGridStep(s.viewport.zoom));
onMounted(() => canvas.value?.focus());
</script>

<template>
  <div class="canvas-wrap">
    <svg ref="canvas" class="whiteboard-canvas" data-testid="whiteboard-canvas" :data-connector-dock-target="s.connectorHoverTargetId ?? undefined" tabindex="0" role="application" :aria-label="t('Zeichenfläche')" aria-describedby="canvas-help" :style="{ cursor: s.cursor }" @pointerenter="enter" @pointerleave="leave" @pointerdown="down" @pointermove="move" @pointerup="up" @pointercancel="cancel" @lostpointercapture="cancel" @dblclick="doubleClick" @wheel.prevent="wheel" @dragover="dragOver" @drop="dropComponent" @focus="store.canvasFocusChanged(true)" @blur="store.canvasFocusChanged(false)" @contextmenu.prevent>
      <defs>
        <pattern v-if="s.paperPattern === 'dots'" id="canvas-dots" :x="s.viewport.panX % (24 * s.viewport.zoom)" :y="s.viewport.panY % (24 * s.viewport.zoom)" :width="24 * s.viewport.zoom" :height="24 * s.viewport.zoom" patternUnits="userSpaceOnUse"><circle cx="1" cy="1" r=".8" fill="var(--canvas-grid)" /></pattern>
        <!-- The grid (#247): one line at the left and top of every cell; zoomed out, lines are left out so they stay apart. -->
        <pattern v-else-if="s.paperPattern === 'grid'" id="canvas-grid" :x="s.viewport.panX % gridStep" :y="s.viewport.panY % gridStep" :width="gridStep" :height="gridStep" patternUnits="userSpaceOnUse"><path :d="`M${gridStep} .5H.5V${gridStep}`" fill="none" stroke="var(--canvas-grid)" stroke-width="1" stroke-opacity=".55" /></pattern>
      </defs>
      <rect data-testid="canvas-paper" :data-paper-pattern="s.paperPattern" width="100%" height="100%" :fill="s.paperPattern === 'plain' ? 'none' : s.paperPattern === 'grid' ? 'url(#canvas-grid)' : 'url(#canvas-dots)'" />
      <g :transform="transform" pointer-events="none">
        <ElementView :data-render-state="s.hasElementPreview ? 'preview' : 'document'" v-for="element in s.displayElements" :key="element.id" :element="element" :document="s.document" :theme="s.theme" :editing="s.textEdit?.elementId === element.id && !s.textEdit.field" :editing-field="s.textEdit?.elementId === element.id ? s.textEdit.field : undefined" :interactive="element.kind === 'web-embed' && s.tool === 'select' && s.selection.length === 1 && s.selection[0] === element.id" @open-link="store.openDocumentationLink" />
        <ElementView data-render-state="draft" v-if="s.draftElement" :element="s.draftElement" :document="s.document" :theme="s.theme" />
        <g v-if="shapeSilhouette" class="shape-silhouette" data-testid="shape-silhouette" :data-shape="s.shapeVariant" pointer-events="none" aria-hidden="true" opacity=".38">
          <ElementView :element="shapeSilhouette" :document="s.document" :theme="s.theme" />
        </g>
        <rect v-if="connectorFrom" data-testid="connector-source-highlight" :x="connectorFrom.x - 5 / s.viewport.zoom" :y="connectorFrom.y - 5 / s.viewport.zoom" :width="connectorFrom.width + 10 / s.viewport.zoom" :height="connectorFrom.height + 10 / s.viewport.zoom" :transform="`rotate(${connectorFrom.rotation} ${connectorFrom.x + connectorFrom.width / 2} ${connectorFrom.y + connectorFrom.height / 2})`" fill="none" stroke="var(--accent)" :stroke-width="2 / s.viewport.zoom" stroke-dasharray="5 4" />
        <rect v-if="connectorTo" data-testid="connector-target-highlight" :x="connectorTo.x - 6 / s.viewport.zoom" :y="connectorTo.y - 6 / s.viewport.zoom" :width="connectorTo.width + 12 / s.viewport.zoom" :height="connectorTo.height + 12 / s.viewport.zoom" :transform="`rotate(${connectorTo.rotation} ${connectorTo.x + connectorTo.width / 2} ${connectorTo.y + connectorTo.height / 2})`" fill="none" stroke="var(--status-ok)" :stroke-width="3 / s.viewport.zoom" />
        <g v-for="element in connectorDockElements" :key="`connector-docks:${element.id}`" data-testid="connector-dock-points" :data-element-id="element.id" :transform="`rotate(${element.rotation} ${element.x + element.width / 2} ${element.y + element.height / 2})`">
          <circle v-for="dock in connectorDockSides" :key="`${dock.side}-${dock.slot}`" data-testid="connector-dock-point" :data-side="dock.side" :data-slot="dock.slot" :data-target="s.connectorTargets?.toId === element.id ? 'true' : undefined" :cx="element.x + element.width * dock.x" :cy="element.y + element.height * dock.y" :r="6 / s.viewport.zoom" fill="var(--surface-panel)" stroke="#0d99ff" :stroke-width="2 / s.viewport.zoom" />
        </g>
        <rect v-if="dropTarget" data-testid="drop-target-highlight" :data-element-id="dropTarget.id" :x="dropTarget.x - 2 / s.viewport.zoom" :y="dropTarget.y - 2 / s.viewport.zoom" :width="dropTarget.width + 4 / s.viewport.zoom" :height="dropTarget.height + 4 / s.viewport.zoom" fill="var(--accent-soft)" fill-opacity=".25" stroke="var(--accent)" :stroke-width="2 / s.viewport.zoom" pointer-events="none" />
        <rect v-if="s.marquee" v-bind="s.marquee" fill="var(--accent-soft)" fill-opacity=".4" stroke="var(--accent)" :stroke-width="1 / s.viewport.zoom" />
        <rect v-if="s.frame" :x="s.frame.cx - s.frame.width / 2 - 4 / s.viewport.zoom" :y="s.frame.cy - s.frame.height / 2 - 4 / s.viewport.zoom" :width="s.frame.width + 8 / s.viewport.zoom" :height="s.frame.height + 8 / s.viewport.zoom" :transform="`rotate(${s.frame.rotation} ${s.frame.cx} ${s.frame.cy})`" fill="none" stroke="var(--accent)" :stroke-width="1 / s.viewport.zoom" />
      </g>
      <g v-if="!s.textEdit && s.canWrite" pointer-events="none">
        <template v-for="handle in s.handles" :key="handle.id">
          <circle v-if="handle.kind === 'connector-endpoint'" :data-handle="handle.id" :data-testid="`connector-endpoint-handle-${handle.id.split(':')[1]}`" :data-hovered="s.hoveredHandleId === handle.id ? 'true' : undefined" :cx="handle.x" :cy="handle.y" :r="s.hoveredHandleId === handle.id ? 8 : 7" fill="var(--surface-panel)" stroke="#0d99ff" stroke-width="3" />
          <rect v-else-if="handle.kind === 'connector-label'" :data-handle="handle.id" data-testid="connector-label-handle" :data-hovered="s.hoveredHandleId === handle.id ? 'true' : undefined" :x="handle.x - 6" :y="handle.y - 6" width="12" height="12" rx="3" :transform="`rotate(45 ${handle.x} ${handle.y})`" :fill="s.hoveredHandleId === handle.id ? '#0d99ff' : '#dbeeff'" stroke="#0d99ff" stroke-width="2" />
          <circle v-else-if="handle.kind === 'connector-control'" :data-handle="handle.id" :data-testid="`connector-control-handle-${handle.id.split(':')[1]}`" :data-hovered="s.hoveredHandleId === handle.id ? 'true' : undefined" :cx="handle.x" :cy="handle.y" :r="s.hoveredHandleId === handle.id ? 7 : 6" fill="#dbeeff" stroke="#0d99ff" stroke-width="2" />
          <rect v-else-if="handle.kind === 'connector-segment'" :data-handle="handle.id" :data-testid="`connector-segment-handle-${handle.id.split(':')[1]}`" :data-orientation="handle.orientation" :data-hovered="s.hoveredHandleId === handle.id ? 'true' : undefined" :x="handle.x - (handle.orientation === 'horizontal' ? (s.hoveredHandleId === handle.id ? 22 : 19) : (s.hoveredHandleId === handle.id ? 6 : 5))" :y="handle.y - (handle.orientation === 'horizontal' ? (s.hoveredHandleId === handle.id ? 6 : 5) : (s.hoveredHandleId === handle.id ? 22 : 19))" :width="handle.orientation === 'horizontal' ? (s.hoveredHandleId === handle.id ? 44 : 38) : (s.hoveredHandleId === handle.id ? 12 : 10)" :height="handle.orientation === 'horizontal' ? (s.hoveredHandleId === handle.id ? 12 : 10) : (s.hoveredHandleId === handle.id ? 44 : 38)" rx="6" fill="#0d99ff" />
          <rect v-else :data-handle="handle.id" :x="handle.x - 5" :y="handle.y - 5" width="10" height="10" :rx="handle.id === 'rotate' ? 5 : 2" fill="var(--surface-panel)" stroke="var(--accent)" stroke-width="1.5" />
        </template>
      </g>
      <g v-if="pencilCursorVisible && toolPointer" class="pencil-cursor" data-testid="pencil-cursor" :data-size="s.pencilSize" :data-opacity="s.pencilOpacity" pointer-events="none" aria-hidden="true">
        <circle v-if="s.pencilOpacity < 20" :cx="toolPointer.x" :cy="toolPointer.y" :r="s.pencilSize / 2" fill="none" stroke="var(--text-primary)" stroke-width="1" stroke-dasharray="3 3" opacity=".48" />
        <circle :cx="toolPointer.x" :cy="toolPointer.y" :r="s.pencilSize / 2" fill="none" :stroke="s.pencilColor" stroke-width="1.5" :opacity="s.pencilOpacity / 100" />
      </g>
      <g v-if="eraserCursorVisible && toolPointer" class="eraser-cursor" data-testid="eraser-cursor" :data-radius="s.eraserRadius" pointer-events="none" aria-hidden="true">
        <circle :cx="toolPointer.x" :cy="toolPointer.y" :r="s.eraserRadius" fill="none" stroke="var(--text-primary)" stroke-width="1.5" stroke-dasharray="5 4" opacity=".82" />
        <circle :cx="toolPointer.x" :cy="toolPointer.y" r="2.5" fill="var(--text-primary)" />
      </g>
      <LaserPointerOverlay ref="laser" />
      <SmartGuides />
      <RemoteCursors />
    </svg>
    <QuickConnect />
    <TableOverlay />
    <div v-if="s.empty && !s.draftElement && !s.textEdit" class="empty-canvas" aria-hidden="true"><span class="eyebrow">DEIN VISUAL WORKSPACE</span><h1>{{ t('Gedanken brauchen Raum.') }}</h1><p>{{ t('Wähle ein Werkzeug und leg los.') }}<br>Mit <kbd>R</kbd> {{ t('zeichnest du dein erstes Rechteck.') }}</p><span class="empty-arrow">↖</span></div>
    <div v-if="s.textEdit" class="text-edit-wrap" :class="{ free: s.textEdit.kind === 'text' }" :style="editStyle">
      <AnnotationEditor v-if="s.textEdit.kind === 'annotation'" />
      <textarea v-else ref="editor" rows="1" class="canvas-text-editor" :class="{ 'card-field': s.textEdit.field }" data-testid="canvas-text-editor" :data-field="s.textEdit.field" :aria-label="s.textEdit.field === 'title' ? t('Name der Ressourcenkarte') : s.textEdit.field === 'description' ? t('Beschreibung der Ressourcenkarte') : t('Text auf der Zeichenfläche')" :aria-keyshortcuts="s.textEdit.field ? 'Escape Enter Shift+Enter' : 'Escape Control+Enter Meta+Enter'" :placeholder="s.textEdit.kind === 'sticky-note' ? t('Schreib etwas, @erwähne jemanden') : s.textEdit.field === 'description' ? t('Beschreibung') : undefined" :style="s.textEdit.field ? {} : { fontWeight: s.textEdit.style.fontWeight ?? 'normal', textDecoration: s.textEdit.style.textDecoration ?? 'none' }" :value="s.textEdit.draft" :disabled="s.transitioning || !s.canWrite" @input="store.setTextDraft(($event.target as HTMLTextAreaElement).value)" @keydown="onEditorKeydown" @compositionstart="store.setComposing(true)" @compositionend="store.setComposing(false)" />
      <div v-if="s.textEdit.conflict" class="draft-conflict" role="alert"><p>{{ s.textEdit.conflict }}</p><AppButton @click="store.resolveTextConflict('insert-new')">{{ t('Als neuen Text einfügen') }}</AppButton><AppButton @click="store.resolveTextConflict('keep-mine')">{{ t('Meinen Text übernehmen') }}</AppButton><AppButton @click="store.resolveTextConflict('use-current')">{{ t('Entwurf verwerfen') }}</AppButton></div>
    </div>
    <p id="canvas-help" class="visually-hidden">{{ t('Mit V auswählen, mit R ein Rechteck und mit F einen Präsentationsframe zeichnen. Mit Alt+Umschalt+P startest du die Präsentation. Pfeiltasten bewegen die Auswahl. Bild auf und Bild ab wählen Elemente. Weitere Tastenkürzel unter Hilfe.') }}</p>
  </div>
</template>

<style scoped>
.canvas-wrap,.whiteboard-canvas{position:absolute;inset:0;width:100%;height:100%}.whiteboard-canvas{touch-action:none;outline:none!important}
.empty-canvas{position:absolute;top:38%;left:50%;transform:translateX(-50%);text-align:center;pointer-events:none;color:var(--text-muted);width:min(480px,80vw)}.eyebrow{font-size:10px;letter-spacing:.2em;font-weight:650;color:var(--accent)}h1{font-size:clamp(24px,3vw,36px);letter-spacing:-.04em;font-weight:550;color:var(--text-primary);margin:16px 0}p{font-size:13px;line-height:1.8}.empty-arrow{display:block;transform:rotate(-12deg);font-size:40px;margin-top:30px;color:var(--border-default)}kbd{border:1px solid var(--border-subtle);border-radius:4px;padding:1px 5px;background:var(--surface-panel)}
.text-edit-wrap{position:absolute;z-index:8;display:flex;transform-origin:center;pointer-events:none}.canvas-text-editor{display:block;width:100%;max-height:100%;margin:0;padding:0;overflow:hidden;resize:none;background:transparent;border:0;outline:none;color:var(--edit-color);caret-color:var(--edit-color);font:inherit;line-height:1.25;text-align:inherit;pointer-events:auto}.text-edit-wrap.free .canvas-text-editor{max-height:none}.canvas-text-editor.card-field{font-weight:inherit;line-height:inherit;white-space:pre;overflow:hidden}.canvas-text-editor.card-field[data-field=description]{text-transform:uppercase}.canvas-text-editor.card-field[data-field=description]::placeholder{text-transform:uppercase}.canvas-text-editor::placeholder{color:color-mix(in srgb,var(--edit-color) 55%,transparent);opacity:1}.canvas-text-editor::selection{background:color-mix(in srgb,var(--accent) 30%,transparent)}.draft-conflict{position:absolute;top:calc(100% + 8px);left:0;min-width:260px;background:var(--surface-panel);border:1px solid var(--status-error);border-radius:var(--radius-1);padding:12px;font-size:12px;pointer-events:auto}
</style>

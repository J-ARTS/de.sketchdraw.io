<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue';
import AppIcon from './AppIcon.vue';
import { useWhiteboard } from './use-whiteboard';
import { t } from '@/renderer/i18n/de';
import { bounds } from '@/renderer/lib/geometry';
import type { Rect } from '@/renderer/state/contract';

const WIDTH = 200;
const HEIGHT = 112;
const PADDING = 8;

const store = useWhiteboard();
const s = store.state;

/** Visible canvas area in document coordinates. */
const view = computed<Rect>(() => {
  const { zoom, panX, panY } = s.viewport;
  return { x: -panX / zoom, y: -panY / zoom, width: s.viewportSize.width / zoom, height: s.viewportSize.height / zoom };
});

const shapes = computed(() =>
  s.displayElements
    .filter((element) => element.kind !== 'connector')
    .map((element) => ({ id: element.id, rect: bounds([element]), container: element.kind === 'container' }))
    .filter((shape): shape is { id: string; rect: Rect; container: boolean } => shape.rect !== null),
);

/** Union of content and view, so the viewport frame never leaves the map. */
const world = computed<Rect>(() => {
  const content = bounds(s.displayElements);
  const rects = content ? [content, view.value] : [view.value];
  const left = Math.min(...rects.map((r) => r.x));
  const top = Math.min(...rects.map((r) => r.y));
  const right = Math.max(...rects.map((r) => r.x + r.width));
  const bottom = Math.max(...rects.map((r) => r.y + r.height));
  return { x: left, y: top, width: Math.max(1, right - left), height: Math.max(1, bottom - top) };
});

const transform = computed(() => {
  const w = world.value;
  const scale = Math.min((WIDTH - 2 * PADDING) / w.width, (HEIGHT - 2 * PADDING) / w.height);
  return { scale, offsetX: (WIDTH - w.width * scale) / 2 - w.x * scale, offsetY: (HEIGHT - w.height * scale) / 2 - w.y * scale };
});

function toMap(rect: Rect): Rect {
  const { scale, offsetX, offsetY } = transform.value;
  return { x: rect.x * scale + offsetX, y: rect.y * scale + offsetY, width: Math.max(2, rect.width * scale), height: Math.max(2, rect.height * scale) };
}

const mapShapes = computed(() => shapes.value.map((shape) => ({ ...shape, rect: toMap(shape.rect) })));
const mapView = computed(() => toMap(view.value));

const svg = ref<SVGSVGElement | null>(null);
let dragging = false;

function centerAt(event: PointerEvent): void {
  const box = svg.value?.getBoundingClientRect();
  if (!box) return;
  const { scale, offsetX, offsetY } = transform.value;
  const docX = ((event.clientX - box.left) * (WIDTH / box.width) - offsetX) / scale;
  const docY = ((event.clientY - box.top) * (HEIGHT / box.height) - offsetY) / scale;
  const { zoom, panX, panY } = s.viewport;
  store.panBy(s.viewportSize.width / 2 - docX * zoom - panX, s.viewportSize.height / 2 - docY * zoom - panY);
}

function onPointerDown(event: PointerEvent): void {
  if (event.button !== 0) return;
  dragging = true;
  svg.value?.setPointerCapture(event.pointerId);
  centerAt(event);
}

function onPointerMove(event: PointerEvent): void {
  if (dragging) centerAt(event);
}

function onPointerUp(event: PointerEvent): void {
  dragging = false;
  if (svg.value?.hasPointerCapture(event.pointerId)) svg.value.releasePointerCapture(event.pointerId);
}

const fullscreen = ref(Boolean(document.fullscreenElement));
const canFullscreen = Boolean(document.fullscreenEnabled);
function syncFullscreen(): void { fullscreen.value = Boolean(document.fullscreenElement); }
function toggleFullscreen(): void {
  if (document.fullscreenElement) void document.exitFullscreen();
  else void document.documentElement.requestFullscreen().catch(() => undefined);
}

onMounted(() => document.addEventListener('fullscreenchange', syncFullscreen));
onBeforeUnmount(() => document.removeEventListener('fullscreenchange', syncFullscreen));
</script>

<template>
  <section class="minimap sd-panel" :aria-label="t('minimap.label')" data-testid="minimap">
    <svg
      ref="svg"
      class="map"
      :viewBox="`0 0 ${WIDTH} ${HEIGHT}`"
      :width="WIDTH"
      :height="HEIGHT"
      aria-hidden="true"
      @pointerdown="onPointerDown"
      @pointermove="onPointerMove"
      @pointerup="onPointerUp"
      @pointercancel="onPointerUp"
    >
      <rect
        v-for="shape in mapShapes"
        :key="shape.id"
        class="shape"
        :class="{ container: shape.container }"
        :x="shape.rect.x"
        :y="shape.rect.y"
        :width="shape.rect.width"
        :height="shape.rect.height"
        rx="1.5"
      />
      <rect class="view" :x="mapView.x" :y="mapView.y" :width="mapView.width" :height="mapView.height" rx="3" />
    </svg>
    <button
      v-if="canFullscreen"
      type="button"
      class="fullscreen sd-icon-btn"
      :aria-pressed="fullscreen"
      :aria-label="t('minimap.fullscreen')"
      :title="t('minimap.fullscreen')"
      @click="toggleFullscreen"
    >
      <AppIcon name="maximize" :size="16" />
    </button>
  </section>
</template>

<style scoped>
.minimap {
  position: absolute;
  right: 16px;
  bottom: 16px;
  z-index: 5;
  padding: 6px;
  line-height: 0;
}

svg {
  display: block;
  border-radius: 8px;
  background: var(--surface-canvas);
  cursor: pointer;
  touch-action: none;
}

.shape {
  fill: var(--border-subtle);
  stroke: var(--canvas-grid);
  stroke-width: 0.75;
}

.shape.container {
  fill: transparent;
}

.view {
  fill: color-mix(in srgb, var(--accent) 8%, transparent);
  stroke: var(--accent);
  stroke-width: 1.5;
}

.fullscreen {
  position: absolute;
  top: 10px;
  right: 10px;
  width: 28px;
  height: 28px;
  min-width: 0;
  min-height: 0;
  border-radius: 8px;
  background: var(--surface-panel);
  box-shadow: 0 1px 2px rgb(0 0 0 / 8%);
}

.fullscreen[aria-pressed='true'] {
  color: var(--accent);
}

@media (max-width: 760px) {
  .minimap {
    display: none;
  }
}
</style>

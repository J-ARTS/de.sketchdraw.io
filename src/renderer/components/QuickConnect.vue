<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import AppIcon from './AppIcon.vue';
import ElementView from './ElementView.vue';
import { useWhiteboard } from './use-whiteboard';
import { t } from '@/renderer/i18n/de';
import { createElement, type SketchElement } from '@/domain';
import { DEFAULT_STYLE, QUICK_CONNECT_KINDS } from '@/renderer/lib/constants';
import { center, normalizedRect, rotatePoint } from '@/renderer/lib/geometry';
import { planQuickConnect, QUICK_DIRECTIONS, QUICK_HANDLE_OFFSET, QUICK_SIDES, quickConnectCopy } from '@/renderer/lib/quick-connect';
import { docToScreen } from '@/renderer/lib/viewport';
import type { QuickDirection } from '@/renderer/state/contract';

const store = useWhiteboard();
const s = store.state;

/** Quick connect is offered for exactly one selected shape while nothing else is in progress. */
const source = computed<SketchElement | null>(() => {
  if (!s.canWrite || s.transitioning || s.tool !== 'select' || s.selection.length !== 1) return null;
  if (s.textEdit || s.hasElementPreview || s.draftElement || s.marquee || s.gestureConflict) return null;
  const element = s.document.elements.find((e) => e.id === s.selection[0]);
  return element && QUICK_CONNECT_KINDS.has(element.kind) ? element : null;
});

const hovered = ref<QuickDirection | null>(null);
watch(() => source.value?.id, () => { hovered.value = null; });

const handles = computed(() => {
  const element = source.value;
  if (!element) return [];
  const c = center(element);
  const angle = (element.rotation * Math.PI) / 180;
  return QUICK_DIRECTIONS.map((direction) => {
    const side = QUICK_SIDES[direction];
    const edge = rotatePoint({ x: element.x + side.from.x * element.width, y: element.y + side.from.y * element.height }, c, element.rotation);
    const screen = docToScreen(s.viewport, edge);
    const axis = { x: side.axis.x * Math.cos(angle) - side.axis.y * Math.sin(angle), y: side.axis.x * Math.sin(angle) + side.axis.y * Math.cos(angle) };
    return { direction, x: screen.x + axis.x * QUICK_HANDLE_OFFSET, y: screen.y + axis.y * QUICK_HANDLE_OFFSET, label: t(`quick.${direction}`) };
  });
});

/** Ghost of the copy and its arrow; ids are prefixed so they never count as document elements. */
const preview = computed<SketchElement[]>(() => {
  const element = source.value;
  if (!element || !hovered.value) return [];
  const plan = planQuickConnect(element, hovered.value, s.document.elements);
  const rect = normalizedRect(plan.start, plan.end);
  try {
    return [
      createElement(element.kind, { id: 'quick-preview:shape', ...quickConnectCopy(element, plan.shape) }),
      createElement('connector', { id: 'quick-preview:arrow', ...rect, points: [plan.start, plan.end].map((p) => ({ x: p.x - rect.x, y: p.y - rect.y })), style: { ...DEFAULT_STYLE } }),
    ];
  } catch {
    return [];
  }
});

const transform = computed(() => `translate(${s.viewport.panX} ${s.viewport.panY}) scale(${s.viewport.zoom})`);

function create(direction: QuickDirection): void {
  hovered.value = null;
  store.quickConnect(direction);
}
</script>

<template>
  <template v-if="source">
    <svg v-if="preview.length" class="quick-preview" aria-hidden="true" data-testid="quick-connect-preview">
      <g :transform="transform">
        <ElementView v-for="element in preview" :key="element.id" :element="element" :document="s.document" :theme="s.theme" />
      </g>
    </svg>
    <button
      v-for="handle in handles"
      :key="handle.direction"
      type="button"
      class="quick-handle"
      :class="[handle.direction, { active: hovered === handle.direction }]"
      :style="{ left: `${handle.x}px`, top: `${handle.y}px` }"
      :data-testid="`quick-connect-${handle.direction}`"
      :aria-label="handle.label"
      :title="handle.label"
      @pointerenter="hovered = handle.direction"
      @pointerleave="hovered = null"
      @focus="hovered = handle.direction"
      @blur="hovered = null"
      @click="create(handle.direction)"
    >
      <span class="dot" aria-hidden="true" />
      <span class="arrow" aria-hidden="true"><AppIcon name="arrow" :size="16" /></span>
    </button>
  </template>
</template>

<style scoped>
.quick-preview {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  overflow: visible;
  opacity: 0.35;
  pointer-events: none;
}

.quick-handle {
  position: absolute;
  z-index: 4;
  display: grid;
  place-items: center;
  width: 28px;
  height: 28px;
  padding: 0;
  background: transparent;
  border: 0;
  border-radius: 50%;
  cursor: pointer;
  transform: translate(-50%, -50%);
}

.dot {
  width: 9px;
  height: 9px;
  border-radius: 50%;
  background: color-mix(in srgb, var(--accent) 55%, transparent);
  box-shadow: 0 0 0 2px var(--surface-panel);
  transition: transform var(--duration-short) ease, opacity var(--duration-short) ease;
}

.arrow {
  position: absolute;
  inset: 0;
  display: grid;
  place-items: center;
  border-radius: 50%;
  background: var(--accent);
  box-shadow: 0 0 0 2px var(--surface-panel), 0 2px 6px rgb(45 35 90 / 25%);
  color: var(--accent-contrast);
  opacity: 0;
  transform: scale(0.4);
  transition: transform var(--duration-short) ease, opacity var(--duration-short) ease;
}

.top .arrow :deep(svg) { transform: rotate(-90deg); }
.bottom .arrow :deep(svg) { transform: rotate(90deg); }
.left .arrow :deep(svg) { transform: rotate(180deg); }

.quick-handle.active .arrow,
.quick-handle:focus-visible .arrow {
  opacity: 1;
  transform: scale(1);
}

.quick-handle.active .dot,
.quick-handle:focus-visible .dot {
  opacity: 0;
}

.quick-handle:focus-visible {
  outline-offset: 3px;
}

@media (forced-colors: active) {
  .dot,
  .arrow {
    forced-color-adjust: none;
    background: Highlight;
    color: HighlightText;
  }
}
</style>

<script setup lang="ts">
import { computed } from 'vue';
import type { SketchElement } from '@/domain';
import { SWIMLANE, type BpmnDecoration } from '@/renderer/lib/bpmn';
import { fontFamilyCss } from '@/renderer/lib/constants';

/**
 * What makes an ordinary element a BPMN element on screen (#196): the title strip of a pool or lane, the
 * inner ring of an intermediate event, the symbol of an event or task type, and the marker of an activity.
 * Drawn in the element's own coordinates, inside its group.
 */
const props = defineProps<{ element: SketchElement; decoration: BpmnDecoration; stroke: string; fill: string; textColor: string; editing?: boolean }>();

const e = computed(() => props.element);
const eventElement = computed(() => e.value.kind === 'ellipse');
/** Events carry their symbol in the middle, activities at the top left. */
const iconBox = computed(() => {
  if (eventElement.value) { const size = Math.min(e.value.width, e.value.height) * 0.56; return { x: (e.value.width - size) / 2, y: (e.value.height - size) / 2, size }; }
  return { x: 8, y: 7, size: 20 };
});
const markerBox = computed(() => ({ x: e.value.width / 2 - 8, y: e.value.height - 21, size: 16 }));
const ring = computed(() => Math.max(3, Math.min(e.value.width, e.value.height) * 0.08));
const title = computed(() => e.value.text || e.value.label || '');
const solidFill = computed(() => (props.fill === 'transparent' ? 'var(--surface-canvas)' : props.fill));
</script>

<template>
  <g class="bpmn-decor" pointer-events="none">
    <template v-if="decoration.role">
      <line data-testid="swimlane-strip" :x1="SWIMLANE.strip" y1="0" :x2="SWIMLANE.strip" :y2="e.height" :stroke="stroke" :stroke-width="e.style.strokeWidth" />
      <text v-if="!editing" data-testid="swimlane-title" :transform="`translate(${SWIMLANE.strip / 2} ${e.height / 2}) rotate(-90)`" :fill="textColor" :font-size="e.style.fontSize" :font-family="fontFamilyCss(e.style.fontFamily)" :font-weight="e.style.fontWeight ?? 'normal'" text-anchor="middle" dominant-baseline="central">{{ title }}</text>
    </template>
    <ellipse v-if="decoration.event === 'intermediate'" data-testid="bpmn-inner-ring" :cx="e.width / 2" :cy="e.height / 2" :rx="Math.max(1, e.width / 2 - ring)" :ry="Math.max(1, e.height / 2 - ring)" fill="none" :stroke="stroke" :stroke-width="e.style.strokeWidth" />
    <svg v-if="decoration.icon" data-testid="bpmn-icon" :x="iconBox.x" :y="iconBox.y" :width="iconBox.size" :height="iconBox.size" viewBox="0 0 24 24" overflow="visible">
      <path v-for="(path, index) in decoration.icon" :key="index" :d="path.d" :fill="path.fill ? stroke : 'none'" :stroke="path.contrast ? solidFill : stroke" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" />
    </svg>
    <svg v-if="decoration.marker" data-testid="bpmn-marker" :x="markerBox.x" :y="markerBox.y" :width="markerBox.size" :height="markerBox.size" viewBox="0 0 16 16" overflow="visible">
      <path v-for="(d, index) in decoration.marker" :key="index" :d="d" fill="none" :stroke="stroke" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" />
    </svg>
  </g>
</template>

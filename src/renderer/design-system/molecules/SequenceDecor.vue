<!-- @component What makes an ordinary shape a part of a sequence diagram on the canvas: fragment heading, section condition, actor figure, message number. -->
<script setup lang="ts">
import { computed } from 'vue';
import { connectorRoutePoints, type SketchElement } from '@/domain';
import { fontFamilyCss } from '@/renderer/lib/constants';
import { fragmentOperator, SEQUENCE_HEAD_KEY, SEQUENCE_NUMBER_KEY, sequenceRole } from '@/renderer/lib/sequence-model';

/**
 * What makes an ordinary element a part of a sequence diagram on screen (#199): the heading of a fragment
 * (loop, alt, …) with its condition, the condition under a divider, the stick figure of an actor and the
 * running number at the start of a message. Drawn in the element's own coordinates, inside its group.
 */
const props = defineProps<{ element: SketchElement; stroke: string; textColor: string; editing?: boolean }>();

const e = computed(() => props.element);
const part = computed(() => sequenceRole(e.value));
const font = computed(() => fontFamilyCss(e.value.style.fontFamily));
const operator = computed(() => (part.value === 'fragment' ? fragmentOperator(e.value) : null));
const tabWidth = computed(() => (operator.value ? operator.value.length * 8 + 22 : 0));
const condition = computed(() => (e.value.text ?? '').trim());
const actor = computed(() => part.value === 'head' && e.value.metadata?.[SEQUENCE_HEAD_KEY] === 'actor');
const ink = computed(() => (props.stroke === 'transparent' ? props.textColor : props.stroke));
const number = computed(() => (part.value === 'message' ? e.value.metadata?.[SEQUENCE_NUMBER_KEY] ?? '' : ''));
const start = computed(() => connectorRoutePoints(e.value)[0] ?? { x: 0, y: 0 });
</script>

<template>
  <g class="sequence-decor" pointer-events="none">
    <template v-if="operator && operator !== 'rect'">
      <path data-testid="sequence-fragment-tab" :d="`M0 0H${tabWidth}V16l-8 8H0Z`" fill="var(--surface-canvas)" :stroke="stroke" :stroke-width="e.style.strokeWidth" stroke-linejoin="round" />
      <text data-testid="sequence-fragment-operator" x="9" y="12.5" :fill="textColor" font-size="13" font-weight="650" :font-family="font" dominant-baseline="central">{{ operator }}</text>
      <text v-if="condition && !editing" data-testid="sequence-fragment-condition" :x="tabWidth + 8" y="12.5" :fill="textColor" :font-size="e.style.fontSize" :font-family="font" dominant-baseline="central">[{{ condition }}]</text>
    </template>
    <text v-else-if="part === 'divider' && condition && !editing" data-testid="sequence-section-condition" x="10" y="13" :fill="textColor" :font-size="e.style.fontSize" :font-family="font" dominant-baseline="central">[{{ condition }}]</text>
    <template v-else-if="actor">
      <g data-testid="sequence-actor" fill="none" :stroke="ink" stroke-width="2" stroke-linecap="round" :transform="`translate(${e.width / 2} 0)`">
        <circle cx="0" cy="10" r="8" />
        <path d="M0 18v18M-14 25h28M0 36l-12 14M0 36l12 14" />
      </g>
      <text v-if="!editing" data-testid="sequence-actor-name" :x="e.width / 2" :y="e.height - 10" :fill="textColor" :font-size="e.style.fontSize" :font-family="font" text-anchor="middle" dominant-baseline="central">{{ e.text }}</text>
    </template>
    <g v-else-if="number" data-testid="sequence-number">
      <circle :cx="start.x" :cy="start.y" r="10" :fill="ink" stroke="var(--surface-canvas)" stroke-width="1.5" />
      <text :x="start.x" :y="start.y" fill="var(--surface-canvas)" font-size="11" font-weight="650" :font-family="font" text-anchor="middle" dominant-baseline="central">{{ number }}</text>
    </g>
  </g>
</template>

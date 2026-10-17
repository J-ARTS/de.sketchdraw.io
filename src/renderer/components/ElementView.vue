<script setup lang="ts">
import { computed, useId } from 'vue';
import type { SketchDocument, SketchElement } from '@/domain';
import { themeColor } from '../lib/theme';
import { fontFamilyCss } from '../lib/constants';
import { describeElement } from '../lib/describe';
import SafeIcon from './SafeIcon';

const props = defineProps<{ element: SketchElement; document: SketchDocument; theme: 'light' | 'dark'; editing?: boolean }>();
const uid = useId().replace(/[^a-zA-Z0-9_-]/g, '');
const e = computed(() => props.element);
const stroke = computed(() => themeColor(e.value.style.stroke, props.theme));
const fill = computed(() => themeColor(e.value.style.fill, props.theme));
const dash = computed(() => e.value.style.strokeDash === 'dashed' ? '8 6' : e.value.style.strokeDash === 'dotted' ? '2 5' : undefined);
const asset = computed(() => props.document.assets[e.value.assetId ?? '']);
const definition = computed(() => props.document.componentSets.flatMap((set) => set.components).find((c) => c.type === e.value.componentType));
const text = computed(() => e.value.text || e.value.label || '');
const fontSize = computed(() => e.value.style.fontSize);
const lines = computed(() => {
  const max = Math.max(1, Math.floor((e.value.width - (e.value.kind === 'text' ? 0 : 16)) / (fontSize.value * .6)));
  return text.value.split('\n').flatMap((line) => {
    const chars = Array.from(line); const result: string[] = [];
    for (let i = 0; i < chars.length; i += max) result.push(chars.slice(i, i + max).join(''));
    return result.length ? result : [''];
  }).slice(0, Math.max(1, Math.ceil(e.value.height / (fontSize.value * 1.25))));
});
const textX = computed(() => e.value.style.textAlign === 'center' ? e.value.width / 2 : e.value.style.textAlign === 'right' ? e.value.width - 8 : e.value.kind === 'text' ? 0 : 8);
const textY = computed(() => e.value.kind === 'container' ? 8 : e.value.kind === 'text' ? 0 : e.value.kind === 'component' ? e.value.height * .58 : Math.max(4, (e.value.height - lines.value.length * fontSize.value * 1.25) / 2));
</script>

<template>
  <g :data-element-id="e.id" :data-kind="e.kind" :transform="`translate(${e.x} ${e.y}) rotate(${e.rotation} ${e.width / 2} ${e.height / 2})`" :opacity="e.style.opacity">
    <title>{{ describeElement(e, document) }}</title>
    <defs>
      <clipPath :id="`${uid}-clip`"><rect :width="e.width" :height="e.height" /></clipPath>
      <marker :id="`${uid}-arrow`" markerWidth="9" markerHeight="9" refX="8" refY="4.5" orient="auto" markerUnits="userSpaceOnUse"><path d="M1 1 L8 4.5 L1 8" fill="none" :stroke="stroke" :stroke-width="e.style.strokeWidth" /></marker>
    </defs>
    <g :stroke="stroke" :fill="fill" :stroke-width="e.style.strokeWidth" :stroke-dasharray="dash" stroke-linecap="round" stroke-linejoin="round">
      <rect v-if="['rectangle', 'container', 'component'].includes(e.kind)" :width="e.width" :height="e.height" :rx="e.kind === 'component' ? 10 : 3" />
      <ellipse v-else-if="e.kind === 'ellipse'" :cx="e.width / 2" :cy="e.height / 2" :rx="e.width / 2" :ry="e.height / 2" />
      <polygon v-else-if="e.kind === 'diamond'" :points="`${e.width / 2},0 ${e.width},${e.height / 2} ${e.width / 2},${e.height} 0,${e.height / 2}`" />
      <polyline v-else-if="e.kind === 'path' || e.kind === 'connector'" :points="e.points?.map(p => `${p.x},${p.y}`).join(' ')" fill="none" :marker-end="e.kind === 'connector' ? `url(#${uid}-arrow)` : undefined" />
      <image v-else-if="e.kind === 'image' && asset" :href="asset?.dataUrl" :width="e.width" :height="e.height" preserveAspectRatio="none" />
    </g>
    <svg v-if="e.kind === 'component'" :x="e.width / 2 - 16" :y="Math.max(8, e.height * .15)" width="32" height="32"><SafeIcon :source="definition?.iconSvg" /></svg>
    <text v-if="text && !editing" :clip-path="`url(#${uid}-clip)`" :fill="stroke" :font-size="fontSize" :font-family="fontFamilyCss(e.style.fontFamily)" :text-anchor="e.style.textAlign === 'center' ? 'middle' : e.style.textAlign === 'right' ? 'end' : 'start'" dominant-baseline="text-before-edge" pointer-events="none">
      <tspan v-for="(line, i) in lines" :key="i" :x="textX" :y="textY + i * fontSize * 1.25">{{ line }}</tspan>
    </text>
  </g>
</template>

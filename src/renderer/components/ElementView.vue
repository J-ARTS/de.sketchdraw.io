<script setup lang="ts">
import { computed, useId } from 'vue';
import { connectorEndMarker, connectorPathData, connectorStartMarker, createAnnotationDocument, type ConnectorMarker, type SketchDocument, type SketchElement } from '@/domain';
import { themeColor } from '../lib/theme';
import { fontFamilyCss } from '../lib/constants';
import { describeElement } from '../lib/describe';
import SafeIcon from './SafeIcon';
import { shapeEntryForElement } from '../lib/shapes';
import { builtInComponentSets, isResourceCard, resourceCardIconType, resourceCardLinks } from '@/catalog';
import AnnotationContent from './AnnotationContent.vue';
import TableContent from './TableContent.vue';

const props = defineProps<{ element: SketchElement; document: SketchDocument; theme: 'light' | 'dark'; editing?: boolean }>();
const emit = defineEmits<{ openLink: [url: string] }>();
const uid = useId().replace(/[^a-zA-Z0-9_-]/g, '');
const e = computed(() => props.element);
const stroke = computed(() => themeColor(e.value.style.stroke, props.theme));
const fill = computed(() => themeColor(e.value.style.fill, props.theme));
const dash = computed(() => e.value.style.strokeDash === 'dashed' ? '8 6' : e.value.style.strokeDash === 'dotted' ? '2 5' : undefined);
const asset = computed(() => props.document.assets[e.value.assetId ?? '']);
const definition = computed(() => props.document.componentSets.flatMap((set) => set.components).find((c) => c.type === e.value.componentType));
const resourceCard = computed(() => isResourceCard(e.value));
const definitions = computed(() => [...props.document.componentSets, ...builtInComponentSets].flatMap((set) => set.components));
const resourceIcon = computed(() => definitions.value.find((candidate) => candidate.type === resourceCardIconType(e.value)) ?? definition.value);
const cardLinks = computed(() => resourceCardLinks(e.value));
const cardFooterHeight = computed(() => Math.max(28, Math.min(36, e.value.height * .24)));
const cardBodyHeight = computed(() => Math.max(0, e.value.height - cardFooterHeight.value));
const cardIconSize = computed(() => Math.max(28, Math.min(52, cardBodyHeight.value * .48, e.value.width * .16)));
const cardTextX = computed(() => 20 + cardIconSize.value + 18);
function clampCardText(value: string, size: number): string {
  const available = Math.max(24, e.value.width - cardTextX.value - 18);
  const max = Math.max(3, Math.floor(available / (size * .58)));
  return value.length > max ? `${Array.from(value).slice(0, Math.max(1, max - 1)).join('')}…` : value;
}
function clampCardLinkLabel(value: string, count: number, size: number): string {
  const available = Math.max(20, e.value.width / Math.max(1, count) - 16);
  const max = Math.max(3, Math.floor(available / (size * .58)));
  const characters = Array.from(value.toUpperCase());
  return characters.length > max ? `${characters.slice(0, Math.max(1, max - 1)).join('')}…` : characters.join('');
}
const cardTitle = computed(() => clampCardText(e.value.text || e.value.label || 'Ressourcenkarte', Math.max(14, e.value.style.fontSize)));
const cardDescription = computed(() => clampCardText((e.value.description || 'BESCHREIBUNG').toUpperCase(), Math.max(10, e.value.style.fontSize * .65)));
const text = computed(() => e.value.text || e.value.label || '');
const displayText = computed(() => e.value.kind === 'sticky-note' && !text.value ? 'Schreib etwas, @erwähne jemanden' : text.value);
const annotation = computed(() => e.value.annotation ?? createAnnotationDocument(e.value.text ?? ''));
const fontSize = computed(() => e.value.style.fontSize);
const lines = computed(() => {
  const inset = e.value.kind === 'sticky-note' ? 40 : e.value.kind === 'text' ? 0 : 16;
  const max = Math.max(1, Math.floor((e.value.width - inset) / (fontSize.value * .6)));
  return displayText.value.split('\n').flatMap((line) => {
    const chars = Array.from(line); const result: string[] = [];
    for (let i = 0; i < chars.length; i += max) result.push(chars.slice(i, i + max).join(''));
    return result.length ? result : [''];
  }).map((line) => e.value.style.listStyle === 'bullet' && line ? `• ${line}` : line)
    .slice(0, Math.max(1, Math.floor((e.value.height - (e.value.kind === 'sticky-note' ? 68 : 0)) / (fontSize.value * 1.25))));
});
const textX = computed(() => e.value.style.textAlign === 'center' ? e.value.width / 2 : e.value.style.textAlign === 'right' ? e.value.width - (e.value.kind === 'sticky-note' ? 20 : 8) : e.value.kind === 'text' ? 0 : e.value.kind === 'sticky-note' ? 20 : 8);
const textY = computed(() => e.value.kind === 'sticky-note' ? 20 : e.value.kind === 'container' ? 8 : e.value.kind === 'text' ? 0 : e.value.kind === 'component' ? e.value.height * .58 : Math.max(4, (e.value.height - lines.value.length * fontSize.value * 1.25) / 2));
const connectorPath = computed(() => e.value.kind === 'connector' ? connectorPathData(e.value) : '');
const startMarker = computed(() => e.value.kind === 'connector' ? connectorStartMarker(e.value) : 'none');
const endMarker = computed(() => e.value.kind === 'connector' ? connectorEndMarker(e.value) : 'none');
const markerUrl = (marker: ConnectorMarker) => marker === 'none' ? undefined : `url(#${uid}-${marker})`;
const connectorLabelWidth = computed(() => Math.max(36, text.value.length * fontSize.value * .62 + 16));
const shape = computed(() => shapeEntryForElement(e.value));
</script>

<template>
  <g :data-element-id="e.id" :data-kind="e.kind" :data-shape-variant="shape?.id" :data-resource-icon-type="resourceCard ? resourceCardIconType(e) : undefined" :transform="`translate(${e.x} ${e.y}) rotate(${e.rotation} ${e.width / 2} ${e.height / 2})`" :opacity="e.style.opacity">
    <title>{{ describeElement(e, document) }}</title>
    <defs>
      <clipPath :id="`${uid}-clip`"><rect :width="e.width" :height="e.height" /></clipPath>
      <filter :id="`${uid}-sticky-shadow`" x="-20%" y="-20%" width="140%" height="150%"><feDropShadow dx="0" dy="4" stdDeviation="6" flood-color="#18251d" flood-opacity=".18" /></filter>
      <filter :id="`${uid}-annotation-shadow`" x="-10%" y="-10%" width="120%" height="130%"><feDropShadow dx="0" dy="4" stdDeviation="7" flood-color="#263244" flood-opacity=".14" /></filter>
      <marker :id="`${uid}-line-arrow`" markerWidth="12" markerHeight="12" refX="10" refY="6" orient="auto-start-reverse" markerUnits="userSpaceOnUse"><path d="M2 1.5 L10 6 L2 10.5" fill="none" :stroke="stroke" :stroke-width="Math.max(1.5, e.style.strokeWidth)" /></marker>
      <marker :id="`${uid}-solid-arrow`" markerWidth="12" markerHeight="12" refX="10" refY="6" orient="auto-start-reverse" markerUnits="userSpaceOnUse"><path d="M1 1 L11 6 L1 11 Z" :fill="stroke" :stroke="stroke" /></marker>
      <marker :id="`${uid}-triangle`" markerWidth="12" markerHeight="12" refX="10" refY="6" orient="auto-start-reverse" markerUnits="userSpaceOnUse"><path d="M1 1 L11 6 L1 11 Z" :fill="fill === 'transparent' ? 'var(--surface-canvas)' : fill" :stroke="stroke" :stroke-width="Math.max(1, e.style.strokeWidth * .75)" /></marker>
      <marker :id="`${uid}-circle`" markerWidth="12" markerHeight="12" refX="10" refY="6" orient="auto-start-reverse" markerUnits="userSpaceOnUse"><circle cx="6" cy="6" r="4.5" :fill="fill === 'transparent' ? 'var(--surface-canvas)' : fill" :stroke="stroke" :stroke-width="Math.max(1, e.style.strokeWidth * .75)" /></marker>
      <marker :id="`${uid}-diamond`" markerWidth="14" markerHeight="14" refX="12" refY="7" orient="auto-start-reverse" markerUnits="userSpaceOnUse"><path d="M1 7 L7 1 L13 7 L7 13 Z" :fill="fill === 'transparent' ? 'var(--surface-canvas)' : fill" :stroke="stroke" :stroke-width="Math.max(1, e.style.strokeWidth * .75)" /></marker>
    </defs>
    <g :stroke="stroke" :fill="fill" :stroke-width="e.style.strokeWidth" :stroke-dasharray="dash" stroke-linecap="round" stroke-linejoin="round">
      <rect v-if="shape?.id === 'square'" :width="e.width" :height="e.height" rx="3" />
      <ellipse v-else-if="shape?.id === 'circle'" :cx="e.width / 2" :cy="e.height / 2" :rx="e.width / 2" :ry="e.height / 2" />
      <polygon v-else-if="shape?.id === 'diamond'" :points="`${e.width / 2},0 ${e.width},${e.height / 2} ${e.width / 2},${e.height} 0,${e.height / 2}`" />
      <svg v-else-if="shape" :width="e.width" :height="e.height" viewBox="3 3 18 18" preserveAspectRatio="none" overflow="visible">
        <path v-for="(d, index) in shape.icon" :key="d" :d="d" :fill="index === 0 ? fill : 'none'" vector-effect="non-scaling-stroke" />
      </svg>
      <template v-else-if="resourceCard">
        <rect data-testid="resource-card-surface" :width="e.width" :height="e.height" rx="8" />
        <path :d="`M0 ${e.height - cardFooterHeight} H${e.width} V${e.height - 8} Q${e.width} ${e.height} ${e.width - 8} ${e.height} H8 Q0 ${e.height} 0 ${e.height - 8} Z`" fill="var(--accent-soft)" stroke="none" />
      </template>
      <rect v-else-if="['container', 'component'].includes(e.kind)" :width="e.width" :height="e.height" :rx="e.kind === 'component' ? 10 : 3" />
      <rect v-else-if="e.kind === 'sticky-note'" data-testid="sticky-note-surface" :width="e.width" :height="e.height" :fill="fill" stroke="none" :filter="`url(#${uid}-sticky-shadow)`" />
      <rect v-else-if="e.kind === 'annotation'" data-testid="annotation-surface" :width="e.width" :height="e.height" rx="8" :fill="fill" :stroke="stroke" :filter="`url(#${uid}-annotation-shadow)`" />
      <TableContent v-else-if="e.kind === 'table'" :element="e" :theme="theme" />
      <polyline v-else-if="e.kind === 'path'" :points="e.points?.map(p => `${p.x},${p.y}`).join(' ')" fill="none" />
      <path v-else-if="e.kind === 'connector'" :d="connectorPath" fill="none" :marker-start="markerUrl(startMarker)" :marker-end="markerUrl(endMarker)" />
      <image v-else-if="e.kind === 'image' && asset" :href="asset?.dataUrl" :width="e.width" :height="e.height" preserveAspectRatio="none" />
    </g>
    <svg v-if="resourceCard" :x="20" :y="Math.max(10, (cardBodyHeight - cardIconSize) / 2)" :width="cardIconSize" :height="cardIconSize"><SafeIcon :source="resourceIcon?.iconSvg" /></svg>
    <svg v-else-if="e.kind === 'component'" :x="e.width / 2 - 16" :y="Math.max(8, e.height * .15)" width="32" height="32"><SafeIcon :source="definition?.iconSvg" /></svg>
    <g v-if="resourceCard && !editing" data-testid="resource-card-content" pointer-events="none">
      <text :x="cardTextX" :y="cardBodyHeight / 2 - Math.max(5, e.style.fontSize * .25)" :fill="stroke" :font-size="Math.max(14, e.style.fontSize)" :font-family="fontFamilyCss(e.style.fontFamily)" font-weight="600" dominant-baseline="central">{{ cardTitle }}</text>
      <text :x="cardTextX" :y="cardBodyHeight / 2 + Math.max(16, e.style.fontSize * .85)" :fill="stroke" fill-opacity=".55" :font-size="Math.max(10, e.style.fontSize * .65)" :font-family="fontFamilyCss(e.style.fontFamily)" font-weight="500" dominant-baseline="central">{{ cardDescription }}</text>
    </g>
    <template v-if="resourceCard && !editing">
      <g
        v-for="(link, index) in cardLinks"
        :key="link.id"
        :data-testid="`resource-card-link-${index}`"
        :transform="`translate(${index * e.width / cardLinks.length} ${e.height - cardFooterHeight})`"
        role="link"
        tabindex="0"
        pointer-events="all"
        :aria-label="`${link.label} öffnen`"
        @pointerdown.stop
        @click.stop="emit('openLink', link.url)"
        @keydown.enter.stop.prevent="emit('openLink', link.url)"
        @keydown.space.stop.prevent="emit('openLink', link.url)"
      >
        <rect :width="e.width / cardLinks.length" :height="cardFooterHeight" fill="transparent" stroke="none" />
        <line v-if="index" y1="7" :y2="cardFooterHeight - 7" stroke="var(--border-default)" stroke-width="1" />
        <text :x="e.width / cardLinks.length / 2" :y="cardFooterHeight / 2" fill="var(--accent)" :font-size="Math.max(10, Math.min(14, e.style.fontSize * .65))" :font-family="fontFamilyCss(e.style.fontFamily)" font-weight="650" text-anchor="middle" dominant-baseline="central">{{ clampCardLinkLabel(link.label, cardLinks.length, Math.max(10, e.style.fontSize * .65)) }}</text>
      </g>
    </template>
    <g v-if="e.kind === 'connector' && text && !editing" pointer-events="none">
      <rect :x="e.width / 2 - connectorLabelWidth / 2" :y="e.height / 2 - fontSize * .8" :width="connectorLabelWidth" :height="fontSize * 1.6" rx="4" fill="var(--surface-canvas)" />
      <text :x="e.width / 2" :y="e.height / 2" :fill="stroke" :font-size="fontSize" :font-family="fontFamilyCss(e.style.fontFamily)" text-anchor="middle" dominant-baseline="central">{{ text }}</text>
    </g>
    <foreignObject v-else-if="e.kind === 'annotation' && !editing" x="1" y="1" :width="Math.max(0, e.width - 2)" :height="Math.max(0, e.height - 2)" :clip-path="`url(#${uid}-clip)`" pointer-events="none">
      <div class="annotation-body" :style="{ color: stroke, fontSize: `${fontSize}px`, fontFamily: fontFamilyCss(e.style.fontFamily), textAlign: e.style.textAlign }"><AnnotationContent :document="annotation" /></div>
    </foreignObject>
    <text v-else-if="displayText && !editing && !resourceCard && !['annotation', 'table'].includes(e.kind)" :clip-path="`url(#${uid}-clip)`" :fill="stroke" :fill-opacity="e.kind === 'sticky-note' && !text ? .55 : 1" :font-size="fontSize" :font-family="fontFamilyCss(e.style.fontFamily)" :font-weight="e.style.fontWeight ?? 'normal'" :text-decoration="e.style.textDecoration ?? 'none'" :text-anchor="e.style.textAlign === 'center' ? 'middle' : e.style.textAlign === 'right' ? 'end' : 'start'" dominant-baseline="text-before-edge" pointer-events="none">
      <tspan v-for="(line, i) in lines" :key="i" :x="textX" :y="textY + i * fontSize * 1.25">{{ line }}</tspan>
    </text>
    <text v-if="e.kind === 'sticky-note' && e.author" data-testid="sticky-note-author" x="20" :y="e.height - 20" :fill="stroke" fill-opacity=".82" :font-size="Math.max(12, fontSize * .72)" :font-family="fontFamilyCss(e.style.fontFamily)" dominant-baseline="auto" pointer-events="none">{{ e.author }}</text>
  </g>
</template>

<style scoped>
.annotation-body{width:100%;height:100%;box-sizing:border-box;padding:28px;overflow:hidden;background:transparent}
</style>

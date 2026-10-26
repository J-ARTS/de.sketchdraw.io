<script setup lang="ts">
import { ROUNDABLE_POLYGONS, roundedPolygonPath } from '../lib/geometry';
import { t } from '@/renderer/i18n';
import { computed, ref, useId, watch } from 'vue';
import { connectorEndMarker, connectorPathData, connectorStartMarker, createAnnotationDocument, type ConnectorMarker, type SketchDocument, type SketchElement } from '@/domain';
import { themeColor } from '../lib/theme';
import { lineSegments, parseTextLinks } from '../lib/text-links';
import { wrapWords } from '../lib/text-metrics';
import { fontFamilyCss } from '../lib/constants';
import { describeElement } from '../lib/describe';
import SafeIcon from './SafeIcon';
import { shapeEntryForElement } from '../lib/shapes';
import { awsGroupOf, builtInComponentSets, groupChrome, groupTileSvg, isResourceCard, resourceCardIconType, resourceCardLinks } from '@/catalog';
import AnnotationContent from './AnnotationContent.vue';
import TableContent from './TableContent.vue';

const props = defineProps<{ element: SketchElement; document: SketchDocument; theme: 'light' | 'dark'; editing?: boolean; interactive?: boolean; staticPreview?: boolean }>();
const emit = defineEmits<{ openLink: [url: string] }>();
const uid = useId().replace(/[^a-zA-Z0-9_-]/g, '');
const e = computed(() => props.element);
const stroke = computed(() => themeColor(e.value.style.stroke, props.theme));
const fill = computed(() => themeColor(e.value.style.fill, props.theme));
const textColor = computed(() => themeColor(e.value.style.textColor ?? e.value.style.stroke, props.theme));
/** AWS group frames (#143): draw.io's fine dash pattern, scaled by the line width. */
const group = computed(() => awsGroupOf(e.value));
const dash = computed(() => {
  const line = e.value.style.strokeDash;
  if (line === 'solid') return undefined;
  if (group.value) { const unit = Math.max(1, e.value.style.strokeWidth); return line === 'dotted' ? `${unit} ${3 * unit}` : `${3 * unit} ${3 * unit}`; }
  return line === 'dashed' || line === 'animated' ? '8 6' : '2 5';
});
const chrome = computed(() => (group.value ? groupChrome(group.value, e.value.width, e.value.style.fontSize) : null));
const groupTile = computed(() => {
  const entry = group.value;
  if (!entry || !chrome.value?.icon) return undefined;
  const color = stroke.value;
  return groupTileSvg(entry, /^#[0-9a-f]{6}$/i.test(color) ? color : entry.stroke);
});
const asset = computed(() => props.document.assets[e.value.assetId ?? '']);
const definition = computed(() => props.document.componentSets.flatMap((set) => set.components).find((c) => c.type === e.value.componentType));
const resourceCard = computed(() => isResourceCard(e.value));
const cloudProvider = computed(() => {
  const provider = definition.value?.provider;
  return provider === 'aws' || provider === 'azure' || provider === 'gcp' || provider === 'kubernetes' ? provider : null;
});
const cloudCard = computed(() => Boolean(cloudProvider.value) && e.value.width >= 120 && e.value.height >= 120);
const cloudProviderLabel = computed(() => cloudProvider.value === 'gcp' ? 'GCP' : cloudProvider.value?.toUpperCase() ?? '');
/** Components are created with these style defaults; as long as they are untouched the card keeps its themed surface. */
const COMPONENT_DEFAULT_FILL = '#ffffff';
const COMPONENT_DEFAULT_STROKE = '#1e293b';
const cloudFill = computed(() => [COMPONENT_DEFAULT_FILL, definition.value?.style?.fill].includes(e.value.style.fill) ? 'var(--surface-raised)' : fill.value);
const cloudStroke = computed(() => [COMPONENT_DEFAULT_STROKE, definition.value?.style?.stroke].includes(e.value.style.stroke) ? 'var(--border-subtle)' : stroke.value);
const cloudIconSize = computed(() => Math.max(40, Math.min(64, e.value.width * .38, e.value.height * .38)));
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
function wrapCloudTitle(value: string): string[] {
  const max = Math.max(8, Math.floor((e.value.width - 24) / 8));
  const words = value.trim().split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  for (const word of words) {
    if (!lines.length) { lines.push(word); continue; }
    const candidate = `${lines[lines.length - 1]} ${word}`;
    if (candidate.length <= max || lines.length >= 2) lines[lines.length - 1] = candidate;
    else lines.push(word);
  }
  return lines.slice(0, 2).map((line) => line.length > max ? `${line.slice(0, Math.max(1, max - 1))}…` : line);
}
const cloudTitleLines = computed(() => wrapCloudTitle(text.value || definition.value?.name || t('Komponente')));
const CLOUD_TITLE_LINE_HEIGHT = 18;
const CLOUD_PROVIDER_GAP = 24;
const cloudTitleY = computed(() => cloudTitleLines.value.length > 1 ? Math.max(94, 24 + cloudIconSize.value) : Math.max(104, 30 + cloudIconSize.value));
const cloudProviderY = computed(() => Math.min(
  e.value.height - 12,
  cloudTitleY.value + (cloudTitleLines.value.length - 1) * CLOUD_TITLE_LINE_HEIGHT + CLOUD_PROVIDER_GAP,
));
const displayText = computed(() => e.value.kind === 'sticky-note' && !text.value ? t('Schreib etwas, @erwähne jemanden') : text.value);
const annotation = computed(() => e.value.annotation ?? createAnnotationDocument(e.value.text ?? ''));
const fontSize = computed(() => e.value.style.fontSize);
const lines = computed(() => {
  const inset = chrome.value ? chrome.value.label.left + (e.value.width - chrome.value.label.right) : e.value.kind === 'sticky-note' ? 40 : e.value.kind === 'text' ? 0 : 16;
  // Group labels wrap at word boundaries like draw.io; other text wraps by character count.
  const max = Math.max(1, Math.floor((e.value.width - inset) / (fontSize.value * (group.value ? .55 : .6))));
  let offset = 0;
  return displayText.value.split('\n').flatMap((line) => {
    if (group.value) { const wrapped = wrapWords(line, offset, max); offset += line.length + 1; return wrapped; }
    const chars = Array.from(line); const result: Array<{ text: string; from: number }> = [];
    let at = offset;
    for (let i = 0; i < chars.length; i += max) { const chunk = chars.slice(i, i + max).join(''); result.push({ text: chunk, from: at }); at += chunk.length; }
    offset += line.length + 1;
    return result.length ? result : [{ text: '', from: at }];
  }).map((entry) => ({ ...entry, bullet: e.value.style.listStyle === 'bullet' && entry.text !== '' }))
    .slice(0, Math.max(1, Math.floor((e.value.height - (e.value.kind === 'sticky-note' ? 68 : 0)) / (fontSize.value * 1.25))));
});
/** Hyperlinks on parts of the text, drawn underlined and opened with Ctrl/Cmd+click. */
const textLinks = computed(() => (text.value ? parseTextLinks(e.value.metadata, text.value.length) : []));
const textX = computed(() => chrome.value ? (e.value.style.textAlign === 'center' ? (chrome.value.label.left + chrome.value.label.right) / 2 : e.value.style.textAlign === 'right' ? chrome.value.label.right : chrome.value.label.left) : e.value.style.textAlign === 'center' ? e.value.width / 2 : e.value.style.textAlign === 'right' ? e.value.width - (e.value.kind === 'sticky-note' ? 20 : 8) : e.value.kind === 'text' ? 0 : e.value.kind === 'sticky-note' ? 20 : 8);
const textY = computed(() => chrome.value ? chrome.value.label.top : e.value.kind === 'sticky-note' ? 20 : e.value.kind === 'container' ? 8 : e.value.kind === 'text' ? 0 : e.value.kind === 'component' ? e.value.height * .58 : Math.max(4, (e.value.height - lines.value.length * fontSize.value * 1.25) / 2));
const connectorPath = computed(() => e.value.kind === 'connector' ? connectorPathData(e.value) : '');
const startMarker = computed(() => e.value.kind === 'connector' ? connectorStartMarker(e.value) : 'none');
const endMarker = computed(() => e.value.kind === 'connector' ? connectorEndMarker(e.value) : 'none');
const markerUrl = (marker: ConnectorMarker) => marker === 'none' ? undefined : `url(#${uid}-${marker})`;
const connectorLabelWidth = computed(() => Math.max(36, text.value.length * fontSize.value * .62 + 16));
const shape = computed(() => shapeEntryForElement(e.value));
/** Rounded rectangles: the radius is capped to half the shorter side; the default matches the former icon-based corner. */
const cornerRadius = computed(() => {
  const half = Math.min(e.value.width, e.value.height) / 2;
  return Math.max(0, Math.min(e.value.style.cornerRadius ?? Math.min(e.value.width, e.value.height) / 6, half));
});
/** Diamond and triangles are sharp by default; the corner radius is capped to half the shorter side. */
const polygonRadius = computed(() => Math.max(0, Math.min(e.value.style.cornerRadius ?? 0, Math.min(e.value.width, e.value.height) / 2)));
const embedHost = computed(() => {
  try { return new URL(e.value.embedUrl ?? '').hostname; }
  catch { return 'Webseite'; }
});
const embedState = ref<'loading' | 'loaded' | 'failed'>('loading');
const embedMatchesAppOrigin = computed(() => {
  if (!e.value.embedUrl || typeof window === 'undefined') return false;
  try { return new URL(e.value.embedUrl).origin === window.location.origin; }
  catch { return false; }
});
watch(() => e.value.embedUrl, () => { embedState.value = 'loading'; });
function markEmbedLoaded(): void { embedState.value = 'loaded'; }
function markEmbedFailed(): void { embedState.value = 'failed'; }
const frameTitle = computed(() => e.value.label?.trim() || t('Folie'));
</script>

<template>
  <g :data-element-id="e.id" :data-kind="e.kind" :data-shape-variant="shape?.id" :data-resource-icon-type="resourceCard ? resourceCardIconType(e) : undefined" :data-cloud-provider="cloudCard ? cloudProvider : undefined" :transform="`translate(${e.x} ${e.y}) rotate(${e.rotation} ${e.width / 2} ${e.height / 2})`" :opacity="e.style.opacity">
    <title>{{ describeElement(e, document) }}</title>
    <defs>
      <clipPath :id="`${uid}-clip`"><rect :width="e.width" :height="e.height" /></clipPath>
      <filter :id="`${uid}-sticky-shadow`" x="-20%" y="-20%" width="140%" height="150%"><feDropShadow dx="0" dy="4" stdDeviation="6" flood-color="#18251d" flood-opacity=".18" /></filter>
      <filter :id="`${uid}-annotation-shadow`" x="-10%" y="-10%" width="120%" height="130%"><feDropShadow dx="0" dy="4" stdDeviation="7" flood-color="#263244" flood-opacity=".14" /></filter>
      <marker :id="`${uid}-line-arrow`" markerWidth="12" markerHeight="12" refX="10" refY="6" orient="auto-start-reverse" markerUnits="userSpaceOnUse"><path d="M2 1.5 L10 6 L2 10.5" fill="none" :stroke="stroke" :stroke-width="Math.max(1.5, e.style.strokeWidth)" /></marker>
      <marker :id="`${uid}-solid-arrow`" markerWidth="12" markerHeight="12" refX="10" refY="6" orient="auto-start-reverse" markerUnits="userSpaceOnUse"><path d="M1 1 L11 6 L1 11 Z" :fill="stroke" :stroke="stroke" /></marker>
      <marker :id="`${uid}-triangle`" markerWidth="12" markerHeight="12" refX="10" refY="6" orient="auto-start-reverse" markerUnits="userSpaceOnUse"><path d="M1 1 L11 6 L1 11 Z" :fill="fill === 'transparent' ? 'var(--surface-canvas)' : fill" :stroke="stroke" :stroke-width="Math.max(1, e.style.strokeWidth * .75)" /></marker>
      <marker :id="`${uid}-solid-triangle`" markerWidth="12" markerHeight="12" refX="10" refY="6" orient="auto-start-reverse" markerUnits="userSpaceOnUse"><path d="M1 1 L11 6 L1 11 Z" :fill="stroke" :stroke="stroke" /></marker>
      <marker :id="`${uid}-reverse-triangle`" markerWidth="14" markerHeight="14" refX="11" refY="7" orient="auto-start-reverse" markerUnits="userSpaceOnUse"><path d="M11 1 L1 7 L11 13 Z" fill="var(--surface-canvas)" :stroke="stroke" :stroke-width="Math.max(1, e.style.strokeWidth * .75)" /></marker>
      <marker :id="`${uid}-circle`" markerWidth="12" markerHeight="12" refX="10" refY="6" orient="auto-start-reverse" markerUnits="userSpaceOnUse"><circle cx="6" cy="6" r="4.5" :fill="fill === 'transparent' ? 'var(--surface-canvas)' : fill" :stroke="stroke" :stroke-width="Math.max(1, e.style.strokeWidth * .75)" /></marker>
      <marker :id="`${uid}-solid-circle`" markerWidth="12" markerHeight="12" refX="10" refY="6" orient="auto-start-reverse" markerUnits="userSpaceOnUse"><circle cx="6" cy="6" r="4.5" :fill="stroke" :stroke="stroke" /></marker>
      <marker :id="`${uid}-diamond`" markerWidth="14" markerHeight="14" refX="12" refY="7" orient="auto-start-reverse" markerUnits="userSpaceOnUse"><path d="M1 7 L7 1 L13 7 L7 13 Z" :fill="fill === 'transparent' ? 'var(--surface-canvas)' : fill" :stroke="stroke" :stroke-width="Math.max(1, e.style.strokeWidth * .75)" /></marker>
      <marker :id="`${uid}-exactly-one`" markerWidth="18" markerHeight="14" refX="14" refY="7" orient="auto-start-reverse" markerUnits="userSpaceOnUse"><path d="M7 2V12M14 2V12" fill="none" :stroke="stroke" :stroke-width="Math.max(1.5, e.style.strokeWidth)" /></marker>
      <marker :id="`${uid}-many`" markerWidth="18" markerHeight="14" refX="15" refY="7" orient="auto-start-reverse" markerUnits="userSpaceOnUse"><path d="M5 7H9M9 7L15 1M9 7L15 7M9 7L15 13" fill="none" :stroke="stroke" :stroke-width="Math.max(1.5, e.style.strokeWidth)" /></marker>
      <marker :id="`${uid}-zero-or-one`" markerWidth="18" markerHeight="14" refX="13" refY="7" orient="auto-start-reverse" markerUnits="userSpaceOnUse"><circle cx="5" cy="7" r="3.5" fill="var(--surface-canvas)" :stroke="stroke" :stroke-width="Math.max(1.5, e.style.strokeWidth)" /><path d="M13 2V12" fill="none" :stroke="stroke" :stroke-width="Math.max(1.5, e.style.strokeWidth)" /></marker>
      <marker :id="`${uid}-zero-or-many`" markerWidth="20" markerHeight="14" refX="17" refY="7" orient="auto-start-reverse" markerUnits="userSpaceOnUse"><circle cx="4.5" cy="7" r="3.5" fill="var(--surface-canvas)" :stroke="stroke" :stroke-width="Math.max(1.5, e.style.strokeWidth)" /><path d="M8 7H11M11 7L17 1M11 7L17 7M11 7L17 13" fill="none" :stroke="stroke" :stroke-width="Math.max(1.5, e.style.strokeWidth)" /></marker>
      <marker :id="`${uid}-one-or-many`" markerWidth="20" markerHeight="14" refX="17" refY="7" orient="auto-start-reverse" markerUnits="userSpaceOnUse"><path d="M5 2V12M8 7H11M11 7L17 1M11 7L17 7M11 7L17 13" fill="none" :stroke="stroke" :stroke-width="Math.max(1.5, e.style.strokeWidth)" /></marker>
    </defs>
    <g :class="{ 'dash-animated': e.style.strokeDash === 'animated' }" :stroke="stroke" :fill="fill" :stroke-width="e.style.strokeWidth" :stroke-dasharray="dash" :stroke-linecap="group ? 'butt' : 'round'" :stroke-linejoin="group ? 'miter' : 'round'">
      <rect v-if="e.kind === 'frame'" data-testid="frame-surface" :width="e.width" :height="e.height" fill="transparent" :stroke="stroke" :stroke-width="e.style.strokeWidth" :stroke-dasharray="dash ?? '10 7'" />
      <rect v-else-if="shape?.id === 'square'" :width="e.width" :height="e.height" rx="3" />
      <rect v-else-if="shape?.id === 'rounded'" data-testid="rounded-surface" :width="e.width" :height="e.height" :rx="cornerRadius" :ry="cornerRadius" />
      <ellipse v-else-if="shape?.id === 'circle'" :cx="e.width / 2" :cy="e.height / 2" :rx="e.width / 2" :ry="e.height / 2" />
      <polygon v-else-if="shape?.id === 'diamond' && polygonRadius === 0" :points="`${e.width / 2},0 ${e.width},${e.height / 2} ${e.width / 2},${e.height} 0,${e.height / 2}`" />
      <path v-else-if="shape && ROUNDABLE_POLYGONS.includes(shape.id)" :data-testid="`${shape.id}-rounded-surface`" :d="roundedPolygonPath(shape.id, e.width, e.height, polygonRadius)" />
      <svg v-else-if="shape" :width="e.width" :height="e.height" viewBox="3 3 18 18" preserveAspectRatio="none" overflow="visible">
        <path v-for="(d, index) in shape.icon" :key="d" :d="d" :fill="index === 0 ? fill : 'none'" vector-effect="non-scaling-stroke" />
      </svg>
      <template v-else-if="resourceCard">
        <rect data-testid="resource-card-surface" :width="e.width" :height="e.height" rx="8" />
        <path :d="`M0 ${e.height - cardFooterHeight} H${e.width} V${e.height - 8} Q${e.width} ${e.height} ${e.width - 8} ${e.height} H8 Q0 ${e.height} 0 ${e.height - 8} Z`" fill="var(--accent-soft)" stroke="none" />
      </template>
      <rect v-else-if="cloudCard" data-testid="cloud-component-surface" :width="e.width" :height="e.height" rx="14" :fill="cloudFill" :stroke="cloudStroke" :stroke-width="Math.max(1, e.style.strokeWidth)" />
      <rect v-else-if="group" data-testid="aws-group-surface" :data-group="group.id" :width="e.width" :height="e.height" rx="0" />
      <rect v-else-if="['container', 'component'].includes(e.kind)" :width="e.width" :height="e.height" :rx="e.kind === 'component' ? 10 : 3" />
      <rect v-else-if="e.kind === 'sticky-note'" data-testid="sticky-note-surface" :width="e.width" :height="e.height" :fill="fill" stroke="none" :filter="`url(#${uid}-sticky-shadow)`" />
      <rect v-else-if="e.kind === 'annotation'" data-testid="annotation-surface" :width="e.width" :height="e.height" rx="8" :fill="fill" :stroke="stroke" :filter="`url(#${uid}-annotation-shadow)`" />
      <TableContent v-else-if="e.kind === 'table'" :element="e" :theme="theme" />
      <rect v-else-if="e.kind === 'web-embed'" data-testid="web-embed-surface" :width="e.width" :height="e.height" rx="8" :fill="fill" :stroke="stroke" />
      <polyline v-else-if="e.kind === 'path'" :points="e.points?.map(p => `${p.x},${p.y}`).join(' ')" fill="none" />
      <path v-else-if="e.kind === 'connector'" :d="connectorPath" fill="none" :marker-start="markerUrl(startMarker)" :marker-end="markerUrl(endMarker)" />
      <image v-else-if="e.kind === 'image' && asset" :href="asset?.dataUrl" :width="e.width" :height="e.height" preserveAspectRatio="none" />
    </g>
    <svg v-if="group && chrome?.icon && groupTile" data-testid="aws-group-icon" :x="chrome.icon.x" :y="chrome.icon.y" :width="chrome.icon.size" :height="chrome.icon.size" pointer-events="none"><SafeIcon :source="groupTile" :size="chrome.icon.size" /></svg>
    <svg v-else-if="resourceCard" :x="20" :y="Math.max(10, (cardBodyHeight - cardIconSize) / 2)" :width="cardIconSize" :height="cardIconSize"><SafeIcon :source="resourceIcon?.iconSvg" :size="cardIconSize" /></svg>
    <svg v-else-if="cloudCard" :x="e.width / 2 - cloudIconSize / 2" y="16" :width="cloudIconSize" :height="cloudIconSize"><SafeIcon :source="definition?.iconSvg" :size="cloudIconSize" /></svg>
    <svg v-else-if="e.kind === 'component'" :x="e.width / 2 - 16" :y="Math.max(8, e.height * .15)" width="32" height="32"><SafeIcon :source="definition?.iconSvg" /></svg>
    <g v-if="cloudCard && !editing" data-testid="cloud-component-content" pointer-events="none">
      <text data-testid="cloud-component-title" :x="e.width / 2" :y="cloudTitleY" :fill="textColor" font-size="14" :font-family="fontFamilyCss(e.style.fontFamily)" font-weight="650" text-anchor="middle">
        <tspan v-for="(line, index) in cloudTitleLines" :key="`${index}:${line}`" :x="e.width / 2" :dy="index === 0 ? 0 : CLOUD_TITLE_LINE_HEIGHT">{{ line }}</tspan>
      </text>
      <text data-testid="cloud-component-provider" :x="e.width / 2" :y="cloudProviderY" fill="var(--text-muted)" font-size="12" :font-family="fontFamilyCss(e.style.fontFamily)" font-weight="500" text-anchor="middle">{{ cloudProviderLabel }}</text>
    </g>
    <g v-if="resourceCard && !editing" data-testid="resource-card-content" pointer-events="none">
      <text :x="cardTextX" :y="cardBodyHeight / 2 - Math.max(5, e.style.fontSize * .25)" :fill="textColor" :font-size="Math.max(14, e.style.fontSize)" :font-family="fontFamilyCss(e.style.fontFamily)" font-weight="600" dominant-baseline="central">{{ cardTitle }}</text>
      <text :x="cardTextX" :y="cardBodyHeight / 2 + Math.max(16, e.style.fontSize * .85)" :fill="textColor" fill-opacity=".55" :font-size="Math.max(10, e.style.fontSize * .65)" :font-family="fontFamilyCss(e.style.fontFamily)" font-weight="500" dominant-baseline="central">{{ cardDescription }}</text>
    </g>
    <template v-if="resourceCard && !editing">
      <g
        v-for="(link, index) in cardLinks"
        :key="link.id"
        :data-testid="`resource-card-link-${index}`"
        :transform="`translate(${index * e.width / cardLinks.length} ${e.height - cardFooterHeight})`"
        :role="staticPreview ? undefined : 'link'"
        :tabindex="staticPreview ? -1 : 0"
        :pointer-events="staticPreview ? 'none' : 'all'"
        :aria-label="t('{label} öffnen', { label: link.label })"
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
    <g v-if="e.kind === 'frame'" data-testid="frame-label" pointer-events="none">
      <rect x="0" y="-32" :width="Math.max(92, frameTitle.length * 9 + 28)" height="26" rx="7" :fill="stroke" stroke="none" />
      <text x="12" y="-19" fill="#ffffff" font-size="14" :font-family="fontFamilyCss(e.style.fontFamily)" font-weight="650" dominant-baseline="central">{{ frameTitle }}</text>
    </g>
    <g v-else-if="e.kind === 'connector' && text && !editing" pointer-events="none">
      <rect :x="e.width / 2 - connectorLabelWidth / 2" :y="e.height / 2 - fontSize * .8" :width="connectorLabelWidth" :height="fontSize * 1.6" rx="4" fill="var(--surface-canvas)" />
      <text :x="e.width / 2" :y="e.height / 2" :fill="textColor" :font-size="fontSize" :font-family="fontFamilyCss(e.style.fontFamily)" text-anchor="middle" dominant-baseline="central">{{ text }}</text>
    </g>
    <foreignObject v-else-if="e.kind === 'annotation' && !editing" x="1" y="1" :width="Math.max(0, e.width - 2)" :height="Math.max(0, e.height - 2)" :clip-path="`url(#${uid}-clip)`" pointer-events="none">
      <div class="annotation-body" :style="{ color: textColor, fontSize: `${fontSize}px`, fontFamily: fontFamilyCss(e.style.fontFamily), textAlign: e.style.textAlign }"><AnnotationContent :document="annotation" /></div>
    </foreignObject>
    <foreignObject v-else-if="e.kind === 'web-embed'" x="1" y="1" :width="Math.max(0, e.width - 2)" :height="Math.max(0, e.height - 2)" :clip-path="`url(#${uid}-clip)`" :pointer-events="interactive ? 'all' : 'none'">
      <div class="web-embed" data-testid="web-embed-frame">
        <div class="web-embed-header" aria-hidden="true"><span class="web-embed-dot" />{{ embedHost }}<span>{{ t('Live-Vorschau') }}</span></div>
        <div class="web-embed-content">
          <iframe
            v-if="e.embedUrl && !staticPreview && !embedMatchesAppOrigin"
            :src="e.embedUrl"
            :title="t('Eingebettete Webseite {embedHost}', { embedHost })"
            sandbox="allow-forms allow-same-origin allow-scripts"
            referrerpolicy="no-referrer"
            loading="eager"
            :tabindex="interactive ? 0 : -1"
            @load="markEmbedLoaded"
            @error="markEmbedFailed"
          />
          <div v-if="staticPreview" class="web-embed-placeholder">{{ e.label || embedHost }}</div>
          <div v-else-if="embedMatchesAppOrigin" class="web-embed-placeholder">{{ t('Die Sketchdraw-App selbst kann hier nicht sicher eingebettet werden.') }}</div>
          <div v-else-if="embedState === 'loading'" class="web-embed-loading" role="status">{{ t('Webseite wird geladen …') }}</div>
          <div v-else-if="embedState === 'failed'" class="web-embed-placeholder">{{ t('Die Webseite konnte nicht geladen werden.') }}</div>
        </div>
        <div v-if="!staticPreview" class="web-embed-fallback">
          <span>{{ t('Keine Vorschau? Die Webseite kann das Einbetten blockieren.') }}</span>
          <button type="button" :tabindex="interactive ? 0 : -1" @pointerdown.stop @click.stop="emit('openLink', e.embedUrl!)">{{ t('Extern öffnen ↗') }}</button>
        </div>
      </div>
    </foreignObject>
    <text v-else-if="displayText && !editing && !resourceCard && !cloudCard && !['annotation', 'table', 'web-embed', 'frame', 'image'].includes(e.kind)" :clip-path="`url(#${uid}-clip)`" :fill="textColor" :fill-opacity="e.kind === 'sticky-note' && !text ? .55 : 1" :font-size="fontSize" :font-family="fontFamilyCss(e.style.fontFamily)" :font-weight="e.style.fontWeight ?? 'normal'" :text-decoration="e.style.textDecoration ?? 'none'" :text-anchor="e.style.textAlign === 'center' ? 'middle' : e.style.textAlign === 'right' ? 'end' : 'start'" dominant-baseline="text-before-edge" pointer-events="none">
      <tspan v-for="(line, i) in lines" :key="i" :x="textX" :y="textY + i * fontSize * 1.25"><template v-if="line.bullet">• </template><template v-for="(segment, j) in lineSegments(line.text, line.from, textLinks)" :key="j"><tspan v-if="segment.url" class="text-link" text-decoration="underline" pointer-events="visiblePainted" :data-text-link="segment.url">{{ segment.text }}</tspan><template v-else>{{ segment.text }}</template></template></tspan>
    </text>
    <text v-if="e.kind === 'sticky-note' && e.author" data-testid="sticky-note-author" x="20" :y="e.height - 20" :fill="textColor" fill-opacity=".82" :font-size="Math.max(12, fontSize * .72)" :font-family="fontFamilyCss(e.style.fontFamily)" dominant-baseline="auto" pointer-events="none">{{ e.author }}</text>
  </g>
</template>

<style scoped>
.text-link { cursor: pointer; }
.dash-animated { animation: sd-dash-flow 0.9s linear infinite; }
@keyframes sd-dash-flow { to { stroke-dashoffset: -14; } }
@media (prefers-reduced-motion: reduce) { .dash-animated { animation: none; } }
.annotation-body{width:100%;height:100%;box-sizing:border-box;padding:28px;overflow:hidden;background:transparent}
.web-embed{width:100%;height:100%;display:grid;grid-template-rows:34px minmax(0,1fr) auto;overflow:hidden;border-radius:7px;background:var(--surface-panel);color:var(--text-primary);font-family:var(--font-sans)}
.web-embed-header{display:flex;align-items:center;gap:8px;padding:0 12px;border-bottom:1px solid var(--border-subtle);background:var(--surface-raised);font-size:12px;font-weight:650;white-space:nowrap;overflow:hidden}.web-embed-header span:last-child{margin-left:auto;color:var(--text-muted);font-size:10px;font-weight:500}.web-embed-dot{width:8px;height:8px;border-radius:50%;background:var(--status-ok);flex:none}
.web-embed-content{position:relative;min-height:0;background:#fff}.web-embed iframe{display:block;width:100%;height:100%;border:0;background:#fff}.web-embed-loading{position:absolute;inset:0;display:grid;place-items:center;padding:12px;background:var(--surface-panel);color:var(--text-muted);font-size:13px;text-align:center;pointer-events:none}.web-embed-fallback{display:flex;align-items:center;justify-content:space-between;gap:12px;padding:7px 10px;border-top:1px solid var(--border-subtle);background:var(--surface-panel);color:var(--text-muted);font-size:10px;line-height:1.35}.web-embed-fallback button{flex:none;border:0;border-radius:7px;padding:5px 8px;background:var(--accent-soft);color:var(--accent);font:inherit;font-weight:700;cursor:pointer}.web-embed-fallback button:hover{background:var(--accent);color:var(--accent-contrast)}
.web-embed-placeholder{display:grid;place-items:center;padding:12px;color:var(--text-muted);font-size:14px;text-align:center}
</style>

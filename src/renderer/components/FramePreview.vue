<script setup lang="ts">
import { t } from '@/renderer/i18n';
import { computed } from 'vue';
import type { SketchDocument, SketchElement } from '@/domain';
import ElementView from './ElementView.vue';

const props = defineProps<{ frame: SketchElement; document: SketchDocument; theme: 'light' | 'dark'; title?: string }>();
const elements = computed(() => props.document.elements.filter((element) => element.kind !== 'frame'));
const viewBox = computed(() => `${props.frame.x} ${props.frame.y} ${Math.max(1, props.frame.width)} ${Math.max(1, props.frame.height)}`);
</script>

<template>
  <svg class="frame-preview" :viewBox="viewBox" preserveAspectRatio="xMidYMid meet" role="img" :aria-label="title || frame.label || t('Folienvorschau')">
    <rect :x="frame.x" :y="frame.y" :width="frame.width" :height="frame.height" fill="var(--surface-canvas)" />
    <ElementView v-for="element in elements" :key="element.id" :element="element" :document="document" :theme="theme" static-preview />
  </svg>
</template>

<style scoped>
.frame-preview{display:block;width:100%;height:100%;overflow:hidden;background:var(--surface-canvas);pointer-events:none}
</style>

<script setup lang="ts">
import { computed } from 'vue';
import { createDocument } from '@/domain';
import { bounds } from '@/renderer/lib/geometry';
import type { ElementClipboardPayload } from '@/renderer/state/element-clipboard';
import ElementView from './ElementView.vue';

/** A small, static drawing of a saved selection: own components (#188) and library templates (#191). */
const props = defineProps<{ payload: ElementClipboardPayload; theme: 'light' | 'dark' }>();

const preview = computed(() => {
  const document = createDocument('Vorschau');
  const pageId = document.pages[0]!.id;
  document.elements = props.payload.elements.map((element) => ({ ...element, pageId }));
  document.assets = props.payload.assets;
  document.componentSets = props.payload.componentSets;
  const box = bounds(document.elements) ?? { x: 0, y: 0, width: 1, height: 1 };
  // Room for strokes and arrowheads, which reach beyond the element rectangles.
  const pad = Math.max(6, Math.max(box.width, box.height) * 0.05);
  return { document, viewBox: `${box.x - pad} ${box.y - pad} ${Math.max(1, box.width) + 2 * pad} ${Math.max(1, box.height) + 2 * pad}` };
});
</script>

<template>
  <svg class="payload-preview" :viewBox="preview.viewBox" preserveAspectRatio="xMidYMid meet" aria-hidden="true">
    <ElementView v-for="element in preview.document.elements" :key="element.id" :element="element" :document="preview.document" :theme="theme" static-preview />
  </svg>
</template>

<style scoped>
.payload-preview{display:block;width:100%;height:100%;overflow:visible;pointer-events:none}
</style>

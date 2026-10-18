<script setup lang="ts">
import type { ConnectorMarker } from '@/domain';

defineProps<{ marker: ConnectorMarker }>();
</script>

<template>
  <svg class="connector-marker-icon" viewBox="0 0 52 28" aria-hidden="true">
    <line x1="5" y1="14" x2="46" y2="14" />
    <path v-if="marker === 'line-arrow'" d="M36 6l10 8-10 8" />
    <path v-else-if="marker === 'solid-arrow'" d="M34 5l12 9-12 9z" class="filled" />
    <path v-else-if="marker === 'triangle'" d="M33 5l13 9-13 9z" class="canvas-filled" />
    <path v-else-if="marker === 'reverse-triangle'" d="M46 5L33 14l13 9z" class="canvas-filled" />
    <circle v-else-if="marker === 'circle'" cx="41" cy="14" r="6" class="canvas-filled" />
    <path v-else-if="marker === 'diamond'" d="M33 14l7-7 7 7-7 7z" class="canvas-filled" />
    <path v-else-if="marker === 'exactly-one'" d="M36 7v14M44 7v14" />
    <path v-else-if="marker === 'many'" d="M34 14h4M38 14l8-8M38 14h8M38 14l8 8" />
    <template v-else-if="marker === 'zero-or-one'">
      <circle cx="35" cy="14" r="5" class="canvas-filled" />
      <path d="M45 7v14" />
    </template>
    <template v-else-if="marker === 'zero-or-many'">
      <circle cx="31" cy="14" r="4" class="canvas-filled" />
      <path d="M35 14h3M38 14l8-8M38 14h8M38 14l8 8" />
    </template>
    <path v-else-if="marker === 'one-or-many'" d="M32 7v14M35 14h3M38 14l8-8M38 14h8M38 14l8 8" />
  </svg>
</template>

<style scoped>
.connector-marker-icon {
  width: 52px;
  height: 28px;
  fill: none;
  stroke: currentColor;
  stroke-width: 1.8;
  stroke-linecap: round;
  stroke-linejoin: round;
}

.filled { fill: currentColor; }
.canvas-filled { fill: var(--surface-raised); }
</style>

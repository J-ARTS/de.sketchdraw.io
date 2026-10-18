<script setup lang="ts">
import { t } from '@/renderer/i18n';
import { computed, ref } from 'vue';
import ColorPicker from './ColorPicker.vue';
import { PALETTE } from '@/renderer/lib/constants';
import { normalizeHex } from '@/renderer/lib/color';

/** Palette grid with a custom-color swatch that opens the picker (#38). `value` is the base color without alpha. */
const props = defineProps<{ value: string | null; prefix: string; groupLabel: string; mixed?: boolean }>();
const emit = defineEmits<{ pick: [hex: string]; layout: [] }>();

const base = computed(() => (props.value ? normalizeHex(props.value) : null));
const custom = computed(() => (base.value && !PALETTE.some((color) => color.value === base.value) ? base.value : null));
const pickerOpen = ref(false);

function togglePicker(): void {
  pickerOpen.value = !pickerOpen.value;
  emit('layout');
}
</script>

<template>
  <div class="palette" role="group" :aria-label="groupLabel">
    <button
      v-for="color in PALETTE"
      :key="color.value"
      type="button"
      class="swatch"
      :style="{ '--swatch': color.value }"
      :aria-label="t('{prefix} {color}', { prefix, color: t(color.name) })"
      :aria-pressed="!mixed && base === color.value"
      @click="emit('pick', color.value)"
    />
    <button
      type="button"
      class="swatch custom"
      :class="{ chosen: custom }"
      :style="{ '--swatch': custom ?? 'transparent' }"
      :aria-label="t('{prefix}: eigene Farbe', { prefix })"
      :aria-pressed="!mixed && Boolean(custom)"
      :aria-expanded="pickerOpen"
      @click="togglePicker"
    />
  </div>
  <ColorPicker v-if="pickerOpen" :color="base ?? '#e5533a'" :label="t('{prefix}: eigene Farbe wählen', { prefix })" @pick="emit('pick', $event)" />
</template>

<style scoped>
.palette {
  display: grid;
  grid-template-columns: repeat(11, 28px);
  gap: 10px;
}

.swatch {
  width: 28px;
  height: 28px;
  padding: 0;
  background: var(--swatch);
  border: 1px solid color-mix(in srgb, var(--text-primary) 18%, transparent);
  border-radius: 50%;
  cursor: pointer;
}

.swatch[aria-pressed='true'] {
  box-shadow: 0 0 0 2px var(--menu-surface), 0 0 0 4px var(--menu-focus);
}

.swatch:focus-visible {
  outline: 2px solid var(--menu-focus);
  outline-offset: 3px;
}

/* Rainbow ring; a chosen custom color shows inside it. */
.custom {
  background:
    radial-gradient(circle, var(--swatch) 0 52%, transparent 54%),
    conic-gradient(#ff4d4d, #ffd43b, #51cf66, #22b8cf, #4c6ef5, #cc5de8, #ff4d4d);
  border: 0;
}

.custom:not(.chosen) {
  background: radial-gradient(circle, #ffffff 0 18%, transparent 62%), conic-gradient(#ff4d4d, #ffd43b, #51cf66, #22b8cf, #4c6ef5, #cc5de8, #ff4d4d);
}

@media (max-width: 520px) {
  .palette {
    grid-template-columns: repeat(8, 28px);
  }
}
</style>

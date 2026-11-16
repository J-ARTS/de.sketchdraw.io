<!-- @component A switch for a setting that is on or off and applies at once. The slot is its name, the optional description slot says what it does. For a choice that is only sent with a form use a checkbox. -->
<script setup lang="ts">
defineProps<{
  /** Whether the setting is on (`v-model`). */
  modelValue: boolean;
}>();
const emit = defineEmits<{
  /** The user switched the setting. */
  'update:modelValue': [value: boolean];
}>();
defineSlots<{
  /** The name of the setting. */
  default(): unknown;
  /** One sentence on what the setting does. */
  description?(): unknown;
}>();
</script>

<template>
  <button type="button" role="switch" class="app-switch" :aria-checked="modelValue" @click="emit('update:modelValue', !modelValue)">
    <span class="app-switch-text"><span class="app-switch-label"><slot /></span><span v-if="$slots.description" class="app-switch-description"><slot name="description" /></span></span>
    <span class="app-switch-track" aria-hidden="true"><span class="app-switch-thumb" /></span>
  </button>
</template>

<style scoped>
.app-switch{display:flex;align-items:center;justify-content:space-between;gap:var(--space-4);width:100%;padding:var(--space-3);border:0;border-radius:var(--radius-1);background:transparent;color:var(--text-primary);font:inherit;text-align:left;cursor:pointer}
.app-switch:hover:not(:disabled){background:var(--surface-raised)}
.app-switch:focus-visible{outline:2px solid var(--focus-ring);outline-offset:2px}
.app-switch:disabled{cursor:default;opacity:.55}
.app-switch-text{display:grid;gap:2px;min-width:0}
.app-switch-label{font-size:var(--font-size-l);font-weight:600}
.app-switch-description{color:var(--text-muted);font-size:var(--font-size-m);line-height:1.45}
.app-switch-track{flex:none;position:relative;width:40px;height:24px;border:1px solid var(--border-default);border-radius:12px;background:var(--surface-panel);transition:background var(--duration-short),border-color var(--duration-short)}
.app-switch-thumb{position:absolute;top:3px;left:3px;width:16px;height:16px;border-radius:50%;background:var(--border-default);transition:transform var(--duration-short),background var(--duration-short)}
.app-switch[aria-checked='true'] .app-switch-track{border-color:var(--accent);background:var(--accent)}
.app-switch[aria-checked='true'] .app-switch-thumb{background:var(--accent-contrast);transform:translateX(16px)}
@media(prefers-reduced-motion:reduce){.app-switch-track,.app-switch-thumb{transition:none}}
@media(forced-colors:active){.app-switch[aria-checked='true'] .app-switch-track{background:Highlight}}
</style>

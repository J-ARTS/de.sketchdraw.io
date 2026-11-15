<script setup lang="ts">
import { ref } from 'vue';
import AppIcon from '@/renderer/design-system/atoms/AppIcon.vue';
import type { IconName } from '@/renderer/design-system/atoms/icons';

/**
 * A button that shows only a symbol. Its `label` is what screen readers announce and what the tooltip shows,
 * so it is required. Attributes and listeners go to the native button.
 */
withDefaults(defineProps<{
  /** The symbol, a name from `icons.ts`. */
  icon: IconName;
  /** The accessible name and tooltip, a full phrase such as "Dialog schließen". */
  label: string;
  /** For a button that switches something on and off: its current state. Leave it out for plain actions. */
  pressed?: boolean | undefined;
  /** Edge length of the symbol in pixels. */
  iconSize?: number;
  /** The native type. */
  type?: 'button' | 'submit' | 'reset';
}>(), { pressed: undefined, iconSize: 20, type: 'button' });

const button = ref<HTMLButtonElement>();
defineExpose({
  /** Moves the keyboard focus to the button. */
  focus: (): void => button.value?.focus(),
});
</script>

<template>
  <button ref="button" :type="type" class="sd-icon-btn" :aria-label="label" :title="label" :aria-pressed="pressed"><AppIcon :name="icon" :size="iconSize" /></button>
</template>

<script setup lang="ts">
import { ref } from 'vue';
import { buttonVariants, type ButtonIntent } from '@/renderer/design-system/atoms/button.variants';

/**
 * A button with a text. Use it for every action that is named in words; for an action shown only as a symbol
 * use `AppIconButton`. Attributes and listeners (`disabled`, `aria-*`, `data-testid`, `@click`) go to the
 * native button.
 */
withDefaults(defineProps<{
  /** What the action means: `neutral` for ordinary actions, `primary` for the one main action of a view, `danger` for deleting and discarding. */
  intent?: ButtonIntent;
  /** The native type. `submit` sends the surrounding form. */
  type?: 'button' | 'submit' | 'reset';
}>(), { intent: 'neutral', type: 'button' });
defineSlots<{
  /** The text of the button, optionally with an `AppIcon` before it. */
  default(): unknown;
}>();

const button = ref<HTMLButtonElement>();
defineExpose({
  /** Moves the keyboard focus to the button. */
  focus: (): void => button.value?.focus(),
});
</script>

<template>
  <button ref="button" :type="type" :class="buttonVariants({ intent })"><slot /></button>
</template>

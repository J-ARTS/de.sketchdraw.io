<script setup lang="ts">
import { ref } from 'vue';

/**
 * A text field for several lines. It needs a visible label or an `aria-label`. Attributes and listeners go to
 * the native textarea.
 */
withDefaults(defineProps<{
  /** The text in the field (`v-model`). */
  modelValue: string;
  /** Marks the value as not accepted. */
  invalid?: boolean;
}>(), { invalid: false });
const emit = defineEmits<{
  /** The user changed the text. */
  'update:modelValue': [value: string];
}>();

const area = ref<HTMLTextAreaElement>();
defineExpose({
  /** Moves the keyboard focus to the field. */
  focus: (): void => area.value?.focus(),
});
</script>

<template>
  <textarea ref="area" class="sd-textarea" :value="modelValue" :aria-invalid="invalid || undefined" @input="emit('update:modelValue', ($event.target as HTMLTextAreaElement).value)" />
</template>

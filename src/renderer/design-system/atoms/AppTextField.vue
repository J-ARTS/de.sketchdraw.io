<!-- @component A single-line text field. It needs a visible label (`AppFieldLabel` with the same `id`) or an `aria-label`. Attributes and listeners (`placeholder`, `maxlength`, `aria-describedby`, `@keydown`) go to the native input. -->
<script setup lang="ts">
import { ref } from 'vue';

withDefaults(defineProps<{
  /** The text in the field (`v-model`). */
  modelValue: string;
  /** The native input type. */
  type?: 'text' | 'search' | 'url' | 'email' | 'password' | 'number';
  /** Marks the value as not accepted; pair it with a message referenced by `aria-describedby`. */
  invalid?: boolean;
}>(), { type: 'text', invalid: false });
const emit = defineEmits<{
  /** The user changed the text. */
  'update:modelValue': [value: string];
}>();

const input = ref<HTMLInputElement>();
defineExpose({
  /** Moves the keyboard focus to the field. */
  focus: (): void => input.value?.focus(),
  /** Selects the whole text. */
  select: (): void => input.value?.select(),
});
</script>

<template>
  <input ref="input" class="sd-input" :type="type" :value="modelValue" :aria-invalid="invalid || undefined" @input="emit('update:modelValue', ($event.target as HTMLInputElement).value)">
</template>

<!-- @component The visible label of a form field. `for` is the `id` of the field it names. -->
<script setup lang="ts">
defineProps<{
  /** The `id` of the field this label names. */
  for?: string;
}>();
defineSlots<{
  /** The text of the label. */
  default(): unknown;
}>();
</script>

<template>
  <label class="sd-field-label" :for="$props.for"><slot /></label>
</template>

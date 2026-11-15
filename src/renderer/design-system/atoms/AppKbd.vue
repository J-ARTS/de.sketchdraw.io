<script setup lang="ts">
/** A key or key combination as it is printed on the keyboard, for hints such as "Strg + Z". */
defineSlots<{
  /** The key, for example `Esc`. */
  default(): unknown;
}>();
</script>

<template>
  <kbd class="sd-kbd"><slot /></kbd>
</template>

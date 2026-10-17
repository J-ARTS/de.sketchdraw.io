<script setup lang="ts">
import { ref, watch } from 'vue';
import { useWhiteboard } from './use-whiteboard';
import { t } from '@/renderer/i18n/de';

const store = useWhiteboard();
const input = ref<HTMLInputElement | null>(null);

function open(): void {
  input.value?.click();
}

async function onChange(): Promise<void> {
  const el = input.value;
  const file = el?.files?.[0];
  if (!el || !file) return;
  try {
    await store.insertImageFile(file);
  } finally {
    // Reset so choosing the same file twice still fires a change event.
    el.value = '';
  }
}

// The B shortcut sets the image tool in the store; this component turns it into the file dialog.
watch(
  () => store.state.tool,
  (tool) => {
    if (tool !== 'image') return;
    store.setTool('select');
    open();
  },
);

defineExpose({ open });
</script>

<template>
  <input
    ref="input"
    class="image-file-input"
    type="file"
    accept="image/png,image/jpeg,image/webp"
    hidden
    tabindex="-1"
    :aria-label="t('image.input')"
    @change="onChange"
  />
</template>

<script setup lang="ts">
import { nextTick, onBeforeUnmount, ref, watch } from 'vue';
import { parseWebEmbedUrl } from '@/domain';
import { useWhiteboard } from './use-whiteboard';

const store = useWhiteboard();
const dialog = ref<HTMLDialogElement>();
const input = ref<HTMLInputElement>();
const url = ref('https://');
const error = ref('');
const busy = ref(false);

async function open(): Promise<void> {
  url.value = 'https://';
  error.value = '';
  dialog.value?.showModal();
  await nextTick();
  input.value?.focus();
  input.value?.setSelectionRange(url.value.length, url.value.length);
}

function close(): void {
  if (!busy.value) {
    dialog.value?.close();
    if (store.state.tool === 'web-embed') store.setTool('select');
  }
}

async function submit(): Promise<void> {
  const parsed = parseWebEmbedUrl(url.value);
  if (!parsed.ok) {
    error.value = parsed.message;
    input.value?.focus();
    return;
  }
  busy.value = true;
  error.value = '';
  try {
    if (await store.addWebEmbed(parsed.url)) dialog.value?.close();
    else error.value = 'Das Web-Embed konnte nicht hinzugefügt werden.';
  } finally {
    busy.value = false;
  }
}

onBeforeUnmount(() => dialog.value?.close());
watch(() => store.state.tool, (tool) => {
  if (tool === 'web-embed') void open();
  else if (dialog.value?.open && !busy.value) dialog.value.close();
});
</script>

<template>
  <dialog ref="dialog" class="web-embed-dialog sd-panel" aria-labelledby="web-embed-title" @cancel.prevent="close">
    <form method="dialog" @submit.prevent="submit">
      <div class="heading">
        <h2 id="web-embed-title">Webseite einbetten</h2>
        <button type="button" class="sd-icon-btn" aria-label="Dialog schließen" :disabled="busy" @click="close">×</button>
      </div>
      <p>Füge eine vollständige Webadresse ein. Manche Seiten verhindern die Anzeige in eingebetteten Frames.</p>
      <label for="web-embed-url">Webadresse</label>
      <input id="web-embed-url" ref="input" v-model="url" data-testid="web-embed-url" type="url" inputmode="url" autocomplete="url" spellcheck="false" placeholder="https://example.com" :disabled="busy" :aria-invalid="Boolean(error)" :aria-describedby="error ? 'web-embed-error' : 'web-embed-help'" />
      <span id="web-embed-help" class="hint">Erlaubt sind HTTP und HTTPS ohne eingebettete Zugangsdaten.</span>
      <p v-if="error" id="web-embed-error" class="error" role="alert">{{ error }}</p>
      <div class="actions">
        <button type="button" class="sd-btn" :disabled="busy" @click="close">Abbrechen</button>
        <button type="submit" class="sd-btn sd-btn--primary" :disabled="busy">{{ busy ? 'Wird hinzugefügt …' : 'Einbetten' }}</button>
      </div>
    </form>
  </dialog>
</template>

<style scoped>
.web-embed-dialog{width:min(520px,calc(100vw - 32px));padding:24px;color:var(--text-primary)}
.web-embed-dialog::backdrop{background:var(--scrim)}
.heading{display:flex;align-items:center;justify-content:space-between;gap:16px}.heading h2{font-size:20px;letter-spacing:-.02em}
p{margin:12px 0 20px;color:var(--text-muted);font-size:13px;line-height:1.6}
label{display:block;margin-bottom:7px;font-size:12px;font-weight:650}
input{width:100%;height:42px;padding:0 12px;border:1px solid var(--border-default);border-radius:9px;background:var(--surface-panel);color:var(--text-primary);font:inherit}
input:focus{outline:2px solid var(--accent);outline-offset:1px}input[aria-invalid='true']{border-color:var(--status-error)}
.hint{display:block;margin-top:7px;color:var(--text-muted);font-size:11px}.error{margin:10px 0 0;color:var(--status-error)}
.actions{display:flex;justify-content:flex-end;gap:8px;margin-top:24px}
</style>

<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, ref, watch } from 'vue';
import { useWhiteboard } from './use-whiteboard';
import { SHORTCUTS, formatCombo } from '../lib/shortcuts';
import { isMacPlatform } from './platform';
const store = useWhiteboard(); const dialog = ref<HTMLDialogElement>(); let previous: HTMLElement | null = null;
const isMac = isMacPlatform();
const busy = computed(() => store.state.dialog?.kind === 'unsaved' && store.state.dialog.busy);
watch(() => Boolean(store.state.dialog), async (open) => {
  await nextTick();
  if (open) { previous = document.activeElement as HTMLElement; dialog.value?.showModal(); }
  else { dialog.value?.close(); if (previous?.isConnected) previous.focus(); }
}, { immediate: true });
onBeforeUnmount(() => dialog.value?.close());
</script>

<template>
  <dialog ref="dialog" class="app-dialog sd-panel" aria-labelledby="dialog-title" @cancel.prevent="!busy && store.closeDialog()">
    <template v-if="store.state.dialog?.kind === 'help'">
      <div class="dialog-heading"><h2 id="dialog-title">Schneller mit der Tastatur</h2><button class="sd-icon-btn" aria-label="Hilfe schließen" @click="store.closeDialog()">×</button></div>
      <p class="intro">Kürzel für die Zeichenfläche. In Textfeldern bleiben die gewohnten Textbefehle erhalten.</p>
      <dl class="shortcuts"><template v-for="item in SHORTCUTS" :key="item.id"><dt>{{ item.label }}</dt><dd><kbd class="sd-kbd">{{ formatCombo(item.combo, isMac) }}</kbd></dd></template></dl>
      <div class="buttons"><button class="sd-btn sd-btn--primary" @click="store.closeDialog()">Verstanden</button></div>
    </template>
    <template v-else-if="store.state.dialog?.kind === 'unsaved'">
      <h2 id="dialog-title">Änderungen behalten?</h2><p class="intro">Dein Dokument enthält ungespeicherte Änderungen oder offene Entwürfe. Beim Speichern werden gültige Entwürfe übernommen.</p>
      <p v-if="store.state.pendingPeerWrite || store.state.collaboration?.hasUnresolvedOutcome" class="error">Eine Peer-Änderung hat noch keinen bestätigten Ausgang. Speichern ist bis zur Klärung gesperrt. Verwerfen beendet die Sitzung; eine lokale Kopie enthält ausschließlich den zuletzt bestätigten Stand, ohne diesen Entwurf.</p>
      <p v-else-if="store.state.dialog.reason === 'leave'" class="intro">Beim Verlassen wird eine neue lokale Kopie des bestätigten Stands angelegt. Offene Entwürfe gehören erst nach bestätigter Übernahme dazu.</p>
      <p v-if="store.state.bridgePlatform === 'browser'" class="intro">Im Browser wird die Datei als Download übergeben. Prüfe den Download, bevor du das Fenster schließt.</p>
      <p v-if="store.state.dialog.error" role="alert" class="error">{{ store.state.dialog.error }}</p>
      <div class="buttons"><button class="sd-btn" :disabled="busy" autofocus @click="store.resolveDialog('cancel')">Abbrechen</button><button class="sd-btn sd-btn--danger" :disabled="busy" @click="store.resolveDialog('discard')">Verwerfen</button><button class="sd-btn sd-btn--primary" :disabled="busy" @click="store.resolveDialog('save')">{{ busy ? 'Wird geprüft …' : 'Speichern' }}</button></div>
    </template>
    <template v-else-if="store.state.dialog?.kind === 'save-conflict'">
      <h2 id="dialog-title">Datei wurde geändert</h2><p class="intro">{{ store.state.dialog.message }}</p><div class="buttons"><button class="sd-btn" @click="store.resolveDialog('cancel')">Abbrechen</button><button class="sd-btn sd-btn--primary" @click="store.resolveDialog('save-copy')">Als Kopie speichern</button></div>
    </template>
  </dialog>
</template>

<style scoped>
.app-dialog{width:min(540px,calc(100vw - 32px));max-height:calc(100vh - 48px);padding:24px;overflow:auto;color:var(--text-primary)}.app-dialog::backdrop{background:var(--scrim)}h2{font-size:20px;letter-spacing:-.02em}.dialog-heading{display:flex;align-items:center;justify-content:space-between}.intro{color:var(--text-muted);font-size:13px;line-height:1.7;margin:12px 0 20px}.buttons{display:flex;justify-content:flex-end;gap:8px;margin-top:24px;flex-wrap:wrap}.shortcuts{display:grid;grid-template-columns:1fr auto;align-items:center;gap:12px;font-size:12px;max-height:48vh;overflow:auto;padding:4px}.shortcuts dd{text-align:right}.error{color:var(--status-error);line-height:1.6;font-size:13px}
</style>

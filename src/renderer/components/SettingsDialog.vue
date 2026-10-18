<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, ref, watch } from 'vue';
import { CANVAS_BACKGROUNDS, resolveCanvasBackground, THEME_CANVAS } from '@/renderer/lib/preferences';
import { wrapTabFocus } from '@/renderer/lib/focus';
import AppIcon from './AppIcon.vue';
import ColorPicker from './ColorPicker.vue';
import { useWhiteboard } from './use-whiteboard';

/** Modal settings: canvas background and design. Language lives in the user menu. */
const props = defineProps<{ open: boolean }>();
const emit = defineEmits<{ close: [] }>();
const store = useWhiteboard();
const s = store.state;
const dialog = ref<HTMLDialogElement | null>(null);
const closeButton = ref<HTMLButtonElement | null>(null);
const pickerOpen = ref(false);
let opener: HTMLElement | null = null;

const presets = computed(() => CANVAS_BACKGROUNDS.map((entry) => ({
  id: entry.id,
  label: entry.label,
  color: resolveCanvasBackground(entry.id, s.theme) ?? THEME_CANVAS[s.theme],
})));
const selectedId = computed(() => s.canvasBackground ?? 'default');
const customActive = computed(() => !CANVAS_BACKGROUNDS.some((entry) => entry.id === selectedId.value));
const customColor = computed(() => (customActive.value ? selectedId.value : resolveCanvasBackground(s.canvasBackground, s.theme) ?? THEME_CANVAS[s.theme]));

watch(() => props.open, async (open) => {
  await nextTick();
  if (open) {
    opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    pickerOpen.value = false;
    if (!dialog.value?.open) dialog.value?.showModal();
    closeButton.value?.focus();
  } else {
    dialog.value?.close();
    if (opener?.isConnected) opener.focus();
    opener = null;
  }
}, { immediate: true });
onBeforeUnmount(() => dialog.value?.close());

function onRadioKeydown(event: KeyboardEvent): void {
  if (!['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(event.key)) return;
  const group = (event.currentTarget as HTMLElement);
  const items = Array.from(group.querySelectorAll<HTMLElement>('[role="radio"]'));
  const index = items.findIndex((item) => item === document.activeElement);
  if (index < 0) return;
  event.preventDefault();
  const next = items[(index + (event.key === 'ArrowRight' || event.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length]!;
  next.focus(); next.click();
}
</script>

<template>
  <dialog ref="dialog" class="settings-dialog" data-testid="settings-dialog" aria-labelledby="settings-title" @cancel.prevent="emit('close')" @pointerdown.self="emit('close')" @keydown.stop="dialog && wrapTabFocus($event, dialog)">
    <div class="settings-panel sd-panel">
      <header><h2 id="settings-title" class="sd-panel-title">Einstellungen</h2><button ref="closeButton" type="button" class="sd-icon-btn sd-panel-close" aria-label="Einstellungen schließen" @click="emit('close')"><AppIcon name="close" /></button></header>

      <section class="setting" aria-labelledby="canvas-bg-title">
        <h3 id="canvas-bg-title">Canvas-Hintergrund</h3>
        <div class="swatches" role="radiogroup" aria-labelledby="canvas-bg-title" @keydown="onRadioKeydown">
          <button
            v-for="preset in presets"
            :key="preset.id"
            type="button"
            class="swatch"
            role="radio"
            :aria-checked="selectedId === preset.id"
            :aria-label="preset.label"
            :title="preset.label"
            :tabindex="selectedId === preset.id || (customActive && preset.id === 'default') ? 0 : -1"
            :style="{ background: preset.color }"
            @click="store.setCanvasBackground(preset.id); pickerOpen = false"
          ><AppIcon v-if="selectedId === preset.id" name="check" :size="16" /></button>
          <span class="swatch-sep" aria-hidden="true" />
          <button
            type="button"
            class="swatch custom"
            role="radio"
            :aria-checked="customActive"
            aria-label="Eigene Farbe"
            title="Eigene Farbe"
            tabindex="-1"
            :style="customActive ? { background: customColor } : undefined"
            @click="pickerOpen = !pickerOpen"
          ><AppIcon v-if="customActive" name="check" :size="16" /></button>
        </div>
        <ColorPicker v-if="pickerOpen" class="custom-picker" :color="customColor" label="Eigene Hintergrundfarbe wählen" @pick="store.setCanvasBackground($event)" />
        <p class="hint">Der Hintergrund gilt für dich und wird nicht im Dokument gespeichert. Die Voreinstellungen passen sich dem Design an.</p>
      </section>

      <section class="setting" aria-labelledby="theme-title">
        <h3 id="theme-title">Design</h3>
        <div class="segmented" role="radiogroup" aria-labelledby="theme-title" @keydown="onRadioKeydown">
          <button type="button" role="radio" :aria-checked="s.theme === 'light'" :tabindex="s.theme === 'light' ? 0 : -1" @click="store.setTheme('light')"><AppIcon name="sun" :size="18" /> Hell</button>
          <button type="button" role="radio" :aria-checked="s.theme === 'dark'" :tabindex="s.theme === 'dark' ? 0 : -1" @click="store.setTheme('dark')"><AppIcon name="moon" :size="18" /> Dunkel</button>
        </div>
      </section>

      <footer><button type="button" class="sd-btn sd-btn--primary" @click="emit('close')">Fertig</button></footer>
    </div>
  </dialog>
</template>

<style scoped>
.settings-dialog{width:min(460px,calc(100vw - 32px));max-height:calc(100dvh - 32px);padding:0;border:0;background:transparent;color:var(--text-primary);overflow:visible}
.settings-dialog::backdrop{background:var(--scrim)}
.settings-panel{display:flex;flex-direction:column;max-height:calc(100dvh - 32px);overflow:auto;padding:20px}
header{display:flex;align-items:center;justify-content:space-between;margin-bottom:12px}
h3{margin:0 0 10px;font-size:14px;font-weight:650}
.setting{padding:14px 0;border-top:1px solid var(--border-subtle)}
.swatches{display:flex;flex-wrap:wrap;align-items:center;gap:8px}
.swatch{display:grid;place-items:center;width:40px;height:40px;padding:0;border:1px solid var(--border-subtle);border-radius:10px;color:var(--text-primary);cursor:pointer}
.swatch:hover{border-color:var(--border-default)}
.swatch[aria-checked='true']{border-color:var(--accent);box-shadow:0 0 0 2px var(--accent)}
.swatch:focus-visible{outline:2px solid var(--focus-ring);outline-offset:3px}
.swatch.custom{background:conic-gradient(#ff4d4d,#ffd43b,#51cf66,#22b8cf,#4c6ef5,#cc5de8,#ff4d4d)}
.swatch.custom:not([aria-checked='true']){background:radial-gradient(circle,var(--surface-panel) 0 38%,transparent 40%),conic-gradient(#ff4d4d,#ffd43b,#51cf66,#22b8cf,#4c6ef5,#cc5de8,#ff4d4d)}
.swatch-sep{width:1px;height:28px;margin:0 4px;background:var(--border-subtle)}
.custom-picker{margin-top:12px}
.hint{margin:10px 0 0;color:var(--text-muted);font-size:12px;line-height:1.5}
.segmented{display:inline-flex;padding:3px;gap:3px;border:1px solid var(--border-subtle);border-radius:12px;background:var(--surface-raised)}
.segmented button{display:inline-flex;align-items:center;gap:8px;min-height:36px;padding:0 14px;border:0;border-radius:9px;background:transparent;color:var(--text-primary);font:inherit;cursor:pointer}
.segmented button[aria-checked='true']{background:var(--surface-panel);box-shadow:0 0 0 1px var(--accent);color:var(--accent-ink)}
.segmented button:focus-visible{outline:2px solid var(--focus-ring);outline-offset:2px}
footer{display:flex;justify-content:flex-end;padding-top:12px;border-top:1px solid var(--border-subtle)}
@media(forced-colors:active){.swatch[aria-checked='true'],.segmented button[aria-checked='true']{outline:2px solid Highlight}}
</style>

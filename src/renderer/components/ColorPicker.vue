<script setup lang="ts">
import { t } from '@/renderer/i18n';
import { computed, ref, watch } from 'vue';
import AppIcon from './AppIcon.vue';
import { hexToHsv, hsvToHex, normalizeHex, type Hsv } from '@/renderer/lib/color';

/** Custom color picker (#38): eyedropper, hex, hue and saturation/value. Emits only committed colors. */
const props = defineProps<{ color: string; label: string }>();
const emit = defineEmits<{ pick: [hex: string] }>();

const hsv = ref<Hsv>(hexToHsv(props.color) ?? { h: 0, s: 0, v: 0 });
const hexDraft = ref(normalizeHex(props.color) ?? '#000000');
let dragging = false;
watch(() => props.color, (color) => {
  if (dragging) return;
  const next = hexToHsv(color);
  if (next) { hsv.value = { ...next, h: next.s ? next.h : hsv.value.h }; hexDraft.value = normalizeHex(color)!; }
});

const current = computed(() => hsvToHex(hsv.value));
const hueColor = computed(() => hsvToHex({ h: hsv.value.h, s: 1, v: 1 }));
const eyedropper = typeof window !== 'undefined' && 'EyeDropper' in window;

function update(next: Partial<Hsv>): void {
  hsv.value = { ...hsv.value, ...next };
  hexDraft.value = current.value;
}

function commit(): void { emit('pick', current.value); }

function commitHex(): void {
  const hex = normalizeHex(hexDraft.value);
  if (!hex) { hexDraft.value = current.value; return; }
  const next = hexToHsv(hex)!;
  hsv.value = { ...next, h: next.s ? next.h : hsv.value.h };
  hexDraft.value = hex;
  emit('pick', hex);
}

// --- Saturation/value area -------------------------------------------------------
const area = ref<HTMLElement | null>(null);
function fromPointer(event: PointerEvent): void {
  const box = area.value?.getBoundingClientRect();
  if (!box) return;
  update({ s: Math.min(1, Math.max(0, (event.clientX - box.left) / box.width)), v: 1 - Math.min(1, Math.max(0, (event.clientY - box.top) / box.height)) });
}
function onAreaDown(event: PointerEvent): void {
  dragging = true;
  area.value?.setPointerCapture(event.pointerId);
  fromPointer(event);
}
function onAreaMove(event: PointerEvent): void { if (dragging) fromPointer(event); }
function onAreaUp(event: PointerEvent): void {
  if (!dragging) return;
  dragging = false;
  if (area.value?.hasPointerCapture(event.pointerId)) area.value.releasePointerCapture(event.pointerId);
  commit();
}
function onAreaKey(event: KeyboardEvent): void {
  const step = event.shiftKey ? 0.1 : 0.02;
  const moves: Record<string, Partial<Hsv>> = {
    ArrowLeft: { s: Math.max(0, hsv.value.s - step) },
    ArrowRight: { s: Math.min(1, hsv.value.s + step) },
    ArrowUp: { v: Math.min(1, hsv.value.v + step) },
    ArrowDown: { v: Math.max(0, hsv.value.v - step) },
  };
  const move = moves[event.key];
  if (!move) return;
  event.preventDefault();
  event.stopPropagation();
  update(move);
  commit();
}

async function pickFromScreen(): Promise<void> {
  try {
    const result = await new (window as unknown as { EyeDropper: new () => { open(): Promise<{ sRGBHex: string }> } }).EyeDropper().open();
    const hex = normalizeHex(result.sRGBHex);
    if (hex) { hexDraft.value = hex; commitHex(); }
  } catch { /* cancelled */ }
}
</script>

<template>
  <div class="picker" role="group" :aria-label="label">
    <div class="picker-head">
      <button v-if="eyedropper" type="button" class="eyedropper" :aria-label="t('Farbe vom Bildschirm aufnehmen')" :title="t('Farbe vom Bildschirm aufnehmen')" @click="pickFromScreen">
        <AppIcon name="eyedropper" :size="18" />
      </button>
      <span class="preview" :style="{ background: current }" aria-hidden="true" />
      <input
        v-model="hexDraft"
        class="hex"
        type="text"
        spellcheck="false"
        autocomplete="off"
        maxlength="9"
        :aria-label="t('Hex-Farbwert')"
        @change="commitHex"
        @keydown.enter.prevent="commitHex"
      />
    </div>
    <input
      class="hue"
      type="range"
      min="0"
      max="359"
      step="1"
      :aria-label="t('Farbton')"
      :value="Math.round(hsv.h)"
      :style="{ '--thumb': hueColor }"
      @input="update({ h: ($event.target as HTMLInputElement).valueAsNumber })"
      @change="commit"
    />
    <div
      ref="area"
      class="area"
      role="slider"
      tabindex="0"
      :aria-label="t('Sättigung und Helligkeit')"
      aria-valuemin="0"
      aria-valuemax="100"
      :aria-valuenow="Math.round(hsv.s * 100)"
      :aria-valuetext="t('Sättigung {s} %, Helligkeit {v} %', { s: Math.round(hsv.s * 100), v: Math.round(hsv.v * 100) })"
      :style="{ '--hue': hueColor }"
      @pointerdown="onAreaDown"
      @pointermove="onAreaMove"
      @pointerup="onAreaUp"
      @pointercancel="onAreaUp"
      @keydown="onAreaKey"
    >
      <span class="area-thumb" :style="{ left: `${hsv.s * 100}%`, top: `${(1 - hsv.v) * 100}%`, background: current }" aria-hidden="true" />
    </div>
  </div>
</template>

<style scoped>
.picker {
  display: grid;
  gap: 12px;
  padding-top: 12px;
  border-top: 1px solid var(--menu-separator);
}

.picker-head {
  display: flex;
  align-items: center;
  gap: 10px;
}

.eyedropper {
  display: grid;
  place-items: center;
  width: 36px;
  height: 36px;
  padding: 0;
  background: transparent;
  border: 0;
  border-radius: 8px;
  color: var(--menu-text);
  cursor: pointer;
}

.eyedropper:hover {
  background: var(--menu-hover);
}

.preview {
  flex: none;
  width: 24px;
  height: 24px;
  border-radius: 50%;
  box-shadow: 0 0 0 1px color-mix(in srgb, var(--text-primary) 25%, transparent);
}

.hex {
  flex: 1;
  min-width: 0;
  height: 36px;
  padding: 0 10px;
  background: var(--menu-field);
  border: 1px solid var(--menu-field-border);
  border-radius: 8px;
  color: var(--menu-text);
  font-family: var(--font-mono);
  font-size: 13px;
  text-transform: uppercase;
}

.hue {
  width: 100%;
  height: 16px;
  margin: 0;
  background: linear-gradient(90deg, #f00 0%, #ff0 17%, #0f0 33%, #0ff 50%, #00f 67%, #f0f 83%, #f00 100%);
  border-radius: 999px;
  appearance: none;
  cursor: pointer;
}

.hue::-webkit-slider-thumb {
  width: 20px;
  height: 20px;
  background: var(--thumb);
  border: 3px solid #ffffff;
  border-radius: 50%;
  box-shadow: 0 1px 3px rgb(0 0 0 / 35%);
  appearance: none;
}

.hue::-moz-range-thumb {
  width: 16px;
  height: 16px;
  background: var(--thumb);
  border: 3px solid #ffffff;
  border-radius: 50%;
}

.area {
  position: relative;
  height: 160px;
  background: linear-gradient(to top, #000000, transparent), linear-gradient(to right, #ffffff, var(--hue));
  border-radius: 10px;
  cursor: crosshair;
  touch-action: none;
}

.area-thumb {
  position: absolute;
  width: 18px;
  height: 18px;
  border: 3px solid #ffffff;
  border-radius: 50%;
  box-shadow: 0 1px 3px rgb(0 0 0 / 40%);
  pointer-events: none;
  transform: translate(-50%, -50%);
}

.eyedropper:focus-visible,
.hex:focus-visible,
.hue:focus-visible,
.area:focus-visible {
  outline: 2px solid var(--menu-focus);
  outline-offset: 2px;
}
</style>

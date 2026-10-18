<script setup lang="ts">
import { computed, ref } from 'vue';
import { PALETTE } from '@/renderer/lib/constants';
import {
  ERASER_RADIUS_MAX, ERASER_RADIUS_MIN, PENCIL_OPACITY_MAX, PENCIL_OPACITY_MIN,
  PENCIL_OPTIONS, PENCIL_SIZE_MAX, PENCIL_SIZE_MIN,
} from '@/renderer/lib/drawing-tools';
import { useWhiteboard } from './use-whiteboard';

const store = useWhiteboard();
const s = store.state;
const root = ref<HTMLElement | null>(null);
const customInput = ref<HTMLInputElement | null>(null);
const focusedOption = ref<string | null>(null);
const colors = PALETTE.slice(0, 11);

const pencilVisible = computed(() => s.tool === 'path');
const optionIds = computed(() => pencilVisible.value
  ? [...PENCIL_OPTIONS.map((option) => `pencil-${option.value}`), ...colors.map((color) => `color-${color.value}`), 'color-custom']
  : []);
const activeOption = computed(() => pencilVisible.value ? `pencil-${s.pencilPreset}` : null);
const tabStop = computed(() => focusedOption.value && optionIds.value.includes(focusedOption.value) ? focusedOption.value : activeOption.value);
const customColorSelected = computed(() => !colors.some((color) => color.value === s.pencilColor));

function onFocusIn(event: FocusEvent): void {
  const target = event.target;
  if (target instanceof HTMLElement && target.dataset.optionId) focusedOption.value = target.dataset.optionId;
}
function onFocusOut(event: FocusEvent): void {
  if (!(event.relatedTarget instanceof Node) || !root.value?.contains(event.relatedTarget)) focusedOption.value = null;
}
function onKeydown(event: KeyboardEvent): void {
  if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
  const buttons = Array.from(root.value?.querySelectorAll<HTMLButtonElement>('[data-option-id]:not(:disabled)') ?? []);
  if (!buttons.length) return;
  const current = Math.max(0, buttons.findIndex((button) => button === document.activeElement));
  const next = event.key === 'Home' ? 0 : event.key === 'End' ? buttons.length - 1
    : (current + (event.key === 'ArrowRight' ? 1 : -1) + buttons.length) % buttons.length;
  event.preventDefault();
  event.stopPropagation();
  buttons[next]?.focus();
}
function pickCustomColor(event: Event): void {
  store.setPencilColor((event.target as HTMLInputElement).value);
}
function setPencilSize(event: Event): void {
  store.setPencilSize(Number((event.target as HTMLInputElement).value));
}
function setPencilOpacity(event: Event): void {
  store.setPencilOpacity(Number((event.target as HTMLInputElement).value));
}
function setEraserRadius(event: Event): void {
  store.setEraserRadius(Number((event.target as HTMLInputElement).value));
}
function sliderKeyValue(event: KeyboardEvent, value: number, minimum: number, maximum: number): number | null {
  if (event.key === 'ArrowRight' || event.key === 'ArrowUp') return value + 1;
  if (event.key === 'ArrowLeft' || event.key === 'ArrowDown') return value - 1;
  if (event.key === 'PageUp') return value + 10;
  if (event.key === 'PageDown') return value - 10;
  if (event.key === 'Home') return minimum;
  if (event.key === 'End') return maximum;
  return null;
}
function onPencilSizeKeydown(event: KeyboardEvent): void {
  const size = sliderKeyValue(event, s.pencilSize, PENCIL_SIZE_MIN, PENCIL_SIZE_MAX);
  if (size === null) return;
  event.preventDefault();
  event.stopPropagation();
  store.setPencilSize(size);
}
function onPencilOpacityKeydown(event: KeyboardEvent): void {
  const opacity = sliderKeyValue(event, s.pencilOpacity, PENCIL_OPACITY_MIN, PENCIL_OPACITY_MAX);
  if (opacity === null) return;
  event.preventDefault();
  event.stopPropagation();
  store.setPencilOpacity(opacity);
}
function onEraserRadiusKeydown(event: KeyboardEvent): void {
  const radius = sliderKeyValue(event, s.eraserRadius, ERASER_RADIUS_MIN, ERASER_RADIUS_MAX);
  if (radius === null) return;
  event.preventDefault();
  event.stopPropagation();
  store.setEraserRadius(radius);
}
</script>

<template>
  <div
    ref="root"
    class="tool-options sd-panel"
    role="toolbar"
    aria-orientation="horizontal"
    :aria-label="pencilVisible ? 'Stiftoptionen' : 'Radiereroptionen'"
    :class="pencilVisible ? 'pencil-layout' : 'eraser-layout'"
    :data-testid="pencilVisible ? 'pencil-options' : 'eraser-options'"
    @pointerdown.stop
    @pointermove.stop
    @pointerup.stop
    @pointercancel.stop
    @keydown="onKeydown"
    @focusin="onFocusIn"
    @focusout="onFocusOut"
  >
    <template v-if="pencilVisible">
      <div class="options-row choice-row" data-testid="pencil-choice-row">
        <div class="option-group" role="group" aria-label="Stifttyp und Strichstärke">
          <button
            v-for="option in PENCIL_OPTIONS"
            :key="option.value"
            type="button"
            class="stroke-option"
            :data-option-id="`pencil-${option.value}`"
            :tabindex="tabStop === `pencil-${option.value}` ? 0 : -1"
            :aria-label="`${option.label}, ${option.strokeWidth} Pixel`"
            :aria-pressed="s.pencilPreset === option.value"
            :title="option.label"
            :disabled="!s.canWrite || s.transitioning"
            @click="store.setPencilPreset(option.value)"
          >
            <svg viewBox="0 0 42 24" aria-hidden="true" :style="{ color: s.pencilColor, opacity: option.opacity }">
              <path d="M3 15 C8 4 12 5 15 14 S23 22 28 11 S35 5 39 9" fill="none" stroke="currentColor" :stroke-width="option.strokeWidth" stroke-linecap="round" stroke-linejoin="round" />
            </svg>
          </button>
        </div>
        <span class="separator" aria-hidden="true" />
        <div class="option-group color-group" role="group" aria-label="Stiftfarbe">
          <button
            v-for="color in colors"
            :key="color.value"
            type="button"
            class="color-option"
            :style="{ '--option-color': color.value }"
            :data-option-id="`color-${color.value}`"
            :tabindex="tabStop === `color-${color.value}` ? 0 : -1"
            :aria-label="`Stiftfarbe ${color.name}`"
            :aria-pressed="s.pencilColor === color.value"
            :title="color.name"
            :disabled="!s.canWrite || s.transitioning"
            @click="store.setPencilColor(color.value)"
          />
          <button
            type="button"
            class="color-option custom-color"
            :class="{ selected: customColorSelected }"
            data-option-id="color-custom"
            :tabindex="tabStop === 'color-custom' ? 0 : -1"
            aria-label="Eigene Stiftfarbe wählen"
            :aria-pressed="customColorSelected"
            title="Eigene Farbe"
            :disabled="!s.canWrite || s.transitioning"
            @click="customInput?.click()"
          />
          <input ref="customInput" class="native-color" type="color" :value="s.pencilColor" tabindex="-1" aria-hidden="true" @input="pickCustomColor" />
        </div>
      </div>
      <div class="options-row controls-row" data-testid="pencil-controls-row">
        <div class="option-group size-group" role="group" aria-label="Pinselgröße">
          <label class="size-control" for="pencil-size">
            <span>Größe</span>
            <input
              id="pencil-size"
              data-testid="pencil-size-slider"
              type="range"
              :min="PENCIL_SIZE_MIN"
              :max="PENCIL_SIZE_MAX"
              step="1"
              :value="s.pencilSize"
              aria-label="Pinselgröße"
              :aria-valuetext="`${s.pencilSize} Pixel Strichbreite`"
              title="Pinselgröße von 1 bis 500 Pixel"
              :disabled="!s.canWrite || s.transitioning"
              @input="setPencilSize"
              @keydown="onPencilSizeKeydown"
            />
            <output for="pencil-size" aria-live="polite">{{ s.pencilSize }} px</output>
          </label>
        </div>
        <span class="separator" aria-hidden="true" />
        <div class="option-group size-group" role="group" aria-label="Stift-Deckkraft">
          <label class="size-control opacity-control" for="pencil-opacity">
            <span>Deckkraft</span>
            <input
              id="pencil-opacity"
              data-testid="pencil-opacity-slider"
              type="range"
              :min="PENCIL_OPACITY_MIN"
              :max="PENCIL_OPACITY_MAX"
              step="1"
              :value="s.pencilOpacity"
              aria-label="Stift-Deckkraft"
              :aria-valuetext="`${s.pencilOpacity} Prozent Deckkraft`"
              title="Stift-Deckkraft von 0 bis 100 Prozent"
              :disabled="!s.canWrite || s.transitioning"
              @input="setPencilOpacity"
              @keydown="onPencilOpacityKeydown"
            />
            <output for="pencil-opacity" aria-live="polite">{{ s.pencilOpacity }} %</output>
          </label>
        </div>
      </div>
    </template>

    <div v-else class="option-group size-group" role="group" aria-label="Radierergröße">
      <label class="size-control" for="eraser-radius">
        <span>Radius</span>
        <input
          id="eraser-radius"
          data-testid="eraser-radius-slider"
          type="range"
          :min="ERASER_RADIUS_MIN"
          :max="ERASER_RADIUS_MAX"
          step="1"
          :value="s.eraserRadius"
          aria-label="Radierer-Radius"
          :aria-valuetext="`${s.eraserRadius} Pixel Radius`"
          title="Radierer-Radius von 1 bis 500 Pixel"
          :disabled="!s.canWrite || s.transitioning"
          @input="setEraserRadius"
          @keydown="onEraserRadiusKeydown"
        />
        <output for="eraser-radius" aria-live="polite">{{ s.eraserRadius }} px</output>
      </label>
    </div>
  </div>
</template>

<style scoped>
.tool-options{width:min(760px,calc(100vw - 24px));max-width:100%;min-height:52px;padding:5px 7px;overflow:hidden}
.pencil-layout{display:grid;grid-template-columns:minmax(0,1fr);gap:0}
.eraser-layout{display:flex;align-items:center;justify-content:center}
.options-row{display:flex;min-width:0;min-height:40px;align-items:center;justify-content:center;gap:6px}
.controls-row{border-top:1px solid var(--border-subtle)}
.option-group{display:flex;align-items:center;gap:4px;flex:none}
.separator{width:1px;height:32px;margin:0 3px;background:var(--border-subtle);flex:none}
button{flex:none;border:0;color:var(--text-primary);background:transparent;cursor:pointer}
button:hover{background:var(--surface-raised)}
button:focus-visible{outline:2px solid var(--accent);outline-offset:2px}
button[aria-pressed='true']{background:var(--accent-soft);box-shadow:inset 0 0 0 2px var(--accent)}
button:disabled{cursor:not-allowed;opacity:.45}
.stroke-option{display:grid;width:54px;height:40px;place-items:center;border-radius:10px}
.stroke-option svg{width:42px;height:24px}
.color-group{gap:8px;padding:0 3px}
.color-option{position:relative;width:28px;height:28px;padding:0;border:1px solid color-mix(in srgb,var(--text-primary) 18%,transparent);border-radius:50%;background:var(--option-color)}
.color-option:hover{background:var(--option-color);transform:scale(1.06)}
.color-option[aria-pressed='true']{background:var(--option-color);box-shadow:0 0 0 2px var(--surface-panel),0 0 0 4px var(--accent)}
.custom-color{border:0;background:radial-gradient(circle,#fff 0 18%,transparent 62%),conic-gradient(#ff4d4d,#ffd43b,#51cf66,#22b8cf,#4c6ef5,#cc5de8,#ff4d4d)}
.custom-color:hover,.custom-color[aria-pressed='true']{background:radial-gradient(circle,#fff 0 18%,transparent 62%),conic-gradient(#ff4d4d,#ffd43b,#51cf66,#22b8cf,#4c6ef5,#cc5de8,#ff4d4d)}
.native-color{position:absolute;width:1px;height:1px;opacity:0;pointer-events:none}
.size-group{padding:0 7px}
.controls-row .size-group{flex:1 1 0;min-width:0}
.size-control{display:grid;grid-template-columns:auto minmax(120px,220px) 54px;align-items:center;gap:12px;font-size:12px;font-weight:650;white-space:nowrap}
.size-control input{width:220px;max-width:36vw;accent-color:var(--accent);cursor:pointer}
.opacity-control{grid-template-columns:auto minmax(100px,150px) 48px}
.opacity-control input{width:150px}
.controls-row .size-control{width:100%;grid-template-columns:auto minmax(80px,1fr) 54px}
.controls-row .size-control input{width:100%;max-width:none}
.controls-row .opacity-control{grid-template-columns:auto minmax(80px,1fr) 48px}
.size-control output{font-variant-numeric:tabular-nums;text-align:right;color:var(--text-muted)}
.size-control input:focus-visible{outline:2px solid var(--accent);outline-offset:4px;border-radius:999px}
.size-control input:disabled{cursor:not-allowed;opacity:.45}
@media(max-width:640px){.tool-options{max-width:calc(100vw - 24px)}.options-row{gap:3px}.stroke-option{width:40px}.color-group{gap:3px;padding:0 1px}.color-option{width:20px;height:20px}.separator{margin:0 1px}.size-group{padding:0 4px}.size-control,.controls-row .size-control,.controls-row .opacity-control{grid-template-columns:auto minmax(64px,1fr) 44px;gap:6px}.size-control input{width:100%;max-width:none}}
@media(forced-colors:active){button[aria-pressed='true']{outline:2px solid Highlight;box-shadow:none}.color-option{forced-color-adjust:none}}
</style>

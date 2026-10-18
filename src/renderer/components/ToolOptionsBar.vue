<script setup lang="ts">
import { computed, ref } from 'vue';
import { PALETTE } from '@/renderer/lib/constants';
import { ERASER_OPTIONS, PENCIL_OPTIONS } from '@/renderer/lib/drawing-tools';
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
  : ERASER_OPTIONS.map((option) => `eraser-${option.value}`));
const activeOption = computed(() => pencilVisible.value ? `pencil-${s.pencilPreset}` : `eraser-${s.eraserSize}`);
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
</script>

<template>
  <div
    ref="root"
    class="tool-options sd-panel"
    role="toolbar"
    aria-orientation="horizontal"
    :aria-label="pencilVisible ? 'Stiftoptionen' : 'Radiereroptionen'"
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
    </template>

    <div v-else class="option-group eraser-group" role="group" aria-label="Radierergröße">
      <button
        v-for="option in ERASER_OPTIONS"
        :key="option.value"
        type="button"
        class="eraser-option"
        :data-option-id="`eraser-${option.value}`"
        :tabindex="tabStop === `eraser-${option.value}` ? 0 : -1"
        :aria-label="`Radierer ${option.label}`"
        :aria-pressed="s.eraserSize === option.value"
        :title="option.label"
        :disabled="!s.canWrite || s.transitioning"
        @click="store.setEraserSize(option.value)"
      >
        <span class="eraser-preview" :style="{ width: `${option.previewSize}px`, height: `${option.previewSize}px` }" aria-hidden="true" />
        <span>{{ option.label }}</span>
      </button>
    </div>
  </div>
</template>

<style scoped>
.tool-options{display:flex;align-items:center;gap:6px;min-height:52px;max-width:min(760px,calc(100vw - 24px));padding:5px 7px;overflow-x:auto;overflow-y:hidden}
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
.eraser-group{gap:6px}
.eraser-option{display:flex;align-items:center;gap:8px;height:40px;padding:0 10px;border-radius:10px;font-size:12px;font-weight:600;white-space:nowrap}
.eraser-preview{display:block;border:2px solid currentColor;border-radius:50%;background:color-mix(in srgb,var(--surface-panel) 75%,transparent)}
@media(max-width:640px){.tool-options{max-width:calc(100vw - 24px)}.color-group{gap:6px}.color-option{width:26px;height:26px}.eraser-option span:last-child{position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0,0,0,0)}.eraser-option{width:48px;justify-content:center;padding:0}}
@media(forced-colors:active){button[aria-pressed='true']{outline:2px solid Highlight;box-shadow:none}.color-option{forced-color-adjust:none}}
</style>

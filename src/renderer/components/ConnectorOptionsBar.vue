<script setup lang="ts">
import { computed, ref } from 'vue';
import { CONNECTOR_END_MARKER_OPTIONS, CONNECTOR_ROUTING_OPTIONS } from '@/renderer/lib/connector-preferences';
import { useWhiteboard } from './use-whiteboard';

const store = useWhiteboard();
const s = store.state;
const root = ref<HTMLElement | null>(null);
const focusedOption = ref<string | null>(null);

const optionIds = [...CONNECTOR_ROUTING_OPTIONS.map((option) => `route-${option.value}`), ...CONNECTOR_END_MARKER_OPTIONS.map((option) => `marker-${option.value}`)];
const tabStop = computed(() => focusedOption.value && optionIds.includes(focusedOption.value) ? focusedOption.value : `route-${s.connectorDefaults.routing}`);

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
</script>

<template>
  <div
    ref="root"
    class="tool-options connector-options sd-panel"
    role="toolbar"
    aria-orientation="horizontal"
    aria-label="Verbindungsoptionen"
    data-testid="connector-options"
    @pointerdown.stop
    @pointermove.stop
    @pointerup.stop
    @pointercancel.stop
    @keydown="onKeydown"
    @focusin="onFocusIn"
    @focusout="onFocusOut"
  >
    <div class="option-group" role="group" aria-label="Linienform">
      <button
        v-for="option in CONNECTOR_ROUTING_OPTIONS"
        :key="option.value"
        type="button"
        class="option"
        :data-option-id="`route-${option.value}`"
        :tabindex="tabStop === `route-${option.value}` ? 0 : -1"
        :aria-label="`Linienform ${option.label}`"
        :aria-pressed="s.connectorDefaults.routing === option.value"
        :title="option.label"
        :disabled="!s.canWrite || s.transitioning"
        @click="store.setConnectorDefaults({ routing: option.value })"
      >
        <svg viewBox="0 0 48 24" aria-hidden="true"><path v-if="option.value === 'straight'" d="M5 19L43 5" /><path v-else-if="option.value === 'curved'" d="M5 19C20 19 28 5 43 5" /><path v-else d="M5 19H24V5H43" /></svg>
      </button>
    </div>
    <span class="separator" aria-hidden="true" />
    <div class="option-group" role="group" aria-label="Pfeilspitze am Ende">
      <button
        v-for="option in CONNECTOR_END_MARKER_OPTIONS"
        :key="option.value"
        type="button"
        class="option"
        :data-option-id="`marker-${option.value}`"
        :tabindex="tabStop === `marker-${option.value}` ? 0 : -1"
        :aria-label="`Pfeilspitze ${option.label}`"
        :aria-pressed="s.connectorDefaults.endMarker === option.value"
        :title="option.label"
        :disabled="!s.canWrite || s.transitioning"
        @click="store.setConnectorDefaults({ endMarker: option.value })"
      >
        <svg viewBox="0 0 48 24" aria-hidden="true"><line x1="5" y1="12" x2="40" y2="12" /><path v-if="option.value === 'line-arrow'" d="M32 5l8 7-8 7" /><path v-else-if="option.value === 'solid-arrow'" d="M30 4l11 8-11 8z" class="filled" /><path v-else-if="option.value === 'triangle'" d="M29 4l12 8-12 8z" /><circle v-else-if="option.value === 'circle'" cx="37" cy="12" r="6" /><path v-else-if="option.value === 'diamond'" d="M29 12l6-7 7 7-7 7z" /></svg>
      </button>
    </div>
  </div>
</template>

<style scoped>
.tool-options{display:flex;align-items:center;gap:6px;min-height:52px;max-width:min(760px,calc(100vw - 24px));padding:5px 7px;overflow-x:auto;overflow-y:hidden;scrollbar-width:none}
.option-group{display:flex;align-items:center;gap:4px;flex:none}
.separator{flex:none;width:1px;height:32px;margin:0 3px;background:var(--border-subtle)}
.option{display:grid;flex:none;place-items:center;width:54px;height:40px;padding:0;border:0;border-radius:10px;background:transparent;color:var(--text-primary);cursor:pointer}
.option:hover:not(:disabled){background:var(--surface-raised)}
.option:focus-visible{outline:2px solid var(--focus-ring);outline-offset:2px}
.option[aria-pressed='true']{background:var(--accent-soft);color:var(--accent-ink);box-shadow:inset 0 0 0 2px var(--accent)}
.option:disabled{cursor:not-allowed;opacity:.45}
.option svg{width:42px;height:24px;fill:none;stroke:currentColor;stroke-width:1.8;stroke-linecap:round;stroke-linejoin:round}
.option svg .filled{fill:currentColor}
@media(forced-colors:active){.option[aria-pressed='true']{outline:2px solid Highlight;box-shadow:none}}
</style>

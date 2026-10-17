<script setup lang="ts">
import { computed, ref } from 'vue';
import AppIcon from './AppIcon.vue';
import ImageFileInput from './ImageFileInput.vue';
import { isMacPlatform } from './platform';
import { useWhiteboard } from './use-whiteboard';
import { t } from '@/renderer/i18n/de';
import { TOOL_DEFS, formatCombo } from '@/renderer/lib/shortcuts';
import type { Tool } from '@/renderer/state/contract';

const store = useWhiteboard();
const isMac = isMacPlatform();
const root = ref<HTMLElement | null>(null);
const imageInput = ref<InstanceType<typeof ImageFileInput> | null>(null);
const focusedTool = ref<string | null>(null);

const items = computed(() =>
  TOOL_DEFS.map((def) => {
    const hint = formatCombo(def.key, isMac);
    return {
      tool: def.tool,
      label: def.label,
      hint,
      tip: t('tip.withHint', { label: def.label, hint }),
      pressed: def.tool === store.state.tool,
      isImage: def.tool === 'image',
      separator: def.tool === 'text',
    };
  }),
);

// Roving tabindex: the focused tool owns the single tab stop, otherwise the active tool does.
const tabStop = computed(() => {
  const preferred = focusedTool.value ?? store.state.tool;
  return TOOL_DEFS.some((def) => def.tool === preferred) ? preferred : (TOOL_DEFS[0]?.tool ?? null);
});

function activate(tool: Tool): void {
  if (tool === 'image') {
    imageInput.value?.open();
    return;
  }
  store.setTool(tool);
}

function onFocusIn(event: FocusEvent): void {
  const target = event.target;
  if (target instanceof HTMLElement && target.dataset.tool) focusedTool.value = target.dataset.tool;
}

function onFocusOut(event: FocusEvent): void {
  const next = event.relatedTarget;
  if (!(next instanceof Node) || !root.value?.contains(next)) focusedTool.value = null;
}

function onKeydown(event: KeyboardEvent): void {
  if (event.altKey || event.ctrlKey || event.metaKey) return;
  const buttons = Array.from(root.value?.querySelectorAll<HTMLButtonElement>('button[data-tool]:not(:disabled)') ?? []);
  if (buttons.length === 0) return;
  const current = Math.max(buttons.findIndex((button) => button === document.activeElement), 0);
  let next: number;
  if (event.key === 'ArrowRight') next = (current + 1) % buttons.length;
  else if (event.key === 'ArrowLeft') next = (current - 1 + buttons.length) % buttons.length;
  else if (event.key === 'Home') next = 0;
  else if (event.key === 'End') next = buttons.length - 1;
  else return;
  event.preventDefault();
  event.stopPropagation();
  buttons[next]?.focus();
}
</script>

<template>
  <div
    ref="root"
    class="toolbar sd-panel"
    role="toolbar"
    aria-orientation="horizontal"
    :aria-label="t('toolbar.label')"
    @keydown="onKeydown"
    @focusin="onFocusIn"
    @focusout="onFocusOut"
  >
    <template v-for="item in items" :key="item.tool">
      <span v-if="item.separator" class="sep" aria-hidden="true" />
      <button
        type="button"
        class="tool sd-icon-btn"
        :data-tool="item.tool"
        :disabled="!store.state.canWrite && !['select', 'hand'].includes(item.tool)"
        :aria-label="item.label"
        :aria-pressed="item.isImage ? undefined : item.pressed"
        :aria-keyshortcuts="item.hint"
        :tabindex="item.tool === tabStop ? 0 : -1"
        @click="activate(item.tool)"
      >
        <AppIcon :name="item.tool" />
        <span class="tip" aria-hidden="true">{{ item.tip }}</span>
      </button>
    </template>
    <ImageFileInput ref="imageInput" />
  </div>
</template>

<style scoped>
.toolbar {
  position: absolute;
  top: var(--space-3);
  left: 50%;
  z-index: 10;
  display: flex;
  align-items: center;
  gap: 4px;
  padding: 6px;
  transform: translateX(-50%);
}

.sep {
  width: 1px;
  height: 24px;
  margin: 0 6px;
  background: var(--border-subtle);
}

.tool {
  position: relative;
  width: 40px;
  height: 40px;
  border-radius: 10px;
  color: var(--text-primary);
}

.tool[aria-pressed='true'] {
  color: var(--accent);
}

/* Active pointer and shape tools read as solid glyphs, like in the reference design. */
.tool[aria-pressed='true'][data-tool='select'] :deep(path) {
  fill: currentColor;
}

.tool[aria-pressed='true']:is([data-tool='rectangle'], [data-tool='ellipse'], [data-tool='diamond']) :deep(path) {
  fill: currentColor;
  fill-opacity: 0.18;
}

.tip {
  position: absolute;
  top: calc(100% + var(--space-2));
  left: 50%;
  z-index: 20;
  padding: var(--space-1) var(--space-2);
  background: var(--inverse-surface);
  border-radius: var(--radius-1);
  color: var(--inverse-text);
  font-size: var(--font-size-s);
  white-space: nowrap;
  opacity: 0;
  pointer-events: none;
  transform: translateX(-50%);
  transition: opacity var(--duration-short) ease;
}

.tool:hover .tip {
  opacity: 1;
  transition-delay: 350ms;
}

.tool:focus-visible .tip {
  opacity: 1;
}

@media (forced-colors: active) {
  .tip {
    border: 1px solid CanvasText;
  }
}
@media (max-width:1040px){.toolbar{top:84px}}
@media (max-width:860px){.toolbar{max-width:calc(100vw - 24px);overflow-x:auto;overflow-y:hidden}.tool{flex-shrink:0}.tip{display:none}}
</style>

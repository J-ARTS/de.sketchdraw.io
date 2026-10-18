<script setup lang="ts">
import { computed, nextTick, ref, useId } from 'vue';
import { useEventListener } from '@vueuse/core';
import AppIcon from './AppIcon.vue';
import { useAnchoredPopover } from './use-anchored-popover';

/** Select-only combobox with a listbox popover (WAI-ARIA APG); replaces the native <select>. */
const props = defineProps<{ modelValue: string; options: ReadonlyArray<{ value: string; label: string }>; label: string; disabled?: boolean }>();
const emit = defineEmits<{ 'update:modelValue': [value: string] }>();

const uid = useId();
const labelId = `${uid}-label`; const listId = `${uid}-list`;
const open = ref(false);
const activeIndex = ref(0);
const trigger = ref<HTMLButtonElement | null>(null);
const list = ref<HTMLElement | null>(null);
const { style, show } = useAnchoredPopover(trigger, list, () => open.value, 160);
const selectedIndex = computed(() => Math.max(0, props.options.findIndex((option) => option.value === props.modelValue)));
const selectedLabel = computed(() => props.options[selectedIndex.value]?.label ?? '');
const optionId = (index: number) => `${uid}-option-${index}`;
let typeahead = ''; let typeaheadTimer: ReturnType<typeof setTimeout> | undefined;

async function openList(index = selectedIndex.value): Promise<void> {
  if (props.disabled) return;
  activeIndex.value = index; open.value = true;
  await show();
  list.value?.querySelector<HTMLElement>(`#${CSS.escape(optionId(index))}`)?.scrollIntoView({ block: 'nearest' });
}
function closeList(returnFocus = true): void { open.value = false; if (returnFocus) trigger.value?.focus(); }
function choose(index: number): void {
  const option = props.options[index];
  if (option && option.value !== props.modelValue) emit('update:modelValue', option.value);
  closeList();
}
function move(index: number): void {
  activeIndex.value = Math.max(0, Math.min(props.options.length - 1, index));
  void nextTick(() => list.value?.querySelector<HTMLElement>(`#${CSS.escape(optionId(activeIndex.value))}`)?.scrollIntoView({ block: 'nearest' }));
}
function onKeydown(event: KeyboardEvent): void {
  if (event.altKey || event.ctrlKey || event.metaKey) return;
  const key = event.key;
  if (!open.value) {
    if (['ArrowDown', 'ArrowUp', 'Enter', ' '].includes(key)) { event.preventDefault(); void openList(); }
    else if (key.length === 1) typeAhead(key, false);
    return;
  }
  if (key === 'Escape') { event.preventDefault(); event.stopPropagation(); closeList(); }
  else if (key === 'Tab') closeList(false);
  else if (key === 'ArrowDown') { event.preventDefault(); move(activeIndex.value + 1); }
  else if (key === 'ArrowUp') { event.preventDefault(); move(activeIndex.value - 1); }
  else if (key === 'Home') { event.preventDefault(); move(0); }
  else if (key === 'End') { event.preventDefault(); move(props.options.length - 1); }
  else if (key === 'Enter' || key === ' ') { event.preventDefault(); choose(activeIndex.value); }
  else if (key.length === 1) typeAhead(key, true);
}
function typeAhead(key: string, isOpen: boolean): void {
  typeahead += key.toLocaleLowerCase('de'); clearTimeout(typeaheadTimer); typeaheadTimer = setTimeout(() => { typeahead = ''; }, 600);
  const index = props.options.findIndex((option) => option.label.toLocaleLowerCase('de').startsWith(typeahead));
  if (index < 0) return;
  if (isOpen) move(index); else emit('update:modelValue', props.options[index]!.value);
}
useEventListener(document, 'pointerdown', (event: PointerEvent) => {
  if (open.value && event.target instanceof Node && !trigger.value?.contains(event.target) && !list.value?.contains(event.target)) closeList(false);
}, true);
</script>

<template>
  <div class="app-field">
    <span :id="labelId" class="app-field-label">{{ label }}</span>
    <button
      ref="trigger"
      type="button"
      class="app-select"
      role="combobox"
      aria-haspopup="listbox"
      :aria-expanded="open"
      :aria-controls="open ? listId : undefined"
      :aria-labelledby="`${labelId} ${uid}-value`"
      :aria-activedescendant="open ? optionId(activeIndex) : undefined"
      :disabled="disabled"
      @click="open ? closeList() : openList()"
      @keydown="onKeydown"
    >
      <span :id="`${uid}-value`" class="app-select-value">{{ selectedLabel }}</span>
      <AppIcon name="chevron-down" :size="16" class="app-select-chevron" />
    </button>
    <ul v-if="open" :id="listId" ref="list" class="app-popover app-listbox" role="listbox" :aria-labelledby="labelId" :style="style">
      <li
        v-for="(option, index) in options"
        :id="optionId(index)"
        :key="option.value"
        role="option"
        class="app-option"
        :class="{ active: index === activeIndex }"
        :aria-selected="option.value === modelValue"
        @pointermove="activeIndex = index"
        @pointerdown.prevent
        @click="choose(index)"
      >
        <span>{{ option.label }}</span>
        <AppIcon v-if="option.value === modelValue" name="check" :size="16" />
      </li>
    </ul>
  </div>
</template>

<style scoped>
.app-field{display:grid;gap:6px;min-width:0}
.app-field-label{color:var(--text-muted);font-size:12px}
.app-select{display:flex;align-items:center;justify-content:space-between;gap:8px;width:100%;min-height:42px;padding:9px 10px;border:1px solid var(--border-subtle);border-radius:9px;background:var(--surface-raised);color:var(--text-primary);font:inherit;font-size:14px;text-align:left;cursor:pointer}
.app-select:hover:not(:disabled){border-color:var(--border-default)}
.app-select:focus-visible,.app-select[aria-expanded='true']{outline:2px solid var(--focus-ring);outline-offset:1px;border-color:var(--accent)}
.app-select:disabled{opacity:.5;cursor:not-allowed}
.app-select-value{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.app-select-chevron{flex:none;color:var(--text-muted);transition:transform var(--duration-short) ease}
.app-select[aria-expanded='true'] .app-select-chevron{transform:rotate(180deg)}
.app-popover{position:fixed;z-index:50;margin:0;padding:6px;overflow:auto;border:1px solid var(--border-subtle);border-radius:var(--radius-2);background:var(--menu-surface);box-shadow:var(--shadow-panel);color:var(--menu-text)}
.app-option{display:flex;align-items:center;justify-content:space-between;gap:12px;min-height:38px;padding:0 12px;border-radius:9px;font-size:14px;cursor:pointer;list-style:none}
.app-option.active{background:var(--menu-hover)}
.app-option[aria-selected='true']{background:var(--menu-selected);color:var(--menu-selected-text)}
@media(prefers-reduced-motion:reduce){.app-select-chevron{transition:none}}
@media(forced-colors:active){.app-option.active,.app-option[aria-selected='true']{forced-color-adjust:none;background:Highlight;color:HighlightText}}
</style>

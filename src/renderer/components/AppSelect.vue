<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, ref, useId, watch } from 'vue';
import { useEventListener } from '@vueuse/core';
import AppIcon from './AppIcon.vue';
import { useAnchoredPopover } from './use-anchored-popover';

/**
 * Custom dropdown (WAI-ARIA APG combobox + listbox popover); replaces the native <select> and <datalist> everywhere.
 *
 * - Select-only (default): button-like combobox, the value must be one of `options`. An unknown `modelValue` shows `placeholder`.
 * - `editable`: single-line text input with suggestions; `modelValue` is free text (`maxlength` applies), `options` are suggestions
 *   filtered by what was typed. Typing, caret and selection keys stay native; the input keeps focus while a suggestion is active.
 * - `compact`: denser variant (smaller control and rows) for property panels.
 * The accessible name is exactly `label`; the current value is exposed through the control's content/value.
 * The popover is a native `popover="manual"` element, so it is promoted to the top layer (no clipping inside panels or a modal
 * <dialog>) while staying in the DOM of the component (no teleport out of the modal).
 */
export interface AppSelectOption { value: string; label: string; disabled?: boolean }
const props = defineProps<{
  modelValue: string; options: ReadonlyArray<AppSelectOption>; label: string;
  placeholder?: string; disabled?: boolean; compact?: boolean; editable?: boolean; maxlength?: number; id?: string;
}>();
const emit = defineEmits<{ 'update:modelValue': [value: string] }>();

const uid = useId();
const labelId = `${uid}-label`; const listId = `${uid}-list`;
const controlId = computed(() => props.id ?? `${uid}-control`);
const open = ref(false);
const activeIndex = ref(-1);
const filtering = ref(false); // editable: suggestions are narrowed to the typed text until the list is opened explicitly
const trigger = ref<HTMLButtonElement | HTMLInputElement | null>(null);
const shell = ref<HTMLElement | null>(null);
const list = ref<HTMLElement | null>(null);
const anchor = computed<HTMLElement | null>({ get: () => (props.editable ? shell.value : trigger.value), set: () => undefined });
const { style, place } = useAnchoredPopover(anchor, list, () => open.value, 160);

const visibleOptions = computed<ReadonlyArray<AppSelectOption>>(() => {
  if (!props.editable || !filtering.value) return props.options;
  const query = props.modelValue.trim().toLocaleLowerCase('de');
  return query ? props.options.filter((option) => option.label.toLocaleLowerCase('de').includes(query)) : props.options;
});
const selectedIndex = computed(() => visibleOptions.value.findIndex((option) => option.value === props.modelValue));
const selectedLabel = computed(() => props.options.find((option) => option.value === props.modelValue)?.label);
const optionId = (index: number) => `${uid}-option-${index}`;
const activeId = computed(() => (open.value && enabled(activeIndex.value) ? optionId(activeIndex.value) : undefined));
const enabled = (index: number): boolean => { const option = visibleOptions.value[index]; return option !== undefined && !option.disabled; };
function firstEnabled(from = 0, step = 1): number {
  for (let i = from; i >= 0 && i < visibleOptions.value.length; i += step) if (enabled(i)) return i;
  return -1;
}
/** Next enabled index from `from` in direction `step`, clamped at the ends (no wrap, like a native listbox). */
function stepEnabled(from: number, step: 1 | -1): number {
  const next = firstEnabled(from + step, step);
  return next >= 0 ? next : (enabled(from) ? from : firstEnabled(step === 1 ? 0 : visibleOptions.value.length - 1, step));
}

let typeahead = ''; let typeaheadTimer: ReturnType<typeof setTimeout> | undefined;
function clearTypeahead(): void { typeahead = ''; clearTimeout(typeaheadTimer); typeaheadTimer = undefined; }
onBeforeUnmount(clearTypeahead);

function scrollActive(): void {
  void nextTick(() => list.value?.querySelector<HTMLElement>(`#${CSS.escape(optionId(activeIndex.value))}`)?.scrollIntoView({ block: 'nearest' }));
}
function promote(): void {
  const element = list.value;
  if (!element || typeof element.showPopover !== 'function') return;
  try { if (!element.matches(':popover-open')) element.showPopover(); } catch { /* not connected / unsupported: fixed positioning still applies */ }
}
async function openList(index?: number): Promise<void> {
  if (props.disabled || visibleOptions.value.length === 0) return;
  const start = index ?? (selectedIndex.value >= 0 && enabled(selectedIndex.value) ? selectedIndex.value : (props.editable ? -1 : firstEnabled()));
  activeIndex.value = start; open.value = true;
  await nextTick(); promote(); place(); scrollActive();
}
function closeList(returnFocus = true): void {
  open.value = false; activeIndex.value = -1; filtering.value = false; clearTypeahead();
  if (returnFocus) trigger.value?.focus();
}
function choose(index: number): void {
  const option = visibleOptions.value[index];
  if (!option || option.disabled) return;
  if (option.value !== props.modelValue) emit('update:modelValue', option.value);
  closeList();
}
function move(index: number): void { if (index < 0) return; activeIndex.value = index; scrollActive(); }

function matchIndex(prefix: string, from: number): number {
  const options = visibleOptions.value; const total = options.length;
  for (let offset = 0; offset < total; offset += 1) {
    const index = (from + offset + total) % total;
    if (enabled(index) && options[index]!.label.toLocaleLowerCase('de').startsWith(prefix)) return index;
  }
  return -1;
}
function typeAhead(key: string, isOpen: boolean): void {
  typeahead += key.toLocaleLowerCase('de'); clearTimeout(typeaheadTimer); typeaheadTimer = setTimeout(clearTypeahead, 600);
  const current = isOpen ? activeIndex.value : selectedIndex.value;
  const cycle = [...typeahead].every((char) => char === typeahead[0]);
  // One character (or the same one repeated) cycles through entries starting with it; a longer prefix is searched from the current entry.
  const index = cycle ? matchIndex(typeahead[0]!, current + 1) : matchIndex(typeahead, Math.max(0, current));
  if (index < 0) return;
  if (isOpen) move(index); else if (visibleOptions.value[index]!.value !== props.modelValue) emit('update:modelValue', visibleOptions.value[index]!.value);
}

function onKeydown(event: KeyboardEvent): void {
  if (props.disabled || event.isComposing) return;
  const key = event.key;
  if (key === 'Tab') { if (open.value) closeList(false); return; } // exits naturally; never swallowed (parent focus traps need it)
  const arrowToggle = event.altKey && (key === 'ArrowDown' || key === 'ArrowUp');
  if ((event.ctrlKey || event.metaKey || (event.altKey && !arrowToggle)) && key !== 'Escape') return; // app/OS shortcuts and editing chords pass through
  if (key === 'Escape') {
    if (!open.value) return; // let the parent dialog handle it
    event.preventDefault(); event.stopPropagation(); closeList(); return;
  }
  // Everything below is consumed here so that it can never reach canvas shortcuts (tool keys, Delete, arrows nudge, Space pan, ...).
  event.stopPropagation();
  const options = visibleOptions.value;
  if (!open.value) {
    if (key === 'ArrowDown' || key === 'ArrowUp') { event.preventDefault(); filtering.value = false; void openList(); }
    else if (props.editable) return; // all other keys are native text editing
    else if (key === 'Enter' || (key === ' ' && !typeahead)) { event.preventDefault(); void openList(); }
    else if (key === 'Home' || key === 'End') { event.preventDefault(); void openList(key === 'Home' ? firstEnabled() : firstEnabled(options.length - 1, -1)); }
    else if (key.length === 1) { event.preventDefault(); typeAhead(key, false); }
    else if (key === 'Delete' || key === 'Backspace') event.preventDefault();
    return;
  }
  if (key === 'ArrowDown') { event.preventDefault(); if (arrowToggle) closeList(); else move(activeIndex.value < 0 ? firstEnabled() : stepEnabled(activeIndex.value, 1)); }
  else if (key === 'ArrowUp') { event.preventDefault(); if (arrowToggle) closeList(); else move(activeIndex.value < 0 ? firstEnabled(options.length - 1, -1) : stepEnabled(activeIndex.value, -1)); }
  else if (props.editable) {
    // Caret navigation inside the text stays native; only the list-level keys are intercepted.
    if (key === 'Enter') { if (enabled(activeIndex.value)) { event.preventDefault(); choose(activeIndex.value); } else closeList(false); }
  }
  else if (key === 'Home') { event.preventDefault(); move(firstEnabled()); }
  else if (key === 'End') { event.preventDefault(); move(firstEnabled(options.length - 1, -1)); }
  else if (key === 'Enter' || (key === ' ' && !typeahead)) { event.preventDefault(); if (enabled(activeIndex.value)) choose(activeIndex.value); else closeList(); }
  else if (key.length === 1) { event.preventDefault(); typeAhead(key, true); }
  else if (key === 'Delete' || key === 'Backspace') event.preventDefault();
}
/** Space activates on keyup in some engines and pans the canvas on keyup: keep both away from the control's parents. */
function onKeyup(event: KeyboardEvent): void {
  if (props.editable || event.key !== ' ') return;
  event.preventDefault(); event.stopPropagation();
}
function onInput(event: Event): void {
  const value = (event.target as HTMLInputElement).value;
  filtering.value = true;
  emit('update:modelValue', value);
  void nextTick(() => {
    if (visibleOptions.value.length === 0) { open.value = false; activeIndex.value = -1; return; }
    if (!open.value) void openList(-1); else { activeIndex.value = -1; place(); }
  });
}
function toggle(): void {
  if (props.disabled) return;
  trigger.value?.focus();
  if (open.value) { closeList(); return; }
  filtering.value = false; void openList();
}
function onBlur(): void { if (open.value) closeList(false); }

useEventListener(document, 'pointerdown', (event: PointerEvent) => {
  if (!open.value || !(event.target instanceof Node)) return;
  if (!anchor.value?.contains(event.target) && !list.value?.contains(event.target)) closeList(false);
}, true);

// Options may change while the list is open (async data, filtering): keep the active entry by value, never point at a stale/disabled id.
watch(visibleOptions, (next, previous) => {
  if (!open.value) return;
  // Keep the typed filter when no suggestion matches; clearing it would reopen the full list on the same input event.
  if (next.length === 0) { open.value = false; activeIndex.value = -1; clearTypeahead(); return; }
  const activeValue = previous[activeIndex.value]?.value;
  const same = activeValue === undefined ? -1 : next.findIndex((option) => option.value === activeValue);
  activeIndex.value = same >= 0 && enabled(same) ? same : (props.editable ? -1 : firstEnabled());
  void nextTick(() => { place(); scrollActive(); });
}, { deep: true });
watch(() => props.disabled, (disabled) => { if (disabled) closeList(false); });
watch(() => props.editable, () => closeList(false));
</script>

<template>
  <div class="app-field" :class="{ compact }">
    <span :id="labelId" class="app-field-label">{{ label }}</span>
    <div v-if="editable" ref="shell" class="app-select app-select-editable" :class="{ open, disabled }">
      <input
        :id="controlId"
        ref="trigger"
        type="text"
        class="app-select-input"
        role="combobox"
        aria-autocomplete="list"
        autocomplete="off"
        spellcheck="false"
        :value="modelValue"
        :placeholder="placeholder"
        :maxlength="maxlength"
        :disabled="disabled"
        :aria-expanded="open"
        :aria-controls="open ? listId : undefined"
        :aria-labelledby="labelId"
        :aria-activedescendant="activeId"
        @input="onInput"
        @keydown="onKeydown"
        @blur="onBlur"
      />
      <button type="button" class="app-select-toggle" tabindex="-1" aria-hidden="true" :disabled="disabled" @mousedown.prevent @pointerdown.prevent @click="toggle">
        <AppIcon name="chevron-down" :size="16" class="app-select-chevron" />
      </button>
    </div>
    <button
      v-else
      :id="controlId"
      ref="trigger"
      type="button"
      class="app-select"
      role="combobox"
      aria-haspopup="listbox"
      :aria-expanded="open"
      :aria-controls="open ? listId : undefined"
      :aria-labelledby="labelId"
      :aria-activedescendant="activeId"
      :disabled="disabled"
      @click="open ? closeList() : openList()"
      @keydown="onKeydown"
      @keyup="onKeyup"
      @blur="onBlur"
    >
      <span class="app-select-value" :class="{ placeholder: selectedLabel === undefined }">{{ selectedLabel ?? placeholder ?? '' }}</span>
      <AppIcon name="chevron-down" :size="16" class="app-select-chevron" />
    </button>
    <ul
      v-if="open"
      :id="listId"
      ref="list"
      popover="manual"
      class="app-popover app-listbox"
      :class="{ compact }"
      role="listbox"
      :aria-labelledby="labelId"
      :style="style"
      @mousedown.prevent
      @pointerdown.prevent
    >
      <li
        v-for="(option, index) in visibleOptions"
        :id="optionId(index)"
        :key="option.value"
        role="option"
        class="app-option"
        :class="{ active: index === activeIndex, disabled: option.disabled }"
        :aria-selected="option.value === modelValue"
        :aria-disabled="option.disabled || undefined"
        @pointermove="!option.disabled && (activeIndex = index)"
        @click="choose(index)"
      >
        <span class="app-option-label">{{ option.label }}</span>
        <AppIcon v-if="option.value === modelValue" name="check" :size="16" />
      </li>
    </ul>
  </div>
</template>

<style scoped>
.app-field{display:grid;gap:6px;min-width:0}
.app-field-label{color:var(--text-muted);font-size:12px}
.app-select{display:flex;align-items:center;justify-content:space-between;gap:8px;width:100%;min-height:42px;padding:9px 10px;border:1px solid var(--border-subtle);border-radius:9px;background:var(--surface-raised);color:var(--text-primary);font:inherit;font-size:14px;text-align:left;cursor:pointer}
.app-select:hover:not(:disabled):not(.disabled){border-color:var(--border-default)}
.app-select:focus-visible,.app-select[aria-expanded='true'],.app-select-editable:focus-within{outline:2px solid var(--focus-ring);outline-offset:1px;border-color:var(--accent)}
.app-select:disabled,.app-select.disabled{opacity:.5;cursor:not-allowed}
.app-select-value{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.app-select-value.placeholder{color:var(--text-muted)}
.app-select-chevron{flex:none;color:var(--text-muted);transition:transform var(--duration-short) ease}
.app-select[aria-expanded='true'] .app-select-chevron,.app-select-editable.open .app-select-chevron{transform:rotate(180deg)}
.app-select-editable{cursor:text;padding:0 0 0 10px}
.app-select-input{flex:1;min-width:0;min-height:40px;padding:0;border:0;outline:0;background:transparent;color:var(--text-primary);font:inherit;text-overflow:ellipsis}
.app-select-input::placeholder{color:var(--text-muted)}
.app-select-toggle{display:grid;flex:none;align-self:stretch;width:36px;padding:0;place-items:center;border:0;border-radius:0 9px 9px 0;background:transparent;cursor:pointer}
.app-select-toggle:disabled{cursor:not-allowed}
.compact .app-select{min-height:32px;padding:4px 8px;border-radius:7px;font-size:13px}
.compact .app-select-editable{padding:0 0 0 8px}
.compact .app-select-input{min-height:30px}
.compact .app-select-toggle{width:28px;border-radius:0 7px 7px 0}
.compact .app-field-label{font-size:11px}
/* Native popover=manual: top layer (never clipped by panels/dialog scroll areas); the UA inset/margin/size defaults are reset so the
   anchored inline left/top/bottom/min/max values from useAnchoredPopover decide the geometry. */
.app-popover{position:fixed;inset:auto;z-index:50;box-sizing:border-box;width:max-content;height:auto;margin:0;padding:6px;overflow:auto;overscroll-behavior:contain;border:1px solid var(--border-subtle);border-radius:var(--radius-2);background:var(--menu-surface);box-shadow:var(--shadow-panel);color:var(--menu-text);list-style:none;animation:app-popover-in var(--duration-short) ease-out}
.app-option{display:flex;align-items:center;justify-content:space-between;gap:12px;min-height:38px;padding:6px 12px;border-radius:9px;font-size:14px;cursor:pointer;list-style:none}
.app-option-label{min-width:0;overflow-wrap:anywhere}
.app-option.active{background:var(--menu-hover)}
.app-option[aria-selected='true']{background:var(--menu-selected);color:var(--menu-selected-text)}
.app-option.disabled{color:var(--menu-muted);opacity:.55;cursor:not-allowed}
.app-listbox.compact{padding:4px}
.app-listbox.compact .app-option{min-height:30px;padding:3px 8px;border-radius:7px;font-size:13px}
@keyframes app-popover-in{from{opacity:0;transform:translateY(-4px)}to{opacity:1;transform:none}}
@media(prefers-reduced-motion:reduce){.app-select-chevron{transition:none}.app-popover{animation:none}}
@media(forced-colors:active){.app-option.active,.app-option[aria-selected='true']{forced-color-adjust:none;background:Highlight;color:HighlightText}}
</style>

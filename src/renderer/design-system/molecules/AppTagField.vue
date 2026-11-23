<!-- @component A field for several values: a text field with suggestions to add one, and the chosen values as chips that can be removed. The suggestions can come from a search: `search` names the typed text. -->
<script setup lang="ts">
import { computed, ref } from 'vue';
import AppIcon from '@/renderer/design-system/atoms/AppIcon.vue';
import AppSelect from '@/renderer/design-system/molecules/AppSelect.vue';
import { t } from '@/renderer/i18n';

/**
 * A suggestion is added by choosing it; a text that is no suggestion is added with Enter. The field holds no
 * state of the values itself: the parent keeps the list and, where suggestions are searched, answers `search`
 * with new `options`.
 */
const props = withDefaults(defineProps<{
  /** The visible label of the field. */
  label: string;
  /** The chosen values (`v-model`). */
  modelValue: readonly string[];
  /** The values that are suggested; those already chosen are left out. */
  options: readonly string[];
  /** Shown in the empty text field. */
  placeholder?: string;
  /** Nothing can be added or removed. */
  disabled?: boolean;
  /** The id of the text field. */
  id?: string;
  /** How many values the field takes; a further one replaces the last. Default: any number. */
  max?: number;
}>(), { placeholder: undefined, disabled: false, id: undefined, max: undefined });
const emit = defineEmits<{
  /** The list of values changed. */
  'update:modelValue': [value: string[]];
  /** The text in the field changed; the parent may answer with new `options`. */
  search: [text: string];
}>();

const text = ref('');
const suggestions = computed(() => props.options.filter((option) => !props.modelValue.includes(option)).map((option) => ({ value: option, label: option })));
function add(value: string): void {
  const entry = value.trim();
  text.value = ''; emit('search', '');
  if (!entry || props.modelValue.includes(entry)) return;
  const kept = props.max !== undefined && props.modelValue.length >= props.max ? props.modelValue.slice(0, Math.max(0, props.max - 1)) : props.modelValue;
  emit('update:modelValue', [...kept, entry]);
}
function remove(value: string): void { emit('update:modelValue', props.modelValue.filter((entry) => entry !== value)); }
/**
 * The text field reports typing and choosing alike, so the field notes itself when a key wrote into it: what then
 * arrives is text, anything else a suggestion that was chosen. A name typed in full is added with Enter like any text.
 */
let typing = false;
function onText(value: string): void {
  const typed = typing; typing = false;
  if (!typed && props.options.includes(value)) { add(value); return; }
  text.value = value; emit('search', value);
}
/** Enter adds the typed text unless a suggestion is marked, which the list then takes; it never sends the form around the field. */
function onEnter(event: KeyboardEvent): void {
  const input = event.target instanceof HTMLInputElement ? event.target : null;
  if (!input || input.getAttribute('aria-activedescendant')) return;
  if (!text.value.trim()) return;
  event.preventDefault(); event.stopPropagation();
  add(text.value);
}
</script>

<template>
  <div class="tag-field" @input.capture="typing = true" @keydown.enter.capture="onEnter">
    <AppSelect :id="id" editable :label="label" :model-value="text" :options="suggestions" :placeholder="placeholder" :disabled="disabled" :maxlength="200" @update:model-value="onText" />
    <ul v-if="modelValue.length" class="tags" :aria-label="t('{label}: gewählt', { label })">
      <li v-for="value in modelValue" :key="value" class="tag">
        <span class="tag-text" :title="value">{{ value }}</span>
        <button type="button" class="tag-remove" :disabled="disabled" :aria-label="t('„{value}“ entfernen', { value })" @click="remove(value)"><AppIcon name="close" :size="12" /></button>
      </li>
    </ul>
  </div>
</template>

<style scoped>
.tag-field{display:grid;gap:var(--space-2);min-width:0}
.tags{display:flex;flex-wrap:wrap;gap:var(--space-1);margin:0;padding:0;list-style:none}
.tag{display:inline-flex;align-items:center;gap:2px;max-width:100%;min-height:24px;padding:0 2px 0 var(--space-2);border-radius:999px;background:var(--accent-soft);color:var(--accent-ink);font-size:var(--font-size-s);font-weight:600}
.tag-text{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.tag-remove{display:grid;place-items:center;flex:none;width:20px;height:20px;padding:0;border:0;border-radius:50%;background:transparent;color:inherit;cursor:pointer}
.tag-remove:hover:not(:disabled){background:var(--menu-hover)}
.tag-remove:focus-visible{outline:2px solid var(--focus-ring);outline-offset:1px}
.tag-remove:disabled{cursor:default;opacity:.5}
</style>

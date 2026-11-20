<!-- @component The bar for searching and replacing in a text field: search text with its options, the position among the hits, previous and next, and a second row for replacing. It holds no state of its own; `useTextSearch` supplies it. -->
<script setup lang="ts">
import { computed, ref, useId } from 'vue';
import { t } from '@/renderer/i18n';
import AppButton from '@/renderer/design-system/atoms/AppButton.vue';
import AppIcon from '@/renderer/design-system/atoms/AppIcon.vue';
import AppIconButton from '@/renderer/design-system/atoms/AppIconButton.vue';
import AppTextField from '@/renderer/design-system/atoms/AppTextField.vue';

const props = withDefaults(defineProps<{
  /** The text that is searched for (`v-model:query`). */
  query: string;
  /** The text a hit is replaced with (`v-model:replacement`). */
  replacement: string;
  /** Upper and lower case must match (`v-model:match-case`). */
  matchCase: boolean;
  /** Only whole words count as hits (`v-model:whole-word`). */
  wholeWord: boolean;
  /** The search text is a regular expression (`v-model:regex`). */
  regex: boolean;
  /** The replacement takes over the spelling of what it replaces (`v-model:preserve-case`). */
  preserveCase: boolean;
  /** Whether the row for replacing is shown (`v-model:replace-open`). */
  replaceOpen: boolean;
  /** Number of hits. */
  total: number;
  /** Index of the current hit, counted from 0; -1 without hits. */
  current: number;
  /** There are more hits than were counted; the number is shown as "at least". */
  capped?: boolean;
  /** The regular expression cannot be read. */
  invalid?: boolean;
  /** The field cannot be changed: replacing is not offered. */
  readonly?: boolean;
  /** A sentence about what just happened, e.g. after replacing everything; read out and shown under the rows. */
  message?: string;
}>(), { capped: false, invalid: false, readonly: false, message: '' });

const emit = defineEmits<{
  'update:query': [value: string];
  'update:replacement': [value: string];
  'update:matchCase': [value: boolean];
  'update:wholeWord': [value: boolean];
  'update:regex': [value: boolean];
  'update:preserveCase': [value: boolean];
  'update:replaceOpen': [value: boolean];
  /** Go to the next hit. */
  next: [];
  /** Go to the previous hit. */
  previous: [];
  /** Replace the current hit. */
  replace: [];
  /** Replace every hit. */
  replaceAll: [];
  /** Close the bar. */
  close: [];
}>();

const id = useId();
const searchField = ref<InstanceType<typeof AppTextField> | null>(null);
const replaceField = ref<InstanceType<typeof AppTextField> | null>(null);
defineExpose({
  /** Moves the focus to the search text and selects it. */
  focusSearch: (): void => { searchField.value?.focus(); searchField.value?.select(); },
  /** Moves the focus to the replacement text and selects it. */
  focusReplace: (): void => { replaceField.value?.focus(); replaceField.value?.select(); },
});

const searching = computed(() => props.query.length > 0 && !props.invalid);
const position = computed(() => (searching.value ? `${props.total ? props.current + 1 : 0}/${props.total}${props.capped ? '+' : ''}` : ''));
const spoken = computed(() => {
  if (props.invalid) return t('Der reguläre Ausdruck ist nicht lesbar.');
  if (!searching.value) return '';
  if (!props.total) return t('Keine Treffer');
  return props.capped
    ? t('Treffer {current} von mehr als {total}', { current: props.current + 1, total: props.total })
    : t('Treffer {current} von {total}', { current: props.current + 1, total: props.total });
});
const canReplace = computed(() => !props.readonly && searching.value && props.total > 0);

function step(back: boolean): void {
  if (back) emit('previous');
  else emit('next');
}
function onKeydown(event: KeyboardEvent): void {
  if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); emit('close'); }
  else if (event.key === 'F3') { event.preventDefault(); step(event.shiftKey); }
}
function onSearchKeydown(event: KeyboardEvent): void {
  if (event.key !== 'Enter' || event.isComposing) return;
  event.preventDefault();
  step(event.shiftKey);
}
function onReplaceKeydown(event: KeyboardEvent): void {
  if (event.key !== 'Enter' || event.isComposing) return;
  event.preventDefault();
  if (!canReplace.value) return;
  if (event.ctrlKey || event.metaKey) emit('replaceAll');
  else emit('replace');
}
</script>

<template>
  <div class="find-bar" role="search" :aria-label="replaceOpen ? t('Suchen und Ersetzen') : t('Suchen')" data-testid="find-bar" @keydown="onKeydown">
    <div class="find-row">
      <button type="button" class="find-toggle" data-testid="find-toggle-replace" :aria-expanded="replaceOpen" :aria-label="t('Ersetzen einblenden')" :title="replaceOpen ? t('Ersetzen ausblenden') : t('Ersetzen einblenden')" @click="emit('update:replaceOpen', !replaceOpen)">
        <AppIcon :name="replaceOpen ? 'chevron-down' : 'chevron-right'" :size="16" />
      </button>
      <div class="find-field" :class="{ invalid, empty: searching && !total }">
        <AppTextField
          ref="searchField" class="find-input" data-testid="find-query" :model-value="query" :invalid="invalid"
          :aria-label="t('Suchen')" :placeholder="t('Suchen')" :aria-describedby="`${id}-status`" autocomplete="off" autocapitalize="off" spellcheck="false"
          @update:model-value="emit('update:query', $event)" @keydown="onSearchKeydown"
        />
        <span v-if="position" class="find-count" data-testid="find-count" aria-hidden="true">{{ position }}</span>
        <AppButton class="find-option" data-testid="find-match-case" :aria-pressed="matchCase" :aria-label="t('Groß-/Kleinschreibung beachten')" :title="t('Groß-/Kleinschreibung beachten')" @click="emit('update:matchCase', !matchCase)">Aa</AppButton>
        <AppButton class="find-option" data-testid="find-whole-word" :aria-pressed="wholeWord" :aria-label="t('Nur ganze Wörter')" :title="t('Nur ganze Wörter')" @click="emit('update:wholeWord', !wholeWord)"><span class="word-glyph">W</span></AppButton>
        <AppButton class="find-option mono" data-testid="find-regex" :aria-pressed="regex" :aria-label="t('Regulärer Ausdruck')" :title="t('Regulärer Ausdruck')" @click="emit('update:regex', !regex)">.*</AppButton>
      </div>
      <AppIconButton class="find-nav" icon="arrow-up" :icon-size="16" data-testid="find-previous" :label="t('Vorheriger Treffer')" :disabled="!total" @click="emit('previous')" />
      <AppIconButton class="find-nav" icon="arrow-down" :icon-size="16" data-testid="find-next" :label="t('Nächster Treffer')" :disabled="!total" @click="emit('next')" />
      <AppIconButton class="find-nav" icon="close" :icon-size="16" data-testid="find-close" :label="t('Suche schließen')" @click="emit('close')" />
    </div>
    <div v-if="replaceOpen" class="find-row">
      <span class="find-toggle-space" aria-hidden="true" />
      <div class="find-field">
        <AppTextField
          ref="replaceField" class="find-input" data-testid="find-replacement" :model-value="replacement" :readonly="readonly"
          :aria-label="t('Ersetzen durch')" :placeholder="t('Ersetzen durch')" autocomplete="off" autocapitalize="off" spellcheck="false"
          @update:model-value="emit('update:replacement', $event)" @keydown="onReplaceKeydown"
        />
        <AppButton class="find-option" data-testid="find-preserve-case" :aria-pressed="preserveCase" :aria-label="t('Schreibweise beibehalten')" :title="t('Schreibweise beibehalten')" @click="emit('update:preserveCase', !preserveCase)">AA</AppButton>
      </div>
      <AppButton class="find-action" data-testid="find-replace" :disabled="!canReplace" @click="emit('replace')">{{ t('Ersetzen') }}</AppButton>
      <AppButton class="find-action" data-testid="find-replace-all" :disabled="!canReplace" @click="emit('replaceAll')">{{ t('Alle ersetzen') }}</AppButton>
    </div>
    <p v-if="invalid || message" class="find-note" :class="{ problem: invalid }" data-testid="find-note">{{ invalid ? t('Der reguläre Ausdruck ist nicht lesbar.') : message }}</p>
    <p :id="`${id}-status`" class="visually-hidden" role="status" aria-live="polite">{{ message || spoken }}</p>
  </div>
</template>

<style scoped>
.find-bar{display:grid;gap:6px;padding:8px;border:1px solid var(--border-subtle);border-radius:12px;background:var(--surface-raised)}
.find-row{display:flex;min-width:0;align-items:center;gap:4px}
.find-toggle,.find-toggle-space{flex:none;width:24px;height:32px}
.find-toggle{display:grid;padding:0;place-items:center;border:0;border-radius:8px;background:transparent;color:var(--text-muted);cursor:pointer}
.find-toggle:hover{background:var(--surface-panel);color:var(--text-primary)}
.find-toggle:focus-visible{outline:2px solid var(--focus-ring);outline-offset:-2px}
.find-field{display:flex;flex:1;min-width:0;height:32px;align-items:center;gap:2px;padding:0 3px 0 4px;border:1px solid var(--border-default);border-radius:8px;background:var(--surface-panel)}
.find-field:focus-within{border-color:var(--accent);box-shadow:0 0 0 2px var(--accent-soft)}
.find-field.invalid{border-color:var(--status-error)}
.find-input{flex:1;width:auto;min-width:0;min-height:0;height:100%;padding:0 4px;border:0;border-radius:6px;outline:0;background:transparent;box-shadow:none;font-size:13px}
.find-input[aria-invalid='true']{border:0;box-shadow:none}
.find-count{flex:none;padding:0 4px;color:var(--text-muted);font-size:12px;font-variant-numeric:tabular-nums;white-space:nowrap}
.find-field.empty .find-count{color:var(--status-error)}
.find-option{flex:none;min-width:26px;min-height:24px;height:24px;padding:0 4px;border-color:transparent;border-radius:6px;background:transparent;color:var(--text-muted);font-size:12px;font-weight:650;line-height:1}
.find-option.mono{font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;font-size:13px}
.word-glyph{padding:0 2px;border-bottom:2px solid currentColor;line-height:1.1}
.find-nav{flex:none;width:30px;height:32px;min-width:0;min-height:0}
.find-action{flex:none;padding:0 10px;font-size:12px;white-space:nowrap}
.find-note{margin:0 0 0 28px;color:var(--text-muted);font-size:12px;line-height:1.4}
.find-note.problem{color:var(--status-error)}
@media(max-width:760px){
  .find-toggle,.find-toggle-space{height:40px}
  .find-field{height:40px}
  .find-option{min-width:32px;height:32px}
  .find-nav{width:36px;height:40px}
  .find-action{min-height:40px}
}
@media(forced-colors:active){.find-field:focus-within{outline:2px solid Highlight}}
</style>

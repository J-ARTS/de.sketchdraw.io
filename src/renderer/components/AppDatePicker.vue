<script setup lang="ts">
import { t } from '@/renderer/i18n';
import { computed, nextTick, ref, useId, watch } from 'vue';
import { useEventListener } from '@vueuse/core';
import AppIcon from './AppIcon.vue';
import { useAnchoredPopover } from './use-anchored-popover';
import { addDays, addMonths, formatDate, formatLongDate, formatMonth, monthGrid, parseIsoDate, todayIso, weekdayLabels } from '../lib/calendar';

/** Date field with a calendar popover (ISO value `YYYY-MM-DD`, empty = no date); replaces <input type="date">. */
const props = defineProps<{ modelValue: string; label: string; disabled?: boolean }>();
const emit = defineEmits<{ 'update:modelValue': [value: string] }>();

const uid = useId();
const labelId = `${uid}-label`; const panelId = `${uid}-panel`; const titleId = `${uid}-title`;
const open = ref(false);
const trigger = ref<HTMLButtonElement | null>(null);
const panel = ref<HTMLElement | null>(null);
const { style, show } = useAnchoredPopover(trigger, panel, () => open.value, 300);
/** The day that owns keyboard focus (roving tabindex); its month is the visible one. */
const focusDay = ref(todayIso());
const today = computed(() => todayIso());
const selected = computed(() => parseIsoDate(props.modelValue)?.iso ?? '');
const grid = computed(() => monthGrid(focusDay.value));
const month = computed(() => parseIsoDate(focusDay.value)!.month);
const weekdays = computed(() => weekdayLabels());
const display = computed(() => formatDate(props.modelValue));

watch(() => props.modelValue, () => { if (!open.value && selected.value) focusDay.value = selected.value; });

async function openPanel(): Promise<void> {
  if (props.disabled) return;
  focusDay.value = selected.value || todayIso();
  open.value = true;
  await show();
  focusCell();
}
function closePanel(returnFocus = true): void { open.value = false; if (returnFocus) trigger.value?.focus(); }
function focusCell(): void { void nextTick(() => panel.value?.querySelector<HTMLElement>(`[data-date="${focusDay.value}"]`)?.focus()); }
function pick(iso: string): void { emit('update:modelValue', iso); closePanel(); }
function clear(): void { emit('update:modelValue', ''); closePanel(); }
function goTo(iso: string): void { focusDay.value = iso; focusCell(); void show(); }
function onCellKeydown(event: KeyboardEvent): void {
  const moves: Record<string, string> = {
    ArrowLeft: addDays(focusDay.value, -1), ArrowRight: addDays(focusDay.value, 1),
    ArrowUp: addDays(focusDay.value, -7), ArrowDown: addDays(focusDay.value, 7),
    PageUp: addMonths(focusDay.value, event.shiftKey ? -12 : -1), PageDown: addMonths(focusDay.value, event.shiftKey ? 12 : 1),
  };
  const iso = event.key === 'Home' ? addDays(focusDay.value, -weekdayLabelsIndex(focusDay.value)) : event.key === 'End' ? addDays(focusDay.value, 6 - weekdayLabelsIndex(focusDay.value)) : moves[event.key];
  if (!iso) return;
  event.preventDefault(); event.stopPropagation();
  goTo(iso);
}
function weekdayLabelsIndex(iso: string): number { return grid.value.flat().findIndex((day) => day.iso === iso) % 7; }
function onPanelKeydown(event: KeyboardEvent): void {
  if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); closePanel(); }
  else if (event.key === 'Tab') {
    const items = Array.from(panel.value?.querySelectorAll<HTMLElement>('button:not(:disabled)') ?? []).filter((item) => item.tabIndex >= 0);
    const first = items[0]; const last = items.at(-1);
    if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
    else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
  }
}
function onTriggerKeydown(event: KeyboardEvent): void {
  if (event.key === 'ArrowDown' || event.key === 'F4') { event.preventDefault(); void openPanel(); }
  else if (event.key === 'Escape' && open.value) { event.preventDefault(); event.stopPropagation(); closePanel(); }
}
useEventListener(document, 'pointerdown', (event: PointerEvent) => {
  if (open.value && event.target instanceof Node && !trigger.value?.contains(event.target) && !panel.value?.contains(event.target)) closePanel(false);
}, true);
</script>

<template>
  <div class="app-field">
    <span :id="labelId" class="app-field-label">{{ label }}</span>
    <button
      ref="trigger"
      type="button"
      class="app-date"
      aria-haspopup="dialog"
      :aria-expanded="open"
      :aria-controls="open ? panelId : undefined"
      :aria-labelledby="`${labelId} ${uid}-value`"
      :disabled="disabled"
      @click="open ? closePanel() : openPanel()"
      @keydown="onTriggerKeydown"
    >
      <span :id="`${uid}-value`" class="app-date-value" :class="{ empty: !display }">{{ display || t('Datum wählen') }}</span>
      <AppIcon name="calendar" :size="18" class="app-date-icon" />
    </button>
    <div v-if="open" :id="panelId" ref="panel" class="app-popover app-calendar" role="dialog" :aria-labelledby="titleId" :style="style" @keydown="onPanelKeydown">
      <div class="calendar-head">
        <button type="button" class="calendar-nav" :aria-label="t('Vorheriger Monat')" @click="goTo(addMonths(focusDay, -1))"><AppIcon name="chevron-left" :size="18" /></button>
        <h3 :id="titleId" class="calendar-title" aria-live="polite">{{ formatMonth(focusDay) }}</h3>
        <button type="button" class="calendar-nav" :aria-label="t('Nächster Monat')" @click="goTo(addMonths(focusDay, 1))"><AppIcon name="chevron-right" :size="18" /></button>
      </div>
      <div class="calendar-grid" role="grid" :aria-labelledby="titleId">
        <div class="calendar-row" role="row"><span v-for="weekday in weekdays" :key="weekday.long" class="calendar-weekday" role="columnheader" :abbr="weekday.long">{{ weekday.short }}</span></div>
        <div v-for="(week, index) in grid" :key="index" class="calendar-row" role="row">
          <span v-for="day in week" :key="day.iso" role="gridcell" :aria-selected="day.iso === selected">
            <button
              type="button"
              class="calendar-day"
              :class="{ outside: day.month !== month, today: day.iso === today, selected: day.iso === selected }"
              :data-date="day.iso"
              :tabindex="day.iso === focusDay ? 0 : -1"
              :aria-label="formatLongDate(day.iso)"
              :aria-current="day.iso === today ? 'date' : undefined"
              @keydown="onCellKeydown"
              @click="pick(day.iso)"
            >{{ day.day }}</button>
          </span>
        </div>
      </div>
      <div class="calendar-foot">
        <button type="button" class="calendar-link" @click="pick(todayIso())">{{ t('Heute') }}</button>
        <button type="button" class="calendar-link" :disabled="!selected" @click="clear">{{ t('Datum entfernen') }}</button>
      </div>
    </div>
  </div>
</template>

<style scoped>
.app-field{display:grid;gap:6px;min-width:0}
.app-field-label{color:var(--text-muted);font-size:12px}
.app-date{display:flex;align-items:center;justify-content:space-between;gap:8px;width:100%;min-height:42px;padding:9px 10px;border:1px solid var(--border-subtle);border-radius:9px;background:var(--surface-raised);color:var(--text-primary);font:inherit;font-size:14px;text-align:left;cursor:pointer}
.app-date:hover:not(:disabled){border-color:var(--border-default)}
.app-date:focus-visible,.app-date[aria-expanded='true']{outline:2px solid var(--focus-ring);outline-offset:1px;border-color:var(--accent)}
.app-date:disabled{opacity:.5;cursor:not-allowed}
.app-date-value.empty{color:var(--text-muted)}
.app-date-icon{flex:none;color:var(--text-muted)}
.app-popover{position:fixed;z-index:50;margin:0;padding:12px;overflow:auto;border:1px solid var(--border-subtle);border-radius:var(--radius-2);background:var(--menu-surface);box-shadow:var(--shadow-panel);color:var(--menu-text)}
.calendar-head{display:flex;align-items:center;justify-content:space-between;gap:8px;margin-bottom:8px}
.calendar-title{margin:0;font-size:14px;font-weight:650;text-transform:capitalize}
.calendar-nav{display:grid;place-items:center;width:32px;height:32px;padding:0;border:0;border-radius:8px;background:transparent;color:var(--menu-text);cursor:pointer}
.calendar-nav:hover{background:var(--menu-hover)}
.calendar-grid{display:grid;gap:2px}
.calendar-row{display:grid;grid-template-columns:repeat(7,1fr);gap:2px;justify-items:center}
.calendar-weekday{display:grid;place-items:center;width:100%;height:28px;color:var(--menu-muted);font-size:11px;font-weight:650}
.calendar-day{display:grid;place-items:center;width:36px;height:36px;padding:0;border:0;border-radius:50%;background:transparent;color:var(--menu-text);font:inherit;font-size:13px;font-variant-numeric:tabular-nums;cursor:pointer}
.calendar-day:hover{background:var(--menu-hover)}
.calendar-day.outside{color:var(--menu-muted)}
.calendar-day.today{box-shadow:inset 0 0 0 1.5px var(--accent)}
.calendar-day.selected{background:var(--accent);color:var(--accent-contrast);font-weight:650}
.calendar-day:focus-visible,.calendar-nav:focus-visible,.calendar-link:focus-visible{outline:2px solid var(--menu-focus);outline-offset:1px}
.calendar-foot{display:flex;justify-content:space-between;gap:8px;margin-top:8px;padding-top:8px;border-top:1px solid var(--menu-separator)}
.calendar-link{min-height:32px;padding:0 8px;border:0;border-radius:8px;background:transparent;color:var(--accent-ink);font:inherit;font-size:13px;font-weight:600;cursor:pointer}
.calendar-link:hover:not(:disabled){background:var(--menu-hover)}
.calendar-link:disabled{color:var(--menu-muted);cursor:not-allowed}
@media(forced-colors:active){.calendar-day.selected{forced-color-adjust:none;background:Highlight;color:HighlightText}.calendar-day.today{outline:1px solid CanvasText}}
</style>

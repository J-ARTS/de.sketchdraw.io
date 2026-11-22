<!-- @component What makes a rectangle a ticket card on the canvas: tracker and key, state, title, assignee, estimate, labels and the time the ticket was last read. -->
<script setup lang="ts">
import { computed } from 'vue';
import { TICKET_PROVIDER_NAME, wrapTextLines, type SketchElement, type TaskStatus, type TicketCardData } from '@/domain';
import { fontFamilyCss } from '@/renderer/lib/constants';
import { intlLocale, t } from '@/renderer/i18n';
import { themeColor, type ThemeName } from '@/renderer/lib/theme';
import { ticketCardColors } from '@/renderer/lib/ticket-card-colors';

/**
 * The content of a ticket card (#283), drawn in the element's own coordinates on top of its rectangle. The card is
 * a drawing like any other: its colours follow the theme of the canvas like the rectangle underneath does
 * (`ticketCardColors`). Only the mark of the tracker keeps its colour.
 */
const props = defineProps<{
  /** The rectangle that carries the ticket. */
  element: SketchElement;
  /** The ticket as read from the element (`readTicketCard`). */
  ticket: TicketCardData;
  /** The theme of the canvas; the colours of the card follow it like those of every element. Default: light. */
  theme?: ThemeName;
}>();
const colors = computed(() => ticketCardColors(props.theme ?? 'light'));

const PAD = 16;
/** The title is written in the text colour of the rectangle when the user chose one. */
const ink = computed(() => props.element.style.textColor ? themeColor(props.element.style.textColor, props.theme ?? 'light') : colors.value.ink);
const BRAND: Readonly<Record<TicketCardData['provider'], { color: string; mark: string }>> = { jira: { color: '#1868db', mark: 'J' }, 'azure-devops': { color: '#0078d4', mark: 'Az' } };
const STATE_LABEL: Readonly<Record<TaskStatus, string>> = { todo: 'Offen', doing: 'In Arbeit', review: 'Prüfung', done: 'Erledigt' };
const e = computed(() => props.element);
const font = computed(() => fontFamilyCss(e.value.style.fontFamily));
const width = computed(() => e.value.width);
const brand = computed(() => BRAND[props.ticket.provider]);
const clamp = (text: string, size: number, room: number): string => {
  const max = Math.max(1, Math.floor(room / (size * 0.56)));
  const chars = Array.from(text);
  return chars.length > max ? `${chars.slice(0, Math.max(1, max - 1)).join('')}…` : text;
};
/** The state as the tracker names it; the colour says which of the four columns it stands for. */
const state = computed(() => {
  const look = colors.value.state[props.ticket.status];
  const label = clamp(props.ticket.remoteStatus || t(STATE_LABEL[props.ticket.status]), 11, Math.max(40, width.value * 0.42));
  const chipWidth = Math.min(width.value - 2 * PAD, Array.from(label).length * 11 * 0.6 + 18);
  return { ...look, label, width: chipWidth, x: width.value - PAD - chipWidth };
});
const keyLabel = computed(() => clamp(props.ticket.provider === 'azure-devops' ? `#${props.ticket.key}` : props.ticket.key, 13, Math.max(20, state.value.x - PAD - 34)));
const titleLines = computed(() => wrapTextLines(props.ticket.title || t('Ohne Titel'), width.value, 16, 2 * PAD).slice(0, 2).map((line, index, all) => index === 1 && wrapTextLines(props.ticket.title, width.value, 16, 2 * PAD).length > all.length ? `${clamp(line.text, 16, width.value - 2 * PAD - 12)}…` : line.text));
const meta = computed(() => {
  const parts = [props.ticket.assignee || t('Niemand zugewiesen'), ...(props.ticket.estimate ? [t('Schätzung: {estimate}', { estimate: props.ticket.estimate })] : [])];
  return clamp(parts.join('  ·  '), 12.5, width.value - 2 * PAD);
});
/** Labels first, then components; as many as fit in one row, the rest as a count. */
const chips = computed(() => {
  const all = [...props.ticket.labels.map((text) => ({ text, component: false })), ...props.ticket.components.map((text) => ({ text, component: true }))];
  const shown: Array<{ text: string; component: boolean; x: number; width: number }> = [];
  let x = PAD; const room = width.value - PAD;
  for (const entry of all) {
    const text = clamp(entry.text, 11, 120);
    const chip = Array.from(text).length * 11 * 0.6 + 16;
    if (x + chip > room - (shown.length < all.length - 1 ? 34 : 0)) break;
    shown.push({ text, component: entry.component, x, width: chip }); x += chip + 6;
  }
  return { shown, more: all.length - shown.length, moreX: x };
});
const fetched = computed(() => {
  const time = Date.parse(props.ticket.fetchedAt);
  if (!Number.isFinite(time)) return t('Noch nicht abgerufen');
  return t('Abgerufen {when}', { when: new Intl.DateTimeFormat(intlLocale(), { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' }).format(time) });
});
const footerY = computed(() => e.value.height - 14);
const chipY = computed(() => footerY.value - 36);
</script>

<template>
  <g class="ticket-card" data-testid="ticket-card" pointer-events="none" :font-family="font">
    <rect :x="PAD" y="14" width="22" height="22" rx="6" :fill="brand.color" />
    <text :x="PAD + 11" y="25" fill="#ffffff" font-size="10.5" font-weight="700" text-anchor="middle" dominant-baseline="central">{{ brand.mark }}</text>
    <text data-testid="ticket-card-key" :x="PAD + 30" y="25" :fill="colors.muted" font-size="13" font-weight="650" dominant-baseline="central">{{ keyLabel }}<title>{{ TICKET_PROVIDER_NAME[ticket.provider] }} {{ ticket.key }}</title></text>
    <rect :x="state.x" y="14" :width="state.width" height="22" rx="11" :fill="state.fill" />
    <text data-testid="ticket-card-status" :x="state.x + state.width / 2" y="25" :fill="state.ink" font-size="11" font-weight="650" text-anchor="middle" dominant-baseline="central">{{ state.label }}</text>
    <text data-testid="ticket-card-title" :fill="ink" font-size="16" font-weight="600"><tspan v-for="(line, index) in titleLines" :key="index" :x="PAD" :y="62 + index * 21">{{ line }}</tspan></text>
    <text data-testid="ticket-card-meta" :x="PAD" :y="62 + titleLines.length * 21 + 4" :fill="colors.muted" font-size="12.5" font-weight="500">{{ meta }}</text>
    <g v-if="chips.shown.length || chips.more" data-testid="ticket-card-labels">
      <template v-for="chip in chips.shown" :key="`${chip.component}:${chip.text}`">
        <rect :x="chip.x" :y="chipY" :width="chip.width" height="20" rx="6" :fill="(chip.component ? colors.component : colors.label).fill" />
        <text :x="chip.x + chip.width / 2" :y="chipY + 10" :fill="(chip.component ? colors.component : colors.label).ink" font-size="11" font-weight="550" text-anchor="middle" dominant-baseline="central">{{ chip.text }}</text>
      </template>
      <text v-if="chips.more > 0" :x="chips.moreX + 2" :y="chipY + 10" :fill="colors.muted" font-size="11" font-weight="600" dominant-baseline="central">+{{ chips.more }}</text>
    </g>
    <text data-testid="ticket-card-fetched" :x="PAD" :y="footerY" :fill="colors.muted" font-size="10.5" dominant-baseline="central">{{ fetched }}</text>
  </g>
</template>

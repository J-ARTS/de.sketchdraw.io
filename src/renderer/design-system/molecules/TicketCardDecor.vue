<!-- @component What makes a rectangle a ticket card on the canvas: tracker and key, state, title, assignee, estimate, labels and the time the ticket was last read. -->
<script setup lang="ts">
import { computed } from 'vue';
import { TICKET_CARD_TYPE as TYPE, TICKET_PROVIDER_NAME, ticketCardLayout, type SketchElement, type TicketCardData } from '@/domain';
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

/** The title is written in the text colour of the rectangle when the user chose one. */
const ink = computed(() => props.element.style.textColor ? themeColor(props.element.style.textColor, props.theme ?? 'light') : colors.value.ink);
const font = computed(() => fontFamilyCss(props.element.style.fontFamily));
/** The same layout the SVG export draws from; only the words are translated here. */
const layout = computed(() => ticketCardLayout(props.element, props.ticket, {
  untitled: t('Ohne Titel'), unassigned: t('Niemand zugewiesen'), estimate: (estimate) => t('Schätzung: {estimate}', { estimate }),
  state: { todo: t('Offen'), doing: t('In Arbeit'), review: t('Prüfung'), done: t('Erledigt') },
}));
const stateTone = computed(() => colors.value.state[layout.value.state.status]);
const fetched = computed(() => {
  const time = Date.parse(props.ticket.fetchedAt);
  if (!Number.isFinite(time)) return t('Noch nicht abgerufen');
  return t('Abgerufen {when}', { when: new Intl.DateTimeFormat(intlLocale(), { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' }).format(time) });
});
</script>

<template>
  <g class="ticket-card" data-testid="ticket-card" pointer-events="none" :font-family="font">
    <rect :x="layout.mark.x" :y="layout.mark.y" :width="layout.mark.size" :height="layout.mark.size" rx="6" :fill="layout.mark.color" />
    <text :x="layout.mark.x + layout.mark.size / 2" :y="layout.key.y" fill="#ffffff" :font-size="TYPE.mark" font-weight="700" text-anchor="middle" dominant-baseline="central">{{ layout.mark.text }}</text>
    <text data-testid="ticket-card-key" :x="layout.key.x" :y="layout.key.y" :fill="colors.muted" :font-size="TYPE.key" font-weight="650" dominant-baseline="central">{{ layout.key.text }}<title>{{ TICKET_PROVIDER_NAME[ticket.provider] }} {{ ticket.key }}</title></text>
    <rect :x="layout.state.x" :y="layout.state.y" :width="layout.state.width" :height="layout.state.height" rx="11" :fill="stateTone.fill" />
    <text data-testid="ticket-card-status" :x="layout.state.x + layout.state.width / 2" :y="layout.key.y" :fill="stateTone.ink" :font-size="TYPE.state" font-weight="650" text-anchor="middle" dominant-baseline="central">{{ layout.state.label }}</text>
    <text data-testid="ticket-card-title" :fill="ink" :font-size="TYPE.title" font-weight="600"><tspan v-for="(line, index) in layout.title" :key="index" :x="line.x" :y="line.y">{{ line.text }}</tspan></text>
    <text data-testid="ticket-card-meta" :x="layout.meta.x" :y="layout.meta.y" :fill="colors.muted" :font-size="TYPE.meta" font-weight="500">{{ layout.meta.text }}</text>
    <g v-if="layout.chips.shown.length || layout.chips.more" data-testid="ticket-card-labels">
      <template v-for="chip in layout.chips.shown" :key="`${chip.component}:${chip.text}`">
        <rect :x="chip.x" :y="layout.chips.y" :width="chip.width" :height="layout.chips.height" rx="6" :fill="(chip.component ? colors.component : colors.label).fill" />
        <text :x="chip.x + chip.width / 2" :y="layout.chips.y + layout.chips.height / 2" :fill="(chip.component ? colors.component : colors.label).ink" :font-size="TYPE.chip" font-weight="550" text-anchor="middle" dominant-baseline="central">{{ chip.text }}</text>
      </template>
      <text v-if="layout.chips.more > 0" :x="layout.chips.moreX + 2" :y="layout.chips.y + layout.chips.height / 2" :fill="colors.muted" :font-size="TYPE.chip" font-weight="600" dominant-baseline="central">+{{ layout.chips.more }}</text>
    </g>
    <text data-testid="ticket-card-fetched" :x="layout.footer.x" :y="layout.footer.y" :fill="colors.muted" :font-size="TYPE.footer" dominant-baseline="central">{{ fetched }}</text>
  </g>
</template>

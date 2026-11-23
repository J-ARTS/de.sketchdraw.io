import { wrapTextLines } from './text-layout';
import type { TicketCardData } from './ticket-card';
import type { SketchElement, TaskStatus } from './types';

/**
 * Where everything of a ticket card stands (#283), in the coordinates of its rectangle. The canvas and the SVG
 * export both draw from this layout, so an exported card is the card of the canvas.
 */
export interface TicketCardChip { text: string; component: boolean; x: number; width: number }
export interface TicketCardLayout {
  mark: { x: number; y: number; size: number; color: string; text: string };
  key: { x: number; y: number; text: string };
  state: { x: number; y: number; width: number; height: number; label: string; status: TaskStatus };
  title: Array<{ x: number; y: number; text: string }>;
  meta: { x: number; y: number; text: string };
  chips: { y: number; height: number; shown: TicketCardChip[]; more: number; moreX: number };
  footer: { x: number; y: number };
}
/** The words of a card that are not content of the ticket; the canvas translates them, the export keeps them fixed. */
export interface TicketCardWords { untitled: string; unassigned: string; estimate: (value: string) => string; state: Readonly<Record<TaskStatus, string>> }
export const TICKET_CARD_WORDS: TicketCardWords = Object.freeze({
  untitled: 'Ohne Titel', unassigned: 'Niemand zugewiesen', estimate: (value: string) => `Schätzung: ${value}`,
  state: Object.freeze({ todo: 'Offen', doing: 'In Arbeit', review: 'Prüfung', done: 'Erledigt' }),
});

export interface TicketChipTone { fill: string; ink: string }
export interface TicketCardPalette {
  /** The fill a new card gets; the rectangle underneath is drawn with the user's own fill. */
  surface: string;
  /** Title, unless the rectangle has a text colour of its own. */
  ink: string;
  /** Key, assignee, estimate and the time of the last read. */
  muted: string;
  state: Readonly<Record<TaskStatus, TicketChipTone>>;
  label: TicketChipTone;
  component: TicketChipTone;
}
/** The colours of a card on the light canvas and in every export. */
export const TICKET_CARD_COLORS: TicketCardPalette = Object.freeze({
  surface: '#ffffff', ink: '#1e1e1e', muted: '#5f6b7a',
  state: Object.freeze({ todo: { fill: '#e9edf2', ink: '#3b4756' }, doing: { fill: '#dbe7ff', ink: '#1d4ed8' }, review: { fill: '#fdebc8', ink: '#8a5300' }, done: { fill: '#d6f2df', ink: '#17663a' } }),
  label: { fill: '#f1f3f6', ink: '#3b4756' }, component: { fill: '#eef0ff', ink: '#3b3fa8' },
});
export const TICKET_CARD_MARK: Readonly<Record<TicketCardData['provider'], { color: string; text: string }>> = Object.freeze({ jira: { color: '#1868db', text: 'J' }, 'azure-devops': { color: '#0078d4', text: 'Az' } });
export const TICKET_CARD_TYPE = Object.freeze({ mark: 10.5, key: 13, state: 11, title: 16, meta: 12.5, chip: 11, footer: 10.5 });

const PAD = 16;
/** Cuts a line that is longer than its room and marks the cut. Widths are estimated like everywhere on the canvas. */
function clamp(text: string, size: number, room: number): string {
  const max = Math.max(1, Math.floor(room / (size * 0.56)));
  const chars = Array.from(text);
  return chars.length > max ? `${chars.slice(0, Math.max(1, max - 1)).join('')}…` : text;
}

export function ticketCardLayout(element: Pick<SketchElement, 'width' | 'height'>, ticket: TicketCardData, words: TicketCardWords = TICKET_CARD_WORDS): TicketCardLayout {
  const width = element.width, type = TICKET_CARD_TYPE;
  // The state as the tracker names it; its colour says which of the four columns it stands for.
  const stateLabel = clamp(ticket.remoteStatus || words.state[ticket.status], type.state, Math.max(40, width * 0.42));
  const stateWidth = Math.min(width - 2 * PAD, Array.from(stateLabel).length * type.state * 0.6 + 18);
  const stateX = width - PAD - stateWidth;
  const keyText = clamp(ticket.provider === 'azure-devops' ? `#${ticket.key}` : ticket.key, type.key, Math.max(20, stateX - PAD - 34));
  // Two lines of title; a longer one is cut with a mark.
  const wrapped = wrapTextLines(ticket.title || words.untitled, width, type.title, 2 * PAD);
  const title = wrapped.slice(0, 2).map((line, index) => ({ x: PAD, y: 62 + index * 21, text: index === 1 && wrapped.length > 2 ? `${clamp(line.text, type.title, width - 2 * PAD - 12)}…` : line.text }));
  const meta = clamp([ticket.assignee || words.unassigned, ...(ticket.estimate ? [words.estimate(ticket.estimate)] : [])].join('  ·  '), type.meta, width - 2 * PAD);
  // Labels first, then components; as many as fit in one row, the rest as a count.
  const all = [...ticket.labels.map((text) => ({ text, component: false })), ...ticket.components.map((text) => ({ text, component: true }))];
  const shown: TicketCardChip[] = [];
  let x = PAD;
  for (const entry of all) {
    const text = clamp(entry.text, type.chip, 120);
    const chip = Array.from(text).length * type.chip * 0.6 + 16;
    if (x + chip > width - PAD - (shown.length < all.length - 1 ? 34 : 0)) break;
    shown.push({ text, component: entry.component, x, width: chip }); x += chip + 6;
  }
  const footerY = element.height - 14;
  return {
    mark: { x: PAD, y: 14, size: 22, ...TICKET_CARD_MARK[ticket.provider] },
    key: { x: PAD + 30, y: 25, text: keyText },
    state: { x: stateX, y: 14, width: stateWidth, height: 22, label: stateLabel, status: ticket.status },
    title, meta: { x: PAD, y: 62 + title.length * 21 + 4, text: meta },
    chips: { y: footerY - 36, height: 20, shown, more: all.length - shown.length, moreX: x },
    footer: { x: PAD, y: footerY },
  };
}

/** The time of the last read as an export writes it: the same text in every language and time zone. */
export function ticketCardFetchedText(fetchedAt: string): string {
  const time = Date.parse(fetchedAt);
  return Number.isFinite(time) ? `Stand ${new Date(time).toISOString().slice(0, 16).replace('T', ' ')} UTC` : '';
}

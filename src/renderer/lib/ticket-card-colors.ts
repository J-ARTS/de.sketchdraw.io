import { TICKET_CARD_COLORS, type TicketCardPalette } from '@/domain';
import { themeColor, type ThemeName } from './theme';

export type TicketCardColors = TicketCardPalette;
const LIGHT = TICKET_CARD_COLORS;
/**
 * Neutral colours follow the mapping of the canvas, so the card matches its rectangle in the dark theme. The
 * coloured chips have dark tones of their own: the general mapping leaves them below a readable contrast.
 */
const DARK: TicketCardColors = {
  surface: themeColor(LIGHT.surface, 'dark'), ink: themeColor(LIGHT.ink, 'dark'), muted: themeColor(LIGHT.muted, 'dark'),
  state: {
    todo: { fill: themeColor(LIGHT.state.todo.fill, 'dark'), ink: themeColor(LIGHT.state.todo.ink, 'dark') },
    doing: { fill: '#1c2f5c', ink: '#a9c3ff' }, review: { fill: '#4a3815', ink: '#ffd08a' }, done: { fill: '#1d3a28', ink: '#8fe0ae' },
  },
  label: { fill: themeColor(LIGHT.label.fill, 'dark'), ink: themeColor(LIGHT.label.ink, 'dark') }, component: { fill: '#1f2350', ink: '#b9bcff' },
};

/** The colours of a ticket card (#283) for the theme of the canvas. */
export function ticketCardColors(theme: ThemeName): TicketCardColors { return theme === 'dark' ? DARK : LIGHT; }

import type { TaskStatus } from '@/domain';
import { themeColor, type ThemeName } from './theme';

export interface ChipTone { fill: string; ink: string }
export interface TicketCardColors {
  /** The fill a new card gets; the rectangle underneath is drawn with the user's own fill. */
  surface: string;
  /** Title, unless the rectangle has a text colour of its own. */
  ink: string;
  /** Key, assignee, estimate and the time of the last read. */
  muted: string;
  state: Readonly<Record<TaskStatus, ChipTone>>;
  label: ChipTone;
  component: ChipTone;
}

const LIGHT: TicketCardColors = {
  surface: '#ffffff', ink: '#1e1e1e', muted: '#5f6b7a',
  state: { todo: { fill: '#e9edf2', ink: '#3b4756' }, doing: { fill: '#dbe7ff', ink: '#1d4ed8' }, review: { fill: '#fdebc8', ink: '#8a5300' }, done: { fill: '#d6f2df', ink: '#17663a' } },
  label: { fill: '#f1f3f6', ink: '#3b4756' }, component: { fill: '#eef0ff', ink: '#3b3fa8' },
};
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

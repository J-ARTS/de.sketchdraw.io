import type { Meta, StoryObj } from '@storybook/vue3-vite';
import TicketCardDecor from '@/renderer/design-system/molecules/TicketCardDecor.vue';
import { CANVAS_BACKGROUND, themeColor, type ThemeName } from '@/renderer/lib/theme';
import { createElement, TICKET_CARD_HEIGHT, TICKET_CARD_WIDTH, type TicketCardData } from '@/domain';

const ticket: TicketCardData = {
  provider: 'jira', key: 'SHOP-128', url: 'https://example.atlassian.net/browse/SHOP-128', title: 'Warenkorb übersteht den Wechsel des Geräts',
  description: 'Der Warenkorb wird am Konto gespeichert.', status: 'doing', remoteStatus: 'In Arbeit', assignee: 'Mara Lind',
  labels: ['checkout', 'q1'], components: ['Storefront'], estimate: '5', issueType: 'Story', fixVersions: ['2026.12'], fetchedAt: '2026-11-22T08:12:00.000Z',
};
const card = (width = TICKET_CARD_WIDTH, height = TICKET_CARD_HEIGHT) => createElement('rectangle', { id: 'card', x: 0, y: 0, width, height, text: ticket.title });

/** The drawing of a ticket card (#283). It sits in the coordinates of its rectangle, so the story supplies the rectangle the canvas would draw. */
const meta = {
  title: 'Molecules/TicketCardDecor',
  component: TicketCardDecor,
  args: { element: card(), ticket },
  render: (args) => ({
    components: { TicketCardDecor },
    setup: () => { const theme = (): ThemeName => (args.theme === 'dark' ? 'dark' : 'light'); return { args, surface: () => themeColor('#ffffff', theme()), edge: () => themeColor('#cbd5e1', theme()), canvas: () => CANVAS_BACKGROUND[theme()] }; },
    template: `<svg :width="args.element.width + 24" :height="args.element.height + 24" :style="{ display: 'block', background: canvas() }"><g transform="translate(12 12)"><rect :width="args.element.width" :height="args.element.height" rx="12" :fill="surface()" :stroke="edge()" stroke-width="1.5" /><TicketCardDecor v-bind="args" /></g></svg>`,
  }),
} satisfies Meta<typeof TicketCardDecor>;
export default meta;
type Story = StoryObj<typeof meta>;

export const Jira: Story = {};
/** Azure Boards names a work item by its number; the area path stands where Jira has components. */
export const AzureBoards: Story = { args: { ticket: { ...ticket, provider: 'azure-devops', key: '4711', url: 'https://dev.azure.com/example/Shop/_workitems/edit/4711', remoteStatus: 'Active', components: ['Shop\\Storefront'], estimate: '8', issueType: 'User Story', fixVersions: ['Shop\\Release 12\\Sprint 3'] } } };
/** Every type of ticket has its colour and its symbol. */
export const Bug: Story = { args: { ticket: { ...ticket, issueType: 'Bug', fixVersions: ['2026.11.1', '2026.12'] } } };
export const Epic: Story = { args: { ticket: { ...ticket, issueType: 'Epic' } } };
export const Task: Story = { args: { ticket: { ...ticket, issueType: 'Task', fixVersions: [] } } };
export const Feature: Story = { args: { ticket: { ...ticket, issueType: 'Feature' } } };
export const Subtask: Story = { args: { ticket: { ...ticket, issueType: 'Sub-task' } } };
/** A card that was read before types were keeps the mark of its tracker. */
export const WithoutType: Story = { args: { ticket: { ...ticket, issueType: '', fixVersions: [] } } };
export const Done: Story = { args: { ticket: { ...ticket, status: 'done', remoteStatus: 'Fertig' } } };
/** Nothing but a title: no assignee, no estimate, no labels. */
export const Bare: Story = { args: { ticket: { ...ticket, status: 'todo', remoteStatus: 'To Do', assignee: '', labels: [], components: [], estimate: '' } } };
/** A long title is cut after two lines; labels that do not fit become a count. */
export const Crowded: Story = { args: { ticket: { ...ticket, title: 'Referenzarchitektur für die Bestellstrecke mit Gateway, Identität, Zahlungsanbieter und Beobachtbarkeit abstimmen', status: 'review', remoteStatus: 'Wartet auf fachliche Abnahme', labels: ['checkout', 'architektur', 'zahlungsanbieter', 'q1', 'risiko'], components: ['Storefront', 'Payments'] } } };
/** Resized by the user: the content follows the width of the rectangle. */
export const Narrow: Story = { args: { element: card(220, 176) } };
/** On the dark canvas the card follows the theme like its rectangle does; the coloured chips have dark tones of their own. */
export const DarkCanvas: Story = { args: { theme: 'dark', ticket: { ...ticket, status: 'review', remoteStatus: 'In Review' } } };

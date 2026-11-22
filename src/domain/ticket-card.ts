import type { JiraIssueSummary, TicketProvider } from './plugins';
import type { SketchElement, TaskStatus } from './types';

/**
 * A ticket card (#283): a ticket from Jira or Azure Boards on the canvas. The card is a rectangle that carries the
 * content of its ticket: the title is its text, the description its description, everything else metadata. A
 * version of the app that does not know ticket cards shows the rectangle with the title, and the document needs
 * neither a plugin nor a connection to be read.
 */
export const TICKET_CARD = Object.freeze({
  provider: 'ticket:provider', key: 'ticket:key', url: 'ticket:url', status: 'ticket:status', remoteStatus: 'ticket:remote-status',
  assignee: 'ticket:assignee', labels: 'ticket:labels', components: 'ticket:components', estimate: 'ticket:estimate', fetchedAt: 'ticket:fetched-at',
});
export const TICKET_CARD_WIDTH = 320;
export const TICKET_CARD_HEIGHT = 176;
const STATUSES: readonly TaskStatus[] = ['todo', 'doing', 'review', 'done'];
const MAX_LIST = 50;

export interface TicketCardData {
  provider: TicketProvider;
  key: string;
  url: string;
  title: string;
  description: string;
  status: TaskStatus;
  /** The name of the state in the tracker, for example "In Progress". */
  remoteStatus: string;
  assignee: string;
  labels: string[];
  components: string[];
  estimate: string;
  /** When the content was last read from the tracker (ISO time); empty when it never was. */
  fetchedAt: string;
}

type Carrier = Pick<SketchElement, 'kind' | 'metadata'> | null | undefined;
export function isTicketCard(element: Carrier): boolean {
  const provider = element?.metadata?.[TICKET_CARD.provider];
  return element?.kind === 'rectangle' && (provider === 'jira' || provider === 'azure-devops') && Boolean(element.metadata?.[TICKET_CARD.key]);
}

function list(value: string | undefined): string[] {
  if (!value) return [];
  try { const parsed: unknown = JSON.parse(value); return Array.isArray(parsed) ? parsed.filter((entry): entry is string => typeof entry === 'string' && entry.trim() !== '').slice(0, MAX_LIST) : []; }
  catch { return []; }
}

/** The ticket a card shows, or null for any other element. Missing or damaged entries read as empty. */
export function readTicketCard(element: (Pick<SketchElement, 'kind' | 'metadata' | 'text' | 'description'>) | null | undefined): TicketCardData | null {
  if (!element || !isTicketCard(element)) return null;
  const metadata = element.metadata ?? {};
  const status = metadata[TICKET_CARD.status] as TaskStatus;
  return {
    provider: metadata[TICKET_CARD.provider] as TicketProvider, key: metadata[TICKET_CARD.key]!, url: metadata[TICKET_CARD.url] ?? '',
    title: element.text ?? '', description: element.description ?? '',
    status: STATUSES.includes(status) ? status : 'todo', remoteStatus: metadata[TICKET_CARD.remoteStatus] ?? '',
    assignee: metadata[TICKET_CARD.assignee] ?? '', labels: list(metadata[TICKET_CARD.labels]), components: list(metadata[TICKET_CARD.components]),
    estimate: metadata[TICKET_CARD.estimate] ?? '', fetchedAt: metadata[TICKET_CARD.fetchedAt] ?? '',
  };
}

/**
 * The content of a ticket as the patch of its card: text, description and metadata. An empty entry removes its
 * metadata key (null), so a card never keeps what the ticket no longer has.
 */
export function ticketCardPatch(provider: TicketProvider, ticket: JiraIssueSummary, fetchedAt: string): { text: string; description: string | null; metadata: Record<string, string | null> } {
  const labels = (ticket.labels ?? []).slice(0, MAX_LIST), components = (ticket.components ?? []).slice(0, MAX_LIST);
  return {
    text: ticket.title, description: ticket.description || null,
    metadata: {
      [TICKET_CARD.provider]: provider, [TICKET_CARD.key]: ticket.key, [TICKET_CARD.url]: ticket.url,
      [TICKET_CARD.status]: ticket.status, [TICKET_CARD.remoteStatus]: ticket.remoteStatus || null,
      [TICKET_CARD.assignee]: ticket.assignee || null,
      [TICKET_CARD.labels]: labels.length ? JSON.stringify(labels) : null,
      [TICKET_CARD.components]: components.length ? JSON.stringify(components) : null,
      [TICKET_CARD.estimate]: ticket.estimate || null,
      [TICKET_CARD.fetchedAt]: fetchedAt,
    },
  };
}

/**
 * The ticket an address names, when it lies under the address of a connected tracker: `…/browse/KEY-1` of the Jira
 * site, `…/_workitems/edit/12` of the Azure DevOps organization or collection. Any other address is no ticket.
 */
export function parseTicketUrl(value: string, sites: { jira?: string; azureDevOps?: string }): { provider: TicketProvider; key: string } | null {
  const text = value.trim();
  if (!/^https:\/\/\S+$/i.test(text) || text.length > 2048) return null;
  const under = (site: string | undefined) => Boolean(site) && text.toLowerCase().startsWith(`${site!.replace(/\/+$/, '').toLowerCase()}/`);
  if (under(sites.jira)) {
    const key = /\/browse\/([A-Za-z][A-Za-z0-9_]*-\d+)(?:[/?#]|$)/.exec(text)?.[1] ?? /[?&]selectedIssue=([A-Za-z][A-Za-z0-9_]*-\d+)(?:[&#]|$)/.exec(text)?.[1];
    if (key) return { provider: 'jira', key: key.toUpperCase() };
  }
  if (under(sites.azureDevOps)) {
    const id = /\/_workitems\/edit\/(\d{1,12})(?:[/?#]|$)/.exec(text)?.[1] ?? /[?&]workitem=(\d{1,12})(?:[&#]|$)/i.exec(text)?.[1];
    if (id) return { provider: 'azure-devops', key: id };
  }
  return null;
}

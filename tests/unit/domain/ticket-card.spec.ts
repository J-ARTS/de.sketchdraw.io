import { describe, expect, it } from 'vitest';
import { createDocument, createElement, isTicketCard, deserializeDocument, parseTicketUrl, readTicketCard, serializeDocument, TICKET_CARD, TICKET_TYPE_STYLE, ticketCardLayout, ticketCardPatch, ticketCardPatchChanges, ticketTypeKind, type JiraIssueSummary } from '@/domain';

const ticket: JiraIssueSummary = {
  id: '100', key: 'SHOP-128', title: 'Warenkorb sichern', description: 'Am Konto speichern.', status: 'doing', remoteStatus: 'In Progress', assignee: 'Mara Lind',
  labels: ['checkout', 'q1'], components: ['Storefront'], estimate: '5', issueType: 'Story', fixVersions: ['2026.12', '2027.1'], url: 'https://example.atlassian.net/browse/SHOP-128', updatedAt: '2026-11-22T08:00:00.000Z',
};
function card(provider: 'jira' | 'azure-devops' = 'jira', source: JiraIssueSummary = ticket) {
  const patch = ticketCardPatch(provider, source, '2026-11-22T09:00:00.000Z');
  const metadata = Object.fromEntries(Object.entries(patch.metadata).filter((entry): entry is [string, string] => entry[1] !== null));
  return createElement('rectangle', { id: 'card', x: 0, y: 0, width: 320, height: 176, text: patch.text, ...(patch.description ? { description: patch.description } : {}), metadata });
}

describe('ticket cards (#283)', () => {
  it('carries title, status, description, assignee, labels, components and estimate in a rectangle', () => {
    const element = card();
    expect(element.kind).toBe('rectangle');
    expect(isTicketCard(element)).toBe(true);
    expect(readTicketCard(element)).toEqual({
      provider: 'jira', key: 'SHOP-128', url: 'https://example.atlassian.net/browse/SHOP-128', title: 'Warenkorb sichern', description: 'Am Konto speichern.',
      status: 'doing', remoteStatus: 'In Progress', assignee: 'Mara Lind', labels: ['checkout', 'q1'], components: ['Storefront'], estimate: '5', issueType: 'Story', fixVersions: ['2026.12', '2027.1'], fetchedAt: '2026-11-22T09:00:00.000Z',
    });
  });

  it('gives every type of ticket its colour and symbol and names the fix versions', () => {
    for (const [name, kind] of [['Bug', 'bug'], ['Fehler', 'bug'], ['Story', 'story'], ['User Story', 'story'], ['Product Backlog Item', 'story'], ['Task', 'task'], ['Aufgabe', 'task'], ['Sub-task', 'subtask'], ['Subtask', 'subtask'], ['Unteraufgabe', 'subtask'], ['Epic', 'epic'], ['Feature', 'feature'], ['Improvement', 'improvement'], ['Spike', 'other']] as const) expect(ticketTypeKind(name), name).toBe(kind);
    const element = card();
    const layout = ticketCardLayout(element, readTicketCard(element)!);
    expect(layout.mark).toMatchObject({ color: TICKET_TYPE_STYLE.story.color, text: '', label: 'Story', shapes: TICKET_TYPE_STYLE.story.shapes });
    expect(layout.accent).toEqual({ x: 0, y: 12, width: 4, height: 152, color: TICKET_TYPE_STYLE.story.color });
    expect(layout.footer.text).toBe('Fix Version: 2026.12, 2027.1');
    // Azure Boards has no fix version; its iteration stands in the same place.
    const azure = card('azure-devops', { ...ticket, key: '4711', issueType: 'Bug', fixVersions: ['Shop\\Release 12'] });
    const azureLayout = ticketCardLayout(azure, readTicketCard(azure)!);
    expect(azureLayout.mark.color).toBe(TICKET_TYPE_STYLE.bug.color);
    expect(azureLayout.footer.text).toBe('Iteration: Shop\\Release 12');
    // A card that was read before types were keeps the mark of its tracker and shows no stripe and no empty line.
    const old = card('jira', { ...ticket, issueType: undefined, fixVersions: undefined });
    const oldLayout = ticketCardLayout(old, readTicketCard(old)!);
    expect(oldLayout.mark).toMatchObject({ text: 'J', shapes: [] }); expect(oldLayout.accent).toBeNull(); expect(oldLayout.footer.text).toBe('');
  });

  it('tells a changed ticket from one that was only read again', () => {
    const element = card();
    expect(ticketCardPatchChanges(element, ticketCardPatch('jira', ticket, '2026-11-22T12:00:00.000Z'))).toBe(false);
    for (const change of [{ title: 'Anders' }, { description: '' }, { remoteStatus: 'Done' }, { assignee: undefined }, { labels: ['checkout'] }, { issueType: 'Bug' }, { fixVersions: [] }, { estimate: '8' }] as Array<Partial<JiraIssueSummary>>) {
      expect(ticketCardPatchChanges(element, ticketCardPatch('jira', { ...ticket, ...change }, '2026-11-22T12:00:00.000Z')), JSON.stringify(change)).toBe(true);
    }
  });

  it('survives saving and opening the document without a plugin', () => {
    const document = { ...createDocument('Tickets'), elements: [card()] };
    const opened = deserializeDocument(serializeDocument(document));
    expect(readTicketCard(opened.elements[0])).toMatchObject({ key: 'SHOP-128', labels: ['checkout', 'q1'], estimate: '5' });
  });

  it('removes what the ticket no longer has instead of keeping the old value', () => {
    const patch = ticketCardPatch('jira', { ...ticket, description: '', assignee: undefined, labels: [], components: [], estimate: undefined }, '2026-11-22T10:00:00.000Z');
    expect(patch.description).toBeNull();
    expect(patch.metadata).toMatchObject({ [TICKET_CARD.assignee]: null, [TICKET_CARD.labels]: null, [TICKET_CARD.components]: null, [TICKET_CARD.estimate]: null });
  });

  it('is no ticket card for other kinds, other trackers or a missing key', () => {
    const element = card();
    expect(isTicketCard({ ...element, kind: 'ellipse' })).toBe(false);
    expect(isTicketCard({ ...element, metadata: { ...element.metadata, [TICKET_CARD.provider]: 'trello' } })).toBe(false);
    expect(isTicketCard({ ...element, metadata: { [TICKET_CARD.provider]: 'jira' } })).toBe(false);
    expect(readTicketCard(createElement('rectangle', { id: 'plain', x: 0, y: 0, width: 10, height: 10 }))).toBeNull();
  });

  it('reads damaged entries as empty instead of failing', () => {
    const element = card();
    const data = readTicketCard({ ...element, metadata: { ...element.metadata, [TICKET_CARD.labels]: '{not json', [TICKET_CARD.components]: '"text"', [TICKET_CARD.status]: 'unknown' } });
    expect(data).toMatchObject({ labels: [], components: [], status: 'todo' });
  });

  it('recognises the address of a ticket only under the address of a connected tracker', () => {
    const sites = { jira: 'https://example.atlassian.net', azureDevOps: 'https://dev.azure.com/acme' };
    expect(parseTicketUrl('https://example.atlassian.net/browse/shop-128', sites)).toEqual({ provider: 'jira', key: 'SHOP-128' });
    expect(parseTicketUrl('https://example.atlassian.net/jira/software/projects/SHOP/boards/3?selectedIssue=SHOP-9', sites)).toEqual({ provider: 'jira', key: 'SHOP-9' });
    expect(parseTicketUrl(' https://dev.azure.com/acme/Shop/_workitems/edit/4711/ ', sites)).toEqual({ provider: 'azure-devops', key: '4711' });
    expect(parseTicketUrl('https://dev.azure.com/acme/Shop/_boards/board/t/Team/Stories?workitem=12', sites)).toEqual({ provider: 'azure-devops', key: '12' });
    // A look-alike host, another organization, plain http and running text are no tickets.
    expect(parseTicketUrl('https://example.atlassian.net.evil.test/browse/SHOP-1', sites)).toBeNull();
    expect(parseTicketUrl('https://dev.azure.com/other/Shop/_workitems/edit/1', sites)).toBeNull();
    expect(parseTicketUrl('http://example.atlassian.net/browse/SHOP-1', sites)).toBeNull();
    expect(parseTicketUrl('siehe https://example.atlassian.net/browse/SHOP-1', sites)).toBeNull();
    expect(parseTicketUrl('https://example.atlassian.net/browse/SHOP-1', {})).toBeNull();
  });
});

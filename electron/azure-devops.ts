import type { TaskStatus, WorkItemSummary } from '../src/domain';

/**
 * Azure Boards over the REST interface of Azure DevOps (#284). One client serves Azure DevOps Services (cloud)
 * and Azure DevOps Server: both speak the same interface, they differ in the address of the collection and in the
 * versions of the interface they know. The version is therefore part of the connection and can be set.
 *
 * The client only knows a connection and a `fetch`; settings, the stored token and the question whether the plugin
 * may work at all belong to the plugin service.
 */
export type AzureDevOpsVariant = 'cloud' | 'server';

export interface AzureDevOpsConnection {
  /** Address of the organization (`https://dev.azure.com/acme`) or of the collection of a server. */
  baseUrl: string;
  project: string;
  /** Version of the REST interface, for example `7.1` (cloud) or `6.0` (Azure DevOps Server 2020). */
  apiVersion: string;
  token: string;
  fetchFn: typeof fetch;
  signal?: AbortSignal;
}

/** The newest version every current cloud organization answers, and the one Azure DevOps Server 2020 and later know. */
export const AZURE_DEVOPS_DEFAULT_API_VERSION: Readonly<Record<AzureDevOpsVariant, string>> = { cloud: '7.1', server: '6.0' };
export const AZURE_DEVOPS_API_VERSION = /^\d{1,2}\.\d(-preview(\.\d{1,2})?)?$/;
const MAX_BODY_BYTES = 2_000_000;
const MAX_ITEMS = 100;
const DEFAULT_QUERY = 'SELECT [System.Id] FROM WorkItems WHERE [System.TeamProject] = @project ORDER BY [System.ChangedDate] DESC';

export class AzureDevOpsHttpError extends Error {
  constructor(public readonly status: number, detail: string) {
    super(status === 401 || status === 203 ? 'Azure DevOps hat das Token nicht angenommen.'
      : status === 403 ? 'Das Token hat für diesen Schritt keine Berechtigung in Azure DevOps.'
      : status === 404 ? 'Azure DevOps kennt diese Adresse, dieses Projekt oder diesen Eintrag nicht.'
      : detail ? `Azure DevOps hat die Anfrage abgelehnt: ${detail}` : `Azure DevOps hat mit Status ${status} geantwortet.`);
  }
}

/**
 * The address of the collection. For the cloud the name of the organization is enough; a server needs its whole
 * address. Only https is accepted: the token travels with every request.
 */
export function normalizeAzureDevOpsUrl(value: string, variant: AzureDevOpsVariant): string {
  const raw = value.trim().replace(/\/+$/, '');
  if (!raw) return '';
  const text = variant === 'cloud' && /^[A-Za-z0-9][A-Za-z0-9-]{0,49}$/.test(raw) ? `https://dev.azure.com/${raw}` : raw;
  let url: URL;
  try { url = new URL(text); } catch { throw new Error(variant === 'cloud' ? 'Die Organisation wird als Name oder als Adresse wie https://dev.azure.com/name erwartet.' : 'Die Adresse der Sammlung ist ungültig.'); }
  if (url.protocol !== 'https:') throw new Error('Azure DevOps wird nur über https angesprochen.');
  if (url.username || url.password || url.search || url.hash) throw new Error('Die Adresse darf keine Zugangsdaten, Abfrage oder Sprungmarke enthalten.');
  if (text.length > 400) throw new Error('Die Adresse ist zu lang.');
  return `${url.origin}${url.pathname.replace(/\/+$/, '')}`;
}

export function azureStatus(state: string): TaskStatus {
  const value = state.toLocaleLowerCase('en');
  if (['closed', 'done', 'completed', 'removed', 'erledigt', 'geschlossen', 'fertig'].some((name) => value.includes(name))) return 'done';
  if (['resolved', 'review', 'test', 'prüfung', 'gelöst'].some((name) => value.includes(name))) return 'review';
  if (['active', 'progress', 'doing', 'committed', 'aktiv', 'arbeit'].some((name) => value.includes(name))) return 'doing';
  return 'todo';
}

const ENTITIES: Readonly<Record<string, string>> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };
/** Azure DevOps keeps descriptions as HTML; the task shows them as plain text. */
export function htmlToText(value: unknown): string {
  if (typeof value !== 'string') return '';
  return value
    .replace(/<\s*br\s*\/?>/gi, '\n').replace(/<\/\s*(div|p|li|h[1-6]|tr)\s*>/gi, '\n').replace(/<\s*li[^>]*>/gi, '• ')
    .replace(/<[^>]*>/g, '')
    .replace(/&(#\d+|#x[0-9a-f]+|[a-z]+);/gi, (all, name: string) => {
      if (name[0] === '#') { const code = name[1]?.toLowerCase() === 'x' ? Number.parseInt(name.slice(2), 16) : Number.parseInt(name.slice(1), 10); return Number.isFinite(code) && code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : all; }
      return ENTITIES[name.toLowerCase()] ?? all;
    })
    .replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
}
export function textToHtml(value: string): string {
  const escaped = value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  return escaped.split('\n').map((line) => `<div>${line || '<br>'}</div>`).join('');
}

function isoTimestamp(value: unknown): string {
  const time = typeof value === 'string' ? Date.parse(value) : Number.NaN;
  return Number.isFinite(time) ? new Date(time).toISOString() : new Date(0).toISOString();
}
function dueDate(value: unknown): string | undefined {
  return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}/.test(value) ? value.slice(0, 10) : undefined;
}
/** Newer versions answer a person as an object, older ones as "Name <address>". */
function person(value: unknown): string {
  if (value && typeof value === 'object' && !Array.isArray(value)) { const record = value as Record<string, unknown>; return String(record.displayName ?? record.uniqueName ?? '').trim(); }
  return typeof value === 'string' ? value.replace(/\s*<[^>]*>\s*$/, '').trim() : '';
}

async function request(connection: AzureDevOpsConnection, pathname: string, init: { method?: string; body?: unknown; patch?: boolean } = {}): Promise<unknown> {
  const separator = pathname.includes('?') ? '&' : '?';
  const response = await connection.fetchFn(`${connection.baseUrl}${pathname}${separator}api-version=${encodeURIComponent(connection.apiVersion)}`, {
    method: init.method ?? 'GET', redirect: 'error', ...(connection.signal ? { signal: connection.signal } : {}),
    headers: {
      Accept: 'application/json',
      ...(init.body !== undefined ? { 'Content-Type': init.patch ? 'application/json-patch+json' : 'application/json' } : {}),
      // A personal access token is sent as the password of an empty user name.
      Authorization: `Basic ${Buffer.from(`:${connection.token}`, 'utf8').toString('base64')}`,
    },
    ...(init.body !== undefined ? { body: JSON.stringify(init.body) } : {}),
  });
  const raw = await response.text();
  if (Buffer.byteLength(raw, 'utf8') > MAX_BODY_BYTES) throw new Error('Die Antwort von Azure DevOps ist zu groß.');
  // A sign-in page instead of data: the token was not accepted (status 203 in the cloud, a redirect on servers).
  const json = /^\s*[[{]/.test(raw);
  if (!response.ok || response.status === 203 || (raw && !json)) {
    let detail = '';
    if (json) { try { const parsed = JSON.parse(raw) as { message?: unknown }; if (typeof parsed.message === 'string') detail = parsed.message.slice(0, 300); } catch { /* the status says enough */ } }
    throw new AzureDevOpsHttpError(response.ok && !json ? 401 : response.status, detail);
  }
  return raw ? JSON.parse(raw) : {};
}

const projectPath = (connection: AzureDevOpsConnection): string => `/${encodeURIComponent(connection.project)}`;

function workItem(connection: AzureDevOpsConnection, value: Record<string, unknown>): WorkItemSummary {
  const fields = (value.fields ?? {}) as Record<string, unknown>;
  const id = String(value.id ?? fields['System.Id'] ?? '');
  const remoteStatus = String(fields['System.State'] ?? 'New');
  const assignee = person(fields['System.AssignedTo']);
  const due = dueDate(fields['Microsoft.VSTS.Scheduling.DueDate']);
  const project = typeof fields['System.TeamProject'] === 'string' && fields['System.TeamProject'] ? fields['System.TeamProject'] : connection.project;
  const labels = typeof fields['System.Tags'] === 'string' ? fields['System.Tags'].split(';').map((tag) => tag.trim()).filter(Boolean) : [];
  const area = typeof fields['System.AreaPath'] === 'string' ? fields['System.AreaPath'].trim() : '';
  const estimateField = ESTIMATE_FIELDS.find((name) => typeof fields[name] === 'number');
  return {
    provider: 'azure-devops', id, key: id, title: String(fields['System.Title'] ?? id), description: htmlToText(fields['System.Description']),
    status: azureStatus(remoteStatus), remoteStatus,
    ...(assignee ? { assignee } : {}), ...(due ? { dueDate: due } : {}),
    url: `${connection.baseUrl}/${encodeURIComponent(project)}/_workitems/edit/${encodeURIComponent(id)}`, updatedAt: isoTimestamp(fields['System.ChangedDate']),
    labels, components: area ? [area] : [], ...(estimateField ? { estimate: String(fields[estimateField]) } : {}),
  };
}

/** Where a process keeps its estimate: story points (Agile), effort (Scrum, CMMI) or the original estimate of a task. */
const ESTIMATE_FIELDS = ['Microsoft.VSTS.Scheduling.StoryPoints', 'Microsoft.VSTS.Scheduling.Effort', 'Microsoft.VSTS.Scheduling.OriginalEstimate'] as const;

const itemId = (key: string): string => { if (!/^\d{1,12}$/.test(key)) throw new Error('Die Nummer des Work Items ist ungültig.'); return key; };

/** Reads the project; proves address, project and token. */
export async function testAzureDevOps(connection: AzureDevOpsConnection): Promise<string> {
  const project = await request(connection, `/_apis/projects/${encodeURIComponent(connection.project)}`) as { name?: unknown };
  return typeof project.name === 'string' && project.name ? project.name : connection.project;
}

export async function getAzureWorkItem(connection: AzureDevOpsConnection, key: string): Promise<WorkItemSummary> {
  return workItem(connection, await request(connection, `/_apis/wit/workitems/${itemId(key)}`) as Record<string, unknown>);
}

/** The work items of a WIQL query, newest first by default, at most 100. */
export async function listAzureWorkItems(connection: AzureDevOpsConnection, query: string): Promise<WorkItemSummary[]> {
  const found = await request(connection, `${projectPath(connection)}/_apis/wit/wiql?$top=${MAX_ITEMS}`, { method: 'POST', body: { query: query.trim() || DEFAULT_QUERY } }) as { workItems?: Array<{ id?: unknown }> };
  const ids = (found.workItems ?? []).map((entry) => Number(entry.id)).filter((id) => Number.isInteger(id) && id > 0).slice(0, MAX_ITEMS);
  if (!ids.length) return [];
  const response = await request(connection, `/_apis/wit/workitems?ids=${ids.join(',')}`) as { value?: Array<Record<string, unknown>> };
  const byId = new Map((response.value ?? []).map((entry) => [Number(entry.id), entry]));
  // The query decides the order; the second request answers in the order of the ids it was given, which is not promised.
  return ids.flatMap((id) => { const entry = byId.get(id); return entry ? [workItem(connection, entry)] : []; });
}

type PatchOperation = { op: 'add' | 'remove'; path: string; value?: unknown };
function fieldOperations(input: { title?: string; description?: string; assignee?: string | null; dueDate?: string | null }): PatchOperation[] {
  const operations: PatchOperation[] = [];
  const set = (field: string, value: string | null | undefined, keepEmpty = false) => {
    if (value === undefined) return;
    if (value === null || (value === '' && !keepEmpty)) operations.push({ op: 'remove', path: `/fields/${field}` });
    else operations.push({ op: 'add', path: `/fields/${field}`, value });
  };
  set('System.Title', input.title);
  if (input.description !== undefined) set('System.Description', textToHtml(input.description), true);
  set('System.AssignedTo', input.assignee === undefined ? undefined : input.assignee?.trim() || null);
  set('Microsoft.VSTS.Scheduling.DueDate', input.dueDate === undefined ? undefined : input.dueDate || null);
  return operations;
}

export async function createAzureWorkItem(connection: AzureDevOpsConnection, type: string, input: { title: string; description: string; assignee?: string; dueDate?: string }): Promise<WorkItemSummary> {
  const operations = fieldOperations(input).filter((operation) => operation.op === 'add');
  return workItem(connection, await request(connection, `${projectPath(connection)}/_apis/wit/workitems/$${encodeURIComponent(type)}`, { method: 'POST', body: operations, patch: true }) as Record<string, unknown>);
}

export async function updateAzureWorkItem(connection: AzureDevOpsConnection, key: string, input: { title?: string; description?: string; assignee?: string | null; dueDate?: string | null }): Promise<WorkItemSummary> {
  const id = itemId(key);
  let operations = fieldOperations(input);
  if (!operations.length) return getAzureWorkItem(connection, id);
  // Removing a field that is already empty is refused; such a removal is left out after a look at the item.
  if (operations.some((operation) => operation.op === 'remove')) {
    const current = await request(connection, `/_apis/wit/workitems/${id}`) as { fields?: Record<string, unknown> };
    operations = operations.filter((operation) => operation.op !== 'remove' || current.fields?.[operation.path.slice('/fields/'.length)] !== undefined);
    if (!operations.length) return workItem(connection, current as Record<string, unknown>);
  }
  return workItem(connection, await request(connection, `/_apis/wit/workitems/${id}`, { method: 'PATCH', body: operations, patch: true }) as Record<string, unknown>);
}

/** The state categories of Azure Boards that stand for the four columns of the task board. */
const CATEGORY: Readonly<Record<TaskStatus, string>> = { todo: 'Proposed', doing: 'InProgress', review: 'Resolved', done: 'Completed' };

/**
 * Moves a work item to the state that stands for a column of the task board. The states of a work item type
 * differ per process; the type names its states with their category, and where a server does not answer that,
 * the names decide.
 */
export async function transitionAzureWorkItem(connection: AzureDevOpsConnection, key: string, status: TaskStatus): Promise<WorkItemSummary> {
  const id = itemId(key);
  const current = await request(connection, `/_apis/wit/workitems/${id}`) as { fields?: Record<string, unknown> };
  const type = String(current.fields?.['System.WorkItemType'] ?? '');
  const project = String(current.fields?.['System.TeamProject'] ?? connection.project);
  let states: Array<{ name: string; category: string }> = [];
  try {
    const answer = await request(connection, `/${encodeURIComponent(project)}/_apis/wit/workitemtypes/${encodeURIComponent(type)}/states`) as { value?: Array<{ name?: unknown; category?: unknown }> };
    states = (answer.value ?? []).flatMap((entry) => typeof entry.name === 'string' ? [{ name: entry.name, category: typeof entry.category === 'string' ? entry.category : '' }] : []);
  } catch (error) { if (!(error instanceof AzureDevOpsHttpError) || (error.status !== 400 && error.status !== 404)) throw error; }
  const target = states.find((state) => state.category === CATEGORY[status] && azureStatus(state.name) === status)
    ?? states.find((state) => state.category === CATEGORY[status])
    ?? states.find((state) => state.category !== 'Removed' && azureStatus(state.name) === status);
  const fallback: Readonly<Record<TaskStatus, string>> = { todo: 'New', doing: 'Active', review: 'Resolved', done: 'Closed' };
  if (!target && states.length) throw new Error('Für diese Spalte hat der Typ des Work Items in Azure DevOps keinen passenden Zustand.');
  return workItem(connection, await request(connection, `/_apis/wit/workitems/${id}`, { method: 'PATCH', body: [{ op: 'add', path: '/fields/System.State', value: target?.name ?? fallback[status] }], patch: true }) as Record<string, unknown>);
}

/** Work items whose title contains the text, or the one with that number; newest first, at most 20. */
export async function searchAzureWorkItems(connection: AzureDevOpsConnection, text: string): Promise<WorkItemSummary[]> {
  const query = text.trim();
  if (!query) return [];
  const condition = /^#?\d{1,12}$/.test(query) ? `[System.Id] = ${query.replace('#', '')}` : `[System.Title] CONTAINS '${query.replace(/'/g, "''")}'`;
  const found = await request(connection, `${projectPath(connection)}/_apis/wit/wiql?$top=20`, { method: 'POST', body: { query: `SELECT [System.Id] FROM WorkItems WHERE [System.TeamProject] = @project AND ${condition} ORDER BY [System.ChangedDate] DESC` } }) as { workItems?: Array<{ id?: unknown }> };
  const ids = (found.workItems ?? []).map((entry) => Number(entry.id)).filter((id) => Number.isInteger(id) && id > 0).slice(0, 20);
  if (!ids.length) return [];
  const response = await request(connection, `/_apis/wit/workitems?ids=${ids.join(',')}`) as { value?: Array<Record<string, unknown>> };
  const byId = new Map((response.value ?? []).map((entry) => [Number(entry.id), entry]));
  return ids.flatMap((id) => { const entry = byId.get(id); return entry ? [workItem(connection, entry)] : []; });
}

/**
 * Writes tags, area path and estimate of a work item. The estimate goes to the field that holds it now, and to the
 * story points when none does; Azure Boards keeps it as a number.
 */
export async function updateAzureWorkItemDetails(connection: AzureDevOpsConnection, key: string, input: { labels?: string[]; components?: string[]; estimate?: string | null }): Promise<WorkItemSummary> {
  const id = itemId(key);
  const current = await request(connection, `/_apis/wit/workitems/${id}`) as { fields?: Record<string, unknown> };
  const operations: PatchOperation[] = [];
  if (input.labels !== undefined) {
    if (input.labels.length) operations.push({ op: 'add', path: '/fields/System.Tags', value: input.labels.join('; ') });
    else if (current.fields?.['System.Tags'] !== undefined) operations.push({ op: 'remove', path: '/fields/System.Tags' });
  }
  // A work item always has an area; an emptied field leaves it where it is.
  if (input.components?.[0]?.trim()) operations.push({ op: 'add', path: '/fields/System.AreaPath', value: input.components[0].trim() });
  if (input.estimate !== undefined) {
    const field = ESTIMATE_FIELDS.find((name) => typeof current.fields?.[name] === 'number') ?? ESTIMATE_FIELDS[0];
    const text = (input.estimate ?? '').trim().replace(',', '.');
    if (!text) { if (current.fields?.[field] !== undefined) operations.push({ op: 'remove', path: `/fields/${field}` }); }
    else {
      const value = Number(text);
      if (!Number.isFinite(value) || value < 0) throw new Error('Die Schätzung wird in Azure DevOps als Zahl erwartet.');
      operations.push({ op: 'add', path: `/fields/${field}`, value });
    }
  }
  if (!operations.length) return workItem(connection, current as Record<string, unknown>);
  return workItem(connection, await request(connection, `/_apis/wit/workitems/${id}`, { method: 'PATCH', body: operations, patch: true }) as Record<string, unknown>);
}

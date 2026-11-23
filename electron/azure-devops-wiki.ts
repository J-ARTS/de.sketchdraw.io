import { AzureDevOpsHttpError, type AzureDevOpsConnection } from './azure-devops';

/**
 * The wiki of Azure DevOps (#284): find pages and show one page of a diagram as an image on a wiki page, as the
 * Confluence plugin does for Confluence (#240). All of it runs in the main process with the token of the plugin.
 *
 * A wiki page is Markdown in a Git repository. The image is uploaded as an attachment of the wiki and the page
 * gets one block, between two comment lines, that shows it. Everything outside that block is never touched.
 */
export interface AzureWikiPage {
  /** Identifier of the wiki (its id; the name for wikis that have none). */
  wiki: string;
  wikiName: string;
  /** Path of the page inside the wiki, for example `/Architektur/Übersicht`. */
  path: string;
  /** Address of the page in the browser. */
  url: string;
}

const MAX_BODY_BYTES = 4_000_000;
const MAX_WIKIS = 10;
const MAX_PAGES = 2_000;
const MAX_RESULTS = 50;
/** Wiki paths are part of an address: no control characters, nothing that leaves the wiki. */
const PAGE_PATH = /^\/(?!.*(?:^|\/)\.\.?(?:\/|$))[^\u0000-\u001f\u007f#?\\]{1,400}$/;
const WIKI_ID = /^[A-Za-z0-9][A-Za-z0-9 ._-]{0,127}$/;

export function assertAzureWikiTarget(wiki: unknown, pagePath: unknown): { wiki: string; path: string } {
  if (typeof wiki !== 'string' || !WIKI_ID.test(wiki)) throw new Error('Ungültiges Wiki.');
  if (typeof pagePath !== 'string' || !PAGE_PATH.test(pagePath) || pagePath.endsWith('/')) throw new Error('Ungültiger Pfad der Wiki-Seite.');
  return { wiki, path: pagePath };
}

interface WikiResponse { status: number; json: unknown; etag: string | null }

async function wikiRequest(connection: AzureDevOpsConnection, pathname: string, init: { method?: string; json?: unknown; octets?: string; ifMatch?: string; allow?: readonly number[] } = {}): Promise<WikiResponse> {
  const separator = pathname.includes('?') ? '&' : '?';
  const response = await connection.fetchFn(`${connection.baseUrl}/${encodeURIComponent(connection.project)}/_apis/wiki${pathname}${separator}api-version=${encodeURIComponent(connection.apiVersion)}`, {
    method: init.method ?? 'GET', redirect: 'error', ...(connection.signal ? { signal: connection.signal } : {}),
    headers: {
      Accept: 'application/json',
      ...(init.json !== undefined ? { 'Content-Type': 'application/json' } : init.octets !== undefined ? { 'Content-Type': 'application/octet-stream' } : {}),
      ...(init.ifMatch ? { 'If-Match': init.ifMatch } : {}),
      Authorization: `Basic ${Buffer.from(`:${connection.token}`, 'utf8').toString('base64')}`,
    },
    ...(init.json !== undefined ? { body: JSON.stringify(init.json) } : init.octets !== undefined ? { body: init.octets } : {}),
  });
  const raw = await response.text();
  if (Buffer.byteLength(raw, 'utf8') > MAX_BODY_BYTES) throw new Error('Die Antwort von Azure DevOps ist zu groß.');
  const json = /^\s*[[{]/.test(raw);
  let parsed: unknown = {};
  if (json) { try { parsed = JSON.parse(raw); } catch { parsed = {}; } }
  if (init.allow?.includes(response.status)) return { status: response.status, json: parsed, etag: response.headers.get('etag') };
  // A sign-in page instead of data: the token was not accepted (status 203 in the cloud, a redirect on servers).
  if (!response.ok || response.status === 203 || (raw && !json)) {
    const message = (parsed as { message?: unknown }).message;
    throw new AzureDevOpsHttpError(response.ok && !json ? 401 : response.status, typeof message === 'string' ? message.slice(0, 300) : '');
  }
  return { status: response.status, json: parsed, etag: response.headers.get('etag') };
}

const record = (value: unknown): Record<string, unknown> => (value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {});
const text = (value: unknown, max: number): string => (typeof value === 'string' ? value.replace(/[\u0000-\u001f\u007f]/g, ' ').slice(0, max) : '');

/** The address of a wiki page in the browser, for a link the user opens. */
export function azureWikiPageUrl(connection: Pick<AzureDevOpsConnection, 'baseUrl' | 'project'>, wiki: string, pagePath: string): string {
  return `${connection.baseUrl}/${encodeURIComponent(connection.project)}/_wiki/wikis/${encodeURIComponent(wiki)}?pagePath=${encodeURIComponent(pagePath)}`;
}

async function listWikis(connection: AzureDevOpsConnection): Promise<Array<{ id: string; name: string }>> {
  const { json } = await wikiRequest(connection, '/wikis');
  const values = record(json).value;
  return (Array.isArray(values) ? values : []).flatMap((entry) => {
    const wiki = record(entry); const name = text(wiki.name, 128); const id = text(wiki.id, 128) || name;
    return id && WIKI_ID.test(id) ? [{ id, name: name || id }] : [];
  }).slice(0, MAX_WIKIS);
}

/** The pages of the wikis of the project whose path contains the text; without a text, the first pages of each wiki. */
export async function listAzureWikiPages(connection: AzureDevOpsConnection, query: string): Promise<AzureWikiPage[]> {
  const needle = query.trim().toLowerCase();
  const found: AzureWikiPage[] = [];
  for (const wiki of await listWikis(connection)) {
    const { json } = await wikiRequest(connection, `/wikis/${encodeURIComponent(wiki.id)}/pages?path=${encodeURIComponent('/')}&recursionLevel=full`);
    // The pages come as a tree; it is walked without recursion and with a limit, whatever the server answers.
    const open: unknown[] = [json]; let seen = 0;
    while (open.length && seen < MAX_PAGES && found.length < MAX_RESULTS) {
      const page = record(open.shift()); seen++;
      const children = page.subPages;
      if (Array.isArray(children)) open.push(...children.slice(0, MAX_PAGES));
      const pagePath = typeof page.path === 'string' ? page.path : '';
      if (pagePath === '/' || !PAGE_PATH.test(pagePath) || (needle && !pagePath.toLowerCase().includes(needle))) continue;
      found.push({ wiki: wiki.id, wikiName: wiki.name, path: pagePath, url: azureWikiPageUrl(connection, wiki.id, pagePath) });
    }
    if (found.length >= MAX_RESULTS) break;
  }
  return found;
}

/** Reads a page with its text and the version (ETag) a change has to name. */
export async function readAzureWikiPage(connection: AzureDevOpsConnection, wiki: string, pagePath: string): Promise<{ content: string; etag: string; url: string }> {
  const target = assertAzureWikiTarget(wiki, pagePath);
  const { json, etag } = await wikiRequest(connection, `/wikis/${encodeURIComponent(target.wiki)}/pages?path=${encodeURIComponent(target.path)}&includeContent=true`);
  if (!etag) throw new Error('Azure DevOps hat keine Version der Wiki-Seite genannt.');
  const content = record(json).content;
  return { content: typeof content === 'string' ? content : '', etag, url: azureWikiPageUrl(connection, target.wiki, target.path) };
}

const blockStart = (token: string): string => `<!-- sketchdraw:${token} -->`;
const blockEnd = (token: string): string => `<!-- /sketchdraw:${token} -->`;
const escapeRegExp = (value: string): string => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
/** The name of the attachment says what it shows: the same picture is never uploaded twice. */
export function azureWikiAttachmentName(token: string, hash: string): string { return `sketchdraw-${token.replace(/[^0-9a-f]/gi, '').slice(0, 12)}-${hash.slice(0, 24)}.png`; }
/** Alternative text of the image: one line, nothing that ends the image syntax of Markdown. */
const altText = (value: string): string => value.replace(/[\u0000-\u001f\u007f[\]()<>\\]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 200) || 'Sketchdraw';

/**
 * The text of the page with the block of this link showing the given attachment. An existing block is replaced
 * where it stands, so the user can move it; without one, the block goes to the end. Returns null when the page
 * already shows that attachment.
 */
export function withAzureWikiImage(content: string, token: string, attachment: string, alt: string, width: number): string | null {
  const image = `![${altText(alt)}](/.attachments/${attachment} =${Math.max(1, Math.min(4000, Math.round(width)))}x)`;
  const block = `${blockStart(token)}\n${image}\n${blockEnd(token)}`;
  const existing = new RegExp(`${escapeRegExp(blockStart(token))}[\\s\\S]*?${escapeRegExp(blockEnd(token))}`);
  const match = existing.exec(content);
  if (match) return match[0] === block ? null : `${content.slice(0, match.index)}${block}${content.slice(match.index + match[0].length)}`;
  return `${content.replace(/\s+$/, '')}${content.trim() ? '\n\n' : ''}${block}\n`;
}

/**
 * Shows the image on the page: uploads it as an attachment when the page does not show this picture yet, and
 * writes the block of the link. Somebody else's change in between is noticed through the version of the page
 * (status 412 or 409) and reported as such; nothing of it is overwritten.
 */
export async function publishAzureWikiImage(connection: AzureDevOpsConnection, target: { wiki: string; path: string; token: string }, image: { name: string; hash: string; width: number; png: Uint8Array }, guard: () => void = () => undefined): Promise<{ uploaded: boolean; bodyUpdated: boolean }> {
  const { wiki, path: pagePath } = assertAzureWikiTarget(target.wiki, target.path);
  const attachment = azureWikiAttachmentName(target.token, image.hash);
  const page = await readAzureWikiPage(connection, wiki, pagePath);
  guard();
  const next = withAzureWikiImage(page.content, target.token, attachment, image.name, image.width);
  if (next === null) return { uploaded: false, bodyUpdated: false };
  // The attachment is sent as base64 text. One of the same name is this very picture (the name carries its hash).
  const upload = await wikiRequest(connection, `/wikis/${encodeURIComponent(wiki)}/attachments?name=${encodeURIComponent(attachment)}`, { method: 'PUT', octets: Buffer.from(image.png).toString('base64'), allow: [400, 409] });
  const exists = upload.status === 409 || (upload.status === 400 && /already exists|bereits vorhanden/i.test(text(record(upload.json).message, 300)));
  if (upload.status >= 400 && !exists) throw new AzureDevOpsHttpError(upload.status, text(record(upload.json).message, 300));
  guard();
  await wikiRequest(connection, `/wikis/${encodeURIComponent(wiki)}/pages?path=${encodeURIComponent(pagePath)}`, { method: 'PUT', json: { content: next }, ifMatch: page.etag });
  return { uploaded: !exists, bodyUpdated: true };
}

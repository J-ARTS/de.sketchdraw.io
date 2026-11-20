import { mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { PluginService } from '../../electron/plugin-service';
import type { DocumentPersistenceService } from '../../electron/persistence';
import { confluenceLiveFilePrefix, confluenceLiveFilename, managedImageFilenames, type ConfluenceLiveImage } from '../../src/domain';
import { createHash } from 'node:crypto';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';

const cleanup: string[] = [];
const services: PluginService[] = [];
afterEach(async () => { for (const service of services.splice(0)) service.dispose(); vi.restoreAllMocks(); await Promise.all(cleanup.splice(0).map((dir) => rm(dir, { recursive: true, force: true }))); });

const credentials = () => ({ available: () => true, encrypt: (value: string) => `enc:${Buffer.from(value).toString('base64')}`, decrypt: (value: string) => Buffer.from(value.slice(4), 'base64').toString('utf8') });
const sha = (value: string) => createHash('sha256').update(value).digest('hex');
const u32 = (value: number) => { const buffer = Buffer.alloc(4); buffer.writeUInt32BE(value); return buffer; };
/** A structurally valid PNG (signature, header chunk, a text chunk with `content`, end chunk). */
function png(content: string): Uint8Array {
  const data = Buffer.from(content);
  return new Uint8Array(Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    u32(13), Buffer.from('IHDR'), u32(1800), u32(1000), Buffer.from([8, 6, 0, 0, 0]), u32(0),
    u32(data.length), Buffer.from('tEXt'), data, u32(0),
    Buffer.from([0, 0, 0, 0, 0x49, 0x45, 0x4e, 0x44, 0xae, 0x42, 0x60, 0x82]),
  ]));
}
const contentOf = (bytes: Uint8Array) => Buffer.from(bytes.slice(41, bytes.length - 16)).toString();
/** A rendered diagram page; `content` stands for what the page looks like. */
const image = (pageId: string, content: string, name = pageId): ConfluenceLiveImage => ({ pageId, name, hash: sha(`${pageId}:${content}`), width: 900, height: 500, png: png(content) });

const DOCUMENT_ID = 'document:aws-bedrock-agentcore';
const DOCUMENT_KEY = sha(DOCUMENT_ID).slice(0, 12);
const PREFIX = confluenceLiveFilePrefix(DOCUMENT_KEY);
const fileOf = (pageId: string) => confluenceLiveFilename(DOCUMENT_KEY, sha(pageId).slice(0, 12));
const SITE = 'https://example.atlassian.net';
const FOREIGN = '<h2>Architektur</h2><p>Text <strong>fett</strong> und <a href="https://example.com/docs">Doku</a>.</p><ol><li><p>Erster Schritt</p></li></ol><table><tbody><tr><td><p>Wert</p></td></tr></tbody></table>';

interface Call { method: string; url: string; authorization: string }
interface Attachment { id: string; versions: Array<{ bytes: Uint8Array; comment: string }> }

/** An in-memory Confluence page with versioned attachments, speaking the endpoints the plugin uses. */
function fakeConfluence(options: { body?: string; version?: number; comments?: boolean; pageId?: string } = {}) {
  const page = { id: options.pageId ?? '164037', title: 'Architektur', version: options.version ?? 1, body: options.body ?? '' };
  const attachments = new Map<string, Attachment>();
  const calls: Call[] = [];
  const bodyWrites: string[] = [];
  let nextAttachment = 1;
  /** Runs before a request is handled; may answer instead, or throw like a broken network. */
  let before: ((call: Call) => Response | void | Promise<Response | void>) | null = null;
  /** Runs after a request was applied; throwing loses the answer although the server did the work. */
  let after: ((call: Call) => void | Promise<void>) | null = null;
  const json = (value: unknown, status = 200, headers: Record<string, string> = {}) => new Response(JSON.stringify(value), { status, headers });
  const withComments = options.comments !== false;
  const readUpload = async (init: RequestInit): Promise<{ name: string; bytes: Uint8Array; comment: string } | null> => {
    const headers = init.headers as Record<string, string>;
    if (headers['X-Atlassian-Token'] !== 'nocheck' || headers['Content-Type'] !== undefined || !(init.body instanceof FormData)) return null;
    const upload = init.body.get('file') as File;
    if (upload.type !== 'image/png' || init.body.get('minorEdit') !== 'true') return null;
    return { name: upload.name, bytes: new Uint8Array(await upload.arrayBuffer()), comment: String(init.body.get('comment') ?? '') };
  };
  const fetchFn = vi.fn(async (input: string | URL | Request, init: RequestInit = {}): Promise<Response> => {
    const url = String(input); const method = init.method ?? 'GET';
    const call: Call = { method, url, authorization: String((init.headers as Record<string, string> | undefined)?.Authorization ?? '') };
    calls.push(call);
    const early = await before?.(call);
    if (early) return early;
    const respond = async (response: Response) => { await after?.(call); return response; };
    const pathname = new URL(url).pathname; const query = new URL(url).searchParams;
    const classic = `/wiki/rest/api/content/${page.id}/child/attachment`;
    if (pathname === `/wiki/api/v2/pages/${page.id}/attachments` && method === 'GET') {
      const filename = query.get('filename') ?? ''; const attachment = attachments.get(filename);
      if (!attachment) return respond(json({ results: [] }));
      const latest = attachment.versions.at(-1)!;
      return respond(json({ results: [{ id: attachment.id, status: 'current', title: filename, pageId: page.id, ...(withComments ? { comment: latest.comment } : {}), version: { number: attachment.versions.length, ...(withComments ? { message: latest.comment } : {}) } }] }));
    }
    if (pathname === classic && method === 'GET') {
      const filename = query.get('filename') ?? ''; const attachment = attachments.get(filename);
      if (!attachment) return respond(json({ results: [] }));
      return respond(json({ results: [{ id: attachment.id, title: filename, version: { number: attachment.versions.length }, metadata: withComments ? { comment: attachment.versions.at(-1)!.comment } : {} }] }));
    }
    if (pathname === `/wiki/api/v2/pages/${page.id}` && method === 'GET') return respond(json({ id: page.id, title: page.title, subtype: 'live', version: { number: page.version }, body: { storage: { value: page.body, representation: 'storage' } } }));
    if (pathname === `/wiki/api/v2/pages/${page.id}` && method === 'PUT') {
      const update = JSON.parse(String(init.body)) as { status: string; title: string; body: { representation: string; value: string }; version: { number: number } };
      if (update.version.number !== page.version + 1) return respond(json({ errors: [{ title: 'Version conflict' }] }, 409));
      if (update.status !== 'current' || update.body.representation !== 'storage') return respond(json({}, 400));
      page.body = update.body.value; page.version = update.version.number; page.title = update.title; bodyWrites.push(update.body.value);
      return respond(json({ id: page.id }));
    }
    if (pathname === classic && method === 'POST') {
      // Create only: an existing name is refused, never replaced.
      const upload = await readUpload(init);
      if (!upload) return respond(json({}, 403));
      if (attachments.has(upload.name)) return respond(json({ message: 'Cannot add a new attachment with same file name as an existing attachment' }, 400));
      const attachment: Attachment = { id: `att${nextAttachment++}`, versions: [{ bytes: upload.bytes, comment: upload.comment }] };
      attachments.set(upload.name, attachment);
      return respond(json({ results: [{ id: attachment.id, title: upload.name, version: { number: 1 } }] }));
    }
    const data = new RegExp(`^${classic}/([^/]+)/data$`).exec(pathname);
    if (data && method === 'POST') {
      const upload = await readUpload(init);
      if (!upload) return respond(json({}, 403));
      const entry = [...attachments.entries()].find(([, attachment]) => attachment.id === data[1]);
      if (!entry || entry[0] !== upload.name) return respond(json({}, 404));
      entry[1].versions.push({ bytes: upload.bytes, comment: upload.comment });
      return respond(json({ id: entry[1].id, title: entry[0], version: { number: entry[1].versions.length } }));
    }
    if (pathname.startsWith('/wiki/api/v2/pages/')) return respond(json({}, 404));
    return respond(json({}));
  });
  return {
    page, attachments, calls, bodyWrites, json, fetchFn: fetchFn as unknown as typeof fetch,
    intercept(handler: typeof before) { before = handler; }, afterApplied(handler: typeof after) { after = handler; },
    /** Somebody else puts a file on the page, or a new version of one. */
    foreign(name: string, comment = '', count = 1) {
      const attachment = attachments.get(name) ?? { id: `att${nextAttachment++}`, versions: [] };
      for (let index = 0; index < count; index++) attachment.versions.push({ bytes: png(`foreign-${attachment.versions.length}`), comment });
      attachments.set(name, attachment); return attachment;
    },
    versions: (pageId: string) => attachments.get(fileOf(pageId))?.versions ?? [],
    contents: (pageId: string) => (attachments.get(fileOf(pageId))?.versions ?? []).map((entry) => contentOf(entry.bytes)),
    writes: () => calls.filter((call) => call.method !== 'GET'),
    uploads: () => calls.filter((call) => call.method === 'POST' && call.url.includes('/child/attachment')),
  };
}

async function setup(remote = fakeConfluence(), extra: { quiet?: number; now?: () => number } = {}) {
  const dir = await realpath(await mkdtemp(path.join(os.tmpdir(), 'sketchdraw-live-'))); cleanup.push(dir);
  const documentPath = path.join(dir, 'aws.sketchdraw.json'); await writeFile(documentPath, '{"id":"document:aws-bedrock-agentcore"}\n');
  const otherPath = path.join(dir, 'other.sketchdraw.json'); await writeFile(otherPath, '{"id":"document:other"}\n');
  const locations = new Map<string, { selectedPath: string; canonicalPath: string; versionToken: string }>();
  for (const [handleId, file] of Object.entries({ project: documentPath, other: otherPath })) locations.set(handleId, { selectedPath: file, canonicalPath: file, versionToken: `sha256:${handleId}` });
  const persistence = { getHandleLocation: (handleId: string) => locations.get(handleId) ?? null } as unknown as DocumentPersistenceService;
  const configPath = path.join(dir, 'profile', 'plugins.json');
  const create = () => { const service = new PluginService({ configPath, persistence, credentials: credentials(), emitEvent: vi.fn(), fetchFn: remote.fetchFn, liveQuietWindowMs: extra.quiet ?? 0, ...(extra.now ? { now: extra.now } : {}) }); services.push(service); return service; };
  const service = create();
  await service.activateDocument('project');
  await service.configureAtlassian(alice());
  const storedLink = async () => (JSON.parse(await readFile(configPath, 'utf8')) as { profiles: Array<{ atlassian: { confluenceLinks?: Array<Record<string, unknown>> } }> }).profiles[0]!.atlassian.confluenceLinks?.[0];
  return { service, remote, dir, documentPath, configPath, create, storedLink };
}
const alice = (overrides: Record<string, unknown> = {}) => ({ enabled: true, siteUrl: SITE, email: 'alice@example.com', apiToken: 'alice-secret', confluenceSpaceKey: '', jiraProjectKey: 'SK', jiraIssueType: 'Task', jqlFilter: '', ...overrides });
const link = (service: PluginService, pageId: string | null = '164037') => service.setConfluenceLiveLink({ handleId: 'project', documentId: DOCUMENT_ID, pageId });
const publish = (service: PluginService, images: ConfluenceLiveImage[], overrides: Partial<{ handleId: string; documentId: string }> = {}) => service.publishConfluenceLive({ handleId: 'project', documentId: DOCUMENT_ID, title: 'AWS Bedrock AgentCore', images, ...overrides });
const basic = (email: string, token: string) => `Basic ${Buffer.from(`${email}:${token}`).toString('base64')}`;
/** Holds every request that matches until released, and tells when the first one arrived. */
function gate(remote: ReturnType<typeof fakeConfluence>, matches: (call: Call) => boolean) {
  let release!: () => void; const held = new Promise<void>((resolve) => { release = resolve; });
  let reached!: () => void; const blocked = new Promise<void>((resolve) => { reached = resolve; });
  remote.intercept(async (call) => { if (matches(call)) { reached(); await held; } });
  return { blocked, open: () => { remote.intercept(null); release(); } };
}

describe('Confluence live link of a diagram (#210)', () => {
  it('is made explicitly, lives in the profile on this device and survives a restart without touching the diagram', async () => {
    const { service, documentPath, configPath, create, storedLink } = await setup();
    const diagramBefore = await readFile(documentPath, 'utf8');
    expect(await service.getSettings()).not.toHaveProperty('confluenceLive');
    const snapshot = await link(service);
    expect(snapshot.confluenceLive).toEqual({ pageId: '164037', pageTitle: 'Architektur', pageUrl: `${SITE}/wiki/pages/viewpage.action?pageId=164037`, siteUrl: SITE, documentId: DOCUMENT_ID, usable: true });
    expect(JSON.stringify(snapshot)).not.toContain('alice-secret');
    expect(JSON.stringify(snapshot)).not.toContain('enc:');
    const stored = await storedLink();
    expect(stored).toMatchObject({ documentPath, documentId: DOCUMENT_ID, siteUrl: SITE, pageId: '164037', pageTitle: 'Architektur' });
    // The token of the link is an internal detail; the renderer never sees it.
    expect(JSON.stringify(snapshot)).not.toContain(String(stored!.token));
    expect(await readFile(documentPath, 'utf8')).toBe(diagramBefore);

    const restarted = create();
    expect((await restarted.getSettings('project')).confluenceLive).toMatchObject({ pageId: '164037', usable: true });
    // Another diagram in the same folder has no link, and the link is not available without a local diagram.
    expect(await restarted.getSettings('other')).not.toHaveProperty('confluenceLive');
    expect(await restarted.getSettings(null)).not.toHaveProperty('confluenceLive');

    await restarted.getSettings('project');
    expect((await link(restarted, null))).not.toHaveProperty('confluenceLive');
    expect(JSON.parse(await readFile(configPath, 'utf8')).profiles[0].atlassian).not.toHaveProperty('confluenceLinks');
  });

  it('refuses to link a page the account cannot read and keeps settings changes from dropping the link', async () => {
    const { service, remote } = await setup();
    await expect(link(service, '999')).rejects.toThrow('Atlassian antwortete mit 404.');
    await expect(link(service, '../164037')).rejects.toThrow('ungültig');
    expect(await service.getSettings()).not.toHaveProperty('confluenceLive');
    await link(service);
    const saved = await service.configureAtlassian(alice({ apiToken: undefined, confluenceSpaceKey: 'DOC' }));
    expect(saved.confluenceLive).toMatchObject({ pageId: '164037', usable: true });
    expect(remote.writes()).toEqual([]);
  });

  it('publishes every diagram page as a versioned image into a section of its own and preserves all foreign content', async () => {
    const { service, remote, configPath, storedLink } = await setup(fakeConfluence({ body: FOREIGN, version: 7 }));
    await link(service);
    const first = await publish(service, [image('page:1', 'overview-v1', 'Übersicht'), image('page:2', 'network-v1', 'Netz')]);
    expect(first).toMatchObject({ status: 'synced', uploaded: 2, bodyUpdated: true });
    expect(first.syncedAt).toMatch(/^\d{4}-/);
    // The actual rendered diagrams are attached, one attachment per page.
    expect(remote.contents('page:1')).toEqual(['overview-v1']);
    expect(remote.contents('page:2')).toEqual(['network-v1']);
    // New attachments are created with the request that cannot replace a file.
    expect(remote.uploads().map((call) => new URL(call.url).pathname)).toEqual(['/wiki/rest/api/content/164037/child/attachment', '/wiki/rest/api/content/164037/child/attachment']);
    // Foreign content is byte-identical; only two images of ours were appended.
    expect(remote.page.body.startsWith(FOREIGN)).toBe(true);
    expect(remote.page.version).toBe(8);
    expect(managedImageFilenames(remote.page.body, PREFIX)).toEqual([fileOf('page:1'), fileOf('page:2')]);
    expect(remote.page.body.slice(FOREIGN.length)).toContain('ac:alt="AWS Bedrock AgentCore – Übersicht"');
    expect((await service.getSettings()).confluenceLive?.lastSyncedAt).toBe(first.syncedAt);
    // What this link may update is remembered by attachment id and version.
    expect((await storedLink())!.published).toEqual({ [fileOf('page:1')]: { id: 'att1', version: 1, hash: image('page:1', 'overview-v1').hash }, [fileOf('page:2')]: { id: 'att2', version: 1, hash: image('page:2', 'network-v1').hash } });
    expect(await storedLink()).not.toHaveProperty('pending');

    // Nothing changed: no upload, no page write, and the profile file stays as it is.
    const writesAfterFirst = remote.writes().length; const storedAfterFirst = await readFile(configPath, 'utf8');
    expect(await publish(service, [image('page:1', 'overview-v1', 'Übersicht'), image('page:2', 'network-v1', 'Netz')])).toMatchObject({ status: 'synced', uploaded: 0, bodyUpdated: false, syncedAt: first.syncedAt });
    expect(remote.writes()).toHaveLength(writesAfterFirst);
    expect(await readFile(configPath, 'utf8')).toBe(storedAfterFirst);

    // One page changed: new data for exactly the known attachment, and the page text is not written again.
    expect(await publish(service, [image('page:1', 'overview-v2', 'Übersicht'), image('page:2', 'network-v1', 'Netz')])).toMatchObject({ status: 'synced', uploaded: 1, bodyUpdated: false });
    expect(new URL(remote.uploads().at(-1)!.url).pathname).toBe('/wiki/rest/api/content/164037/child/attachment/att1/data');
    expect(remote.contents('page:1')).toEqual(['overview-v1', 'overview-v2']);
    expect(remote.versions('page:2')).toHaveLength(1);
    expect(remote.bodyWrites).toHaveLength(1);
    expect(remote.page.version).toBe(8);
    expect(await readFile(configPath, 'utf8')).not.toContain('alice-secret');
  });

  it('follows added and removed diagram pages and keeps edits other people made to the page', async () => {
    const { service, remote } = await setup(fakeConfluence({ body: '<p>Einleitung</p>' }));
    await link(service);
    await publish(service, [image('page:1', 'a'), image('page:2', 'b')]);
    // Somebody writes around the images and resizes one of them.
    const [one, two] = managedImageFilenames(remote.page.body, PREFIX)!;
    remote.page.body = `<p>Einleitung <em>neu</em></p><ac:image ac:width="420"><ri:attachment ri:filename="${one}" ri:version-at-save="1" /></ac:image><p>Kommentar von Bob</p><ac:image><ri:attachment ri:filename="${two}" /></ac:image><p>Schluss</p>`;
    remote.page.version = 5;
    const result = await publish(service, [image('page:1', 'a'), image('page:3', 'c')]);
    expect(result).toMatchObject({ status: 'synced', uploaded: 1, bodyUpdated: true });
    const three = fileOf('page:3');
    expect(remote.page.body).toBe(`<p>Einleitung <em>neu</em></p><ac:image ac:width="420"><ri:attachment ri:filename="${one}" ri:version-at-save="1" /></ac:image><ac:image ac:align="center" ac:layout="center" ac:alt="AWS Bedrock AgentCore – page:3" ac:width="900"><ri:attachment ri:filename="${three}" /></ac:image><p>Kommentar von Bob</p><p>Schluss</p>`);
    // The attachment of the removed page is not deleted; only its image left the page.
    expect(remote.attachments.has(two!)).toBe(true);
  });

  it('leaves an image of the same file name on another page alone and still shows the diagram on this page', async () => {
    const elsewhere = `<ac:image ac:width="340"><ri:attachment ri:filename="${fileOf('page:1')}"><ri:page ri:content-title="External architecture" ri:space-key="DOC" /></ri:attachment></ac:image>`;
    const { service, remote } = await setup(fakeConfluence({ body: `<p>Vorher</p>${elsewhere}<p>Nachher</p>` }));
    await link(service);
    expect(await publish(service, [image('page:1', 'a')])).toMatchObject({ status: 'synced', uploaded: 1, bodyUpdated: true });
    expect(remote.page.body.startsWith(`<p>Vorher</p>${elsewhere}<p>Nachher</p><ac:image ac:align="center"`)).toBe(true);
    // The page of the diagram is removed later: only the image of this page goes, the foreign reference stays.
    expect(await publish(service, [image('page:2', 'b')])).toMatchObject({ status: 'synced', bodyUpdated: true });
    expect(remote.page.body).toContain(elsewhere);
    expect(managedImageFilenames(remote.page.body, PREFIX)).toEqual([fileOf('page:2')]);
  });

  it('does not write the page text while somebody is editing it, and inserts the section once the page is quiet', async () => {
    const { service, remote } = await setup(fakeConfluence({ body: '<p>Bob tippt</p>', version: 3 }));
    await link(service);
    // A Live Doc changes its text without a new version number while the images are uploaded.
    remote.afterApplied((call) => { if (call.method === 'POST' && call.url.includes('/child/attachment')) remote.page.body = '<p>Bob tippt weiter</p>'; });
    const busy = await publish(service, [image('page:1', 'a')]);
    expect(busy).toMatchObject({ status: 'retry', uploaded: 1, bodyUpdated: false });
    expect(busy.message).toContain('wird gerade bearbeitet');
    expect(remote.bodyWrites).toEqual([]);
    expect(remote.page).toMatchObject({ body: '<p>Bob tippt weiter</p>', version: 3 });
    expect((await service.getSettings()).confluenceLive).not.toHaveProperty('lastSyncedAt');

    remote.afterApplied(null);
    const quiet = await publish(service, [image('page:1', 'a')]);
    expect(quiet).toMatchObject({ status: 'synced', uploaded: 0, bodyUpdated: true });
    expect(remote.page.body.startsWith('<p>Bob tippt weiter</p><ac:image ')).toBe(true);
    expect(remote.versions('page:1')).toHaveLength(1);
  });

  it('waits for the quiet window before it writes the page text', async () => {
    const { service, remote } = await setup(fakeConfluence({ body: '<p>ruhig</p>' }), { quiet: 120 });
    await link(service);
    const started = Date.now();
    expect(await publish(service, [image('page:1', 'a')])).toMatchObject({ status: 'synced', bodyUpdated: true });
    expect(Date.now() - started).toBeGreaterThanOrEqual(100);
    const reads = remote.calls.filter((call) => call.method === 'GET' && /\/pages\/164037\?/.test(call.url));
    // Linking, planning, the read right before the write and the confirmation after it.
    expect(reads).toHaveLength(4);
  });

  it('treats a version conflict as a retry and never forces its text over a newer page', async () => {
    const { service, remote } = await setup(fakeConfluence({ body: '<p>alt</p>', version: 3 }));
    await link(service);
    remote.intercept((call) => { if (call.method === 'PUT' && /\/api\/v2\/pages\/164037$/.test(call.url)) { remote.page.body = '<p>von Carol veröffentlicht</p>'; remote.page.version = 4; } });
    const conflict = await publish(service, [image('page:1', 'a')]);
    expect(conflict).toMatchObject({ status: 'retry', bodyUpdated: false });
    expect(conflict.message).toContain('gleichzeitig geändert');
    expect(remote.page).toMatchObject({ body: '<p>von Carol veröffentlicht</p>', version: 4 });
    remote.intercept(null);
    expect(await publish(service, [image('page:1', 'a')])).toMatchObject({ status: 'synced', uploaded: 0, bodyUpdated: true });
    expect(remote.page.body.startsWith('<p>von Carol veröffentlicht</p><ac:image ')).toBe(true);
  });

  it('reports failures truthfully and marks nothing as published', async () => {
    const { service, remote } = await setup();
    await link(service);
    const answer = (status: number) => remote.intercept(() => new Response('{}', { status }));
    answer(401); expect(await publish(service, [image('page:1', 'a')])).toMatchObject({ status: 'failed', message: expect.stringContaining('verweigert den Zugriff') });
    answer(404); expect(await publish(service, [image('page:1', 'a')])).toMatchObject({ status: 'failed', message: expect.stringContaining('nicht gefunden') });
    answer(429); expect(await publish(service, [image('page:1', 'a')])).toMatchObject({ status: 'retry', message: expect.stringContaining('Status 429') });
    answer(503); expect(await publish(service, [image('page:1', 'a')])).toMatchObject({ status: 'retry' });
    remote.intercept(() => { throw new TypeError('fetch failed'); });
    expect(await publish(service, [image('page:1', 'a')])).toMatchObject({ status: 'retry', message: expect.stringContaining('nicht erreichbar') });
    expect(remote.writes()).toEqual([]);
    expect((await service.getSettings()).confluenceLive).not.toHaveProperty('lastSyncedAt');
    // A page whose markup cannot be read safely is never rewritten.
    remote.intercept(null); remote.page.body = '<p>kaputt';
    expect(await publish(service, [image('page:1', 'a')])).toMatchObject({ status: 'failed', bodyUpdated: false, message: expect.stringContaining('nicht sicher gelesen') });
    expect(remote.bodyWrites).toEqual([]);
  });

  it('accepts rendered PNG images only', async () => {
    const { service, remote } = await setup();
    await link(service);
    const callsBefore = remote.calls.length;
    const svg = { ...image('page:1', 'a'), png: new TextEncoder().encode('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>') };
    expect(await publish(service, [svg])).toMatchObject({ status: 'failed', uploaded: 0 });
    // A PNG signature in front of something else is not a picture.
    const disguised = { ...image('page:1', 'a'), png: new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, ...new TextEncoder().encode('<script>alert(1)</script>'.repeat(4))]) };
    expect(await publish(service, [disguised])).toMatchObject({ status: 'failed', uploaded: 0 });
    expect(await publish(service, [])).toMatchObject({ status: 'failed' });
    expect(await publish(service, [image('page:1', 'a'), image('page:1', 'b')])).toMatchObject({ status: 'failed' });
    expect(await publish(service, [{ ...image('page:1', 'a'), hash: 'not-a-digest' }])).toMatchObject({ status: 'failed' });
    expect(remote.calls).toHaveLength(callsBefore);
  });
});

describe('ownership of the attachments (#210)', () => {
  it('never overwrites a file of the same name that somebody else put on the page', async () => {
    const { service, remote } = await setup(fakeConfluence({ body: '<p>Text</p>' }));
    await link(service);
    const foreign = remote.foreign(fileOf('page:1'), 'Human uploaded image', 9);
    const result = await publish(service, [image('page:1', 'a')]);
    expect(result).toMatchObject({ status: 'failed', uploaded: 0, bodyUpdated: false });
    expect(result.message).toContain('nicht von Sketchdraw');
    expect(foreign.versions).toHaveLength(9);
    expect(remote.writes()).toEqual([]);
    expect(remote.page.body).toBe('<p>Text</p>');
    // The way out is in the hands of the person: once the foreign file is gone, the diagram gets its own.
    remote.attachments.delete(fileOf('page:1'));
    expect(await publish(service, [image('page:1', 'a')])).toMatchObject({ status: 'synced', uploaded: 1 });
    expect(remote.contents('page:1')).toEqual(['a']);
  });

  it('treats a version it did not write as a conflict instead of restoring its own picture', async () => {
    const { service, remote, create } = await setup(fakeConfluence({ comments: false }));
    await link(service);
    expect(await publish(service, [image('page:1', 'a')])).toMatchObject({ status: 'synced', uploaded: 1 });
    // After a restart the remembered id and version still say that nothing needs to be sent.
    const restarted = create();
    await restarted.getSettings('project');
    expect(await publish(restarted, [image('page:1', 'a')])).toMatchObject({ status: 'synced', uploaded: 0, bodyUpdated: false });
    expect(remote.versions('page:1')).toHaveLength(1);

    // Somebody replaces the picture in Confluence. Neither the same nor a changed diagram may undo that.
    remote.foreign(fileOf('page:1'), 'Edited by Bob');
    const writesBefore = remote.writes().length;
    for (const content of ['a', 'b']) {
      const result = await publish(restarted, [image('page:1', content)]);
      expect(result).toMatchObject({ status: 'failed', uploaded: 0 });
      expect(result.message).toContain('von anderer Stelle geändert');
    }
    expect(remote.versions('page:1')).toHaveLength(2);
    expect(remote.contents('page:1').at(-1)).toBe('foreign-1');
    expect(remote.writes()).toHaveLength(writesBefore);
  });

  it('treats a file that was deleted and uploaded again under the same name as foreign', async () => {
    const { service, remote } = await setup();
    await link(service);
    await publish(service, [image('page:1', 'a')]);
    remote.attachments.delete(fileOf('page:1'));
    remote.foreign(fileOf('page:1'), '');
    const result = await publish(service, [image('page:1', 'b')]);
    expect(result).toMatchObject({ status: 'failed', uploaded: 0 });
    expect(remote.contents('page:1')).toEqual(['foreign-0']);
  });

  it('recognises pictures an earlier publication of this diagram left, and continues them', async () => {
    const { service, remote } = await setup();
    await link(service);
    await publish(service, [image('page:1', 'a'), image('page:2', 'b')]);
    // The link is made anew (or another device links the same diagram): nothing is remembered locally.
    await link(service, null); await link(service);
    const result = await publish(service, [image('page:1', 'a'), image('page:2', 'b2')]);
    expect(result).toMatchObject({ status: 'synced', uploaded: 1, bodyUpdated: false });
    expect(remote.contents('page:1')).toEqual(['a']);
    expect(remote.contents('page:2')).toEqual(['b', 'b2']);
    expect(new URL(remote.uploads().at(-1)!.url).pathname).toMatch(/\/child\/attachment\/att2\/data$/);
  });

  it('accepts an identical picture another device published and does not send it again', async () => {
    const { service, remote } = await setup();
    await link(service);
    await publish(service, [image('page:1', 'a')]);
    // Another device with the same link publishes the next state of the same diagram.
    const next = image('page:1', 'b');
    remote.attachments.get(fileOf('page:1'))!.versions.push({ bytes: next.png, comment: `Sketchdraw ${next.hash}` });
    const uploadsBefore = remote.uploads().length;
    expect(await publish(service, [next])).toMatchObject({ status: 'synced', uploaded: 0 });
    expect(remote.uploads()).toHaveLength(uploadsBefore);
    // From there this device continues normally.
    expect(await publish(service, [image('page:1', 'c')])).toMatchObject({ status: 'synced', uploaded: 1 });
    expect(remote.contents('page:1')).toEqual(['a', 'b', 'c']);
  });
});

describe('uploads whose answer got lost (#210)', () => {
  it('recognises its own upload by the digest Confluence returns and does not repeat it', async () => {
    const { service, remote, storedLink } = await setup(fakeConfluence({ body: '<p>Text</p>' }));
    await link(service);
    // The upload arrives, the answer does not.
    remote.afterApplied((call) => { if (call.method === 'POST' && call.url.includes('/child/attachment')) throw new TypeError('socket hang up'); });
    const lostUpload = await publish(service, [image('page:1', 'a')]);
    expect(lostUpload).toMatchObject({ status: 'retry', uploaded: 0, bodyUpdated: false });
    expect(lostUpload.message).toContain('nicht erreichbar');
    expect(remote.versions('page:1')).toHaveLength(1);
    // The upload was noted before it left and is still marked as sent.
    expect((await storedLink())!.pending).toEqual({ [fileOf('page:1')]: { hash: image('page:1', 'a').hash, baseVersion: 0, attachmentId: null } });

    // The page write arrives, the answer does not.
    remote.afterApplied((call) => { if (call.method === 'PUT' && /\/api\/v2\/pages\/164037$/.test(call.url)) throw new TypeError('socket hang up'); });
    const lostWrite = await publish(service, [image('page:1', 'a')]);
    expect(lostWrite).toMatchObject({ status: 'retry', uploaded: 0 });
    expect(remote.versions('page:1')).toHaveLength(1);
    expect(remote.bodyWrites).toHaveLength(1);
    expect(await storedLink()).not.toHaveProperty('pending');
    expect((await storedLink())!.published).toEqual({ [fileOf('page:1')]: { id: 'att1', version: 1, hash: image('page:1', 'a').hash } });

    remote.afterApplied(null);
    expect(await publish(service, [image('page:1', 'a')])).toMatchObject({ status: 'synced', uploaded: 0, bodyUpdated: false });
    expect(remote.versions('page:1')).toHaveLength(1);
    expect(remote.bodyWrites).toHaveLength(1);
  });

  it('pauses visibly when Confluence cannot confirm the content, across a restart, instead of creating another version', async () => {
    const { service, remote, create, storedLink } = await setup(fakeConfluence({ comments: false }));
    await link(service);
    expect(await publish(service, [image('page:1', 'a')])).toMatchObject({ status: 'synced', uploaded: 1 });
    // The next state is sent; the server applies it, the answer is lost, and no digest comes back afterwards.
    remote.afterApplied((call) => { if (call.method === 'POST' && call.url.endsWith('/data')) throw new TypeError('socket hang up'); });
    expect(await publish(service, [image('page:1', 'b')])).toMatchObject({ status: 'retry', uploaded: 0 });
    remote.afterApplied(null);
    expect(remote.contents('page:1')).toEqual(['a', 'b']);
    expect((await storedLink())!.pending).toEqual({ [fileOf('page:1')]: { hash: image('page:1', 'b').hash, baseVersion: 1, attachmentId: 'att1' } });

    const uploadsBefore = remote.uploads().length;
    for (const candidate of [service, create()]) {
      await candidate.getSettings('project');
      const result = await publish(candidate, [image('page:1', 'b')]);
      expect(result).toMatchObject({ status: 'failed', uploaded: 0 });
      expect(result.message).toContain('bestätigt seinen Inhalt nicht');
      expect((await candidate.getSettings()).confluenceLive?.lastSyncedAt).toBeDefined();
    }
    // No second copy of the same picture, and the doubt is still on record.
    expect(remote.uploads()).toHaveLength(uploadsBefore);
    expect(remote.versions('page:1')).toHaveLength(2);
    expect((await storedLink())!.pending).toBeDefined();
  });

  it('sends again when Confluence shows that the lost upload never arrived', async () => {
    const { service, remote, storedLink } = await setup(fakeConfluence({ comments: false }));
    await link(service);
    await publish(service, [image('page:1', 'a')]);
    // The request dies before the server sees it.
    remote.intercept((call) => { if (call.method === 'POST' && call.url.endsWith('/data')) throw new TypeError('connect ECONNRESET'); });
    expect(await publish(service, [image('page:1', 'b')])).toMatchObject({ status: 'retry', uploaded: 0 });
    expect((await storedLink())!.pending).toBeDefined();
    remote.intercept(null);
    expect(await publish(service, [image('page:1', 'b')])).toMatchObject({ status: 'synced', uploaded: 1 });
    expect(remote.contents('page:1')).toEqual(['a', 'b']);
    expect(await storedLink()).not.toHaveProperty('pending');
  });

  it('sends nothing when the intention to upload cannot be recorded first', async () => {
    const { service, remote, configPath } = await setup();
    await link(service);
    // Another app instance changed the profile file: this instance may not write it any more (#181).
    await writeFile(configPath, `${await readFile(configPath, 'utf8')}\n`);
    const result = await publish(service, [image('page:1', 'a')]);
    expect(result).toMatchObject({ status: 'failed', uploaded: 0 });
    expect(result.message).toContain('nichts übertragen');
    expect(remote.writes()).toEqual([]);
  });
});

describe('the stored record of a link when publications are cancelled (#210, CF-210-10)', () => {
  /** What the profile file says about the link, read from disk. */
  const record = async (storedLink: () => Promise<Record<string, unknown> | undefined>) => { const stored = await storedLink(); return { published: stored?.published, pending: stored?.pending, lastSyncedAt: stored?.lastSyncedAt }; };

  it('keeps the known attachments when a running and a waiting publication lose their authority, so a later foreign version stays a conflict', async () => {
    const { service, remote, create, storedLink } = await setup(fakeConfluence({ body: '<p>Text</p>' }));
    await link(service);
    expect(await publish(service, [image('page:1', 'a')])).toMatchObject({ status: 'synced', uploaded: 1 });
    const before = await record(storedLink);
    expect(before.published).toEqual({ [fileOf('page:1')]: { id: 'att1', version: 1, hash: image('page:1', 'a').hash } });

    // One publication waits for its first answer, a second one waits behind it; then the authority ends.
    const hold = gate(remote, (call) => call.method === 'GET' && /\/pages\/164037\?/.test(call.url));
    const running = publish(service, [image('page:1', 'b')]);
    const queued = publish(service, [image('page:1', 'c')]);
    await hold.blocked;
    await service.configureAtlassian(alice({ apiToken: undefined }));
    const writesBefore = remote.writes().length;
    hold.open();
    expect(await running).toMatchObject({ status: 'cancelled', uploaded: 0, bodyUpdated: false });
    expect(await queued).toMatchObject({ status: 'cancelled', uploaded: 0, bodyUpdated: false });
    expect(remote.writes()).toHaveLength(writesBefore);
    // Neither the job that had begun nor the one that never began touched the record.
    expect(await record(storedLink)).toEqual(before);

    // Another writer publishes its own state of the diagram: a recognised Sketchdraw version, but not ours.
    const other = image('page:1', 'other-writer');
    const attachment = remote.attachments.get(fileOf('page:1'))!;
    for (let version = 2; version <= 20; version++) attachment.versions.push({ bytes: other.png, comment: `Sketchdraw ${other.hash}` });
    const uploadsBefore = remote.uploads().length;
    for (const candidate of [service, create()]) {
      // Also after a restart the record on disk is what decides.
      await candidate.getSettings('project');
      const result = await publish(candidate, [image('page:1', 'd')]);
      expect(result).toMatchObject({ status: 'failed', uploaded: 0, bodyUpdated: false });
      expect(result.message).toContain('von anderer Stelle geändert');
    }
    expect(remote.uploads()).toHaveLength(uploadsBefore);
    expect(attachment.versions).toHaveLength(20);
    expect(contentOf(attachment.versions.at(-1)!.bytes)).toBe('other-writer');
    expect(await record(storedLink)).toEqual(before);
  });

  it('keeps the note about an unconfirmed upload when later publications are cancelled, also across a restart', async () => {
    const { service, remote, create, storedLink } = await setup(fakeConfluence({ comments: false }));
    await link(service);
    await publish(service, [image('page:1', 'a')]);
    // An upload arrives, its answer is lost, and Confluence returns no digest: the doubt is on record.
    remote.afterApplied((call) => { if (call.method === 'POST' && call.url.endsWith('/data')) throw new TypeError('socket hang up'); });
    expect(await publish(service, [image('page:1', 'b')])).toMatchObject({ status: 'retry', uploaded: 0 });
    remote.afterApplied(null);
    const before = await record(storedLink);
    expect(before.published).toEqual({ [fileOf('page:1')]: { id: 'att1', version: 1, hash: image('page:1', 'a').hash } });
    expect(before.pending).toEqual({ [fileOf('page:1')]: { hash: image('page:1', 'b').hash, baseVersion: 1, attachmentId: 'att1' } });

    for (const invalidate of [() => service.configureAtlassian(alice({ apiToken: undefined })), async () => { service.releaseRenderer(); await service.getSettings('project'); }, async () => { await service.getSettings('other'); await service.getSettings('project'); }]) {
      const hold = gate(remote, (call) => call.method === 'GET' && /\/pages\/164037\?/.test(call.url));
      const running = publish(service, [image('page:1', 'b')]);
      const queued = publish(service, [image('page:1', 'c')]);
      await hold.blocked;
      await invalidate();
      hold.open();
      expect(await running).toMatchObject({ status: 'cancelled', uploaded: 0 });
      expect(await queued).toMatchObject({ status: 'cancelled', uploaded: 0 });
      expect(await record(storedLink)).toEqual(before);
    }

    // The doubt still stops the next publication, here and after a restart, and nothing is sent.
    const uploadsBefore = remote.uploads().length;
    for (const candidate of [service, create()]) {
      await candidate.getSettings('project');
      const result = await publish(candidate, [image('page:1', 'c')]);
      expect(result).toMatchObject({ status: 'failed', uploaded: 0 });
      expect(result.message).toContain('bestätigt seinen Inhalt nicht');
    }
    expect(remote.uploads()).toHaveLength(uploadsBefore);
    expect(remote.versions('page:1')).toHaveLength(2);
    expect(await record(storedLink)).toEqual(before);
  });

  it('records what a publication really did before it lost its authority: the confirmed upload and the one still unanswered', async () => {
    const { service, remote, storedLink } = await setup(fakeConfluence({ body: '<p>Text</p>' }));
    await link(service);
    // The first image is uploaded and confirmed; the second upload is on its way when the authority ends.
    let posts = 0;
    const hold = gate(remote, (call) => call.method === 'POST' && call.url.includes('/child/attachment') && ++posts === 2);
    const running = publish(service, [image('page:1', 'a'), image('page:2', 'b')]);
    const queued = publish(service, [image('page:1', 'x'), image('page:2', 'y')]);
    await hold.blocked;
    await service.configureAtlassian(alice({ apiToken: undefined }));
    hold.open();
    expect(await running).toMatchObject({ status: 'cancelled', uploaded: 1, bodyUpdated: false });
    expect(await queued).toMatchObject({ status: 'cancelled', uploaded: 0 });
    // The server did receive the second upload; this side never learned it.
    expect(remote.contents('page:1')).toEqual(['a']);
    expect(remote.contents('page:2')).toEqual(['b']);
    expect(remote.page.body).toBe('<p>Text</p>');
    const stored = await record(storedLink);
    expect(stored.published).toEqual({ [fileOf('page:1')]: { id: 'att1', version: 1, hash: image('page:1', 'a').hash } });
    expect(stored.pending).toEqual({ [fileOf('page:2')]: { hash: image('page:2', 'b').hash, baseVersion: 0, attachmentId: null } });
    expect(stored.lastSyncedAt).toBeUndefined();

    // The next publication settles the open upload against Confluence instead of sending the picture again.
    const uploadsBefore = remote.uploads().length;
    expect(await publish(service, [image('page:1', 'a'), image('page:2', 'b')])).toMatchObject({ status: 'synced', uploaded: 0, bodyUpdated: true });
    expect(remote.uploads()).toHaveLength(uploadsBefore);
    expect(remote.versions('page:2')).toHaveLength(1);
    const settled = await record(storedLink);
    expect(settled.pending).toBeUndefined();
    expect(settled.published).toEqual({ [fileOf('page:1')]: { id: 'att1', version: 1, hash: image('page:1', 'a').hash }, [fileOf('page:2')]: { id: 'att2', version: 1, hash: image('page:2', 'b').hash } });
  });

  it('writes nothing for a publication that is cancelled before it starts, whatever state the link is in', async () => {
    const { service, remote, configPath } = await setup(fakeConfluence({ body: '<p>Text</p>' }));
    await link(service);
    await publish(service, [image('page:1', 'a'), image('page:2', 'b')]);
    const fileBefore = await readFile(configPath, 'utf8');
    // Three publications are waiting behind one that hangs; the window goes away.
    const hold = gate(remote, (call) => call.url.includes('/attachments?'));
    const jobs = [publish(service, [image('page:1', 'a2'), image('page:2', 'b')]), publish(service, [image('page:1', 'a3')]), publish(service, [image('page:3', 'c')]), publish(service, [image('page:1', 'a4'), image('page:2', 'b4')])];
    await hold.blocked;
    service.releaseRenderer();
    hold.open();
    for (const job of jobs) expect(await job).toMatchObject({ status: 'cancelled', uploaded: 0, bodyUpdated: false });
    expect(await readFile(configPath, 'utf8')).toBe(fileBefore);
    expect(remote.contents('page:1')).toEqual(['a']);
  });
});

describe('pauses the server asks for (#210)', () => {
  it('keeps every attempt away from the site until the Retry-After deadline has passed', async () => {
    let clock = Date.parse('2026-11-15T12:00:00.000Z');
    const { service, remote } = await setup(fakeConfluence({ body: '<p>Text</p>' }), { now: () => clock });
    await link(service);
    remote.intercept(() => remote.json({}, 429, { 'Retry-After': '3600' }));
    const limited = await publish(service, [image('page:1', 'a')]);
    expect(limited).toMatchObject({ status: 'retry', uploaded: 0, retryAt: '2026-11-15T13:00:00.000Z' });
    expect(limited.message).toContain('um eine Pause gebeten');
    remote.intercept(null);

    // Further edits, manual starts and other Atlassian work do not reach the server before the deadline.
    const callsAfterLimit = remote.calls.length;
    for (const offset of [0, 1_000, 3_599_000]) {
      clock = Date.parse('2026-11-15T12:00:00.000Z') + offset;
      expect(await publish(service, [image('page:1', `edit-${offset}`)])).toMatchObject({ status: 'retry', uploaded: 0, retryAt: '2026-11-15T13:00:00.000Z' });
      await expect(service.getConfluencePage('164037')).rejects.toThrow('um eine Pause gebeten');
      await expect(service.listConfluencePages('')).rejects.toThrow('um eine Pause gebeten');
    }
    expect(remote.calls).toHaveLength(callsAfterLimit);

    clock = Date.parse('2026-11-15T13:00:00.000Z');
    expect(await publish(service, [image('page:1', 'latest')])).toMatchObject({ status: 'synced', uploaded: 1, bodyUpdated: true });
    expect(remote.contents('page:1')).toEqual(['latest']);
  });

  it('understands a date as deadline, ignores a deadline in the past and limits an absurd one', async () => {
    let clock = Date.parse('2026-11-15T12:00:00.000Z');
    const { service, remote } = await setup(fakeConfluence(), { now: () => clock });
    await link(service);
    remote.intercept(() => remote.json({}, 503, { 'Retry-After': 'Sun, 15 Nov 2026 12:10:00 GMT' }));
    expect(await publish(service, [image('page:1', 'a')])).toMatchObject({ status: 'retry', retryAt: '2026-11-15T12:10:00.000Z' });
    clock = Date.parse('2026-11-15T12:10:00.000Z');
    remote.intercept(() => remote.json({}, 429, { 'Retry-After': 'Sun, 15 Nov 2026 11:00:00 GMT' }));
    const past = await publish(service, [image('page:1', 'a')]);
    expect(past).toMatchObject({ status: 'retry', message: expect.stringContaining('Status 429') });
    expect(past).not.toHaveProperty('retryAt');
    remote.intercept(() => remote.json({}, 429, { 'Retry-After': '99999999' }));
    expect(await publish(service, [image('page:1', 'a')])).toMatchObject({ status: 'retry', retryAt: '2026-11-15T18:10:00.000Z' });
    // The pause belongs to the site: after the profile points elsewhere it does not hold the other site back.
    remote.intercept(null);
    const callsBefore = remote.calls.length;
    await service.configureAtlassian(alice({ siteUrl: 'https://other.atlassian.net' }));
    await service.listConfluencePages('');
    expect(remote.calls.length).toBeGreaterThan(callsBefore);
  });
});

describe('Confluence live link over real HTTP (#210)', () => {
  it('creates and updates the image as multipart form data with the required header and updates the page as JSON', async () => {
    const state = { body: '<p>Text von Bob</p>', version: 4, attachments: new Map<string, { id: string; version: number; comment: string }>(), uploads: [] as Array<{ path: string; contentType: string; token: string; authorization: string; raw: Buffer }>, pageWrites: [] as Array<Record<string, unknown>> };
    const server = createServer((request, response) => {
      const chunks: Buffer[] = [];
      request.on('data', (chunk: Buffer) => chunks.push(chunk));
      request.on('end', () => {
        const raw = Buffer.concat(chunks); const url = new URL(request.url ?? '/', 'http://127.0.0.1');
        const send = (value: unknown, status = 200) => { response.writeHead(status, { 'Content-Type': 'application/json' }); response.end(JSON.stringify(value)); };
        const classic = '/wiki/rest/api/content/164037/child/attachment';
        if (url.pathname === '/wiki/api/v2/pages/164037/attachments') {
          const name = url.searchParams.get('filename') ?? ''; const attachment = state.attachments.get(name);
          return send({ results: attachment ? [{ id: attachment.id, title: name, status: 'current', comment: attachment.comment, version: { number: attachment.version } }] : [] });
        }
        if (url.pathname === '/wiki/api/v2/pages/164037' && request.method === 'GET') return send({ id: '164037', title: 'Architektur', subtype: 'live', version: { number: state.version }, body: { storage: { value: state.body } } });
        if (url.pathname === '/wiki/api/v2/pages/164037' && request.method === 'PUT') {
          const update = JSON.parse(raw.toString('utf8')) as { body: { value: string }; version: { number: number } };
          if (request.headers['content-type'] !== 'application/json' || update.version.number !== state.version + 1) return send({}, 409);
          state.pageWrites.push(update as unknown as Record<string, unknown>); state.body = update.body.value; state.version = update.version.number;
          return send({ id: '164037' });
        }
        if (request.method === 'POST' && (url.pathname === classic || url.pathname === `${classic}/att77/data`)) {
          state.uploads.push({ path: url.pathname, contentType: String(request.headers['content-type']), token: String(request.headers['x-atlassian-token']), authorization: String(request.headers.authorization), raw });
          const text = raw.toString('latin1'); const name = /filename="([^"]+)"/.exec(text)?.[1] ?? ''; const comment = /name="comment"\r\n\r\n([^\r]*)/.exec(text)?.[1] ?? '';
          const version = (state.attachments.get(name)?.version ?? 0) + 1; state.attachments.set(name, { id: 'att77', version, comment });
          return send(url.pathname === classic ? { results: [{ id: 'att77', title: name, version: { number: version } }] } : { id: 'att77', title: name, version: { number: version } });
        }
        return send({}, 404);
      });
    });
    await new Promise<void>((resolve) => { server.listen(0, '127.0.0.1', resolve); });
    try {
      const site = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
      const dir = await realpath(await mkdtemp(path.join(os.tmpdir(), 'sketchdraw-live-http-'))); cleanup.push(dir);
      const documentPath = path.join(dir, 'aws.sketchdraw.json'); await writeFile(documentPath, '{}');
      const persistence = { getHandleLocation: () => ({ selectedPath: documentPath, canonicalPath: documentPath, versionToken: 'sha256:x' }) } as unknown as DocumentPersistenceService;
      // No injected fetch: the service talks through the runtime's own HTTP client.
      const service = new PluginService({ configPath: path.join(dir, 'profile', 'plugins.json'), persistence, credentials: credentials(), emitEvent: vi.fn(), liveQuietWindowMs: 0 }); services.push(service);
      await service.activateDocument('project');
      await service.configureAtlassian(alice({ siteUrl: site }));
      await link(service);
      const overview = image('page:1', 'overview-pixels', 'Übersicht');
      expect(await publish(service, [overview])).toMatchObject({ status: 'synced', uploaded: 1, bodyUpdated: true });

      expect(state.uploads).toHaveLength(1);
      const upload = state.uploads[0]!;
      expect(upload.path).toBe('/wiki/rest/api/content/164037/child/attachment');
      expect(upload.contentType).toMatch(/^multipart\/form-data; boundary=/);
      expect(upload.token).toBe('nocheck');
      expect(upload.authorization).toBe(basic('alice@example.com', 'alice-secret'));
      const text = upload.raw.toString('latin1');
      expect(text).toMatch(/name="file"; filename="sketchdraw-[0-9a-f]{12}-[0-9a-f]{12}\.png"\r\nContent-Type: image\/png\r\n\r\n/);
      expect(upload.raw.includes(Buffer.from(overview.png))).toBe(true);
      expect(text).toMatch(/name="minorEdit"\r\n\r\ntrue/);
      expect(text).toContain(`Sketchdraw ${overview.hash}`);
      expect(state.pageWrites).toHaveLength(1);
      expect(state.pageWrites[0]).toMatchObject({ id: '164037', status: 'current', title: 'Architektur', version: { number: 5 }, body: { representation: 'storage' } });
      expect(state.body.startsWith('<p>Text von Bob</p><ac:image ')).toBe(true);

      expect(await publish(service, [overview])).toMatchObject({ status: 'synced', uploaded: 0, bodyUpdated: false });
      expect(state.uploads).toHaveLength(1);

      // A changed picture goes to the data endpoint of exactly the attachment that was created.
      const changed = image('page:1', 'overview-pixels-2', 'Übersicht');
      expect(await publish(service, [changed])).toMatchObject({ status: 'synced', uploaded: 1, bodyUpdated: false });
      expect(state.uploads).toHaveLength(2);
      expect(state.uploads[1]!.path).toBe('/wiki/rest/api/content/164037/child/attachment/att77/data');
      expect(state.uploads[1]!.raw.includes(Buffer.from(changed.png))).toBe(true);
      expect(state.attachments.get(fileOf('page:1'))).toMatchObject({ version: 2, comment: `Sketchdraw ${changed.hash}` });
      expect(state.pageWrites).toHaveLength(1);
    } finally { await new Promise<void>((resolve) => { server.close(() => resolve()); }); }
  });
});

describe('requests on the wire when the authority ends (#210)', () => {
  it('aborts a request that is still waiting for its answer instead of letting it finish in the background', async () => {
    let arrived!: () => void; const waiting = new Promise<void>((resolve) => { arrived = resolve; });
    let closedByClient = false; let answered = 0;
    const server = createServer((request, response) => {
      const url = new URL(request.url ?? '/', 'http://127.0.0.1');
      if (url.pathname === '/wiki/api/v2/pages/164037/attachments') {
        // This answer never comes on its own.
        request.socket.on('close', () => { closedByClient = true; });
        arrived(); return;
      }
      answered++;
      response.writeHead(200, { 'Content-Type': 'application/json' });
      response.end(JSON.stringify({ id: '164037', title: 'Architektur', version: { number: 1 }, body: { storage: { value: '<p>Text</p>' } } }));
    });
    await new Promise<void>((resolve) => { server.listen(0, '127.0.0.1', resolve); });
    try {
      const site = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
      const dir = await realpath(await mkdtemp(path.join(os.tmpdir(), 'sketchdraw-live-abort-'))); cleanup.push(dir);
      const documentPath = path.join(dir, 'aws.sketchdraw.json'); await writeFile(documentPath, '{}');
      const persistence = { getHandleLocation: () => ({ selectedPath: documentPath, canonicalPath: documentPath, versionToken: 'sha256:x' }) } as unknown as DocumentPersistenceService;
      const service = new PluginService({ configPath: path.join(dir, 'profile', 'plugins.json'), persistence, credentials: credentials(), emitEvent: vi.fn(), liveQuietWindowMs: 0 }); services.push(service);
      await service.activateDocument('project');
      await service.configureAtlassian(alice({ siteUrl: site }));
      await link(service);
      const running = publish(service, [image('page:1', 'a')]);
      await waiting;
      const started = Date.now(); const answeredBefore = answered;
      // The window goes away while the request hangs.
      service.releaseRenderer();
      expect(await running).toMatchObject({ status: 'cancelled', uploaded: 0, bodyUpdated: false });
      // Far below the request timeout of 20 seconds: the request was ended, not waited for.
      expect(Date.now() - started).toBeLessThan(2_000);
      await vi.waitFor(() => expect(closedByClient).toBe(true));
      expect(answered).toBe(answeredBefore);
    } finally { server.closeAllConnections(); await new Promise<void>((resolve) => { server.close(() => resolve()); }); }
  });
});

describe('authority of a Confluence live link (#210)', () => {
  it('publishes only the linked diagram of the linked file, and never for guests or unsaved diagrams', async () => {
    const { service, remote } = await setup();
    await link(service);
    const callsBefore = remote.calls.length;
    // Another diagram stored under the linked file name, e.g. brought in by a Git pull.
    expect(await publish(service, [image('page:1', 'a')], { documentId: 'document:foreign' })).toMatchObject({ status: 'failed', message: expect.stringContaining('anderen Diagramm') });
    // A handle of another file.
    expect(await publish(service, [image('page:1', 'a')], { handleId: 'other' })).toMatchObject({ status: 'failed' });
    await service.getSettings('other');
    expect(await publish(service, [image('page:1', 'a')], { handleId: 'other' })).toMatchObject({ status: 'failed', message: expect.stringContaining('keiner Confluence-Seite') });
    expect(await publish(service, [image('page:1', 'a')])).toMatchObject({ status: 'failed' });
    // Guest, imported and unsaved diagrams have no local project.
    await service.getSettings(null);
    expect(await publish(service, [image('page:1', 'a')])).toMatchObject({ status: 'failed', message: expect.stringContaining('lokales Diagramm') });
    await expect(link(service)).rejects.toThrow('lokales Diagramm');
    expect(remote.calls).toHaveLength(callsBefore);
  });

  it('stops a running publication when the profile changes and never uses the other profile for it', async () => {
    const { service, remote } = await setup(fakeConfluence({ body: '<p>Text</p>' }));
    await link(service);
    const hold = gate(remote, (call) => call.url.includes('/attachments?'));
    const running = publish(service, [image('page:1', 'a'), image('page:2', 'b')]);
    const queued = publish(service, [image('page:1', 'a2'), image('page:2', 'b')]);
    await hold.blocked;
    // The editor switches to a profile of another person on another site.
    await service.createProfile({ name: 'Bob' });
    await service.configureAtlassian({ enabled: true, siteUrl: 'https://bob.atlassian.net', email: 'bob@example.com', apiToken: 'bob-secret', confluenceSpaceKey: '', jiraProjectKey: 'BOB', jiraIssueType: 'Task', jqlFilter: '' });
    hold.open();
    expect(await running).toMatchObject({ status: 'cancelled', uploaded: 0, bodyUpdated: false });
    expect(await queued).toMatchObject({ status: 'cancelled', uploaded: 0 });
    expect(remote.writes()).toEqual([]);
    expect(remote.calls.every((call) => call.url.startsWith(SITE) && call.authorization === basic('alice@example.com', 'alice-secret'))).toBe(true);
    // The new profile has no link of its own; the copy of a profile does not inherit one either.
    expect(await service.getSettings()).not.toHaveProperty('confluenceLive');
    expect(await publish(service, [image('page:1', 'a')])).toMatchObject({ status: 'failed' });
    const profiles = (await service.getSettings()).profiles;
    await service.selectProfile(profiles[0]!.id);
    expect((await service.getSettings()).confluenceLive).toMatchObject({ pageId: '164037' });
    expect((await service.createProfile({ name: 'Kopie', copyFrom: profiles[0]!.id }))).not.toHaveProperty('confluenceLive');
  });

  it('never revives a publication, whatever the authority changed to and even when everything is put back', async () => {
    const scenarios: Array<[string, (service: PluginService) => Promise<unknown>]> = [
      ['another diagram in the same folder', (service) => service.getSettings('other')],
      ['another diagram and back (A → B → A)', async (service) => { await service.getSettings('other'); await service.getSettings('project'); }],
      ['no local diagram', (service) => service.getSettings(null)],
      ['no local diagram and back', async (service) => { await service.getSettings(null); await service.getSettings('project'); }],
      ['link removed', (service) => link(service, null)],
      ['link removed and made again', async (service) => { await link(service, null); await link(service); }],
      ['plugin disabled', (service) => service.configureAtlassian(alice({ enabled: false, apiToken: undefined }))],
      ['plugin disabled and enabled again', async (service) => { await service.configureAtlassian(alice({ enabled: false, apiToken: undefined })); await service.configureAtlassian(alice({ apiToken: undefined })); }],
      ['account changed', (service) => service.configureAtlassian(alice({ email: 'mallory@example.com', apiToken: 'other-secret' }))],
      ['account changed and changed back', async (service) => { await service.configureAtlassian(alice({ email: 'mallory@example.com', apiToken: 'other-secret' })); await service.configureAtlassian(alice()); }],
      ['site changed and changed back', async (service) => { await service.configureAtlassian(alice({ siteUrl: 'https://new.atlassian.net' })); await service.configureAtlassian(alice()); }],
      ['same settings saved again', (service) => service.configureAtlassian(alice({ apiToken: undefined }))],
      ['profile switched and switched back', async (service) => { const first = (await service.getSettings()).activeProfileId; await service.createProfile({ name: 'Zwei' }); await service.selectProfile(first); }],
      ['plugin uninstalled and installed again', async (service) => { await service.uninstallPlugin('jira'); await service.installPlugin('jira'); }],
      ['window reloaded, crashed or closed', async (service) => { service.releaseRenderer(); }],
      ['window gone and a new one opened the diagram', async (service) => { service.releaseRenderer(); await service.getSettings('project'); }],
      ['service disposed', async (service) => { service.dispose(); }],
    ];
    for (const [name, change] of scenarios) {
      const { service, remote } = await setup(fakeConfluence({ body: '<p>Text</p>' }));
      await link(service);
      const hold = gate(remote, (call) => call.url.includes('/attachments?'));
      const running = publish(service, [image('page:1', 'a')]);
      const queued = publish(service, [image('page:1', 'b')]);
      await hold.blocked;
      await change(service);
      // What the change itself may have read is not the point; nothing may be written from here on.
      const writesBefore = remote.writes().length; const callsBefore = remote.calls.length;
      hold.open();
      expect(await running, name).toMatchObject({ status: 'cancelled', uploaded: 0, bodyUpdated: false });
      expect(await queued, name).toMatchObject({ status: 'cancelled', uploaded: 0, bodyUpdated: false });
      expect(remote.writes(), name).toHaveLength(writesBefore);
      expect(remote.calls, name).toHaveLength(callsBefore);
      expect(remote.attachments.size, name).toBe(0);
      expect(remote.page.body, name).toBe('<p>Text</p>');
    }
  });

  it('works again for a new window after the previous one went away', async () => {
    const { service, remote } = await setup(fakeConfluence({ body: '<p>Text</p>' }));
    await link(service);
    service.releaseRenderer();
    // Without a window that named its diagram, nothing is published.
    expect(await publish(service, [image('page:1', 'a')])).toMatchObject({ status: 'failed', message: expect.stringContaining('lokales Diagramm') });
    expect(remote.writes()).toEqual([]);
    expect((await service.getSettings('project')).confluenceLive).toMatchObject({ pageId: '164037', usable: true });
    expect(await publish(service, [image('page:1', 'a')])).toMatchObject({ status: 'synced', uploaded: 1, bodyUpdated: true });
  });

  it('keeps a link of another site inert instead of sending the diagram to the new site', async () => {
    const { service, remote } = await setup();
    await link(service);
    const snapshot = await service.configureAtlassian(alice({ siteUrl: 'https://other.atlassian.net' }));
    expect(snapshot.confluenceLive).toMatchObject({ siteUrl: SITE, usable: false });
    const callsBefore = remote.calls.length;
    expect(await publish(service, [image('page:1', 'a')])).toMatchObject({ status: 'failed', message: expect.stringContaining('anderen Atlassian-Site') });
    expect(remote.calls).toHaveLength(callsBefore);
  });

  it('never takes a link from a configuration file that travels with the diagram folder', async () => {
    const dir = await realpath(await mkdtemp(path.join(os.tmpdir(), 'sketchdraw-live-legacy-'))); cleanup.push(dir);
    const documentPath = path.join(dir, 'aws.sketchdraw.json'); await writeFile(documentPath, '{}');
    await writeFile(path.join(dir, '.sketchdraw-plugins.json'), JSON.stringify({ version: 2, git: {}, atlassian: { installed: true, enabled: false, siteUrl: SITE, email: 'x@example.com', jiraProjectKey: 'SK', confluenceLinks: [{ documentPath, documentId: DOCUMENT_ID, siteUrl: SITE, pageId: '164037', pageTitle: 'Architektur', pageUrl: `${SITE}/wiki/x` }] } }));
    const remote = fakeConfluence();
    const persistence = { getHandleLocation: () => ({ selectedPath: documentPath, canonicalPath: documentPath, versionToken: 'sha256:x' }) } as unknown as DocumentPersistenceService;
    const configPath = path.join(dir, 'profile', 'plugins.json');
    const service = new PluginService({ configPath, persistence, credentials: credentials(), emitEvent: vi.fn(), fetchFn: remote.fetchFn }); services.push(service);
    const snapshot = await service.getSettings('project');
    expect(snapshot.atlassian.siteUrl).toBe(SITE);
    expect(snapshot).not.toHaveProperty('confluenceLive');
    expect(await readFile(configPath, 'utf8')).not.toContain('confluenceLinks');
  });

  it('rejects a damaged link in the profile file instead of guessing a target', async () => {
    const { service, configPath, create } = await setup();
    await link(service);
    const store = JSON.parse(await readFile(configPath, 'utf8')) as { profiles: Array<{ atlassian: { confluenceLinks: Array<Record<string, unknown>> } }> };
    store.profiles[0]!.atlassian.confluenceLinks = [{ documentPath: 'relative.json', documentId: DOCUMENT_ID, siteUrl: SITE, pageId: '1', pageTitle: 'x', pageUrl: 'y' }];
    await writeFile(configPath, JSON.stringify(store));
    const snapshot = await create().getSettings('project');
    expect(snapshot.configurationIssue).toMatchObject({ source: 'profiles', kind: 'invalid-data', blocksChanges: true });
    expect(snapshot).not.toHaveProperty('confluenceLive');
  });

  it('does not overwrite a foreign file on the strength of an attachment record without an id', async () => {
    const remote = fakeConfluence();
    const { service, configPath, create } = await setup(remote);
    await link(service);
    const store = JSON.parse(await readFile(configPath, 'utf8')) as { profiles: Array<{ atlassian: { confluenceLinks: Array<Record<string, unknown>> } }> };
    store.profiles[0]!.atlassian.confluenceLinks[0]!.published = { [fileOf('page:1')]: { hash: image('page:1', 'old').hash, version: 3 } };
    await writeFile(configPath, JSON.stringify(store));
    remote.foreign(fileOf('page:1'), '', 3);
    const restarted = create(); await restarted.getSettings('project');
    expect(await publish(restarted, [image('page:1', 'new')])).toMatchObject({ status: 'failed', uploaded: 0, message: expect.stringContaining('nicht von Sketchdraw') });
    expect(remote.writes()).toEqual([]);
  });
});

describe('window lifecycle wiring (#210)', () => {
  it('releases plugin work in the main process when the page reloads, crashes or its window closes', async () => {
    // The main process cannot run under Vitest; this reads its source. What releasing does is tested above.
    const source = await readFile(path.join(__dirname, '../../electron/main.ts'), 'utf8');
    expect(source).toMatch(/function releasePluginRenderer\(\): void \{\s*pluginService\?\.releaseRenderer\(\);\s*\}/);
    expect(source).toMatch(/'did-start-navigation'[^\n]*\n\s*if \(isMainFrame && !isInPlace\) \{[^}]*releasePluginRenderer\(\);/);
    expect(source).toMatch(/'render-process-gone', \(\) => \{[^}]*releasePluginRenderer\(\);/);
    expect(source).toMatch(/win\.on\('closed', \(\) => \{\s*disposeDirectService\(\);\s*releasePluginRenderer\(\);/);
    expect(source).toMatch(/pluginService = plugins;/);
  });
});

describe('manual send of an embedded Confluence page (#209 loss guard)', () => {
  it('writes a plain page, and refuses a rich or changed page without sending anything', async () => {
    const { service, remote } = await setup(fakeConfluence({ body: '<h2>Titel</h2><p>Einfacher Text</p>', version: 2 }));
    const loaded = await service.getConfluencePage('164037');
    expect(loaded.bodyHash).toBe(sha('<h2>Titel</h2><p>Einfacher Text</p>'));
    const sent = await service.updateConfluencePage({ pageId: '164037', title: 'Architektur', storageBody: '<h2>Titel</h2><p>Neuer Text</p>', version: 2, expectedBodyHash: loaded.bodyHash });
    expect(sent).toMatchObject({ version: 3, storageBody: '<h2>Titel</h2><p>Neuer Text</p>' });

    // The same version number, other content: a Live Doc that was edited in the meantime.
    remote.page.body = '<h2>Titel</h2><p>Von Bob geändert</p>';
    await expect(service.updateConfluencePage({ pageId: '164037', title: 'Architektur', storageBody: '<p>meins</p>', version: 3, expectedBodyHash: sent.bodyHash })).rejects.toThrow('seit dem letzten Laden geändert');
    await expect(service.updateConfluencePage({ pageId: '164037', title: 'Architektur', storageBody: '<p>meins</p>', version: 2, expectedBodyHash: sha(remote.page.body) })).rejects.toThrow('seit dem letzten Laden geändert');

    // A page with content the annotation model drops, including the diagram section of the live link.
    for (const rich of [FOREIGN, `<p>Text</p><ac:image><ri:attachment ri:filename="${PREFIX}000000000000.png" /></ac:image>`]) {
      remote.page.body = rich;
      await expect(service.updateConfluencePage({ pageId: '164037', title: 'Architektur', storageBody: '<p>flach</p>', version: 3, expectedBodyHash: sha(rich) })).rejects.toThrow('Senden würde Inhalte der Confluence-Seite entfernen');
      expect(remote.page.body).toBe(rich);
    }
    expect(remote.bodyWrites).toEqual(['<h2>Titel</h2><p>Neuer Text</p>']);
  });

  it('requires the content the annotation was loaded from; an older annotation without it is not sent', async () => {
    const { service, remote } = await setup(fakeConfluence({ body: '<p>Original text</p>', version: 3 }));
    const callsBefore = remote.calls.length;
    await expect(service.updateConfluencePage({ pageId: '164037', title: 'Local', storageBody: '<p>Old imported text plus local edit</p>', version: 3 } as never)).rejects.toThrow('keinen gesicherten Ausgangsstand');
    await expect(service.updateConfluencePage({ pageId: '164037', title: 'Local', storageBody: '<p>x</p>', version: 3, expectedBodyHash: 'short' })).rejects.toThrow('Ungültiger Seiteninhalt');
    expect(remote.calls).toHaveLength(callsBefore);
    expect(remote.page).toMatchObject({ body: '<p>Original text</p>', version: 3 });
  });

  it('never continues on another site, account, profile or diagram after reading the page', async () => {
    const changes: Array<[string, (service: PluginService) => Promise<unknown>]> = [
      ['site changed', (service) => service.configureAtlassian(alice({ siteUrl: 'https://new.example.test' }))],
      ['site changed and changed back', async (service) => { await service.configureAtlassian(alice({ siteUrl: 'https://new.example.test' })); await service.configureAtlassian(alice()); }],
      ['account changed', (service) => service.configureAtlassian(alice({ email: 'mallory@example.com', apiToken: 'other' }))],
      ['profile changed', (service) => service.createProfile({ name: 'Zwei' })],
      ['diagram changed', (service) => service.getSettings('other')],
      ['window gone', async (service) => { service.releaseRenderer(); }],
    ];
    for (const [name, change] of changes) {
      const { service, remote } = await setup(fakeConfluence({ body: '<p>Original text</p>', version: 3 }));
      const hold = gate(remote, (call) => call.method === 'GET' && /\/pages\/164037\?/.test(call.url));
      const sending = service.updateConfluencePage({ pageId: '164037', title: 'Original', storageBody: '<p>Local text</p>', version: 3, expectedBodyHash: sha('<p>Original text</p>') });
      const outcome = sending.then(() => 'resolved', (error: Error) => error.message);
      await hold.blocked;
      await change(service);
      const callsBefore = remote.calls.length;
      hold.open();
      expect(await outcome, name).toMatch(/abgebrochen|geändert/);
      // No request at all after the read, in particular no write to wherever the settings point now.
      expect(remote.calls, name).toHaveLength(callsBefore);
      expect(remote.writes(), name).toEqual([]);
      expect(remote.page, name).toMatchObject({ body: '<p>Original text</p>', version: 3 });
    }
  });
});

describe('Confluence live link of one diagram page (#240)', () => {
  const linkPage = (service: PluginService, diagramPageId: string, pageId: string | null = '164037', diagramPageIds?: string[]) =>
    service.setConfluenceLiveLink({ handleId: 'project', documentId: DOCUMENT_ID, pageId, diagramPageId, ...(diagramPageIds ? { diagramPageIds } : {}) });
  const publishPage = (service: PluginService, diagramPageId: string, images: ConfluenceLiveImage[]) =>
    service.publishConfluenceLive({ handleId: 'project', documentId: DOCUMENT_ID, title: 'AWS Bedrock AgentCore', diagramPageId, images });
  const storedAtlassian = async (configPath: string) => (JSON.parse(await readFile(configPath, 'utf8')) as { profiles: Array<{ atlassian: { confluenceLinks?: Array<Record<string, unknown>>; confluencePageLinks?: Array<Record<string, unknown>> } }> }).profiles[0]!.atlassian;
  /** Two Confluence pages behind one site. */
  function twoPages() {
    const first = fakeConfluence({ pageId: '164037', body: '<p>Erste Seite</p>' });
    const second = fakeConfluence({ pageId: '200200', body: '<p>Zweite Seite</p>' });
    const fetchFn = ((input: string | URL | Request, init?: RequestInit) => (String(input).includes('/200200') ? second.fetchFn : first.fetchFn)(input, init)) as typeof fetch;
    return { first, second, remote: { ...first, fetchFn } };
  }

  it('belongs to one page of the diagram, lives in the profile and survives a restart', async () => {
    const { service, documentPath, configPath, create } = await setup();
    const diagramBefore = await readFile(documentPath, 'utf8');
    const snapshot = await linkPage(service, 'page:2');
    expect(snapshot).not.toHaveProperty('confluenceLive');
    expect(snapshot.confluencePageLinks).toEqual([{ diagramPageId: 'page:2', pageId: '164037', pageTitle: 'Architektur', pageUrl: `${SITE}/wiki/pages/viewpage.action?pageId=164037`, siteUrl: SITE, documentId: DOCUMENT_ID, usable: true }]);
    expect(JSON.stringify(snapshot)).not.toContain('alice-secret');
    const stored = await storedAtlassian(configPath);
    expect(stored).not.toHaveProperty('confluenceLinks');
    expect(stored.confluencePageLinks).toHaveLength(1);
    expect(stored.confluencePageLinks![0]).toMatchObject({ documentPath, documentId: DOCUMENT_ID, diagramPageId: 'page:2', siteUrl: SITE, pageId: '164037' });
    expect(JSON.stringify(snapshot)).not.toContain(String(stored.confluencePageLinks![0]!.token));
    expect(await readFile(documentPath, 'utf8')).toBe(diagramBefore);

    const restarted = create();
    expect((await restarted.getSettings('project')).confluencePageLinks).toMatchObject([{ diagramPageId: 'page:2', pageId: '164037', usable: true }]);
    expect(await restarted.getSettings('other')).not.toHaveProperty('confluencePageLinks');
    expect(await restarted.getSettings(null)).not.toHaveProperty('confluencePageLinks');

    await restarted.getSettings('project');
    await linkPage(restarted, 'page:1');
    expect(((await restarted.getSettings()).confluencePageLinks ?? []).map((entry) => entry.diagramPageId).sort()).toEqual(['page:1', 'page:2']);
    expect((await linkPage(restarted, 'page:2', null)).confluencePageLinks).toMatchObject([{ diagramPageId: 'page:1' }]);
    expect(await linkPage(restarted, 'page:1', null)).not.toHaveProperty('confluencePageLinks');
    expect(await storedAtlassian(configPath)).not.toHaveProperty('confluencePageLinks');
  });

  it('refuses a page the account cannot read, an invalid target and a diagram that is not open', async () => {
    const { service, remote } = await setup();
    await expect(linkPage(service, 'page:1', '999')).rejects.toThrow('Atlassian antwortete mit 404.');
    await expect(linkPage(service, 'page:1', '../164037')).rejects.toThrow('ungültig');
    await expect(linkPage(service, '')).rejects.toThrow('Diagrammseite');
    await expect(service.setConfluenceLiveLink({ handleId: 'other', documentId: DOCUMENT_ID, pageId: '164037', diagramPageId: 'page:1' })).rejects.toThrow('gehört nicht zum aktuellen Projektordner');
    expect(await service.getSettings()).not.toHaveProperty('confluencePageLinks');
    await service.configureAtlassian(alice({ enabled: false, apiToken: undefined }));
    await expect(linkPage(service, 'page:1')).rejects.toThrow('deaktiviert');
    expect(remote.writes()).toEqual([]);
  });

  it('publishes exactly the image of its page and keeps every other content of the Confluence page', async () => {
    const { service, remote, configPath } = await setup(fakeConfluence({ body: FOREIGN, version: 7 }));
    await linkPage(service, 'page:2');
    const first = await publishPage(service, 'page:2', [image('page:2', 'network-v1', 'Netz')]);
    expect(first).toMatchObject({ status: 'synced', uploaded: 1, bodyUpdated: true });
    expect(remote.contents('page:2')).toEqual(['network-v1']);
    expect(remote.contents('page:1')).toEqual([]);
    expect(remote.page.body.startsWith(FOREIGN)).toBe(true);
    expect(managedImageFilenames(remote.page.body, PREFIX)).toEqual([fileOf('page:2')]);
    expect(remote.page.body).toContain('ac:alt="AWS Bedrock AgentCore – Netz"');
    expect((await storedAtlassian(configPath)).confluencePageLinks![0]).toMatchObject({ published: { [fileOf('page:2')]: { version: 1, hash: sha('page:2:network-v1') } } });

    // Nothing changed: no upload, no page version. A change: one new attachment version, the page text stays.
    const versionBefore = remote.page.version;
    expect(await publishPage(service, 'page:2', [image('page:2', 'network-v1', 'Netz')])).toMatchObject({ status: 'synced', uploaded: 0, bodyUpdated: false });
    expect(await publishPage(service, 'page:2', [image('page:2', 'network-v2', 'Netz')])).toMatchObject({ status: 'synced', uploaded: 1, bodyUpdated: false });
    expect(remote.contents('page:2')).toEqual(['network-v1', 'network-v2']);
    expect(remote.page.version).toBe(versionBefore);
  });

  it('only accepts the one image of the linked page', async () => {
    const { service, remote } = await setup();
    await linkPage(service, 'page:2');
    expect(await publishPage(service, 'page:2', [image('page:1', 'a')])).toMatchObject({ status: 'failed', message: 'Ungültige Confluence-Veröffentlichung.' });
    expect(await publishPage(service, 'page:2', [image('page:2', 'a'), image('page:1', 'b')])).toMatchObject({ status: 'failed', message: 'Ungültige Confluence-Veröffentlichung.' });
    expect(await publishPage(service, 'page:1', [image('page:1', 'a')])).toMatchObject({ status: 'failed', message: 'Diese Seite ist mit keiner Confluence-Seite verknüpft.' });
    // The link of a page is no link of the whole diagram.
    expect(await publish(service, [image('page:1', 'a'), image('page:2', 'b')])).toMatchObject({ status: 'failed', message: 'Dieses Diagramm ist mit keiner Confluence-Seite verknüpft.' });
    expect(remote.writes()).toEqual([]);
  });

  it('lets several pages of a diagram share one Confluence page without touching each other', async () => {
    const { service, remote } = await setup(fakeConfluence({ body: FOREIGN }));
    await linkPage(service, 'page:1');
    await linkPage(service, 'page:2');
    expect(await publishPage(service, 'page:1', [image('page:1', 'overview-v1', 'Übersicht')])).toMatchObject({ status: 'synced', uploaded: 1, bodyUpdated: true });
    expect(await publishPage(service, 'page:2', [image('page:2', 'network-v1', 'Netz')])).toMatchObject({ status: 'synced', uploaded: 1, bodyUpdated: true });
    expect(managedImageFilenames(remote.page.body, PREFIX)).toEqual([fileOf('page:1'), fileOf('page:2')]);

    const bodyBefore = remote.page.body; const versionBefore = remote.page.version;
    expect(await publishPage(service, 'page:1', [image('page:1', 'overview-v2', 'Übersicht')])).toMatchObject({ status: 'synced', uploaded: 1, bodyUpdated: false });
    expect(remote.contents('page:1')).toEqual(['overview-v1', 'overview-v2']);
    expect(remote.contents('page:2')).toEqual(['network-v1']);
    expect(remote.page).toMatchObject({ body: bodyBefore, version: versionBefore });

    // Unlinking one page stops its publication; its image and the other page stay as they are.
    await linkPage(service, 'page:1', null);
    expect(await publishPage(service, 'page:1', [image('page:1', 'overview-v3')])).toMatchObject({ status: 'failed' });
    expect(await publishPage(service, 'page:2', [image('page:2', 'network-v2', 'Netz')])).toMatchObject({ status: 'synced', uploaded: 1, bodyUpdated: false });
    expect(remote.page).toMatchObject({ body: bodyBefore, version: versionBefore });
    expect(remote.contents('page:1')).toEqual(['overview-v1', 'overview-v2']);
  });

  it('sends each page to its own Confluence page', async () => {
    const { first, second, remote } = twoPages();
    const { service } = await setup(remote);
    await linkPage(service, 'page:1', '164037');
    await linkPage(service, 'page:2', '200200');
    expect((await service.getSettings()).confluencePageLinks?.map((entry) => [entry.diagramPageId, entry.pageId]).sort()).toEqual([['page:1', '164037'], ['page:2', '200200']]);
    expect(await publishPage(service, 'page:1', [image('page:1', 'overview', 'Übersicht')])).toMatchObject({ status: 'synced', uploaded: 1, bodyUpdated: true });
    expect(await publishPage(service, 'page:2', [image('page:2', 'network', 'Netz')])).toMatchObject({ status: 'synced', uploaded: 1, bodyUpdated: true });
    expect(managedImageFilenames(first.page.body, PREFIX)).toEqual([fileOf('page:1')]);
    expect(managedImageFilenames(second.page.body, PREFIX)).toEqual([fileOf('page:2')]);
    expect([...first.attachments.keys()]).toEqual([fileOf('page:1')]);
    expect([...second.attachments.keys()]).toEqual([fileOf('page:2')]);

    // Moving a page to another Confluence page is a new link: nothing is remembered from the old target.
    await linkPage(service, 'page:1', '200200');
    expect(await publishPage(service, 'page:1', [image('page:1', 'overview', 'Übersicht')])).toMatchObject({ status: 'synced', uploaded: 1, bodyUpdated: true });
    expect(managedImageFilenames(second.page.body, PREFIX)).toEqual([fileOf('page:2'), fileOf('page:1')]);
    expect(managedImageFilenames(first.page.body, PREFIX)).toEqual([fileOf('page:1')]);
  });

  it('never replaces a foreign attachment or an attachment somebody else changed', async () => {
    const { service, remote } = await setup();
    await linkPage(service, 'page:1');
    remote.foreign(fileOf('page:1'));
    expect(await publishPage(service, 'page:1', [image('page:1', 'mine')])).toMatchObject({ status: 'failed', uploaded: 0 });
    expect(remote.versions('page:1')).toHaveLength(1);
    expect(remote.bodyWrites).toEqual([]);
  });

  it('turns the link of a whole diagram into one link per page without uploading or changing the Confluence page', async () => {
    const { service, remote, configPath, create } = await setup(fakeConfluence({ body: FOREIGN }));
    await link(service);
    await publish(service, [image('page:1', 'overview', 'Übersicht'), image('page:2', 'network', 'Netz')]);
    const callsBefore = remote.writes().length; const bodyBefore = remote.page.body; const versionBefore = remote.page.version;
    const syncedAt = (await service.getSettings()).confluenceLive!.lastSyncedAt;

    const converted = await service.convertConfluenceLiveLink({ handleId: 'project', documentId: DOCUMENT_ID, diagramPageIds: ['page:1', 'page:2'] });
    expect(converted).not.toHaveProperty('confluenceLive');
    expect(converted.confluencePageLinks).toEqual(['page:1', 'page:2'].map((diagramPageId) => ({ diagramPageId, pageId: '164037', pageTitle: 'Architektur', pageUrl: `${SITE}/wiki/pages/viewpage.action?pageId=164037`, siteUrl: SITE, documentId: DOCUMENT_ID, usable: true, lastSyncedAt: syncedAt })));
    const stored = await storedAtlassian(configPath);
    expect(stored).not.toHaveProperty('confluenceLinks');
    expect(stored.confluencePageLinks!.map((entry) => Object.keys(entry.published as object))).toEqual([[fileOf('page:1')], [fileOf('page:2')]]);
    expect(new Set(stored.confluencePageLinks!.map((entry) => entry.token)).size).toBe(2);

    // Each page now publishes on its own and finds Confluence up to date, also after a restart.
    const restarted = create(); await restarted.getSettings('project');
    for (const [pageId, content, name] of [['page:1', 'overview', 'Übersicht'], ['page:2', 'network', 'Netz']] as const) {
      expect(await publishPage(restarted, pageId, [image(pageId, content, name)])).toMatchObject({ status: 'synced', uploaded: 0, bodyUpdated: false });
    }
    expect(remote.writes()).toHaveLength(callsBefore);
    expect(remote.page).toMatchObject({ body: bodyBefore, version: versionBefore });
    // Converting again, or without such a link, changes nothing.
    const again = await restarted.convertConfluenceLiveLink({ handleId: 'project', documentId: DOCUMENT_ID, diagramPageIds: ['page:1', 'page:2', 'page:3'] });
    expect(again.confluencePageLinks).toHaveLength(2);
  });

  it('splits the link of the whole diagram when the first page is linked elsewhere', async () => {
    const { first, second, remote } = twoPages();
    const { service, configPath } = await setup(remote);
    await link(service);
    await publish(service, [image('page:1', 'overview'), image('page:2', 'network')]);
    // The pages of the diagram are needed to split; without them nothing is changed.
    await expect(linkPage(service, 'page:2', '200200')).rejects.toThrow('Ungültige Confluence-Verknüpfung.');
    expect((await service.getSettings()).confluenceLive).toMatchObject({ pageId: '164037' });

    const snapshot = await linkPage(service, 'page:2', '200200', ['page:1', 'page:2']);
    expect(snapshot).not.toHaveProperty('confluenceLive');
    expect(snapshot.confluencePageLinks?.map((entry) => [entry.diagramPageId, entry.pageId]).sort()).toEqual([['page:1', '164037'], ['page:2', '200200']]);
    const stored = await storedAtlassian(configPath);
    expect(stored).not.toHaveProperty('confluenceLinks');
    const moved = stored.confluencePageLinks!.find((entry) => entry.diagramPageId === 'page:2')!;
    expect(moved).not.toHaveProperty('published');

    const uploadsBefore = first.uploads().length;
    expect(await publishPage(service, 'page:1', [image('page:1', 'overview')])).toMatchObject({ status: 'synced', uploaded: 0, bodyUpdated: false });
    expect(await publishPage(service, 'page:2', [image('page:2', 'network')])).toMatchObject({ status: 'synced', uploaded: 1, bodyUpdated: true });
    expect(first.uploads()).toHaveLength(uploadsBefore);
    expect(managedImageFilenames(second.page.body, PREFIX)).toEqual([fileOf('page:2')]);
    // The first Confluence page keeps showing both images: removing one there is the user's decision.
    expect(managedImageFilenames(first.page.body, PREFIX)).toEqual([fileOf('page:1'), fileOf('page:2')]);
  });

  it('does not carry a link over that was made for another diagram stored under the same file name', async () => {
    const { service, configPath } = await setup();
    await link(service);
    const snapshot = await service.convertConfluenceLiveLink({ handleId: 'project', documentId: 'document:another', diagramPageIds: ['page:1'] });
    expect(snapshot).not.toHaveProperty('confluenceLive');
    expect(snapshot).not.toHaveProperty('confluencePageLinks');
    const stored = await storedAtlassian(configPath);
    expect(stored).not.toHaveProperty('confluenceLinks');
    expect(stored).not.toHaveProperty('confluencePageLinks');
  });

  it('stops a running publication when the link of its page is removed or moved, and leaves other pages running', async () => {
    for (const change of ['unlink', 'relink', 'other page'] as const) {
      const { service, remote } = await setup(fakeConfluence({ body: FOREIGN }));
      await linkPage(service, 'page:1');
      await linkPage(service, 'page:2');
      const hold = gate(remote, (call) => call.method === 'GET' && /\/pages\/164037\?/.test(call.url));
      const running = publishPage(service, 'page:1', [image('page:1', 'overview')]);
      await hold.blocked;
      if (change === 'unlink') await linkPage(service, 'page:1', null);
      else if (change === 'relink') { hold.open(); await linkPage(service, 'page:1'); }
      else await linkPage(service, 'page:2', null);
      hold.open();
      // Every change of a link is a new authority: what was running is not continued, whichever page it was for.
      expect(await running, change).toMatchObject({ status: 'cancelled', uploaded: 0, bodyUpdated: false });
      expect(remote.writes(), change).toEqual([]);
    }
  });

  it('keeps page links through a settings change, and a copied profile starts without them', async () => {
    const { service } = await setup();
    await linkPage(service, 'page:1');
    const saved = await service.configureAtlassian(alice({ apiToken: undefined, confluenceSpaceKey: 'DOC' }));
    expect(saved.confluencePageLinks).toMatchObject([{ diagramPageId: 'page:1', usable: true }]);
    const moved = await service.configureAtlassian(alice({ siteUrl: 'https://other.example.test' }));
    expect(moved.confluencePageLinks).toMatchObject([{ diagramPageId: 'page:1', usable: false }]);
    expect(await publishPage(service, 'page:1', [image('page:1', 'a')])).toMatchObject({ status: 'failed' });
    expect(await service.createProfile({ name: 'Kopie', copyFrom: saved.activeProfileId })).not.toHaveProperty('confluencePageLinks');
  });

  it('rejects stored page links of a wrong shape instead of repairing them', async () => {
    const { service, configPath, create } = await setup();
    await linkPage(service, 'page:1');
    const original = await readFile(configPath, 'utf8');
    const broken: Array<(atlassian: Record<string, unknown>) => void> = [
      (atlassian) => { const links = atlassian.confluencePageLinks as Array<Record<string, unknown>>; links.push({ ...links[0]! }); },
      (atlassian) => { delete (atlassian.confluencePageLinks as Array<Record<string, unknown>>)[0]!.diagramPageId; },
      (atlassian) => { (atlassian.confluencePageLinks as Array<Record<string, unknown>>)[0]!.diagramPageId = 7; },
      (atlassian) => { atlassian.confluenceLinks = atlassian.confluencePageLinks; delete atlassian.confluencePageLinks; },
      (atlassian) => { atlassian.confluencePageLinks = {}; },
    ];
    for (const breakIt of broken) {
      const store = JSON.parse(original) as { profiles: Array<{ atlassian: Record<string, unknown> }> };
      breakIt(store.profiles[0]!.atlassian);
      await writeFile(configPath, JSON.stringify(store));
      const snapshot = await create().getSettings('project');
      expect(snapshot.configurationIssue).toMatchObject({ source: 'profiles', kind: 'invalid-data', blocksChanges: true });
      expect(snapshot).not.toHaveProperty('confluencePageLinks');
    }
    await writeFile(configPath, original);
    expect((await create().getSettings('project')).confluencePageLinks).toHaveLength(1);
  });
});

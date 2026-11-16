import { promises as fsPromises } from 'node:fs';
import { mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';
const vi = { fn: (fn: any = () => {}) => fn };
import { PluginService } from '/Users/jeremyteichmann/.codex/worktrees/210-confluence-integration/de.sketchdraw.io/electron/plugin-service.ts';
import type { DocumentPersistenceService } from '/Users/jeremyteichmann/.codex/worktrees/210-confluence-integration/de.sketchdraw.io/electron/persistence.ts';
import { confluenceLiveFilePrefix, confluenceLiveFilename, managedImageFilenames, type ConfluenceLiveImage } from '/Users/jeremyteichmann/.codex/worktrees/210-confluence-integration/de.sketchdraw.io/src/domain/index.ts';
import { createHash } from 'node:crypto';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';

const cleanup: string[] = [];
const services: PluginService[] = [];

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


const probeStartedAt = new Date().toISOString();
const result: Record<string, unknown> = { probeStartedAt, scenario: 'Two successful published images; first replacement acknowledged; second replacement rejected before apply; restart with no remote digest', externalNetwork: false, concurrentSettingsWrites: false };
const journal = (entry: any) => JSON.parse(JSON.stringify({ published: entry?.published ?? {}, pending: entry?.pending ?? {} }));
try {
  const remote = fakeConfluence({ comments: false });
  const fixture = await setup(remote);
  await link(fixture.service);
  const first = await publish(fixture.service, [image('page:1', 'first-v1'), image('page:2', 'second-v1')]);
  assert.equal(first.status, 'synced'); assert.equal(first.uploaded, 2);
  const baseline = journal(await fixture.storedLink());
  const desired = [image('page:1', 'first-v2'), image('page:2', 'second-v2')];
  let replacementRequests = 0;
  remote.intercept((call) => {
    if (call.method === 'POST' && call.url.endsWith('/data')) {
      replacementRequests++;
      if (replacementRequests === 2) return remote.json({ message: 'synthetic second upload denied before apply' }, 403);
    }
  });
  const partial = await publish(fixture.service, desired);
  assert.equal(partial.status, 'failed'); assert.equal(partial.uploaded, 1); assert.equal(replacementRequests, 2);
  assert.equal(remote.versions('page:1').length, 2); assert.equal(remote.versions('page:2').length, 1);
  const persistedAfterPartial = journal(await fixture.storedLink());
  const inMemoryAfterPartial = journal((fixture.service as any).profiles[0].atlassian.confluenceLinks[0]);
  const remoteAfterPartial = { page1Versions: remote.versions('page:1').length, page2Versions: remote.versions('page:2').length, page1Contents: remote.contents('page:1'), page2Contents: remote.contents('page:2') };
  remote.intercept(null);
  fixture.service.dispose();
  const restarted = fixture.create();
  assert.equal((await restarted.getSettings('project')).confluenceLive?.usable, true);
  const uploadsBeforeRestartAttempt = remote.uploads().length;
  const restartedResult = await publish(restarted, desired);
  const restartUploadCount = remote.uploads().length - uploadsBeforeRestartAttempt;
  const persistedAfterRestart = journal(await fixture.storedLink());
  const firstFile = fileOf('page:1'); const secondFile = fileOf('page:2');
  const reproduced = persistedAfterPartial.published[firstFile]?.version === 1
    && persistedAfterPartial.pending[firstFile]?.baseVersion === 1
    && inMemoryAfterPartial.published[firstFile]?.version === 2
    && inMemoryAfterPartial.pending[firstFile] === undefined
    && restartedResult.status === 'failed'
    && restartedResult.message.includes('bestätigt seinen Inhalt nicht')
    && restartUploadCount === 0;
  Object.assign(result, { first, baseline, partial, remoteAfterPartial, persistedAfterPartial, inMemoryAfterPartial, restartedResult, restartUploadCount, persistedAfterRestart, filenames: { page1: firstFile, page2: secondFile }, findingReproduced: reproduced, productRegressionPass: !reproduced && restartedResult.status === 'synced' });
  assert.equal(reproduced, true, 'This historical probe expects the reported B8 failure; a fix requires a separate health expectation.');
  result.probeOutcome = 'Expected defect reproduced; this is not a product pass';
} catch (error) {
  result.harnessError = error instanceof Error ? { name: error.name, message: error.message, stack: error.stack } : String(error);
  process.exitCode = 2;
} finally {
  for (const service of services.splice(0)) service.dispose();
  await Promise.all(cleanup.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
  result.finishedAt = new Date().toISOString();
  await writeFile('/tmp/sketchdraw-210-b8-alias-probe/result.json', JSON.stringify(result, null, 2) + '\n');
  console.log(JSON.stringify(result, null, 2));
}

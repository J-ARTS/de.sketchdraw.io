import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { PluginService } from '../../electron/plugin-service';
import { assertAzureWikiTarget, azureWikiAttachmentName, withAzureWikiImage } from '../../electron/azure-devops-wiki';
import type { DocumentPersistenceService } from '../../electron/persistence';

// #284: the wiki of Azure DevOps, cloud and server, against a copy of its interface: find pages, link a page of the
// diagram, show it there as an image and keep it current.
const cleanup: string[] = [];
afterEach(async () => { vi.restoreAllMocks(); await Promise.all(cleanup.splice(0).map((dir) => rm(dir, { recursive: true, force: true }))); });
const credentials = () => ({ available: () => true, encrypt: (value: string) => Buffer.from(value).toString('base64'), decrypt: (value: string) => Buffer.from(value, 'base64').toString('utf8') });
const PNG = new Uint8Array(Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGP4z8DwHwAFAAH/iZk9HQAAAABJRU5ErkJggg==', 'base64'));
const hash = (letter: string) => letter.repeat(64);

interface Call { method: string; route: string; headers: Record<string, string>; body: string | undefined }
/** A small wiki: one project wiki with three pages, attachments by name, a version per page. */
function wiki(options: { base?: string; project?: string; version?: string } = {}) {
  const base = options.base ?? 'https://dev.azure.com/acme', project = options.project ?? 'Shop';
  const calls: Call[] = [];
  const pages = new Map<string, { content: string; version: number }>([
    ['/Architektur', { content: '# Architektur', version: 1 }],
    ['/Architektur/Übersicht', { content: '# Übersicht\n\nText der Seite.', version: 1 }],
    ['/Betrieb', { content: '', version: 1 }],
  ]);
  const attachments = new Map<string, string>();
  const control = { status: 0, conflictOnce: false };
  const json = (value: unknown, status = 200, headers: Record<string, string> = {}) => new Response(JSON.stringify(value), { status, headers: { 'Content-Type': 'application/json', ...headers } });
  const etag = (pagePath: string) => `"v${pages.get(pagePath)!.version}"`;
  const fetchFn = vi.fn(async (input: string | URL | Request, init?: RequestInit): Promise<Response> => {
    const url = new URL(String(input)); const method = init?.method ?? 'GET';
    const headers = init?.headers as Record<string, string>;
    const route = `${url.pathname}${url.search}`.replace(/[?&]api-version=[^&]+/, '');
    calls.push({ method, route, headers, body: typeof init?.body === 'string' ? init.body : undefined });
    if (!String(input).startsWith(`${base}/`)) return json({ message: 'unknown host' }, 404);
    if (url.searchParams.get('api-version') !== (options.version ?? '7.1')) return json({ message: 'unknown version' }, 400);
    if (headers.Authorization !== `Basic ${Buffer.from(':pat-secret').toString('base64')}`) return new Response('<html>Sign in</html>', { status: 203 });
    if (control.status) return json({ message: 'not now' }, control.status);
    const root = `${new URL(base).pathname.replace(/\/$/, '')}/${project}/_apis`;
    if (url.pathname === `${new URL(base).pathname.replace(/\/$/, '')}/_apis/projects/${project}`) return json({ name: project });
    if (url.pathname === `${root}/wiki/wikis`) return json({ value: [{ id: 'wiki-1', name: 'Shop.wiki', type: 'projectWiki' }] });
    if (url.pathname === `${root}/wiki/wikis/wiki-1/attachments` && method === 'PUT') {
      const name = url.searchParams.get('name')!;
      if (headers['Content-Type'] !== 'application/octet-stream') return json({ message: 'wrong type' }, 400);
      if (attachments.has(name)) return json({ message: `The wiki attachment '${name}' already exists.` }, 400);
      attachments.set(name, init!.body as string);
      return json({ name, path: `/.attachments/${name}` }, 201);
    }
    if (url.pathname === `${root}/wiki/wikis/wiki-1/pages`) {
      const pagePath = url.searchParams.get('path')!;
      if (method === 'GET' && url.searchParams.get('recursionLevel') === 'full') {
        return json({ path: '/', subPages: [{ path: '/Architektur', subPages: [{ path: '/Architektur/Übersicht', subPages: [] }] }, { path: '/Betrieb', subPages: [] }] });
      }
      const page = pages.get(pagePath);
      if (!page) return json({ message: 'Wiki page not found.' }, 404);
      if (method === 'GET') return json({ path: pagePath, ...(url.searchParams.get('includeContent') === 'true' ? { content: page.content } : {}) }, 200, { ETag: etag(pagePath) });
      if (method === 'PUT') {
        // Somebody else saved the page in the meantime: its version is no longer the one that was read.
        if (control.conflictOnce) { control.conflictOnce = false; page.content += '\n\nVon jemand anderem.'; page.version++; }
        if (headers['If-Match'] !== etag(pagePath)) return json({ message: 'The page was changed.' }, 412);
        page.content = (JSON.parse(init!.body as string) as { content: string }).content; page.version++;
        return json({ path: pagePath, content: page.content }, 200, { ETag: etag(pagePath) });
      }
    }
    return json({ message: `no route ${route}` }, 404);
  });
  return { fetchFn, calls, pages, attachments, control };
}

async function service(fetchFn: unknown) {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'sketchdraw-azure-wiki-')); cleanup.push(dir);
  const documentPath = path.join(dir, 'board.sketchdraw.json'); await writeFile(documentPath, '{"version":1}\n');
  const otherPath = path.join(dir, 'other.sketchdraw.json'); await writeFile(otherPath, '{"version":1}\n');
  const persistence = { getHandleLocation: (handleId: string) => handleId === 'project' ? { selectedPath: documentPath, canonicalPath: documentPath, versionToken: 'sha256:project' } : handleId === 'other' ? { selectedPath: otherPath, canonicalPath: otherPath, versionToken: 'sha256:other' } : null } as unknown as DocumentPersistenceService;
  const configPath = path.join(dir, 'profiles', 'plugins.json');
  const make = () => new PluginService({ configPath, persistence, credentials: credentials(), emitEvent: vi.fn(), fetchFn: fetchFn as typeof fetch });
  const plugins = make();
  await plugins.activateDocument('project');
  return { plugins, configPath, make };
}
const cloud = { enabled: true, variant: 'cloud' as const, organizationUrl: 'acme', project: 'Shop', workItemType: 'Task', wiqlFilter: '', readOnly: false, accessToken: 'pat-secret' };
async function connected(remote = wiki(), settings: Record<string, unknown> = cloud) {
  const context = await service(remote.fetchFn);
  await context.plugins.installPlugin('azure-devops');
  await context.plugins.configureAzureDevOps(settings as typeof cloud);
  return { ...context, remote };
}
const PAGE = 'wiki-1\n/Architektur/Übersicht';
const link = (plugins: PluginService, wikiPage: string | null = PAGE, diagramPageId = 'page:1') => plugins.setAzureWikiLiveLink({ handleId: 'project', documentId: 'doc-1', diagramPageId, wikiPage });
const publish = (plugins: PluginService, letter = 'a', diagramPageId = 'page:1') => plugins.publishAzureWikiLive({ handleId: 'project', documentId: 'doc-1', title: 'Shop', diagramPageId, images: [{ pageId: diagramPageId, name: 'Shop – Seite 1', hash: hash(letter), width: 640, height: 360, png: PNG }] });
const writes = (calls: Call[]) => calls.filter((call) => call.method !== 'GET');

describe('Azure DevOps wiki: pages', () => {
  it('finds the pages of the wikis of the project by a part of their path', async () => {
    const { plugins } = await connected();
    expect(await plugins.listAzureWikiPages('übersicht')).toEqual([{ provider: 'azure-devops', id: PAGE, title: 'Übersicht', detail: 'Shop.wiki/Architektur/Übersicht', url: 'https://dev.azure.com/acme/Shop/_wiki/wikis/wiki-1?pagePath=%2FArchitektur%2F%C3%9Cbersicht' }]);
    expect((await plugins.listAzureWikiPages('')).map((page) => page.detail)).toEqual(['Shop.wiki/Architektur', 'Shop.wiki/Betrieb', 'Shop.wiki/Architektur/Übersicht']);
  });

  it('accepts only paths inside the wiki', () => {
    expect(assertAzureWikiTarget('wiki-1', '/Architektur/Übersicht')).toEqual({ wiki: 'wiki-1', path: '/Architektur/Übersicht' });
    for (const bad of ['Architektur', '/', '/a/../b', '/a/./b', '/a?x=1', '/a#b', '/a/', '/a\nb']) expect(() => assertAzureWikiTarget('wiki-1', bad), bad).toThrow('Ungültiger Pfad der Wiki-Seite.');
    for (const bad of ['', '../wiki', 'a/b', 'a?b']) expect(() => assertAzureWikiTarget(bad, '/a'), bad).toThrow('Ungültiges Wiki.');
  });
});

describe('Azure DevOps wiki: the block of a link on a page', () => {
  const token = '0123abcd-0000-4000-8000-000000000000';
  it('goes to the end of the page and leaves the text of the page alone', () => {
    const next = withAzureWikiImage('# Übersicht\n\nText.\n', token, 'a.png', 'Shop – Seite 1', 640)!;
    expect(next).toBe(`# Übersicht\n\nText.\n\n<!-- sketchdraw:${token} -->\n![Shop – Seite 1](/.attachments/a.png =640x)\n<!-- /sketchdraw:${token} -->\n`);
    expect(withAzureWikiImage('', token, 'a.png', 'Shop', 640)).toBe(`<!-- sketchdraw:${token} -->\n![Shop](/.attachments/a.png =640x)\n<!-- /sketchdraw:${token} -->\n`);
  });
  it('is replaced where the user put it, and is left alone when it already shows the picture', () => {
    const first = withAzureWikiImage('Oben', token, 'a.png', 'Shop', 640)!;
    const moved = `${first.split('\n\n')[1]!.trimEnd()}\n\nUnten`;
    expect(withAzureWikiImage(moved, token, 'a.png', 'Shop', 640)).toBeNull();
    const next = withAzureWikiImage(moved, token, 'b.png', 'Shop', 640)!;
    expect(next.endsWith('\n\nUnten')).toBe(true); expect(next).toContain('b.png'); expect(next).not.toContain('a.png');
  });
  it('writes a title as plain alternative text and never as Markdown of its own', () => {
    expect(withAzureWikiImage('', token, 'a.png', 'A](http://evil.test) ![x', 640)).toContain('![A http://evil.test ! x](/.attachments/a.png =640x)');
    expect(azureWikiAttachmentName(token, hash('c'))).toBe('sketchdraw-0123abcd0000-cccccccccccccccccccccccc.png');
  });
});

describe('Azure DevOps wiki: showing a page of the diagram', () => {
  it('links a page, uploads its image and writes the block; an unchanged page is not sent again', async () => {
    const { plugins, remote } = await connected();
    const settings = await link(plugins);
    expect(settings.azureDevOps?.wikiPageLinks).toEqual([{ provider: 'azure-devops', diagramPageId: 'page:1', pageId: PAGE, pageTitle: 'Shop.wiki/Architektur/Übersicht', pageUrl: 'https://dev.azure.com/acme/Shop/_wiki/wikis/wiki-1?pagePath=%2FArchitektur%2F%C3%9Cbersicht', siteUrl: 'https://dev.azure.com/acme', documentId: 'doc-1', usable: true }]);
    remote.calls.length = 0;
    const result = await publish(plugins);
    expect(result).toMatchObject({ status: 'synced', uploaded: 1, bodyUpdated: true });
    const [attachment] = [...remote.attachments.entries()];
    expect(attachment![0]).toMatch(/^sketchdraw-[0-9a-f]{12}-a{24}\.png$/);
    expect(Buffer.from(attachment![1], 'base64').equals(Buffer.from(PNG))).toBe(true);
    const page = remote.pages.get('/Architektur/Übersicht')!;
    expect(page.content).toMatch(new RegExp(`^# Übersicht\\n\\nText der Seite\\.\\n\\n<!-- sketchdraw:[0-9a-f-]+ -->\\n!\\[Shop – Seite 1\\]\\(/\\.attachments/${attachment![0]} =640x\\)\\n<!-- /sketchdraw:[0-9a-f-]+ -->\\n$`));
    // The change names the version that was read.
    expect(writes(remote.calls).map((call) => [call.method, call.route.split('?')[0]!.split('/').pop(), call.headers['If-Match']])).toEqual([['PUT', 'attachments', undefined], ['PUT', 'pages', '"v1"']]);
    expect((await plugins.getSettings()).azureDevOps?.wikiPageLinks?.[0]?.lastSyncedAt).toBe(result.syncedAt);

    remote.calls.length = 0;
    expect(await publish(plugins)).toMatchObject({ status: 'synced', uploaded: 0, bodyUpdated: false });
    expect(writes(remote.calls)).toEqual([]);
  });

  it('replaces the picture after a change and keeps what the user wrote around the block', async () => {
    const { plugins, remote } = await connected();
    await link(plugins); await publish(plugins, 'a');
    const page = remote.pages.get('/Architektur/Übersicht')!;
    page.content = `${page.content}\nNachtrag unter dem Bild.`; page.version++;
    expect(await publish(plugins, 'b')).toMatchObject({ status: 'synced', uploaded: 1, bodyUpdated: true });
    expect(page.content).toMatch(/^# Übersicht\n\nText der Seite\.\n\n<!-- sketchdraw:[^\n]+\n!\[[^\n]+b{24}\.png =640x\)\n<!-- \/sketchdraw:[^\n]+\n\nNachtrag unter dem Bild\.$/);
    expect(remote.attachments.size).toBe(2);
    // Back to the first picture: its attachment is there already and is not uploaded again.
    remote.calls.length = 0;
    expect(await publish(plugins, 'a')).toMatchObject({ status: 'synced', uploaded: 0, bodyUpdated: true });
    expect(remote.attachments.size).toBe(2);
  });

  it('does not overwrite a change somebody made in the meantime; the next attempt takes it up', async () => {
    const { plugins, remote } = await connected();
    await link(plugins);
    remote.control.conflictOnce = true;
    expect(await publish(plugins)).toMatchObject({ status: 'retry', message: 'Die Wiki-Seite wurde gerade von jemand anderem geändert. Die Veröffentlichung wird wiederholt.' });
    const page = remote.pages.get('/Architektur/Übersicht')!;
    expect(page.content).toBe('# Übersicht\n\nText der Seite.\n\nVon jemand anderem.');
    expect(await publish(plugins)).toMatchObject({ status: 'synced', bodyUpdated: true });
    expect(page.content).toContain('Von jemand anderem.'); expect(page.content).toContain('/.attachments/sketchdraw-');
  });

  it('says what needs the user and what only needs time', async () => {
    const { plugins, remote } = await connected();
    await link(plugins);
    remote.control.status = 403;
    expect(await publish(plugins)).toMatchObject({ status: 'failed', message: 'Azure DevOps verweigert den Zugriff. Prüfe das Token und sein Recht „Wiki: Read & write".' });
    remote.control.status = 503;
    expect(await publish(plugins)).toMatchObject({ status: 'retry', message: 'Azure DevOps ist gerade nicht bereit (Status 503). Die Veröffentlichung wird wiederholt.' });
    remote.control.status = 0;
    remote.pages.delete('/Architektur/Übersicht');
    expect(await publish(plugins)).toMatchObject({ status: 'failed', message: 'Die verknüpfte Wiki-Seite wurde nicht gefunden oder ist für dieses Token nicht sichtbar.' });
    remote.fetchFn.mockRejectedValueOnce(new TypeError('fetch failed'));
    expect(await publish(plugins)).toMatchObject({ status: 'retry', message: 'Azure DevOps ist nicht erreichbar. Die Veröffentlichung wird wiederholt, sobald die Verbindung steht.' });
  });

  it('publishes only what is linked, for the diagram it was linked for, and only valid images', async () => {
    const { plugins, remote } = await connected();
    await link(plugins);
    remote.calls.length = 0;
    expect(await publish(plugins, 'a', 'page:2')).toMatchObject({ status: 'failed', message: 'Diese Seite ist mit keiner Wiki-Seite verknüpft.' });
    expect(await plugins.publishAzureWikiLive({ handleId: 'project', documentId: 'doc-2', title: 'Shop', diagramPageId: 'page:1', images: [{ pageId: 'page:1', name: 'x', hash: hash('a'), width: 1, height: 1, png: PNG }] })).toMatchObject({ status: 'failed', message: 'Die Verknüpfung gehört zu einem anderen Diagramm. Verknüpfe die Seite neu.' });
    expect(await plugins.publishAzureWikiLive({ handleId: 'project', documentId: 'doc-1', title: 'Shop', diagramPageId: 'page:1', images: [{ pageId: 'page:1', name: 'x', hash: hash('a'), width: 1, height: 1, png: new Uint8Array([1, 2, 3]) }] })).toMatchObject({ status: 'failed', message: 'Ungültige Wiki-Veröffentlichung.' });
    expect(await plugins.publishAzureWikiLive({ handleId: 'other', documentId: 'doc-1', title: 'Shop', diagramPageId: 'page:1', images: [{ pageId: 'page:1', name: 'x', hash: hash('a'), width: 1, height: 1, png: PNG }] })).toMatchObject({ status: 'failed' });
    expect(remote.calls).toEqual([]);
  });

  it('a link needs a page that exists and may be read; removing it leaves the wiki as it is', async () => {
    const { plugins, remote } = await connected();
    await expect(link(plugins, 'wiki-1\n/Gibt/Es/Nicht')).rejects.toThrow('Azure DevOps kennt diese Adresse, dieses Projekt oder diesen Eintrag nicht.');
    await expect(link(plugins, 'wiki-1\n/a/../b')).rejects.toThrow('Ungültiger Pfad der Wiki-Seite.');
    await expect(link(plugins, 'kein-zeilenumbruch')).rejects.toThrow('Ungültige Wiki-Seite.');
    expect((await plugins.getSettings()).azureDevOps?.wikiPageLinks).toBeUndefined();
    await link(plugins); await publish(plugins);
    const content = remote.pages.get('/Architektur/Übersicht')!.content;
    remote.calls.length = 0;
    expect((await link(plugins, null)).azureDevOps?.wikiPageLinks).toBeUndefined();
    expect(remote.calls).toEqual([]);
    expect(remote.pages.get('/Architektur/Übersicht')!.content).toBe(content);
    expect(await publish(plugins)).toMatchObject({ status: 'failed', message: 'Diese Seite ist mit keiner Wiki-Seite verknüpft.' });
  });

  it('read-only links nothing and publishes nothing', async () => {
    const { plugins, remote } = await connected();
    await link(plugins);
    await plugins.configureAzureDevOps({ ...cloud, accessToken: '', readOnly: true });
    remote.calls.length = 0;
    expect(await publish(plugins)).toMatchObject({ status: 'failed', message: 'Azure DevOps ist auf „Nur lesen" gestellt; das Wiki wird nicht geändert.' });
    await expect(link(plugins, PAGE, 'page:2')).rejects.toThrow('Azure DevOps ist auf „Nur lesen" gestellt.');
    expect(remote.calls).toEqual([]);
    // Finding pages is reading.
    expect(await plugins.listAzureWikiPages('betrieb')).toHaveLength(1);
  });

  it('a link belongs to its organization and project: after a change it waits for a new link', async () => {
    const { plugins, remote } = await connected();
    await link(plugins);
    await plugins.configureAzureDevOps({ ...cloud, accessToken: '', project: 'Lager' });
    expect((await plugins.getSettings()).azureDevOps?.wikiPageLinks?.[0]).toMatchObject({ usable: false, siteUrl: 'https://dev.azure.com/acme' });
    remote.calls.length = 0;
    expect(await publish(plugins)).toMatchObject({ status: 'failed', message: 'Die Verknüpfung gehört zu einer anderen Organisation oder einem anderen Projekt als das aktive Profil. Verknüpfe die Seite neu.' });
    expect(remote.calls).toEqual([]);
  });

  it('keeps its links in the profile, across a restart and a saved configuration, and drops them with the plugin', async () => {
    const { plugins, configPath, make } = await connected();
    await link(plugins); await link(plugins, 'wiki-1\n/Betrieb', 'page:2');
    const stored = JSON.parse(await readFile(configPath, 'utf8')) as { profiles: Array<{ azure: { wikiLinks: Array<Record<string, unknown>> } }> };
    expect(stored.profiles[0]!.azure.wikiLinks.map((entry) => [entry.diagramPageId, entry.wiki, entry.wikiName, entry.pagePath, entry.project])).toEqual([['page:1', 'wiki-1', 'Shop.wiki', '/Architektur/Übersicht', 'Shop'], ['page:2', 'wiki-1', 'Shop.wiki', '/Betrieb', 'Shop']]);
    expect(JSON.stringify(stored)).not.toContain('pat-secret');
    await plugins.configureAzureDevOps({ ...cloud, accessToken: '', workItemType: 'Bug' });
    const restarted = make(); await restarted.activateDocument('project');
    expect((await restarted.getSettings()).azureDevOps?.wikiPageLinks?.map((entry) => entry.diagramPageId)).toEqual(['page:1', 'page:2']);
    // Another diagram file has no links of this one.
    expect((await restarted.activateDocument('other')).azureDevOps?.wikiPageLinks).toBeUndefined();
    await restarted.activateDocument('project');
    expect((await restarted.uninstallPlugin('azure-devops')).azureDevOps?.wikiPageLinks).toBeUndefined();
  });

  it('a profile file with a broken wiki link is not taken over', async () => {
    const { plugins, configPath, make } = await connected();
    await link(plugins);
    const stored = JSON.parse(await readFile(configPath, 'utf8')) as { profiles: Array<{ azure: { wikiLinks: Array<Record<string, unknown>> } }> };
    stored.profiles[0]!.azure.wikiLinks[0]!.pagePath = '/a/../../b';
    await writeFile(configPath, JSON.stringify(stored));
    const restarted = make();
    expect((await restarted.getSettings()).configurationIssue).toBeDefined();
  });
});

describe('Azure DevOps Server: wiki', () => {
  it('uses the address of the collection and the version of the interface the server knows', async () => {
    const remote = wiki({ base: 'https://tfs.example.com/tfs/DefaultCollection', version: '6.0' });
    const { plugins } = await connected(remote, { ...cloud, variant: 'server', organizationUrl: 'https://tfs.example.com/tfs/DefaultCollection' });
    expect((await plugins.listAzureWikiPages('betrieb'))[0]).toMatchObject({ id: 'wiki-1\n/Betrieb', url: 'https://tfs.example.com/tfs/DefaultCollection/Shop/_wiki/wikis/wiki-1?pagePath=%2FBetrieb' });
    await link(plugins, 'wiki-1\n/Betrieb');
    expect(await publish(plugins)).toMatchObject({ status: 'synced', uploaded: 1, bodyUpdated: true });
    expect(remote.pages.get('/Betrieb')!.content).toMatch(/^<!-- sketchdraw:/);
  });
});

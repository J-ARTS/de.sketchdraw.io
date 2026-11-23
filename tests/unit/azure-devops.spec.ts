import { mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { PluginService } from '../../electron/plugin-service';
import { azureStatus, htmlToText, normalizeAzureDevOpsUrl, textToHtml } from '../../electron/azure-devops';
import type { DocumentPersistenceService } from '../../electron/persistence';

// #284: Azure Boards for Azure DevOps Services (cloud) and Azure DevOps Server, against a copy of their interface.
const cleanup: string[] = [];
afterEach(async () => { vi.restoreAllMocks(); await Promise.all(cleanup.splice(0).map((dir) => rm(dir, { recursive: true, force: true }))); });
const credentials = () => ({ available: () => true, encrypt: (value: string) => Buffer.from(value).toString('base64'), decrypt: (value: string) => Buffer.from(value, 'base64').toString('utf8') });

interface Call { method: string; url: string; headers: Record<string, string>; body: unknown }
/** A small Azure Boards: two work items, the states of the Agile process, the usual answers. */
function boards(options: { base: string; project?: string; legacyPeople?: boolean; noStates?: boolean; noIdentities?: boolean } = { base: 'https://dev.azure.com/acme' }) {
  const project = options.project ?? 'Shop';
  const calls: Call[] = [];
  const items = new Map<number, Record<string, unknown>>([
    [7, { 'System.Id': 7, 'System.Title': 'Checkout absichern', 'System.Description': '<div>Erste Zeile</div><div>Zweite &amp; letzte</div>', 'System.State': 'Active', 'System.WorkItemType': 'Task', 'System.TeamProject': project, 'System.AssignedTo': options.legacyPeople ? 'Mara Muster <mara@example.com>' : { displayName: 'Mara Muster', uniqueName: 'mara@example.com' }, 'System.ChangedDate': '2026-11-20T09:30:00Z', 'Microsoft.VSTS.Scheduling.DueDate': '2026-12-01T00:00:00Z', 'System.Tags': 'backend; sicherheit', 'System.AreaPath': 'Shop\\Checkout', 'Microsoft.VSTS.Scheduling.StoryPoints': 5 }],
    [3, { 'System.Id': 3, 'System.Title': 'Katalog laden', 'System.State': 'New', 'System.WorkItemType': 'Task', 'System.TeamProject': project, 'System.ChangedDate': '2026-11-19T08:00:00Z' }],
  ]);
  let nextId = 20;
  const json = (value: unknown, status = 200) => new Response(JSON.stringify(value), { status, headers: { 'Content-Type': 'application/json' } });
  const item = (id: number) => ({ id, fields: items.get(id) });
  const fetchFn = vi.fn(async (input: string | URL | Request, init?: RequestInit): Promise<Response> => {
    const url = String(input); const method = init?.method ?? 'GET';
    const body = typeof init?.body === 'string' ? JSON.parse(init.body) as unknown : undefined;
    calls.push({ method, url, headers: init?.headers as Record<string, string>, body });
    if (!url.startsWith(`${options.base}/`)) return json({ message: 'unknown host' }, 404);
    const authorization = (init?.headers as Record<string, string>).Authorization;
    if (authorization !== `Basic ${Buffer.from(':pat-secret').toString('base64')}`) return new Response('<html>Sign in</html>', { status: 203 });
    const route = url.slice(options.base.length).replace(/[?&]api-version=[^&]+/, '');
    if (route === `/_apis/projects/${project}`) return json({ name: project });
    if (route === `/${project}/_apis/wit/workitemtypes`) return json({ value: [{ name: 'Bug' }, { name: 'Task' }, { name: 'User Story' }] });
    if (route === `/${project}/_apis/wit/tags`) return json({ value: [{ name: 'backend' }, { name: 'sicherheit' }] });
    if (route.startsWith(`/${project}/_apis/wit/classificationnodes/areas`)) return json({ name: project, children: [{ name: 'Checkout', children: [{ name: 'Kasse' }] }, { name: 'Katalog' }] });
    if (route.startsWith(`/${project}/_apis/wit/classificationnodes/iterations`)) return options.noIdentities ? json({ message: 'not here' }, 404) : json({ name: project, children: [{ name: 'Release 12', children: [{ name: 'Sprint 3' }] }] });
    if (route === '/_apis/IdentityPicker/Identities' && method === 'POST') return options.noIdentities ? json({ message: 'not here' }, 404) : json({ results: [{ identities: [{ displayName: 'Mara Muster', mail: 'mara@example.com' }, { displayName: 'Mara Muster', mail: 'mara@example.com' }, { displayName: 'Marc Beispiel' }, { displayName: '' }] }] });
    if (route.startsWith(`/${project}/_apis/wit/wiql`)) {
      const query = (body as { query: string }).query;
      const title = /CONTAINS '((?:[^']|'')*)'/.exec(query)?.[1]?.replace(/''/g, "'"); const id = /\[System\.Id\] = (\d+)/.exec(query)?.[1];
      const found = [...items.entries()].filter(([key, fields]) => id ? key === Number(id) : title ? String(fields['System.Title']).toLowerCase().includes(title.toLowerCase()) : true).map(([key]) => ({ id: key }));
      return json({ workItems: found.sort((a, b) => b.id - a.id) });
    }
    if (route.startsWith('/_apis/wit/workitems?ids=')) return json({ value: route.split('ids=')[1]!.split(',').map(Number).reverse().map(item) });
    if (route === `/${project}/_apis/wit/workitemtypes/Task/states`) return options.noStates ? json({ message: 'not here' }, 404) : json({ value: [{ name: 'New', category: 'Proposed' }, { name: 'Active', category: 'InProgress' }, { name: 'Closed', category: 'Completed' }, { name: 'Removed', category: 'Removed' }] });
    const created = /^\/Shop\/_apis\/wit\/workitems\/\$(.+)$/.exec(route);
    if (created && method === 'POST') {
      const id = nextId++; const fields: Record<string, unknown> = { 'System.Id': id, 'System.State': 'New', 'System.WorkItemType': decodeURIComponent(created[1]!), 'System.TeamProject': project, 'System.ChangedDate': '2026-11-22T10:00:00Z' };
      for (const operation of body as Array<{ op: string; path: string; value?: unknown }>) fields[operation.path.slice('/fields/'.length)] = operation.value;
      items.set(id, fields); return json(item(id));
    }
    const single = /^\/_apis\/wit\/workitems\/(\d+)$/.exec(route);
    if (single) {
      const id = Number(single[1]); const fields = items.get(id);
      if (!fields) return json({ message: 'Work item does not exist.' }, 404);
      if (method === 'PATCH') for (const operation of body as Array<{ op: string; path: string; value?: unknown }>) {
        const name = operation.path.slice('/fields/'.length);
        if (operation.op === 'remove') { if (!(name in fields)) return json({ message: `Cannot remove ${name}.` }, 400); delete fields[name]; } else fields[name] = operation.value;
      }
      return json(item(id));
    }
    return json({ message: `no route ${route}` }, 404);
  });
  return { fetchFn, calls, items };
}

async function service(fetchFn: unknown) {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'sketchdraw-azure-')); cleanup.push(dir);
  const documentPath = path.join(dir, 'board.sketchdraw.json'); await writeFile(documentPath, '{"version":1}\n');
  const persistence = { getHandleLocation: (handleId: string) => handleId === 'project' ? { selectedPath: documentPath, canonicalPath: documentPath, versionToken: 'sha256:project' } : null } as unknown as DocumentPersistenceService;
  void realpath;
  const configPath = path.join(dir, 'profiles', 'plugins.json');
  const make = () => new PluginService({ configPath, persistence, credentials: credentials(), emitEvent: vi.fn(), fetchFn: fetchFn as typeof fetch });
  const plugins = make();
  await plugins.activateDocument('project');
  return { plugins, configPath, make };
}
const cloud = { enabled: true, variant: 'cloud' as const, organizationUrl: 'acme', project: 'Shop', workItemType: 'Task', wiqlFilter: '', readOnly: false, accessToken: 'pat-secret' };

describe('Azure DevOps: connection', () => {
  it('is a plugin that has to be installed; it keeps its token encrypted in the profile and never shows it', async () => {
    const { fetchFn } = boards();
    const { plugins, configPath } = await service(fetchFn);
    expect((await plugins.getSettings()).azureDevOps).toMatchObject({ installed: false, enabled: false, health: 'disabled' });
    await expect(plugins.configureAzureDevOps(cloud)).rejects.toThrow('Azure-DevOps-Plugin ist nicht installiert.');
    expect((await plugins.installPlugin('azure-devops')).azureDevOps).toMatchObject({ installed: true, enabled: false });

    const snapshot = await plugins.configureAzureDevOps(cloud);
    expect(snapshot.azureDevOps).toMatchObject({ installed: true, enabled: true, variant: 'cloud', organizationUrl: 'https://dev.azure.com/acme', project: 'Shop', apiVersion: '7.1', credentialStored: true, readOnly: false });
    expect(JSON.stringify(snapshot)).not.toContain('pat-secret');
    const stored = await readFile(configPath, 'utf8');
    expect(stored).not.toContain('pat-secret');
    expect(stored).toContain(Buffer.from('pat-secret').toString('base64'));
    // Jira and Confluence are untouched.
    expect(snapshot.atlassian).toMatchObject({ installed: true, enabled: false });

    expect(await plugins.testAzureDevOps()).toEqual({ ok: true, message: 'Azure DevOps: verbunden mit Projekt „Shop“' });
    expect((await plugins.getSettings()).azureDevOps).toMatchObject({ health: 'ready' });
  });

  it('needs organization, project and token to be switched on, and only speaks https', async () => {
    const { plugins } = await service(boards().fetchFn);
    await plugins.installPlugin('azure-devops');
    await expect(plugins.configureAzureDevOps({ ...cloud, accessToken: '' })).rejects.toThrow('Für Azure DevOps werden Organisation, Projekt und ein Personal Access Token benötigt.');
    await expect(plugins.configureAzureDevOps({ ...cloud, project: '' })).rejects.toThrow();
    await expect(plugins.configureAzureDevOps({ ...cloud, variant: 'server', organizationUrl: 'http://tfs.example.com/tfs/DefaultCollection' })).rejects.toThrow('Azure DevOps wird nur über https angesprochen.');
    await expect(plugins.configureAzureDevOps({ ...cloud, apiVersion: 'latest' })).rejects.toThrow('Die API-Version wird in der Form 7.1 oder 6.0 erwartet.');
    expect(normalizeAzureDevOpsUrl('https://dev.azure.com/acme/', 'cloud')).toBe('https://dev.azure.com/acme');
    expect(() => normalizeAzureDevOpsUrl('https://user:pw@dev.azure.com/acme', 'cloud')).toThrow();
  });

  it('a wrong token is reported as such; another address starts without the stored token', async () => {
    const { plugins } = await service(boards().fetchFn);
    await plugins.installPlugin('azure-devops');
    await plugins.configureAzureDevOps({ ...cloud, accessToken: 'wrong' });
    expect(await plugins.testAzureDevOps()).toEqual({ ok: false, message: 'Azure DevOps: Azure DevOps hat das Token nicht angenommen.' });
    expect((await plugins.getSettings()).azureDevOps).toMatchObject({ health: 'error' });
    await expect(plugins.configureAzureDevOps({ ...cloud, organizationUrl: 'other', accessToken: undefined })).rejects.toThrow('Personal Access Token');
  });

  it('survives a restart, is copied with its profile and disappears with the plugin', async () => {
    const { plugins, make, configPath } = await service(boards().fetchFn);
    await plugins.installPlugin('azure-devops'); await plugins.configureAzureDevOps(cloud);
    const again = make(); await again.activateDocument('project');
    expect((await again.getSettings()).azureDevOps).toMatchObject({ installed: true, enabled: true, project: 'Shop', credentialStored: true });
    const copy = await again.createProfile({ name: 'Kopie', copyFrom: 'default' });
    expect(copy.azureDevOps).toMatchObject({ enabled: true, project: 'Shop', credentialStored: true });
    const empty = await again.createProfile({ name: 'Leer' });
    expect(empty.azureDevOps).toMatchObject({ installed: false, enabled: false, credentialStored: false });
    await again.selectProfile('default');
    expect((await again.uninstallPlugin('azure-devops')).azureDevOps).toMatchObject({ installed: false, enabled: false, organizationUrl: '', credentialStored: false });
    const profiles = JSON.parse(await readFile(configPath, 'utf8')) as { profiles: Array<{ id: string; azure?: unknown }> };
    expect(profiles.profiles.find((profile) => profile.id === 'default')).not.toHaveProperty('azure');
  });

  it('a profile file with a broken Azure DevOps entry is not taken over', async () => {
    const { plugins, make, configPath } = await service(boards().fetchFn);
    await plugins.installPlugin('azure-devops'); await plugins.configureAzureDevOps(cloud);
    const stored = JSON.parse(await readFile(configPath, 'utf8')) as { profiles: Array<{ azure: Record<string, unknown> }> };
    stored.profiles[0]!.azure.organizationUrl = 'http://dev.azure.com/acme';
    await writeFile(configPath, JSON.stringify(stored));
    const again = make();
    expect((await again.getSettings()).configurationIssue).toMatchObject({ source: 'profiles', kind: 'invalid-data' });
  });
});

describe('Azure DevOps: work items', () => {
  it('names type and iteration of a work item and looks people up for the assignee', async () => {
    const { fetchFn, calls, items } = boards();
    items.get(7)!['System.WorkItemType'] = 'User Story'; items.get(7)!['System.IterationPath'] = 'Shop\\Release 12';
    const { plugins } = await service(fetchFn);
    await plugins.installPlugin('azure-devops'); await plugins.configureAzureDevOps(cloud);
    // Azure Boards has no fix version; the iteration stands where Jira names its versions.
    expect(await plugins.getWorkItem({ provider: 'azure-devops', key: '7' })).toMatchObject({ issueType: 'User Story', fixVersions: ['Shop\\Release 12'] });
    expect(await plugins.getWorkItem({ provider: 'azure-devops', key: '3' })).toMatchObject({ issueType: 'Task', fixVersions: [] });
    expect(await plugins.searchWorkItemUsers({ provider: 'azure-devops', key: '7', query: 'Mar' })).toEqual([{ name: 'Mara Muster', detail: 'mara@example.com' }, { name: 'Marc Beispiel' }]);
    const search = calls.find((call) => call.url.includes('/_apis/IdentityPicker/Identities'))!;
    expect(search.url).toContain('api-version=7.1-preview.1');
    expect(search.body).toMatchObject({ query: 'Mar', identityTypes: ['user'] });
    expect(await plugins.searchWorkItemUsers({ provider: 'azure-devops', key: '7', query: '  ' })).toEqual([]);
  });

  it('suggests types, tags, areas and iterations of the project and writes type and iteration', async () => {
    const { fetchFn, items } = boards();
    const { plugins } = await service(fetchFn);
    await plugins.installPlugin('azure-devops'); await plugins.configureAzureDevOps(cloud);
    const values = (field: 'issueType' | 'labels' | 'components' | 'fixVersions', query: string) => plugins.searchWorkItemValues({ provider: 'azure-devops', key: '7', field, query });
    expect(await values('issueType', '')).toEqual(['Bug', 'Task', 'User Story']);
    expect(await values('labels', 'sich')).toEqual(['sicherheit']);
    expect(await values('components', 'kasse')).toEqual(['Shop\\Checkout\\Kasse']);
    expect(await values('fixVersions', '')).toEqual(['Shop', 'Shop\\Release 12', 'Shop\\Release 12\\Sprint 3']);
    await plugins.updateWorkItemFields({ provider: 'azure-devops', key: '7', issueType: 'Bug', fixVersions: ['Shop\\Release 12\\Sprint 3'] });
    expect(items.get(7)).toMatchObject({ 'System.WorkItemType': 'Bug', 'System.IterationPath': 'Shop\\Release 12\\Sprint 3' });
  });

  it('leaves the assignee free text where a server has no identity search', async () => {
    const { fetchFn } = boards({ base: 'https://dev.azure.com/acme', noIdentities: true });
    const { plugins } = await service(fetchFn);
    await plugins.installPlugin('azure-devops'); await plugins.configureAzureDevOps(cloud);
    expect(await plugins.searchWorkItemUsers({ provider: 'azure-devops', key: '7', query: 'Mara' })).toEqual([]);
    // The same holds for a list of values the server does not offer.
    expect(await plugins.searchWorkItemValues({ provider: 'azure-devops', key: '7', field: 'fixVersions', query: '' })).toEqual([]);
  });

  it('reads the work items of the project in the order of the query', async () => {
    const { fetchFn, calls } = boards();
    const { plugins } = await service(fetchFn);
    await plugins.installPlugin('azure-devops'); await plugins.configureAzureDevOps(cloud);
    const items = await plugins.listAzureWorkItems();
    expect(items).toEqual([
      { provider: 'azure-devops', id: '7', key: '7', title: 'Checkout absichern', description: 'Erste Zeile\nZweite & letzte', status: 'doing', remoteStatus: 'Active', assignee: 'Mara Muster', dueDate: '2026-12-01', url: 'https://dev.azure.com/acme/Shop/_workitems/edit/7', updatedAt: '2026-11-20T09:30:00.000Z', labels: ['backend', 'sicherheit'], components: ['Shop\\Checkout'], estimate: '5', issueType: 'Task', fixVersions: [] },
      { provider: 'azure-devops', id: '3', key: '3', title: 'Katalog laden', description: '', status: 'todo', remoteStatus: 'New', url: 'https://dev.azure.com/acme/Shop/_workitems/edit/3', updatedAt: '2026-11-19T08:00:00.000Z', labels: [], components: [], issueType: 'Task', fixVersions: [] },
    ]);
    const query = calls.find((call) => call.url.includes('/wiql'))!;
    expect(query.url).toBe('https://dev.azure.com/acme/Shop/_apis/wit/wiql?$top=100&api-version=7.1');
    expect(query.body).toEqual({ query: 'SELECT [System.Id] FROM WorkItems WHERE [System.TeamProject] = @project ORDER BY [System.ChangedDate] DESC' });
  });

  it('uses the configured WIQL query', async () => {
    const { fetchFn, calls } = boards();
    const { plugins } = await service(fetchFn);
    await plugins.installPlugin('azure-devops');
    await plugins.configureAzureDevOps({ ...cloud, wiqlFilter: 'SELECT [System.Id] FROM WorkItems WHERE [System.AssignedTo] = @me' });
    await plugins.listAzureWorkItems();
    expect(calls.find((call) => call.url.includes('/wiql'))!.body).toEqual({ query: 'SELECT [System.Id] FROM WorkItems WHERE [System.AssignedTo] = @me' });
  });

  it('creates a work item of the configured type and changes title, description, person and date', async () => {
    const { fetchFn, calls, items } = boards();
    const { plugins } = await service(fetchFn);
    await plugins.installPlugin('azure-devops'); await plugins.configureAzureDevOps({ ...cloud, workItemType: 'User Story' });
    const created = await plugins.createAzureWorkItem({ title: 'Warenkorb', description: 'Zeile 1\n<b>Zeile 2</b>', assignee: 'Mara Muster', dueDate: '2026-12-24' });
    expect(created).toMatchObject({ provider: 'azure-devops', key: '20', title: 'Warenkorb', description: 'Zeile 1\n<b>Zeile 2</b>', status: 'todo', assignee: 'Mara Muster', dueDate: '2026-12-24', url: 'https://dev.azure.com/acme/Shop/_workitems/edit/20' });
    const post = calls.find((call) => call.method === 'POST' && call.url.includes('/workitems/$'))!;
    expect(post.url).toBe('https://dev.azure.com/acme/Shop/_apis/wit/workitems/$User%20Story?api-version=7.1');
    expect(post.headers['Content-Type']).toBe('application/json-patch+json');
    expect(items.get(20)!['System.Description']).toBe('<div>Zeile 1</div><div>&lt;b&gt;Zeile 2&lt;/b&gt;</div>');

    const updated = await plugins.updateAzureWorkItem({ key: '20', title: 'Warenkorb neu', assignee: null, dueDate: null });
    expect(updated).toMatchObject({ title: 'Warenkorb neu' });
    expect(updated.assignee).toBeUndefined(); expect(updated.dueDate).toBeUndefined();
    // Clearing a field that is already empty is not sent: Azure DevOps refuses such a removal.
    await expect(plugins.updateAzureWorkItem({ key: '20', assignee: null })).resolves.toMatchObject({ key: '20' });
    await expect(plugins.updateAzureWorkItem({ key: '20; DROP', title: 'x' })).rejects.toThrow();
  });

  it('moves a work item to the state of its type that stands for the column', async () => {
    const { fetchFn } = boards();
    const { plugins } = await service(fetchFn);
    await plugins.installPlugin('azure-devops'); await plugins.configureAzureDevOps(cloud);
    expect(await plugins.transitionAzureWorkItem({ key: '3', status: 'doing' })).toMatchObject({ remoteStatus: 'Active', status: 'doing' });
    expect(await plugins.transitionAzureWorkItem({ key: '3', status: 'done' })).toMatchObject({ remoteStatus: 'Closed', status: 'done' });
    // The Agile task has no state for "review".
    await expect(plugins.transitionAzureWorkItem({ key: '3', status: 'review' })).rejects.toThrow('keinen passenden Zustand');
  });

  it('read-only reads and refuses every change', async () => {
    const { fetchFn, calls } = boards();
    const { plugins } = await service(fetchFn);
    await plugins.installPlugin('azure-devops'); await plugins.configureAzureDevOps({ ...cloud, readOnly: true });
    expect(await plugins.listAzureWorkItems()).toHaveLength(2);
    const before = calls.length;
    await expect(plugins.createAzureWorkItem({ title: 'Neu', description: '' })).rejects.toThrow('Nur lesen');
    await expect(plugins.updateAzureWorkItem({ key: '7', title: 'Neu' })).rejects.toThrow('Nur lesen');
    await expect(plugins.transitionAzureWorkItem({ key: '7', status: 'done' })).rejects.toThrow('Nur lesen');
    expect(calls.length).toBe(before);
  });

  it('works for an open local diagram only, and not while the plugin is switched off', async () => {
    const { fetchFn } = boards();
    const { plugins } = await service(fetchFn);
    await plugins.installPlugin('azure-devops'); await plugins.configureAzureDevOps(cloud);
    await plugins.getSettings(null);
    await expect(plugins.listAzureWorkItems()).rejects.toThrow('Speichere oder öffne zuerst ein lokales Diagramm.');
    await plugins.activateDocument('project');
    await plugins.configureAzureDevOps({ ...cloud, enabled: false, accessToken: undefined });
    await expect(plugins.listAzureWorkItems()).rejects.toThrow('Azure-DevOps-Plugin ist deaktiviert.');
  });
});

describe('Azure DevOps: the fields of a ticket card (#283)', () => {
  it('reads one work item with tags, area and estimate, finds work items by title and by number', async () => {
    const { fetchFn } = boards();
    const { plugins } = await service(fetchFn);
    await plugins.installPlugin('azure-devops'); await plugins.configureAzureDevOps(cloud);
    expect(await plugins.getWorkItem({ provider: 'azure-devops', key: '7' })).toMatchObject({ provider: 'azure-devops', key: '7', title: 'Checkout absichern', labels: ['backend', 'sicherheit'], components: ['Shop\\Checkout'], estimate: '5' });
    expect((await plugins.searchWorkItems({ provider: 'azure-devops', query: 'katalog' })).map((item) => item.key)).toEqual(['3']);
    expect((await plugins.searchWorkItems({ provider: 'azure-devops', query: '7' })).map((item) => item.key)).toEqual(['7']);
    expect(await plugins.searchWorkItems({ provider: 'azure-devops', query: "O'Brien" })).toEqual([]);
    // Without a text the search answers with the work items that changed last: the list a card is picked from.
    expect((await plugins.searchWorkItems({ provider: 'azure-devops', query: '' })).map((item) => item.key)).toEqual(['7', '3']);
    await expect(plugins.getWorkItem({ provider: 'github' as never, key: '7' })).rejects.toThrow('Unbekanntes Ticket-System.');
  });

  it('writes the seven fields and answers with the work item as it is afterwards', async () => {
    const { fetchFn, items } = boards();
    const { plugins } = await service(fetchFn);
    await plugins.installPlugin('azure-devops'); await plugins.configureAzureDevOps(cloud);
    const updated = await plugins.updateWorkItemFields({ provider: 'azure-devops', key: '7', title: 'Checkout härten', description: 'Neu', status: 'done', assignee: 'Ada Lovelace', labels: ['backend', 'release'], components: ['Shop\\Kasse'], estimate: '8' });
    expect(updated).toMatchObject({ title: 'Checkout härten', description: 'Neu', status: 'done', remoteStatus: 'Closed', assignee: 'Ada Lovelace', labels: ['backend', 'release'], components: ['Shop\\Kasse'], estimate: '8' });
    expect(items.get(7)).toMatchObject({ 'System.Tags': 'backend; release', 'System.AreaPath': 'Shop\\Kasse', 'Microsoft.VSTS.Scheduling.StoryPoints': 8 });
    // Emptied: tags and estimate go, the area stays where it is.
    const cleared = await plugins.updateWorkItemFields({ provider: 'azure-devops', key: '7', labels: [], components: [], estimate: null });
    expect(cleared).toMatchObject({ labels: [], components: ['Shop\\Kasse'] });
    expect(cleared.estimate).toBeUndefined();
    await expect(plugins.updateWorkItemFields({ provider: 'azure-devops', key: '7', estimate: 'drei Tage' })).rejects.toThrow('Die Schätzung wird in Azure DevOps als Zahl erwartet.');
    await expect(plugins.updateWorkItemFields({ provider: 'azure-devops', key: '7', labels: ['a;b'] })).rejects.toThrow('Semikolon');
  });

  it('read-only reads the fields and writes none of them', async () => {
    const { fetchFn } = boards();
    const { plugins } = await service(fetchFn);
    await plugins.installPlugin('azure-devops'); await plugins.configureAzureDevOps({ ...cloud, readOnly: true });
    expect(await plugins.getWorkItem({ provider: 'azure-devops', key: '7' })).toMatchObject({ estimate: '5' });
    await expect(plugins.updateWorkItemFields({ provider: 'azure-devops', key: '7', labels: ['x'] })).rejects.toThrow('Nur lesen');
  });
});

describe('Jira: the fields of a ticket card (#283)', () => {
  function jira(options: { storyPoints?: boolean } = { storyPoints: true }) {
    const calls: Array<{ method: string; url: string; body: unknown }> = [];
    const issue: Record<string, unknown> = { summary: 'Login absichern', description: null, status: { name: 'In Progress' }, assignee: { displayName: 'Mara Muster' }, updated: '2026-11-20T09:30:00.000+0000', labels: ['backend'], components: [{ name: 'API' }], timetracking: { originalEstimate: '3h' }, issuetype: { name: 'Bug' }, fixVersions: [{ name: '2026.12' }, { name: '2027.1' }, { id: 'nameless' }], customfield_10016: options.storyPoints ? 5 : undefined };
    const fetchFn = vi.fn(async (input: string | URL | Request, init?: RequestInit): Promise<Response> => {
      const url = String(input); const method = init?.method ?? 'GET'; const body = typeof init?.body === 'string' ? JSON.parse(init.body) as unknown : undefined;
      calls.push({ method, url, body });
      const json = (value: unknown) => new Response(JSON.stringify(value), { headers: { 'Content-Type': 'application/json' } });
      if (url.endsWith('/rest/api/3/field')) return json(options.storyPoints ? [{ id: 'summary', name: 'Summary', custom: false }, { id: 'customfield_10016', name: 'Story point estimate', custom: true }] : [{ id: 'summary', name: 'Summary', custom: false }]);
      if (url.includes('/rest/api/3/search/jql')) return json({ issues: [{ id: '100', key: 'SK-1', fields: issue }] });
      if (url.includes('/rest/api/3/issue/SK-1/editmeta')) return json({ fields: { issuetype: { allowedValues: [{ name: 'Bug' }, { name: 'Story' }, { name: 'Task' }] }, components: { allowedValues: [{ name: 'API' }, { name: 'Web' }] }, fixVersions: { allowedValues: [{ name: '2026.12' }, { name: '2027.1' }, { name: '2025.1', archived: true }] } } });
      if (url.includes('/rest/api/3/jql/autocompletedata/suggestions')) return json({ results: [{ value: 'backend', displayName: '<b>back</b>end' }, { value: '"back office"' }, { value: '' }] });
      if (url.includes('/rest/api/3/user/assignable/search')) return json([{ accountId: 'a1', displayName: 'Nora Vogel', emailAddress: 'nora.vogel@example.com' }, { accountId: 'a2', displayName: 'Nora Winter' }, { accountId: 'a3', displayName: '  ' }]);
      if (url.includes('/rest/api/3/issue/SK-1') && method === 'PUT') { Object.assign(issue, (body as { fields: Record<string, unknown> }).fields); return new Response(''); }
      if (url.includes('/rest/api/3/issue/SK-1')) return json({ id: '100', key: 'SK-1', fields: issue });
      return json({});
    });
    return { fetchFn, calls, issue };
  }
  const atlassian = { enabled: true, siteUrl: 'https://example.atlassian.net', email: 'user@example.com', apiToken: 'secret', confluenceSpaceKey: '', jiraProjectKey: 'SK', jiraIssueType: 'Task', jqlFilter: '' };

  it('reads labels, components and story points, and searches by text and by key', async () => {
    const { fetchFn, calls } = jira();
    const { plugins } = await service(fetchFn);
    await plugins.configureAtlassian(atlassian);
    expect(await plugins.getWorkItem({ provider: 'jira', key: 'SK-1' })).toMatchObject({ provider: 'jira', key: 'SK-1', title: 'Login absichern', status: 'doing', labels: ['backend'], components: ['API'], estimate: '5', url: 'https://example.atlassian.net/browse/SK-1' });
    expect(calls.find((call) => call.url.includes('/issue/SK-1'))!.url).toContain('labels,components,timetracking,issuetype,fixVersions,customfield_10016');
    // The type and the fix versions of the ticket come along; a version without a name is left out.
    expect(await plugins.getWorkItem({ provider: 'jira', key: 'SK-1' })).toMatchObject({ issueType: 'Bug', fixVersions: ['2026.12', '2027.1'] });
    // People are looked up among those the ticket can be assigned to.
    expect(await plugins.searchWorkItemUsers({ provider: 'jira', key: 'SK-1', query: 'Nora' })).toEqual([{ name: 'Nora Vogel', detail: 'nora.vogel@example.com' }, { name: 'Nora Winter' }]);
    const userSearch = new URL(calls.find((call) => call.url.includes('/user/assignable/search'))!.url);
    expect(Object.fromEntries(userSearch.searchParams)).toEqual({ query: 'Nora', maxResults: '10', issueKey: 'SK-1' });
    // The field list of the site is asked once.
    await plugins.getWorkItem({ provider: 'jira', key: 'SK-1' });
    expect(calls.filter((call) => call.url.endsWith('/rest/api/3/field'))).toHaveLength(1);
    expect((await plugins.searchWorkItems({ provider: 'jira', query: 'Login "x"' })).map((item) => item.key)).toEqual(['SK-1']);
    // The search looks in every project of the site; a ticket card is not bound to the project of the task board.
    expect((calls.at(-1)!.body as { jql: string }).jql).toBe('summary ~ "Login  x *" ORDER BY updated DESC');
    // Without a text: the tickets that changed last, with their type, for the list a card is picked from.
    expect(await plugins.searchWorkItems({ provider: 'jira', query: '' })).toMatchObject([{ key: 'SK-1', issueType: 'Bug', assignee: 'Mara Muster' }]);
    expect(calls.at(-1)!.body).toMatchObject({ jql: 'updated >= -180d ORDER BY updated DESC', maxResults: 100, fields: expect.arrayContaining(['issuetype', 'assignee', 'status']) as unknown });
    await plugins.searchWorkItems({ provider: 'jira', query: 'sk-1' });
    expect((calls.at(-1)!.body as { jql: string }).jql).toBe('key = "SK-1"');
  });

  it('writes labels, components and the estimate into the field the site has for it', async () => {
    const { fetchFn, issue } = jira();
    const { plugins } = await service(fetchFn);
    await plugins.configureAtlassian(atlassian);
    const updated = await plugins.updateWorkItemFields({ provider: 'jira', key: 'SK-1', labels: ['backend', 'release'], components: ['API', 'Web'], estimate: '8' });
    expect(updated).toMatchObject({ labels: ['backend', 'release'], components: ['API', 'Web'], estimate: '8' });
    expect(issue).toMatchObject({ labels: ['backend', 'release'], components: [{ name: 'API' }, { name: 'Web' }], customfield_10016: 8 });
    await expect(plugins.updateWorkItemFields({ provider: 'jira', key: 'SK-1', labels: ['zwei wörter'] })).rejects.toThrow('Ein Jira-Label darf keine Leerzeichen enthalten.');
  });

  it('suggests types, components, versions and labels while they are typed, and writes type and fix versions', async () => {
    const { fetchFn, calls, issue } = jira();
    const { plugins } = await service(fetchFn);
    await plugins.configureAtlassian(atlassian);
    const values = (field: 'issueType' | 'labels' | 'components' | 'fixVersions', query: string) => plugins.searchWorkItemValues({ provider: 'jira', key: 'SK-1', field, query });
    // What the edit screen of the ticket allows; an archived version is not offered.
    expect(await values('issueType', '')).toEqual(['Bug', 'Story', 'Task']);
    expect(await values('issueType', 'st')).toEqual(['Story']);
    expect(await values('components', 'we')).toEqual(['Web']);
    expect(await values('fixVersions', '202')).toEqual(['2026.12', '2027.1']);
    // The edit screen is read once for all of them.
    expect(calls.filter((call) => call.url.includes('/editmeta'))).toHaveLength(1);
    // Labels belong to the site; Jira suggests them for the typed text.
    expect(await values('labels', 'back')).toEqual(['backend', 'back office']);
    expect(new URL(calls.at(-1)!.url).searchParams.get('fieldValue')).toBe('back');
    await expect(plugins.searchWorkItemValues({ provider: 'jira', key: 'SK-1', field: 'summary' as never, query: '' })).rejects.toThrow('Unbekanntes Feld.');
    const updated = await plugins.updateWorkItemFields({ provider: 'jira', key: 'SK-1', issueType: 'Story', fixVersions: ['2027.1'] });
    expect(issue).toMatchObject({ issuetype: { name: 'Story' }, fixVersions: [{ name: '2027.1' }] });
    expect(updated).toMatchObject({ issueType: 'Story', fixVersions: ['2027.1'] });
  });

  it('a site without story points keeps the estimate as a time estimate', async () => {
    const { fetchFn, issue } = jira({ storyPoints: false });
    const { plugins } = await service(fetchFn);
    await plugins.configureAtlassian(atlassian);
    expect(await plugins.getWorkItem({ provider: 'jira', key: 'SK-1' })).toMatchObject({ estimate: '3h' });
    await plugins.updateWorkItemFields({ provider: 'jira', key: 'SK-1', estimate: '2d' });
    expect(issue.timetracking).toEqual({ originalEstimate: '2d' });
  });
});

describe('Azure DevOps Server', () => {
  const base = 'https://tfs.example.com/tfs/DefaultCollection';
  const server = { ...cloud, variant: 'server' as const, organizationUrl: `${base}/` };

  it('uses the address of the collection and the version of the interface the server knows', async () => {
    const { fetchFn, calls } = boards({ base, legacyPeople: true });
    const { plugins } = await service(fetchFn);
    await plugins.installPlugin('azure-devops');
    expect((await plugins.configureAzureDevOps(server)).azureDevOps).toMatchObject({ variant: 'server', organizationUrl: base, apiVersion: '6.0' });
    expect(await plugins.testAzureDevOps()).toMatchObject({ ok: true });
    const items = await plugins.listAzureWorkItems();
    expect(items[0]).toMatchObject({ key: '7', assignee: 'Mara Muster', url: `${base}/Shop/_workitems/edit/7` });
    expect(calls.every((call) => call.url.startsWith(`${base}/`) && call.url.endsWith('api-version=6.0'))).toBe(true);

    // An older server: the version can be set.
    await plugins.configureAzureDevOps({ ...server, apiVersion: '5.0', accessToken: undefined });
    calls.length = 0;
    await plugins.listAzureWorkItems();
    expect(calls.every((call) => call.url.endsWith('api-version=5.0'))).toBe(true);
  });

  it('a server that does not name the states of a type gets the usual state names', async () => {
    const { fetchFn, items } = boards({ base, noStates: true });
    const { plugins } = await service(fetchFn);
    await plugins.installPlugin('azure-devops'); await plugins.configureAzureDevOps(server);
    expect(await plugins.transitionAzureWorkItem({ key: '3', status: 'done' })).toMatchObject({ remoteStatus: 'Closed' });
    expect(items.get(3)!['System.State']).toBe('Closed');
  });
});

describe('Azure DevOps: texts and states', () => {
  it('reads HTML descriptions as plain text and writes plain text as HTML', () => {
    expect(htmlToText('<div>A&nbsp;&amp;&nbsp;B</div><ul><li>eins</li><li>zwei</li></ul><p>Ende<br>hier &#228;</p>')).toBe('A & B\n• eins\n• zwei\nEnde\nhier ä');
    expect(htmlToText(undefined)).toBe('');
    expect(textToHtml('a < b\n\nc')).toBe('<div>a &lt; b</div><div><br></div><div>c</div>');
  });
  it('maps the state names of the usual processes to the four columns', () => {
    expect(['New', 'To Do', 'Proposed', 'Approved'].map(azureStatus)).toEqual(['todo', 'todo', 'todo', 'todo']);
    expect(['Active', 'In Progress', 'Committed', 'Doing'].map(azureStatus)).toEqual(['doing', 'doing', 'doing', 'doing']);
    expect(['Resolved', 'In Review', 'Ready for Test'].map(azureStatus)).toEqual(['review', 'review', 'review']);
    expect(['Closed', 'Done', 'Completed', 'Removed'].map(azureStatus)).toEqual(['done', 'done', 'done', 'done']);
  });
});

import { execFile as execFileCallback } from 'node:child_process';
import { mkdir, mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { PluginService } from '../../electron/plugin-service';
import type { DocumentPersistenceService } from '../../electron/persistence';

const execFile = promisify(execFileCallback);
const cleanup: string[] = [];
afterEach(async () => { await Promise.all(cleanup.splice(0).map((dir) => rm(dir, { recursive: true, force: true }))); });

function credentials() {
  return { available: () => true, encrypt: (value: string) => Buffer.from(value).toString('base64'), decrypt: (value: string) => Buffer.from(value, 'base64').toString('utf8') };
}

async function projectPersistence(entries: Record<string, string>): Promise<DocumentPersistenceService> {
  const locations = new Map<string, { selectedPath: string; canonicalPath: string; versionToken: string }>();
  for (const [handleId, selectedPath] of Object.entries(entries)) locations.set(handleId, { selectedPath, canonicalPath: await realpath(selectedPath), versionToken: `sha256:${handleId}` });
  return { getHandleLocation: (handleId: string) => locations.get(handleId) ?? null } as unknown as DocumentPersistenceService;
}

describe('PluginService', () => {
  it('stores Jira credentials encrypted beside the diagram and applies the configured JQL filter', async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), 'sketchdraw-plugin-')); cleanup.push(dir);
    const documentPath = path.join(dir, 'board.sketchdraw.json'); await writeFile(documentPath, '{"version":1}\n');
    const persistence = await projectPersistence({ project: documentPath });
    const fetchFn = vi.fn(async (input: string | URL | Request, _init?: RequestInit): Promise<Response> => {
      const url = String(input);
      if (url.includes('/rest/api/3/search/jql')) return new Response(JSON.stringify({ issues: [{ id: '100', key: 'SK-1', fields: { summary: 'Ticket', description: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Body' }] }] }, status: { name: 'In Progress' }, updated: '2026-10-18T10:00:00.000Z' } }] }));
      return new Response('{}');
    });
    const service = new PluginService({ persistence, credentials: credentials(), emitEvent: vi.fn(), fetchFn: fetchFn as typeof fetch });
    await service.activateDocument('project');
    const snapshot = await service.configureAtlassian({ enabled: true, siteUrl: 'https://example.atlassian.net', email: 'user@example.com', apiToken: 'secret-token', confluenceSpaceKey: '', jiraProjectKey: 'SK', jiraIssueType: 'Task', jqlFilter: 'project = SK AND assignee = currentUser()' });
    expect(snapshot.atlassian).toMatchObject({ installed: true, credentialStored: true, jqlFilter: 'project = SK AND assignee = currentUser()' });
    expect(JSON.stringify(snapshot)).not.toContain('secret-token');
    expect(snapshot.atlassian).not.toHaveProperty('encryptedApiToken');
    const stored = await readFile(path.join(dir, '.sketchdraw-plugins.json'), 'utf8');
    expect(stored).not.toContain('secret-token');
    expect(stored).toContain(Buffer.from('secret-token').toString('base64'));
    expect(await service.listJiraIssues()).toMatchObject([{ key: 'SK-1', status: 'doing', description: 'Body' }]);
    const searchCall = fetchFn.mock.calls.find(([input]) => String(input).includes('/rest/api/3/search/jql'));
    const body = JSON.parse(String((searchCall?.[1] as RequestInit | undefined)?.body)) as { jql: string };
    expect(body.jql).toBe('project = SK AND assignee = currentUser() ORDER BY updated DESC');
    service.dispose();
  });

  it('initializes Git in the project folder and commits only the current document after a save', async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), 'sketchdraw-git-')); cleanup.push(dir);
    const documentPath = path.join(dir, 'board.sketchdraw.json'); await writeFile(documentPath, '{"version":1}\n');
    const persistence = await projectPersistence({ project: documentPath });
    const service = new PluginService({ persistence, credentials: credentials(), emitEvent: vi.fn() });
    await service.activateDocument('project'); await service.installPlugin('git');
    await service.configureGit({ enabled: true, autoCommit: true, autoPush: false, autoPull: false, remote: 'origin', remoteUrl: '', authMode: 'system', username: '' });
    await execFile('git', ['config', 'user.email', 'test@example.com'], { cwd: dir }); await execFile('git', ['config', 'user.name', 'Sketchdraw Test'], { cwd: dir });
    await service.afterDocumentSaved('project');
    const pluginSettings = await service.getSettings();
    expect(pluginSettings.git).toMatchObject({ installed: true, repositoryName: path.basename(dir) });
    expect(path.basename(pluginSettings.projectFolder)).toBe(path.basename(dir));
    expect(pluginSettings.git, pluginSettings.git.message).not.toMatchObject({ health: 'error' });
    const { stdout } = await execFile('git', ['log', '-1', '--pretty=%s'], { cwd: dir });
    expect(stdout.trim()).toBe('Update board.sketchdraw.json via Sketchdraw');
    const exclude = await readFile(path.join(dir, '.git', 'info', 'exclude'), 'utf8');
    expect(exclude).toContain('.sketchdraw-plugins.json');
    service.dispose();
  });

  it('keeps installations and encrypted Git tokens isolated per diagram folder', async () => {
    const first = await mkdtemp(path.join(os.tmpdir(), 'sketchdraw-project-a-')); const second = await mkdtemp(path.join(os.tmpdir(), 'sketchdraw-project-b-')); cleanup.push(first, second);
    const firstDocument = path.join(first, 'one.sketchdraw.json'); const firstSibling = path.join(first, 'another.sketchdraw.json'); const secondDocument = path.join(second, 'two.sketchdraw.json');
    await writeFile(firstDocument, '{"version":1}\n'); await writeFile(firstSibling, '{"version":1}\n'); await writeFile(secondDocument, '{"version":1}\n');
    const persistence = await projectPersistence({ first: firstDocument, firstSibling, second: secondDocument });
    const service = new PluginService({ persistence, credentials: credentials(), emitEvent: vi.fn() });
    await service.activateDocument('first');
    const configured = await service.configureGit({ enabled: true, autoCommit: false, autoPush: false, autoPull: false, remote: 'origin', remoteUrl: '', authMode: 'token', username: 'octocat', accessToken: 'git-secret' });
    expect(configured.git).toMatchObject({ installed: true, authMode: 'token', username: 'octocat', credentialStored: true });
    expect(JSON.stringify(configured)).not.toContain('git-secret');
    expect(configured.git).not.toHaveProperty('encryptedAccessToken');
    expect((await service.activateDocument('firstSibling')).git).toMatchObject({ installed: true, username: 'octocat', credentialStored: true });
    const secondSettings = await service.activateDocument('second');
    expect(secondSettings.git).toMatchObject({ installed: true, enabled: false, username: '', credentialStored: false });
    expect(secondSettings.git).not.toHaveProperty('repositoryName');
    expect(secondSettings.git).not.toHaveProperty('encryptedAccessToken');
    expect((await service.activateDocument('first')).git).toMatchObject({ installed: true, username: 'octocat', credentialStored: true });
    expect(await readFile(path.join(first, '.sketchdraw-plugins.json'), 'utf8')).not.toContain('git-secret');
    await expect(readFile(path.join(second, '.sketchdraw-plugins.json'), 'utf8')).rejects.toMatchObject({ code: 'ENOENT' });
    service.dispose();
  });

  it('maps Confluence responses and verifies both configured Atlassian services', async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), 'sketchdraw-atlassian-')); cleanup.push(dir);
    const documentPath = path.join(dir, 'board.sketchdraw.json'); await writeFile(documentPath, '{"version":1}\n');
    const persistence = await projectPersistence({ project: documentPath });
    const fetchFn = vi.fn(async (input: string | URL | Request, _init?: RequestInit): Promise<Response> => {
      const url = String(input);
      if (url.includes('/wiki/api/v2/spaces')) return new Response(JSON.stringify({ results: [{ id: '42' }] }));
      if (url.includes('/wiki/api/v2/pages?')) return new Response(JSON.stringify({ results: [{ id: '7', title: 'Live Doc', version: { number: 3 } }] }));
      return new Response('{}');
    });
    const service = new PluginService({ persistence, credentials: credentials(), emitEvent: vi.fn(), fetchFn: fetchFn as typeof fetch });
    await service.activateDocument('project');
    await service.configureAtlassian({ enabled: true, siteUrl: 'https://example.atlassian.net', email: 'user@example.com', apiToken: 'token', confluenceSpaceKey: 'DOC', jiraProjectKey: 'SK', jiraIssueType: 'Task', jqlFilter: '' });
    expect(await service.testAtlassian()).toEqual({ ok: true, message: 'Jira: verbunden · Confluence: verbunden' });
    expect(await service.listConfluencePages('live')).toMatchObject([{ id: '7', title: 'Live Doc', version: 3 }]);
    const authorization = (fetchFn.mock.calls[0]?.[1] as RequestInit | undefined)?.headers as Record<string, string>;
    expect(authorization.Authorization).toMatch(/^Basic /);
    expect(authorization.Authorization).not.toContain('token');
    service.dispose();
  });

  it('bundles Git and Jira without side effects and preserves explicit uninstall across reopening', async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), 'sketchdraw-bundled-')); cleanup.push(dir);
    const documentPath = path.join(dir, 'board.sketchdraw.json'); await writeFile(documentPath, '{}');
    const runGit = vi.fn(async () => { throw new Error('not a repository'); }); const fetchFn = vi.fn();
    const service = new PluginService({ persistence: await projectPersistence({ project: documentPath }), credentials: credentials(), emitEvent: vi.fn(), runGit, fetchFn });
    expect(await service.getSettings(null)).toMatchObject({ projectFolder: '', git: { installed: true, enabled: false }, atlassian: { installed: true, enabled: false } });
    expect(await service.getSettings('project')).toMatchObject({ git: { installed: true, enabled: false }, atlassian: { installed: true, enabled: false } });
    expect(runGit).not.toHaveBeenCalled(); expect(fetchFn).not.toHaveBeenCalled();
    await expect(readFile(path.join(dir, '.sketchdraw-plugins.json'), 'utf8')).rejects.toMatchObject({ code: 'ENOENT' });
    await service.uninstallPlugin('git'); await service.uninstallPlugin('jira');
    await service.getSettings(null);
    expect(await service.getSettings('project')).toMatchObject({ git: { installed: false, enabled: false }, atlassian: { installed: false, enabled: false } });
    service.dispose();
  });

  it('clears credentials and runtime on null and restores existing folder configuration without leaking ciphertext', async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), 'sketchdraw-existing-')); cleanup.push(dir);
    const documentPath = path.join(dir, 'board.sketchdraw.json'); await writeFile(documentPath, '{}');
    await writeFile(path.join(dir, '.sketchdraw-plugins.json'), JSON.stringify({ version: 2, git: { installed: true, enabled: true, authMode: 'token', username: 'alice', encryptedAccessToken: credentials().encrypt('git-secret') }, atlassian: { installed: true, enabled: true, siteUrl: 'https://example.atlassian.net', email: 'alice@example.com', jiraProjectKey: 'KEEP', encryptedApiToken: credentials().encrypt('jira-secret') } }));
    const service = new PluginService({ persistence: await projectPersistence({ project: documentPath }), credentials: credentials(), emitEvent: vi.fn() });
    const first = await service.getSettings('project');
    expect(first.git).toMatchObject({ username: 'alice', credentialStored: true });
    expect(first.atlassian).toMatchObject({ jiraProjectKey: 'KEEP', credentialStored: true });
    expect(first.git).not.toHaveProperty('encryptedAccessToken'); expect(first.atlassian).not.toHaveProperty('encryptedApiToken');
    const cleared = await service.getSettings(null);
    expect(cleared).toMatchObject({ projectFolder: '', git: { enabled: false, username: '', credentialStored: false }, atlassian: { enabled: false, email: '', credentialStored: false } });
    await expect(service.createJiraIssue({ title: 'New local task', description: '' })).rejects.toThrow();
    expect((await service.getSettings('project')).atlassian.jiraProjectKey).toBe('KEEP');
    service.dispose();
  });

  it('does not configure or initialize a different project when Git work completes after a switch', async () => {
    const first = await mkdtemp(path.join(os.tmpdir(), 'sketchdraw-git-race-a-')); const second = await mkdtemp(path.join(os.tmpdir(), 'sketchdraw-git-race-b-')); cleanup.push(first, second);
    const a = path.join(first, 'a.sketchdraw.json'); const b = path.join(second, 'b.sketchdraw.json'); await writeFile(a, '{}'); await writeFile(b, '{}');
    let release!: () => void; const gate = new Promise<void>(resolve => { release = resolve; });
    const runGit = vi.fn(async () => { await gate; throw new Error('no repository'); });
    const service = new PluginService({ persistence: await projectPersistence({ a, b }), credentials: credentials(), emitEvent: vi.fn(), runGit });
    await service.getSettings('a');
    const pending = service.configureGit({ enabled: true, autoCommit: true, autoPush: false, autoPull: false, remote: 'origin', remoteUrl: '', authMode: 'system', username: '' });
    const rejection = expect(pending).rejects.toThrow('Projektordner hat sich geändert');
    await service.getSettings('b'); release(); await rejection;
    expect(runGit).toHaveBeenCalledTimes(1);
    expect((await service.getSettings()).git).toMatchObject({ enabled: false, credentialStored: false });
    await expect(readFile(path.join(second, '.sketchdraw-plugins.json'), 'utf8')).rejects.toMatchObject({ code: 'ENOENT' });
    service.dispose();
  });

  it('never writes pending Jira configuration into the next project folder', async () => {
    const first = await mkdtemp(path.join(os.tmpdir(), 'sketchdraw-jira-race-a-')); const second = await mkdtemp(path.join(os.tmpdir(), 'sketchdraw-jira-race-b-')); cleanup.push(first, second);
    const a = path.join(first, 'a.sketchdraw.json'); const b = path.join(second, 'b.sketchdraw.json'); await writeFile(a, '{}'); await writeFile(b, '{}');
    let release!: () => void; const gate = new Promise<void>(resolve => { release = resolve; });
    const service = new PluginService({ persistence: await projectPersistence({ a, b }), credentials: credentials(), emitEvent: vi.fn(), runGit: async () => { await gate; throw new Error('not a repository'); } });
    await service.getSettings('a');
    const pending = service.configureAtlassian({ enabled: true, siteUrl: 'https://example.atlassian.net', email: 'alice@example.com', apiToken: 'secret', confluenceSpaceKey: '', jiraProjectKey: 'OLD', jiraIssueType: 'Task', jqlFilter: '' });
    const rejection = expect(pending).rejects.toThrow('Projektordner hat sich geändert');
    await service.getSettings('b'); release(); await rejection;
    expect((await service.getSettings()).atlassian).toMatchObject({ enabled: false, jiraProjectKey: '', credentialStored: false });
    await expect(readFile(path.join(second, '.sketchdraw-plugins.json'), 'utf8')).rejects.toMatchObject({ code: 'ENOENT' });
    service.dispose();
  });


  it('keeps configuration inactive when saving the local configuration file fails', async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), 'sketchdraw-plugin-save-error-')); cleanup.push(dir);
    const documentPath = path.join(dir, 'board.sketchdraw.json'); await writeFile(documentPath, '{}');
    await mkdir(path.join(dir, '.sketchdraw-plugins.json'));
    const fetchFn = vi.fn(async () => new Response('{}'));
    const service = new PluginService({ persistence: await projectPersistence({ project: documentPath }), credentials: credentials(), emitEvent: vi.fn(), fetchFn });
    await service.getSettings('project');
    await expect(service.configureAtlassian({ enabled: true, siteUrl: 'https://example.atlassian.net', email: 'alice@example.com', apiToken: 'secret', confluenceSpaceKey: '', jiraProjectKey: 'NEW', jiraIssueType: 'Task', jqlFilter: '' })).rejects.toThrow();
    expect((await service.getSettings()).atlassian).toMatchObject({ enabled: false, credentialStored: false, jiraProjectKey: '' });
    await expect(service.listJiraIssues()).rejects.toThrow(); expect(fetchFn).not.toHaveBeenCalled();
    service.dispose();
  });

  it('discards remote Jira responses after changing the project before follow-up requests', async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), 'sketchdraw-plugin-request-race-')); cleanup.push(dir);
    const documentPath = path.join(dir, 'board.sketchdraw.json'); await writeFile(documentPath, '{}');
    let release!: (response: Response) => void;
    const fetchFn = vi.fn(() => new Promise<Response>(resolve => { release = resolve; }));
    const service = new PluginService({ persistence: await projectPersistence({ project: documentPath }), credentials: credentials(), emitEvent: vi.fn(), fetchFn });
    await service.getSettings('project');
    await service.configureAtlassian({ enabled: true, siteUrl: 'https://example.atlassian.net', email: 'alice@example.com', apiToken: 'secret', confluenceSpaceKey: '', jiraProjectKey: 'OLD', jiraIssueType: 'Task', jqlFilter: '' });
    const pending = service.createJiraIssue({ title: 'Old task', description: '' });
    const rejection = expect(pending).rejects.toThrow('Projektordner hat sich geändert');
    await service.getSettings(null); release(new Response(JSON.stringify({ key: 'OLD-1' }))); await rejection;
    expect(fetchFn).toHaveBeenCalledTimes(1); expect((await service.getSettings()).atlassian.enabled).toBe(false);
    service.dispose();
  });


  it('does not reuse a Jira credential for a changed site or reinstall an explicitly removed plugin', async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), 'sketchdraw-jira-credential-scope-')); cleanup.push(dir);
    const documentPath = path.join(dir, 'board.sketchdraw.json'); await writeFile(documentPath, '{}');
    const service = new PluginService({ persistence: await projectPersistence({ project: documentPath }), credentials: credentials(), emitEvent: vi.fn() });
    await service.getSettings('project');
    const input = { enabled: true, siteUrl: 'https://original.atlassian.net', email: 'alice@example.com', apiToken: 'secret', confluenceSpaceKey: '', jiraProjectKey: 'SK', jiraIssueType: 'Task', jqlFilter: '' };
    await service.configureAtlassian(input);
    await expect(service.configureAtlassian({ ...input, siteUrl: 'https://different.atlassian.net', apiToken: '' })).rejects.toThrow('API-Token');
    expect((await service.getSettings()).atlassian.siteUrl).toBe(input.siteUrl);
    const changed = await service.configureAtlassian({ ...input, enabled: false, siteUrl: 'https://different.atlassian.net', apiToken: '' });
    expect(changed.atlassian.credentialStored).toBe(false);
    await service.uninstallPlugin('jira'); await expect(service.configureAtlassian(input)).rejects.toThrow('nicht installiert');
    service.dispose();
  });

  it('scopes Git authorization to the selected HTTPS remote and refuses reuse after external remote changes', async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), 'sketchdraw-git-credential-scope-')); cleanup.push(dir);
    const documentPath = path.join(dir, 'board.sketchdraw.json'); await writeFile(documentPath, '{}');
    const network = vi.fn(async (_args: string[], _cwd: string, _environment?: Readonly<Record<string, string | undefined>>) => ({ stdout: '', stderr: '' }));
    const service = new PluginService({ persistence: await projectPersistence({ project: documentPath }), credentials: credentials(), emitEvent: vi.fn(), runGit: async (args, cwd, environment) => args[0] === 'push' ? network(args, cwd, environment) : execFile('git', args, { cwd }) });
    await service.getSettings('project');
    const input = { enabled: true, autoCommit: false, autoPush: true, autoPull: false, remote: 'origin', remoteUrl: 'https://original.example/repo.git', authMode: 'token' as const, username: 'alice', accessToken: 'secret' };
    await service.configureGit(input); await service.afterDocumentSaved('project');
    expect(network).toHaveBeenCalledTimes(1);
    expect(network.mock.calls[0]?.[2]?.GIT_CONFIG_KEY_0).toBe('http.https://original.example/repo.git.extraHeader');
    expect(network.mock.calls[0]?.[2]).toMatchObject({ GIT_CONFIG_KEY_1: 'http.followRedirects', GIT_CONFIG_VALUE_1: 'false' });
    await execFile('git', ['remote', 'set-url', 'origin', 'https://different.example/repo.git'], { cwd: dir });
    await service.afterDocumentSaved('project'); expect(network).toHaveBeenCalledTimes(1);
    expect((await service.getSettings()).git).toMatchObject({ health: 'error' });
    await expect(service.configureGit({ ...input, remoteUrl: 'https://different.example/repo.git', accessToken: '' })).rejects.toThrow('Git-Token');
    await expect(service.configureGit({ ...input, remote: '--upload-pack=evil' })).rejects.toThrow('Git-Remote ist ungültig');
    await expect(service.configureGit({ ...input, remoteUrl: '--config=evil' })).rejects.toThrow('Git-Remote-URL ist ungültig');
    await service.uninstallPlugin('git'); await expect(service.configureGit(input)).rejects.toThrow('nicht installiert');
    service.dispose();
  });

});

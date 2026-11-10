import { execFile as execFileCallback } from 'node:child_process';
import { mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises';
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
    expect((await service.activateDocument('firstSibling')).git).toMatchObject({ installed: true, username: 'octocat', credentialStored: true });
    expect((await service.activateDocument('second')).git.installed).toBe(false);
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
});

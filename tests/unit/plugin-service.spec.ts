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

describe('PluginService', () => {
  it('stores the Atlassian token encrypted and never returns it to the renderer', async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), 'sketchdraw-plugin-')); cleanup.push(dir);
    const service = new PluginService({ configPath: path.join(dir, 'plugins.json'), persistence: {} as DocumentPersistenceService, credentials: credentials(), emitEvent: vi.fn() });
    const snapshot = await service.configureAtlassian({ enabled: true, siteUrl: 'https://example.atlassian.net', email: 'user@example.com', apiToken: 'secret-token', confluenceSpaceKey: 'DOC', jiraProjectKey: 'SK', jiraIssueType: 'Task' });
    expect(snapshot.atlassian.credentialStored).toBe(true);
    expect(JSON.stringify(snapshot)).not.toContain('secret-token');
    expect(JSON.stringify(snapshot)).not.toContain(Buffer.from('secret-token').toString('base64'));
    expect(snapshot.atlassian).not.toHaveProperty('encryptedApiToken');
    const stored = await readFile(path.join(dir, 'plugins.json'), 'utf8');
    expect(stored).not.toContain('secret-token');
    expect(stored).toContain(Buffer.from('secret-token').toString('base64'));
    service.dispose();
  });

  it('commits only the current document after a save', async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), 'sketchdraw-git-')); cleanup.push(dir);
    const documentPath = path.join(dir, 'board.sketchdraw.json'); await writeFile(documentPath, '{"version":1}\n');
    await execFile('git', ['init'], { cwd: dir }); await execFile('git', ['config', 'user.email', 'test@example.com'], { cwd: dir }); await execFile('git', ['config', 'user.name', 'Sketchdraw Test'], { cwd: dir });
    const canonicalPath = await realpath(documentPath);
    const persistence = { getHandleLocation: () => ({ selectedPath: documentPath, canonicalPath, versionToken: 'sha256:test' }) } as unknown as DocumentPersistenceService;
    const service = new PluginService({ configPath: path.join(dir, 'plugins.json'), persistence, credentials: credentials(), emitEvent: vi.fn() });
    await service.configureGit({ enabled: true, autoCommit: true, autoPush: false, autoPull: false, remote: 'origin' });
    await service.afterDocumentSaved('hdl_0123456789abcdef0123456789abcdef');
    const pluginSettings = await service.getSettings();
    expect(pluginSettings.git, pluginSettings.git.message).not.toMatchObject({ health: 'error' });
    const { stdout } = await execFile('git', ['log', '-1', '--pretty=%s'], { cwd: dir });
    expect(stdout.trim()).toBe('Update board.sketchdraw.json via Sketchdraw');
    service.dispose();
  });

  it('maps Confluence and Jira REST responses into bounded plugin models', async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), 'sketchdraw-atlassian-')); cleanup.push(dir);
    const fetchFn = vi.fn(async (input: string | URL | Request, _init?: RequestInit): Promise<Response> => {
      const url = String(input);
      if (url.includes('/wiki/api/v2/spaces')) return new Response(JSON.stringify({ results: [{ id: '42' }] }));
      if (url.includes('/wiki/api/v2/pages?')) return new Response(JSON.stringify({ results: [{ id: '7', title: 'Live Doc', version: { number: 3 } }] }));
      if (url.includes('/rest/api/3/search/jql')) return new Response(JSON.stringify({ issues: [{ id: '100', key: 'SK-1', fields: { summary: 'Ticket', description: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Body' }] }] }, status: { name: 'In Progress' }, updated: '2026-10-18T10:00:00.000Z' } }] }));
      return new Response('{}');
    });
    const service = new PluginService({ configPath: path.join(dir, 'plugins.json'), persistence: {} as DocumentPersistenceService, credentials: credentials(), emitEvent: vi.fn(), fetchFn: fetchFn as typeof fetch });
    await service.configureAtlassian({ enabled: true, siteUrl: 'https://example.atlassian.net', email: 'user@example.com', apiToken: 'token', confluenceSpaceKey: 'DOC', jiraProjectKey: 'SK', jiraIssueType: 'Task' });
    expect(await service.testAtlassian()).toEqual({ ok: true, message: 'Jira: verbunden · Confluence: verbunden' });
    expect(await service.listConfluencePages('live')).toMatchObject([{ id: '7', title: 'Live Doc', version: 3 }]);
    expect(await service.listJiraIssues()).toMatchObject([{ key: 'SK-1', status: 'doing', description: 'Body' }]);
    const authorization = (fetchFn.mock.calls[0]?.[1] as RequestInit | undefined)?.headers as Record<string, string>;
    expect(authorization.Authorization).toMatch(/^Basic /);
    expect(authorization.Authorization).not.toContain('token');
    service.dispose();
  });
});

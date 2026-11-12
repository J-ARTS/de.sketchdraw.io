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

/** The editor's profile file lives in the app data, never in a project folder. */
async function profileStore(): Promise<string> {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'sketchdraw-profiles-')); cleanup.push(dir);
  return path.join(dir, 'plugins.json');
}
const noLegacyFile = (dir: string) => expect(readFile(path.join(dir, '.sketchdraw-plugins.json'), 'utf8')).rejects.toMatchObject({ code: 'ENOENT' });
const jiraInput = (jiraProjectKey: string) => ({ enabled: true, siteUrl: 'https://example.atlassian.net', email: 'alice@example.com', apiToken: 'jira-secret', confluenceSpaceKey: '', jiraProjectKey, jiraIssueType: 'Task', jqlFilter: '' });

describe('PluginService', () => {
  it('stores Jira credentials encrypted in the profile file, not beside the diagram, and applies the configured JQL filter', async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), 'sketchdraw-plugin-')); cleanup.push(dir);
    const documentPath = path.join(dir, 'board.sketchdraw.json'); await writeFile(documentPath, '{"version":1}\n');
    const persistence = await projectPersistence({ project: documentPath });
    const fetchFn = vi.fn(async (input: string | URL | Request, _init?: RequestInit): Promise<Response> => {
      const url = String(input);
      if (url.includes('/rest/api/3/search/jql')) return new Response(JSON.stringify({ issues: [{ id: '100', key: 'SK-1', fields: { summary: 'Ticket', description: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Body' }] }] }, status: { name: 'In Progress' }, updated: '2026-10-18T10:00:00.000Z' } }] }));
      return new Response('{}');
    });
    const configPath = await profileStore();
    const service = new PluginService({ configPath, persistence, credentials: credentials(), emitEvent: vi.fn(), fetchFn: fetchFn as typeof fetch });
    await service.activateDocument('project');
    const snapshot = await service.configureAtlassian({ enabled: true, siteUrl: 'https://example.atlassian.net', email: 'user@example.com', apiToken: 'secret-token', confluenceSpaceKey: '', jiraProjectKey: 'SK', jiraIssueType: 'Task', jqlFilter: 'project = SK AND assignee = currentUser()' });
    expect(snapshot.atlassian).toMatchObject({ installed: true, credentialStored: true, jqlFilter: 'project = SK AND assignee = currentUser()' });
    expect(JSON.stringify(snapshot)).not.toContain('secret-token');
    expect(snapshot.atlassian).not.toHaveProperty('encryptedApiToken');
    const stored = await readFile(configPath, 'utf8');
    await noLegacyFile(dir);
    expect(JSON.parse(stored)).toMatchObject({ version: 3, activeProfileId: 'default', profiles: [{ id: 'default', name: 'Standard' }] });
    expect(snapshot).toMatchObject({ activeProfileId: 'default', profiles: [{ id: 'default', name: 'Standard' }] });
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
    // Nothing but the diagram enters the project folder or the repository.
    await noLegacyFile(dir);
    expect((await execFile('git', ['status', '--porcelain=v1'], { cwd: dir })).stdout.trim()).toBe('');
    service.dispose();
  });

  it('keeps watching when a reload triggered by the file watcher fails (#163)', async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), 'sketchdraw-watch-')); cleanup.push(dir);
    const documentPath = path.join(dir, 'board.sketchdraw.json'); await writeFile(documentPath, '{"version":1}\n');
    const base = await projectPersistence({ project: documentPath });
    const reloadDocument = vi.fn(async () => { throw new Error('file is being replaced'); });
    const persistence = { getHandleLocation: base.getHandleLocation, reloadDocument } as unknown as DocumentPersistenceService;
    const rejections: unknown[] = []; const onRejection = (reason: unknown) => { rejections.push(reason); };
    process.on('unhandledRejection', onRejection);
    const service = new PluginService({ persistence, credentials: credentials(), emitEvent: vi.fn() });
    try {
      await service.activateDocument('project'); await service.installPlugin('git');
      await service.configureGit({ enabled: true, autoCommit: false, autoPush: false, autoPull: false, remote: 'origin', remoteUrl: '', authMode: 'system', username: '' });
      expect(await service.watchDocument('project')).toMatchObject({ ok: true });
      await writeFile(documentPath, '{"version":2}\n');
      await vi.waitFor(() => { expect(reloadDocument).toHaveBeenCalled(); }, { timeout: 8_000, interval: 50 });
      await new Promise(resolve => setTimeout(resolve, 50));
      expect(rejections).toEqual([]);
      expect(await service.watchDocument('project')).toMatchObject({ ok: true, message: 'Dokument wird überwacht.' });
    } finally { service.dispose(); process.off('unhandledRejection', onRejection); }
  });

  it('keeps installations and encrypted tokens per profile and applies the active profile in every folder', async () => {
    const first = await mkdtemp(path.join(os.tmpdir(), 'sketchdraw-project-a-')); const second = await mkdtemp(path.join(os.tmpdir(), 'sketchdraw-project-b-')); cleanup.push(first, second);
    const firstDocument = path.join(first, 'one.sketchdraw.json'); const secondDocument = path.join(second, 'two.sketchdraw.json');
    await writeFile(firstDocument, '{"version":1}\n'); await writeFile(secondDocument, '{"version":1}\n');
    const persistence = await projectPersistence({ first: firstDocument, second: secondDocument });
    const configPath = await profileStore();
    const runGit = vi.fn(async () => { throw new Error('not a repository'); });
    const service = new PluginService({ configPath, persistence, credentials: credentials(), emitEvent: vi.fn(), runGit });
    await service.activateDocument('first');
    // A disabled plugin is only stored: no repository is touched.
    const configured = await service.configureGit({ enabled: false, autoCommit: false, autoPush: false, autoPull: false, remote: 'origin', remoteUrl: 'https://example.com/org/repo.git', authMode: 'token', username: 'octocat', accessToken: 'git-secret' });
    expect(runGit).not.toHaveBeenCalled();
    expect(configured.git).toMatchObject({ installed: true, authMode: 'token', username: 'octocat', credentialStored: true });
    expect(JSON.stringify(configured)).not.toContain('git-secret');
    expect(configured.git).not.toHaveProperty('encryptedAccessToken');
    await service.configureAtlassian(jiraInput('WORK'));
    // The profile, not the folder, carries the configuration.
    expect((await service.activateDocument('second')).git).toMatchObject({ username: 'octocat', credentialStored: true });

    const created = await service.createProfile({ name: 'Privat' });
    const privateId = created.activeProfileId;
    expect(created.profiles).toEqual([{ id: 'default', name: 'Standard' }, { id: privateId, name: 'Privat' }]);
    expect(created.git).toMatchObject({ installed: true, enabled: false, username: '', remoteUrl: '', credentialStored: false });
    expect(created.atlassian).toMatchObject({ installed: true, enabled: false, jiraProjectKey: '', credentialStored: false });
    await service.uninstallPlugin('git');
    await service.configureAtlassian(jiraInput('HOME'));

    const back = await service.selectProfile('default');
    expect(back).toMatchObject({ activeProfileId: 'default', git: { installed: true, username: 'octocat', credentialStored: true }, atlassian: { jiraProjectKey: 'WORK', credentialStored: true } });
    // A copy takes everything along, including the stored tokens, and then lives on its own.
    const copy = await service.createProfile({ name: 'Standard (Kopie)', copyFrom: 'default' });
    expect(copy.git).toMatchObject({ username: 'octocat', remoteUrl: 'https://example.com/org/repo.git', credentialStored: true });
    expect(copy.atlassian).toMatchObject({ jiraProjectKey: 'WORK', credentialStored: true });
    await service.configureAtlassian({ ...jiraInput('COPY'), apiToken: '' });
    expect((await service.selectProfile('default')).atlassian.jiraProjectKey).toBe('WORK');
    expect(await service.selectProfile(privateId)).toMatchObject({ git: { installed: false }, atlassian: { jiraProjectKey: 'HOME' } });

    const stored = await readFile(configPath, 'utf8');
    expect(stored).not.toContain('git-secret'); expect(stored).not.toContain('jira-secret');
    expect(JSON.parse(stored)).toMatchObject({ version: 3, activeProfileId: privateId, profiles: [{ name: 'Standard' }, { name: 'Privat' }, { name: 'Standard (Kopie)' }] });
    await noLegacyFile(first); await noLegacyFile(second);
    expect(runGit).not.toHaveBeenCalled();
    service.dispose();

    // A restart restores the profiles and the active one.
    const restarted = new PluginService({ configPath, persistence, credentials: credentials(), emitEvent: vi.fn(), runGit });
    expect(await restarted.getSettings()).toMatchObject({ activeProfileId: privateId, profiles: [{ name: 'Standard' }, { name: 'Privat' }, { name: 'Standard (Kopie)' }], git: { installed: false }, atlassian: { jiraProjectKey: 'HOME', credentialStored: true } });
    restarted.dispose();
  });

  it('validates profile names, the profile limit and deletion, and moves on when the active profile is deleted', async () => {
    const configPath = await profileStore();
    const service = new PluginService({ configPath, persistence: await projectPersistence({}), credentials: credentials(), emitEvent: vi.fn() });
    const work = (await service.createProfile({ name: '  Arbeit  ' })).activeProfileId;
    expect((await service.getSettings()).profiles.map((profile) => profile.name)).toEqual(['Standard', 'Arbeit']);
    await expect(service.createProfile({ name: 'arbeit' })).rejects.toThrow('existiert bereits');
    await expect(service.createProfile({ name: '   ' })).rejects.toThrow('ungültig');
    await expect(service.createProfile({ name: 'x'.repeat(41) })).rejects.toThrow('ungültig');
    await expect(service.createProfile({ name: 'Zeile\nzwei' })).rejects.toThrow('ungültig');
    await expect(service.createProfile({ name: 'Kopie', copyFrom: 'missing' })).rejects.toThrow('Unbekanntes Profil');
    await expect(service.renameProfile({ id: work, name: 'Standard' })).rejects.toThrow('existiert bereits');
    await expect(service.renameProfile({ id: 'missing', name: 'Neu' })).rejects.toThrow('Unbekanntes Profil');
    await expect(service.selectProfile('missing')).rejects.toThrow('Unbekanntes Profil');
    await expect(service.deleteProfile('missing')).rejects.toThrow('Unbekanntes Profil');
    // Renaming to the same name in another case is allowed.
    expect((await service.renameProfile({ id: work, name: 'ARBEIT' })).profiles.map((profile) => profile.name)).toEqual(['Standard', 'ARBEIT']);
    for (let index = 3; index <= 12; index++) await service.createProfile({ name: `Profil ${index}` });
    await expect(service.createProfile({ name: 'Dreizehn' })).rejects.toThrow('höchstens zwölf');
    expect((await service.getSettings()).profiles).toHaveLength(12);

    // Deleting an inactive profile keeps the active one; deleting the active one activates the first remaining.
    const active = (await service.getSettings()).activeProfileId;
    expect((await service.deleteProfile(work)).activeProfileId).toBe(active);
    expect((await service.deleteProfile(active)).activeProfileId).toBe('default');
    for (const profile of (await service.getSettings()).profiles.filter((entry) => entry.id !== 'default')) await service.deleteProfile(profile.id);
    await expect(service.deleteProfile('default')).rejects.toThrow('letzte Profil');
    expect(await service.getSettings()).toMatchObject({ activeProfileId: 'default', profiles: [{ id: 'default', name: 'Standard' }] });
    expect(JSON.parse(await readFile(configPath, 'utf8')).profiles).toHaveLength(1);
    service.dispose();
  });

  it('keeps an unreadable profile file aside instead of overwriting it', async () => {
    const configPath = await profileStore();
    await writeFile(configPath, '{"version":3,"profiles":"broken"');
    const service = new PluginService({ configPath, persistence: await projectPersistence({}), credentials: credentials(), emitEvent: vi.fn() });
    expect(await service.getSettings()).toMatchObject({ activeProfileId: 'default', profiles: [{ id: 'default', name: 'Standard' }], atlassian: { enabled: false } });
    await service.configureAtlassian(jiraInput('NEW'));
    expect(await readFile(`${configPath}.unreadable`, 'utf8')).toBe('{"version":3,"profiles":"broken"');
    expect(JSON.parse(await readFile(configPath, 'utf8'))).toMatchObject({ version: 3, profiles: [{ atlassian: { jiraProjectKey: 'NEW' } }] });
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

  it('adopts an old folder configuration once into an unconfigured profile and never acts for a document without a project', async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), 'sketchdraw-existing-')); const other = await mkdtemp(path.join(os.tmpdir(), 'sketchdraw-existing-b-')); cleanup.push(dir, other);
    const documentPath = path.join(dir, 'board.sketchdraw.json'); const otherDocument = path.join(other, 'other.sketchdraw.json'); await writeFile(documentPath, '{}'); await writeFile(otherDocument, '{}');
    const legacy = JSON.stringify({ version: 2, git: { installed: true, enabled: false, authMode: 'token', username: 'alice', encryptedAccessToken: credentials().encrypt('git-secret') }, atlassian: { installed: true, enabled: true, siteUrl: 'https://example.atlassian.net', email: 'alice@example.com', jiraProjectKey: 'KEEP', encryptedApiToken: credentials().encrypt('jira-secret') } });
    await writeFile(path.join(dir, '.sketchdraw-plugins.json'), legacy);
    await writeFile(path.join(other, '.sketchdraw-plugins.json'), JSON.stringify({ version: 2, git: { installed: true, username: 'bob' }, atlassian: { installed: true, jiraProjectKey: 'OTHER' } }));
    const configPath = await profileStore(); const fetchFn = vi.fn(async () => new Response('{}'));
    const persistence = await projectPersistence({ project: documentPath, other: otherDocument });
    const service = new PluginService({ configPath, persistence, credentials: credentials(), emitEvent: vi.fn(), fetchFn });
    const first = await service.getSettings('project');
    expect(first.git).toMatchObject({ username: 'alice', credentialStored: true });
    expect(first.atlassian).toMatchObject({ enabled: true, jiraProjectKey: 'KEEP', credentialStored: true });
    expect(first.git).not.toHaveProperty('encryptedAccessToken'); expect(first.atlassian).not.toHaveProperty('encryptedApiToken');
    // The old file stays untouched; the profile file now holds the configuration.
    expect(await readFile(path.join(dir, '.sketchdraw-plugins.json'), 'utf8')).toBe(legacy);
    expect(JSON.parse(await readFile(configPath, 'utf8'))).toMatchObject({ profiles: [{ id: 'default', git: { username: 'alice' }, atlassian: { jiraProjectKey: 'KEEP' } }] });
    // A configured profile is never replaced by another folder's old file.
    expect(await service.getSettings('other')).toMatchObject({ git: { username: 'alice' }, atlassian: { jiraProjectKey: 'KEEP' } });
    // Unsaved, imported and guest diagrams keep the profile visible but trigger no Jira or Confluence request.
    const released = await service.getSettings(null);
    expect(released).toMatchObject({ projectFolder: '', activeProfileId: 'default', atlassian: { enabled: true, jiraProjectKey: 'KEEP', credentialStored: true } });
    await expect(service.createJiraIssue({ title: 'New local task', description: '' })).rejects.toThrow('lokales Diagramm');
    await expect(service.listJiraIssues()).rejects.toThrow('lokales Diagramm');
    await expect(service.transitionJiraIssue({ key: 'KEEP-1', status: 'done' })).rejects.toThrow('lokales Diagramm');
    await expect(service.listConfluencePages('')).rejects.toThrow('lokales Diagramm');
    expect(fetchFn).not.toHaveBeenCalled();
    // A new, still unconfigured profile adopts the old file of the folder that is opened next.
    await service.createProfile({ name: 'Zweites' });
    expect(await service.getSettings('other')).toMatchObject({ git: { username: 'bob' }, atlassian: { jiraProjectKey: 'OTHER' } });
    expect((await service.selectProfile('default')).atlassian.jiraProjectKey).toBe('KEEP');
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

  it('keeps a Jira configuration in its profile when the project or the profile changes while it is saved', async () => {
    const first = await mkdtemp(path.join(os.tmpdir(), 'sketchdraw-jira-race-a-')); const second = await mkdtemp(path.join(os.tmpdir(), 'sketchdraw-jira-race-b-')); cleanup.push(first, second);
    const a = path.join(first, 'a.sketchdraw.json'); const b = path.join(second, 'b.sketchdraw.json'); await writeFile(a, '{}'); await writeFile(b, '{}');
    const configPath = await profileStore();
    const service = new PluginService({ configPath, persistence: await projectPersistence({ a, b }), credentials: credentials(), emitEvent: vi.fn(), runGit: async () => { throw new Error('not a repository'); } });
    await service.getSettings('a');
    const pending = service.configureAtlassian(jiraInput('OLD'));
    const switched = service.getSettings('b');
    await pending; await switched;
    expect((await service.getSettings()).atlassian).toMatchObject({ enabled: true, jiraProjectKey: 'OLD', credentialStored: true });
    await noLegacyFile(first); await noLegacyFile(second);
    // Saved for the profile that was active when saving started, even if another profile is active by then.
    const savingOld = service.configureAtlassian(jiraInput('LATE'));
    const created = service.createProfile({ name: 'Neu' });
    await savingOld; const next = await created;
    expect(next.atlassian).toMatchObject({ enabled: false, jiraProjectKey: '' });
    expect((await service.selectProfile('default')).atlassian.jiraProjectKey).toBe('LATE');
    service.dispose();
  });

  it('keeps configuration inactive when saving the profile file fails', async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), 'sketchdraw-plugin-save-error-')); cleanup.push(dir);
    const documentPath = path.join(dir, 'board.sketchdraw.json'); await writeFile(documentPath, '{}');
    const configPath = await profileStore(); await mkdir(configPath);
    const fetchFn = vi.fn(async () => new Response('{}'));
    const service = new PluginService({ configPath, persistence: await projectPersistence({ project: documentPath }), credentials: credentials(), emitEvent: vi.fn(), fetchFn });
    await service.getSettings('project');
    await expect(service.configureAtlassian(jiraInput('NEW'))).rejects.toThrow();
    expect((await service.getSettings()).atlassian).toMatchObject({ enabled: false, credentialStored: false, jiraProjectKey: '' });
    await expect(service.createProfile({ name: 'Neu' })).rejects.toThrow();
    expect(await service.getSettings()).toMatchObject({ activeProfileId: 'default', profiles: [{ id: 'default' }] });
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
    expect(fetchFn).toHaveBeenCalledTimes(1);
    // The profile stays configured, but without a project nothing is sent.
    expect((await service.getSettings()).atlassian.enabled).toBe(true);
    await expect(service.createJiraIssue({ title: 'After release', description: '' })).rejects.toThrow('lokales Diagramm');
    // A profile switch stops pending work of the previous profile in the same way.
    await service.getSettings('project');
    const second = service.createJiraIssue({ title: 'Old profile task', description: '' });
    const secondRejection = expect(second).rejects.toThrow('Projektordner hat sich geändert');
    await service.createProfile({ name: 'Anderes' }); release(new Response(JSON.stringify({ key: 'OLD-2' }))); await secondRejection;
    expect(fetchFn).toHaveBeenCalledTimes(2);
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

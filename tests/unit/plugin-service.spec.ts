import { execFile as execFileCallback } from 'node:child_process';
import { promises as fs } from 'node:fs';
import { mkdir, mkdtemp, readFile, readdir, realpath, rename, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { confluencePageReference, jqlProject, PluginService } from '../../electron/plugin-service';
import type { DocumentPersistenceService } from '../../electron/persistence';
import { setLocale, tm } from '../../src/renderer/i18n';

const execFile = promisify(execFileCallback);
// These tests start real git processes, dozens in some cases. Starting a process is slow on the Windows runner,
// where the default of five seconds was exceeded by 23 ms in the release run of v0.1.7 (#251).
vi.setConfig({ testTimeout: 30_000 });

const cleanup: string[] = [];
afterEach(async () => { vi.restoreAllMocks(); setLocale('de'); await Promise.all(cleanup.splice(0).map((dir) => rm(dir, { recursive: true, force: true }))); });

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
      if (url.includes('/rest/api/3/search/jql')) return new Response(JSON.stringify({ issues: [{ id: '100', key: 'SK-1', fields: { summary: 'Ticket', description: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Body' }] }] }, status: { name: 'In Progress' }, assignee: { accountId: 'account-1', displayName: 'Mara Muster' }, duedate: '2026-11-20', updated: '2026-10-18T10:00:00.000Z' } }] }));
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
    // The settings can ask for the stored token to show it again; it never travels with the settings themselves.
    expect(await service.revealCredential('jira')).toBe('secret-token');
    expect(await service.revealCredential('confluence')).toBe('secret-token');
    expect(await service.revealCredential('git')).toBe('');
    expect(await service.revealCredential('azure-devops')).toBe('');
    await expect(service.revealCredential('other' as never)).rejects.toThrow('Unbekanntes Plugin.');
    expect(JSON.stringify(await service.getSettings())).not.toContain('secret-token');
    expect(await service.listJiraIssues()).toMatchObject([{ key: 'SK-1', status: 'doing', description: 'Body', assignee: 'Mara Muster', dueDate: '2026-11-20' }]);
    const searchCall = fetchFn.mock.calls.find(([input]) => String(input).includes('/rest/api/3/search/jql'));
    const body = JSON.parse(String((searchCall?.[1] as RequestInit | undefined)?.body)) as { jql: string; fields: string[] };
    expect(body.jql).toBe('project = SK AND assignee = currentUser() ORDER BY updated DESC');
    expect(body.fields).toEqual(expect.arrayContaining(['assignee', 'duedate']));
    service.dispose();
  });

  it('resolves assignable Jira users and writes assignee and due date on create and update', async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), 'sketchdraw-jira-fields-')); cleanup.push(dir);
    const documentPath = path.join(dir, 'board.sketchdraw.json'); await writeFile(documentPath, '{}\n');
    let assignee = ''; let dueDate = '';
    const fetchFn = vi.fn(async (input: string | URL | Request, init?: RequestInit): Promise<Response> => {
      const url = String(input); const method = init?.method ?? 'GET';
      if (url.includes('/user/assignable/search')) {
        const query = new URL(url).searchParams.get('query') ?? '';
        return new Response(JSON.stringify([{ accountId: query.startsWith('Mara') ? 'account-mara' : 'account-anna', displayName: query, emailAddress: `${query.split(' ')[0]?.toLocaleLowerCase()}@example.com` }]));
      }
      if (url.endsWith('/rest/api/3/issue') && method === 'POST') {
        const body = JSON.parse(String(init?.body)) as { fields: { assignee?: { accountId: string }; duedate?: string } };
        assignee = body.fields.assignee?.accountId === 'account-mara' ? 'Mara Muster' : '';
        dueDate = body.fields.duedate ?? '';
        return new Response(JSON.stringify({ id: '101', key: 'SK-2' }));
      }
      if (url.includes('/rest/api/3/issue/SK-2/assignee') && method === 'PUT') {
        const body = JSON.parse(String(init?.body)) as { accountId: string | null };
        assignee = body.accountId === 'account-anna' ? 'Anna Beispiel' : '';
        return new Response('{}');
      }
      if (url.includes('/rest/api/3/issue/SK-2') && method === 'PUT') {
        const body = JSON.parse(String(init?.body)) as { fields: { duedate: string | null } };
        dueDate = body.fields.duedate ?? '';
        return new Response('{}');
      }
      if (url.includes('/rest/api/3/issue/SK-2') && method === 'GET') return new Response(JSON.stringify({ id: '101', key: 'SK-2', fields: { summary: 'Review', description: null, status: { name: 'To Do' }, ...(assignee ? { assignee: { displayName: assignee } } : {}), ...(dueDate ? { duedate: dueDate } : {}), updated: '2026-11-13T10:00:00.000Z' } }));
      return new Response('{}');
    });
    const service = new PluginService({ configPath: await profileStore(), persistence: await projectPersistence({ project: documentPath }), credentials: credentials(), emitEvent: vi.fn(), fetchFn: fetchFn as typeof fetch });
    await service.activateDocument('project');
    await service.configureAtlassian(jiraInput('SK'));

    await expect(service.createJiraIssue({ title: 'Review', description: '', assignee: 'Mara Muster', dueDate: '2026-11-20' })).resolves.toMatchObject({ key: 'SK-2', assignee: 'Mara Muster', dueDate: '2026-11-20' });
    const createCall = fetchFn.mock.calls.find(([input, init]) => String(input).endsWith('/rest/api/3/issue') && init?.method === 'POST');
    expect(JSON.parse(String(createCall?.[1]?.body))).toMatchObject({ fields: { assignee: { accountId: 'account-mara' }, duedate: '2026-11-20' } });

    await expect(service.updateJiraIssue({ key: 'SK-2', assignee: 'Anna Beispiel', dueDate: '2026-11-21' })).resolves.toMatchObject({ assignee: 'Anna Beispiel', dueDate: '2026-11-21' });
    const assignCall = fetchFn.mock.calls.find(([input, init]) => String(input).includes('/SK-2/assignee') && init?.method === 'PUT');
    expect(JSON.parse(String(assignCall?.[1]?.body))).toEqual({ accountId: 'account-anna' });
    const dueDateCall = fetchFn.mock.calls.find(([input, init]) => String(input).includes('/issue/SK-2') && !String(input).includes('/assignee') && init?.method === 'PUT');
    expect(JSON.parse(String(dueDateCall?.[1]?.body))).toEqual({ fields: { duedate: '2026-11-21' } });

    // Title and description are fields of the issue too; the description may have several lines (#270).
    fetchFn.mockClear();
    await service.updateJiraIssue({ key: 'SK-2', title: 'Review the API', description: 'First line\nSecond line' });
    const textCall = fetchFn.mock.calls.find(([input, init]) => String(input).includes('/issue/SK-2') && init?.method === 'PUT');
    expect(JSON.parse(String(textCall?.[1]?.body))).toEqual({ fields: { summary: 'Review the API', description: { version: 1, type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'First line' }] }, { type: 'paragraph', content: [{ type: 'text', text: 'Second line' }] }] } } });
    await expect(service.updateJiraIssue({ key: 'SK-2', title: '   ' })).rejects.toThrow('Jira-Titel');
    await expect(service.createJiraIssue({ title: 'Mehrzeilig', description: 'Eins\nZwei' })).resolves.toMatchObject({ key: 'SK-2' });
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

  it('refreshes a stale remote-tracking branch before calculating ahead and behind (#175)', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'sketchdraw-git-status-')); cleanup.push(root);
    const remote = path.join(root, 'remote.git'); const project = path.join(root, 'project'); const updater = path.join(root, 'updater');
    await mkdir(project);
    await execFile('git', ['init', '--bare', remote]);
    await execFile('git', ['init', '-b', 'main'], { cwd: project });
    await execFile('git', ['config', 'user.email', 'test@example.com'], { cwd: project });
    await execFile('git', ['config', 'user.name', 'Sketchdraw Test'], { cwd: project });
    const documentPath = path.join(project, 'board.sketchdraw.json'); await writeFile(documentPath, '{"version":1}\n');
    await execFile('git', ['add', 'board.sketchdraw.json'], { cwd: project });
    await execFile('git', ['commit', '-m', 'Initial diagram'], { cwd: project });
    await execFile('git', ['remote', 'add', 'origin', remote], { cwd: project });
    await execFile('git', ['push', '-u', 'origin', 'main'], { cwd: project });

    await execFile('git', ['clone', '--branch', 'main', remote, updater]);
    await execFile('git', ['config', 'user.email', 'remote@example.com'], { cwd: updater });
    await execFile('git', ['config', 'user.name', 'Remote Test'], { cwd: updater });
    await writeFile(path.join(updater, 'remote-change.txt'), 'new remote commit\n');
    await execFile('git', ['add', 'remote-change.txt'], { cwd: updater });
    await execFile('git', ['commit', '-m', 'Remote change'], { cwd: updater });
    await execFile('git', ['push', 'origin', 'main'], { cwd: updater });
    expect((await execFile('git', ['rev-list', '--left-right', '--count', 'HEAD...origin/main'], { cwd: project })).stdout.trim()).toBe('0\t0');

    const service = new PluginService({ persistence: await projectPersistence({ project: documentPath }), credentials: credentials(), emitEvent: vi.fn() });
    await service.getSettings('project');
    const configured = await service.configureGit({ enabled: true, autoCommit: false, autoPush: false, autoPull: false, remote: 'origin', remoteUrl: '', authMode: 'system', username: '' });
    expect(configured.git).toMatchObject({ health: 'attention', ahead: 0, behind: 0 });
    expect(configured.git.message).toContain('Remote-Stand noch nicht aktualisiert');
    const beforeStatus = (await execFile('git', ['status', '--porcelain=v1'], { cwd: project })).stdout;

    const result = await service.gitStatus('project');
    expect(result).toMatchObject({ ok: true, settings: { health: 'ready', ahead: 0, behind: 1, message: 'Repository liegt hinter dem Remote.' }, message: 'Verbindung zu „origin“ steht. Repository liegt hinter dem Remote.' });
    expect((await execFile('git', ['status', '--porcelain=v1'], { cwd: project })).stdout).toBe(beforeStatus);
    expect((await execFile('git', ['rev-list', '--left-right', '--count', 'HEAD...origin/main'], { cwd: project })).stdout.trim()).toBe('0\t1');
    service.dispose();
  });

  it('reports an unreachable remote instead of returning a misleading zero count (#175)', async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), 'sketchdraw-git-status-error-')); cleanup.push(dir);
    const documentPath = path.join(dir, 'board.sketchdraw.json'); await writeFile(documentPath, '{"version":1}\n');
    await execFile('git', ['init', '-b', 'main'], { cwd: dir });
    await execFile('git', ['config', 'user.email', 'test@example.com'], { cwd: dir });
    await execFile('git', ['config', 'user.name', 'Sketchdraw Test'], { cwd: dir });
    await execFile('git', ['add', 'board.sketchdraw.json'], { cwd: dir });
    await execFile('git', ['commit', '-m', 'Initial diagram'], { cwd: dir });
    await execFile('git', ['remote', 'add', 'origin', path.join(dir, 'unreachable.git')], { cwd: dir });
    const service = new PluginService({ persistence: await projectPersistence({ project: documentPath }), credentials: credentials(), emitEvent: vi.fn() });
    await service.getSettings('project');
    await service.configureGit({ enabled: true, autoCommit: false, autoPush: false, autoPull: false, remote: 'origin', remoteUrl: '', authMode: 'system', username: '' });

    const result = await service.gitStatus('project');
    expect(result.ok).toBe(false);
    expect(result.settings).toMatchObject({ health: 'error' });
    expect(result.message).toContain('Verbindung zu „origin“ fehlgeschlagen');
    service.dispose();
  });

  it('reports a refused sign-in without exposing or reusing a stale count (#175)', async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), 'sketchdraw-git-status-auth-error-')); cleanup.push(dir);
    const documentPath = path.join(dir, 'board.sketchdraw.json'); await writeFile(documentPath, '{"version":1}\n');
    const fetchEnvironment: Array<Readonly<Record<string, string | undefined>> | undefined> = [];
    const runGit = async (args: string[], cwd: string, environment?: Readonly<Record<string, string | undefined>>) => {
      if (args[0] === 'ls-remote' || args[0] === 'fetch') { fetchEnvironment.push(environment); throw new Error('authentication failed'); }
      return execFile('git', args, { cwd });
    };
    const service = new PluginService({ persistence: await projectPersistence({ project: documentPath }), credentials: credentials(), emitEvent: vi.fn(), runGit });
    await service.getSettings('project');
    await service.configureGit({ enabled: true, autoCommit: false, autoPush: false, autoPull: false, remote: 'origin', remoteUrl: 'https://example.invalid/repo.git', authMode: 'token', username: 'alice', accessToken: 'secret' });
    await execFile('git', ['config', 'user.email', 'test@example.com'], { cwd: dir });
    await execFile('git', ['config', 'user.name', 'Sketchdraw Test'], { cwd: dir });
    await execFile('git', ['add', 'board.sketchdraw.json'], { cwd: dir });
    await execFile('git', ['commit', '-m', 'Initial diagram'], { cwd: dir });

    const result = await service.gitStatus('project');
    expect(result).toMatchObject({ ok: false, settings: { health: 'error' } });
    expect(result.message).toContain('Verbindung zu „origin“ fehlgeschlagen: authentication failed');
    expect(fetchEnvironment).toHaveLength(1);
    expect(fetchEnvironment[0]).toMatchObject({ GIT_CONFIG_KEY_0: 'http.https://example.invalid/repo.git.extraHeader', GIT_CONFIG_KEY_1: 'http.followRedirects', GIT_CONFIG_VALUE_1: 'false' });
    expect(result.message).not.toContain('secret');
    service.dispose();
  });

  it('makes the folder of an opened diagram a repository when the active profile has Git switched on', async () => {
    const first = await mkdtemp(path.join(os.tmpdir(), 'sketchdraw-git-init-a-')); const second = await mkdtemp(path.join(os.tmpdir(), 'sketchdraw-git-init-b-')); const existing = await mkdtemp(path.join(os.tmpdir(), 'sketchdraw-git-init-c-')); cleanup.push(first, second, existing);
    const a = path.join(first, 'a.sketchdraw.json'); const b = path.join(second, 'b.sketchdraw.json'); const nested = path.join(existing, 'diagrams'); await mkdir(nested); const c = path.join(nested, 'c.sketchdraw.json');
    await writeFile(a, '{}'); await writeFile(b, '{}'); await writeFile(c, '{}');
    await execFile('git', ['init', '-b', 'main'], { cwd: existing });
    await execFile('git', ['remote', 'add', 'origin', 'https://example.invalid/kept.git'], { cwd: existing });
    const service = new PluginService({ configPath: await profileStore(), persistence: await projectPersistence({ a, b, c }), credentials: credentials(), emitEvent: vi.fn() });
    const isRepository = async (dir: string) => fs.stat(path.join(dir, '.git')).then(() => true, () => false);

    // The profile is configured before any diagram has a folder: nothing can be initialized yet.
    await service.configureGit({ enabled: true, autoCommit: true, autoPush: false, autoPull: false, remote: 'origin', remoteUrl: 'https://example.invalid/team.git', authMode: 'system', username: '' });
    // Opening or saving a diagram gives Git its folder; a folder without a repository gets one, with the remote of the profile.
    const opened = await service.getSettings('a');
    expect(await isRepository(first)).toBe(true);
    expect((await execFile('git', ['remote', 'get-url', 'origin'], { cwd: first })).stdout.trim()).toBe('https://example.invalid/team.git');
    expect(opened.git).toMatchObject({ enabled: true, health: 'attention', repositoryName: path.basename(first), message: 'Lokale Änderungen erkannt.' });
    // The first save after that is committed like any other.
    await execFile('git', ['config', 'user.email', 'test@example.com'], { cwd: first }); await execFile('git', ['config', 'user.name', 'Sketchdraw Test'], { cwd: first });
    await service.afterDocumentSaved('a');
    expect((await execFile('git', ['log', '-1', '--pretty=%s'], { cwd: first })).stdout.trim()).toBe('Update a.sketchdraw.json via Sketchdraw');

    // A folder inside an existing repository is left exactly as it is: no nested repository, no changed remote.
    await service.getSettings('c');
    expect(await isRepository(nested)).toBe(false);
    expect((await execFile('git', ['remote', 'get-url', 'origin'], { cwd: existing })).stdout.trim()).toBe('https://example.invalid/kept.git');

    // A switched-off plugin touches no folder.
    await service.configureGit({ enabled: false, autoCommit: true, autoPush: false, autoPull: false, remote: 'origin', remoteUrl: 'https://example.invalid/team.git', authMode: 'system', username: '' });
    await service.getSettings('b');
    expect(await isRepository(second)).toBe(false);
    // Switching to a profile with Git switched on sets up the folder of the open diagram as well.
    await service.createProfile({ name: 'Mit Git' });
    await service.configureGit({ enabled: true, autoCommit: true, autoPush: false, autoPull: false, remote: 'origin', remoteUrl: '', authMode: 'system', username: '' });
    await service.selectProfile('default'); expect((await service.getSettings()).git.enabled).toBe(false);
    await rm(path.join(second, '.git'), { recursive: true, force: true });
    const switched = await service.selectProfile((await service.getSettings()).profiles.find((profile) => profile.name === 'Mit Git')!.id);
    expect(await isRepository(second)).toBe(true);
    expect(switched.git).toMatchObject({ enabled: true, repositoryName: path.basename(second) });
    service.dispose();
  });

  it('reports a folder that cannot become a repository instead of failing the opening of the diagram', async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), 'sketchdraw-git-init-error-')); cleanup.push(dir);
    const documentPath = path.join(dir, 'board.sketchdraw.json'); await writeFile(documentPath, '{}');
    let fail = false;
    const runGit = async (args: string[], cwd: string) => { if (fail) throw new Error(args[0] === 'init' ? 'permission denied' : 'not a repository'); return execFile('git', args, { cwd }); };
    const service = new PluginService({ configPath: await profileStore(), persistence: await projectPersistence({ project: documentPath }), credentials: credentials(), emitEvent: vi.fn(), runGit });
    await service.configureGit({ enabled: true, autoCommit: true, autoPush: false, autoPull: false, remote: 'origin', remoteUrl: '', authMode: 'system', username: '' });
    fail = true;
    const opened = await service.getSettings('project');
    expect(opened.projectFolder).toBe(await realpath(dir));
    expect(opened.git).toMatchObject({ enabled: true, health: 'error', message: 'Das Git-Repository konnte nicht eingerichtet werden: permission denied' });
    setLocale('en'); expect(tm(opened.git.message)).toBe('The Git repository could not be set up: permission denied');
    service.dispose();
  });

  it('checks the connection to the remote and accepts a branch that was never pushed', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'sketchdraw-git-connection-')); cleanup.push(root);
    const remote = path.join(root, 'remote.git'); const project = path.join(root, 'project'); await mkdir(project);
    await execFile('git', ['init', '--bare', remote]);
    const documentPath = path.join(project, 'board.sketchdraw.json'); await writeFile(documentPath, '{"version":1}\n');
    const service = new PluginService({ configPath: await profileStore(), persistence: await projectPersistence({ project: documentPath }), credentials: credentials(), emitEvent: vi.fn() });
    await service.configureGit({ enabled: true, autoCommit: false, autoPush: false, autoPull: false, remote: 'origin', remoteUrl: '', authMode: 'system', username: '' });
    await service.getSettings('project');

    // A new repository has no remote yet: the check names what is missing instead of a raw git error.
    const withoutRemote = await service.gitStatus('project');
    expect(withoutRemote).toMatchObject({ ok: false, settings: { health: 'error' }, message: 'Für „origin“ ist keine Remote-URL eingetragen.' });

    // The remote answers, but nothing was pushed: the connection stands and there is nothing to compare.
    await execFile('git', ['remote', 'add', 'origin', remote], { cwd: project });
    const empty = await service.gitStatus('project');
    expect(empty).toMatchObject({ ok: true, settings: { health: 'ready', ahead: 0, behind: 0, message: 'Der Branch ist auf dem Remote noch nicht vorhanden.' }, message: 'Verbindung zu „origin“ steht. Der Branch ist auf dem Remote noch nicht vorhanden.' });
    setLocale('en'); expect(tm(empty.message)).toBe('Connected to “origin”. The branch does not exist on the remote yet.'); setLocale('de');

    // Once the branch is on the remote the check compares both sides as before.
    await execFile('git', ['config', 'user.email', 'test@example.com'], { cwd: project }); await execFile('git', ['config', 'user.name', 'Sketchdraw Test'], { cwd: project });
    await execFile('git', ['add', 'board.sketchdraw.json'], { cwd: project }); await execFile('git', ['commit', '-m', 'Initial diagram'], { cwd: project });
    await execFile('git', ['push', 'origin', 'HEAD'], { cwd: project });
    expect(await service.gitStatus('project')).toMatchObject({ ok: true, settings: { health: 'ready', ahead: 0, behind: 0 }, message: 'Verbindung zu „origin“ steht. Repository ist synchron.' });
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

  it.each([
    ['invalid-json', '{"version":3,"profiles":"broken"'],
    ['unsupported-version', JSON.stringify({ version: 4, privateData: 'keep-future-data' })],
    ['invalid-data', JSON.stringify({ version: 3, activeProfileId: 'default', profiles: [{ id: 'default', name: 'Standard', git: { enabled: 'yes' }, atlassian: {} }] })],
    ['invalid-data', JSON.stringify({ version: 3, activeProfileId: 'default', profiles: [{ id: 'default', name: 'Standard', git: [], atlassian: {} }] })],
    ['invalid-data', JSON.stringify({ version: 3, activeProfileId: 'missing', profiles: [{ id: 'default', name: 'Standard', git: {}, atlassian: {} }] })],
    ['invalid-data', JSON.stringify({ version: 3, activeProfileId: 'default', profiles: [{ id: 'default', name: 'Standard', git: { remote: '--upload-pack=x' }, atlassian: {} }] })],
    ['invalid-data', JSON.stringify({ version: 3, activeProfileId: 'default', profiles: [{ id: 'default', name: 'Standard', git: {}, atlassian: { siteUrl: 'https://user:secret@example.com' } }] })],
  ])('preserves a %s profile file and blocks all configuration writes before Git side effects (#161)', async (kind, original) => {
    const configPath = await profileStore();
    await writeFile(configPath, original!);
    // An old recovery file is not replaced either.
    await writeFile(`${configPath}.unreadable`, 'older-backup');
    const documentPath = path.join(path.dirname(configPath), 'board.sketchdraw.json'); await writeFile(documentPath, '{}');
    const runGit = vi.fn(async () => ({ stdout: '', stderr: '' }));
    const service = new PluginService({ configPath, persistence: await projectPersistence({ project: documentPath }), credentials: credentials(), emitEvent: vi.fn(), runGit });
    const settings = await service.getSettings('project');
    expect(settings).toMatchObject({ configurationIssue: { source: 'profiles', kind, blocksChanges: true }, atlassian: { enabled: false } });
    expect(settings.configurationIssue?.message).toContain('Starte die App danach neu');
    await expect(service.configureAtlassian(jiraInput('NEW'))).rejects.toThrow('gesperrt');
    await expect(service.configureGit({ enabled: true, autoCommit: true, autoPush: false, autoPull: false, remote: 'origin', remoteUrl: '', authMode: 'system', username: '' })).rejects.toThrow('gesperrt');
    await expect(service.installPlugin('git')).rejects.toThrow('gesperrt');
    await expect(service.uninstallPlugin('jira')).rejects.toThrow('gesperrt');
    await expect(service.createProfile({ name: 'Neu' })).rejects.toThrow('gesperrt');
    await expect(service.renameProfile({ id: 'default', name: 'Neu' })).rejects.toThrow('gesperrt');
    expect(runGit).not.toHaveBeenCalled();
    expect(await readFile(configPath, 'utf8')).toBe(original);
    expect(await readFile(`${configPath}.unreadable`, 'utf8')).toBe('older-backup');
    expect(JSON.stringify(settings)).not.toContain('keep-future-data');
    service.dispose();
  });

  it('distinguishes a read error from a missing file and permits recovery only after a restart (#161)', async () => {
    const configPath = await profileStore(); await mkdir(configPath);
    const options = { configPath, persistence: await projectPersistence({}), credentials: credentials(), emitEvent: vi.fn() };
    const service = new PluginService(options);
    expect(await service.getSettings()).toMatchObject({ configurationIssue: { source: 'profiles', kind: 'read-error', blocksChanges: true } });
    await expect(service.configureAtlassian(jiraInput('NEW'))).rejects.toThrow('gesperrt');
    await rename(configPath, `${configPath}.recovered`);
    await expect(service.createProfile({ name: 'Still blocked' })).rejects.toThrow('gesperrt');
    service.dispose();
    const restarted = new PluginService(options);
    expect(await restarted.getSettings()).not.toHaveProperty('configurationIssue');
    await restarted.configureAtlassian(jiraInput('RECOVERED'));
    expect(JSON.parse(await readFile(configPath, 'utf8')).profiles[0].atlassian.jiraProjectKey).toBe('RECOVERED');
    restarted.dispose();
  });

  it('translates the complete recovery message returned by the service into English (#161)', async () => {
    const configPath = await profileStore(); await writeFile(configPath, '{"version":99}');
    const service = new PluginService({ configPath, persistence: await projectPersistence({}), credentials: credentials(), emitEvent: vi.fn() });
    const message = (await service.getSettings()).configurationIssue!.message;
    setLocale('en');
    expect(tm(message)).toBe(`The plugin configuration “${configPath}” has an unsupported version. The file remains unchanged. Changes to profiles and plugins are blocked. Back up the file and use an app version that supports this configuration format. Then restart the app.`);
    service.dispose();
  });

  it.each([
    ['invalid-json', '{"version":2'],
    ['unsupported-version', JSON.stringify({ version: 9, git: {}, atlassian: {} })],
    ['invalid-data', JSON.stringify({ version: 2, git: {}, atlassian: { encryptedApiToken: 42 } })],
    ['invalid-data', JSON.stringify({ version: 2, git: { enabled: true, autoPush: true, remote: '--upload-pack=x' }, atlassian: {} })],
    ['invalid-data', JSON.stringify({ version: 2, git: { enabled: true, autoPush: true, remote: 'https://unexpected.example/repo.git' }, atlassian: {} })],
    ['invalid-data', JSON.stringify({ version: 2, git: {}, atlassian: { siteUrl: 'http://unexpected.example' } })],
  ])('reports a %s legacy file without replacing it or importing its values (#161)', async (kind, original) => {
    const configPath = await profileStore(); const folder = path.dirname(configPath);
    const documentPath = path.join(folder, 'board.sketchdraw.json'); await writeFile(documentPath, '{}');
    const legacyPath = path.join(folder, '.sketchdraw-plugins.json'); await writeFile(legacyPath, original!);
    const runGit = vi.fn(async () => ({ stdout: '', stderr: '' }));
    const service = new PluginService({ configPath, persistence: await projectPersistence({ project: documentPath }), credentials: credentials(), emitEvent: vi.fn(), runGit });
    expect(await service.getSettings('project')).toMatchObject({ configurationIssue: { source: 'legacy', kind, blocksChanges: false }, atlassian: { enabled: false, credentialStored: false } });
    await service.configureAtlassian(jiraInput('NEW'));
    expect(await readFile(legacyPath, 'utf8')).toBe(original);
    expect(JSON.parse(await readFile(configPath, 'utf8')).profiles[0].atlassian.jiraProjectKey).toBe('NEW');
    expect(runGit).not.toHaveBeenCalled();
    expect(await service.getSettings(null)).not.toHaveProperty('configurationIssue');
    service.dispose();
  });

  it('reads the project of new tickets from the JQL filter', async () => {
    for (const [jql, project] of [
      ['project = ARCH', 'ARCH'], ['project=arch AND assignee = currentUser() ORDER BY updated DESC', 'ARCH'], ['project in (SHOP)', 'SHOP'], ['status = Open AND project = "SHOP"', 'SHOP'],
      ['project in (SHOP, API)', null], ['project = SHOP OR project = API', null], ['project = "Online Shop"', null], ['project != SHOP', null], ['project not in (SHOP)', null], ['assignee = currentUser()', null], ['', null],
    ] as const) expect(jqlProject(jql), jql).toBe(project);
    const dir = await mkdtemp(path.join(os.tmpdir(), 'sketchdraw-jql-')); cleanup.push(dir);
    const documentPath = path.join(dir, 'board.sketchdraw.json'); await writeFile(documentPath, '{}\n');
    const bodies: Array<Record<string, unknown>> = [];
    const fetchFn = vi.fn(async (input: string | URL | Request, init?: RequestInit): Promise<Response> => {
      const url = String(input);
      if (typeof init?.body === 'string') bodies.push({ url, ...(JSON.parse(init.body) as Record<string, unknown>) });
      if (url.endsWith('/rest/api/3/issue') && init?.method === 'POST') return new Response(JSON.stringify({ id: '1', key: 'ARCH-1' }));
      if (url.includes('/rest/api/3/issue/ARCH-1')) return new Response(JSON.stringify({ id: '1', key: 'ARCH-1', fields: { summary: 'Neu', status: { name: 'To Do' }, updated: '2026-11-23T10:00:00.000Z' } }));
      return new Response(JSON.stringify({ issues: [] }));
    });
    const service = new PluginService({ configPath: await profileStore(), persistence: await projectPersistence({ project: documentPath }), credentials: credentials(), emitEvent: vi.fn(), fetchFn: fetchFn as typeof fetch });
    await service.activateDocument('project');
    // The settings send the filter alone; the project it names is where new tickets go, as a task.
    const saved = await service.configureAtlassian({ plugin: 'jira', enabled: true, siteUrl: 'https://example.atlassian.net', email: 'user@example.com', apiToken: 'secret', confluenceSpaceKey: '', jiraProjectKey: '', jiraIssueType: 'Task', jqlFilter: 'project = arch AND assignee = currentUser()' });
    expect(saved.atlassian).toMatchObject({ enabled: true, jiraProjectKey: 'ARCH', jqlFilter: 'project = arch AND assignee = currentUser()' });
    await service.listJiraIssues();
    expect(bodies.at(-1)).toMatchObject({ jql: 'project = arch AND assignee = currentUser() ORDER BY updated DESC' });
    await service.createJiraIssue({ title: 'Neu', description: '' });
    expect(bodies.find((body) => String(body.url).endsWith('/rest/api/3/issue'))).toMatchObject({ fields: { project: { key: 'ARCH' }, issuetype: { name: 'Task' } } });
    // A filter over several projects still reads; a new ticket has no single place and is refused with the reason.
    expect((await service.configureAtlassian({ plugin: 'jira', enabled: true, siteUrl: 'https://example.atlassian.net', email: 'user@example.com', confluenceSpaceKey: '', jiraProjectKey: '', jiraIssueType: 'Task', jqlFilter: 'project in (ARCH, API)' })).atlassian.jiraProjectKey).toBe('');
    await service.listJiraIssues();
    expect(bodies.at(-1)).toMatchObject({ jql: 'project in (ARCH, API) ORDER BY updated DESC' });
    await expect(service.createJiraIssue({ title: 'Neu', description: '' })).rejects.toThrow('Der JQL-Filter nennt kein einzelnes Jira-Projekt.');
    service.dispose();
  });

  it('finds a Confluence page by its address or number in any space, and by its title on the site', async () => {
    const site = 'https://example.atlassian.net';
    expect(confluencePageReference(`${site}/wiki/spaces/ARCH/pages/4711001/Test`, site)).toEqual({ id: '4711001', url: `${site}/wiki/spaces/ARCH/pages/4711001/Test` });
    expect(confluencePageReference(`${site}/wiki/pages/viewpage.action?pageId=42#top`, site)).toEqual({ id: '42', url: undefined });
    expect(confluencePageReference(' 4711001 ', site)).toEqual({ id: '4711001' });
    expect(confluencePageReference('https://other.example/wiki/spaces/A/pages/1/T', site)).toBeNull();
    expect(confluencePageReference('Test 123', site)).toBeNull();
    const dir = await mkdtemp(path.join(os.tmpdir(), 'sketchdraw-confluence-search-')); cleanup.push(dir);
    const documentPath = path.join(dir, 'board.sketchdraw.json'); await writeFile(documentPath, '{}\n');
    const asked: URL[] = [];
    const fetchFn = vi.fn(async (input: string | URL | Request): Promise<Response> => {
      const url = new URL(String(input)); asked.push(url);
      if (url.pathname === '/wiki/api/v2/pages/4711001') return new Response(JSON.stringify({ id: '4711001', title: 'Test', version: { number: 4 } }));
      if (url.pathname === '/wiki/api/v2/pages/404') return new Response('{}', { status: 404 });
      if (url.pathname === '/wiki/rest/api/content/search') return new Response(JSON.stringify({ results: [{ id: '55', title: 'Testplan', version: { number: 2 }, space: { key: 'ARCH' }, _links: { webui: '/spaces/ARCH/pages/55/Testplan' } }, { id: 'not-a-number', title: 'x' }] }));
      return new Response('{}');
    });
    const service = new PluginService({ configPath: await profileStore(), persistence: await projectPersistence({ project: documentPath }), credentials: credentials(), emitEvent: vi.fn(), fetchFn: fetchFn as typeof fetch });
    await service.activateDocument('project');
    await service.configureAtlassian({ plugin: 'confluence', enabled: true, siteUrl: site, email: 'user@example.com', apiToken: 'secret', confluenceSpaceKey: '', jiraProjectKey: '', jiraIssueType: 'Task', jqlFilter: '' });
    expect(await service.listConfluencePages(`${site}/wiki/spaces/ARCH/pages/4711001/Test`)).toEqual([{ id: '4711001', title: 'Test', version: 4, url: `${site}/wiki/spaces/ARCH/pages/4711001/Test` }]);
    expect(await service.listConfluencePages('404')).toEqual([]);
    expect(await service.listConfluencePages('test')).toEqual([{ id: '55', title: 'Testplan', version: 2, url: `${site}/wiki/spaces/ARCH/pages/55/Testplan` }]);
    expect(asked.at(-1)!.searchParams.get('cql')).toBe('type = page AND title ~ "test*" ORDER BY lastmodified DESC');
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
    // Each plugin tests its own product and answers for itself alone; its result stays under its name.
    fetchFn.mockClear();
    expect(await service.testAtlassian('jira')).toEqual({ ok: true, message: 'Jira: verbunden' });
    expect(fetchFn.mock.calls.map(([input]) => new URL(String(input)).pathname)).toEqual(['/rest/api/3/myself']);
    fetchFn.mockClear();
    expect(await service.testAtlassian('confluence')).toEqual({ ok: true, message: 'Confluence: verbunden' });
    expect(fetchFn.mock.calls.map(([input]) => new URL(String(input)).pathname)).toEqual(['/wiki/api/v2/spaces']);
    expect((await service.getSettings()).atlassian).toMatchObject({ health: 'ready', message: 'Confluence: verbunden', jiraMessage: 'Jira: verbunden', confluenceMessage: 'Confluence: verbunden' });
    expect(await service.listConfluencePages('live')).toMatchObject([{ id: '7', title: 'Live Doc', version: 3 }]);
    // The title search of the site was asked first, within the configured space; it found nothing here, so the list answered.
    const searched = fetchFn.mock.calls.map(([input]) => new URL(String(input))).find((url) => url.pathname === '/wiki/rest/api/content/search')!;
    expect(searched.searchParams.get('cql')).toBe('type = page AND title ~ "live*" AND space = "DOC" ORDER BY lastmodified DESC');
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
    await service.uninstallPlugin('git'); await service.uninstallPlugin('jira'); await service.uninstallPlugin('confluence');
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
    await expect(service.updateJiraIssue({ key: 'KEEP-1', assignee: 'Alice' })).rejects.toThrow('lokales Diagramm');
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
    let started!: () => void; const startedGit = new Promise<void>((resolve) => { started = resolve; });
    const runGit = vi.fn(async () => { started(); await gate; throw new Error('no repository'); });
    const service = new PluginService({ persistence: await projectPersistence({ a, b }), credentials: credentials(), emitEvent: vi.fn(), runGit });
    await service.getSettings('a');
    const pending = service.configureGit({ enabled: true, autoCommit: true, autoPush: false, autoPull: false, remote: 'origin', remoteUrl: '', authMode: 'system', username: '' });
    const rejection = expect(pending).rejects.toThrow('Projektordner hat sich geändert');
    await startedGit;
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
    const configPath = await profileStore();
    const fetchFn = vi.fn(async () => new Response('{}'));
    const service = new PluginService({ configPath, persistence: await projectPersistence({ project: documentPath }), credentials: credentials(), emitEvent: vi.fn(), fetchFn });
    await service.getSettings('project');
    // Loading succeeds; the actual atomic write fails after creating its temporary file.
    const renameFile = vi.spyOn(fs, 'rename').mockRejectedValue(Object.assign(new Error('simulated rename failure'), { code: 'EACCES' }));
    await expect(service.configureAtlassian(jiraInput('NEW'))).rejects.toThrow('simulated rename failure');
    expect(renameFile).toHaveBeenCalledTimes(1);
    expect((await readdir(path.dirname(configPath))).filter((name) => name.endsWith('.tmp'))).toEqual([]);
    await expect(readFile(configPath, 'utf8')).rejects.toMatchObject({ code: 'ENOENT' });
    expect((await service.getSettings()).atlassian).toMatchObject({ enabled: false, credentialStored: false, jiraProjectKey: '' });
    await expect(service.createProfile({ name: 'Neu' })).rejects.toThrow();
    expect(await service.getSettings()).toMatchObject({ activeProfileId: 'default', profiles: [{ id: 'default' }] });
    await expect(service.listJiraIssues()).rejects.toThrow(); expect(fetchFn).not.toHaveBeenCalled();
    service.dispose();
  });

  it('refuses a stale app instance overwrite and preserves the newer profiles and credentials (#181)', async () => {
    const configPath = await profileStore();
    const options = { configPath, persistence: await projectPersistence({}), credentials: credentials(), emitEvent: vi.fn() };
    const first = new PluginService(options); const stale = new PluginService(options);
    await first.getSettings(); await stale.getSettings();
    await first.createProfile({ name: 'Neuere Konfiguration' });
    await first.configureAtlassian(jiraInput('NEWER'));
    const newer = await readFile(configPath, 'utf8');
    await expect(stale.configureAtlassian(jiraInput('STALE'))).rejects.toThrow('außerhalb dieser App-Instanz');
    expect(await readFile(configPath, 'utf8')).toBe(newer);
    expect(await stale.getSettings()).toMatchObject({ configurationIssue: { kind: 'external-change', blocksChanges: true }, atlassian: { enabled: false } });
    await expect(stale.createProfile({ name: 'Stale' })).rejects.toThrow('gesperrt');
    first.dispose(); stale.dispose();
    const restarted = new PluginService(options);
    expect(await restarted.getSettings()).toMatchObject({ atlassian: { jiraProjectKey: 'NEWER', credentialStored: true } });
    restarted.dispose();
  });

  it('serializes the Git preflight with this instances own rename instead of falsely locking it (#181)', async () => {
    const configPath = await profileStore();
    const service = new PluginService({ configPath, persistence: await projectPersistence({}), credentials: credentials(), emitEvent: vi.fn() });
    await service.configureAtlassian(jiraInput('BASE'));
    const original = await readFile(configPath, 'utf8');
    let reachedRename!: () => void; let releaseRename!: () => void; let releaseRead!: () => void;
    const atRename = new Promise<void>((resolve) => { reachedRename = resolve; });
    const renameGate = new Promise<void>((resolve) => { releaseRename = resolve; });
    const readGate = new Promise<void>((resolve) => { releaseRead = resolve; });
    let renamed = false;
    const actualRename = fs.rename.bind(fs); const actualRead = fs.readFile.bind(fs);
    vi.spyOn(fs, 'rename').mockImplementationOnce(async (...args) => { reachedRename(); await renameGate; await actualRename(...args); renamed = true; });
    const renaming = service.renameProfile({ id: 'default', name: 'Renamed profile' });
    await atRename;
    vi.spyOn(fs, 'readFile').mockImplementationOnce(async (...args) => { const contents = renamed ? await actualRead(...args) : original; await readGate; return contents; });
    const configuring = service.configureGit({ enabled: false, autoCommit: false, autoPush: false, autoPull: false, remote: 'origin', remoteUrl: '', authMode: 'system', username: '' });
    // Let an incorrectly unqueued preflight capture the old bytes while our own rename is paused.
    await new Promise<void>((resolve) => setImmediate(resolve));
    releaseRename(); await renaming; releaseRead();
    expect(await configuring).not.toHaveProperty('configurationIssue');
    expect((await service.getSettings()).profiles).toEqual([{ id: 'default', name: 'Renamed profile' }]);
    service.dispose();
  });

  it('loads historic credential comparison URLs but does not bind a new token to an unsafe discovered URL (#161)', async () => {
    const configPath = await profileStore(); const folder = path.dirname(configPath);
    const documentPath = path.join(folder, 'board.sketchdraw.json'); await writeFile(documentPath, '{}');
    await execFile('git', ['init'], { cwd: folder });
    await execFile('git', ['remote', 'add', 'origin', 'https://user@host.example/repo.git'], { cwd: folder });
    const options = { configPath, persistence: await projectPersistence({ project: documentPath }), credentials: credentials(), emitEvent: vi.fn() };
    const service = new PluginService(options); await service.getSettings('project');
    await service.configureGit({ enabled: true, autoCommit: false, autoPush: false, autoPull: false, remote: 'origin', remoteUrl: '', authMode: 'token', username: 'alice', accessToken: 'secret' });
    const stored = JSON.parse(await readFile(configPath, 'utf8'));
    expect(stored.profiles[0].git).not.toHaveProperty('credentialRemoteUrl');
    service.dispose();
    const restarted = new PluginService(options);
    expect(await restarted.getSettings()).not.toHaveProperty('configurationIssue');
    restarted.dispose();
    // A previous release could have captured this value directly from `git remote get-url`.
    stored.profiles[0].git.credentialRemoteUrl = 'https://user@host.example/repo.git';
    await writeFile(configPath, JSON.stringify(stored));
    const historic = new PluginService(options);
    expect(await historic.getSettings()).toMatchObject({ git: { enabled: true, credentialStored: true } });
    expect(await historic.getSettings()).not.toHaveProperty('configurationIssue');
    historic.dispose();
  });

  it('detects an external change before Git side effects and before an atomic rename (#181)', async () => {
    const configPath = await profileStore(); const folder = path.dirname(configPath);
    const documentPath = path.join(folder, 'board.sketchdraw.json'); await writeFile(documentPath, '{}');
    const runGit = vi.fn(async () => ({ stdout: '', stderr: '' }));
    const options = { configPath, persistence: await projectPersistence({ project: documentPath }), credentials: credentials(), emitEvent: vi.fn(), runGit };
    const service = new PluginService(options); await service.getSettings('project');
    const future = '{"version":99,"keep":"newer"}'; await writeFile(configPath, future);
    await expect(service.configureGit({ enabled: true, autoCommit: true, autoPush: false, autoPull: false, remote: 'origin', remoteUrl: '', authMode: 'system', username: '' })).rejects.toThrow('außerhalb dieser App-Instanz');
    expect(runGit).not.toHaveBeenCalled(); expect(await readFile(configPath, 'utf8')).toBe(future);
    service.dispose(); await rm(configPath);
    const racing = new PluginService(options); await racing.getSettings();
    const write = fs.writeFile.bind(fs);
    vi.spyOn(fs, 'writeFile').mockImplementationOnce(async (...args) => { await write(...args); await write(configPath, future); });
    await expect(racing.createProfile({ name: 'Race' })).rejects.toThrow('außerhalb dieser App-Instanz');
    expect(await readFile(configPath, 'utf8')).toBe(future);
    expect((await readdir(folder)).filter((name) => name.endsWith('.tmp'))).toEqual([]);
    expect((await racing.getSettings()).profiles).toEqual([{ id: 'default', name: 'Standard' }]);
    racing.dispose();
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


  it('treats Jira and Confluence as two plugins on one Atlassian connection (#282)', async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), 'sketchdraw-split-')); cleanup.push(dir);
    const documentPath = path.join(dir, 'board.sketchdraw.json'); await writeFile(documentPath, '{}');
    const configPath = await profileStore();
    const fetchFn = vi.fn(async (input: string | URL | Request) => {
      const url = String(input);
      if (url.includes('/rest/api/3/search/jql')) return new Response(JSON.stringify({ issues: [] }), { status: 200 });
      if (url.includes('/wiki/api/v2/spaces')) return new Response(JSON.stringify({ results: [{ id: '7' }] }), { status: 200 });
      if (url.includes('/wiki/api/v2/pages')) return new Response(JSON.stringify({ results: [] }), { status: 200 });
      return new Response('{}', { status: 200 });
    });
    const open = async () => { const service = new PluginService({ configPath, persistence: await projectPersistence({ project: documentPath }), credentials: credentials(), emitEvent: vi.fn(), fetchFn: fetchFn as typeof fetch }); await service.getSettings('project'); return service; };
    let service = await open();
    // Configured the way a version before the split did it: one switch, all fields.
    const legacy = { enabled: true, siteUrl: 'https://example.atlassian.net', email: 'alice@example.com', apiToken: 'secret', confluenceSpaceKey: 'DOC', jiraProjectKey: 'SK', jiraIssueType: 'Task', jqlFilter: '' };
    expect((await service.configureAtlassian(legacy)).atlassian).toMatchObject({ installed: true, enabled: true, jiraInstalled: true, jiraEnabled: true, confluenceInstalled: true, confluenceEnabled: true, credentialStored: true });
    await expect(service.listJiraIssues()).resolves.toEqual([]);
    await expect(service.listConfluencePages('')).resolves.toEqual([]);

    // Switching Confluence off alone leaves Jira as it is, and Confluence needs no Jira project.
    const confluenceOff = await service.configureAtlassian({ ...legacy, plugin: 'confluence', enabled: false, apiToken: '', jiraProjectKey: '', jiraIssueType: '', confluenceSpaceKey: 'TEAM' });
    expect(confluenceOff.atlassian).toMatchObject({ enabled: true, jiraEnabled: true, confluenceEnabled: false, jiraProjectKey: 'SK', jiraIssueType: 'Task', confluenceSpaceKey: 'TEAM', credentialStored: true });
    await expect(service.listConfluencePages('')).rejects.toThrow('Confluence-Plugin ist deaktiviert.');
    await expect(service.listJiraIssues()).resolves.toEqual([]);
    await service.configureAtlassian({ ...legacy, plugin: 'confluence', enabled: true, apiToken: '', confluenceSpaceKey: 'TEAM' });

    // Removing Jira keeps the connection for Confluence; Jira is refused from then on.
    const withoutJira = await service.uninstallPlugin('jira');
    expect(withoutJira.atlassian).toMatchObject({ installed: true, enabled: true, jiraInstalled: false, jiraEnabled: false, confluenceInstalled: true, confluenceEnabled: true, jiraProjectKey: '', credentialStored: true, siteUrl: legacy.siteUrl });
    await expect(service.listJiraIssues()).rejects.toThrow('Jira-Plugin ist deaktiviert.');
    await expect(service.listConfluencePages('')).resolves.toEqual([]);
    await expect(service.configureAtlassian({ ...legacy, plugin: 'jira' })).rejects.toThrow('Jira-Plugin ist nicht installiert.');
    // A version from before the split reads `installed` and `enabled`: they stay true while one of the two is in use.
    const stored = JSON.parse(await readFile(configPath, 'utf8')) as { profiles: Array<{ atlassian: Record<string, unknown> }> };
    expect(stored.profiles[0]!.atlassian).toMatchObject({ installed: true, enabled: true, jiraInstalled: false, confluenceInstalled: true });
    service.dispose();

    // Reopened, the state is the same; Jira can be installed again and starts switched off, with the connection in place.
    service = await open();
    expect((await service.getSettings()).atlassian).toMatchObject({ jiraInstalled: false, confluenceEnabled: true });
    expect((await service.installPlugin('jira')).atlassian).toMatchObject({ jiraInstalled: true, jiraEnabled: false, confluenceEnabled: true, credentialStored: true });
    // Jira works from its JQL filter: without a filter and without a project there is nothing to read.
    await expect(service.configureAtlassian({ ...legacy, plugin: 'jira', apiToken: '', jiraProjectKey: '' })).rejects.toThrow('JQL-Filter');
    expect((await service.configureAtlassian({ ...legacy, plugin: 'jira', apiToken: '', jiraProjectKey: 'OPS' })).atlassian).toMatchObject({ jiraEnabled: true, jiraProjectKey: 'OPS', confluenceSpaceKey: 'TEAM' });

    // The token goes with the last of the two plugins.
    expect((await service.uninstallPlugin('confluence')).atlassian).toMatchObject({ installed: true, confluenceInstalled: false, confluenceSpaceKey: '', credentialStored: true });
    expect((await service.uninstallPlugin('jira')).atlassian).toMatchObject({ installed: false, enabled: false, credentialStored: false, siteUrl: '' });
    service.dispose();
  });

  it('gives both plugins to a profile stored before the split', async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), 'sketchdraw-split-legacy-')); cleanup.push(dir);
    const documentPath = path.join(dir, 'board.sketchdraw.json'); await writeFile(documentPath, '{}');
    const configPath = await profileStore();
    // What 0.1.8 wrote: one plugin, switched on, with a token and a link of a page.
    const atlassian = { installed: true, enabled: true, siteUrl: 'https://example.atlassian.net', email: 'alice@example.com', encryptedApiToken: Buffer.from('secret').toString('base64'), confluenceSpaceKey: 'DOC', jiraProjectKey: 'SK', jiraIssueType: 'Task', jqlFilter: '' };
    const git = { installed: true, enabled: false, autoCommit: true, autoPush: false, autoPull: true, remote: 'origin', remoteUrl: '', authMode: 'system', username: '' };
    await writeFile(configPath, JSON.stringify({ version: 3, activeProfileId: 'default', profiles: [{ id: 'default', name: 'Standard', git, atlassian }, { id: 'off', name: 'Aus', git, atlassian: { ...atlassian, installed: false, enabled: false, encryptedApiToken: undefined } }] }));
    const service = new PluginService({ configPath, persistence: await projectPersistence({ project: documentPath }), credentials: credentials(), emitEvent: vi.fn(), fetchFn: vi.fn() as unknown as typeof fetch });
    const settings = await service.getSettings('project');
    expect(settings.configurationIssue).toBeUndefined();
    expect(settings.atlassian).toMatchObject({ installed: true, enabled: true, jiraInstalled: true, jiraEnabled: true, confluenceInstalled: true, confluenceEnabled: true, credentialStored: true, jiraProjectKey: 'SK', confluenceSpaceKey: 'DOC' });
    expect((await service.selectProfile('off')).atlassian).toMatchObject({ installed: false, jiraInstalled: false, confluenceInstalled: false, jiraEnabled: false, confluenceEnabled: false });
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
    await service.uninstallPlugin('jira'); await service.uninstallPlugin('confluence'); await expect(service.configureAtlassian(input)).rejects.toThrow('nicht installiert');
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

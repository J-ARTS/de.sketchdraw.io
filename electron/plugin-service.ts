import { execFile as execFileCallback } from 'node:child_process';
import { promises as fs, watch, type FSWatcher } from 'node:fs';
import path from 'node:path';
import { promisify } from 'node:util';
import type {
  AtlassianPluginSettings,
  ConfigureAtlassianPluginInput,
  ConfigureGitPluginInput,
  ConfluencePage,
  ConfluencePageSummary,
  GitPluginSettings,
  GitSyncResult,
  JiraIssueSummary,
  PluginExternalEvent,
  PluginOperationResult,
  PluginSettingsSnapshot,
  TaskStatus,
} from '../src/domain/index';
import type { DocumentPersistenceService } from './persistence';

const execFile = promisify(execFileCallback);
const CONFIG_VERSION = 1;
const MAX_REMOTE_BODY_BYTES = 2_000_000;

interface PersistedPluginConfig {
  version: 1;
  git: Omit<ConfigureGitPluginInput, never>;
  atlassian: Omit<ConfigureAtlassianPluginInput, 'apiToken' | 'clearCredential'> & { encryptedApiToken?: string };
}

interface CredentialAdapter {
  encrypt(value: string): string;
  decrypt(value: string): string;
  available(): boolean;
}

export interface PluginServiceOptions {
  configPath: string;
  persistence: DocumentPersistenceService;
  credentials: CredentialAdapter;
  emitEvent: (event: PluginExternalEvent) => void;
  fetchFn?: typeof fetch;
  runGit?: (args: string[], cwd: string) => Promise<{ stdout: string; stderr: string }>;
}

const DEFAULT_CONFIG: PersistedPluginConfig = {
  version: CONFIG_VERSION,
  git: { enabled: false, autoCommit: true, autoPush: false, autoPull: true, remote: 'origin' },
  atlassian: { enabled: false, siteUrl: '', email: '', confluenceSpaceKey: '', jiraProjectKey: '', jiraIssueType: 'Task' },
};

function boundedString(value: unknown, max: number, name: string, allowEmpty = false): string {
  if (typeof value !== 'string') throw new Error(`${name} muss Text sein.`);
  const normalized = value.trim();
  if ((!allowEmpty && normalized.length === 0) || normalized.length > max || /[\u0000-\u001f\u007f]/.test(normalized)) throw new Error(`${name} ist ungültig.`);
  return normalized;
}

function normalizeSiteUrl(value: string): string {
  const parsed = new URL(boundedString(value, 2048, 'Atlassian-URL'));
  if (parsed.username || parsed.password || (parsed.protocol !== 'https:' && !(parsed.protocol === 'http:' && ['localhost', '127.0.0.1'].includes(parsed.hostname)))) throw new Error('Atlassian benötigt eine HTTPS-URL ohne eingebettete Zugangsdaten.');
  parsed.pathname = parsed.pathname.replace(/\/$/, '');
  parsed.search = ''; parsed.hash = '';
  return parsed.toString().replace(/\/$/, '');
}

function jiraStatus(value: string): TaskStatus {
  const status = value.toLocaleLowerCase('en');
  if (status.includes('done') || status.includes('closed') || status.includes('resolved') || status.includes('fertig') || status.includes('erledigt')) return 'done';
  if (status.includes('review') || status.includes('prüfung')) return 'review';
  if (status.includes('progress') || status.includes('doing') || status.includes('arbeit')) return 'doing';
  return 'todo';
}

function adfText(value: unknown): string {
  if (typeof value === 'string') return value;
  if (!value || typeof value !== 'object') return '';
  const record = value as Record<string, unknown>;
  const own = typeof record.text === 'string' ? record.text : '';
  const children = Array.isArray(record.content) ? record.content.map(adfText).filter(Boolean).join(record.type === 'doc' ? '\n' : '') : '';
  return own || children;
}

function descriptionAdf(text: string): Record<string, unknown> {
  return { version: 1, type: 'doc', content: text.split(/\r?\n/).map((line) => ({ type: 'paragraph', content: line ? [{ type: 'text', text: line }] : [] })) };
}

function isoTimestamp(value: unknown): string {
  const parsed = typeof value === 'string' ? new Date(value) : new Date(Number.NaN);
  return Number.isNaN(parsed.getTime()) ? new Date().toISOString() : parsed.toISOString();
}

export class PluginService {
  private readonly configPath: string;
  private readonly persistence: DocumentPersistenceService;
  private readonly credentials: CredentialAdapter;
  private readonly emitEvent: (event: PluginExternalEvent) => void;
  private readonly fetchFn: typeof fetch;
  private readonly runGit: NonNullable<PluginServiceOptions['runGit']>;
  private config: PersistedPluginConfig = structuredClone(DEFAULT_CONFIG);
  private ready: Promise<void>;
  private readonly watchers = new Map<string, FSWatcher>();
  private readonly watcherTimers = new Map<string, NodeJS.Timeout>();
  private readonly pullTimers = new Map<string, NodeJS.Timeout>();
  private gitRuntime: GitPluginSettings = { ...DEFAULT_CONFIG.git, health: 'disabled', message: 'Git-Plugin ist deaktiviert.' };
  private atlassianRuntime: AtlassianPluginSettings = { ...DEFAULT_CONFIG.atlassian, credentialStored: false, health: 'disabled', message: 'Atlassian-Plugin ist deaktiviert.' };

  constructor(options: PluginServiceOptions) {
    this.configPath = options.configPath;
    this.persistence = options.persistence;
    this.credentials = options.credentials;
    this.emitEvent = options.emitEvent;
    this.fetchFn = options.fetchFn ?? fetch;
    this.runGit = options.runGit ?? (async (args, cwd) => {
      const result = await execFile('git', args, { cwd, timeout: 30_000, maxBuffer: 2_000_000, windowsHide: true });
      return { stdout: result.stdout, stderr: result.stderr };
    });
    this.ready = this.load();
  }

  private async load(): Promise<void> {
    try {
      const raw = JSON.parse(await fs.readFile(this.configPath, 'utf8')) as Partial<PersistedPluginConfig>;
      if (raw.version === CONFIG_VERSION && raw.git && raw.atlassian) this.config = { version: CONFIG_VERSION, git: { ...DEFAULT_CONFIG.git, ...raw.git }, atlassian: { ...DEFAULT_CONFIG.atlassian, ...raw.atlassian } };
    } catch { /* first start or malformed local file: use safe defaults */ }
    this.refreshRuntime();
  }

  private refreshRuntime(): void {
    const credentialStored = Boolean(this.config.atlassian.encryptedApiToken) && this.credentials.available();
    this.gitRuntime = { ...this.gitRuntime, ...this.config.git, health: this.config.git.enabled ? this.gitRuntime.health === 'disabled' ? 'attention' : this.gitRuntime.health : 'disabled', message: this.config.git.enabled ? this.gitRuntime.message === 'Git-Plugin ist deaktiviert.' ? 'Öffne ein gespeichertes Dokument in einem Git-Repository.' : this.gitRuntime.message : 'Git-Plugin ist deaktiviert.' };
    const { enabled, siteUrl, email, confluenceSpaceKey, jiraProjectKey, jiraIssueType } = this.config.atlassian;
    this.atlassianRuntime = { enabled, siteUrl, email, confluenceSpaceKey, jiraProjectKey, jiraIssueType, credentialStored, health: enabled ? credentialStored ? 'attention' : 'error' : 'disabled', message: enabled ? credentialStored ? 'Verbindung noch nicht geprüft.' : 'API-Token fehlt.' : 'Atlassian-Plugin ist deaktiviert.' };
  }

  private async persist(): Promise<void> {
    await fs.mkdir(path.dirname(this.configPath), { recursive: true });
    const temp = `${this.configPath}.${process.pid}.tmp`;
    await fs.writeFile(temp, `${JSON.stringify(this.config, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 });
    await fs.rename(temp, this.configPath);
  }

  public async getSettings(): Promise<PluginSettingsSnapshot> {
    await this.ready;
    return { available: true, git: { ...this.gitRuntime }, atlassian: { ...this.atlassianRuntime, email: this.config.atlassian.email } };
  }

  public async configureGit(input: ConfigureGitPluginInput): Promise<PluginSettingsSnapshot> {
    await this.ready;
    if (!input || typeof input !== 'object') throw new Error('Ungültige Git-Konfiguration.');
    this.clearWatchers();
    this.config.git = { enabled: Boolean(input.enabled), autoCommit: Boolean(input.autoCommit), autoPush: Boolean(input.autoPush), autoPull: Boolean(input.autoPull), remote: boundedString(input.remote || 'origin', 128, 'Git-Remote') };
    await this.persist(); this.refreshRuntime();
    return this.getSettings();
  }

  public async configureAtlassian(input: ConfigureAtlassianPluginInput): Promise<PluginSettingsSnapshot> {
    await this.ready;
    if (!input || typeof input !== 'object') throw new Error('Ungültige Atlassian-Konfiguration.');
    const siteInput = typeof input.siteUrl === 'string' ? input.siteUrl : '';
    const siteUrl = siteInput.trim() ? normalizeSiteUrl(siteInput) : '';
    const previousToken = this.config.atlassian.encryptedApiToken;
    let encryptedApiToken = input.clearCredential ? undefined : previousToken;
    if (typeof input.apiToken === 'string' && input.apiToken.trim()) {
      if (!this.credentials.available()) throw new Error('Sichere Zugangsdatenablage ist auf diesem System nicht verfügbar.');
      encryptedApiToken = this.credentials.encrypt(boundedString(input.apiToken, 4096, 'API-Token'));
    }
    const email = boundedString(input.email, 320, 'E-Mail', !input.enabled);
    const confluenceSpaceKey = boundedString(input.confluenceSpaceKey, 128, 'Confluence-Space', !input.enabled);
    const jiraProjectKey = boundedString(input.jiraProjectKey, 128, 'Jira-Projekt', !input.enabled).toUpperCase();
    if (input.enabled && (!siteUrl || !encryptedApiToken)) throw new Error('Für das Atlassian-Plugin werden URL, E-Mail, API-Token, Confluence-Space und Jira-Projekt benötigt.');
    this.config.atlassian = {
      enabled: Boolean(input.enabled), siteUrl,
      email, confluenceSpaceKey, jiraProjectKey,
      jiraIssueType: boundedString(input.jiraIssueType || 'Task', 128, 'Jira-Vorgangstyp'),
      ...(encryptedApiToken ? { encryptedApiToken } : {}),
    };
    await this.persist(); this.refreshRuntime();
    return this.getSettings();
  }

  private credential(): string {
    const value = this.config.atlassian.encryptedApiToken;
    if (!value || !this.credentials.available()) throw new Error('Kein sicher gespeichertes Atlassian-Token vorhanden.');
    return this.credentials.decrypt(value);
  }

  private async atlassian(pathname: string, init: RequestInit = {}): Promise<unknown> {
    await this.ready;
    if (!this.config.atlassian.enabled) throw new Error('Atlassian-Plugin ist deaktiviert.');
    const base = normalizeSiteUrl(this.config.atlassian.siteUrl);
    const response = await this.fetchFn(`${base}${pathname}`, {
      ...init,
      redirect: 'error',
      headers: { Accept: 'application/json', 'Content-Type': 'application/json', Authorization: `Basic ${Buffer.from(`${this.config.atlassian.email}:${this.credential()}`, 'utf8').toString('base64')}`, ...(init.headers ?? {}) },
      signal: AbortSignal.timeout(20_000),
    });
    const raw = await response.text();
    if (Buffer.byteLength(raw, 'utf8') > MAX_REMOTE_BODY_BYTES) throw new Error('Atlassian-Antwort ist zu groß.');
    if (!response.ok) throw new Error(`Atlassian antwortete mit ${response.status}.`);
    return raw ? JSON.parse(raw) : {};
  }

  public async testAtlassian(): Promise<PluginOperationResult> {
    const [jira, confluence] = await Promise.allSettled([
      this.atlassian('/rest/api/3/myself'),
      this.atlassian('/wiki/api/v2/spaces?limit=1'),
    ]);
    const detail = [
      jira.status === 'fulfilled' ? 'Jira: verbunden' : `Jira: ${jira.reason instanceof Error ? jira.reason.message : 'Verbindung fehlgeschlagen'}`,
      confluence.status === 'fulfilled' ? 'Confluence: verbunden' : `Confluence: ${confluence.reason instanceof Error ? confluence.reason.message : 'Verbindung fehlgeschlagen'}`,
    ].join(' · ');
    const ok = jira.status === 'fulfilled' && confluence.status === 'fulfilled';
    this.atlassianRuntime = { ...this.atlassianRuntime, health: ok ? 'ready' : 'error', message: detail };
    return { ok, message: detail };
  }

  private async gitContext(handleId: string): Promise<{ filePath: string; cwd: string; relativePath: string }> {
    const location = this.persistence.getHandleLocation(boundedString(handleId, 128, 'Dokument-Handle'));
    if (!location) throw new Error('Das Dokument muss zuerst gespeichert oder geöffnet werden.');
    const filePath = location.canonicalPath;
    const { stdout } = await this.runGit(['rev-parse', '--show-toplevel'], path.dirname(filePath));
    const cwd = stdout.trim();
    if (!cwd || path.relative(cwd, filePath).startsWith('..')) throw new Error('Das Dokument liegt nicht in einem Git-Repository.');
    return { filePath, cwd, relativePath: path.relative(cwd, filePath) };
  }

  private async readGitStatus(handleId: string): Promise<GitPluginSettings> {
    const context = await this.gitContext(handleId);
    const [{ stdout: status }, { stdout: branch }] = await Promise.all([
      this.runGit(['status', '--porcelain=v1'], context.cwd),
      this.runGit(['branch', '--show-current'], context.cwd),
    ]);
    let ahead = 0; let behind = 0;
    try {
      const { stdout } = await this.runGit(['rev-list', '--left-right', '--count', `HEAD...${this.config.git.remote}/${branch.trim()}`], context.cwd);
      const [left, right] = stdout.trim().split(/\s+/).map(Number); ahead = left || 0; behind = right || 0;
    } catch { /* no upstream yet */ }
    const settings: GitPluginSettings = { ...this.config.git, health: 'ready', message: status.trim() ? 'Lokale Änderungen erkannt.' : 'Repository ist synchron.', repositoryName: path.basename(context.cwd), branch: branch.trim() || 'detached', changedFiles: status.trim() ? status.trim().split(/\r?\n/).length : 0, ahead, behind };
    this.gitRuntime = settings;
    return settings;
  }

  public async gitStatus(handleId: string): Promise<GitSyncResult> {
    try { await this.watchDocument(handleId); const settings = await this.readGitStatus(handleId); return { ok: true, message: settings.message, settings }; }
    catch (error) { const message = error instanceof Error ? error.message : 'Git-Status konnte nicht gelesen werden.'; this.gitRuntime = { ...this.gitRuntime, health: 'error', message }; return { ok: false, message, settings: { ...this.gitRuntime } }; }
  }

  private async commitDocument(handleId: string): Promise<void> {
    if (!this.config.git.autoCommit) return;
    const context = await this.gitContext(handleId);
    await this.runGit(['add', '--', context.relativePath], context.cwd);
    const { stdout } = await this.runGit(['status', '--porcelain=v1', '--', context.relativePath], context.cwd);
    if (!stdout.trim()) return;
    await this.runGit(['commit', '-m', `Update ${path.basename(context.filePath)} via Sketchdraw`], context.cwd);
  }

  public async afterDocumentSaved(handleId: string): Promise<void> {
    await this.ready;
    if (!this.config.git.enabled) return;
    try {
      await this.watchDocument(handleId);
      await this.commitDocument(handleId);
      if (this.config.git.autoPush) { const context = await this.gitContext(handleId); await this.runGit(['push', this.config.git.remote], context.cwd); }
      await this.readGitStatus(handleId);
    } catch (error) { this.gitRuntime = { ...this.gitRuntime, health: 'error', message: error instanceof Error ? error.message : 'Git-Autosync fehlgeschlagen.' }; }
  }

  public async gitSync(handleId: string): Promise<GitSyncResult> {
    try {
      const context = await this.gitContext(handleId);
      await this.commitDocument(handleId);
      const { stdout: dirty } = await this.runGit(['status', '--porcelain=v1'], context.cwd);
      if (dirty.trim()) throw new Error('Git-Sync pausiert: Das Repository enthält weitere ungespeicherte Änderungen.');
      if (this.config.git.autoPull) await this.runGit(['pull', '--ff-only', this.config.git.remote], context.cwd);
      if (this.config.git.autoPush) await this.runGit(['push', this.config.git.remote], context.cwd);
      await this.emitReload(handleId);
      const settings = await this.readGitStatus(handleId);
      return { ok: true, message: 'Git-Synchronisation abgeschlossen.', settings };
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Git-Synchronisation fehlgeschlagen.';
      this.gitRuntime = { ...this.gitRuntime, health: 'error', message };
      return { ok: false, message, settings: { ...this.gitRuntime } };
    }
  }

  private async emitReload(handleId: string): Promise<void> {
    const before = this.persistence.getHandleLocation(handleId)?.versionToken;
    const result = await this.persistence.reloadDocument(handleId);
    if (result.status === 'opened' && result.file.versionToken !== before) this.emitEvent({ type: 'document-changed', text: result.text, file: result.file });
  }

  public async watchDocument(handleId: string): Promise<PluginOperationResult> {
    await this.ready;
    if (!this.config.git.enabled) return { ok: false, message: 'Git-Plugin ist deaktiviert.' };
    if (this.watchers.has(handleId)) return { ok: true, message: 'Dokument wird überwacht.' };
    this.clearWatchers();
    const context = await this.gitContext(handleId);
    const watcher = watch(context.filePath, { persistent: false }, () => {
      const previous = this.watcherTimers.get(handleId); if (previous) clearTimeout(previous);
      this.watcherTimers.set(handleId, setTimeout(() => { void this.emitReload(handleId); }, 250));
    });
    watcher.on('error', () => { this.watchers.delete(handleId); });
    this.watchers.set(handleId, watcher);
    if (this.config.git.autoPull) this.pullTimers.set(handleId, setInterval(() => { void this.gitSync(handleId); }, 60_000));
    return { ok: true, message: 'Dokument wird überwacht.' };
  }

  private async confluenceSpaceId(): Promise<string | undefined> {
    const key = this.config.atlassian.confluenceSpaceKey;
    if (!key) return undefined;
    const response = await this.atlassian(`/wiki/api/v2/spaces?keys=${encodeURIComponent(key)}&limit=1`) as { results?: Array<{ id?: string }> };
    return response.results?.[0]?.id;
  }

  public async listConfluencePages(query: string): Promise<ConfluencePageSummary[]> {
    const spaceId = await this.confluenceSpaceId();
    const params = new URLSearchParams({ limit: '100', sort: '-modified-date' }); if (spaceId) params.set('space-id', spaceId);
    const response = await this.atlassian(`/wiki/api/v2/pages?${params}`) as { results?: Array<Record<string, unknown>> };
    const needle = query.trim().toLocaleLowerCase('de'); const base = this.config.atlassian.siteUrl;
    return (response.results ?? []).map((page) => ({ id: String(page.id ?? ''), title: String(page.title ?? ''), version: Number((page.version as Record<string, unknown> | undefined)?.number ?? 1), url: `${base}/wiki/spaces/${encodeURIComponent(this.config.atlassian.confluenceSpaceKey)}/pages/${encodeURIComponent(String(page.id ?? ''))}` })).filter((page) => page.id && (!needle || page.title.toLocaleLowerCase('de').includes(needle))).slice(0, 100);
  }

  public async getConfluencePage(pageId: string): Promise<ConfluencePage> {
    const id = boundedString(pageId, 128, 'Confluence-Seiten-ID');
    const page = await this.atlassian(`/wiki/api/v2/pages/${encodeURIComponent(id)}?body-format=storage`) as Record<string, unknown>;
    const body = page.body as Record<string, unknown> | undefined; const storage = body?.storage as Record<string, unknown> | undefined;
    return { id, title: String(page.title ?? ''), version: Number((page.version as Record<string, unknown> | undefined)?.number ?? 1), storageBody: String(storage?.value ?? ''), url: `${this.config.atlassian.siteUrl}/wiki/pages/viewpage.action?pageId=${encodeURIComponent(id)}` };
  }

  public async updateConfluencePage(input: { pageId: string; title: string; storageBody: string; version: number }): Promise<ConfluencePage> {
    const pageId = boundedString(input.pageId, 128, 'Confluence-Seiten-ID'); const title = boundedString(input.title, 500, 'Seitentitel');
    if (!Number.isSafeInteger(input.version) || input.version < 1 || Buffer.byteLength(input.storageBody, 'utf8') > MAX_REMOTE_BODY_BYTES) throw new Error('Ungültiger Seiteninhalt.');
    await this.atlassian(`/wiki/api/v2/pages/${encodeURIComponent(pageId)}`, { method: 'PUT', body: JSON.stringify({ id: pageId, status: 'current', title, body: { representation: 'storage', value: input.storageBody }, version: { number: input.version + 1, message: 'Updated from Sketchdraw' } }) });
    return this.getConfluencePage(pageId);
  }

  private jiraIssue(value: Record<string, unknown>): JiraIssueSummary {
    const fields = (value.fields ?? {}) as Record<string, unknown>; const status = (fields.status ?? {}) as Record<string, unknown>; const remoteStatus = String(status.name ?? 'To Do'); const key = String(value.key ?? '');
    return { id: String(value.id ?? key), key, title: String(fields.summary ?? key), description: adfText(fields.description), status: jiraStatus(remoteStatus), remoteStatus, url: `${this.config.atlassian.siteUrl}/browse/${encodeURIComponent(key)}`, updatedAt: isoTimestamp(fields.updated) };
  }

  public async createJiraIssue(input: { title: string; description: string }): Promise<JiraIssueSummary> {
    const title = boundedString(input.title, 255, 'Jira-Titel'); const description = boundedString(input.description, 50_000, 'Jira-Beschreibung', true);
    const created = await this.atlassian('/rest/api/3/issue', { method: 'POST', body: JSON.stringify({ fields: { project: { key: boundedString(this.config.atlassian.jiraProjectKey, 128, 'Jira-Projekt') }, issuetype: { name: this.config.atlassian.jiraIssueType }, summary: title, description: descriptionAdf(description) } }) }) as Record<string, unknown>;
    return this.getJiraIssue(String(created.key ?? created.id ?? ''));
  }

  private async getJiraIssue(key: string): Promise<JiraIssueSummary> {
    const issue = await this.atlassian(`/rest/api/3/issue/${encodeURIComponent(boundedString(key, 128, 'Jira-Key'))}?fields=summary,description,status,updated`) as Record<string, unknown>;
    return this.jiraIssue(issue);
  }

  public async listJiraIssues(): Promise<JiraIssueSummary[]> {
    const project = boundedString(this.config.atlassian.jiraProjectKey, 128, 'Jira-Projekt');
    const response = await this.atlassian('/rest/api/3/search/jql', { method: 'POST', body: JSON.stringify({ jql: `project = \"${project.replaceAll('"', '')}\" ORDER BY updated DESC`, maxResults: 100, fields: ['summary', 'description', 'status', 'updated'] }) }) as { issues?: Array<Record<string, unknown>> };
    return (response.issues ?? []).map((issue) => this.jiraIssue(issue));
  }

  public async transitionJiraIssue(input: { key: string; status: TaskStatus }): Promise<JiraIssueSummary> {
    const key = boundedString(input.key, 128, 'Jira-Key'); const desired: Record<TaskStatus, string[]> = { todo: ['to do', 'open', 'offen'], doing: ['in progress', 'doing', 'in arbeit'], review: ['review', 'in review', 'prüfung'], done: ['done', 'closed', 'resolved', 'erledigt'] };
    const response = await this.atlassian(`/rest/api/3/issue/${encodeURIComponent(key)}/transitions`) as { transitions?: Array<{ id?: string; name?: string; to?: { name?: string } }> };
    const transition = (response.transitions ?? []).find((item) => desired[input.status].some((name) => `${item.name ?? ''} ${item.to?.name ?? ''}`.toLocaleLowerCase('en').includes(name)));
    if (!transition?.id) throw new Error('Für diesen Jira-Workflow wurde kein passender Statusübergang gefunden.');
    await this.atlassian(`/rest/api/3/issue/${encodeURIComponent(key)}/transitions`, { method: 'POST', body: JSON.stringify({ transition: { id: transition.id } }) });
    return this.getJiraIssue(key);
  }

  public dispose(): void {
    this.clearWatchers();
  }

  private clearWatchers(): void {
    for (const watcher of this.watchers.values()) watcher.close();
    for (const timer of this.watcherTimers.values()) clearTimeout(timer);
    for (const timer of this.pullTimers.values()) clearInterval(timer);
    this.watchers.clear(); this.watcherTimers.clear(); this.pullTimers.clear();
  }
}

import { execFile as execFileCallback } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { promises as fs, watch, type FSWatcher } from 'node:fs';
import path from 'node:path';
import { promisify } from 'node:util';
import type {
  AtlassianPluginSettings,
  ConfigureAtlassianPluginInput,
  ConfigureGitPluginInput,
  ConfluencePage,
  ConfluencePageSummary,
  CreateJiraIssueInput,
  GitPluginSettings,
  GitSyncResult,
  JiraIssueSummary,
  PluginExternalEvent,
  PluginConfigurationIssue,
  PluginId,
  PluginOperationResult,
  PluginProfileSummary,
  PluginSettingsSnapshot,
  TaskStatus,
  UpdateJiraIssueInput,
} from '../src/domain/index';
import { PLUGIN_PROFILE_LIMIT, PLUGIN_PROFILE_NAME_MAX as PROFILE_NAME_MAX } from '../src/domain/plugins';
import type { DocumentPersistenceService } from './persistence';

const execFile = promisify(execFileCallback);
const CONFIG_VERSION = 2;
/** Profiles of the editor (#168). Version 2 was one configuration file per diagram folder. */
const STORE_VERSION = 3;
const LEGACY_PROJECT_CONFIG_NAME = '.sketchdraw-plugins.json';
const DEFAULT_PROFILE_ID = 'default';
const DEFAULT_PROFILE_NAME = 'Standard';
const MAX_REMOTE_BODY_BYTES = 2_000_000;

interface PersistedGitConfig {
  installed: boolean;
  enabled: boolean;
  autoCommit: boolean;
  autoPush: boolean;
  autoPull: boolean;
  remote: string;
  remoteUrl: string;
  authMode: 'system' | 'token';
  username: string;
  encryptedAccessToken?: string;
  credentialRemoteUrl?: string;
}

interface PersistedAtlassianConfig {
  installed: boolean;
  enabled: boolean;
  siteUrl: string;
  email: string;
  encryptedApiToken?: string;
  confluenceSpaceKey: string;
  jiraProjectKey: string;
  jiraIssueType: string;
  jqlFilter: string;
}

interface PersistedPluginConfig {
  version: 2;
  git: PersistedGitConfig;
  atlassian: PersistedAtlassianConfig;
}

interface PersistedProfile {
  id: string;
  name: string;
  git: PersistedGitConfig;
  atlassian: PersistedAtlassianConfig;
}

interface PersistedProfileStore {
  version: 3;
  activeProfileId: string;
  profiles: PersistedProfile[];
}

interface CredentialAdapter {
  encrypt(value: string): string;
  decrypt(value: string): string;
  available(): boolean;
}

type GitEnvironment = Readonly<Record<string, string | undefined>>;

export interface PluginServiceOptions {
  /** File in the app data that holds the editor's plugin profiles. Without it profiles live in memory only. */
  configPath?: string;
  persistence: DocumentPersistenceService;
  credentials: CredentialAdapter;
  emitEvent: (event: PluginExternalEvent) => void;
  fetchFn?: typeof fetch;
  runGit?: (args: string[], cwd: string, environment?: GitEnvironment) => Promise<{ stdout: string; stderr: string }>;
}

const DEFAULT_CONFIG: PersistedPluginConfig = {
  version: CONFIG_VERSION,
  git: { installed: true, enabled: false, autoCommit: true, autoPush: false, autoPull: true, remote: 'origin', remoteUrl: '', authMode: 'system', username: '' },
  atlassian: { installed: true, enabled: false, siteUrl: '', email: '', confluenceSpaceKey: '', jiraProjectKey: '', jiraIssueType: 'Task', jqlFilter: '' },
};

function defaultProfile(): PersistedProfile {
  return { id: DEFAULT_PROFILE_ID, name: DEFAULT_PROFILE_NAME, git: { ...DEFAULT_CONFIG.git }, atlassian: { ...DEFAULT_CONFIG.atlassian } };
}

function sameFields(left: object, right: object): boolean {
  const a = left as Record<string, unknown>; const b = right as Record<string, unknown>;
  const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
  for (const key of keys) if (a[key] !== b[key]) return false;
  return true;
}

/** A profile nobody configured yet; only such a profile adopts an old per-folder configuration. */
function isPristine(config: PersistedPluginConfig): boolean {
  return sameFields(config.git, DEFAULT_CONFIG.git) && sameFields(config.atlassian, DEFAULT_CONFIG.atlassian);
}

function parsePluginConfig(value: unknown): Pick<PersistedProfile, 'git' | 'atlassian'> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('PROFILE_STORE_INVALID');
  const record = value as Record<string, unknown>;
  for (const plugin of ['git', 'atlassian'] as const) {
    const fields = record[plugin];
    if (!fields || typeof fields !== 'object' || Array.isArray(fields)) throw new Error('PROFILE_STORE_INVALID');
    const config = fields as Record<string, unknown>;
    for (const [key, fallback] of Object.entries(DEFAULT_CONFIG[plugin])) {
      if (key in config && typeof config[key] !== typeof fallback) throw new Error('PROFILE_STORE_INVALID');
    }
    for (const key of ['encryptedAccessToken', 'credentialRemoteUrl', 'encryptedApiToken']) {
      if (key in config && typeof config[key] !== 'string') throw new Error('PROFILE_STORE_INVALID');
    }
    if (plugin === 'git' && 'authMode' in config && config.authMode !== 'system' && config.authMode !== 'token') throw new Error('PROFILE_STORE_INVALID');
  }
  const git = { ...DEFAULT_CONFIG.git, ...(record.git as PersistedGitConfig) };
  const atlassian = { ...DEFAULT_CONFIG.atlassian, ...(record.atlassian as PersistedAtlassianConfig) };
  // Loading a profile or adopting a folder file must enforce the same boundaries as explicit configuration.
  git.remote = normalizeGitRemote(git.remote);
  git.remoteUrl = normalizeGitRemoteUrl(git.remoteUrl);
  git.username = boundedString(git.username, 320, 'Git-Benutzername', git.authMode !== 'token' || !git.enabled);
  // Older versions captured this comparison key directly from Git, including username-bearing URLs.
  if (git.credentialRemoteUrl !== undefined) git.credentialRemoteUrl = boundedString(git.credentialRemoteUrl, 2048, 'Git-Remote-URL', true);
  if (git.enabled && git.authMode === 'token' && !git.encryptedAccessToken) throw new Error('PROFILE_STORE_INVALID');
  atlassian.siteUrl = atlassian.siteUrl.trim() ? normalizeSiteUrl(atlassian.siteUrl) : '';
  atlassian.email = boundedString(atlassian.email, 320, 'E-Mail', !atlassian.enabled);
  atlassian.confluenceSpaceKey = boundedString(atlassian.confluenceSpaceKey, 128, 'Confluence-Space', true);
  atlassian.jiraProjectKey = boundedString(atlassian.jiraProjectKey, 128, 'Jira-Projekt', !atlassian.enabled).toUpperCase();
  atlassian.jiraIssueType = boundedString(atlassian.jiraIssueType, 128, 'Jira-Vorgangstyp');
  atlassian.jqlFilter = boundedString(atlassian.jqlFilter, 2000, 'Jira-Filter', true);
  if (atlassian.enabled && (!atlassian.siteUrl || !atlassian.encryptedApiToken)) throw new Error('PROFILE_STORE_INVALID');
  return { git, atlassian };
}

function parseProfileStore(value: unknown): PersistedProfileStore {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('PROFILE_STORE_INVALID');
  const record = value as Record<string, unknown>;
  if (record.version !== STORE_VERSION || !Array.isArray(record.profiles) || record.profiles.length < 1 || record.profiles.length > PLUGIN_PROFILE_LIMIT) throw new Error('PROFILE_STORE_INVALID');
  const ids = new Set<string>();
  const profiles = record.profiles.map((entry): PersistedProfile => {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) throw new Error('PROFILE_STORE_INVALID');
    const profile = entry as Record<string, unknown>;
    const id = profile.id; const name = profile.name;
    if (typeof id !== 'string' || !/^[a-z0-9-]{1,64}$/.test(id) || ids.has(id)) throw new Error('PROFILE_STORE_INVALID');
    if (typeof name !== 'string' || !name.trim() || name.length > PROFILE_NAME_MAX || /[\u0000-\u001f\u007f]/.test(name)) throw new Error('PROFILE_STORE_INVALID');
    ids.add(id);
    return { id, name: name.trim(), ...parsePluginConfig(profile) };
  });
  if (typeof record.activeProfileId !== 'string' || !ids.has(record.activeProfileId)) throw new Error('PROFILE_STORE_INVALID');
  return { version: STORE_VERSION, activeProfileId: record.activeProfileId, profiles };
}

function boundedString(value: unknown, max: number, name: string, allowEmpty = false): string {
  if (typeof value !== 'string') throw new Error(`${name} muss Text sein.`);
  const normalized = value.trim();
  if ((!allowEmpty && normalized.length === 0) || normalized.length > max || /[\u0000-\u001f\u007f]/.test(normalized)) throw new Error(`${name} ist ungültig.`);
  return normalized;
}

function normalizeSiteUrl(value: string): string {
  const parsed = new URL(boundedString(value, 2048, 'Atlassian-URL'));
  if (parsed.username || parsed.password || (parsed.protocol !== 'https:' && !(parsed.protocol === 'http:' && ['localhost', '127.0.0.1'].includes(parsed.hostname)))) throw new Error('Atlassian benötigt eine HTTPS-URL ohne eingebettete Zugangsdaten.');
  parsed.pathname = parsed.pathname.replace(/\/$/, ''); parsed.search = ''; parsed.hash = '';
  return parsed.toString().replace(/\/$/, '');
}

function normalizeGitRemoteUrl(value: unknown): string {
  const remoteUrl = boundedString(value, 2048, 'Git-Remote-URL', true);
  if (!remoteUrl) return '';
  if (remoteUrl.startsWith('-')) throw new Error('Git-Remote-URL ist ungültig.');
  if (/^https?:\/\//i.test(remoteUrl)) {
    const parsed = new URL(remoteUrl);
    if (parsed.username || parsed.password) throw new Error('Die Git-Remote-URL darf keine eingebetteten Zugangsdaten enthalten.');
    if (parsed.protocol !== 'https:' && !(parsed.protocol === 'http:' && ['localhost', '127.0.0.1'].includes(parsed.hostname))) throw new Error('Git-Remotes per HTTP sind nur lokal erlaubt.');
  }
  return remoteUrl;
}

function normalizeGitRemote(value: unknown): string {
  const remote = boundedString(value, 128, 'Git-Remote');
  if (!/^[a-zA-Z0-9][a-zA-Z0-9._/-]*$/.test(remote)) throw new Error('Git-Remote ist ungültig.');
  return remote;
}

function configRevision(text: string): string { return createHash('sha256').update(text).digest('hex'); }

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

function jiraDueDate(value: unknown, allowEmpty = false): string {
  if (allowEmpty && (value === null || value === '')) return '';
  const dueDate = boundedString(value, 10, 'Jira-Fälligkeitsdatum');
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dueDate);
  if (!match) throw new Error('Jira-Fälligkeitsdatum ist ungültig.');
  const date = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])));
  if (date.toISOString().slice(0, 10) !== dueDate) throw new Error('Jira-Fälligkeitsdatum ist ungültig.');
  return dueDate;
}

export class PluginService {
  private readonly persistence: DocumentPersistenceService;
  private readonly credentials: CredentialAdapter;
  private readonly emitEvent: (event: PluginExternalEvent) => void;
  private readonly fetchFn: typeof fetch;
  private readonly runGit: NonNullable<PluginServiceOptions['runGit']>;
  /** The configuration of the active profile. */
  private config: PersistedPluginConfig = structuredClone(DEFAULT_CONFIG);
  private readonly storePath: string;
  private profiles: PersistedProfile[] = [defaultProfile()];
  private activeProfileId = DEFAULT_PROFILE_ID;
  private loaded: Promise<void> | null = null;
  private storeIssue: PluginConfigurationIssue | undefined;
  private legacyIssue: PluginConfigurationIssue | undefined;
  private storeRevision: string | null = null;
  private storeQueue: Promise<void> = Promise.resolve();
  private projectFolder = '';
  /** Changes with the project folder and with the active profile; pending work of the old context stops. */
  private projectGeneration = 0;
  private activation: Promise<void> = Promise.resolve();
  private readonly watchers = new Map<string, FSWatcher>();
  private readonly watcherTimers = new Map<string, NodeJS.Timeout>();
  private readonly pullTimers = new Map<string, NodeJS.Timeout>();
  private gitRuntime: GitPluginSettings = this.defaultGitRuntime();
  private atlassianRuntime: AtlassianPluginSettings = this.defaultAtlassianRuntime();

  constructor(options: PluginServiceOptions) {
    this.persistence = options.persistence; this.credentials = options.credentials; this.emitEvent = options.emitEvent; this.fetchFn = options.fetchFn ?? fetch;
    this.storePath = options.configPath ?? '';
    this.runGit = options.runGit ?? (async (args, cwd, environment) => {
      const result = await execFile('git', args, { cwd, timeout: 30_000, maxBuffer: 2_000_000, windowsHide: true, env: { ...process.env, ...(environment ?? {}) } });
      return { stdout: result.stdout, stderr: result.stderr };
    });
  }

  private defaultGitRuntime(): GitPluginSettings {
    return { installed: true, enabled: false, folderPath: this.projectFolder, autoCommit: true, autoPush: false, autoPull: true, remote: 'origin', remoteUrl: '', authMode: 'system', username: '', credentialStored: false, health: 'disabled', message: 'Git-Plugin ist deaktiviert.' };
  }

  private defaultAtlassianRuntime(): AtlassianPluginSettings {
    return { installed: true, enabled: false, siteUrl: '', email: '', confluenceSpaceKey: '', jiraProjectKey: '', jiraIssueType: 'Task', jqlFilter: '', credentialStored: false, health: 'disabled', message: 'Jira-Plugin ist deaktiviert.' };
  }

  private assertGeneration(generation: number): void {
    if (generation !== this.projectGeneration) throw new Error('Der Projektordner hat sich geändert. Bitte die Aktion erneut starten.');
  }

  private ensureLoaded(): Promise<void> { return this.loaded ??= this.loadStore(); }

  private configurationIssue(source: PluginConfigurationIssue['source'], kind: PluginConfigurationIssue['kind'], file: string): PluginConfigurationIssue {
    const reason = { 'read-error': 'konnte nicht gelesen werden', 'invalid-json': 'enthält ungültiges JSON', 'unsupported-version': 'hat eine nicht unterstützte Version', 'invalid-data': 'enthält ungültige Konfigurationsdaten', 'external-change': 'wurde außerhalb dieser App-Instanz geändert' }[kind];
    const recovery = kind === 'external-change'
      ? 'Änderungen sind gesperrt, damit die neuere Konfiguration erhalten bleibt. Schließe diese App-Instanz und starte sie neu, um den aktuellen Stand zu laden.'
      : source === 'profiles' && kind === 'unsupported-version'
        ? 'Änderungen an Profilen und Plugins sind gesperrt. Sichere die Datei und verwende eine App-Version, die dieses Konfigurationsformat unterstützt. Starte die App danach neu.'
      : source === 'profiles'
      ? 'Änderungen an Profilen und Plugins sind gesperrt. Beende die App, sichere diese Datei und repariere sie oder verschiebe sie zur Seite. Starte die App danach neu.'
      : 'Die alte Ordner-Konfiguration wurde nicht übernommen. Sichere und repariere die Datei und öffne das Dokument danach erneut. Die Editor-Profile können weiter verwendet werden.';
    return { source, kind, blocksChanges: source === 'profiles', message: `Die Plugin-Konfiguration „${file}“ ${reason}. Die Datei bleibt unverändert. ${recovery}` };
  }

  private assertStoreWritable(): void { if (this.storeIssue) throw new Error(this.storeIssue.message); }

  /** An older app instance must not overwrite newer profiles or a file changed by another editor (#181). */
  private async assertStoreCurrent(): Promise<void> {
    if (!this.storePath) return;
    let revision: string | null = null;
    try { revision = configRevision(await fs.readFile(this.storePath, 'utf8')); }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') this.storeIssue = this.configurationIssue('profiles', 'read-error', this.storePath);
    }
    if (!this.storeIssue && revision !== this.storeRevision) this.storeIssue = this.configurationIssue('profiles', 'external-change', this.storePath);
    this.assertStoreWritable();
  }

  private async readConfigFile(file: string, source: PluginConfigurationIssue['source'], version: number): Promise<{ value?: unknown; revision?: string; issue?: PluginConfigurationIssue }> {
    let text: string;
    try { text = await fs.readFile(file, 'utf8'); }
    catch (error) { return (error as NodeJS.ErrnoException).code === 'ENOENT' ? {} : { issue: this.configurationIssue(source, 'read-error', file) }; }
    let value: unknown;
    try { value = JSON.parse(text); }
    catch { return { issue: this.configurationIssue(source, 'invalid-json', file) }; }
    if (!value || typeof value !== 'object' || Array.isArray(value) || !('version' in value)) return { issue: this.configurationIssue(source, 'invalid-data', file) };
    if (value.version !== version) return { issue: this.configurationIssue(source, 'unsupported-version', file) };
    return { value, revision: configRevision(text) };
  }

  private async loadStore(): Promise<void> {
    if (!this.storePath) return;
    const result = await this.readConfigFile(this.storePath, 'profiles', STORE_VERSION);
    this.storeIssue = result.issue;
    this.storeRevision = result.revision ?? null;
    if (result.value === undefined) return;
    try {
      const store = parseProfileStore(result.value);
      this.profiles = store.profiles; this.activeProfileId = store.activeProfileId;
      this.config = this.configOf(this.activeProfile()); this.refreshRuntime();
    } catch {
      this.storeIssue = this.configurationIssue('profiles', 'invalid-data', this.storePath);
    }
  }

  private activeProfile(): PersistedProfile { return this.profiles.find((profile) => profile.id === this.activeProfileId) ?? this.profiles[0]!; }

  private configOf(profile: PersistedProfile): PersistedPluginConfig { return { version: CONFIG_VERSION, git: { ...profile.git }, atlassian: { ...profile.atlassian } }; }

  private profileSummaries(): PluginProfileSummary[] { return this.profiles.map(({ id, name }) => ({ id, name })); }

  /** All changes of the profile file run one after another and start from the latest state in memory. */
  private mutateStore(mutate: (profiles: PersistedProfile[], activeProfileId: string) => { profiles: PersistedProfile[]; activeProfileId: string }): Promise<void> {
    const run = this.storeQueue.then(async () => {
      this.assertStoreWritable();
      await this.assertStoreCurrent();
      const next = mutate(this.profiles, this.activeProfileId);
      if (this.storePath) {
        const contents = `${JSON.stringify({ version: STORE_VERSION, activeProfileId: next.activeProfileId, profiles: next.profiles } satisfies PersistedProfileStore, null, 2)}\n`;
        const temp = `${this.storePath}.${process.pid}.${randomUUID()}.tmp`;
        try {
          await fs.mkdir(path.dirname(this.storePath), { recursive: true });
          await fs.writeFile(temp, contents, { encoding: 'utf8', mode: 0o600 });
          await this.assertStoreCurrent();
          await fs.rename(temp, this.storePath);
          this.storeRevision = configRevision(contents);
        } finally { await fs.rm(temp, { force: true }); }
      }
      this.profiles = next.profiles; this.activeProfileId = next.activeProfileId;
    });
    this.storeQueue = run.catch(() => undefined);
    return run;
  }

  /** Stores the configuration in its profile; it becomes the running configuration only while that profile is active. */
  private async saveConfig(next: PersistedPluginConfig, profileId: string): Promise<void> {
    await this.mutateStore((profiles, activeProfileId) => ({ activeProfileId, profiles: profiles.map((profile) => profile.id === profileId ? { ...profile, git: { ...next.git }, atlassian: { ...next.atlassian } } : profile) }));
    if (profileId === this.activeProfileId) this.config = next;
  }

  private profileName(value: unknown, exceptId?: string): string {
    const name = boundedString(value, PROFILE_NAME_MAX, 'Profilname');
    const key = name.toLocaleLowerCase();
    if (this.profiles.some((profile) => profile.id !== exceptId && profile.name.toLocaleLowerCase() === key)) throw new Error('Ein Profil mit diesem Namen existiert bereits.');
    return name;
  }

  private knownProfile(value: unknown): PersistedProfile {
    const profile = typeof value === 'string' ? this.profiles.find((entry) => entry.id === value) : undefined;
    if (!profile) throw new Error('Unbekanntes Profil.');
    return profile;
  }

  /** The running configuration follows the active profile; work that started under another profile stops. */
  private async adoptActiveProfile(): Promise<void> {
    this.projectGeneration++; this.clearWatchers();
    this.legacyIssue = undefined;
    this.config = this.configOf(this.activeProfile()); this.refreshRuntime();
    await this.refreshFolderStatus();
  }

  private async refreshFolderStatus(): Promise<void> {
    if (!this.projectFolder || !this.config.git.installed || !this.config.git.enabled) return;
    const generation = this.projectGeneration;
    try { await this.runGit(['rev-parse', '--show-toplevel'], this.projectFolder); }
    catch { if (generation === this.projectGeneration) this.gitRuntime = { ...this.gitRuntime, health: 'attention', message: 'Der Projektordner ist noch kein Git-Repository.' }; return; }
    if (generation !== this.projectGeneration) return;
    try { await this.readGitStatusForFolder(); }
    catch { if (generation === this.projectGeneration) this.gitRuntime = { ...this.gitRuntime, health: 'error', message: 'Git-Status konnte nicht gelesen werden.' }; }
  }

  public async selectProfile(id: string): Promise<PluginSettingsSnapshot> {
    await this.ensureLoaded();
    const profile = this.knownProfile(id);
    if (profile.id !== this.activeProfileId) {
      await this.mutateStore((profiles) => ({ profiles, activeProfileId: profiles.some((entry) => entry.id === profile.id) ? profile.id : this.activeProfileId }));
      await this.adoptActiveProfile();
    }
    return this.getSettings();
  }

  /** A new profile starts empty or as a copy (including its encrypted tokens) and becomes the active one. */
  public async createProfile(input: { name: string; copyFrom?: string }): Promise<PluginSettingsSnapshot> {
    await this.ensureLoaded();
    if (!input || typeof input !== 'object') throw new Error('Ungültiges Profil.');
    if (this.profiles.length >= PLUGIN_PROFILE_LIMIT) throw new Error('Es sind höchstens zwölf Profile möglich.');
    const name = this.profileName(input.name);
    const source = input.copyFrom === undefined ? null : this.knownProfile(input.copyFrom);
    const created: PersistedProfile = source
      ? { id: randomUUID(), name, git: { ...source.git }, atlassian: { ...source.atlassian } }
      : { ...defaultProfile(), id: randomUUID(), name };
    await this.mutateStore((profiles) => {
      if (profiles.length >= PLUGIN_PROFILE_LIMIT) throw new Error('Es sind höchstens zwölf Profile möglich.');
      return { profiles: [...profiles, created], activeProfileId: created.id };
    });
    await this.adoptActiveProfile();
    return this.getSettings();
  }

  public async renameProfile(input: { id: string; name: string }): Promise<PluginSettingsSnapshot> {
    await this.ensureLoaded();
    if (!input || typeof input !== 'object') throw new Error('Ungültiges Profil.');
    const profile = this.knownProfile(input.id); const name = this.profileName(input.name, profile.id);
    await this.mutateStore((profiles, activeProfileId) => ({ activeProfileId, profiles: profiles.map((entry) => entry.id === profile.id ? { ...entry, name } : entry) }));
    return this.getSettings();
  }

  public async deleteProfile(id: string): Promise<PluginSettingsSnapshot> {
    await this.ensureLoaded();
    const profile = this.knownProfile(id);
    if (this.profiles.length <= 1) throw new Error('Das letzte Profil kann nicht gelöscht werden.');
    const wasActive = profile.id === this.activeProfileId;
    await this.mutateStore((profiles, activeProfileId) => {
      const remaining = profiles.filter((entry) => entry.id !== profile.id);
      if (!remaining.length) throw new Error('Das letzte Profil kann nicht gelöscht werden.');
      return { profiles: remaining, activeProfileId: remaining.some((entry) => entry.id === activeProfileId) ? activeProfileId : remaining[0]!.id };
    });
    if (wasActive) await this.adoptActiveProfile();
    return this.getSettings();
  }

  /** The folder only decides where Git works; the configuration belongs to the active profile. */
  private resetProject(folder = ''): void {
    this.projectGeneration++; this.clearWatchers(); this.projectFolder = folder;
    this.legacyIssue = undefined;
    this.refreshRuntime();
  }

  public async activateDocument(handleId: string): Promise<PluginSettingsSnapshot> {
    await this.ensureLoaded();
    const location = this.persistence.getHandleLocation(boundedString(handleId, 128, 'Dokument-Handle'));
    if (!location) throw new Error('Das Dokument muss zuerst gespeichert oder geöffnet werden.');
    const nextFolder = path.dirname(location.canonicalPath);
    if (nextFolder === this.projectFolder) { await this.activation; return this.getSettings(); }
    this.resetProject(nextFolder);
    this.activation = this.adoptLegacyProjectConfig(nextFolder, this.projectGeneration);
    await this.activation; return this.getSettings();
  }

  /**
   * Before profiles existed the configuration lay next to the diagram. It is taken over once, into a profile nobody
   * configured yet; the old file stays where it is.
   */
  private async adoptLegacyProjectConfig(folder: string, generation: number): Promise<void> {
    if (this.storeIssue || !isPristine(this.config)) return;
    const profileId = this.activeProfileId;
    const file = path.join(folder, LEGACY_PROJECT_CONFIG_NAME);
    const result = await this.readConfigFile(file, 'legacy', CONFIG_VERSION);
    if (generation !== this.projectGeneration || profileId !== this.activeProfileId || !isPristine(this.config)) return;
    this.legacyIssue = result.issue;
    if (result.value === undefined) return;
    let legacy: PersistedPluginConfig;
    try {
      legacy = { version: CONFIG_VERSION, ...parsePluginConfig(result.value) };
    } catch { this.legacyIssue = this.configurationIssue('legacy', 'invalid-data', file); return; }
    if (generation !== this.projectGeneration || profileId !== this.activeProfileId || !isPristine(this.config)) return;
    try { await this.saveConfig(legacy, profileId); } catch { return; }
    if (generation === this.projectGeneration && profileId === this.activeProfileId) this.refreshRuntime();
  }


  private refreshRuntime(): void {
    const gitCredentialStored = Boolean(this.config.git.encryptedAccessToken) && this.credentials.available();
    const gitEnabled = this.config.git.installed && this.config.git.enabled;
    const { installed: gitInstalled, autoCommit, autoPush, autoPull, remote, remoteUrl, authMode, username } = this.config.git;
    this.gitRuntime = { ...this.defaultGitRuntime(), installed: gitInstalled, enabled: gitEnabled, autoCommit, autoPush, autoPull, remote, remoteUrl, authMode, username, credentialStored: gitCredentialStored, health: gitEnabled ? 'attention' : 'disabled', message: !gitInstalled ? 'Git-Plugin ist nicht installiert.' : gitEnabled ? 'Repository-Konfiguration noch nicht geprüft.' : 'Git-Plugin ist deaktiviert.' };
    const atlassianCredentialStored = Boolean(this.config.atlassian.encryptedApiToken) && this.credentials.available();
    const atlassianEnabled = this.config.atlassian.installed && this.config.atlassian.enabled;
    const { installed, siteUrl, email, confluenceSpaceKey, jiraProjectKey, jiraIssueType, jqlFilter } = this.config.atlassian;
    this.atlassianRuntime = { installed, enabled: atlassianEnabled, siteUrl, email, confluenceSpaceKey, jiraProjectKey, jiraIssueType, jqlFilter, credentialStored: atlassianCredentialStored, health: atlassianEnabled ? (atlassianCredentialStored ? 'attention' : 'error') : 'disabled', message: !installed ? 'Jira-Plugin ist nicht installiert.' : atlassianEnabled ? (atlassianCredentialStored ? 'Verbindung noch nicht geprüft.' : 'API-Token fehlt.') : 'Jira-Plugin ist deaktiviert.' };
  }

  public async getSettings(handleId?: string | null): Promise<PluginSettingsSnapshot> {
    await this.ensureLoaded();
    if (handleId === null) { this.resetProject(); this.activation = Promise.resolve(); }
    else if (handleId !== undefined) return this.activateDocument(handleId);
    const issue = this.storeIssue ?? this.legacyIssue;
    return { available: true, projectFolder: this.projectFolder, profiles: this.profileSummaries(), activeProfileId: this.activeProfileId, ...(issue ? { configurationIssue: { ...issue } } : {}), git: { ...this.gitRuntime }, atlassian: { ...this.atlassianRuntime } };
  }

  public async installPlugin(id: PluginId): Promise<PluginSettingsSnapshot> {
    await this.ensureLoaded();
    const profileId = this.activeProfileId;
    const next = structuredClone(this.config);
    if (id === 'git') next.git.installed = true; else if (id === 'jira') next.atlassian.installed = true; else throw new Error('Unbekanntes Plugin.');
    await this.saveConfig(next, profileId); if (profileId === this.activeProfileId) this.refreshRuntime(); return this.getSettings();
  }

  public async uninstallPlugin(id: PluginId): Promise<PluginSettingsSnapshot> {
    await this.ensureLoaded();
    const profileId = this.activeProfileId;
    const next = structuredClone(this.config);
    if (id === 'git') next.git = { ...DEFAULT_CONFIG.git, installed: false }; else if (id === 'jira') next.atlassian = { ...DEFAULT_CONFIG.atlassian, installed: false }; else throw new Error('Unbekanntes Plugin.');
    await this.saveConfig(next, profileId); if (profileId === this.activeProfileId) { if (id === 'git') this.clearWatchers(); this.refreshRuntime(); } return this.getSettings();
  }

  public async configureGit(input: ConfigureGitPluginInput): Promise<PluginSettingsSnapshot> {
    await this.ensureLoaded(); if (!input || typeof input !== 'object') throw new Error('Ungültige Git-Konfiguration.');
    const generation = this.projectGeneration; const folder = this.projectFolder; const profileId = this.activeProfileId;
    this.assertStoreWritable();
    // Serialize the preflight too: a read overlapping our own rename must not look like an external change.
    const preflight = this.storeQueue.then(() => this.assertStoreCurrent());
    this.storeQueue = preflight.catch(() => undefined);
    await preflight;
    this.assertGeneration(generation);
    if (!this.config.git.installed) throw new Error('Git-Plugin ist nicht installiert.');
    const remote = normalizeGitRemote(input.remote || 'origin');
    const remoteUrl = normalizeGitRemoteUrl(input.remoteUrl ?? '');
    const authMode = input.authMode === 'token' ? 'token' : 'system'; const previousToken = this.config.git.encryptedAccessToken;
    const changedRemote = remote !== this.config.git.remote || remoteUrl !== this.config.git.remoteUrl;
    let encryptedAccessToken = input.clearCredential || changedRemote ? undefined : previousToken;
    let credentialRemoteUrl = input.clearCredential || changedRemote ? undefined : this.config.git.credentialRemoteUrl;
    const newToken = typeof input.accessToken === 'string' && input.accessToken.trim() !== '';
    if (newToken) { if (!this.credentials.available()) throw new Error('Sichere Zugangsdatenablage ist auf diesem System nicht verfügbar.'); encryptedAccessToken = this.credentials.encrypt(boundedString(input.accessToken, 4096, 'Git-Token')); }
    const username = boundedString(input.username ?? '', 320, 'Git-Benutzername', authMode !== 'token' || !input.enabled);
    if (input.enabled && authMode === 'token' && !encryptedAccessToken) throw new Error('Für die Token-Anmeldung wird ein Git-Token benötigt.');
    const next: PersistedGitConfig = { installed: true, enabled: Boolean(input.enabled), autoCommit: Boolean(input.autoCommit), autoPush: Boolean(input.autoPush), autoPull: Boolean(input.autoPull), remote, remoteUrl, authMode, username, ...(encryptedAccessToken ? { encryptedAccessToken } : {}) };
    if (encryptedAccessToken && newToken) credentialRemoteUrl = remoteUrl || undefined;
    // The profile is stored for the editor. Only an enabled plugin with an open project folder touches a repository.
    if (folder && next.enabled) {
      try { await this.runGit(['rev-parse', '--show-toplevel'], folder); } catch { this.assertGeneration(generation); await this.runGit(['init'], folder); }
      this.assertGeneration(generation);
      const { stdout: rootOutput } = await this.runGit(['rev-parse', '--show-toplevel'], folder); const repositoryRoot = rootOutput.trim(); this.assertGeneration(generation);
      if (next.remoteUrl) { try { await this.runGit(['remote', 'get-url', next.remote], repositoryRoot); this.assertGeneration(generation); await this.runGit(['remote', 'set-url', next.remote, next.remoteUrl], repositoryRoot); } catch { this.assertGeneration(generation); await this.runGit(['remote', 'add', next.remote, next.remoteUrl], repositoryRoot); } }
      if (encryptedAccessToken && newToken && !credentialRemoteUrl) { try { credentialRemoteUrl = normalizeGitRemoteUrl((await this.runGit(['remote', 'get-url', remote], repositoryRoot)).stdout.trim()) || undefined; } catch { /* No usable remote yet: network use requires entering a token after selecting a safe URL. */ } }
      this.assertGeneration(generation);
    }
    if (credentialRemoteUrl) next.credentialRemoteUrl = credentialRemoteUrl;
    const nextConfig: PersistedPluginConfig = { ...this.config, git: next };
    await this.saveConfig(nextConfig, profileId);
    if (profileId === this.activeProfileId && generation === this.projectGeneration) { this.clearWatchers(); this.refreshRuntime(); await this.refreshFolderStatus(); }
    return this.getSettings();
  }

  public async configureAtlassian(input: ConfigureAtlassianPluginInput): Promise<PluginSettingsSnapshot> {
    await this.ensureLoaded(); if (!input || typeof input !== 'object') throw new Error('Ungültige Atlassian-Konfiguration.');
    if (!this.config.atlassian.installed) throw new Error('Jira-Plugin ist nicht installiert.');
    const profileId = this.activeProfileId;
    const siteInput = typeof input.siteUrl === 'string' ? input.siteUrl : ''; const siteUrl = siteInput.trim() ? normalizeSiteUrl(siteInput) : '';
    const previousToken = this.config.atlassian.encryptedApiToken; let encryptedApiToken = input.clearCredential || siteUrl !== this.config.atlassian.siteUrl ? undefined : previousToken;
    if (typeof input.apiToken === 'string' && input.apiToken.trim()) { if (!this.credentials.available()) throw new Error('Sichere Zugangsdatenablage ist auf diesem System nicht verfügbar.'); encryptedApiToken = this.credentials.encrypt(boundedString(input.apiToken, 4096, 'API-Token')); }
    const email = boundedString(input.email, 320, 'E-Mail', !input.enabled); const confluenceSpaceKey = boundedString(input.confluenceSpaceKey ?? '', 128, 'Confluence-Space', true); const jiraProjectKey = boundedString(input.jiraProjectKey, 128, 'Jira-Projekt', !input.enabled).toUpperCase();
    if (input.enabled && (!siteUrl || !encryptedApiToken)) throw new Error('Für das Jira-Plugin werden URL, Benutzername, API-Token und Jira-Projekt benötigt.');
    const next: PersistedPluginConfig = { ...this.config, atlassian: { installed: true, enabled: Boolean(input.enabled), siteUrl, email, confluenceSpaceKey, jiraProjectKey, jiraIssueType: boundedString(input.jiraIssueType || 'Task', 128, 'Jira-Vorgangstyp'), jqlFilter: boundedString(input.jqlFilter ?? '', 2000, 'Jira-Filter', true), ...(encryptedApiToken ? { encryptedApiToken } : {}) } };
    await this.saveConfig(next, profileId); if (profileId === this.activeProfileId) this.refreshRuntime(); return this.getSettings();
  }

  /** Jira and Confluence work on behalf of an open local diagram; unsaved, imported and guest diagrams never trigger them. */
  private assertDocumentProject(): void {
    if (!this.projectFolder) throw new Error('Speichere oder öffne zuerst ein lokales Diagramm.');
  }

  private jiraCredential(): string { const value = this.config.atlassian.encryptedApiToken; if (!value || !this.credentials.available()) throw new Error('Kein sicher gespeichertes Atlassian-Token vorhanden.'); return this.credentials.decrypt(value); }

  private gitCredentialEnvironment(remoteUrl: string): GitEnvironment | undefined {
    if (this.config.git.authMode !== 'token') return undefined;
    const encrypted = this.config.git.encryptedAccessToken; if (!encrypted || !this.credentials.available()) throw new Error('Kein sicher gespeichertes Git-Token vorhanden.');
    const boundUrl = this.config.git.credentialRemoteUrl || this.config.git.remoteUrl;
    if (!boundUrl || remoteUrl !== boundUrl || !remoteUrl.startsWith('https://')) throw new Error('Der Git-Remote hat sich geändert. Bitte den Token für diesen Remote erneut speichern.');
    const value = Buffer.from(`${this.config.git.username}:${this.credentials.decrypt(encrypted)}`, 'utf8').toString('base64');
    return { GIT_CONFIG_COUNT: '2', GIT_CONFIG_KEY_0: `http.${remoteUrl}.extraHeader`, GIT_CONFIG_VALUE_0: `Authorization: Basic ${value}`, GIT_CONFIG_KEY_1: 'http.followRedirects', GIT_CONFIG_VALUE_1: 'false' };
  }

  private async configuredGit(args: string[], cwd: string, authenticated = false): Promise<{ stdout: string; stderr: string }> {
    if (!authenticated || this.config.git.authMode !== 'token') return this.runGit(args, cwd);
    const generation = this.projectGeneration;
    const remoteUrl = (await this.runGit(['remote', 'get-url', this.config.git.remote], cwd)).stdout.trim(); this.assertGeneration(generation);
    return this.runGit(args, cwd, this.gitCredentialEnvironment(remoteUrl));
  }

  private async atlassian(pathname: string, init: RequestInit = {}): Promise<unknown> {
    await this.ensureLoaded();
    const generation = this.projectGeneration;
    if (!this.config.atlassian.installed || !this.config.atlassian.enabled) throw new Error('Jira-Plugin ist deaktiviert.');
    const base = normalizeSiteUrl(this.config.atlassian.siteUrl);
    const response = await this.fetchFn(`${base}${pathname}`, { ...init, redirect: 'error', headers: { Accept: 'application/json', 'Content-Type': 'application/json', Authorization: `Basic ${Buffer.from(`${this.config.atlassian.email}:${this.jiraCredential()}`, 'utf8').toString('base64')}`, ...(init.headers ?? {}) }, signal: AbortSignal.timeout(20_000) });
    this.assertGeneration(generation);
    const raw = await response.text(); this.assertGeneration(generation); if (Buffer.byteLength(raw, 'utf8') > MAX_REMOTE_BODY_BYTES) throw new Error('Atlassian-Antwort ist zu groß.'); if (!response.ok) throw new Error(`Atlassian antwortete mit ${response.status}.`); return raw ? JSON.parse(raw) : {};
  }

  public async testAtlassian(): Promise<PluginOperationResult> {
    const generation = this.projectGeneration;
    const checks: Array<Promise<unknown>> = [this.atlassian('/rest/api/3/myself')]; if (this.config.atlassian.confluenceSpaceKey) checks.push(this.atlassian('/wiki/api/v2/spaces?limit=1'));
    const results = await Promise.allSettled(checks); this.assertGeneration(generation); const jira = results[0]; const confluence = results[1];
    const details = [jira?.status === 'fulfilled' ? 'Jira: verbunden' : `Jira: ${jira?.status === 'rejected' && jira.reason instanceof Error ? jira.reason.message : 'Verbindung fehlgeschlagen'}`];
    if (confluence) details.push(confluence.status === 'fulfilled' ? 'Confluence: verbunden' : `Confluence: ${confluence.reason instanceof Error ? confluence.reason.message : 'Verbindung fehlgeschlagen'}`);
    const ok = results.every((entry) => entry.status === 'fulfilled'); const message = details.join(' · '); this.atlassianRuntime = { ...this.atlassianRuntime, health: ok ? 'ready' : 'error', message }; return { ok, message };
  }

  private async gitContext(handleId: string): Promise<{ filePath: string; cwd: string; relativePath: string }> {
    await this.ensureLoaded();
    const generation = this.projectGeneration;
    if (!this.config.git.installed || !this.config.git.enabled) throw new Error('Git-Plugin ist deaktiviert.');
    const location = this.persistence.getHandleLocation(boundedString(handleId, 128, 'Dokument-Handle')); if (!location) throw new Error('Das Dokument muss zuerst gespeichert oder geöffnet werden.');
    if (path.dirname(location.canonicalPath) !== this.projectFolder) throw new Error('Das Dokument gehört nicht zum aktuellen Projektordner.');
    const filePath = location.canonicalPath; const { stdout } = await this.runGit(['rev-parse', '--show-toplevel'], this.projectFolder); const cwd = stdout.trim();
    this.assertGeneration(generation);
    if (!cwd || path.relative(cwd, filePath).startsWith('..')) throw new Error('Das Dokument liegt nicht in einem Git-Repository.'); return { filePath, cwd, relativePath: path.relative(cwd, filePath) };
  }

  private async refreshRemoteTrackingBranch(cwd: string, branch: string): Promise<void> {
    const remote = this.config.git.remote;
    try {
      await this.configuredGit([
        'fetch',
        '--no-tags',
        '--no-recurse-submodules',
        '--no-write-fetch-head',
        remote,
        `+refs/heads/${branch}:refs/remotes/${remote}/${branch}`,
      ], cwd, true);
    } catch (error) {
      const detail = error instanceof Error ? error.message : 'Unbekannter Git-Fehler.';
      throw new Error(`Remote „${remote}“ konnte nicht aktualisiert werden: ${detail}`);
    }
  }

  private async readGitStatusForFolder(refreshRemote = false): Promise<GitPluginSettings> {
    const generation = this.projectGeneration;
    const { stdout: rootOutput } = await this.runGit(['rev-parse', '--show-toplevel'], this.projectFolder); const cwd = rootOutput.trim();
    this.assertGeneration(generation);
    const [{ stdout: status }, { stdout: branch }] = await Promise.all([this.runGit(['status', '--porcelain=v1'], cwd), this.runGit(['branch', '--show-current'], cwd)]);
    this.assertGeneration(generation);
    const branchName = branch.trim();
    if (refreshRemote && branchName) { await this.refreshRemoteTrackingBranch(cwd, branchName); this.assertGeneration(generation); }
    let ahead = 0; let behind = 0;
    try { const { stdout } = await this.runGit(['rev-list', '--left-right', '--count', `HEAD...refs/remotes/${this.config.git.remote}/${branchName}`], cwd); const [left, right] = stdout.trim().split(/\s+/).map(Number); ahead = left || 0; behind = right || 0; }
    catch (error) {
      if (refreshRemote && branchName) {
        const detail = error instanceof Error ? error.message : 'Unbekannter Git-Fehler.';
        throw new Error(`Remote-Status für „${this.config.git.remote}/${branchName}“ konnte nicht berechnet werden: ${detail}`);
      }
      // A local repository can legitimately have no remote-tracking branch yet.
    }
    this.assertGeneration(generation);
    const message = !refreshRemote
      ? (status.trim() ? 'Lokale Änderungen erkannt.' : 'Lokaler Git-Status gelesen; Remote-Stand noch nicht aktualisiert.')
      : ahead > 0 && behind > 0
        ? 'Repository und Remote sind auseinanderentwickelt.'
        : behind > 0
          ? 'Repository liegt hinter dem Remote.'
          : ahead > 0
            ? 'Repository liegt vor dem Remote.'
            : status.trim() ? 'Lokale Änderungen erkannt.' : 'Repository ist synchron.';
    const settings: GitPluginSettings = { ...this.gitRuntime, installed: true, enabled: this.config.git.enabled, folderPath: this.projectFolder, health: refreshRemote ? 'ready' : 'attention', message, repositoryName: path.basename(cwd), branch: branchName || 'noch kein Commit', changedFiles: status.trim() ? status.trim().split(/\r?\n/).length : 0, ahead, behind };
    this.gitRuntime = settings; return settings;
  }

  private async readGitStatus(handleId: string, refreshRemote = false): Promise<GitPluginSettings> { await this.gitContext(handleId); return this.readGitStatusForFolder(refreshRemote); }

  public async gitStatus(handleId: string): Promise<GitSyncResult> {
    const generation = this.projectGeneration;
    try { await this.watchDocument(handleId); const settings = await this.readGitStatus(handleId, true); return { ok: true, message: settings.message, settings }; }
    catch (error) { this.assertGeneration(generation); const message = error instanceof Error ? error.message : 'Git-Status konnte nicht gelesen werden.'; this.gitRuntime = { ...this.gitRuntime, health: 'error', message }; return { ok: false, message, settings: { ...this.gitRuntime } }; }
  }

  private async commitDocument(handleId: string): Promise<void> {
    const generation = this.projectGeneration;
    if (!this.config.git.autoCommit) return; const context = await this.gitContext(handleId); await this.runGit(['add', '--', context.relativePath], context.cwd);
    this.assertGeneration(generation);
    const { stdout } = await this.runGit(['status', '--porcelain=v1', '--', context.relativePath], context.cwd); this.assertGeneration(generation); if (!stdout.trim()) return; await this.runGit(['commit', '-m', `Update ${path.basename(context.filePath)} via Sketchdraw`], context.cwd); this.assertGeneration(generation);
  }

  public async afterDocumentSaved(handleId: string): Promise<void> {
    await this.ensureLoaded();
    const generation = this.projectGeneration;
    const location = this.persistence.getHandleLocation(handleId);
    if (!location || path.dirname(location.canonicalPath) !== this.projectFolder) return;
    if (!this.config.git.installed || !this.config.git.enabled) return;
    try { await this.watchDocument(handleId); await this.commitDocument(handleId); if (this.config.git.autoPush) { const context = await this.gitContext(handleId); await this.configuredGit(['push', this.config.git.remote], context.cwd, true); } await this.readGitStatus(handleId); }
    catch (error) { if (generation === this.projectGeneration) this.gitRuntime = { ...this.gitRuntime, health: 'error', message: error instanceof Error ? error.message : 'Git-Autosync fehlgeschlagen.' }; }
  }

  public async gitSync(handleId: string): Promise<GitSyncResult> {
    const generation = this.projectGeneration;
    try {
      const context = await this.gitContext(handleId); await this.commitDocument(handleId); const { stdout: dirty } = await this.runGit(['status', '--porcelain=v1'], context.cwd);
      this.assertGeneration(generation);
      if (dirty.trim()) throw new Error('Git-Sync pausiert: Das Repository enthält weitere ungespeicherte Änderungen.');
      if (this.config.git.autoPull) await this.configuredGit(['pull', '--ff-only', this.config.git.remote], context.cwd, true); this.assertGeneration(generation); if (this.config.git.autoPush) await this.configuredGit(['push', this.config.git.remote], context.cwd, true); this.assertGeneration(generation);
      await this.emitReload(handleId); const settings = await this.readGitStatus(handleId, true); return { ok: true, message: 'Git-Synchronisation abgeschlossen.', settings };
    } catch (error) { this.assertGeneration(generation); const message = error instanceof Error ? error.message : 'Git-Synchronisation fehlgeschlagen.'; this.gitRuntime = { ...this.gitRuntime, health: 'error', message }; return { ok: false, message, settings: { ...this.gitRuntime } }; }
  }

  private async emitReload(handleId: string): Promise<void> { const before = this.persistence.getHandleLocation(handleId)?.versionToken; const result = await this.persistence.reloadDocument(handleId); if (result.status === 'opened' && result.file.versionToken !== before) this.emitEvent({ type: 'document-changed', text: result.text, file: result.file }); }

  public async watchDocument(handleId: string): Promise<PluginOperationResult> {
    await this.ensureLoaded();
    const generation = this.projectGeneration;
    if (!this.config.git.installed || !this.config.git.enabled) return { ok: false, message: 'Git-Plugin ist deaktiviert.' }; if (this.watchers.has(handleId)) return { ok: true, message: 'Dokument wird überwacht.' };
    this.clearWatchers(); const context = await this.gitContext(handleId);
    this.assertGeneration(generation);
    const watcher = watch(context.filePath, { persistent: false }, () => { const previous = this.watcherTimers.get(handleId); if (previous) clearTimeout(previous); this.watcherTimers.set(handleId, setTimeout(() => { void this.emitReload(handleId).catch(() => undefined); }, 250)); });
    watcher.on('error', () => { this.watchers.delete(handleId); }); this.watchers.set(handleId, watcher); if (this.config.git.autoPull) this.pullTimers.set(handleId, setInterval(() => { void this.gitSync(handleId).catch(() => undefined); }, 60_000)); return { ok: true, message: 'Dokument wird überwacht.' };
  }

  private async confluenceSpaceId(): Promise<string | undefined> { const key = this.config.atlassian.confluenceSpaceKey; if (!key) return undefined; const response = await this.atlassian(`/wiki/api/v2/spaces?keys=${encodeURIComponent(key)}&limit=1`) as { results?: Array<{ id?: string }> }; return response.results?.[0]?.id; }

  public async listConfluencePages(query: string): Promise<ConfluencePageSummary[]> {
    this.assertDocumentProject();
    const spaceId = await this.confluenceSpaceId(); const params = new URLSearchParams({ limit: '100', sort: '-modified-date' }); if (spaceId) params.set('space-id', spaceId);
    const response = await this.atlassian(`/wiki/api/v2/pages?${params}`) as { results?: Array<Record<string, unknown>> }; const needle = query.trim().toLocaleLowerCase('de'); const base = this.config.atlassian.siteUrl;
    return (response.results ?? []).map((page) => ({ id: String(page.id ?? ''), title: String(page.title ?? ''), version: Number((page.version as Record<string, unknown> | undefined)?.number ?? 1), url: `${base}/wiki/spaces/${encodeURIComponent(this.config.atlassian.confluenceSpaceKey)}/pages/${encodeURIComponent(String(page.id ?? ''))}` })).filter((page) => page.id && (!needle || page.title.toLocaleLowerCase('de').includes(needle))).slice(0, 100);
  }

  public async getConfluencePage(pageId: string): Promise<ConfluencePage> {
    this.assertDocumentProject();
    const id = boundedString(pageId, 128, 'Confluence-Seiten-ID'); const page = await this.atlassian(`/wiki/api/v2/pages/${encodeURIComponent(id)}?body-format=storage`) as Record<string, unknown>;
    const body = page.body as Record<string, unknown> | undefined; const storage = body?.storage as Record<string, unknown> | undefined;
    return { id, title: String(page.title ?? ''), version: Number((page.version as Record<string, unknown> | undefined)?.number ?? 1), storageBody: String(storage?.value ?? ''), url: `${this.config.atlassian.siteUrl}/wiki/pages/viewpage.action?pageId=${encodeURIComponent(id)}` };
  }

  public async updateConfluencePage(input: { pageId: string; title: string; storageBody: string; version: number }): Promise<ConfluencePage> {
    this.assertDocumentProject();
    const pageId = boundedString(input.pageId, 128, 'Confluence-Seiten-ID'); const title = boundedString(input.title, 500, 'Seitentitel');
    if (!Number.isSafeInteger(input.version) || input.version < 1 || Buffer.byteLength(input.storageBody, 'utf8') > MAX_REMOTE_BODY_BYTES) throw new Error('Ungültiger Seiteninhalt.');
    await this.atlassian(`/wiki/api/v2/pages/${encodeURIComponent(pageId)}`, { method: 'PUT', body: JSON.stringify({ id: pageId, status: 'current', title, body: { representation: 'storage', value: input.storageBody }, version: { number: input.version + 1, message: 'Updated from Sketchdraw' } }) }); return this.getConfluencePage(pageId);
  }

  private jiraIssue(value: Record<string, unknown>): JiraIssueSummary {
    const fields = (value.fields ?? {}) as Record<string, unknown>;
    const status = (fields.status ?? {}) as Record<string, unknown>;
    const assignee = fields.assignee && typeof fields.assignee === 'object' && !Array.isArray(fields.assignee) ? fields.assignee as Record<string, unknown> : undefined;
    const remoteStatus = String(status.name ?? 'To Do');
    const key = String(value.key ?? '');
    const assigneeName = String(assignee?.displayName ?? assignee?.emailAddress ?? '').trim();
    const dueDate = typeof fields.duedate === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(fields.duedate) ? fields.duedate : undefined;
    return {
      id: String(value.id ?? key), key, title: String(fields.summary ?? key), description: adfText(fields.description),
      status: jiraStatus(remoteStatus), remoteStatus,
      ...(assigneeName ? { assignee: assigneeName } : {}), ...(dueDate ? { dueDate } : {}),
      url: `${this.config.atlassian.siteUrl}/browse/${encodeURIComponent(key)}`, updatedAt: isoTimestamp(fields.updated),
    };
  }

  private async jiraAssigneeAccountId(value: string, issueKey?: string): Promise<string> {
    const assignee = boundedString(value, 120, 'Jira-Zuständigkeit');
    const params = new URLSearchParams({ query: assignee, maxResults: '50' });
    if (issueKey) params.set('issueKey', issueKey);
    else params.set('project', boundedString(this.config.atlassian.jiraProjectKey, 128, 'Jira-Projekt'));
    const users = await this.atlassian(`/rest/api/3/user/assignable/search?${params}`) as Array<Record<string, unknown>>;
    const normalized = assignee.toLocaleLowerCase('de');
    const exact = users.filter((user) => [user.accountId, user.displayName, user.emailAddress].some((candidate) => typeof candidate === 'string' && candidate.toLocaleLowerCase('de') === normalized));
    const selected = exact.length === 1 ? exact[0] : exact.length === 0 && users.length === 1 ? users[0] : undefined;
    if (!selected || typeof selected.accountId !== 'string' || !selected.accountId) throw new Error(`Keine eindeutig zuweisbare Jira-Person für „${assignee}“ gefunden.`);
    return selected.accountId;
  }

  public async createJiraIssue(input: CreateJiraIssueInput): Promise<JiraIssueSummary> {
    this.assertDocumentProject();
    const fields: Record<string, unknown> = {
      project: { key: boundedString(this.config.atlassian.jiraProjectKey, 128, 'Jira-Projekt') },
      issuetype: { name: this.config.atlassian.jiraIssueType },
      summary: boundedString(input.title, 255, 'Jira-Titel'),
      description: descriptionAdf(boundedString(input.description, 50_000, 'Jira-Beschreibung', true)),
    };
    if (input.assignee) fields.assignee = { accountId: await this.jiraAssigneeAccountId(input.assignee) };
    if (input.dueDate) fields.duedate = jiraDueDate(input.dueDate);
    const created = await this.atlassian('/rest/api/3/issue', { method: 'POST', body: JSON.stringify({ fields }) }) as Record<string, unknown>;
    return this.getJiraIssue(String(created.key ?? created.id ?? ''));
  }

  private async getJiraIssue(key: string): Promise<JiraIssueSummary> {
    const issue = await this.atlassian(`/rest/api/3/issue/${encodeURIComponent(boundedString(key, 128, 'Jira-Key'))}?fields=summary,description,status,assignee,duedate,updated`) as Record<string, unknown>;
    return this.jiraIssue(issue);
  }

  public async listJiraIssues(): Promise<JiraIssueSummary[]> {
    this.assertDocumentProject();
    const project = boundedString(this.config.atlassian.jiraProjectKey, 128, 'Jira-Projekt'); const configuredFilter = boundedString(this.config.atlassian.jqlFilter, 2000, 'Jira-Filter', true); const baseFilter = configuredFilter || `project = "${project.replaceAll('"', '')}"`; const jql = /\border\s+by\b/i.test(baseFilter) ? baseFilter : `${baseFilter} ORDER BY updated DESC`;
    const response = await this.atlassian('/rest/api/3/search/jql', { method: 'POST', body: JSON.stringify({ jql, maxResults: 100, fields: ['summary', 'description', 'status', 'assignee', 'duedate', 'updated'] }) }) as { issues?: Array<Record<string, unknown>> }; return (response.issues ?? []).map((issue) => this.jiraIssue(issue));
  }

  public async updateJiraIssue(input: UpdateJiraIssueInput): Promise<JiraIssueSummary> {
    this.assertDocumentProject();
    const key = boundedString(input.key, 128, 'Jira-Key');
    if (input.assignee !== undefined) {
      const accountId = input.assignee === null || !input.assignee.trim() ? null : await this.jiraAssigneeAccountId(input.assignee, key);
      await this.atlassian(`/rest/api/3/issue/${encodeURIComponent(key)}/assignee`, { method: 'PUT', body: JSON.stringify({ accountId }) });
    }
    if (input.dueDate !== undefined) {
      const dueDate = input.dueDate === null || input.dueDate === '' ? null : jiraDueDate(input.dueDate);
      await this.atlassian(`/rest/api/3/issue/${encodeURIComponent(key)}`, { method: 'PUT', body: JSON.stringify({ fields: { duedate: dueDate } }) });
    }
    return this.getJiraIssue(key);
  }

  public async transitionJiraIssue(input: { key: string; status: TaskStatus }): Promise<JiraIssueSummary> {
    this.assertDocumentProject();
    const key = boundedString(input.key, 128, 'Jira-Key'); const desired: Record<TaskStatus, string[]> = { todo: ['to do', 'open', 'offen'], doing: ['in progress', 'doing', 'in arbeit'], review: ['review', 'in review', 'prüfung'], done: ['done', 'closed', 'resolved', 'erledigt'] };
    const response = await this.atlassian(`/rest/api/3/issue/${encodeURIComponent(key)}/transitions`) as { transitions?: Array<{ id?: string; name?: string; to?: { name?: string } }> }; const transition = (response.transitions ?? []).find((item) => desired[input.status].some((name) => `${item.name ?? ''} ${item.to?.name ?? ''}`.toLocaleLowerCase('en').includes(name)));
    if (!transition?.id) throw new Error('Für diesen Jira-Workflow wurde kein passender Statusübergang gefunden.'); await this.atlassian(`/rest/api/3/issue/${encodeURIComponent(key)}/transitions`, { method: 'POST', body: JSON.stringify({ transition: { id: transition.id } }) }); return this.getJiraIssue(key);
  }

  public dispose(): void { this.clearWatchers(); }

  private clearWatchers(): void { for (const watcher of this.watchers.values()) watcher.close(); for (const timer of this.watcherTimers.values()) clearTimeout(timer); for (const timer of this.pullTimers.values()) clearInterval(timer); this.watchers.clear(); this.watcherTimers.clear(); this.pullTimers.clear(); }
}

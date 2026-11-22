import { execFile as execFileCallback } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { promises as fs, watch, type FSWatcher } from 'node:fs';
import path from 'node:path';
import { promisify } from 'node:util';
import { GitWorkbench, gitFailure } from './git-workbench';
import type {
  AtlassianPluginSettings,
  ConfigureAtlassianPluginInput,
  ConfigureGitPluginInput,
  ConfluenceLiveLink,
  ConfluencePageLiveLink,
  ConfluenceLivePublishInput,
  ConfluenceLivePublishResult,
  ConfluencePage,
  ConfluencePageSummary,
  CreateJiraIssueInput,
  GitCommitInput,
  GitCommitSummary,
  GitFileDiff,
  GitPluginSettings,
  GitSyncResult,
  GitWorkbenchResult,
  GitWorkbenchSnapshot,
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
import { confluenceStorageLoss } from '../src/domain/atlassian';
import { CONFLUENCE_LIVE_MAX_IMAGE_BYTES, CONFLUENCE_LIVE_MAX_IMAGES, confluenceLiveFilePrefix, confluenceLiveFilename, isPngImage, managedImageFilenames, planManagedImages, type ManagedImage } from '../src/domain/confluence-live';
import type { DocumentPersistenceService } from './persistence';
import { AZURE_DEVOPS_API_VERSION, AZURE_DEVOPS_DEFAULT_API_VERSION, createAzureWorkItem, getAzureWorkItem, listAzureWorkItems, searchAzureWorkItems, updateAzureWorkItemDetails, normalizeAzureDevOpsUrl, testAzureDevOps, transitionAzureWorkItem, updateAzureWorkItem, type AzureDevOpsConnection } from './azure-devops';
import type { AzureDevOpsPluginSettings, ConfigureAzureDevOpsPluginInput, CreateWorkItemInput, TicketProvider, UpdateWorkItemFieldsInput, UpdateWorkItemInput, WorkItemSummary } from '../src/domain/plugins';

const execFile = promisify(execFileCallback);
const CONFIG_VERSION = 2;
/** Profiles of the editor (#168). Version 2 was one configuration file per diagram folder. */
const STORE_VERSION = 3;
const LEGACY_PROJECT_CONFIG_NAME = '.sketchdraw-plugins.json';
const DEFAULT_PROFILE_ID = 'default';
const DEFAULT_PROFILE_NAME = 'Standard';
const MAX_REMOTE_BODY_BYTES = 2_000_000;
const MAX_CONFLUENCE_LINKS = 200;
/** A page body is only written when it did not change for this long; a page somebody is typing in is left alone. */
const LIVE_QUIET_WINDOW_MS = 1_500;
const LIVE_UPLOAD_TIMEOUT_MS = 60_000;

/**
 * A live link to a Confluence page. It lives in the profile, never in the diagram. With `diagramPageId` it belongs to
 * one page of the diagram and publishes that page only (#240); without it, it is the link of the whole diagram file
 * that earlier versions made (#210) and publishes every page.
 */
interface PersistedConfluenceLink {
  /** Identifies this one act of linking; a link made anew is another link, even to the same page. Never shown. */
  token: string;
  documentPath: string;
  documentId: string;
  /** The page of the diagram this link belongs to. */
  diagramPageId?: string;
  siteUrl: string;
  pageId: string;
  pageTitle: string;
  pageUrl: string;
  lastSyncedAt?: string;
  /**
   * The attachments this link created or took over, per file name: the attachment's id, the version this device
   * confirmed last and the rendered content of that version. Only these are ever updated; a version nobody here
   * wrote is somebody else's change.
   */
  published?: Record<string, PublishedAttachment>;
  /**
   * Uploads that were sent without a confirmed answer yet, written before the request leaves. `baseVersion` is the
   * attachment version before the upload (0: the attachment did not exist). A later run settles each of them
   * against Confluence before anything is uploaded again.
   */
  pending?: Record<string, PendingUpload>;
}

interface PublishedAttachment { id: string; hash: string; version: number }
interface PendingUpload { hash: string; baseVersion: number; attachmentId: string | null }

class AtlassianHttpError extends Error {
  /** `retryAt`: the moment the server asked to wait for (Retry-After), as a timestamp. */
  constructor(public readonly status: number, public readonly retryAt?: number) { super(`Atlassian antwortete mit ${status}.`); }
}

/** The server asked for a pause that is not over; no request was sent. */
class AtlassianCooldownError extends Error {
  constructor(public readonly retryAt: number) { super('Atlassian hat um eine Pause gebeten. Anfragen werden bis zum genannten Zeitpunkt zurückgehalten.'); }
}

/** The authority an operation was started under is gone: diagram, profile, account, site, link or window changed. */
class AuthorityChanged extends Error {
  constructor() { super('Die Aktion wurde abgebrochen, weil sich Diagramm, Profil, Konto oder Verknüpfung geändert haben. Bitte erneut starten.'); }
}

/** A step that can succeed later without the user. */
class LiveSyncRetry extends Error {
  constructor(message: string, public readonly retryAt?: number) { super(message); }
}

/** A step that needs the user. */
class LiveSyncFailure extends Error {}

/**
 * What a running publication was started for. `epoch` is the authority epoch of that moment: it never comes back,
 * so a job cannot be revived by returning to the same diagram, profile, account or setting later.
 */
interface LiveJob {
  epoch: number;
  linkToken: string;
  profileId: string;
  documentPath: string;
  documentId: string;
  siteUrl: string;
  pageId: string;
  /** Set for the link of one diagram page: only its image is this job's to publish. */
  diagramPageId?: string;
}

/** Longest pause a server may impose through Retry-After; a longer or absurd value does not lock publishing for days. */
const MAX_SERVER_COOLDOWN_MS = 6 * 60 * 60 * 1000;
const DIGEST_COMMENT = /^Sketchdraw ([0-9a-f]{64})$/;
/** Attachment ids appear with and without the `att` prefix depending on the API version. */
const attachmentKey = (id: string): string => id.replace(/^att/i, '');

const sha256 = (value: string | Uint8Array): string => createHash('sha256').update(value).digest('hex');

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
  /** Whether Jira or Confluence is installed, and whether one of them is switched on. Versions before the split (#282) only know these two. */
  installed: boolean;
  enabled: boolean;
  /**
   * Jira and Confluence are two plugins that share one Atlassian connection (#282). A profile written before the
   * split has none of these four; both plugins then take `installed` and `enabled`.
   */
  jiraInstalled?: boolean;
  jiraEnabled?: boolean;
  confluenceInstalled?: boolean;
  confluenceEnabled?: boolean;
  siteUrl: string;
  email: string;
  encryptedApiToken?: string;
  confluenceSpaceKey: string;
  jiraProjectKey: string;
  jiraIssueType: string;
  jqlFilter: string;
  /** Links of whole diagram files, as earlier versions made them. */
  confluenceLinks?: PersistedConfluenceLink[];
  /** Links of single diagram pages (#240). A separate field, so a version that only knows the first one still reads the file. */
  confluencePageLinks?: PersistedConfluenceLink[];
}

/** Azure Boards (#284). A profile that never had the plugin installed has no such entry. */
interface PersistedAzureConfig {
  installed: boolean;
  enabled: boolean;
  variant: 'cloud' | 'server';
  organizationUrl: string;
  project: string;
  workItemType: string;
  wiqlFilter: string;
  apiVersion: string;
  readOnly: boolean;
  encryptedAccessToken?: string;
}

interface PersistedPluginConfig {
  version: 2;
  git: PersistedGitConfig;
  atlassian: PersistedAtlassianConfig;
  azure?: PersistedAzureConfig;
}

interface PersistedProfile {
  id: string;
  name: string;
  git: PersistedGitConfig;
  atlassian: PersistedAtlassianConfig;
  azure?: PersistedAzureConfig;
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
  /** How long a Confluence page must stay unchanged before its text is written; tests shorten it. */
  liveQuietWindowMs?: number;
  /** The clock for server-imposed pauses; tests control it. */
  now?: () => number;
}

const DEFAULT_CONFIG: PersistedPluginConfig = {
  version: CONFIG_VERSION,
  git: { installed: true, enabled: false, autoCommit: true, autoPush: false, autoPull: true, remote: 'origin', remoteUrl: '', authMode: 'system', username: '' },
  atlassian: { installed: true, enabled: false, siteUrl: '', email: '', confluenceSpaceKey: '', jiraProjectKey: '', jiraIssueType: 'Task', jqlFilter: '' },
};

/** Azure DevOps is a plugin the user installs; it does not come installed. */
const DEFAULT_AZURE: PersistedAzureConfig = { installed: false, enabled: false, variant: 'cloud', organizationUrl: '', project: '', workItemType: 'Task', wiqlFilter: '', apiVersion: AZURE_DEVOPS_DEFAULT_API_VERSION.cloud, readOnly: false };

/** Stored Azure DevOps settings are checked like entered ones: wrong shapes are rejected, not repaired. */
function parseAzureConfig(value: unknown): PersistedAzureConfig | undefined {
  if (value === undefined) return undefined;
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('PROFILE_STORE_INVALID');
  const record = value as Record<string, unknown>;
  for (const [key, fallback] of Object.entries(DEFAULT_AZURE)) if (key in record && typeof record[key] !== typeof fallback) throw new Error('PROFILE_STORE_INVALID');
  if ('encryptedAccessToken' in record && typeof record.encryptedAccessToken !== 'string') throw new Error('PROFILE_STORE_INVALID');
  const azure = { ...DEFAULT_AZURE, ...(record as Partial<PersistedAzureConfig>) };
  if (azure.variant !== 'cloud' && azure.variant !== 'server') throw new Error('PROFILE_STORE_INVALID');
  azure.organizationUrl = normalizeAzureDevOpsUrl(azure.organizationUrl, azure.variant);
  azure.project = boundedString(azure.project, 64, 'Azure-DevOps-Projekt', !azure.enabled);
  azure.workItemType = boundedString(azure.workItemType, 128, 'Work-Item-Typ');
  azure.wiqlFilter = boundedMultilineText(azure.wiqlFilter, 4000, 'WIQL-Abfrage');
  if (!AZURE_DEVOPS_API_VERSION.test(azure.apiVersion)) throw new Error('PROFILE_STORE_INVALID');
  if (azure.enabled && (!azure.installed || !azure.organizationUrl || !azure.encryptedAccessToken)) throw new Error('PROFILE_STORE_INVALID');
  return azure;
}

/** The state of the two Atlassian plugins; a profile from before the split gives both what the one plugin had. */
function atlassianParts(config: PersistedAtlassianConfig): { jiraInstalled: boolean; jiraEnabled: boolean; confluenceInstalled: boolean; confluenceEnabled: boolean } {
  const jiraInstalled = config.jiraInstalled ?? config.installed, confluenceInstalled = config.confluenceInstalled ?? config.installed;
  return { jiraInstalled, confluenceInstalled, jiraEnabled: jiraInstalled && (config.jiraEnabled ?? config.enabled), confluenceEnabled: confluenceInstalled && (config.confluenceEnabled ?? config.enabled) };
}
/** Writes the state of both plugins and keeps `installed` and `enabled` true for a version that only knows those. */
function withAtlassianParts<T extends PersistedAtlassianConfig>(config: T, parts: ReturnType<typeof atlassianParts>): T {
  return { ...config, ...parts, installed: parts.jiraInstalled || parts.confluenceInstalled, enabled: parts.jiraEnabled || parts.confluenceEnabled };
}

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
  return sameFields(config.git, DEFAULT_CONFIG.git) && sameFields(config.atlassian, DEFAULT_CONFIG.atlassian) && (!config.azure || sameFields(config.azure, DEFAULT_AZURE));
}

/** Links are stored data like everything else in the profile file: wrong shapes are rejected, not repaired. */
function parseConfluenceLinks(value: unknown, scope: 'diagram' | 'page' = 'diagram'): PersistedConfluenceLink[] | undefined {
  if (value === undefined) return undefined;
  if (!Array.isArray(value) || value.length > MAX_CONFLUENCE_LINKS) throw new Error('PROFILE_STORE_INVALID');
  const paths = new Set<string>();
  const links = value.map((entry): PersistedConfluenceLink => {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) throw new Error('PROFILE_STORE_INVALID');
    const record = entry as Record<string, unknown>;
    const text = (key: string, max: number, allowEmpty = false): string => {
      const field = record[key];
      if (typeof field !== 'string' || field.length > max || (!allowEmpty && !field) || /[\u0000-\u001f\u007f]/.test(field)) throw new Error('PROFILE_STORE_INVALID');
      return field;
    };
    const link: PersistedConfluenceLink = {
      token: '', documentPath: text('documentPath', 4096), documentId: text('documentId', 256), siteUrl: normalizeSiteUrl(text('siteUrl', 2048)),
      pageId: text('pageId', 128), pageTitle: text('pageTitle', 500, true), pageUrl: text('pageUrl', 4096),
    };
    if (record.token !== undefined && (typeof record.token !== 'string' || !/^[0-9a-f-]{8,64}$/.test(record.token))) throw new Error('PROFILE_STORE_INVALID');
    // One link per diagram file, or one per page of it: the scope decides what makes an entry unique.
    if (scope === 'page') link.diagramPageId = text('diagramPageId', 256);
    else if (record.diagramPageId !== undefined) throw new Error('PROFILE_STORE_INVALID');
    link.token = typeof record.token === 'string' ? record.token : sha256(scope === 'page' ? `${link.documentPath}\n${link.diagramPageId}\n${link.pageId}` : `${link.documentPath}\n${link.pageId}`).slice(0, 32);
    const unique = scope === 'page' ? `${link.documentPath}\n${link.diagramPageId}` : link.documentPath;
    if (!path.isAbsolute(link.documentPath) || paths.has(unique) || !/^[0-9A-Za-z_-]+$/.test(link.pageId)) throw new Error('PROFILE_STORE_INVALID');
    paths.add(unique);
    if (record.lastSyncedAt !== undefined) {
      if (typeof record.lastSyncedAt !== 'string' || Number.isNaN(Date.parse(record.lastSyncedAt))) throw new Error('PROFILE_STORE_INVALID');
      link.lastSyncedAt = record.lastSyncedAt;
    }
    const records = (value: unknown): Array<[string, Record<string, unknown>]> => {
      if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).length > CONFLUENCE_LIVE_MAX_IMAGES * 4) throw new Error('PROFILE_STORE_INVALID');
      return Object.entries(value as Record<string, unknown>).map(([filename, state]) => {
        if (!/^[a-z0-9.-]{1,128}$/.test(filename) || !state || typeof state !== 'object' || Array.isArray(state)) throw new Error('PROFILE_STORE_INVALID');
        const item = state as Record<string, unknown>;
        if (typeof item.hash !== 'string' || !/^[0-9a-f]{64}$/.test(item.hash)) throw new Error('PROFILE_STORE_INVALID');
        return [filename, item];
      });
    };
    const attachmentId = (value: unknown): string => {
      if (typeof value !== 'string' || !/^[0-9A-Za-z_-]{1,64}$/.test(value)) throw new Error('PROFILE_STORE_INVALID');
      return value;
    };
    if (record.published !== undefined) {
      link.published = {};
      for (const [filename, item] of records(record.published)) {
        // A record without the attachment's id proves no ownership; it is dropped, not trusted.
        if (item.id === undefined) continue;
        if (!Number.isSafeInteger(item.version) || (item.version as number) < 1) throw new Error('PROFILE_STORE_INVALID');
        link.published[filename] = { id: attachmentId(item.id), hash: item.hash as string, version: item.version as number };
      }
    }
    if (record.pending !== undefined) {
      link.pending = {};
      for (const [filename, item] of records(record.pending)) {
        if (!Number.isSafeInteger(item.baseVersion) || (item.baseVersion as number) < 0) throw new Error('PROFILE_STORE_INVALID');
        link.pending[filename] = { hash: item.hash as string, baseVersion: item.baseVersion as number, attachmentId: item.attachmentId === null ? null : attachmentId(item.attachmentId) };
      }
      if (Object.keys(link.pending).length === 0) delete link.pending;
    }
    return link;
  });
  return links.length ? links : undefined;
}

function parsePluginConfig(value: unknown): Pick<PersistedProfile, 'git' | 'atlassian' | 'azure'> {
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
  for (const key of ['jiraInstalled', 'jiraEnabled', 'confluenceInstalled', 'confluenceEnabled']) {
    const value = (record.atlassian as Record<string, unknown>)[key];
    if (value !== undefined && typeof value !== 'boolean') throw new Error('PROFILE_STORE_INVALID');
  }
  const git = { ...DEFAULT_CONFIG.git, ...(record.git as PersistedGitConfig) };
  const loadedAtlassian = { ...DEFAULT_CONFIG.atlassian, ...(record.atlassian as PersistedAtlassianConfig) };
  const parts = atlassianParts(loadedAtlassian);
  const atlassian = withAtlassianParts(loadedAtlassian, parts);
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
  atlassian.jiraProjectKey = boundedString(atlassian.jiraProjectKey, 128, 'Jira-Projekt', !parts.jiraEnabled).toUpperCase();
  atlassian.jiraIssueType = boundedString(atlassian.jiraIssueType, 128, 'Jira-Vorgangstyp');
  atlassian.jqlFilter = boundedString(atlassian.jqlFilter, 2000, 'Jira-Filter', true);
  if (atlassian.enabled && (!atlassian.siteUrl || !atlassian.encryptedApiToken)) throw new Error('PROFILE_STORE_INVALID');
  const confluenceLinks = parseConfluenceLinks((record.atlassian as Record<string, unknown>).confluenceLinks);
  if (confluenceLinks) atlassian.confluenceLinks = confluenceLinks; else delete atlassian.confluenceLinks;
  const confluencePageLinks = parseConfluenceLinks((record.atlassian as Record<string, unknown>).confluencePageLinks, 'page');
  if (confluencePageLinks) atlassian.confluencePageLinks = confluencePageLinks; else delete atlassian.confluencePageLinks;
  let azure: PersistedAzureConfig | undefined;
  try { azure = parseAzureConfig(record.azure); } catch { throw new Error('PROFILE_STORE_INVALID'); }
  return { git, atlassian, ...(azure ? { azure } : {}) };
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

/** Text of several lines: line breaks and tabs are allowed, other control characters are not. */
function boundedMultilineText(value: unknown, max: number, name: string): string {
  if (typeof value !== 'string') throw new Error(`${name} muss Text sein.`);
  const normalized = value.replace(/\r\n?/g, '\n').trim();
  if (normalized.length > max || /[\u0000-\u0008\u000b-\u001f\u007f]/.test(normalized)) throw new Error(`${name} ist ungültig.`);
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

/** An error this service raised itself, with a message for the user; a failed git call carries the command and its output instead. */
const isOwnError = (error: unknown): error is Error => error instanceof Error && !('cmd' in error) && !('stderr' in error) && !('code' in error);

/** A step of the Git dialog that failed with a message of its own, for example a commit that was made but not pushed. */
class GitStepError extends Error {
  constructor(message: string, readonly reload = false) { super(message); }
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
  /** Canonical path of the open local diagram; live links are looked up by it. */
  private activeDocumentPath = '';
  /** Publications to Confluence run one after another. */
  private liveQueue: Promise<unknown> = Promise.resolve();
  private readonly liveQuietWindowMs: number;
  private readonly now: () => number;
  private disposed = false;
  /**
   * Counts every change of what Atlassian work is done on behalf of: the open diagram, the active profile, the
   * Atlassian settings and account, the live link, and the window that asked. An operation keeps the value it
   * started with and stops as soon as the counter moved on; going back to an earlier state gives a new value.
   */
  private authorityEpoch = 0;
  private authorityAbort = new AbortController();
  /** Until when the server of a site asked for no further requests (Retry-After). */
  private cooldown: { siteUrl: string; until: number } | null = null;
  /** Changes with the project folder and with the active profile; pending work of the old context stops. */
  private projectGeneration = 0;
  private activation: Promise<void> = Promise.resolve();
  private readonly watchers = new Map<string, FSWatcher>();
  private readonly watcherTimers = new Map<string, NodeJS.Timeout>();
  private readonly pullTimers = new Map<string, NodeJS.Timeout>();
  private gitRuntime: GitPluginSettings = this.defaultGitRuntime();
  private atlassianRuntime: AtlassianPluginSettings = this.defaultAtlassianRuntime();
  private azureRuntime: AzureDevOpsPluginSettings = this.azureSettings();

  constructor(options: PluginServiceOptions) {
    this.persistence = options.persistence; this.credentials = options.credentials; this.emitEvent = options.emitEvent; this.fetchFn = options.fetchFn ?? fetch;
    this.storePath = options.configPath ?? '';
    this.liveQuietWindowMs = Math.max(0, options.liveQuietWindowMs ?? LIVE_QUIET_WINDOW_MS);
    this.now = options.now ?? Date.now;
    this.runGit =options.runGit ?? (async (args, cwd, environment) => {
      const result = await execFile('git', args, { cwd, timeout: 30_000, maxBuffer: 2_000_000, windowsHide: true, env: { ...process.env, ...(environment ?? {}) } });
      return { stdout: result.stdout, stderr: result.stderr };
    });
  }

  private defaultGitRuntime(): GitPluginSettings {
    return { installed: true, enabled: false, folderPath: this.projectFolder, autoCommit: true, autoPush: false, autoPull: true, remote: 'origin', remoteUrl: '', authMode: 'system', username: '', credentialStored: false, health: 'disabled', message: 'Git-Plugin ist deaktiviert.' };
  }

  /** The Azure DevOps settings as the interface shows them: without the token, with the state of the connection. */
  private azureSettings(health?: { health: AzureDevOpsPluginSettings['health']; message: string }): AzureDevOpsPluginSettings {
    const { encryptedAccessToken, ...fields } = this.config?.azure ?? DEFAULT_AZURE;
    const credentialStored = Boolean(encryptedAccessToken) && this.credentials.available();
    const enabled = fields.installed && fields.enabled;
    return { ...fields, enabled, credentialStored, ...(health ?? { health: enabled ? (credentialStored ? 'attention' : 'error') : 'disabled', message: !fields.installed ? 'Azure-DevOps-Plugin ist nicht installiert.' : !enabled ? 'Azure-DevOps-Plugin ist deaktiviert.' : credentialStored ? 'Azure DevOps ist eingerichtet. Verbindung testen, um den Zugriff zu prüfen.' : 'Kein sicher gespeichertes Token für Azure DevOps vorhanden.' }) };
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

  private configOf(profile: PersistedProfile): PersistedPluginConfig { return { version: CONFIG_VERSION, git: { ...profile.git }, atlassian: { ...profile.atlassian }, ...(profile.azure ? { azure: { ...profile.azure } } : {}) }; }

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
    await this.mutateStore((profiles, activeProfileId) => ({ activeProfileId, profiles: profiles.map((profile) => {
      if (profile.id !== profileId) return profile;
      const { azure: _azure, ...kept } = profile;
      return { ...kept, git: { ...next.git }, atlassian: { ...next.atlassian }, ...(next.azure ? { azure: { ...next.azure } } : {}) };
    }) }));
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
    this.projectGeneration++; this.revokeAuthority(); this.clearWatchers();
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
    // A live link is an explicit decision in one profile; a copy starts without the links of its source.
    const { confluenceLinks: _links, confluencePageLinks: _pageLinks, ...sourceAtlassian } = source?.atlassian ?? DEFAULT_CONFIG.atlassian;
    const created: PersistedProfile = source
      ? { id: randomUUID(), name, git: { ...source.git }, atlassian: { ...sourceAtlassian }, ...(source.azure ? { azure: { ...source.azure } } : {}) }
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
    this.projectGeneration++; this.revokeAuthority(); this.clearWatchers(); this.projectFolder = folder; this.activeDocumentPath = '';
    this.legacyIssue = undefined;
    this.refreshRuntime();
  }

  public async activateDocument(handleId: string): Promise<PluginSettingsSnapshot> {
    await this.ensureLoaded();
    const location = this.persistence.getHandleLocation(boundedString(handleId, 128, 'Dokument-Handle'));
    if (!location) throw new Error('Das Dokument muss zuerst gespeichert oder geöffnet werden.');
    const nextFolder = path.dirname(location.canonicalPath);
    if (nextFolder === this.projectFolder) {
      // Another diagram of the same folder is another diagram: work for the previous one ends for good.
      if (this.activeDocumentPath !== location.canonicalPath) { this.revokeAuthority(); this.activeDocumentPath = location.canonicalPath; }
      await this.activation; return this.getSettings();
    }
    this.resetProject(nextFolder); this.activeDocumentPath = location.canonicalPath;
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
      // A file that travels with the folder never brings a live link along: links are made on this device only.
      delete legacy.atlassian.confluenceLinks;
      delete legacy.atlassian.confluencePageLinks;
    } catch { this.legacyIssue = this.configurationIssue('legacy', 'invalid-data', file); return; }
    if (generation !== this.projectGeneration || profileId !== this.activeProfileId || !isPristine(this.config)) return;
    try { await this.saveConfig(legacy, profileId); this.revokeAuthority(); } catch { return; }
    if (generation === this.projectGeneration && profileId === this.activeProfileId) this.refreshRuntime();
  }


  private refreshRuntime(): void {
    const gitCredentialStored = Boolean(this.config.git.encryptedAccessToken) && this.credentials.available();
    const gitEnabled = this.config.git.installed && this.config.git.enabled;
    const { installed: gitInstalled, autoCommit, autoPush, autoPull, remote, remoteUrl, authMode, username } = this.config.git;
    this.gitRuntime = { ...this.defaultGitRuntime(), installed: gitInstalled, enabled: gitEnabled, autoCommit, autoPush, autoPull, remote, remoteUrl, authMode, username, credentialStored: gitCredentialStored, health: gitEnabled ? 'attention' : 'disabled', message: !gitInstalled ? 'Git-Plugin ist nicht installiert.' : gitEnabled ? 'Repository-Konfiguration noch nicht geprüft.' : 'Git-Plugin ist deaktiviert.' };
    const atlassianCredentialStored = Boolean(this.config.atlassian.encryptedApiToken) && this.credentials.available();
    const parts = atlassianParts(this.config.atlassian);
    const installed = parts.jiraInstalled || parts.confluenceInstalled, atlassianEnabled = parts.jiraEnabled || parts.confluenceEnabled;
    const { siteUrl, email, confluenceSpaceKey, jiraProjectKey, jiraIssueType, jqlFilter } = this.config.atlassian;
    this.atlassianRuntime = { installed, enabled: atlassianEnabled, ...parts, siteUrl, email, confluenceSpaceKey, jiraProjectKey, jiraIssueType, jqlFilter, credentialStored: atlassianCredentialStored, health: atlassianEnabled ? (atlassianCredentialStored ? 'attention' : 'error') : 'disabled', message: !installed ? 'Jira-Plugin ist nicht installiert.' : atlassianEnabled ? (atlassianCredentialStored ? 'Verbindung noch nicht geprüft.' : 'API-Token fehlt.') : 'Jira-Plugin ist deaktiviert.' };
    this.azureRuntime = this.azureSettings();
  }

  public async getSettings(handleId?: string | null): Promise<PluginSettingsSnapshot> {
    await this.ensureLoaded();
    if (handleId === null) { this.resetProject(); this.activation = Promise.resolve(); }
    else if (handleId !== undefined) return this.activateDocument(handleId);
    const issue = this.storeIssue ?? this.legacyIssue;
    const live = this.liveLinkView();
    const pageLinks = this.pageLinkViews();
    return { available: true, projectFolder: this.projectFolder, profiles: this.profileSummaries(), activeProfileId: this.activeProfileId, ...(issue ? { configurationIssue: { ...issue } } : {}), git: { ...this.gitRuntime }, atlassian: { ...this.atlassianRuntime }, azureDevOps: { ...this.azureRuntime }, ...(live ? { confluenceLive: live } : {}), ...(pageLinks.length ? { confluencePageLinks: pageLinks } : {}) };
  }

  /** The link of the whole open diagram file, as earlier versions made it. */
  private activeLiveLink(): PersistedConfluenceLink | undefined {
    if (!this.activeDocumentPath) return undefined;
    return this.config.atlassian.confluenceLinks?.find((link) => link.documentPath === this.activeDocumentPath);
  }

  /** The links of single pages of the open diagram file. */
  private activePageLinks(): PersistedConfluenceLink[] {
    if (!this.activeDocumentPath) return [];
    return (this.config.atlassian.confluencePageLinks ?? []).filter((link) => link.documentPath === this.activeDocumentPath);
  }

  /** The link of the open diagram file a publication was started for, whichever kind it is. */
  private activeLinkByToken(token: string): PersistedConfluenceLink | undefined {
    const diagram = this.activeLiveLink();
    return diagram?.token === token ? diagram : this.activePageLinks().find((link) => link.token === token);
  }

  /** What the renderer may know about the link: the target and whether it can be used, never a credential. */
  private liveLinkView(): ConfluenceLiveLink | undefined {
    const link = this.activeLiveLink();
    if (!link || !atlassianParts(this.config.atlassian).confluenceInstalled) return undefined;
    return this.linkView(link);
  }

  private linkView(link: PersistedConfluenceLink): ConfluenceLiveLink {
    return { pageId: link.pageId, pageTitle: link.pageTitle, pageUrl: link.pageUrl, siteUrl: link.siteUrl, documentId: link.documentId, usable: link.siteUrl === this.config.atlassian.siteUrl, ...(link.lastSyncedAt ? { lastSyncedAt: link.lastSyncedAt } : {}) };
  }

  private pageLinkViews(): ConfluencePageLiveLink[] {
    if (!atlassianParts(this.config.atlassian).confluenceInstalled) return [];
    return this.activePageLinks().map((link) => ({ ...this.linkView(link), diagramPageId: link.diagramPageId! }));
  }

  /**
   * Changes the links of one profile starting from what is stored now, so a background update never drops a newer
   * setting. `update` sees the links of whole diagrams and of single pages as one list; an entry with
   * `diagramPageId` is a page link.
   */
  private async updateLiveLinks(profileId: string, update: (links: PersistedConfluenceLink[]) => PersistedConfluenceLink[]): Promise<void> {
    await this.mutateStore((profiles, activeProfileId) => ({
      activeProfileId,
      profiles: profiles.map((profile) => {
        if (profile.id !== profileId) return profile;
        const { confluenceLinks, confluencePageLinks, ...atlassian } = profile.atlassian;
        const links = update([...(confluenceLinks ?? []), ...(confluencePageLinks ?? [])]);
        const diagrams = links.filter((link) => link.diagramPageId === undefined);
        const pages = links.filter((link) => link.diagramPageId !== undefined);
        if (diagrams.length > MAX_CONFLUENCE_LINKS || pages.length > MAX_CONFLUENCE_LINKS) throw new Error('Es sind zu viele Confluence-Verknüpfungen gespeichert.');
        return { ...profile, atlassian: { ...atlassian, ...(diagrams.length ? { confluenceLinks: diagrams } : {}), ...(pages.length ? { confluencePageLinks: pages } : {}) } };
      }),
    }));
    if (profileId !== this.activeProfileId) return;
    const { confluenceLinks: _previous, confluencePageLinks: _previousPages, ...atlassian } = this.config.atlassian;
    const stored = this.activeProfile().atlassian;
    this.config = { ...this.config, atlassian: { ...atlassian, ...(stored.confluenceLinks ? { confluenceLinks: stored.confluenceLinks } : {}), ...(stored.confluencePageLinks ? { confluencePageLinks: stored.confluencePageLinks } : {}) } };
  }

  public async installPlugin(id: PluginId): Promise<PluginSettingsSnapshot> {
    await this.ensureLoaded();
    const profileId = this.activeProfileId;
    const next = structuredClone(this.config);
    const parts = atlassianParts(next.atlassian);
    if (id === 'git') next.git.installed = true;
    else if (id === 'jira') next.atlassian = withAtlassianParts(next.atlassian, { ...parts, jiraInstalled: true });
    else if (id === 'confluence') next.atlassian = withAtlassianParts(next.atlassian, { ...parts, confluenceInstalled: true });
    else if (id === 'azure-devops') next.azure = { ...(next.azure ?? DEFAULT_AZURE), installed: true };
    else throw new Error('Unbekanntes Plugin.');
    await this.saveConfig(next, profileId); if (id === 'jira' || id === 'confluence') this.revokeAuthority(); if (profileId === this.activeProfileId) this.refreshRuntime(); return this.getSettings();
  }

  public async uninstallPlugin(id: PluginId): Promise<PluginSettingsSnapshot> {
    await this.ensureLoaded();
    const profileId = this.activeProfileId;
    const next = structuredClone(this.config);
    const parts = atlassianParts(next.atlassian);
    const empty = { ...DEFAULT_CONFIG.atlassian, installed: false, jiraInstalled: false, jiraEnabled: false, confluenceInstalled: false, confluenceEnabled: false };
    if (id === 'git') next.git = { ...DEFAULT_CONFIG.git, installed: false };
    else if (id === 'jira') {
      // Removing one plugin leaves the other with the shared connection; the token goes with the last of the two.
      const { jiraProjectKey, jiraIssueType, jqlFilter } = DEFAULT_CONFIG.atlassian;
      next.atlassian = parts.confluenceInstalled ? withAtlassianParts({ ...next.atlassian, jiraProjectKey, jiraIssueType, jqlFilter }, { ...parts, jiraInstalled: false, jiraEnabled: false }) : empty;
    }
    else if (id === 'confluence') {
      const { confluenceLinks: _links, confluencePageLinks: _pageLinks, ...kept } = next.atlassian;
      next.atlassian = parts.jiraInstalled ? withAtlassianParts({ ...kept, confluenceSpaceKey: '' }, { ...parts, confluenceInstalled: false, confluenceEnabled: false }) : empty;
    }
    // Removing the plugin removes its settings and its token.
    else if (id === 'azure-devops') delete next.azure;
    else throw new Error('Unbekanntes Plugin.');
    await this.saveConfig(next, profileId); if (id === 'jira' || id === 'confluence') this.revokeAuthority(); if (profileId === this.activeProfileId) { if (id === 'git') this.clearWatchers(); this.refreshRuntime(); } return this.getSettings();
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
    const current = atlassianParts(this.config.atlassian);
    // With `plugin` the call configures that one plugin: its switch and its own fields. Without it – as before the
    // split – the switch and all fields apply to whichever of the two is installed.
    const target = input.plugin === 'jira' || input.plugin === 'confluence' ? input.plugin : undefined;
    if (target === 'jira' ? !current.jiraInstalled : target === 'confluence' ? !current.confluenceInstalled : !this.config.atlassian.installed) throw new Error(target === 'confluence' ? 'Confluence-Plugin ist nicht installiert.' : 'Jira-Plugin ist nicht installiert.');
    const parts = {
      ...current,
      jiraEnabled: current.jiraInstalled && (target === 'confluence' ? current.jiraEnabled : Boolean(input.enabled)),
      confluenceEnabled: current.confluenceInstalled && (target === 'jira' ? current.confluenceEnabled : Boolean(input.enabled)),
    };
    const anyEnabled = parts.jiraEnabled || parts.confluenceEnabled;
    const profileId = this.activeProfileId;
    const siteInput = typeof input.siteUrl === 'string' ? input.siteUrl : ''; const siteUrl = siteInput.trim() ? normalizeSiteUrl(siteInput) : '';
    const previousToken = this.config.atlassian.encryptedApiToken; let encryptedApiToken = input.clearCredential || siteUrl !== this.config.atlassian.siteUrl ? undefined : previousToken;
    if (typeof input.apiToken === 'string' && input.apiToken.trim()) { if (!this.credentials.available()) throw new Error('Sichere Zugangsdatenablage ist auf diesem System nicht verfügbar.'); encryptedApiToken = this.credentials.encrypt(boundedString(input.apiToken, 4096, 'API-Token')); }
    const own = this.config.atlassian;
    const email = boundedString(input.email, 320, 'E-Mail', !anyEnabled);
    // Each plugin keeps its own fields when the other one is configured.
    const confluenceSpaceKey = target === 'jira' ? own.confluenceSpaceKey : boundedString(input.confluenceSpaceKey ?? '', 128, 'Confluence-Space', true);
    const jiraProjectKey = target === 'confluence' ? own.jiraProjectKey : boundedString(input.jiraProjectKey, 128, 'Jira-Projekt', !parts.jiraEnabled).toUpperCase();
    const jiraIssueType = target === 'confluence' ? own.jiraIssueType : boundedString(input.jiraIssueType || 'Task', 128, 'Jira-Vorgangstyp');
    const jqlFilter = target === 'confluence' ? own.jqlFilter : boundedString(input.jqlFilter ?? '', 2000, 'Jira-Filter', true);
    if (parts.jiraEnabled && !jiraProjectKey) throw new Error('Für das Jira-Plugin werden URL, Benutzername, API-Token und Jira-Projekt benötigt.');
    if (anyEnabled && (!siteUrl || !encryptedApiToken)) throw new Error(target === 'confluence' ? 'Für das Confluence-Plugin werden URL, Benutzername und API-Token benötigt.' : 'Für das Jira-Plugin werden URL, Benutzername, API-Token und Jira-Projekt benötigt.');
    const next: PersistedPluginConfig = { ...this.config, atlassian: { installed: parts.jiraInstalled || parts.confluenceInstalled, enabled: anyEnabled, ...parts, siteUrl, email, confluenceSpaceKey, jiraProjectKey, jiraIssueType, jqlFilter, ...(encryptedApiToken ? { encryptedApiToken } : {}), ...(this.config.atlassian.confluenceLinks ? { confluenceLinks: this.config.atlassian.confluenceLinks } : {}), ...(this.config.atlassian.confluencePageLinks ? { confluencePageLinks: this.config.atlassian.confluencePageLinks } : {}) } };
    // Saved Atlassian settings are a new authority even when every value is as before: work that ran under the
    // previous site, account or switch never continues, and a pause a server asked the previous site for ends.
    await this.saveConfig(next, profileId); this.revokeAuthority(); if (this.cooldown && this.cooldown.siteUrl !== siteUrl) this.cooldown = null;
    if (profileId === this.activeProfileId) this.refreshRuntime(); return this.getSettings();
  }

  public async configureAzureDevOps(input: ConfigureAzureDevOpsPluginInput): Promise<PluginSettingsSnapshot> {
    await this.ensureLoaded(); if (!input || typeof input !== 'object') throw new Error('Ungültige Azure-DevOps-Konfiguration.');
    const current = this.config.azure ?? DEFAULT_AZURE;
    if (!current.installed) throw new Error('Azure-DevOps-Plugin ist nicht installiert.');
    const profileId = this.activeProfileId;
    const enabled = Boolean(input.enabled);
    const variant = input.variant === 'server' ? 'server' : 'cloud';
    const organizationUrl = normalizeAzureDevOpsUrl(typeof input.organizationUrl === 'string' ? input.organizationUrl : '', variant);
    const project = boundedString(input.project ?? '', 64, 'Azure-DevOps-Projekt', !enabled);
    if (/[\\/:*?"<>|#$}{,+=\[\]]/.test(project)) throw new Error('Der Projektname enthält Zeichen, die Azure DevOps nicht erlaubt.');
    const workItemType = boundedString(input.workItemType || 'Task', 128, 'Work-Item-Typ');
    const wiqlFilter = boundedMultilineText(input.wiqlFilter ?? '', 4000, 'WIQL-Abfrage');
    const apiVersion = typeof input.apiVersion === 'string' && input.apiVersion.trim() ? input.apiVersion.trim() : AZURE_DEVOPS_DEFAULT_API_VERSION[variant];
    if (!AZURE_DEVOPS_API_VERSION.test(apiVersion)) throw new Error('Die API-Version wird in der Form 7.1 oder 6.0 erwartet.');
    // A token belongs to the address it was entered for; another address starts without one.
    let encryptedAccessToken = input.clearCredential || organizationUrl !== current.organizationUrl ? undefined : current.encryptedAccessToken;
    if (typeof input.accessToken === 'string' && input.accessToken.trim()) { if (!this.credentials.available()) throw new Error('Sichere Zugangsdatenablage ist auf diesem System nicht verfügbar.'); encryptedAccessToken = this.credentials.encrypt(boundedString(input.accessToken, 4096, 'Personal Access Token')); }
    if (enabled && (!organizationUrl || !project || !encryptedAccessToken)) throw new Error(variant === 'server' ? 'Für Azure DevOps Server werden die Adresse der Sammlung, das Projekt und ein Personal Access Token benötigt.' : 'Für Azure DevOps werden Organisation, Projekt und ein Personal Access Token benötigt.');
    const next: PersistedPluginConfig = { ...this.config, azure: { installed: true, enabled, variant, organizationUrl, project, workItemType, wiqlFilter, apiVersion, readOnly: Boolean(input.readOnly), ...(encryptedAccessToken ? { encryptedAccessToken } : {}) } };
    await this.saveConfig(next, profileId); this.azureEpoch++;
    if (profileId === this.activeProfileId) this.refreshRuntime(); return this.getSettings();
  }

  /** Counts the saved Azure DevOps configurations; an answer that arrives under an older one is not used. */
  private azureEpoch = 0;
  /** The connection Azure DevOps calls run with. Like Jira, they work on behalf of an open local diagram. */
  private azureConnection(): AzureDevOpsConnection {
    const azure = this.config.azure;
    if (!azure?.installed) throw new Error('Azure-DevOps-Plugin ist nicht installiert.');
    if (!azure.enabled) throw new Error('Azure-DevOps-Plugin ist deaktiviert.');
    if (!azure.encryptedAccessToken || !this.credentials.available()) throw new Error('Kein sicher gespeichertes Token für Azure DevOps vorhanden.');
    return { baseUrl: azure.organizationUrl, project: azure.project, apiVersion: azure.apiVersion, token: this.credentials.decrypt(azure.encryptedAccessToken), fetchFn: this.fetchFn };
  }
  /** Runs one Azure DevOps call; its answer only counts while project, profile and configuration are the ones it started with. */
  private async azure<T>(write: boolean, call: (connection: AzureDevOpsConnection, azure: PersistedAzureConfig) => Promise<T>): Promise<T> {
    await this.ensureLoaded(); this.assertDocumentProject();
    const connection = this.azureConnection(); const azure = this.config.azure!;
    if (write && azure.readOnly) throw new Error('Azure DevOps ist auf „Nur lesen" gestellt.');
    const generation = this.projectGeneration, epoch = this.azureEpoch, profileId = this.activeProfileId;
    const result = await call(connection, azure);
    this.assertGeneration(generation);
    if (epoch !== this.azureEpoch || profileId !== this.activeProfileId) throw new Error('Die Azure-DevOps-Einstellungen haben sich geändert.');
    return result;
  }

  public async testAzureDevOps(): Promise<PluginOperationResult> {
    await this.ensureLoaded();
    const epoch = this.azureEpoch, profileId = this.activeProfileId;
    let result: PluginOperationResult;
    try { const name = await testAzureDevOps(this.azureConnection()); result = { ok: true, message: `Azure DevOps: verbunden mit Projekt „${name}“` }; }
    catch (error) { result = { ok: false, message: `Azure DevOps: ${error instanceof Error ? error.message : 'Verbindung fehlgeschlagen'}` }; }
    if (epoch === this.azureEpoch && profileId === this.activeProfileId) this.azureRuntime = this.azureSettings({ health: result.ok ? 'ready' : 'error', message: result.message });
    return result;
  }

  public listAzureWorkItems(): Promise<WorkItemSummary[]> { return this.azure(false, (connection, azure) => listAzureWorkItems(connection, azure.wiqlFilter)); }

  public createAzureWorkItem(input: CreateWorkItemInput): Promise<WorkItemSummary> {
    if (!input || typeof input !== 'object') throw new Error('Ungültiges Work Item.');
    const fields = { title: boundedString(input.title, 255, 'Titel'), description: boundedMultilineText(input.description ?? '', 50_000, 'Beschreibung'), ...(input.assignee ? { assignee: boundedString(input.assignee, 120, 'Zuständigkeit') } : {}), ...(input.dueDate ? { dueDate: jiraDueDate(input.dueDate) } : {}) };
    return this.azure(true, (connection, azure) => createAzureWorkItem(connection, azure.workItemType, fields));
  }

  public updateAzureWorkItem(input: UpdateWorkItemInput): Promise<WorkItemSummary> {
    if (!input || typeof input !== 'object') throw new Error('Ungültiges Work Item.');
    const key = boundedString(input.key, 12, 'Work-Item-Nummer');
    const fields = {
      ...(input.title !== undefined ? { title: boundedString(input.title, 255, 'Titel') } : {}),
      ...(input.description !== undefined ? { description: boundedMultilineText(input.description, 50_000, 'Beschreibung') } : {}),
      ...(input.assignee !== undefined ? { assignee: input.assignee === null || !input.assignee.trim() ? null : boundedString(input.assignee, 120, 'Zuständigkeit') } : {}),
      ...(input.dueDate !== undefined ? { dueDate: input.dueDate === null || input.dueDate === '' ? null : jiraDueDate(input.dueDate) } : {}),
    };
    return this.azure(true, (connection) => updateAzureWorkItem(connection, key, fields));
  }

  public transitionAzureWorkItem(input: { key: string; status: TaskStatus }): Promise<WorkItemSummary> {
    if (!input || typeof input !== 'object' || !['todo', 'doing', 'review', 'done'].includes(input.status)) throw new Error('Ungültiger Status.');
    const key = boundedString(input.key, 12, 'Work-Item-Nummer');
    return this.azure(true, (connection) => transitionAzureWorkItem(connection, key, input.status));
  }

  /** A call for Jira needs Jira installed and switched on; Confluence alone does not grant it, and the reverse (#282). */
  private assertJira(): void { if (!atlassianParts(this.config.atlassian).jiraEnabled) throw new Error('Jira-Plugin ist deaktiviert.'); }
  private assertConfluence(): void { if (!atlassianParts(this.config.atlassian).confluenceEnabled) throw new Error('Confluence-Plugin ist deaktiviert.'); }

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

  /**
   * `guard` belongs to background work: it runs right before the request is built from the current configuration and
   * again after every wait, so work that was started for one profile, site or diagram never uses another one's.
   */
  private async atlassian(pathname: string, init: RequestInit = {}, options: { guard?: () => void; multipart?: boolean; timeoutMs?: number } = {}): Promise<unknown> {
    await this.ensureLoaded();
    const generation = this.projectGeneration;
    const check = () => { this.assertGeneration(generation); options.guard?.(); };
    options.guard?.();
    if (!this.config.atlassian.installed || !this.config.atlassian.enabled) throw new Error(atlassianParts(this.config.atlassian).jiraInstalled || !this.config.atlassian.installed ? 'Jira-Plugin ist deaktiviert.' : 'Confluence-Plugin ist deaktiviert.');
    const base = normalizeSiteUrl(this.config.atlassian.siteUrl);
    // A pause the server asked for holds for every request to that site, whoever starts it and however often.
    if (this.cooldown && this.cooldown.siteUrl === base) {
      if (this.now() < this.cooldown.until) throw new AtlassianCooldownError(this.cooldown.until);
      this.cooldown = null;
    }
    // A multipart body brings its own content type with the boundary. A request that ends because its authority was
    // revoked reports that, not the technical abort.
    const response = await this.fetchFn(`${base}${pathname}`, { ...init, redirect: 'error', headers: { Accept: 'application/json', ...(options.multipart ? {} : { 'Content-Type': 'application/json' }), Authorization: `Basic ${Buffer.from(`${this.config.atlassian.email}:${this.jiraCredential()}`, 'utf8').toString('base64')}`, ...(init.headers ?? {}) }, signal: options.guard ? AbortSignal.any([AbortSignal.timeout(options.timeoutMs ?? 20_000), this.authorityAbort.signal]) : AbortSignal.timeout(options.timeoutMs ?? 20_000) }).catch((error: unknown) => { check(); throw error; });
    // The pause belongs to the site that asked for it, also when the operation itself is no longer wanted.
    const retryAt = response.ok ? undefined : this.retryDeadline(response);
    if (retryAt !== undefined) this.cooldown = { siteUrl: base, until: retryAt };
    check();
    const raw = await response.text(); check(); if (Buffer.byteLength(raw, 'utf8') > MAX_REMOTE_BODY_BYTES) throw new Error('Atlassian-Antwort ist zu groß.'); if (!response.ok) throw new AtlassianHttpError(response.status, retryAt); return raw ? JSON.parse(raw) : {};
  }

  /** The moment a `Retry-After` header names (seconds or a date), limited so a broken header cannot lock the site for days. */
  private retryDeadline(response: Response): number | undefined {
    if (response.status !== 429 && response.status !== 503) return undefined;
    const header = response.headers?.get('Retry-After')?.trim();
    if (!header) return undefined;
    const now = this.now();
    const seconds = /^\d{1,9}$/.test(header) ? Number(header) : Number.NaN;
    const until = Number.isFinite(seconds) ? now + seconds * 1000 : Date.parse(header);
    if (!Number.isFinite(until) || until <= now) return undefined;
    return Math.min(until, now + MAX_SERVER_COOLDOWN_MS);
  }

  /**
   * Ends the current authority for good. Requests that guarded work still has on the wire are aborted, so nothing
   * of it lingers and work for the next authority does not wait behind it; whether an aborted upload still arrived
   * is settled like every lost answer.
   */
  private revokeAuthority(): void {
    this.authorityEpoch++;
    const abort = this.authorityAbort;
    this.authorityAbort = new AbortController();
    abort.abort();
  }

  /** The current authority, as a check that fails for good once anything it rests on has changed. */
  private authorityGuard(): () => void {
    const epoch = this.authorityEpoch;
    return () => { if (this.disposed || epoch !== this.authorityEpoch) throw new AuthorityChanged(); };
  }

  /**
   * The window that asked for Atlassian work is gone (navigation, crash, close). Everything running or queued on its
   * behalf stops; a new window starts again by naming its diagram.
   */
  public releaseRenderer(): void {
    this.resetProject(); this.activation = Promise.resolve();
  }

  public async testAtlassian(): Promise<PluginOperationResult> {
    const generation = this.projectGeneration;
    // Each installed plugin is tested with its own product; Confluence alongside Jira only once a space is named, as before.
    const parts = atlassianParts(this.config.atlassian);
    const testJira = parts.jiraInstalled || !parts.confluenceInstalled, testConfluence = parts.confluenceInstalled && (Boolean(this.config.atlassian.confluenceSpaceKey) || !testJira);
    const checks: Array<Promise<unknown>> = [...(testJira ? [this.atlassian('/rest/api/3/myself')] : []), ...(testConfluence ? [this.atlassian('/wiki/api/v2/spaces?limit=1')] : [])];
    const results = await Promise.allSettled(checks); this.assertGeneration(generation); const jira = testJira ? results[0] : undefined; const confluence = testConfluence ? results[testJira ? 1 : 0] : undefined;
    const details = jira ? [jira.status === 'fulfilled' ? 'Jira: verbunden' : `Jira: ${jira.reason instanceof Error ? jira.reason.message : 'Verbindung fehlgeschlagen'}`] : [];
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

  // --- Git dialog (#216): the commands live in git-workbench.ts; here they get their repository, their document and their turn. ---

  /** One Git command of the dialog at a time, so that two of them never meet at the index lock. */
  private gitWork: Promise<unknown> = Promise.resolve();
  private inGitTurn<T>(work: () => Promise<T>): Promise<T> {
    const run = this.gitWork.then(work, work);
    this.gitWork = run.catch(() => undefined);
    return run;
  }

  private async gitWorkbenchFor(handleId: unknown): Promise<{ bench: GitWorkbench; handle: string }> {
    const handle = boundedString(handleId, 128, 'Dokument-Handle');
    const context = await this.gitContext(handle);
    return { handle, bench: new GitWorkbench((args, authenticated) => this.configuredGit(args, context.cwd, authenticated), context.cwd, context.filePath, this.config.git.remote) };
  }

  private async gitWorkbenchSnapshot(bench: GitWorkbench, refreshRemote = false): Promise<GitWorkbenchSnapshot> {
    let settings: GitPluginSettings;
    try { settings = await this.readGitStatusForFolder(refreshRemote); }
    catch (error) { if (!refreshRemote) throw error; settings = await this.readGitStatusForFolder(false); }
    return { settings: { ...settings }, changes: await bench.changes(), documentPath: bench.documentPath };
  }

  /** Runs one changing step and answers with the state of the repository afterwards, whether it worked or not. */
  private gitWorkbenchStep(handleId: unknown, fallback: string, step: (bench: GitWorkbench, handle: string) => Promise<{ message: string; reload?: boolean; refreshRemote?: boolean }>): Promise<GitWorkbenchResult> {
    return this.inGitTurn(async () => {
      const generation = this.projectGeneration;
      const { bench, handle } = await this.gitWorkbenchFor(handleId);
      this.assertGeneration(generation);
      let ok = true; let message: string; let reload = false; let refreshRemote = false;
      try { const done = await step(bench, handle); message = done.message; reload = done.reload ?? false; refreshRemote = done.refreshRemote ?? false; }
      catch (error) { this.assertGeneration(generation); ok = false; message = error instanceof GitStepError || isOwnError(error) ? (error as Error).message : gitFailure(error, fallback); reload = error instanceof GitStepError && error.reload; }
      this.assertGeneration(generation);
      if (reload) await this.emitReload(handle).catch(() => undefined);
      const workbench = await this.gitWorkbenchSnapshot(bench, ok && refreshRemote);
      this.assertGeneration(generation);
      return { ok, message, workbench };
    });
  }

  public gitWorkbench(handleId: string): Promise<GitWorkbenchSnapshot> {
    return this.inGitTurn(async () => { const { bench, handle } = await this.gitWorkbenchFor(handleId); await this.watchDocument(handle); return this.gitWorkbenchSnapshot(bench); });
  }

  public gitDiff(input: { handleId: string; path: string; commit?: string }): Promise<GitFileDiff> {
    if (!input || typeof input !== 'object') throw new Error('Ungültige Git-Anfrage.');
    return this.inGitTurn(async () => {
      const { bench } = await this.gitWorkbenchFor(input.handleId);
      try { return await bench.diff(input.path, input.commit); }
      catch (error) { if (isOwnError(error)) throw error; throw new Error(/maxBuffer/.test(String((error as Error | null)?.message)) ? 'Die Änderungen dieser Datei sind zu groß für die Anzeige.' : gitFailure(error, 'Die Änderungen konnten nicht gelesen werden.')); }
    });
  }

  public gitCommit(input: GitCommitInput): Promise<GitWorkbenchResult> {
    if (!input || typeof input !== 'object') throw new Error('Ungültige Git-Anfrage.');
    return this.gitWorkbenchStep(input.handleId, 'Der Commit ist fehlgeschlagen.', async (bench) => {
      await bench.commit(input.message, input.paths);
      if (!input.push) return { message: 'Commit erstellt.' };
      try { await bench.push(); } catch (error) { throw new GitStepError(`Commit erstellt, aber nicht gepusht. ${gitFailure(error, 'Der Push ist fehlgeschlagen.')}`); }
      return { message: 'Commit erstellt und gepusht.', refreshRemote: true };
    });
  }

  public gitPush(handleId: string): Promise<GitWorkbenchResult> {
    return this.gitWorkbenchStep(handleId, 'Der Push ist fehlgeschlagen.', async (bench) => { await bench.push(); return { message: 'Commits wurden gepusht.', refreshRemote: true }; });
  }

  public gitUpdate(handleId: string): Promise<GitWorkbenchResult> {
    return this.gitWorkbenchStep(handleId, 'Das Aktualisieren ist fehlgeschlagen.', async (bench) => {
      const changed = await bench.update();
      return { message: changed ? 'Neue Commits vom Remote übernommen.' : 'Das Repository ist auf dem Stand des Remotes.', reload: changed, refreshRemote: true };
    });
  }

  public gitLog(input: { handleId: string; documentOnly: boolean }): Promise<GitCommitSummary[]> {
    if (!input || typeof input !== 'object') throw new Error('Ungültige Git-Anfrage.');
    return this.inGitTurn(async () => {
      const { bench } = await this.gitWorkbenchFor(input.handleId);
      try { return await bench.log(input.documentOnly === true); }
      catch (error) { if (isOwnError(error)) throw error; throw new Error(gitFailure(error, 'Der Verlauf konnte nicht gelesen werden.')); }
    });
  }

  public gitDiscard(input: { handleId: string; paths: string[] }): Promise<GitWorkbenchResult> {
    if (!input || typeof input !== 'object') throw new Error('Ungültige Git-Anfrage.');
    return this.gitWorkbenchStep(input.handleId, 'Die Änderungen konnten nicht verworfen werden.', async (bench) => {
      const document = Array.isArray(input.paths) && input.paths.includes(bench.documentPath);
      await bench.discard(input.paths);
      return { message: 'Änderungen verworfen.', reload: document };
    });
  }

  public gitRestoreDocument(input: { handleId: string; commit: string }): Promise<GitWorkbenchResult> {
    if (!input || typeof input !== 'object') throw new Error('Ungültige Git-Anfrage.');
    return this.gitWorkbenchStep(input.handleId, 'Das Diagramm konnte nicht zurückgesetzt werden.', async (bench) => {
      await bench.restoreDocument(input.commit);
      return { message: 'Das Diagramm hat den Stand des gewählten Commits. Mit einem Commit hältst du das fest.', reload: true };
    });
  }

  /** Switches the automatic steps of the active profile; connection and credentials stay as they are. */
  public async gitAutomation(input: { autoCommit: boolean; autoPush: boolean; autoPull: boolean }): Promise<GitPluginSettings> {
    await this.ensureLoaded(); if (!input || typeof input !== 'object') throw new Error('Ungültige Git-Konfiguration.');
    const generation = this.projectGeneration; const profileId = this.activeProfileId;
    this.assertStoreWritable();
    const preflight = this.storeQueue.then(() => this.assertStoreCurrent());
    this.storeQueue = preflight.catch(() => undefined);
    await preflight;
    this.assertGeneration(generation);
    if (!this.config.git.installed || !this.config.git.enabled) throw new Error('Git-Plugin ist deaktiviert.');
    const next: PersistedPluginConfig = { ...this.config, git: { ...this.config.git, autoCommit: input.autoCommit === true, autoPush: input.autoPush === true, autoPull: input.autoPull === true } };
    await this.saveConfig(next, profileId);
    if (profileId === this.activeProfileId && generation === this.projectGeneration) { this.clearWatchers(); const { repositoryName, branch, changedFiles, ahead, behind, health, message } = this.gitRuntime; this.refreshRuntime(); this.gitRuntime = { ...this.gitRuntime, repositoryName, branch, changedFiles, ahead, behind, health, message }; }
    return { ...this.gitRuntime };
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
    this.assertDocumentProject(); this.assertConfluence();
    const spaceId = await this.confluenceSpaceId(); const params = new URLSearchParams({ limit: '100', sort: '-modified-date' }); if (spaceId) params.set('space-id', spaceId);
    const response = await this.atlassian(`/wiki/api/v2/pages?${params}`) as { results?: Array<Record<string, unknown>> }; const needle = query.trim().toLocaleLowerCase('de'); const base = this.config.atlassian.siteUrl;
    return (response.results ?? []).map((page) => ({ id: String(page.id ?? ''), title: String(page.title ?? ''), version: Number((page.version as Record<string, unknown> | undefined)?.number ?? 1), url: `${base}/wiki/spaces/${encodeURIComponent(this.config.atlassian.confluenceSpaceKey)}/pages/${encodeURIComponent(String(page.id ?? ''))}` })).filter((page) => page.id && (!needle || page.title.toLocaleLowerCase('de').includes(needle))).slice(0, 100);
  }

  private async readConfluencePage(pageId: string, guard?: () => void): Promise<ConfluencePage> {
    const id = boundedString(pageId, 128, 'Confluence-Seiten-ID'); const page = await this.atlassian(`/wiki/api/v2/pages/${encodeURIComponent(id)}?body-format=storage`, {}, guard ? { guard } : {}) as Record<string, unknown>;
    const body = page.body as Record<string, unknown> | undefined; const storage = body?.storage as Record<string, unknown> | undefined;
    const storageBody = String(storage?.value ?? '');
    return { id, title: String(page.title ?? ''), version: Number((page.version as Record<string, unknown> | undefined)?.number ?? 1), storageBody, bodyHash: sha256(storageBody), url: `${this.config.atlassian.siteUrl}/wiki/pages/viewpage.action?pageId=${encodeURIComponent(id)}` };
  }

  public async getConfluencePage(pageId: string): Promise<ConfluencePage> {
    this.assertDocumentProject(); this.assertConfluence();
    return this.readConfluencePage(pageId);
  }

  /**
   * Replaces the whole page text with an annotation (the manual "Senden" of an embedded page). The annotation model
   * keeps only plain headings, paragraphs, bullets and quotes (#209), so nothing is written unless the page still has
   * exactly the content it was loaded with and survives that conversion. The whole operation belongs to the site,
   * account, profile and diagram it was started for: once any of them changed, no further request is sent.
   */
  public async updateConfluencePage(input: { pageId: string; title: string; storageBody: string; version: number; expectedBodyHash?: string }): Promise<ConfluencePage> {
    const guard = this.authorityGuard();
    await this.ensureLoaded();
    guard();
    this.assertDocumentProject();
    if (!input || typeof input !== 'object') throw new Error('Ungültiger Seiteninhalt.');
    const pageId = boundedString(input.pageId, 128, 'Confluence-Seiten-ID'); const title = boundedString(input.title, 500, 'Seitentitel');
    if (!Number.isSafeInteger(input.version) || input.version < 1 || typeof input.storageBody !== 'string' || Buffer.byteLength(input.storageBody, 'utf8') > MAX_REMOTE_BODY_BYTES) throw new Error('Ungültiger Seiteninhalt.');
    // Without the content the annotation was loaded from, nobody can tell whether the page changed inside one version.
    if (input.expectedBodyHash === undefined) throw new Error('Diese eingebundene Seite hat keinen gesicherten Ausgangsstand. Lade sie neu, bevor du sendest.');
    if (typeof input.expectedBodyHash !== 'string' || !/^[0-9a-f]{64}$/.test(input.expectedBodyHash)) throw new Error('Ungültiger Seiteninhalt.');
    const current = await this.readConfluencePage(pageId, guard);
    guard();
    // A Live Doc can change without a new version number, so the content itself is compared as well.
    if (current.version !== input.version || current.bodyHash !== input.expectedBodyHash) throw new Error('Die Confluence-Seite wurde seit dem letzten Laden geändert. Lade sie neu, bevor du sendest.');
    if (confluenceStorageLoss(current.storageBody).length > 0) throw new Error('Senden würde Inhalte der Confluence-Seite entfernen, die eine Annotation nicht abbilden kann (zum Beispiel Formatierungen, Links, Tabellen, Bilder oder Makros). Die Seite wurde nicht geändert.');
    await this.atlassian(`/wiki/api/v2/pages/${encodeURIComponent(pageId)}`, { method: 'PUT', body: JSON.stringify({ id: pageId, status: 'current', title, body: { representation: 'storage', value: input.storageBody }, version: { number: input.version + 1, message: 'Updated from Sketchdraw' } }) }, { guard });
    return this.readConfluencePage(pageId, guard);
  }

  /**
   * Turns the link of a whole diagram file into one link per page to the same Confluence page (#240). What is known
   * about each attachment goes to the page it belongs to, so nothing is uploaded again and Confluence sees no change.
   * A link that was made for another diagram than the one in the file is not carried over.
   */
  private splitDiagramLink(links: PersistedConfluenceLink[], documentPath: string, documentId: string, diagramPageIds: readonly string[]): PersistedConfluenceLink[] {
    const diagram = links.find((link) => link.documentPath === documentPath && link.diagramPageId === undefined);
    if (!diagram) return links;
    const rest = links.filter((link) => link !== diagram);
    if (diagram.documentId !== documentId) return rest;
    const documentKey = sha256(documentId).slice(0, 12);
    const created: PersistedConfluenceLink[] = [];
    for (const diagramPageId of diagramPageIds) {
      // A page that already has a link of its own keeps it.
      if (rest.some((link) => link.documentPath === documentPath && link.diagramPageId === diagramPageId)) continue;
      const filename = confluenceLiveFilename(documentKey, sha256(diagramPageId).slice(0, 12));
      const published = diagram.published?.[filename];
      const pending = diagram.pending?.[filename];
      created.push({
        token: randomUUID(), documentPath, documentId, diagramPageId, siteUrl: diagram.siteUrl, pageId: diagram.pageId, pageTitle: diagram.pageTitle, pageUrl: diagram.pageUrl,
        ...(diagram.lastSyncedAt ? { lastSyncedAt: diagram.lastSyncedAt } : {}),
        ...(published ? { published: { [filename]: published } } : {}),
        ...(pending ? { pending: { [filename]: pending } } : {}),
      });
    }
    return [...rest, ...created];
  }

  private diagramPageIds(value: unknown): string[] {
    if (!Array.isArray(value) || value.length < 1 || value.length > CONFLUENCE_LIVE_MAX_IMAGES) throw new Error('Ungültige Confluence-Verknüpfung.');
    const ids = value.map((entry) => boundedString(entry, 256, 'Diagrammseite'));
    if (new Set(ids).size !== ids.length) throw new Error('Ungültige Confluence-Verknüpfung.');
    return ids;
  }

  /** The open local diagram file a link call is about; anything else is refused. */
  private liveDocumentPath(handleId: unknown): string {
    this.assertDocumentProject();
    const location = this.persistence.getHandleLocation(boundedString(handleId, 128, 'Dokument-Handle'));
    if (!location || location.canonicalPath !== this.activeDocumentPath) throw new Error('Das Dokument gehört nicht zum aktuellen Projektordner.');
    return location.canonicalPath;
  }

  /**
   * Turns a link of the whole open diagram, as earlier versions made it, into one link per page (#240). Without such
   * a link nothing changes.
   */
  public async convertConfluenceLiveLink(input: { handleId: string; documentId: string; diagramPageIds: string[] }): Promise<PluginSettingsSnapshot> {
    const guard = this.authorityGuard();
    await this.ensureLoaded();
    guard();
    if (!input || typeof input !== 'object') throw new Error('Ungültige Confluence-Verknüpfung.');
    const profileId = this.activeProfileId;
    const documentPath = this.liveDocumentPath(input.handleId);
    const documentId = boundedString(input.documentId, 256, 'Diagramm-ID');
    const diagramPageIds = this.diagramPageIds(input.diagramPageIds);
    if (!this.activeLiveLink()) return this.getSettings();
    await this.updateLiveLinks(profileId, (links) => this.splitDiagramLink(links, documentPath, documentId, diagramPageIds));
    this.revokeAuthority();
    return this.getSettings();
  }

  /**
   * Links a page of the open local diagram (`diagramPageId`) to a Confluence page of the active profile's site, or
   * removes that link with `pageId: null` (#240). Without `diagramPageId` the call addresses the link of the whole
   * diagram file that earlier versions made (#210).
   */
  public async setConfluenceLiveLink(input: { handleId: string; documentId: string; pageId: string | null; diagramPageId?: string; diagramPageIds?: string[] }): Promise<PluginSettingsSnapshot> {
    const guard = this.authorityGuard();
    await this.ensureLoaded();
    guard();
    if (!input || typeof input !== 'object') throw new Error('Ungültige Confluence-Verknüpfung.');
    const profileId = this.activeProfileId;
    const documentPath = this.liveDocumentPath(input.handleId);
    const diagramPageId = input.diagramPageId === undefined ? undefined : boundedString(input.diagramPageId, 256, 'Diagrammseite');
    /** The entry this call is about: the link of that page, or the link of the whole file. */
    const addressed = (link: PersistedConfluenceLink): boolean => link.documentPath === documentPath && link.diagramPageId === diagramPageId;
    // A link of the whole file and links of its pages never exist side by side: the first page link splits it.
    const split = (links: PersistedConfluenceLink[], documentId: string): PersistedConfluenceLink[] => {
      if (diagramPageId === undefined || !links.some((link) => link.documentPath === documentPath && link.diagramPageId === undefined)) return links;
      return this.splitDiagramLink(links, documentPath, documentId, this.diagramPageIds(input.diagramPageIds));
    };
    if (input.pageId === null) {
      const documentId = diagramPageId === undefined ? '' : boundedString(input.documentId, 256, 'Diagramm-ID');
      await this.updateLiveLinks(profileId, (links) => split(links, documentId).filter((link) => !addressed(link)));
      this.revokeAuthority();
      return this.getSettings();
    }
    const documentId = boundedString(input.documentId, 256, 'Diagramm-ID');
    this.assertConfluence();
    const siteUrl = this.config.atlassian.siteUrl;
    const pageId = boundedString(input.pageId, 128, 'Confluence-Seiten-ID');
    if (!/^[0-9A-Za-z_-]+$/.test(pageId)) throw new Error('Confluence-Seiten-ID ist ungültig.');
    if (diagramPageId !== undefined && this.activeLiveLink()) this.diagramPageIds(input.diagramPageIds);
    // Reading the page proves that it exists on this site and that the stored account may see it.
    const page = await this.readConfluencePage(pageId, guard);
    guard();
    // A new link starts without any remembered attachment: what it may update is decided again from Confluence.
    const link: PersistedConfluenceLink = { token: randomUUID(), documentPath, documentId, ...(diagramPageId !== undefined ? { diagramPageId } : {}), siteUrl, pageId, pageTitle: page.title.replace(/[\u0000-\u001f\u007f]/g, ' ').slice(0, 500), pageUrl: page.url };
    await this.updateLiveLinks(profileId, (links) => {
      const others = split(links, documentId).filter((entry) => !addressed(entry));
      // A link of the whole file replaces the links of its pages, as the first page link replaces it.
      const kept = diagramPageId === undefined ? others.filter((entry) => entry.documentPath !== documentPath) : others;
      if (kept.filter((entry) => (entry.diagramPageId === undefined) === (diagramPageId === undefined)).length >= MAX_CONFLUENCE_LINKS) throw new Error('Es sind zu viele Confluence-Verknüpfungen gespeichert.');
      return [...kept, link];
    });
    this.revokeAuthority();
    return this.getSettings();
  }

  private assertLiveJob(job: LiveJob): void {
    if (this.disposed || job.epoch !== this.authorityEpoch) throw new AuthorityChanged();
    // The epoch alone decides; the values are checked as well so a missed invalidation cannot send anything elsewhere.
    const atlassian = this.config.atlassian;
    const link = this.activeLinkByToken(job.linkToken);
    if (job.profileId !== this.activeProfileId || job.documentPath !== this.activeDocumentPath || !atlassianParts(atlassian).confluenceEnabled || atlassian.siteUrl !== job.siteUrl
      || !link || link.pageId !== job.pageId || link.documentId !== job.documentId || link.siteUrl !== job.siteUrl || link.diagramPageId !== job.diagramPageId) throw new AuthorityChanged();
  }

  /**
   * Publishes rendered pages of the open diagram to a linked Confluence page: with `diagramPageId` the image of that
   * one page through the link of that page, otherwise every page through the link of the whole file. The job belongs to the authority
   * of the moment of the call (diagram file, diagram, profile, site, account, link, window); it runs after earlier
   * publications and stops for good as soon as that authority changed, whatever it changed to.
   */
  public async publishConfluenceLive(input: ConfluenceLivePublishInput): Promise<ConfluenceLivePublishResult> {
    const epoch = this.authorityEpoch;
    await this.ensureLoaded();
    const done = (status: ConfluenceLivePublishResult['status'], message: string): ConfluenceLivePublishResult => ({ status, message, uploaded: 0, bodyUpdated: false });
    if (this.disposed || epoch !== this.authorityEpoch) return done('cancelled', new AuthorityChanged().message);
    let job: LiveJob; let images: ConfluenceLivePublishInput['images']; let title: string;
    try {
      if (!input || typeof input !== 'object') throw new LiveSyncFailure('Ungültige Confluence-Veröffentlichung.');
      this.assertDocumentProject();
      const location = this.persistence.getHandleLocation(boundedString(input.handleId, 128, 'Dokument-Handle'));
      if (!location || location.canonicalPath !== this.activeDocumentPath) throw new LiveSyncFailure('Das Dokument gehört nicht zum aktuellen Projektordner.');
      const diagramPageId = input.diagramPageId === undefined ? undefined : boundedString(input.diagramPageId, 256, 'Diagrammseite');
      const link = diagramPageId === undefined ? this.activeLiveLink() : this.activePageLinks().find((entry) => entry.diagramPageId === diagramPageId);
      if (!link) throw new LiveSyncFailure(diagramPageId === undefined ? 'Dieses Diagramm ist mit keiner Confluence-Seite verknüpft.' : 'Diese Seite ist mit keiner Confluence-Seite verknüpft.');
      const atlassian = this.config.atlassian;
      if (!atlassianParts(atlassian).confluenceEnabled) throw new LiveSyncFailure('Confluence-Plugin ist deaktiviert.');
      if (!atlassian.encryptedApiToken || !this.credentials.available()) throw new LiveSyncFailure('Kein sicher gespeichertes Atlassian-Token vorhanden.');
      if (link.siteUrl !== atlassian.siteUrl) throw new LiveSyncFailure('Die Verknüpfung gehört zu einer anderen Atlassian-Site als das aktive Profil. Verknüpfe das Diagramm neu.');
      if (boundedString(input.documentId, 256, 'Diagramm-ID') !== link.documentId) throw new LiveSyncFailure('Die Verknüpfung gehört zu einem anderen Diagramm. Verknüpfe dieses Diagramm neu.');
      title = boundedString(input.title, 500, 'Dokumenttitel', true);
      if (!Array.isArray(input.images) || input.images.length < 1 || input.images.length > CONFLUENCE_LIVE_MAX_IMAGES) throw new LiveSyncFailure('Ungültige Confluence-Veröffentlichung.');
      const pageIds = new Set<string>();
      images = input.images.map((image) => {
        if (!image || typeof image !== 'object' || typeof image.pageId !== 'string' || !image.pageId || image.pageId.length > 256 || pageIds.has(image.pageId) || typeof image.name !== 'string' || image.name.length > 500
          || typeof image.hash !== 'string' || !/^[0-9a-f]{64}$/.test(image.hash) || !Number.isFinite(image.width) || !Number.isFinite(image.height) || image.width <= 0 || image.height <= 0
          || !(image.png instanceof Uint8Array) || image.png.byteLength > CONFLUENCE_LIVE_MAX_IMAGE_BYTES || !isPngImage(image.png)) throw new LiveSyncFailure('Ungültige Confluence-Veröffentlichung.');
        pageIds.add(image.pageId);
        return { pageId: image.pageId, name: image.name, hash: image.hash, width: image.width, height: image.height, png: image.png };
      });
      // The link of one page publishes that page and nothing else.
      if (diagramPageId !== undefined && (images.length !== 1 || images[0]!.pageId !== diagramPageId)) throw new LiveSyncFailure('Ungültige Confluence-Veröffentlichung.');
      job = { epoch, linkToken: link.token, profileId: this.activeProfileId, documentPath: link.documentPath, documentId: link.documentId, siteUrl: link.siteUrl, pageId: link.pageId, ...(diagramPageId !== undefined ? { diagramPageId } : {}) };
    } catch (error) {
      return done('failed', error instanceof Error ? error.message : 'Ungültige Confluence-Veröffentlichung.');
    }
    const run = this.liveQueue.then(() => this.runLivePublish(job, title, images));
    this.liveQueue = run.catch(() => undefined);
    return run;
  }

  private async liveReadPage(job: LiveJob): Promise<{ version: number; title: string; body: string }> {
    const page = await this.atlassian(`/wiki/api/v2/pages/${encodeURIComponent(job.pageId)}?body-format=storage`, {}, { guard: () => this.assertLiveJob(job) }) as Record<string, unknown>;
    const body = page.body as Record<string, unknown> | undefined; const storage = body?.storage as Record<string, unknown> | undefined;
    const version = Number((page.version as Record<string, unknown> | undefined)?.number);
    if (typeof storage?.value !== 'string' || !Number.isSafeInteger(version) || version < 1 || typeof page.title !== 'string' || !page.title) throw new LiveSyncRetry('Confluence hat die Seite unvollständig geliefert. Die Veröffentlichung wird wiederholt.');
    return { version, title: page.title, body: storage.value };
  }

  /** The digest a publication of this app left in a version comment; null for any other text. */
  private digestOf(...comments: unknown[]): string | null {
    for (const comment of comments) {
      const match = typeof comment === 'string' ? DIGEST_COMMENT.exec(comment.trim()) : null;
      if (match) return match[1]!;
    }
    return null;
  }

  /**
   * The attachment of this name on the linked page: its id, its current version and, if a publication of this app
   * wrote that version, the digest of the rendered content it was uploaded for.
   */
  private async liveFindAttachment(job: LiveJob, filename: string): Promise<{ id: string; version: number; digest: string | null } | null> {
    const response = await this.atlassian(`/wiki/api/v2/pages/${encodeURIComponent(job.pageId)}/attachments?filename=${encodeURIComponent(filename)}&limit=25`, {}, { guard: () => this.assertLiveJob(job) }) as { results?: Array<Record<string, unknown>> };
    const matches = (response.results ?? []).filter((entry) => entry.title === filename && (entry.status === undefined || entry.status === 'current'));
    if (matches.length === 0) return null;
    if (matches.length > 1) throw new LiveSyncFailure(`Auf der Confluence-Seite liegen mehrere Anhänge mit dem Namen „${filename}“. Sketchdraw kann nicht entscheiden, welcher gemeint ist, und ändert keinen davon.`);
    const attachment = matches[0]!;
    const versionInfo = attachment.version as Record<string, unknown> | undefined;
    const version = Number(versionInfo?.number);
    const id = typeof attachment.id === 'string' ? attachment.id : '';
    if (!/^[0-9A-Za-z_-]{1,64}$/.test(id) || !Number.isSafeInteger(version) || version < 1) throw new LiveSyncRetry('Confluence hat den Anhang unvollständig geliefert. Die Veröffentlichung wird wiederholt.');
    const digest = this.digestOf(attachment.comment, versionInfo?.message) ?? await this.liveAttachmentDigestV1(job, filename, id, version);
    return { id, version, digest };
  }

  /** The classic API is a second documented source for the comment of the current attachment version. */
  private async liveAttachmentDigestV1(job: LiveJob, filename: string, id: string, version: number): Promise<string | null> {
    let response: { results?: Array<Record<string, unknown>> };
    try {
      response = await this.atlassian(`/wiki/rest/api/content/${encodeURIComponent(job.pageId)}/child/attachment?filename=${encodeURIComponent(filename)}&expand=version&limit=25`, {}, { guard: () => this.assertLiveJob(job) }) as { results?: Array<Record<string, unknown>> };
    } catch (error) {
      // Without this source the content of the version stays unconfirmed, which is handled; other problems are real.
      if (error instanceof AtlassianHttpError && [400, 404, 405, 410, 501].includes(error.status)) return null;
      throw error;
    }
    const entry = (response.results ?? []).find((item) => item.title === filename && typeof item.id === 'string' && attachmentKey(item.id) === attachmentKey(id));
    const versionInfo = entry?.version as Record<string, unknown> | undefined;
    if (!entry || Number(versionInfo?.number) !== version) return null;
    return this.digestOf((entry.metadata as Record<string, unknown> | undefined)?.comment, versionInfo?.message, (entry.extensions as Record<string, unknown> | undefined)?.comment);
  }

  /**
   * Sends the image. Without an id a new attachment is created; that request fails if the name exists, so it can
   * never replace a file. With an id exactly that attachment gets new data. Confluence offers no "only if still
   * version N" for either: a version somebody adds between the check before and this request is not detected here.
   */
  private async liveUpload(job: LiveJob, filename: string, image: ConfluenceLivePublishInput['images'][number], attachmentId: string | null): Promise<{ id: string; version: number } | null> {
    const form = new FormData();
    form.append('file', new Blob([image.png as Uint8Array<ArrayBuffer>], { type: 'image/png' }), filename);
    form.append('minorEdit', 'true');
    // The content digest travels with the version; a later run recognises its own upload even if the answer got lost.
    form.append('comment', `Sketchdraw ${image.hash}`);
    const base = `/wiki/rest/api/content/${encodeURIComponent(job.pageId)}/child/attachment`;
    const target = attachmentId === null ? base : `${base}/${encodeURIComponent(/^\d+$/.test(attachmentId) ? `att${attachmentId}` : attachmentId)}/data`;
    const response = await this.atlassian(target, { method: 'POST', body: form, headers: { 'X-Atlassian-Token': 'nocheck' } }, { guard: () => this.assertLiveJob(job), multipart: true, timeoutMs: LIVE_UPLOAD_TIMEOUT_MS }) as Record<string, unknown>;
    const entry = Array.isArray(response.results) ? (response.results as Array<Record<string, unknown>>).find((item) => item.title === filename) : response;
    const version = Number((entry?.version as Record<string, unknown> | undefined)?.number);
    const id = typeof entry?.id === 'string' ? entry.id : '';
    return /^[0-9A-Za-z_-]{1,64}$/.test(id) && Number.isSafeInteger(version) && version >= 1 ? { id, version } : null;
  }

  private async runLivePublish(job: LiveJob, title: string, images: ConfluenceLivePublishInput['images']): Promise<ConfluenceLivePublishResult> {
    let uploaded = 0; let bodyUpdated = false;
    const stored = (): PersistedConfluenceLink | undefined => {
      const atlassian = this.profiles.find((profile) => profile.id === job.profileId)?.atlassian;
      return [...(atlassian?.confluenceLinks ?? []), ...(atlassian?.confluencePageLinks ?? [])].find((entry) => entry.token === job.linkToken);
    };
    /**
     * What is certain about the attachments, and which uploads are sent but unconfirmed; kept however the run ends.
     * Both are the stored state of the link plus what this run learned. Until the stored state has been taken over
     * (`started`), this run knows nothing and must write nothing: a job that is cancelled before it begins leaves
     * the record of earlier publications exactly as it is.
     */
    let published: Record<string, PublishedAttachment> = {};
    let pending: Record<string, PendingUpload> = {};
    let started = false;
    const remember = async (syncedAt?: string): Promise<void> => {
      if (!started) return;
      const entry = stored();
      if (!entry) return;
      if (syncedAt === undefined && JSON.stringify(entry.published ?? {}) === JSON.stringify(published) && JSON.stringify(entry.pending ?? {}) === JSON.stringify(pending)) return;
      await this.updateLiveLinks(job.profileId, (links) => links.map((link) => {
        if (link.token !== job.linkToken) return link;
        const { published: _published, pending: _pending, ...rest } = link;
        return { ...rest, ...(syncedAt ? { lastSyncedAt: syncedAt } : {}), ...(Object.keys(published).length ? { published } : {}), ...(Object.keys(pending).length ? { pending } : {}) };
      }));
    };
    try {
      this.assertLiveJob(job);
      const link = this.activeLinkByToken(job.linkToken)!;
      published = { ...(link.published ?? {}) }; pending = { ...(link.pending ?? {}) };
      started = true;
      const documentKey = sha256(job.documentId).slice(0, 12);
      // What this link owns on the Confluence page: every image of the diagram, or, for the link of one page, the
      // image of that page alone. Images of other pages of the same diagram are then somebody else's and stay.
      const prefix = job.diagramPageId === undefined ? confluenceLiveFilePrefix(documentKey) : confluenceLiveFilename(documentKey, sha256(job.diagramPageId).slice(0, 12));
      const before = await this.liveReadPage(job);
      const readAt = Date.now();

      // 1. What each attachment is right now, and whether this link may write it.
      const uploads: Array<{ filename: string; image: ConfluenceLivePublishInput['images'][number]; attachmentId: string | null; baseVersion: number }> = [];
      const managed: ManagedImage[] = [];
      for (const image of images) {
        const filename = confluenceLiveFilename(documentKey, sha256(image.pageId).slice(0, 12));
        managed.push({ filename, alt: (images.length > 1 || job.diagramPageId !== undefined) && title && image.name ? `${title} – ${image.name}` : title || image.name, width: Math.min(image.width, 1200) });
        const remote = await this.liveFindAttachment(job, filename);
        const sent = pending[filename];
        if (sent) {
          // An earlier upload whose answer never arrived. Only Confluence can say what became of it.
          const sameAttachment = remote !== null && (sent.attachmentId === null || attachmentKey(sent.attachmentId) === attachmentKey(remote.id));
          if (remote !== null && sameAttachment && remote.version > sent.baseVersion) {
            if (remote.digest === sent.hash) published[filename] = { id: remote.id, version: remote.version, hash: sent.hash };
            else if (remote.digest === null) throw new LiveSyncFailure(`Ein Upload von „${filename}“ wurde gesendet, aber Confluence bestätigt seinen Inhalt nicht. Damit keine doppelte Version entsteht, ist die Übertragung angehalten. Prüfe das Bild in Confluence; wenn du den Anhang dort löschst, legt Sketchdraw ihn neu an.`);
            // A version with another digest followed: judged below like every version this device did not write.
          }
          delete pending[filename];
        }
        const known = published[filename];
        if (remote === null) {
          // Nothing of anybody's is replaced by creating the file (again).
          delete published[filename];
          uploads.push({ filename, image, attachmentId: null, baseVersion: 0 });
        } else if (!known) {
          if (remote.digest === null) throw new LiveSyncFailure(`Auf der Confluence-Seite liegt bereits ein Anhang „${filename}“, der nicht von Sketchdraw stammt. Er wird nicht überschrieben. Benenne oder lösche ihn in Confluence; danach wird das Diagramm übertragen.`);
          // The current version was written by a publication of this diagram (another device, or before the link was made anew).
          if (remote.digest === image.hash) published[filename] = { id: remote.id, version: remote.version, hash: image.hash };
          else uploads.push({ filename, image, attachmentId: remote.id, baseVersion: remote.version });
        } else if (attachmentKey(known.id) !== attachmentKey(remote.id) || remote.version !== known.version) {
          // Not the version this device wrote last. Identical content needs nothing; anything else is not ours to replace.
          if (attachmentKey(known.id) === attachmentKey(remote.id) && remote.digest === image.hash) published[filename] = { id: remote.id, version: remote.version, hash: image.hash };
          else throw new LiveSyncFailure(`Der Anhang „${filename}“ wurde in Confluence von anderer Stelle geändert. Sketchdraw überschreibt ihn nicht. Prüfe ihn in Confluence; wenn das Diagramm ihn ersetzen soll, lösche ihn dort, er wird dann neu angelegt.`);
        } else if (known.hash !== image.hash) {
          uploads.push({ filename, image, attachmentId: known.id, baseVersion: known.version });
        }
      }

      // 2. The uploads. What is about to be sent is on disk first, so a lost answer is never mistaken for "not sent".
      if (uploads.length > 0) {
        for (const upload of uploads) pending[upload.filename] = { hash: upload.image.hash, baseVersion: upload.baseVersion, attachmentId: upload.attachmentId };
        try { await remember(); }
        catch { for (const upload of uploads) delete pending[upload.filename]; throw new LiveSyncFailure('Der Stand der Veröffentlichung konnte nicht im Profil gespeichert werden. Es wurde nichts übertragen.'); }
        this.assertLiveJob(job);
        for (const upload of uploads) {
          const result = await this.liveUpload(job, upload.filename, upload.image, upload.attachmentId);
          if (result === null) throw new LiveSyncRetry('Confluence hat das hochgeladene Diagramm nicht bestätigt. Die Veröffentlichung wird wiederholt.');
          uploaded++;
          published[upload.filename] = { id: result.id, version: result.version, hash: upload.image.hash };
          delete pending[upload.filename];
        }
      }

      // 3. The page text, only when it does not show exactly the pages of the diagram.
      const plan = planManagedImages(before.body, prefix, managed);
      if (plan.status === 'unsafe') throw new LiveSyncFailure('Der Inhalt der Confluence-Seite konnte nicht sicher gelesen werden. Die Seite wurde nicht geändert.');
      if (plan.status === 'changed') {
        if (Buffer.byteLength(plan.body, 'utf8') > MAX_REMOTE_BODY_BYTES) throw new LiveSyncFailure('Die Confluence-Seite ist zu groß, um den Diagrammabschnitt einzufügen.');
        const wait = this.liveQuietWindowMs - (Date.now() - readAt);
        if (wait > 0) await new Promise<void>((resolve) => { setTimeout(resolve, wait); });
        const fresh = await this.liveReadPage(job);
        // Version numbers alone do not show edits in a Live Doc; the text must be the one the change was planned on.
        if (fresh.version !== before.version || fresh.body !== before.body) throw new LiveSyncRetry('Die Confluence-Seite wird gerade bearbeitet. Das Diagramm wird eingefügt, sobald die Seite ruhig ist.');
        try {
          await this.atlassian(`/wiki/api/v2/pages/${encodeURIComponent(job.pageId)}`, { method: 'PUT', body: JSON.stringify({ id: job.pageId, status: 'current', title: fresh.title, body: { representation: 'storage', value: plan.body }, version: { number: fresh.version + 1, message: 'Sketchdraw: Diagramm aktualisiert' } }) }, { guard: () => this.assertLiveJob(job) });
        } catch (error) {
          if (error instanceof AtlassianHttpError && error.status === 409) throw new LiveSyncRetry('Die Confluence-Seite wurde gleichzeitig geändert. Die Veröffentlichung wird wiederholt.');
          throw error;
        }
        const after = await this.liveReadPage(job);
        const shown = managedImageFilenames(after.body, prefix);
        if (!shown || managed.some((image) => !shown.includes(image.filename))) throw new LiveSyncRetry('Confluence hat den Diagrammabschnitt nicht übernommen. Die Veröffentlichung wird wiederholt.');
        bodyUpdated = true;
      }

      this.assertLiveJob(job);
      // A check that found Confluence up to date writes nothing: the profile file only changes when something was published or learned.
      const current = stored();
      if (uploaded === 0 && !bodyUpdated && current?.lastSyncedAt && JSON.stringify(current.published ?? {}) === JSON.stringify(published) && JSON.stringify(current.pending ?? {}) === JSON.stringify(pending)) return { status: 'synced', message: 'Confluence ist auf dem aktuellen Stand.', uploaded, bodyUpdated, syncedAt: current.lastSyncedAt };
      const syncedAt = new Date().toISOString();
      // Remembering the result is a convenience; Confluence already confirmed the publication.
      await remember(syncedAt).catch(() => undefined);
      return { status: 'synced', message: uploaded > 0 || bodyUpdated ? 'Diagramm in Confluence aktualisiert.' : 'Confluence ist auf dem aktuellen Stand.', uploaded, bodyUpdated, syncedAt };
    } catch (error) {
      // Whatever stopped the run: confirmed uploads stay known, unconfirmed ones stay marked as sent.
      await remember().catch(() => undefined);
      const result = (status: ConfluenceLivePublishResult['status'], message: string, retryAt?: number): ConfluenceLivePublishResult => ({ status, message, uploaded, bodyUpdated, ...(retryAt !== undefined ? { retryAt: new Date(retryAt).toISOString() } : {}) });
      if (error instanceof AuthorityChanged) return result('cancelled', error.message);
      // A changed project or profile can also reach here as a plain error of the shared request path.
      try { this.assertLiveJob(job); } catch { return result('cancelled', new AuthorityChanged().message); }
      if (error instanceof LiveSyncRetry) return result('retry', error.message, error.retryAt);
      if (error instanceof LiveSyncFailure) return result('failed', error.message);
      if (error instanceof AtlassianCooldownError) return result('retry', 'Confluence hat um eine Pause gebeten. Die Veröffentlichung wird danach automatisch fortgesetzt.', error.retryAt);
      if (error instanceof AtlassianHttpError) {
        if (error.status === 401 || error.status === 403) return result('failed', 'Confluence verweigert den Zugriff. Prüfe das API-Token und die Rechte für die Seite.');
        if (error.status === 404) return result('failed', 'Die verknüpfte Confluence-Seite wurde nicht gefunden oder ist für dieses Konto nicht sichtbar.');
        if (error.retryAt !== undefined) return result('retry', 'Confluence hat um eine Pause gebeten. Die Veröffentlichung wird danach automatisch fortgesetzt.', error.retryAt);
        if (error.status === 409 || error.status === 429 || error.status >= 500) return result('retry', `Confluence ist gerade nicht bereit (Status ${error.status}). Die Veröffentlichung wird wiederholt.`);
        return result('failed', error.message);
      }
      if (error instanceof Error && error.message === 'Atlassian-Antwort ist zu groß.') return result('failed', error.message);
      // No answer at all: the request may or may not have arrived. The next run reads Confluence before it writes.
      return result('retry', 'Confluence ist nicht erreichbar. Die Veröffentlichung wird wiederholt, sobald die Verbindung steht.');
    }
  }

  private jiraIssue(value: Record<string, unknown>, storyPointsField?: string | null): JiraIssueSummary {
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
      ...this.jiraDetails(fields, storyPointsField),
    };
  }

  /** Labels, components and estimate of an issue; absent when the request did not ask for them (the task board list). */
  private jiraDetails(fields: Record<string, unknown>, storyPointsField: string | null | undefined): Pick<JiraIssueSummary, 'labels' | 'components' | 'estimate'> {
    if (storyPointsField === undefined) return {};
    const labels = Array.isArray(fields.labels) ? fields.labels.filter((label): label is string => typeof label === 'string') : [];
    const components = Array.isArray(fields.components) ? fields.components.flatMap((entry) => entry && typeof entry === 'object' && typeof (entry as { name?: unknown }).name === 'string' ? [(entry as { name: string }).name] : []) : [];
    const points = storyPointsField ? fields[storyPointsField] : undefined;
    const tracking = fields.timetracking && typeof fields.timetracking === 'object' ? (fields.timetracking as { originalEstimate?: unknown }).originalEstimate : undefined;
    const estimate = typeof points === 'number' ? String(points) : typeof tracking === 'string' && tracking ? tracking : undefined;
    return { labels, components, ...(estimate ? { estimate } : {}) };
  }

  /** The field a Jira site keeps story points in, looked up once per site; null when it has none. */
  private storyPoints: { siteUrl: string; field: string | null } | null = null;
  private async jiraStoryPointsField(): Promise<string | null> {
    const siteUrl = this.config.atlassian.siteUrl;
    if (this.storyPoints?.siteUrl === siteUrl) return this.storyPoints.field;
    let field: string | null = null;
    try {
      const fields = await this.atlassian('/rest/api/3/field') as Array<{ id?: unknown; name?: unknown; custom?: unknown }>;
      const names = ['story points', 'story point estimate'];
      const found = Array.isArray(fields) ? names.map((name) => fields.find((entry) => entry.custom === true && typeof entry.name === 'string' && entry.name.toLowerCase() === name)).find(Boolean) : undefined;
      if (found && typeof found.id === 'string' && /^customfield_\d+$/.test(found.id)) field = found.id;
    } catch (error) { if (!(error instanceof AtlassianHttpError)) throw error; }
    if (this.config.atlassian.siteUrl === siteUrl) this.storyPoints = { siteUrl, field };
    return field;
  }
  private async jiraIssueDetails(key: string): Promise<JiraIssueSummary> {
    const storyPointsField = await this.jiraStoryPointsField();
    const fields = ['summary', 'description', 'status', 'assignee', 'duedate', 'updated', 'labels', 'components', 'timetracking', ...(storyPointsField ? [storyPointsField] : [])];
    const issue = await this.atlassian(`/rest/api/3/issue/${encodeURIComponent(boundedString(key, 128, 'Jira-Key'))}?fields=${fields.join(',')}`) as Record<string, unknown>;
    return this.jiraIssue(issue, storyPointsField);
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
    this.assertDocumentProject(); this.assertJira();
    const fields: Record<string, unknown> = {
      project: { key: boundedString(this.config.atlassian.jiraProjectKey, 128, 'Jira-Projekt') },
      issuetype: { name: this.config.atlassian.jiraIssueType },
      summary: boundedString(input.title, 255, 'Jira-Titel'),
      description: descriptionAdf(boundedMultilineText(input.description, 50_000, 'Jira-Beschreibung')),
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
    this.assertDocumentProject(); this.assertJira();
    const project = boundedString(this.config.atlassian.jiraProjectKey, 128, 'Jira-Projekt'); const configuredFilter = boundedString(this.config.atlassian.jqlFilter, 2000, 'Jira-Filter', true); const baseFilter = configuredFilter || `project = "${project.replaceAll('"', '')}"`; const jql = /\border\s+by\b/i.test(baseFilter) ? baseFilter : `${baseFilter} ORDER BY updated DESC`;
    const response = await this.atlassian('/rest/api/3/search/jql', { method: 'POST', body: JSON.stringify({ jql, maxResults: 100, fields: ['summary', 'description', 'status', 'assignee', 'duedate', 'updated'] }) }) as { issues?: Array<Record<string, unknown>> }; return (response.issues ?? []).map((issue) => this.jiraIssue(issue));
  }

  public async updateJiraIssue(input: UpdateJiraIssueInput): Promise<JiraIssueSummary> {
    this.assertDocumentProject(); this.assertJira();
    const key = boundedString(input.key, 128, 'Jira-Key');
    if (input.assignee !== undefined) {
      const accountId = input.assignee === null || !input.assignee.trim() ? null : await this.jiraAssigneeAccountId(input.assignee, key);
      await this.atlassian(`/rest/api/3/issue/${encodeURIComponent(key)}/assignee`, { method: 'PUT', body: JSON.stringify({ accountId }) });
    }
    // Summary, description and due date are fields of the issue and travel in one request (#270).
    const fields: Record<string, unknown> = {};
    if (input.title !== undefined) fields.summary = boundedString(input.title, 255, 'Jira-Titel');
    if (input.description !== undefined) fields.description = descriptionAdf(boundedMultilineText(input.description, 50_000, 'Jira-Beschreibung'));
    if (input.dueDate !== undefined) fields.duedate = input.dueDate === null || input.dueDate === '' ? null : jiraDueDate(input.dueDate);
    if (Object.keys(fields).length) await this.atlassian(`/rest/api/3/issue/${encodeURIComponent(key)}`, { method: 'PUT', body: JSON.stringify({ fields }) });
    return this.getJiraIssue(key);
  }

  public async transitionJiraIssue(input: { key: string; status: TaskStatus }): Promise<JiraIssueSummary> {
    this.assertDocumentProject(); this.assertJira();
    const key = boundedString(input.key, 128, 'Jira-Key'); const desired: Record<TaskStatus, string[]> = { todo: ['to do', 'open', 'offen'], doing: ['in progress', 'doing', 'in arbeit'], review: ['review', 'in review', 'prüfung'], done: ['done', 'closed', 'resolved', 'erledigt'] };
    const response = await this.atlassian(`/rest/api/3/issue/${encodeURIComponent(key)}/transitions`) as { transitions?: Array<{ id?: string; name?: string; to?: { name?: string } }> }; const transition = (response.transitions ?? []).find((item) => desired[input.status].some((name) => `${item.name ?? ''} ${item.to?.name ?? ''}`.toLocaleLowerCase('en').includes(name)));
    if (!transition?.id) throw new Error('Für diesen Jira-Workflow wurde kein passender Statusübergang gefunden.'); await this.atlassian(`/rest/api/3/issue/${encodeURIComponent(key)}/transitions`, { method: 'POST', body: JSON.stringify({ transition: { id: transition.id } }) }); return this.getJiraIssue(key);
  }

  // --- Ticket cards (#283): one ticket with all its fields, whichever system it lives in ---------------------------

  private ticketProvider(value: unknown): TicketProvider {
    if (value !== 'jira' && value !== 'azure-devops') throw new Error('Unbekanntes Ticket-System.');
    return value;
  }
  private ticketList(value: unknown, name: string): string[] {
    if (!Array.isArray(value) || value.length > 50) throw new Error(`${name} ist ungültig.`);
    return [...new Set(value.map((entry) => boundedString(entry, 255, name)))];
  }

  public async getWorkItem(input: { provider: TicketProvider; key: string }): Promise<WorkItemSummary> {
    if (!input || typeof input !== 'object') throw new Error('Ungültiges Ticket.');
    const provider = this.ticketProvider(input.provider);
    if (provider === 'azure-devops') { const key = boundedString(input.key, 12, 'Work-Item-Nummer'); return this.azure(false, (connection) => getAzureWorkItem(connection, key)); }
    this.assertDocumentProject(); this.assertJira();
    return { provider, ...await this.jiraIssueDetails(input.key) };
  }

  public async searchWorkItems(input: { provider: TicketProvider; query: string }): Promise<WorkItemSummary[]> {
    if (!input || typeof input !== 'object') throw new Error('Ungültige Suche.');
    const provider = this.ticketProvider(input.provider);
    const query = boundedString(input.query ?? '', 200, 'Suchtext', true);
    if (!query) return [];
    if (provider === 'azure-devops') return this.azure(false, (connection) => searchAzureWorkItems(connection, query));
    this.assertDocumentProject(); this.assertJira();
    const quoted = (text: string) => `"${text.replace(/[\\"]/g, ' ')}"`;
    const project = boundedString(this.config.atlassian.jiraProjectKey, 128, 'Jira-Projekt');
    const jql = /^[A-Za-z][A-Za-z0-9_]*-\d+$/.test(query) ? `key = ${quoted(query.toUpperCase())}` : `project = ${quoted(project)} AND summary ~ ${quoted(`${query}*`)} ORDER BY updated DESC`;
    const response = await this.atlassian('/rest/api/3/search/jql', { method: 'POST', body: JSON.stringify({ jql, maxResults: 20, fields: ['summary', 'description', 'status', 'assignee', 'duedate', 'updated'] }) }) as { issues?: Array<Record<string, unknown>> };
    return (response.issues ?? []).map((issue) => ({ provider, ...this.jiraIssue(issue) }));
  }

  public async updateWorkItemFields(input: UpdateWorkItemFieldsInput): Promise<WorkItemSummary> {
    if (!input || typeof input !== 'object') throw new Error('Ungültiges Ticket.');
    const provider = this.ticketProvider(input.provider);
    if (input.status !== undefined && !['todo', 'doing', 'review', 'done'].includes(input.status)) throw new Error('Ungültiger Status.');
    const labels = input.labels === undefined ? undefined : this.ticketList(input.labels, 'Labels');
    const components = input.components === undefined ? undefined : this.ticketList(input.components, 'Komponenten');
    const estimate = input.estimate === undefined ? undefined : input.estimate === null ? null : boundedString(input.estimate, 40, 'Schätzung', true);
    const basics = { ...(input.title !== undefined ? { title: input.title } : {}), ...(input.description !== undefined ? { description: input.description } : {}), ...(input.assignee !== undefined ? { assignee: input.assignee } : {}) };
    const hasBasics = Object.keys(basics).length > 0;
    if (provider === 'azure-devops') {
      const key = boundedString(input.key, 12, 'Work-Item-Nummer');
      // Spaces inside a tag are fine; a semicolon would split it into two.
      if (labels?.some((label) => label.includes(';'))) throw new Error('Ein Label darf in Azure DevOps kein Semikolon enthalten.');
      if (hasBasics) await this.updateAzureWorkItem({ key, ...basics });
      if (labels !== undefined || components !== undefined || estimate !== undefined) await this.azure(true, (connection) => updateAzureWorkItemDetails(connection, key, { ...(labels !== undefined ? { labels } : {}), ...(components !== undefined ? { components } : {}), ...(estimate !== undefined ? { estimate } : {}) }));
      if (input.status !== undefined) await this.transitionAzureWorkItem({ key, status: input.status });
      return this.azure(false, (connection) => getAzureWorkItem(connection, key));
    }
    this.assertDocumentProject(); this.assertJira();
    const key = boundedString(input.key, 128, 'Jira-Key');
    if (labels?.some((label) => /\s/.test(label))) throw new Error('Ein Jira-Label darf keine Leerzeichen enthalten.');
    if (hasBasics) await this.updateJiraIssue({ key, ...basics });
    const fields: Record<string, unknown> = {};
    if (labels !== undefined) fields.labels = labels;
    if (components !== undefined) fields.components = components.map((name) => ({ name }));
    if (estimate !== undefined) {
      const storyPointsField = await this.jiraStoryPointsField();
      const text = (estimate ?? '').trim().replace(',', '.');
      const points = text === '' ? null : Number(text);
      // A number is story points where the site has such a field; anything else is a time estimate like "3h".
      if (storyPointsField && (points === null || Number.isFinite(points))) fields[storyPointsField] = points;
      else fields.timetracking = { originalEstimate: text };
    }
    if (Object.keys(fields).length) await this.atlassian(`/rest/api/3/issue/${encodeURIComponent(key)}`, { method: 'PUT', body: JSON.stringify({ fields }) });
    if (input.status !== undefined) await this.transitionJiraIssue({ key, status: input.status });
    return { provider, ...await this.jiraIssueDetails(key) };
  }

  public dispose(): void { this.disposed = true; this.revokeAuthority(); this.clearWatchers(); }

  private clearWatchers(): void { for (const watcher of this.watchers.values()) watcher.close(); for (const timer of this.watcherTimers.values()) clearTimeout(timer); for (const timer of this.pullTimers.values()) clearInterval(timer); this.watchers.clear(); this.watcherTimers.clear(); this.pullTimers.clear(); }
}

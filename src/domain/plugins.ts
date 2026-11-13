import type { FileReference, TaskStatus } from './types';

export type PluginHealth = 'disabled' | 'ready' | 'attention' | 'error';
export type PluginId = 'git' | 'jira';
export type GitAuthMode = 'system' | 'token';

export interface GitPluginSettings {
  installed: boolean;
  enabled: boolean;
  folderPath: string;
  autoCommit: boolean;
  autoPush: boolean;
  autoPull: boolean;
  remote: string;
  remoteUrl: string;
  authMode: GitAuthMode;
  username: string;
  credentialStored: boolean;
  health: PluginHealth;
  message: string;
  repositoryName?: string;
  branch?: string;
  changedFiles?: number;
  ahead?: number;
  behind?: number;
}

export interface AtlassianPluginSettings {
  installed: boolean;
  enabled: boolean;
  siteUrl: string;
  email: string;
  confluenceSpaceKey: string;
  jiraProjectKey: string;
  jiraIssueType: string;
  jqlFilter: string;
  credentialStored: boolean;
  health: PluginHealth;
  message: string;
}

/** A named set of plugin settings of the editor. Diagrams never store plugin configuration (#168). */
export interface PluginProfileSummary {
  id: string;
  name: string;
}

export const PLUGIN_PROFILE_LIMIT = 12;
export const PLUGIN_PROFILE_NAME_MAX = 40;

/** Loading problems never authorize replacing an existing configuration file (#161). */
export interface PluginConfigurationIssue {
  source: 'profiles' | 'legacy';
  kind: 'read-error' | 'invalid-json' | 'unsupported-version' | 'invalid-data' | 'external-change';
  message: string;
  blocksChanges: boolean;
}

export interface PluginSettingsSnapshot {
  available: boolean;
  /** Folder of the open local diagram; Git works there. Empty for unsaved, imported and guest diagrams. */
  projectFolder: string;
  profiles: PluginProfileSummary[];
  /** `git` and `atlassian` below are the settings of this profile. */
  activeProfileId: string;
  configurationIssue?: PluginConfigurationIssue;
  git: GitPluginSettings;
  atlassian: AtlassianPluginSettings;
}

export interface ConfigureGitPluginInput {
  enabled: boolean;
  autoCommit: boolean;
  autoPush: boolean;
  autoPull: boolean;
  remote: string;
  remoteUrl: string;
  authMode: GitAuthMode;
  username: string;
  accessToken?: string;
  clearCredential?: boolean;
}

export interface ConfigureAtlassianPluginInput {
  enabled: boolean;
  siteUrl: string;
  email: string;
  apiToken?: string;
  clearCredential?: boolean;
  confluenceSpaceKey: string;
  jiraProjectKey: string;
  jiraIssueType: string;
  jqlFilter: string;
}

export interface PluginOperationResult {
  ok: boolean;
  message: string;
}

export interface GitSyncResult extends PluginOperationResult {
  settings: GitPluginSettings;
}

export interface ConfluencePageSummary {
  id: string;
  title: string;
  version: number;
  url: string;
}

export interface ConfluencePage extends ConfluencePageSummary {
  storageBody: string;
}

export interface JiraIssueSummary {
  id: string;
  key: string;
  title: string;
  description: string;
  status: TaskStatus;
  remoteStatus: string;
  url: string;
  updatedAt: string;
}

export type PluginExternalEvent = {
  type: 'document-changed';
  text: string;
  file: FileReference;
};

export interface PluginBridge {
  /** Switches the editor to another profile; its plugin settings apply at once. */
  selectProfile(id: string): Promise<PluginSettingsSnapshot>;
  /** Creates a profile, empty or as a copy of `copyFrom` including its stored tokens, and switches to it. */
  createProfile(input: { name: string; copyFrom?: string }): Promise<PluginSettingsSnapshot>;
  renameProfile(input: { id: string; name: string }): Promise<PluginSettingsSnapshot>;
  /** The last remaining profile cannot be deleted. */
  deleteProfile(id: string): Promise<PluginSettingsSnapshot>;
  /** A handle selects the current local project; null releases it. Omission only reads the snapshot. */
  getSettings(handleId?: string | null): Promise<PluginSettingsSnapshot>;
  /** Run autosync only after the renderer accepted a save in its current local document. */
  afterDocumentSaved?(handleId: string): Promise<void>;
  installPlugin(id: PluginId): Promise<PluginSettingsSnapshot>;
  uninstallPlugin(id: PluginId): Promise<PluginSettingsSnapshot>;
  configureGit(input: ConfigureGitPluginInput): Promise<PluginSettingsSnapshot>;
  configureAtlassian(input: ConfigureAtlassianPluginInput): Promise<PluginSettingsSnapshot>;
  testAtlassian(): Promise<PluginOperationResult>;
  gitStatus(handleId: string): Promise<GitSyncResult>;
  gitSync(handleId: string): Promise<GitSyncResult>;
  listConfluencePages(query: string): Promise<ConfluencePageSummary[]>;
  getConfluencePage(pageId: string): Promise<ConfluencePage>;
  updateConfluencePage(input: { pageId: string; title: string; storageBody: string; version: number }): Promise<ConfluencePage>;
  createJiraIssue(input: { title: string; description: string }): Promise<JiraIssueSummary>;
  listJiraIssues(): Promise<JiraIssueSummary[]>;
  transitionJiraIssue(input: { key: string; status: TaskStatus }): Promise<JiraIssueSummary>;
  watchDocument(handleId: string): Promise<PluginOperationResult>;
  onEvent(listener: (event: PluginExternalEvent) => void): () => void;
}

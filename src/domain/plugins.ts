import type { FileReference, TaskStatus } from './types';

export type PluginHealth = 'disabled' | 'ready' | 'attention' | 'error';

export interface GitPluginSettings {
  enabled: boolean;
  autoCommit: boolean;
  autoPush: boolean;
  autoPull: boolean;
  remote: string;
  health: PluginHealth;
  message: string;
  repositoryName?: string;
  branch?: string;
  changedFiles?: number;
  ahead?: number;
  behind?: number;
}

export interface AtlassianPluginSettings {
  enabled: boolean;
  siteUrl: string;
  email: string;
  confluenceSpaceKey: string;
  jiraProjectKey: string;
  jiraIssueType: string;
  credentialStored: boolean;
  health: PluginHealth;
  message: string;
}

export interface PluginSettingsSnapshot {
  available: boolean;
  git: GitPluginSettings;
  atlassian: AtlassianPluginSettings;
}

export interface ConfigureGitPluginInput {
  enabled: boolean;
  autoCommit: boolean;
  autoPush: boolean;
  autoPull: boolean;
  remote: string;
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
  getSettings(): Promise<PluginSettingsSnapshot>;
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

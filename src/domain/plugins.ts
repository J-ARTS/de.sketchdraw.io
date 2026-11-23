import type { GitWorkbenchBridge } from './git-workbench';
import type { FileReference, TaskStatus } from './types';

export * from './git-workbench';

export type PluginHealth = 'disabled' | 'ready' | 'attention' | 'error';
export type PluginId = 'git' | 'jira' | 'confluence' | 'azure-devops';
/** The systems a task can have its ticket in. */
export type TicketProvider = 'jira' | 'azure-devops';
/** Their names as the interface shows them; product names read the same in every language. */
export const TICKET_PROVIDER_NAME: Readonly<Record<TicketProvider, string>> = { jira: 'Jira', 'azure-devops': 'Azure DevOps' };
export type GitAuthMode = 'system' | 'token';

export interface GitPluginSettings {
  installed: boolean;
  enabled: boolean;
  /** When these settings were last saved, ISO 8601. */
  savedAt?: string;
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
  /** When the settings of the Jira plugin and of the Confluence plugin were last saved, ISO 8601. */
  jiraSavedAt?: string;
  confluenceSavedAt?: string;
  /** The result of the last connection test of each plugin, until the settings change. */
  jiraMessage?: string;
  confluenceMessage?: string;
  /** Whether Jira or Confluence is installed, and whether one of them is installed and switched on. */
  installed: boolean;
  enabled: boolean;
  /**
   * Jira and Confluence are two plugins that share this Atlassian connection (#282). `…Enabled` already includes
   * "installed". A snapshot from before the split has none of the four; read them through `jiraPluginActive` and
   * its siblings, which then fall back to `installed` and `enabled`.
   */
  jiraInstalled?: boolean;
  jiraEnabled?: boolean;
  confluenceInstalled?: boolean;
  confluenceEnabled?: boolean;
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

/** Azure Boards (#284): Azure DevOps Services in the cloud or an Azure DevOps Server, with a personal access token. */
export interface AzureDevOpsPluginSettings {
  installed: boolean;
  enabled: boolean;
  /** When these settings were last saved, ISO 8601. */
  savedAt?: string;
  variant: 'cloud' | 'server';
  /** Address of the organization (cloud) or of the collection (server). */
  organizationUrl: string;
  project: string;
  /** The type new work items get, for example "Task" or "User Story". */
  workItemType: string;
  /** A WIQL query that names the work items of the task board; empty reads the newest of the project. */
  wiqlFilter: string;
  /** Version of the REST interface. Servers know older versions than the cloud. */
  apiVersion: string;
  /** Work items are read and never created or changed. */
  readOnly: boolean;
  credentialStored: boolean;
  /** The links of pages of the open local diagram to pages of the Azure DevOps wiki (#284). */
  wikiPageLinks?: WikiPageLiveLink[];
  health: PluginHealth;
  message: string;
}

/**
 * The live link of the open local diagram to one Confluence page (#210). It belongs to the active profile on this
 * device and names the diagram file, the diagram and the Atlassian site it was made for. Diagrams never carry it,
 * so a diagram received from somebody else cannot start a transmission.
 */
export interface ConfluenceLiveLink {
  pageId: string;
  pageTitle: string;
  pageUrl: string;
  /** The Atlassian site the link was made for. */
  siteUrl: string;
  /** The diagram the link was made for; another diagram stored under the same file name is never published. */
  documentId: string;
  /** False while the profile points to another Atlassian site than the link; nothing is transmitted then. */
  usable: boolean;
  /** Time of the last publication that Confluence confirmed. */
  lastSyncedAt?: string;
}

/** The live link of one page of the open local diagram to a Confluence page (#240). */
export interface ConfluencePageLiveLink extends ConfluenceLiveLink {
  /** The page of the diagram whose image the Confluence page shows. */
  diagramPageId: string;
}

/** The wikis a page of a diagram can be shown in (#281): Confluence and the wiki of Azure DevOps. */
export type WikiProviderId = 'confluence' | 'azure-devops';
export const WIKI_PROVIDER_NAME: Readonly<Record<WikiProviderId, string>> = { confluence: 'Confluence', 'azure-devops': 'Azure DevOps Wiki' };
/** A page of a wiki as a target for a link. `id` names it for its provider; for Azure DevOps it is wiki and path. */
export interface WikiPageSummary {
  provider: WikiProviderId;
  id: string;
  title: string;
  /** Where the page lies, for telling pages of the same title apart: the wiki and path, or the version. */
  detail: string;
  url: string;
}
/**
 * The live link of one page of the open local diagram to a wiki page, whichever wiki it is. A page of a diagram has
 * at most one such link. `siteUrl` is the Atlassian site or the address of the Azure DevOps organization.
 */
export interface WikiPageLiveLink extends ConfluencePageLiveLink { provider: WikiProviderId }
/**
 * What a wiki does for a diagram (#281), independent of the provider: find pages, link one page of the diagram to
 * a wiki page, and show that page there as an image that follows every change (#240). Confluence and the wiki of
 * Azure DevOps are the two implementations; the bridge names their calls per provider.
 */
export interface WikiProvider {
  readonly id: WikiProviderId;
  readonly name: string;
  searchPages(query: string): Promise<WikiPageSummary[]>;
  /** Links the page of the diagram to the wiki page, or removes the link with `null`. */
  setLink(input: { handleId: string; documentId: string; diagramPageId: string; diagramPageIds: string[]; pageId: string | null }): Promise<PluginSettingsSnapshot>;
  publish(input: ConfluenceLivePublishInput & { diagramPageId: string }): Promise<ConfluenceLivePublishResult>;
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
  /** Absent in a snapshot of a version that does not know the plugin. */
  azureDevOps?: AzureDevOpsPluginSettings;
  /**
   * Link of the whole open diagram, as versions before #240 made it; absent without one. The app turns it into links
   * per page (`convertConfluenceLiveLink`) and never publishes through it itself.
   */
  confluenceLive?: ConfluenceLiveLink;
  /** Live links of single pages of the open local diagram under the active profile (#240). */
  confluencePageLinks?: ConfluencePageLiveLink[];
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
  /** The plugin this call configures: its switch and its own fields. Without it the call applies to both, as before the split. */
  plugin?: 'jira' | 'confluence';
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

export interface ConfigureAzureDevOpsPluginInput {
  enabled: boolean;
  variant: 'cloud' | 'server';
  organizationUrl: string;
  project: string;
  workItemType: string;
  wiqlFilter: string;
  /** Empty takes the usual version of the variant. */
  apiVersion?: string;
  readOnly: boolean;
  accessToken?: string;
  clearCredential?: boolean;
}

/** Installed and switched on. */
export const azureDevOpsPluginActive = (azure: Pick<AzureDevOpsPluginSettings, 'installed' | 'enabled'> | null | undefined): boolean => Boolean(azure && azure.installed && azure.enabled);

type AtlassianState = Pick<AtlassianPluginSettings, 'installed' | 'enabled' | 'jiraInstalled' | 'jiraEnabled' | 'confluenceInstalled' | 'confluenceEnabled'> | null | undefined;
export const jiraPluginInstalled = (atlassian: AtlassianState): boolean => Boolean(atlassian && (atlassian.jiraInstalled ?? atlassian.installed));
export const confluencePluginInstalled = (atlassian: AtlassianState): boolean => Boolean(atlassian && (atlassian.confluenceInstalled ?? atlassian.installed));
/** Installed and switched on. */
export const jiraPluginActive = (atlassian: AtlassianState): boolean => Boolean(atlassian && (atlassian.jiraEnabled ?? (atlassian.installed && atlassian.enabled)));
export const confluencePluginActive = (atlassian: AtlassianState): boolean => Boolean(atlassian && (atlassian.confluenceEnabled ?? (atlassian.installed && atlassian.enabled)));

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
  /** Digest of `storageBody`. Sending back requires that the page still has exactly this content. */
  bodyHash?: string;
}

/** One diagram page as a rendered image. `hash` identifies the rendered content, independent of the device. */
export interface ConfluenceLiveImage {
  pageId: string;
  name: string;
  /** SHA-256 (hex) of the rendered source. */
  hash: string;
  /** Size of the diagram in CSS pixels. */
  width: number;
  height: number;
  png: Uint8Array;
}

export interface ConfluenceLivePublishInput {
  handleId: string;
  documentId: string;
  title: string;
  /**
   * The diagram page whose link publishes (#240); `images` is then exactly the image of that page. Without it the
   * link of the whole diagram publishes, and `images` is every page in page order.
   */
  diagramPageId?: string;
  images: ConfluenceLiveImage[];
}

/**
 * `synced`: Confluence confirmed every step. `retry`: nothing is lost, a later attempt can succeed (network, rate
 * limit, the page is being edited). `failed`: needs the user (access, missing page, foreign diagram).
 * `cancelled`: the diagram, profile or site changed while the publication was running.
 */
export interface ConfluenceLivePublishResult {
  status: 'synced' | 'retry' | 'failed' | 'cancelled';
  message: string;
  /** Images that received a new attachment version. */
  uploaded: number;
  /** Whether the page text itself was changed (only to add or remove images of the diagram). */
  bodyUpdated: boolean;
  syncedAt?: string;
  /** With `retry`: the server asked for a pause (Retry-After); no attempt reaches it before this moment. */
  retryAt?: string;
}

export interface JiraIssueSummary {
  id: string;
  key: string;
  title: string;
  description: string;
  status: TaskStatus;
  remoteStatus: string;
  assignee?: string;
  dueDate?: string;
  url: string;
  updatedAt: string;
  /** Read for a single ticket (ticket cards, #283); lists for the task board leave them out. */
  labels?: string[];
  /** Jira components; in Azure Boards the area path. */
  components?: string[];
  /** Story points, effort or a time estimate, as the tracker shows it. */
  estimate?: string;
  /** The type of the ticket as the tracker names it: "Bug", "Story", "User Story", "Epic" … */
  issueType?: string;
  /** Jira fix versions; in Azure Boards the iteration path. */
  fixVersions?: string[];
}

/** A person a ticket can be assigned to, as the search of the tracker names them. */
export interface WorkItemUser {
  name: string;
  /** What tells two people of the same name apart, usually the e-mail address. */
  detail?: string;
}

/** What a ticket card can change in its ticket: the seven fields the owner named (#283). */
export interface UpdateWorkItemFieldsInput {
  provider: TicketProvider;
  key: string;
  title?: string;
  description?: string;
  status?: TaskStatus;
  assignee?: string | null;
  labels?: string[];
  components?: string[];
  estimate?: string | null;
  /** The type of the ticket, by the name the tracker gives it. */
  issueType?: string;
  /** Jira fix versions; in Azure Boards the iteration path (one). */
  fixVersions?: string[];
}

/** The fields of a ticket whose values the tracker suggests while they are typed. */
export type WorkItemValueField = 'issueType' | 'labels' | 'components' | 'fixVersions';

/**
 * A ticket as the task board shows it, whichever system it comes from (#281): the fields are the ones of a
 * Jira issue, and `provider` names the system.
 */
export interface WorkItemSummary extends JiraIssueSummary {
  provider: TicketProvider;
}

export interface CreateWorkItemInput {
  title: string;
  description: string;
  assignee?: string;
  dueDate?: string;
}

export interface UpdateWorkItemInput {
  key: string;
  title?: string;
  description?: string;
  assignee?: string | null;
  dueDate?: string | null;
}

/** What a system of tickets offers the task board. Jira and Azure Boards each provide it in the main process. */
export interface WorkItemProvider {
  list(): Promise<WorkItemSummary[]>;
  create(input: CreateWorkItemInput): Promise<WorkItemSummary>;
  update(input: UpdateWorkItemInput): Promise<WorkItemSummary>;
  transition(input: { key: string; status: TaskStatus }): Promise<WorkItemSummary>;
}

export interface CreateJiraIssueInput {
  title: string;
  description: string;
  assignee?: string;
  dueDate?: string;
}

export interface UpdateJiraIssueInput {
  key: string;
  /** The summary of the issue; left out when the title did not change. */
  title?: string;
  /** The description as plain text; it replaces the description in Jira, so it is only sent when it changed. */
  description?: string;
  assignee?: string | null;
  dueDate?: string | null;
}

export type PluginExternalEvent = {
  type: 'document-changed';
  text: string;
  file: FileReference;
};

export interface PluginBridge extends GitWorkbenchBridge {
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
  /** The stored token of a plugin of the active profile; empty when none is stored. Asked for by the settings alone. */
  revealCredential?(plugin: PluginId): Promise<string>;
  /** Tests the Atlassian connection: of one plugin when it is named, of both otherwise. */
  testAtlassian(plugin?: 'jira' | 'confluence'): Promise<PluginOperationResult>;
  gitStatus(handleId: string): Promise<GitSyncResult>;
  gitSync(handleId: string): Promise<GitSyncResult>;
  listConfluencePages(query: string): Promise<ConfluencePageSummary[]>;
  getConfluencePage(pageId: string): Promise<ConfluencePage>;
  /** Replaces the page text. `expectedBodyHash` is the digest of the content the text was loaded from; without it nothing is written. */
  updateConfluencePage(input: { pageId: string; title: string; storageBody: string; version: number; expectedBodyHash: string }): Promise<ConfluencePage>;
  /**
   * Links one page of the open local diagram (`diagramPageId`) to a Confluence page, or removes that link with
   * `pageId: null`. `diagramPageIds` names every page of the diagram: with them, a link of the whole diagram from an
   * earlier version becomes one link per page before the change applies. Without `diagramPageId` the call addresses
   * that earlier link of the whole diagram.
   */
  setConfluenceLiveLink?(input: { handleId: string; documentId: string; pageId: string | null; diagramPageId?: string; diagramPageIds?: string[] }): Promise<PluginSettingsSnapshot>;
  /** Turns a link of the whole diagram from an earlier version into one link per page to the same Confluence page. */
  convertConfluenceLiveLink?(input: { handleId: string; documentId: string; diagramPageIds: string[] }): Promise<PluginSettingsSnapshot>;
  /** Publishes the rendered pages of the linked diagram. Runs one after another; never throws for remote problems. */
  publishConfluenceLive?(input: ConfluenceLivePublishInput): Promise<ConfluenceLivePublishResult>;
  /** The wiki of Azure DevOps (#284): the same three steps as for Confluence. `wikiPage` is the `id` of a found page. */
  listAzureWikiPages?(query: string): Promise<WikiPageSummary[]>;
  setAzureWikiLiveLink?(input: { handleId: string; documentId: string; diagramPageId: string; wikiPage: string | null }): Promise<PluginSettingsSnapshot>;
  publishAzureWikiLive?(input: ConfluenceLivePublishInput): Promise<ConfluenceLivePublishResult>;
  createJiraIssue(input: CreateJiraIssueInput): Promise<JiraIssueSummary>;
  listJiraIssues(): Promise<JiraIssueSummary[]>;
  updateJiraIssue(input: UpdateJiraIssueInput): Promise<JiraIssueSummary>;
  transitionJiraIssue(input: { key: string; status: TaskStatus }): Promise<JiraIssueSummary>;
  /** Azure Boards (#284). Absent in a desktop version that does not know the plugin. */
  configureAzureDevOps?(input: ConfigureAzureDevOpsPluginInput): Promise<PluginSettingsSnapshot>;
  testAzureDevOps?(): Promise<PluginOperationResult>;
  listAzureWorkItems?(): Promise<WorkItemSummary[]>;
  createAzureWorkItem?(input: CreateWorkItemInput): Promise<WorkItemSummary>;
  updateAzureWorkItem?(input: UpdateWorkItemInput): Promise<WorkItemSummary>;
  transitionAzureWorkItem?(input: { key: string; status: TaskStatus }): Promise<WorkItemSummary>;
  /** One ticket with all fields of a ticket card, by its key (Jira) or number (Azure Boards). */
  getWorkItem?(input: { provider: TicketProvider; key: string }): Promise<WorkItemSummary>;
  /** Tickets whose title contains the text, or the ticket with that key; at most 20. */
  searchWorkItems?(input: { provider: TicketProvider; query: string }): Promise<WorkItemSummary[]>;
  /** The values the tracker knows for a field of a ticket that match `query`: types, labels, components, versions. */
  searchWorkItemValues?(input: { provider: TicketProvider; key: string; field: WorkItemValueField; query: string }): Promise<string[]>;
  /** The people of the tracker a ticket can be assigned to whose name or address matches `query`. */
  searchWorkItemUsers?(input: { provider: TicketProvider; key: string; query: string }): Promise<WorkItemUser[]>;
  /** Writes the changed fields of a ticket card and answers with the ticket as it is afterwards. */
  updateWorkItemFields?(input: UpdateWorkItemFieldsInput): Promise<WorkItemSummary>;
  watchDocument(handleId: string): Promise<PluginOperationResult>;
  onEvent(listener: (event: PluginExternalEvent) => void): () => void;
}

/** Every wiki link of the pages of the open diagram, whichever wiki it leads to. */
export function wikiPageLinks(settings: Pick<PluginSettingsSnapshot, 'confluencePageLinks' | 'azureDevOps'> | null | undefined): WikiPageLiveLink[] {
  return [...(settings?.confluencePageLinks ?? []).map((link): WikiPageLiveLink => ({ ...link, provider: 'confluence' })), ...(settings?.azureDevOps?.wikiPageLinks ?? [])];
}
/** The `id` of an Azure DevOps wiki page as found pages and links carry it: the wiki, a line break, the path. */
export const azureWikiPageId = (wiki: string, pagePath: string): string => `${wiki}\n${pagePath}`;
export function parseAzureWikiPageId(id: string): { wiki: string; path: string } | null {
  const at = id.indexOf('\n');
  return at > 0 && at < id.length - 1 ? { wiki: id.slice(0, at), path: id.slice(at + 1) } : null;
}

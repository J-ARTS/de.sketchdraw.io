import {
  contextBridge,
  ipcRenderer,
  type IpcRendererEvent,
} from 'electron';
import { createAgentAccessPreload } from './agent-access/preload';
import type {
  DesktopBridge,
  ExportFileResult,
  OpenDocumentResult,
  SaveDocumentRequest,
  SaveDocumentResult,
} from '../src/domain/types';
import type {
  ConfigureAtlassianPluginInput,
  ConfigureGitPluginInput,
  ConfluencePage,
  ConfluencePageSummary,
  GitSyncResult,
  JiraIssueSummary,
  PluginExternalEvent,
  PluginOperationResult,
  PluginSettingsSnapshot,
} from '../src/domain/plugins';
import {
  type CloseDecision,
  type ExportFormat,
  IPC_CHANNELS,
  isMenuCommand,
  isValidCloseRequestId,
  type MenuCommand,
  validateExportFileRequest,
  validateExternalHttpUrl,
  validateRespondToCloseRequest,
  validateSaveDocumentRequest,
} from './ipc-contract';

const USER_ACTIVATION_WINDOW_MS = 2_500;

export interface IpcRendererAdapter {
  invoke(channel: string, ...args: unknown[]): Promise<unknown>;
  on(
    channel: string,
    listener: (event: IpcRendererEvent, ...args: unknown[]) => void,
  ): void;
  removeListener(
    channel: string,
    listener: (event: IpcRendererEvent, ...args: unknown[]) => void,
  ): void;
}

export interface PreloadBridgeOptions {
  ipc?: IpcRendererAdapter;
  isUserActivationActive?: () => boolean;
}

let lastTrustedUserGestureTimestamp = -Infinity;

function installTrustedGestureTracker(): void {
  if (typeof window === 'undefined' || typeof window.addEventListener !== 'function') {
    return;
  }

  const recordTrustedEvent = (event: Event): void => {
    if (event.isTrusted) {
      lastTrustedUserGestureTimestamp = Date.now();
    }
  };

  const eventNames = [
    'pointerdown',
    'pointerup',
    'click',
    'auxclick',
    'keydown',
  ] as const;

  for (const eventName of eventNames) {
    window.addEventListener(eventName, recordTrustedEvent, {
      capture: true,
      passive: true,
    });
  }
}

export function hasRecentTrustedUserGesture(now = Date.now()): boolean {
  if (
    typeof navigator !== 'undefined' &&
    'userActivation' in navigator &&
    navigator.userActivation?.isActive === true
  ) {
    return true;
  }

  return now - lastTrustedUserGestureTimestamp <= USER_ACTIVATION_WINDOW_MS;
}

export function createPreloadDesktopBridge(
  options: PreloadBridgeOptions = {},
): DesktopBridge {
  const ipc: IpcRendererAdapter = options.ipc ?? ipcRenderer;
  const checkUserActivation =
    options.isUserActivationActive ?? (() => hasRecentTrustedUserGesture());
  const pluginInvoke = <T>(action: string, payload?: unknown): Promise<T> => ipc.invoke(IPC_CHANNELS.PLUGIN_INVOKE, { action, payload }) as Promise<T>;

  const bridge: DesktopBridge = {
    platform: 'electron',

    async openDocument(): Promise<OpenDocumentResult> {
      const result = await ipc.invoke(IPC_CHANNELS.OPEN_DOCUMENT);
      return result as OpenDocumentResult;
    },

    async saveDocument(
      request: SaveDocumentRequest,
    ): Promise<SaveDocumentResult> {
      const validated = validateSaveDocumentRequest(request);
      if (!validated.ok) {
        return validated.error;
      }
      const result = await ipc.invoke(
        IPC_CHANNELS.SAVE_DOCUMENT,
        validated.value,
      );
      return result as SaveDocumentResult;
    },

    async exportFile(
      contents: string,
      suggestedName: string,
      format: ExportFormat,
    ): Promise<ExportFileResult> {
      const validated = validateExportFileRequest({
        contents,
        suggestedName,
        format,
      });
      if (!validated.ok) {
        return validated.error;
      }
      const result = await ipc.invoke(
        IPC_CHANNELS.EXPORT_FILE,
        validated.value,
      );
      return result as ExportFileResult;
    },

    async openExternal(url: string): Promise<void> {
      const validatedUrl = validateExternalHttpUrl(url);
      const userInitiated = checkUserActivation();
      if (!userInitiated) {
        throw new Error(
          'External links can only be opened directly from a human UI interaction.',
        );
      }
      await ipc.invoke(IPC_CHANNELS.OPEN_EXTERNAL, {
        url: validatedUrl.toString(),
        userInitiated: true,
      });
    },

    onCloseRequested(listener: (requestId: string) => void): () => void {
      if (typeof listener !== 'function') {
        throw new Error('onCloseRequested requires a listener function.');
      }

      const wrapped = (_event: IpcRendererEvent, rawRequestId: unknown): void => {
        if (isValidCloseRequestId(rawRequestId)) {
          listener(rawRequestId);
        }
      };

      ipc.on(IPC_CHANNELS.CLOSE_REQUESTED, wrapped);
      return () => {
        ipc.removeListener(IPC_CHANNELS.CLOSE_REQUESTED, wrapped);
      };
    },

    async respondToClose(
      requestId: string,
      decision: CloseDecision,
    ): Promise<void> {
      const payload = validateRespondToCloseRequest({ requestId, decision });
      await ipc.invoke(IPC_CHANNELS.RESPOND_TO_CLOSE, payload);
    },

    onMenuCommand(listener: (command: MenuCommand) => void): () => void {
      if (typeof listener !== 'function') {
        throw new Error('onMenuCommand requires a listener function.');
      }

      const wrapped = (_event: IpcRendererEvent, rawCommand: unknown): void => {
        if (isMenuCommand(rawCommand)) {
          listener(rawCommand);
        }
      };

      ipc.on(IPC_CHANNELS.MENU_COMMAND, wrapped);
      return () => {
        ipc.removeListener(IPC_CHANNELS.MENU_COMMAND, wrapped);
      };
    },

    plugins: Object.freeze({
      getSettings: () => pluginInvoke<PluginSettingsSnapshot>('get-settings'),
      configureGit: (input: ConfigureGitPluginInput) => pluginInvoke<PluginSettingsSnapshot>('configure-git', input),
      configureAtlassian: (input: ConfigureAtlassianPluginInput) => pluginInvoke<PluginSettingsSnapshot>('configure-atlassian', input),
      testAtlassian: () => pluginInvoke<PluginOperationResult>('test-atlassian'),
      gitStatus: (handleId: string) => pluginInvoke<GitSyncResult>('git-status', handleId),
      gitSync: (handleId: string) => pluginInvoke<GitSyncResult>('git-sync', handleId),
      listConfluencePages: (query: string) => pluginInvoke<ConfluencePageSummary[]>('list-confluence-pages', query),
      getConfluencePage: (pageId: string) => pluginInvoke<ConfluencePage>('get-confluence-page', pageId),
      updateConfluencePage: (input: { pageId: string; title: string; storageBody: string; version: number }) => pluginInvoke<ConfluencePage>('update-confluence-page', input),
      createJiraIssue: (input: { title: string; description: string }) => pluginInvoke<JiraIssueSummary>('create-jira-issue', input),
      listJiraIssues: () => pluginInvoke<JiraIssueSummary[]>('list-jira-issues'),
      transitionJiraIssue: (input: { key: string; status: import('../src/domain/types').TaskStatus }) => pluginInvoke<JiraIssueSummary>('transition-jira-issue', input),
      watchDocument: (handleId: string) => pluginInvoke<PluginOperationResult>('watch-document', handleId),
      onEvent(listener: (event: PluginExternalEvent) => void): () => void {
        if (typeof listener !== 'function') throw new Error('onEvent requires a listener function.');
        const wrapped = (_event: IpcRendererEvent, value: unknown): void => {
          if (value && typeof value === 'object' && (value as { type?: unknown }).type === 'document-changed') listener(value as PluginExternalEvent);
        };
        ipc.on(IPC_CHANNELS.PLUGIN_EVENT, wrapped);
        return () => ipc.removeListener(IPC_CHANNELS.PLUGIN_EVENT, wrapped);
      },
    }),
  };

  return Object.freeze(bridge);
}

installTrustedGestureTracker();

if (
  typeof contextBridge !== 'undefined' &&
  contextBridge !== null &&
  typeof contextBridge.exposeInMainWorld === 'function' &&
  typeof process !== 'undefined' &&
  Boolean(process.versions?.electron)
) {
  contextBridge.exposeInMainWorld('sketchdraw', createPreloadDesktopBridge());
  contextBridge.exposeInMainWorld('sketchdrawAgentAccess', createAgentAccessPreload());
}

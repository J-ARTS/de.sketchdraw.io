import path from 'node:path';
import {
  app,
  BrowserWindow,
  dialog,
  ipcMain,
  Menu,
  type MenuItemConstructorOptions,
  protocol,
  safeStorage,
  session,
  shell,
} from 'electron';
import type {
  ExportFileResult,
  OpenDocumentResult,
  SaveDocumentResult,
} from '../src/domain/types';
import { CloseHandshakeCoordinator } from './close-handshake';
import { installElectronAgentBridge } from './agent-access/electron-bridge';
import {
  IPC_CHANNELS,
  type MenuCommand,
  validateOpenExternalRequest,
} from './ipc-contract';
import { DocumentPersistenceService } from './persistence';
import { PluginService } from './plugin-service';
import {
  APP_SCHEME,
  buildContentSecurityPolicy,
  type IpcSecurityContext,
  type IpcSenderEventLike,
  isAllowedNavigationUrl,
  isTrustedRendererResourceUrl,
  PRIVILEGED_APP_SCHEME_CONFIG,
  type RendererTarget,
  resolveRendererTarget,
  serveAppProtocolRequest,
  validateExternalUrl,
  validateIpcSender,
  WINDOW_DIMENSIONS,
} from './security';

protocol.registerSchemesAsPrivileged([
  {
    scheme: PRIVILEGED_APP_SCHEME_CONFIG.scheme,
    privileges: { ...PRIVILEGED_APP_SCHEME_CONFIG.privileges },
  },
]);

let mainWindow: BrowserWindow | null = null;
let closeCoordinator: CloseHandshakeCoordinator | null = null;
let activeTarget: RendererTarget | null = null;

function getDistRootDir(): string {
  return path.resolve(__dirname, '../dist');
}

function getPreloadScriptPath(): string {
  return path.join(__dirname, 'preload.cjs');
}

function getCurrentSecurityContext(): IpcSecurityContext {
  const target =
    activeTarget ??
    resolveRendererTarget({
      isPackaged: app.isPackaged,
      env: process.env,
    });

  if (!mainWindow || mainWindow.isDestroyed()) {
    return {
      windowWebContentsId: null,
      mainFrameRoutingId: null,
      isWindowDestroyed: true,
      allowedOrigin: target.allowedOrigin,
    };
  }

  const contents = mainWindow.webContents;
  if (contents.isDestroyed()) {
    return {
      windowWebContentsId: null,
      mainFrameRoutingId: null,
      isWindowDestroyed: true,
      allowedOrigin: target.allowedOrigin,
    };
  }

  return {
    windowWebContentsId: contents.id,
    mainFrameRoutingId: contents.mainFrame?.routingId ?? null,
    isWindowDestroyed: false,
    allowedOrigin: target.allowedOrigin,
  };
}

function dispatchMenuCommand(command: MenuCommand): void {
  if (!mainWindow || mainWindow.isDestroyed()) {
    return;
  }
  const contents = mainWindow.webContents;
  if (contents.isDestroyed()) {
    return;
  }
  contents.send(IPC_CHANNELS.MENU_COMMAND, command);
}

function buildApplicationMenu(): Menu {
  const isMac = process.platform === 'darwin';
  const template: MenuItemConstructorOptions[] = [];

  if (isMac) {
    template.push({
      label: app.name,
      submenu: [
        { role: 'about' },
        { type: 'separator' },
        { role: 'hide' },
        { role: 'hideOthers' },
        { role: 'unhide' },
        { type: 'separator' },
        { role: 'quit' },
      ],
    });
  }

  template.push(
    {
      label: 'Datei',
      submenu: [
        {
          id: 'file-open',
          label: 'Öffnen…',
          accelerator: 'CmdOrCtrl+O',
          click: () => dispatchMenuCommand('open'),
        },
        {
          id: 'file-save',
          label: 'Speichern',
          accelerator: 'CmdOrCtrl+S',
          click: () => dispatchMenuCommand('save'),
        },
        {
          id: 'file-save-as',
          label: 'Speichern unter…',
          accelerator: 'CmdOrCtrl+Shift+S',
          click: () => dispatchMenuCommand('save-as'),
        },
        { type: 'separator' },
        isMac ? { role: 'close' } : { role: 'quit' },
      ],
    },
    {
      label: 'Bearbeiten',
      submenu: [
        {
          id: 'edit-undo',
          label: 'Rückgängig',
          accelerator: 'CmdOrCtrl+Z',
          click: () => dispatchMenuCommand('undo'),
        },
        {
          id: 'edit-redo',
          label: 'Wiederholen',
          accelerator: isMac ? 'Cmd+Shift+Z' : 'Ctrl+Y',
          click: () => dispatchMenuCommand('redo'),
        },
        { type: 'separator' },
        { role: 'cut' },
        { role: 'copy' },
        { role: 'paste' },
        { role: 'selectAll' },
      ],
    },
    {
      label: 'Ansicht',
      submenu: [
        { role: 'resetZoom' },
        { role: 'zoomIn' },
        { role: 'zoomOut' },
        { type: 'separator' },
        { role: 'togglefullscreen' },
      ],
    },
  );

  return Menu.buildFromTemplate(template);
}

function configureDefaultSessionSecurity(target: RendererTarget): void {
  const defaultSession = session.defaultSession;

  defaultSession.setPermissionRequestHandler((_webContents, _permission, callback) => {
    callback(false);
  });

  defaultSession.setPermissionCheckHandler(() => false);
  defaultSession.setDevicePermissionHandler(() => false);

  const cspHeader = buildContentSecurityPolicy(target.mode);

  defaultSession.webRequest.onHeadersReceived((details, callback) => {
    if (!isTrustedRendererResourceUrl(details.url, target)) {
      callback({ responseHeaders: details.responseHeaders });
      return;
    }
    const responseHeaders: Record<string, string | string[]> = {
      ...(details.responseHeaders ?? {}),
      'Content-Security-Policy': [cspHeader],
      'X-Content-Type-Options': ['nosniff'],
      'Referrer-Policy': ['no-referrer'],
    };
    callback({ responseHeaders });
  });
}

function registerIpcHandlers(persistence: DocumentPersistenceService, plugins: PluginService): void {
  ipcMain.handle(
    IPC_CHANNELS.OPEN_DOCUMENT,
    async (event): Promise<OpenDocumentResult> => {
      const check = validateIpcSender(
        event as unknown as IpcSenderEventLike,
        getCurrentSecurityContext(),
      );
      if (!check.ok) {
        return {
          status: 'error',
          code: 'UNAUTHORIZED_SENDER',
          message: check.reason,
        };
      }
      return persistence.openDocument();
    },
  );

  ipcMain.handle(
    IPC_CHANNELS.SAVE_DOCUMENT,
    async (event, rawPayload: unknown): Promise<SaveDocumentResult> => {
      const check = validateIpcSender(
        event as unknown as IpcSenderEventLike,
        getCurrentSecurityContext(),
      );
      if (!check.ok) {
        return {
          status: 'error',
          code: 'UNAUTHORIZED_SENDER',
          message: check.reason,
        };
      }
      const result = await persistence.saveDocument(rawPayload);
      if (result.status === 'saved') void plugins.afterDocumentSaved(result.file.handleId);
      return result;
    },
  );

  ipcMain.handle(
    IPC_CHANNELS.EXPORT_FILE,
    async (event, rawPayload: unknown): Promise<ExportFileResult> => {
      const check = validateIpcSender(
        event as unknown as IpcSenderEventLike,
        getCurrentSecurityContext(),
      );
      if (!check.ok) {
        return {
          status: 'error',
          code: 'UNAUTHORIZED_SENDER',
          message: check.reason,
        };
      }
      return persistence.exportFile(rawPayload);
    },
  );

  ipcMain.handle(
    IPC_CHANNELS.OPEN_EXTERNAL,
    async (event, rawPayload: unknown): Promise<void> => {
      const check = validateIpcSender(
        event as unknown as IpcSenderEventLike,
        getCurrentSecurityContext(),
      );
      if (!check.ok) {
        throw new Error(check.reason);
      }

      const { url, userInitiated } = validateOpenExternalRequest(rawPayload);
      if (!userInitiated) {
        throw new Error(
          'External URL opening requires an explicit human-initiated UI gesture.',
        );
      }

      const validatedUrl = validateExternalUrl(url);
      await shell.openExternal(validatedUrl.toString());
    },
  );

  ipcMain.handle(
    IPC_CHANNELS.RESPOND_TO_CLOSE,
    async (event, rawPayload: unknown): Promise<void> => {
      const check = validateIpcSender(
        event as unknown as IpcSenderEventLike,
        getCurrentSecurityContext(),
      );
      if (!check.ok) {
        throw new Error(check.reason);
      }
      if (!closeCoordinator) {
        throw new Error('Close handshake coordinator is not initialized.');
      }
      closeCoordinator.handleRendererResponse(rawPayload);
    },
  );

  ipcMain.handle(IPC_CHANNELS.PLUGIN_INVOKE, async (event, rawPayload: unknown): Promise<unknown> => {
    const check = validateIpcSender(event as unknown as IpcSenderEventLike, getCurrentSecurityContext());
    if (!check.ok) throw new Error(check.reason);
    if (!rawPayload || typeof rawPayload !== 'object' || Array.isArray(rawPayload)) throw new Error('Ungültige Plugin-Anfrage.');
    const request = rawPayload as { action?: unknown; payload?: unknown };
    const payload = request.payload as never;
    switch (request.action) {
      case 'get-settings': return plugins.getSettings();
      case 'configure-git': return plugins.configureGit(payload);
      case 'configure-atlassian': return plugins.configureAtlassian(payload);
      case 'test-atlassian': return plugins.testAtlassian();
      case 'git-status': return plugins.gitStatus(String(request.payload ?? ''));
      case 'git-sync': return plugins.gitSync(String(request.payload ?? ''));
      case 'watch-document': return plugins.watchDocument(String(request.payload ?? ''));
      case 'list-confluence-pages': return plugins.listConfluencePages(String(request.payload ?? ''));
      case 'get-confluence-page': return plugins.getConfluencePage(String(request.payload ?? ''));
      case 'update-confluence-page': return plugins.updateConfluencePage(payload);
      case 'create-jira-issue': return plugins.createJiraIssue(payload);
      case 'list-jira-issues': return plugins.listJiraIssues();
      case 'transition-jira-issue': return plugins.transitionJiraIssue(payload);
      default: throw new Error('Unbekannte Plugin-Aktion.');
    }
  });
}

async function createMainWindow(target: RendererTarget): Promise<BrowserWindow> {
  const win = new BrowserWindow({
    width: WINDOW_DIMENSIONS.width,
    height: WINDOW_DIMENSIONS.height,
    minWidth: WINDOW_DIMENSIONS.minWidth,
    minHeight: WINDOW_DIMENSIONS.minHeight,
    title: 'Sketchdraw',
    show: true,
    webPreferences: {
      preload: getPreloadScriptPath(),
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
      nodeIntegrationInWorker: false,
      nodeIntegrationInSubFrames: false,
      webSecurity: true,
      allowRunningInsecureContent: false,
      webviewTag: false,
      spellcheck: false,
    },
  });

  const coordinator = new CloseHandshakeCoordinator({
    sendCloseRequested: (requestId) => {
      if (!win.isDestroyed() && !win.webContents.isDestroyed()) {
        win.webContents.send(IPC_CHANNELS.CLOSE_REQUESTED, requestId);
      }
    },
    closeWindow: () => {
      if (!win.isDestroyed()) {
        win.close();
      }
    },
  });

  closeCoordinator = coordinator;

  win.on('close', (event) => {
    coordinator.onWindowCloseEvent(event);
  });

  win.on('closed', () => {
    if (mainWindow === win) {
      mainWindow = null;
      closeCoordinator = null;
    }
  });

  mainWindow = win;
  installElectronAgentBridge(win, getCurrentSecurityContext);
  await win.loadURL(target.entryUrl);
  return win;
}

app.on('web-contents-created', (_event, contents) => {
  contents.on('will-attach-webview', (event) => {
    event.preventDefault();
  });

  contents.on('will-navigate', (event, navigationUrl) => {
    const allowedOrigin = activeTarget?.allowedOrigin ?? '';
    if (!isAllowedNavigationUrl(navigationUrl, allowedOrigin)) {
      event.preventDefault();
    }
  });

  contents.on('will-redirect', (event, redirectUrl) => {
    const allowedOrigin = activeTarget?.allowedOrigin ?? '';
    if (!isAllowedNavigationUrl(redirectUrl, allowedOrigin)) {
      event.preventDefault();
    }
  });

  contents.setWindowOpenHandler(() => ({ action: 'deny' }));
});

void app
  .whenReady()
  .then(async () => {
    const target = resolveRendererTarget({
      isPackaged: app.isPackaged,
      env: process.env,
    });
    activeTarget = target;

    configureDefaultSessionSecurity(target);

    const distRootDir = getDistRootDir();
    protocol.handle(APP_SCHEME, (request) =>
      serveAppProtocolRequest(
        { url: request.url, method: request.method },
        distRootDir,
      ),
    );

    const persistence = new DocumentPersistenceService({
      dialogs: {
        showOpenDialog: async ({ title, filters }) => {
          if (mainWindow && !mainWindow.isDestroyed()) {
            return dialog.showOpenDialog(mainWindow, {
              title,
              filters,
              properties: ['openFile'],
            });
          }
          return dialog.showOpenDialog({
            title,
            filters,
            properties: ['openFile'],
          });
        },
        showSaveDialog: async ({ title, defaultPath, filters }) => {
          if (mainWindow && !mainWindow.isDestroyed()) {
            return dialog.showSaveDialog(mainWindow, {
              title,
              defaultPath,
              filters,
              properties: ['createDirectory', 'showOverwriteConfirmation'],
            });
          }
          return dialog.showSaveDialog({
            title,
            defaultPath,
            filters,
            properties: ['createDirectory', 'showOverwriteConfirmation'],
          });
        },
      },
    });

    const plugins = new PluginService({
      configPath: path.join(app.getPath('userData'), 'plugins.json'),
      persistence,
      credentials: {
        available: () => safeStorage.isEncryptionAvailable(),
        encrypt: (value) => safeStorage.encryptString(value).toString('base64'),
        decrypt: (value) => safeStorage.decryptString(Buffer.from(value, 'base64')),
      },
      emitEvent: (event) => {
        if (mainWindow && !mainWindow.isDestroyed() && !mainWindow.webContents.isDestroyed()) mainWindow.webContents.send(IPC_CHANNELS.PLUGIN_EVENT, event);
      },
    });
    app.once('before-quit', () => plugins.dispose());
    registerIpcHandlers(persistence, plugins);
    Menu.setApplicationMenu(buildApplicationMenu());

    await createMainWindow(target);

    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0 && activeTarget) {
        void createMainWindow(activeTarget);
      }
    });
  })
  .catch((error: unknown) => {
    console.error('[electron:main] Startup failed:', error);
    app.exit(1);
  });

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

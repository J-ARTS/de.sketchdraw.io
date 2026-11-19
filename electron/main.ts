import { existsSync } from 'node:fs';
import path from 'node:path';
import {
  app,
  BrowserWindow,
  dialog,
  ipcMain,
  Menu,
  net,
  protocol,
  safeStorage,
  session,
  shell,
} from 'electron';
import { buildAppMenuTemplate } from './app-menu';
import { APP_BUNDLE_ID, APP_COPYRIGHT, APP_DISPLAY_NAME, APP_WEBSITE } from './branding';
import { nativeText, setNativeLanguage } from './i18n';
import { createPlatformInstaller } from './update-installers';
import { RELEASE_PAGE_URL, UpdateService } from './update-service';
import { createUpdatePrompts } from './update-dialogs';
import type { UpdateStatus } from '../src/domain/updates';
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
  validateDirectRequest,
  validateOpenExternalRequest,
  validateSetLanguageRequest,
  validateUpdateRequest,
} from './ipc-contract';
import { DirectService } from './direct-service';
import { PeerRelayHelper } from './peer-relay-service';
import { APP_LINK_SCHEME, findAppLink, parseAppLink } from '../src/collaboration/hdht/app-link';
import { serviceAdTopic, sessionAdTopic } from '../relay/hub.mjs';
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

// Keep WebRTC candidate handling inside Chromium's privacy-aware network stack.
// Trystero signaling also runs in the renderer so WSS follows the system proxy,
// PAC configuration and supported operating-system proxy authentication.
app.commandLine.appendSwitch('enable-features', 'WebRtcHideLocalIpsWithMdns');

let updateService: UpdateService | null = null;
let mainWindow: BrowserWindow | null = null;
let pluginService: PluginService | null = null;
let closeCoordinator: CloseHandshakeCoordinator | null = null;
let activeTarget: RendererTarget | null = null;
let directService: DirectService | null = null;
let relayHelper: PeerRelayHelper | null = null;
/** A validated session link fragment the app was opened with, kept until the renderer takes it. */
let pendingInviteLink: string | null = null;

function focusMainWindow(): void {
  const win = mainWindow;
  if (!win || win.isDestroyed()) return;
  if (win.isMinimized()) win.restore();
  win.show();
  win.focus();
}

/** Accepts only a strictly validated `sketchdraw://join#sketchdraw-hdht=…` link; the PIN is never part of it. */
function deliverInviteLink(fragment: string | null): void {
  if (!fragment) return;
  pendingInviteLink = fragment;
  const win = mainWindow;
  if (win && !win.isDestroyed() && !win.webContents.isDestroyed()) {
    focusMainWindow();
    win.webContents.send(IPC_CHANNELS.INVITE_LINK_EVENT);
  } else if (app.isReady() && activeTarget) {
    void createMainWindow(activeTarget);
  }
}

// macOS hands a link to the running app through this event, possibly before the app is ready.
app.on('open-url', (event, url) => {
  event.preventDefault();
  deliverInviteLink(parseAppLink(url));
});
// Windows and Linux start a process with the link as an argument. The app keeps allowing several instances, so a link
// opens its own window there and the document of a running instance stays untouched.
deliverInviteLink(findAppLink(process.argv));

function sendDirectEvent(event: unknown): void {
  if (mainWindow && !mainWindow.isDestroyed() && !mainWindow.webContents.isDestroyed()) mainWindow.webContents.send(IPC_CHANNELS.DIRECT_EVENT, event);
}

/**
 * Plugin work (Git watching, Jira, Confluence publication) is done on behalf of the page in the window. When that
 * page goes away (reload or navigation, crash, closed window) everything running or queued for it ends, also while
 * the app process itself lives on without a window (macOS). A new page starts again by naming its diagram (#210).
 */
function releasePluginRenderer(): void {
  pluginService?.releaseRenderer();
}

/** Ends every native direct connection and the DHT nodes of this window (close, reload, crash, quit). */
function disposeDirectService(): void {
  const service = directService;
  directService = null;
  if (service) void service.dispose().catch(() => undefined);
  // The volunteer relay ends with the window as well; it is never restarted implicitly.
  const helper = relayHelper;
  relayHelper = null;
  if (helper) void helper.stop().catch(() => undefined);
}

function getDistRootDir(): string {
  return path.resolve(__dirname, '../dist');
}

function getPreloadScriptPath(): string {
  return path.join(__dirname, 'preload.cjs');
}

/** The app icon as a file. It ships with the renderer build; a development start without a build falls back to the source in public/. */
function findAppIconPath(): string | undefined {
  return [path.join(getDistRootDir(), 'app-icon.png'), path.resolve(__dirname, '../public/app-icon.png')].find((file) => existsSync(file));
}

/** Window and taskbar icon on Windows and Linux (#171); macOS takes the icon of the app bundle. */
function getWindowIconPath(): string | undefined {
  return process.platform === 'darwin' ? undefined : findAppIconPath();
}

/**
 * Name, version and icon the operating system shows for the app (#236). `app.name` is the package name, and a start
 * from the sources runs inside the Electron bundle; without this the About dialog and the Dock would show those.
 */
function applyBranding(): void {
  const icon = findAppIconPath();
  app.setAboutPanelOptions({
    applicationName: APP_DISPLAY_NAME,
    applicationVersion: app.getVersion(),
    copyright: APP_COPYRIGHT,
    ...(process.platform === 'darwin' ? {} : { website: APP_WEBSITE, ...(icon ? { iconPath: icon } : {}) }),
  });
  if (process.platform === 'darwin' && !app.isPackaged && icon) app.dock?.setIcon(icon);
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
  return Menu.buildFromTemplate(buildAppMenuTemplate({
    platform: process.platform,
    text: nativeText,
    onCommand: dispatchMenuCommand,
    ...(updateService?.status().supported ? { onCheckForUpdates: () => { void updatePrompts.checkFromMenu(); } } : {}),
  }));
}

function sendUpdateStatus(status: UpdateStatus): void {
  if (!mainWindow || mainWindow.isDestroyed() || mainWindow.webContents.isDestroyed()) return;
  mainWindow.setProgressBar(status.phase === 'downloading' ? status.progress ?? 0 : -1);
  mainWindow.webContents.send(IPC_CHANNELS.UPDATE_EVENT, status);
}

function showMessage(options: Electron.MessageBoxOptions): Promise<Electron.MessageBoxReturnValue> {
  return mainWindow && !mainWindow.isDestroyed() ? dialog.showMessageBox(mainWindow, options) : dialog.showMessageBox(options);
}

const updatePrompts = createUpdatePrompts({
  service: () => updateService,
  showMessage,
  openReleasePage: () => { void shell.openExternal(RELEASE_PAGE_URL); },
  text: nativeText,
});

function createUpdateService(): UpdateService {
  const userData = app.getPath('userData');
  const failureMarker = path.join(userData, 'update-failed');
  return new UpdateService({
    currentVersion: app.getVersion(),
    platform: process.platform,
    arch: process.arch,
    packaged: app.isPackaged,
    settingsPath: path.join(userData, 'updates.json'),
    downloadDir: path.join(userData, 'pending-update'),
    failureMarker,
    // Electron's network stack follows the proxy settings of the system.
    fetch: (url, init) => net.fetch(url, { ...init, redirect: 'follow', cache: 'no-store' }),
    installer: createPlatformInstaller({ platform: process.platform, execPath: process.execPath, pid: process.pid, tmpDir: app.getPath('temp'), failureMarker, bundleId: APP_BUNDLE_ID }),
    emit: sendUpdateStatus,
    quit: (plan) => {
      if (plan.onQuit) app.once('will-quit', plan.onQuit);
      if (plan.relaunch) app.relaunch();
      app.quit();
    },
  });
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
      const result = await persistence.openDocument();
      // The renderer selects the project only after accepting and parsing this document.
      return result;
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
      // Autosync is requested by the renderer after accepting a local document save.
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
    IPC_CHANNELS.SET_LANGUAGE,
    async (event, rawPayload: unknown): Promise<void> => {
      const check = validateIpcSender(
        event as unknown as IpcSenderEventLike,
        getCurrentSecurityContext(),
      );
      if (!check.ok) {
        throw new Error(check.reason);
      }
      setNativeLanguage(validateSetLanguageRequest(rawPayload));
      Menu.setApplicationMenu(buildApplicationMenu());
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

  ipcMain.handle(IPC_CHANNELS.UPDATE_INVOKE, async (event, rawPayload: unknown): Promise<UpdateStatus | undefined> => {
    const check = validateIpcSender(event as unknown as IpcSenderEventLike, getCurrentSecurityContext());
    if (!check.ok) throw new Error(check.reason);
    const request = validateUpdateRequest(rawPayload);
    const service = updateService;
    if (!service) throw new Error('The update service is not initialized.');
    switch (request.action) {
      case 'status': return service.status();
      case 'check': return service.check();
      case 'install': return service.install();
      case 'set-auto-check': return service.setAutoCheck(request.enabled);
      case 'open-release-page': await shell.openExternal(RELEASE_PAGE_URL); return undefined;
    }
  });

  ipcMain.handle(IPC_CHANNELS.INVITE_LINK_TAKE, async (event): Promise<string | null> => {
    const check = validateIpcSender(event as unknown as IpcSenderEventLike, getCurrentSecurityContext());
    if (!check.ok) throw new Error(check.reason);
    const link = pendingInviteLink;
    pendingInviteLink = null;
    return link;
  });

  ipcMain.handle(IPC_CHANNELS.DIRECT_INVOKE, async (event, rawPayload: unknown): Promise<unknown> => {
    const check = validateIpcSender(event as unknown as IpcSenderEventLike, getCurrentSecurityContext());
    if (!check.ok) throw new Error(check.reason);
    const request = validateDirectRequest(rawPayload);
    const service = directService ??= new DirectService({ emit: sendDirectEvent });
    switch (request.action) {
      case 'host-start': return service.hostStart();
      case 'host-stop': await service.hostStop(); return undefined;
      case 'connect': service.connect(request.hostPublicKey, request.channelId); return undefined;
      case 'send': await service.send(request.channelId, request.data); return undefined;
      case 'close': service.close(request.channelId); return undefined;
      case 'discover': {
        const topic = request.kind === 'service' ? serviceAdTopic() : sessionAdTopic(request.topic);
        const own = relayHelper?.keyHex;
        return (await service.lookup(topic)).filter(key => key !== own);
      }
      case 'helper-start': return (relayHelper ??= new PeerRelayHelper()).start();
      case 'helper-stop': { const helper = relayHelper; relayHelper = null; await helper?.stop(); return undefined; }
      case 'helper-status': return relayHelper?.status() ?? { running: false, announced: false, connections: 0, sessions: 0, guests: 0, forwardedRecords: 0 };
    }
  });

  ipcMain.handle(IPC_CHANNELS.PLUGIN_INVOKE, async (event, rawPayload: unknown): Promise<unknown> => {
    const check = validateIpcSender(event as unknown as IpcSenderEventLike, getCurrentSecurityContext());
    if (!check.ok) throw new Error(check.reason);
    if (!rawPayload || typeof rawPayload !== 'object' || Array.isArray(rawPayload)) throw new Error('Ungültige Plugin-Anfrage.');
    const request = rawPayload as { action?: unknown; payload?: unknown };
    const payload = request.payload as never;
    switch (request.action) {
      case 'get-settings': {
        if (request.payload !== undefined && request.payload !== null && typeof request.payload !== 'string') throw new Error('Ungültiger Dokumentkontext.');
        return plugins.getSettings(request.payload as string | null | undefined);
      }
      case 'after-document-saved': return plugins.afterDocumentSaved(String(request.payload ?? ''));
      case 'select-profile': return plugins.selectProfile(String(request.payload ?? ''));
      case 'create-profile': return plugins.createProfile(payload);
      case 'rename-profile': return plugins.renameProfile(payload);
      case 'delete-profile': return plugins.deleteProfile(String(request.payload ?? ''));
      case 'install-plugin': return plugins.installPlugin(String(request.payload ?? '') as 'git' | 'jira');
      case 'uninstall-plugin': return plugins.uninstallPlugin(String(request.payload ?? '') as 'git' | 'jira');
      case 'configure-git': return plugins.configureGit(payload);
      case 'configure-atlassian': return plugins.configureAtlassian(payload);
      case 'test-atlassian': return plugins.testAtlassian();
      case 'git-status': return plugins.gitStatus(String(request.payload ?? ''));
      case 'git-sync': return plugins.gitSync(String(request.payload ?? ''));
      case 'git-workbench': return plugins.gitWorkbench(String(request.payload ?? ''));
      case 'git-diff': return plugins.gitDiff(payload);
      case 'git-commit': return plugins.gitCommit(payload);
      case 'git-push': return plugins.gitPush(String(request.payload ?? ''));
      case 'git-update': return plugins.gitUpdate(String(request.payload ?? ''));
      case 'git-log': return plugins.gitLog(payload);
      case 'git-discard': return plugins.gitDiscard(payload);
      case 'git-restore-document': return plugins.gitRestoreDocument(payload);
      case 'git-automation': return plugins.gitAutomation(payload);
      case 'watch-document': return plugins.watchDocument(String(request.payload ?? ''));
      case 'list-confluence-pages': return plugins.listConfluencePages(String(request.payload ?? ''));
      case 'get-confluence-page': return plugins.getConfluencePage(String(request.payload ?? ''));
      case 'update-confluence-page': return plugins.updateConfluencePage(payload);
      case 'set-confluence-live-link': return plugins.setConfluenceLiveLink(payload);
      case 'publish-confluence-live': return plugins.publishConfluenceLive(payload);
      case 'create-jira-issue': return plugins.createJiraIssue(payload);
      case 'list-jira-issues': return plugins.listJiraIssues();
      case 'update-jira-issue': return plugins.updateJiraIssue(payload);
      case 'transition-jira-issue': return plugins.transitionJiraIssue(payload);
      default: throw new Error('Unbekannte Plugin-Aktion.');
    }
  });
}

async function createMainWindow(target: RendererTarget): Promise<BrowserWindow> {
  const icon = getWindowIconPath();
  const win = new BrowserWindow({
    ...(icon ? { icon } : {}),
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

  win.webContents.on('did-start-navigation', (_event, _url, isInPlace, isMainFrame) => {
    if (isMainFrame && !isInPlace) { disposeDirectService(); releasePluginRenderer(); }
  });
  win.webContents.on('render-process-gone', () => { disposeDirectService(); releasePluginRenderer(); });

  win.on('closed', () => {
    disposeDirectService();
    releasePluginRenderer();
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
    // Only the installed app owns the link scheme; development and test runs register nothing.
    if (app.isPackaged) app.setAsDefaultProtocolClient(APP_LINK_SCHEME);
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
    pluginService = plugins;
    const updates = createUpdateService();
    updateService = updates;
    app.once('before-quit', () => { pluginService = null; plugins.dispose(); disposeDirectService(); updates.dispose(); });
    registerIpcHandlers(persistence, plugins);
    applyBranding();
    Menu.setApplicationMenu(buildApplicationMenu());

    await createMainWindow(target);
    updates.start(updatePrompts.onAutomaticCheck);

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

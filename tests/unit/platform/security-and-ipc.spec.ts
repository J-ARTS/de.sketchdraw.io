import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import type { IpcRendererEvent } from 'electron';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CloseHandshakeCoordinator } from '../../../electron/close-handshake';
import {
  IPC_CHANNELS,
  validateExportFileRequest,
  validateOpenExternalRequest,
  validateRespondToCloseRequest,
  validateSaveDocumentRequest,
} from '../../../electron/ipc-contract';
import {
  createPreloadDesktopBridge,
  type IpcRendererAdapter,
} from '../../../electron/preload';
import {
  APP_ENTRY_URL,
  APP_ORIGIN,
  DEV_SERVER_ENTRY_URL,
  DEV_SERVER_ORIGIN,
  buildContentSecurityPolicy,
  isAllowedRendererUrl,
  isTrustedRendererResourceUrl,
  PRIVILEGED_APP_SCHEME_CONFIG,
  resolveAppProtocolPath,
  resolveRendererTarget,
  serveAppProtocolRequest,
  validateExternalUrl,
  validateIpcSender,
} from '../../../electron/security';

describe('Electron security, protocol handler, IPC sender verification, and close handshake', () => {
  let tempDir = '';

  beforeEach(async () => {
    tempDir = await fs.mkdtemp(
      path.join(os.tmpdir(), 'sketchdraw-security-'),
    );
  });

  afterEach(async () => {
    if (tempDir) {
      await fs.rm(tempDir, { recursive: true, force: true });
    }
  });

  it('registers app:// scheme without bypassCSP', () => {
    expect(PRIVILEGED_APP_SCHEME_CONFIG.scheme).toBe('app');
    expect(PRIVILEGED_APP_SCHEME_CONFIG.privileges.secure).toBe(true);
    expect(PRIVILEGED_APP_SCHEME_CONFIG.privileges.standard).toBe(true);
    expect(PRIVILEGED_APP_SCHEME_CONFIG.privileges.bypassCSP).toBe(false);
  });

  it('allows sandboxed HTTP(S) frames while applying app CSP headers only to trusted renderer resources', () => {
    const bundled = resolveRendererTarget({ isPackaged: true, env: {} });
    const dev = resolveRendererTarget({ isPackaged: false, env: { SKETCHDRAW_DEV_SERVER_URL: DEV_SERVER_ENTRY_URL } });
    expect(buildContentSecurityPolicy('bundled')).toContain('frame-src https: http:');
    expect(buildContentSecurityPolicy('bundled')).toContain("object-src 'none'");
    expect(isTrustedRendererResourceUrl('app://sketchdraw/assets/app.js', bundled)).toBe(true);
    expect(isTrustedRendererResourceUrl('https://example.com/embed', bundled)).toBe(false);
    expect(isTrustedRendererResourceUrl('http://127.0.0.1:5173/src/renderer/main.ts', dev)).toBe(true);
    expect(isTrustedRendererResourceUrl('http://127.0.0.1:5174/attacker.js', dev)).toBe(false);
  });

  it('loads Vite 127.0.0.1:5173 only in unpacked dev mode with verified env, and bundled app:// in production', () => {
    const devTarget = resolveRendererTarget({
      isPackaged: false,
      env: { SKETCHDRAW_DEV_SERVER_URL: 'http://127.0.0.1:5173' },
    });
    expect(devTarget).toEqual({
      mode: 'dev',
      entryUrl: DEV_SERVER_ENTRY_URL,
      allowedOrigin: DEV_SERVER_ORIGIN,
    });

    const packagedWithEnv = resolveRendererTarget({
      isPackaged: true,
      env: { SKETCHDRAW_DEV_SERVER_URL: 'http://127.0.0.1:5173' },
    });
    expect(packagedWithEnv).toEqual({
      mode: 'bundled',
      entryUrl: APP_ENTRY_URL,
      allowedOrigin: APP_ORIGIN,
    });

    const unpackedWithoutEnv = resolveRendererTarget({
      isPackaged: false,
      env: {},
    });
    expect(unpackedWithoutEnv).toEqual({
      mode: 'bundled',
      entryUrl: APP_ENTRY_URL,
      allowedOrigin: APP_ORIGIN,
    });

    expect(() =>
      resolveRendererTarget({
        isPackaged: false,
        env: { SKETCHDRAW_DEV_SERVER_URL: 'http://localhost:5173' },
      }),
    ).toThrow(/Rejected untrusted SKETCHDRAW_DEV_SERVER_URL/);

    expect(() =>
      resolveRendererTarget({
        isPackaged: false,
        env: { SKETCHDRAW_DEV_SERVER_URL: 'https://evil.example.com' },
      }),
    ).toThrow(/Rejected untrusted SKETCHDRAW_DEV_SERVER_URL/);
  });

  it('resolves and serves app://sketchdraw assets strictly inside distRootDir and blocks traversal or symlink escapes', async () => {
    const distDir = path.join(tempDir, 'dist');
    const outsideDir = path.join(tempDir, 'outside');
    await fs.mkdir(distDir, { recursive: true });
    await fs.mkdir(outsideDir, { recursive: true });

    const indexPath = path.join(distDir, 'index.html');
    await fs.writeFile(indexPath, '<!doctype html><title>Sketchdraw</title>', 'utf8');

    const secretPath = path.join(outsideDir, 'secret.txt');
    await fs.writeFile(secretPath, 'TOP_SECRET', 'utf8');

    const okResolution = resolveAppProtocolPath(
      'app://sketchdraw/index.html',
      distDir,
    );
    expect(okResolution).toEqual({
      ok: true,
      filePath: indexPath,
      mimeType: 'text/html; charset=utf-8',
    });

    const traversal = resolveAppProtocolPath(
      'app://sketchdraw/..%2foutside/secret.txt',
      distDir,
    );
    expect(traversal.ok).toBe(false);

    const wrongHost = resolveAppProtocolPath(
      'app://otherhost/index.html',
      distDir,
    );
    expect(wrongHost.ok).toBe(false);

    const responseOk = await serveAppProtocolRequest(
      { url: 'app://sketchdraw/', method: 'GET' },
      distDir,
    );
    expect(responseOk.status).toBe(200);
    expect(await responseOk.text()).toContain('<title>Sketchdraw</title>');

    const postResponse = await serveAppProtocolRequest(
      { url: 'app://sketchdraw/index.html', method: 'POST' },
      distDir,
    );
    expect(postResponse.status).toBe(405);

    const symlinkPath = path.join(distDir, 'escaped.txt');
    await fs.symlink(secretPath, symlinkPath);

    const symlinkResponse = await serveAppProtocolRequest(
      { url: 'app://sketchdraw/escaped.txt', method: 'GET' },
      distDir,
    );
    expect(symlinkResponse.status).toBe(403);
  });

  it('validates IPC sender webContents, top-level mainFrame, routingId, and URL including WHATWG opaque app:// origin (#17)', () => {
    expect(new URL(APP_ENTRY_URL).origin).toBe('null');
    expect(isAllowedRendererUrl('app://sketchdraw/index.html', APP_ORIGIN)).toBe(true);
    expect(isAllowedRendererUrl('app://sketchdraw/', APP_ORIGIN)).toBe(true);
    expect(isAllowedRendererUrl(DEV_SERVER_ENTRY_URL, DEV_SERVER_ORIGIN)).toBe(true);

    for (const untrustedUrl of [
      'file:///index.html',
      'data:text/html,app',
      'app://attacker/index.html',
      'app://sketchdraw.evil/index.html',
      'app://user@sketchdraw/index.html',
      'app://sketchdraw:123/index.html',
      'app://sketchdraw:/index.html',
      'app://sketchdraw@/index.html',
      'app://sketchdraw/other.html',
    ]) {
      expect(isAllowedRendererUrl(untrustedUrl, APP_ORIGIN), untrustedUrl).toBe(false);
    }

    const context = {
      windowWebContentsId: 7,
      mainFrameRoutingId: 101,
      isWindowDestroyed: false,
      allowedOrigin: APP_ORIGIN,
    };

    const validEvent = {
      sender: {
        id: 7,
        isDestroyed: () => false,
        getURL: () => APP_ENTRY_URL,
      },
      senderFrame: {
        url: APP_ENTRY_URL,
        routingId: 101,
        parent: null,
      },
    };

    expect(validateIpcSender(validEvent, context)).toEqual({ ok: true });

    // Reject subframe sender
    expect(
      validateIpcSender(
        {
          ...validEvent,
          senderFrame: { ...validEvent.senderFrame, parent: {} },
        },
        context,
      ).ok,
    ).toBe(false);

    // Reject mismatched sender WebContents ID
    expect(
      validateIpcSender(
        {
          ...validEvent,
          sender: { ...validEvent.sender, id: 99 },
        },
        context,
      ).ok,
    ).toBe(false);

    // Reject unexpected sender URL
    expect(
      validateIpcSender(
        {
          ...validEvent,
          senderFrame: {
            ...validEvent.senderFrame,
            url: 'https://attacker.example/index.html',
          },
        },
        context,
      ).ok,
    ).toBe(false);
  });

  it('enforces close handshake requestId matching and never silently closes without confirmation', () => {
    const sentRequestIds: string[] = [];
    let windowCloseCalls = 0;

    const coordinator = new CloseHandshakeCoordinator({
      sendCloseRequested: (id) => sentRequestIds.push(id),
      closeWindow: () => {
        windowCloseCalls += 1;
      },
    });

    let defaultPrevented = false;
    const firstAttempt = coordinator.onWindowCloseEvent({
      preventDefault: () => {
        defaultPrevented = true;
      },
    });

    expect(defaultPrevented).toBe(true);
    expect(firstAttempt.allowedToClose).toBe(false);
    expect(sentRequestIds).toHaveLength(1);
    const requestId = sentRequestIds[0]!;
    expect(requestId).toMatch(/^close_[0-9a-f]{32}$/);

    // Wrong requestId must be rejected and must not close the window
    expect(() =>
      coordinator.handleRendererResponse({
        requestId: 'close_00000000000000000000000000000000',
        decision: 'close',
      }),
    ).toThrow(/requestId does not match/);
    expect(windowCloseCalls).toBe(0);

    // Cancel keeps the window open and consumes the pending requestId
    expect(
      coordinator.handleRendererResponse({
        requestId,
        decision: 'cancel',
      }),
    ).toBe('cancel');
    expect(windowCloseCalls).toBe(0);
    expect(coordinator.getPendingRequestId()).toBeNull();

    // Replay of the already-used requestId is rejected
    expect(() =>
      coordinator.handleRendererResponse({
        requestId,
        decision: 'close',
      }),
    ).toThrow(/requestId does not match/);

    // Second close attempt followed by 'close' confirmation closes the window
    const secondAttempt = coordinator.onWindowCloseEvent({
      preventDefault: () => {},
    });
    expect(secondAttempt.allowedToClose).toBe(false);
    const secondRequestId = secondAttempt.requestId!;

    expect(
      coordinator.handleRendererResponse({
        requestId: secondRequestId,
        decision: 'close',
      }),
    ).toBe('close');
    expect(windowCloseCalls).toBe(1);

    // The re-entrant close event triggered by closeWindow() is now permitted through once
    let secondPrevented = false;
    const confirmedPassThrough = coordinator.onWindowCloseEvent({
      preventDefault: () => {
        secondPrevented = true;
      },
    });
    expect(secondPrevented).toBe(false);
    expect(confirmedPassThrough.allowedToClose).toBe(true);
  });

  it('validates IPC payloads and enforces external URL and human user-gesture rules in Preload', async () => {
    // Reject extra path fields on SaveDocumentRequest
    const withFreePath = validateSaveDocumentRequest({
      mode: 'save-as',
      text: '{}',
      suggestedName: 'doc.sketchdraw',
      filePath: '/etc/passwd',
    });
    expect(withFreePath.ok).toBe(false);

    expect(validateExportFileRequest({ contents: 'x', suggestedName: 'a', format: 'svg' }).ok).toBe(
      true,
    );
    expect(() =>
      validateOpenExternalRequest({ url: 'https://example.com', userInitiated: true, extra: 1 }),
    ).toThrow();
    expect(() =>
      validateRespondToCloseRequest({ requestId: 'bad-id', decision: 'close' }),
    ).toThrow();

    expect(validateExternalUrl('https://docs.sketchdraw.io/guide').toString()).toBe(
      'https://docs.sketchdraw.io/guide',
    );
    expect(() => validateExternalUrl('javascript:alert(1)')).toThrow();
    expect(() => validateExternalUrl('file:///etc/passwd')).toThrow();
    expect(() => validateExternalUrl('https://user:pass@example.com')).toThrow();

    const listeners = new Map<
      string,
      Set<(event: IpcRendererEvent, ...args: unknown[]) => void>
    >();
    const invokeMock = vi.fn(async () => ({ status: 'cancelled' }));

    const mockIpc: IpcRendererAdapter = {
      invoke: invokeMock,
      on: (channel, fn) => {
        const set = listeners.get(channel) ?? new Set();
        set.add(fn);
        listeners.set(channel, set);
      },
      removeListener: (channel, fn) => {
        listeners.get(channel)?.delete(fn);
      },
    };

    let gestureActive = false;
    const bridge = createPreloadDesktopBridge({
      ipc: mockIpc,
      isUserActivationActive: () => gestureActive,
    });

    await expect(bridge.openExternal('https://example.com')).rejects.toThrow(
      /human UI interaction/,
    );
    expect(invokeMock).not.toHaveBeenCalled();

    gestureActive = true;
    await bridge.openExternal('https://example.com/docs');
    expect(invokeMock).toHaveBeenCalledWith(IPC_CHANNELS.OPEN_EXTERNAL, {
      url: 'https://example.com/docs',
      userInitiated: true,
    });

    const receivedCommands: string[] = [];
    const unsubscribeMenu = bridge.onMenuCommand((cmd) => {
      receivedCommands.push(cmd);
    });

    for (const fn of listeners.get(IPC_CHANNELS.MENU_COMMAND) ?? []) {
      fn({} as IpcRendererEvent, 'save');
      fn({} as IpcRendererEvent, 'invalid-command');
    }
    expect(receivedCommands).toEqual(['save']);

    unsubscribeMenu();
    for (const fn of listeners.get(IPC_CHANNELS.MENU_COMMAND) ?? []) {
      fn({} as IpcRendererEvent, 'open');
    }
    expect(receivedCommands).toEqual(['save']);
  });
});

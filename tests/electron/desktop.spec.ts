import { _electron as electron, expect, test } from '@playwright/test';

function buildCleanElectronEnv(): Record<string, string> {
  const env: Record<string, string> = {};
  for (const [key, value] of Object.entries(process.env)) {
    if (
      typeof value === 'string' &&
      key !== 'ELECTRON_RUN_AS_NODE' &&
      key !== 'SKETCHDRAW_DEV_SERVER_URL'
    ) {
      env[key] = value;
    }
  }
  return env;
}

test.describe('Electron Desktop Shell, Sandbox, Bridge, Menu & Close Handshake', () => {
  test('starts bundled app via app:// scheme, enforces sandbox/contextIsolation, validates IPC, and executes close handshake', async () => {
    const electronApp = await electron.launch({
      args: ['.'],
      env: buildCleanElectronEnv(),
    });

    try {
      const page = await electronApp.firstWindow();
      await page.waitForLoadState('domcontentloaded');

      expect(page.url()).toBe('app://sketchdraw/index.html');

      const windowMeta = await electronApp.evaluate(({ BrowserWindow }) => {
        const win = BrowserWindow.getAllWindows()[0];
        if (!win) {
          throw new Error('No BrowserWindow instance found.');
        }
        const [minWidth, minHeight] = win.getMinimumSize();
        const bounds = win.getBounds();
        return {
          minWidth,
          minHeight,
          width: bounds.width,
          height: bounds.height,
          isDestroyed: win.isDestroyed(),
        };
      });

      expect(windowMeta.isDestroyed).toBe(false);
      expect(windowMeta.minWidth).toBe(960);
      expect(windowMeta.minHeight).toBe(640);
      expect(windowMeta.width).toBeGreaterThanOrEqual(960);
      expect(windowMeta.height).toBeGreaterThanOrEqual(640);

      const bridgeInspection = await page.evaluate(() => {
        const globalObj = window as unknown as Record<string, unknown>;
        const bridge = window.sketchdraw;
        return {
          hasRequire: typeof globalObj['require'] !== 'undefined',
          hasProcess: typeof globalObj['process'] !== 'undefined',
          hasBuffer: typeof globalObj['Buffer'] !== 'undefined',
          hasIpcRenderer: typeof globalObj['ipcRenderer'] !== 'undefined',
          bridgeKeys: bridge ? Object.keys(bridge).sort() : [],
          platform: bridge?.platform,
          popupResult: window.open('https://example.com', '_blank'),
        };
      });

      expect(bridgeInspection.hasRequire).toBe(false);
      expect(bridgeInspection.hasProcess).toBe(false);
      expect(bridgeInspection.hasBuffer).toBe(false);
      expect(bridgeInspection.hasIpcRenderer).toBe(false);
      expect(bridgeInspection.platform).toBe('electron');
      expect(bridgeInspection.popupResult).toBeNull();
      expect(bridgeInspection.bridgeKeys).toEqual([
        'exportFile',
        'onCloseRequested',
        'onMenuCommand',
        'openDocument',
        'openExternal',
        'platform',
        'respondToClose',
        'saveDocument',
      ]);

      // Verify IPC validation rejects raw paths and uninitiated external links
      const securityChecks = await page.evaluate(async () => {
        const bridge = window.sketchdraw!;
        const invalidHandleSave = await bridge.saveDocument({
          mode: 'save',
          handleId: '/etc/passwd',
          expectedVersionToken:
            'sha256:0000000000000000000000000000000000000000000000000000000000000000',
          text: '{}',
          suggestedName: 'test.sketchdraw',
        });

        let jsSchemeRejected = false;
        try {
          await bridge.openExternal('javascript:alert(1)');
        } catch {
          jsSchemeRejected = true;
        }

        let withoutGestureRejected = false;
        try {
          await bridge.openExternal('https://example.com');
        } catch {
          withoutGestureRejected = true;
        }

        return {
          invalidHandleSave,
          jsSchemeRejected,
          withoutGestureRejected,
        };
      });

      expect(securityChecks.invalidHandleSave.status).toBe('error');
      if (securityChecks.invalidHandleSave.status === 'error') {
        expect(securityChecks.invalidHandleSave.code).toBe('INVALID_HANDLE');
      }
      expect(securityChecks.jsSchemeRejected).toBe(true);
      expect(securityChecks.withoutGestureRejected).toBe(true);

      // Verify Menu command routing through the single onMenuCommand channel
      await page.evaluate(() => {
        const w = window as unknown as { __menuCommands?: string[] };
        w.__menuCommands = [];
        window.sketchdraw!.onMenuCommand((cmd) => {
          w.__menuCommands!.push(cmd);
        });
      });

      await electronApp.evaluate(({ Menu }) => {
        const appMenu = Menu.getApplicationMenu();
        const saveItem = appMenu?.getMenuItemById('file-save');
        saveItem?.click();
      });

      await expect
        .poll(async () =>
          page.evaluate(
            () => (window as unknown as { __menuCommands?: string[] }).__menuCommands ?? [],
          ),
        )
        .toContain('save');

      // Verify Close Handshake protects unsaved state and rejects forged requestIds
      await page.evaluate(() => {
        const w = window as unknown as { __closeRequestIds?: string[] };
        w.__closeRequestIds = [];
        window.sketchdraw!.onCloseRequested((requestId) => {
          w.__closeRequestIds!.push(requestId);
        });
      });

      await electronApp.evaluate(({ BrowserWindow }) => {
        BrowserWindow.getAllWindows()[0]?.close();
      });

      await expect
        .poll(async () =>
          page.evaluate(
            () =>
              (window as unknown as { __closeRequestIds?: string[] })
                .__closeRequestIds?.length ?? 0,
          ),
        )
        .toBeGreaterThanOrEqual(1);

      const firstCloseRequestId = await page.evaluate(
        () =>
          (window as unknown as { __closeRequestIds: string[] })
            .__closeRequestIds[0]!,
      );
      expect(firstCloseRequestId).toMatch(/^close_[0-9a-f]{32}$/);

      // Window must still be open when renderer has not responded yet
      const stillOpenBeforeResponse = await electronApp.evaluate(
        ({ BrowserWindow }) => BrowserWindow.getAllWindows().length,
      );
      expect(stillOpenBeforeResponse).toBe(1);

      // Forged requestId must be rejected
      const forgedRejected = await page.evaluate(async () => {
        try {
          await window.sketchdraw!.respondToClose(
            'close_00000000000000000000000000000000',
            'close',
          );
          return false;
        } catch {
          return true;
        }
      });
      expect(forgedRejected).toBe(true);

      // Cancelling the close request keeps the window open
      await page.evaluate(async (reqId) => {
        await window.sketchdraw!.respondToClose(reqId, 'cancel');
      }, firstCloseRequestId);

      const stillOpenAfterCancel = await electronApp.evaluate(
        ({ BrowserWindow }) => BrowserWindow.getAllWindows().length,
      );
      expect(stillOpenAfterCancel).toBe(1);
    } finally {
      await electronApp.close().catch(() => {});
    }
  });
});

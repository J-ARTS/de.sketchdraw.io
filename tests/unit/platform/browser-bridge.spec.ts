import { describe, expect, it, vi } from 'vitest';
import {
  createDocument,
  serializeDocument,
} from '../../../src/domain/index';
import {
  type BrowserAnchorLike,
  type BrowserFileInputLike,
  computeBrowserVersionToken,
  createBrowserDesktopBridge,
  getDesktopBridge,
  isDesktopBridgeContract,
  sanitizeDownloadFileName,
} from '../../../src/platform/index';

function createValidDocumentJson(title = 'Browser Test Diagram'): string {
  return serializeDocument(createDocument(title));
}

function createFakeFileInput(options: {
  trigger: 'change' | 'cancel' | 'empty-change';
  file?: { name: string; size: number; text: () => Promise<string> };
}): {
  input: BrowserFileInputLike;
  wasRemoved: () => boolean;
} {
  const listeners = new Map<'change' | 'cancel', () => void>();
  let removed = false;

  const input: BrowserFileInputLike = {
    type: 'file',
    accept: '',
    style: { display: '' },
    files:
      options.trigger === 'change' && options.file ? [options.file] : [],
    addEventListener: (type, listener) => {
      listeners.set(type, listener);
    },
    removeEventListener: (type) => {
      listeners.delete(type);
    },
    click: () => {
      if (options.trigger === 'cancel') {
        listeners.get('cancel')?.();
      } else {
        listeners.get('change')?.();
      }
    },
    remove: () => {
      removed = true;
    },
  };

  return {
    input,
    wasRemoved: () => removed,
  };
}

describe('Browser DesktopBridge adapter and getDesktopBridge()', () => {
  it('opens a valid file via file input, returns content hash versionToken and opaque handleId, and removes input from DOM', async () => {
    const validText = createValidDocumentJson('Architecture Canvas');
    const encodedSize = new TextEncoder().encode(validText).byteLength;
    const fakeInput = createFakeFileInput({
      trigger: 'change',
      file: {
        name: 'C:\\fakepath\\cloud-diagram.sketchdraw',
        size: encodedSize,
        text: async () => validText,
      },
    });

    const bridge = createBrowserDesktopBridge({
      dom: {
        createFileInput: () => fakeInput.input,
      },
    });

    const result = await bridge.openDocument();
    expect(fakeInput.wasRemoved()).toBe(true);
    expect(result.status).toBe('opened');
    if (result.status !== 'opened') return;

    expect(result.text).toBe(validText);
    expect(result.file.name).toBe('cloud-diagram.sketchdraw');
    expect(result.file.handleId).toMatch(/^hdl_[0-9a-f]{32}$/);
    expect(result.file.versionToken).toBe(
      await computeBrowserVersionToken(validText),
    );
  });

  it('resolves openDocument with cancelled when input fires cancel event', async () => {
    const fakeInput = createFakeFileInput({ trigger: 'cancel' });
    const bridge = createBrowserDesktopBridge({
      dom: {
        createFileInput: () => fakeInput.input,
      },
    });

    const result = await bridge.openDocument();
    expect(result).toEqual({ status: 'cancelled' });
    expect(fakeInput.wasRemoved()).toBe(true);
  });

  it('rejects invalid or oversized files in openDocument', async () => {
    const invalidInput = createFakeFileInput({
      trigger: 'change',
      file: {
        name: 'corrupt.sketchdraw',
        size: 16,
        text: async () => '{"not":"valid"}',
      },
    });

    const bridge = createBrowserDesktopBridge({
      dom: {
        createFileInput: () => invalidInput.input,
      },
    });

    const invalidResult = await bridge.openDocument();
    expect(invalidResult.status).toBe('error');
    if (invalidResult.status === 'error') {
      expect(invalidResult.code).toBe('VALIDATION_ERROR');
    }

    const oversizedInput = createFakeFileInput({
      trigger: 'change',
      file: {
        name: 'huge.sketchdraw',
        size: 1024,
        text: async () => createValidDocumentJson(),
      },
    });

    const smallLimitBridge = createBrowserDesktopBridge({
      maxDocumentBytes: 100,
      dom: {
        createFileInput: () => oversizedInput.input,
      },
    });

    const oversizedResult = await smallLimitBridge.openDocument();
    expect(oversizedResult.status).toBe('error');
    if (oversizedResult.status === 'error') {
      expect(oversizedResult.code).toBe('DOCUMENT_TOO_LARGE');
    }
  });

  it('returns download-initiated (never saved) on saveDocument and revokes object URL asynchronously after download', async () => {
    const validText = createValidDocumentJson('Saved via Download');
    const revokedUrls: string[] = [];
    const scheduledCallbacks: Array<{ fn: () => void; delayMs: number }> = [];
    let clickedDownloadName = '';
    let anchorRemoved = false;

    const fakeAnchor: BrowserAnchorLike = {
      href: '',
      download: '',
      rel: '',
      style: { display: '' },
      click: () => {
        // At click time, the object URL must NOT have been revoked yet!
        expect(revokedUrls).toHaveLength(0);
        clickedDownloadName = fakeAnchor.download;
      },
      remove: () => {
        anchorRemoved = true;
      },
    };

    const bridge = createBrowserDesktopBridge({
      revokeDelayMs: 45_000,
      dom: {
        createDownloadAnchor: () => fakeAnchor,
        createObjectUrl: () => 'blob:http://127.0.0.1:5173/test-blob-1',
        revokeObjectUrl: (url) => {
          revokedUrls.push(url);
        },
        scheduleRevoke: (fn, delayMs) => {
          scheduledCallbacks.push({ fn, delayMs });
        },
      },
    });

    const saveResult = await bridge.saveDocument({
      mode: 'save',
      handleId: 'hdl_11111111111111111111111111111111',
      expectedVersionToken: await computeBrowserVersionToken(validText),
      text: validText,
      suggestedName: '../../nested/path/my-architecture',
    });

    expect(saveResult).toEqual({
      status: 'download-initiated',
      name: 'my-architecture.sketchdraw',
    });
    expect(clickedDownloadName).toBe('my-architecture.sketchdraw');
    expect(anchorRemoved).toBe(true);
    expect(revokedUrls).toHaveLength(0);
    expect(scheduledCallbacks).toHaveLength(1);
    expect(scheduledCallbacks[0]?.delayMs).toBe(45_000);

    // Execute scheduled revoke callback
    scheduledCallbacks[0]?.fn();
    expect(revokedUrls).toEqual(['blob:http://127.0.0.1:5173/test-blob-1']);
  });

  it('validates exportFile format and initiates download with safe basename', async () => {
    const scheduled: Array<() => void> = [];
    const revoked: string[] = [];
    const fakeAnchor: BrowserAnchorLike = {
      href: '',
      download: '',
      rel: '',
      style: { display: '' },
      click: () => {},
      remove: () => {},
    };

    const bridge = createBrowserDesktopBridge({
      dom: {
        createDownloadAnchor: () => fakeAnchor,
        createObjectUrl: () => 'blob:http://127.0.0.1:5173/svg-blob',
        revokeObjectUrl: (u) => revoked.push(u),
        scheduleRevoke: (fn) => scheduled.push(fn),
      },
    });

    const exportRes = await bridge.exportFile(
      '<svg xmlns="http://www.w3.org/2000/svg"></svg>',
      '../exports/system-overview',
      'svg',
    );
    expect(exportRes).toEqual({
      status: 'download-initiated',
      name: 'system-overview.svg',
    });
    scheduled[0]?.();
    expect(revoked).toEqual(['blob:http://127.0.0.1:5173/svg-blob']);

    const badFormat = await bridge.exportFile(
      '<svg></svg>',
      'system-overview',
      'html' as unknown as 'svg',
    );
    expect(badFormat.status).toBe('error');
    if (badFormat.status === 'error') {
      expect(badFormat.code).toBe('INVALID_FORMAT');
    }
  });

  it('enforces http/https and active user gesture on openExternal and provides safe no-op close/menu hooks', async () => {
    const openWindowMock = vi.fn();
    let gesture = false;

    const bridge = createBrowserDesktopBridge({
      isUserGestureActive: () => gesture,
      dom: {
        openWindow: openWindowMock,
      },
    });

    await expect(bridge.openExternal('https://sketchdraw.io')).rejects.toThrow(
      /human UI interaction/,
    );
    await expect(bridge.openExternal('javascript:alert(1)')).rejects.toThrow(
      /Unsupported external URL protocol/,
    );

    gesture = true;
    await bridge.openExternal('https://sketchdraw.io/docs');
    expect(openWindowMock).toHaveBeenCalledWith(
      'https://sketchdraw.io/docs',
      '_blank',
      'noopener,noreferrer',
    );

    const unsubClose = bridge.onCloseRequested(() => {});
    expect(typeof unsubClose).toBe('function');
    unsubClose();

    await expect(
      bridge.respondToClose('close_1234', 'cancel'),
    ).resolves.toBeUndefined();

    const unsubMenu = bridge.onMenuCommand(() => {});
    expect(typeof unsubMenu).toBe('function');
    unsubMenu();

    expect(sanitizeDownloadFileName('../foo/bar', 'drawio')).toBe(
      'bar.drawio',
    );
    expect(isDesktopBridgeContract(bridge)).toBe(true);
    expect(getDesktopBridge().platform).toBe('browser');
  });
});

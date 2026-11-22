import { describe, expect, it, vi } from 'vitest';
import { CloseHandshakeCoordinator } from '../../../electron/close-handshake';
import { QuitLifecycle } from '../../../electron/quit-lifecycle';

/**
 * The events of the main process as Electron raises them on macOS, where closing the last window does not quit:
 * `before-quit` asks the window to close, the close handshake prevents that close, and Electron gives up the quit.
 */
function app() {
  let windows = 1;
  const host = { quit: vi.fn(), windowCount: () => windows, disposeServices: vi.fn() };
  const lifecycle = new QuitLifecycle(host);
  let requestId = '';
  const coordinator = new CloseHandshakeCoordinator({
    sendCloseRequested: (id) => { requestId = id; },
    // A confirmed close closes the window: the `close` event passes this time and `closed` follows.
    closeWindow: () => { coordinator.onWindowCloseEvent({ preventDefault: () => {} }); windows = 0; lifecycle.onWindowClosed(); },
  });
  return {
    host, lifecycle,
    /** Cmd+Q: `before-quit`, then the window is asked to close. Returns whether the close was prevented. */
    quit: () => { lifecycle.onBeforeQuit(); let prevented = false; coordinator.onWindowCloseEvent({ preventDefault: () => { prevented = true; } }); return prevented; },
    /** The red button: only the window is asked to close. */
    closeWindow: () => { coordinator.onWindowCloseEvent({ preventDefault: () => {} }); },
    answer: (decision: 'close' | 'cancel') => lifecycle.onCloseDecision(coordinator.handleRendererResponse({ requestId, decision })),
    /** What Electron does after `quit()` once no window is left. */
    finishQuit: () => { lifecycle.onBeforeQuit(); lifecycle.onWillQuit(); },
  };
}

describe('quit lifecycle (#218)', () => {
  it('a cancelled quit leaves the services running and the app usable', () => {
    const { host, lifecycle, quit, answer } = app();
    expect(quit()).toBe(true);
    answer('cancel');
    expect(host.disposeServices).not.toHaveBeenCalled();
    expect(host.quit).not.toHaveBeenCalled();
    expect(lifecycle.isQuitRequested()).toBe(false);
  });

  it('cancel, keep working, quit again: the confirmed quit is continued and the services end once', () => {
    const { host, quit, answer, finishQuit } = app();
    quit(); answer('cancel');
    expect(host.disposeServices).not.toHaveBeenCalled();

    quit(); answer('close');
    // The window is gone; without the continuation the process would stay alive on macOS.
    expect(host.quit).toHaveBeenCalledTimes(1);
    expect(host.disposeServices).not.toHaveBeenCalled();

    finishQuit(); finishQuit();
    expect(host.disposeServices).toHaveBeenCalledTimes(1);
  });

  it('closing only the window does not quit, and a cancelled quit does not turn a later window close into one', () => {
    const plain = app();
    plain.closeWindow(); plain.answer('close');
    expect(plain.host.quit).not.toHaveBeenCalled();
    expect(plain.host.disposeServices).not.toHaveBeenCalled();

    const afterCancel = app();
    afterCancel.quit(); afterCancel.answer('cancel');
    afterCancel.closeWindow(); afterCancel.answer('close');
    expect(afterCancel.host.quit).not.toHaveBeenCalled();
    expect(afterCancel.host.disposeServices).not.toHaveBeenCalled();
  });

  it('repeated quit requests while the dialog is open still end in one quit', () => {
    const { host, quit, answer } = app();
    quit(); quit(); quit();
    answer('close');
    expect(host.quit).toHaveBeenCalledTimes(1);
  });
});

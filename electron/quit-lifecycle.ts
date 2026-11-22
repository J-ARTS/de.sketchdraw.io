import type { CloseDecision } from './ipc-contract';

export interface QuitLifecycleHost {
  /** Asks the application to quit (`app.quit()`). */
  quit(): void;
  /** How many windows are still open. */
  windowCount(): number;
  /** Ends the services that live as long as the application (plugins, direct connections, updates). */
  disposeServices(): void;
}

/**
 * Carries the wish to quit across the close handshake of the window (#218).
 *
 * Quitting asks the window to close; the window answers only after the renderer decided what happens to unsaved
 * work, so Electron has given up on the quit by then. Two things follow from that:
 *
 * - A quit the user cancelled must leave the application as it was. The services therefore end with `will-quit`,
 *   which only fires once nothing can stop the quit any more – not with `before-quit`, which fires on every attempt.
 * - A quit the user confirmed must be finished by hand once the window has closed. On macOS nothing else does it,
 *   because closing the last window does not quit there.
 */
export class QuitLifecycle {
  private quitRequested = false;
  private disposed = false;

  constructor(private readonly host: QuitLifecycleHost) {}

  /** `before-quit`: the user asked to quit. Fires again for every attempt. */
  public onBeforeQuit(): void {
    this.quitRequested = true;
  }

  /** The renderer answered a close request. A refusal ends the quit; closing a window later is only that again. */
  public onCloseDecision(decision: CloseDecision): void {
    if (decision === 'cancel') this.quitRequested = false;
  }

  /** A window has closed. Continues the quit that was asked for once no window is left. */
  public onWindowClosed(): void {
    if (this.quitRequested && this.host.windowCount() === 0) this.host.quit();
  }

  /** `will-quit`: the application ends now. The services are ended exactly once. */
  public onWillQuit(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.host.disposeServices();
  }

  public isQuitRequested(): boolean {
    return this.quitRequested;
  }
}

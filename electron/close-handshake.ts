import crypto from 'node:crypto';
import {
  type CloseDecision,
  validateRespondToCloseRequest,
} from './ipc-contract';

export interface CloseHandshakeCallbacks {
  sendCloseRequested(requestId: string): void;
  closeWindow(): void;
}

export class CloseHandshakeCoordinator {
  private readonly callbacks: CloseHandshakeCallbacks;
  private pendingRequestId: string | null = null;
  private confirmedCloseInProgress = false;

  constructor(callbacks: CloseHandshakeCallbacks) {
    this.callbacks = callbacks;
  }

  public getPendingRequestId(): string | null {
    return this.pendingRequestId;
  }

  public isCloseConfirmed(): boolean {
    return this.confirmedCloseInProgress;
  }

  /**
   * Intercepts the Electron BrowserWindow 'close' event.
   * Unless a close decision was just confirmed for the active pending requestId,
   * the native close is prevented and a fresh one-time requestId is sent to the renderer.
   * Missing renderer responses never close the window silently.
   */
  public onWindowCloseEvent(event: { preventDefault(): void }): {
    allowedToClose: boolean;
    requestId?: string;
  } {
    if (this.confirmedCloseInProgress) {
      this.confirmedCloseInProgress = false;
      this.pendingRequestId = null;
      return { allowedToClose: true };
    }

    event.preventDefault();
    const requestId = `close_${crypto.randomBytes(16).toString('hex')}`;
    this.pendingRequestId = requestId;
    this.callbacks.sendCloseRequested(requestId);

    return {
      allowedToClose: false,
      requestId,
    };
  }

  public handleRendererResponse(rawPayload: unknown): CloseDecision {
    const { requestId, decision } = validateRespondToCloseRequest(rawPayload);

    if (this.pendingRequestId === null || this.pendingRequestId !== requestId) {
      throw new Error(
        'Close response rejected: requestId does not match the active pending close request.',
      );
    }

    this.pendingRequestId = null;

    if (decision === 'cancel') {
      this.confirmedCloseInProgress = false;
      return 'cancel';
    }

    this.confirmedCloseInProgress = true;
    this.callbacks.closeWindow();
    return 'close';
  }

  public reset(): void {
    this.pendingRequestId = null;
    this.confirmedCloseInProgress = false;
  }
}

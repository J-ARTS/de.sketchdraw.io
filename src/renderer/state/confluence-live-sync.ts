import type { ConfluenceLiveImage, ConfluenceLivePublishInput, ConfluenceLivePublishResult, SketchDocument } from '@/domain';
import { t, tm } from '@/renderer/i18n';
import type { ConfluenceLiveState, ConfluenceLiveStatus } from '@/renderer/lib/confluence-live-text';

/** Changes are collected this long before the diagram is rendered and published. */
export const CONFLUENCE_LIVE_DEBOUNCE_MS = 3_000;
/** Waits between attempts after a problem that can pass on its own; afterwards the next change or the user restarts. */
export const CONFLUENCE_LIVE_RETRY_DELAYS_MS: readonly number[] = [5_000, 15_000, 45_000, 120_000, 300_000];

/** After a problem that needs the user (access, missing page), edits start a new attempt at most this often. */
export const CONFLUENCE_LIVE_FAILURE_HOLD_MS = 60_000;

export type { ConfluenceLiveState, ConfluenceLiveStatus };

/** Longest single timer; a later moment is reached by scheduling again. */
const MAX_TIMER_MS = 24 * 60 * 60 * 1000;

/**
 * `key` names what a publication belongs to: diagram file, diagram, profile, site and target page. Work that was
 * started under one key is dropped as soon as the key changes.
 */
export type ConfluenceLiveContext =
  | { kind: 'off' }
  | { kind: 'paused'; key: string; message: string }
  | { kind: 'active'; key: string; handleId: string; document: SketchDocument; syncedAt?: string };

export interface ConfluenceLiveSyncOptions {
  context(): ConfluenceLiveContext;
  render(document: SketchDocument): Promise<ConfluenceLiveImage[]>;
  publish(input: ConfluenceLivePublishInput): Promise<ConfluenceLivePublishResult>;
  onStatus(status: ConfluenceLiveStatus): void;
  debounceMs?: number;
  retryDelaysMs?: readonly number[];
  failureHoldMs?: number;
  /** The clock for pauses and holds; tests control it. */
  now?: () => number;
}

export interface ConfluenceLiveSync {
  /** The link, the profile, the diagram file or a blocking condition may have changed. */
  contextChanged(): void;
  /** The diagram has new content. */
  documentChanged(): void;
  /** The user asks for a publication now; Confluence is checked even if nothing changed here. */
  syncNow(): void;
  /** The network is back: an attempt that was waiting or had given up starts again. */
  recover(): void;
  dispose(): void;
}

/**
 * Keeps the linked Confluence page up to date while the app runs. One publication at a time; changes that arrive
 * meanwhile are published afterwards as one, always with the newest diagram. A publication counts as done only when
 * the main process reports that Confluence confirmed it.
 */
export function createConfluenceLiveSync(options: ConfluenceLiveSyncOptions): ConfluenceLiveSync {
  const debounceMs = options.debounceMs ?? CONFLUENCE_LIVE_DEBOUNCE_MS;
  const retryDelaysMs = options.retryDelaysMs ?? CONFLUENCE_LIVE_RETRY_DELAYS_MS;
  let disposed = false;
  /** Kind and key of the context the current state belongs to. */
  let contextId: string | null = null;
  let baseKey: string | null = null;
  let epoch = 0;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let running = false;
  let dirty = false;
  let attempt = 0;
  /** What Confluence confirmed last for this key: page ids with the digests of their rendered content. */
  let syncedSignature: string | null = null;
  let syncedAt: string | undefined;
  /** Until then, edits alone do not start a new attempt after a problem only the user can solve. */
  let holdUntil = 0;
  const failureHoldMs = options.failureHoldMs ?? CONFLUENCE_LIVE_FAILURE_HOLD_MS;
  let status: ConfluenceLiveStatus = { state: 'off', message: '' };

  const now = options.now ?? Date.now;
  /**
   * The moment the server asked to be left alone until (Retry-After). No attempt starts before it, whatever asks for
   * one: an edit, the retry schedule, "Jetzt synchronisieren" or the network coming back.
   */
  let serverUntil = 0;
  const serverPause = (): number => Math.max(0, serverUntil - now());
  const PAUSE_MESSAGE = (): string => t('Confluence hat um eine Pause gebeten. Die Veröffentlichung wird danach automatisch fortgesetzt.');

  function setStatus(state: ConfluenceLiveState, message: string): void {
    const waiting = serverPause() > 0 && (state === 'retrying' || state === 'pending' || state === 'error');
    status = { state, message, ...(syncedAt && state !== 'off' ? { syncedAt } : {}), ...(waiting ? { retryAt: new Date(serverUntil).toISOString() } : {}) };
    options.onStatus(status);
  }
  function clearTimer(): void { if (timer !== null) { clearTimeout(timer); timer = null; } }
  /** Every start of an attempt goes through here, so none can be earlier than the server allows. */
  function schedule(delay: number): void {
    clearTimer();
    if (disposed) return;
    timer = setTimeout(() => { timer = null; void run(); }, Math.min(Math.max(delay, serverPause()), MAX_TIMER_MS));
    (timer as { unref?: () => void }).unref?.();
  }

  function contextChanged(): void {
    if (disposed) return;
    const context = options.context();
    const id = context.kind === 'off' ? null : `${context.kind}\n${context.key}`;
    if (id === contextId) return;
    contextId = id;
    // Whatever is running or waiting belonged to the previous context.
    epoch++; clearTimer(); attempt = 0;
    const key = context.kind === 'off' ? null : context.key;
    // Another diagram, profile or site: a pause belongs to the site that asked; the main process keeps enforcing it.
    if (key !== baseKey) { baseKey = key; syncedSignature = null; syncedAt = undefined; holdUntil = 0; serverUntil = 0; }
    if (context.kind === 'off') { setStatus('off', ''); return; }
    if (context.kind === 'paused') { setStatus('paused', context.message); return; }
    syncedAt ??= context.syncedAt;
    // A fresh context is checked once: after opening, reloading from Git or linking, Confluence may be behind.
    announceWaiting();
    if (running) dirty = true; else schedule(debounceMs);
  }

  function announceWaiting(): void {
    if (serverPause() > 0) setStatus('retrying', PAUSE_MESSAGE());
    else setStatus('pending', t('Änderungen werden gleich nach Confluence übertragen.'));
  }

  function documentChanged(): void {
    if (disposed || !contextId?.startsWith('active\n')) return;
    attempt = 0;
    if (running) { dirty = true; return; }
    // After a problem that needs the user, further edits do not ask Confluence again at every pause in typing.
    const hold = holdUntil - now();
    if (hold <= 0 || serverPause() > 0) announceWaiting();
    schedule(Math.max(debounceMs, hold));
  }

  async function run(): Promise<void> {
    if (disposed) return;
    if (running) { dirty = true; return; }
    contextChanged();
    const context = options.context();
    if (context.kind !== 'active') return;
    clearTimer();
    // Reached early (a manual start, a recovered network): the attempt waits for the moment the server named.
    if (serverPause() > 0) { setStatus('retrying', PAUSE_MESSAGE()); schedule(0); return; }
    const runEpoch = epoch;
    running = true; dirty = false;
    setStatus('syncing', t('Diagramm wird nach Confluence übertragen …'));
    try {
      let images: ConfluenceLiveImage[];
      try { images = await options.render(context.document); }
      catch (error) {
        if (runEpoch === epoch) setStatus('error', t('Das Diagramm konnte nicht für Confluence gerendert werden: {message}', { message: error instanceof Error ? tm(error.message) : t('unbekannter Fehler') }));
        return;
      }
      if (runEpoch !== epoch) return;
      const signature = images.map((image) => `${image.pageId}:${image.hash}`).join('|');
      if (signature === syncedSignature) { attempt = 0; setStatus('synced', t('Confluence ist auf dem aktuellen Stand.')); return; }
      let result: ConfluenceLivePublishResult;
      try { result = await options.publish({ handleId: context.handleId, documentId: context.document.id, title: context.document.title, images }); }
      catch (error) { result = { status: 'retry', message: error instanceof Error ? error.message : '', uploaded: 0, bodyUpdated: false }; }
      if (runEpoch !== epoch) return;
      if (result.status === 'synced') {
        syncedSignature = signature; attempt = 0; holdUntil = 0; serverUntil = 0; syncedAt = result.syncedAt ?? new Date(now()).toISOString();
        setStatus('synced', tm(result.message));
      } else if (result.status === 'failed') {
        holdUntil = now() + failureHoldMs;
        setStatus('error', tm(result.message));
      } else {
        // `cancelled` without a context change here means the main process saw one first; the next attempt settles it.
        const until = result.status === 'retry' && result.retryAt ? Date.parse(result.retryAt) : Number.NaN;
        if (Number.isFinite(until) && until > now()) serverUntil = Math.max(serverUntil, until);
        const delay = retryDelaysMs[attempt];
        // The number of automatic attempts stays limited also when the server sets the pace; the end is shown, and
        // the next change or a manual start begins again (never before the server's moment).
        if (delay === undefined) setStatus('error', t('{message} Automatische Wiederholungen sind pausiert; die nächste Änderung oder „Jetzt synchronisieren“ startet einen neuen Versuch.', { message: tm(result.message) }));
        else { attempt++; setStatus('retrying', tm(result.message)); schedule(delay); }
      }
    } finally {
      running = false;
      if (dirty && !disposed) { dirty = false; attempt = 0; schedule(debounceMs); }
    }
  }

  return {
    contextChanged,
    documentChanged,
    syncNow() {
      if (disposed) return;
      contextChanged();
      if (!contextId?.startsWith('active\n')) return;
      attempt = 0; syncedSignature = null; holdUntil = 0;
      if (running) { dirty = true; return; }
      clearTimer(); void run();
    },
    recover() {
      if (disposed || !contextId?.startsWith('active\n') || running) return;
      if (status.state !== 'retrying' && status.state !== 'error') return;
      attempt = 0; schedule(0);
    },
    dispose() { disposed = true; epoch++; clearTimer(); },
  };
}

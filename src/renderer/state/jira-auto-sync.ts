export const JIRA_AUTO_SYNC_INTERVAL_MS = 5_000;

export interface JiraAutoSyncOptions {
  isReady(): boolean;
  sync(): Promise<unknown>;
  intervalMs?: number;
}

/** Runs Jira pulls for the lifetime of the renderer without allowing overlapping requests. */
export function startJiraAutoSync(options: JiraAutoSyncOptions): () => void {
  let stopped = false;
  let inFlight = false;
  const intervalMs = options.intervalMs ?? JIRA_AUTO_SYNC_INTERVAL_MS;
  if (!Number.isFinite(intervalMs) || intervalMs <= 0) throw new Error('Jira auto-sync interval must be positive.');

  async function tick(): Promise<void> {
    if (stopped || inFlight || !options.isReady()) return;
    inFlight = true;
    try { await options.sync(); }
    catch { /* The store reports integration errors; the scheduler must stay alive. */ }
    finally { inFlight = false; }
  }

  const timer = globalThis.setInterval(() => { void tick(); }, intervalMs);
  return () => { stopped = true; globalThis.clearInterval(timer); };
}

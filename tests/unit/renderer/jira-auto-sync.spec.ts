import { afterEach, describe, expect, it, vi } from 'vitest';
import { JIRA_AUTO_SYNC_INTERVAL_MS, startJiraAutoSync } from '@/renderer/state/jira-auto-sync';

afterEach(() => { vi.useRealTimers(); });

describe('Jira auto-sync', () => {
  it('checks readiness and synchronizes every five seconds', async () => {
    vi.useFakeTimers();
    let ready = false;
    const sync = vi.fn(async () => undefined);
    const stop = startJiraAutoSync({ isReady: () => ready, sync });

    await vi.advanceTimersByTimeAsync(JIRA_AUTO_SYNC_INTERVAL_MS * 2);
    expect(sync).not.toHaveBeenCalled();
    ready = true;
    await vi.advanceTimersByTimeAsync(JIRA_AUTO_SYNC_INTERVAL_MS * 2);
    expect(sync).toHaveBeenCalledTimes(2);

    stop();
    await vi.advanceTimersByTimeAsync(JIRA_AUTO_SYNC_INTERVAL_MS);
    expect(sync).toHaveBeenCalledTimes(2);
  });

  it('never overlaps slow Jira requests and continues after failures', async () => {
    vi.useFakeTimers();
    let resolveFirst!: () => void;
    const first = new Promise<void>((resolve) => { resolveFirst = resolve; });
    const sync = vi.fn()
      .mockImplementationOnce(() => first)
      .mockRejectedValueOnce(new Error('temporary'))
      .mockResolvedValue(undefined);
    const stop = startJiraAutoSync({ isReady: () => true, sync });

    await vi.advanceTimersByTimeAsync(JIRA_AUTO_SYNC_INTERVAL_MS * 3);
    expect(sync).toHaveBeenCalledTimes(1);
    resolveFirst(); await first;
    await vi.advanceTimersByTimeAsync(JIRA_AUTO_SYNC_INTERVAL_MS);
    expect(sync).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(JIRA_AUTO_SYNC_INTERVAL_MS);
    expect(sync).toHaveBeenCalledTimes(3);
    stop();
  });
});

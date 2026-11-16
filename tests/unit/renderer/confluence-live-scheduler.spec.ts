import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ConfluenceLiveImage, ConfluenceLivePublishInput, ConfluenceLivePublishResult, SketchDocument } from '@/domain';
import { createConfluenceLiveSync, type ConfluenceLiveContext, type ConfluenceLiveStatus } from '@/renderer/state/confluence-live-sync';

const START = Date.parse('2026-11-15T12:00:00.000Z');
const SECOND = 1_000;
const pause = (retryAt: number): ConfluenceLivePublishResult => ({ status: 'retry', message: 'Confluence hat um eine Pause gebeten. Die Veröffentlichung wird danach automatisch fortgesetzt.', uploaded: 0, bodyUpdated: false, retryAt: new Date(retryAt).toISOString() });
const synced = (): ConfluenceLivePublishResult => ({ status: 'synced', message: 'Diagramm in Confluence aktualisiert.', uploaded: 1, bodyUpdated: false, syncedAt: new Date(Date.now()).toISOString() });

beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(START); });
afterEach(() => { vi.useRealTimers(); });

/** The scheduler alone, with a controlled clock: every publish call is recorded with its time and content. */
function harness(answer: (call: number) => ConfluenceLivePublishResult, options: { retryDelaysMs?: number[] } = {}) {
  let content = 0;
  let context: ConfluenceLiveContext = { kind: 'active', key: 'file\nprofile\nsite\npage', handleId: 'handle', document: { id: 'document:aws', title: 'AWS' } as SketchDocument };
  const published: Array<{ at: number; hash: string }> = [];
  const statuses: ConfluenceLiveStatus[] = [];
  const sync = createConfluenceLiveSync({
    context: () => context,
    render: async (): Promise<ConfluenceLiveImage[]> => [{ pageId: 'page:1', name: 'Übersicht', hash: String(content).padStart(64, '0'), width: 10, height: 10, png: new Uint8Array() }],
    publish: async (input: ConfluenceLivePublishInput) => { published.push({ at: Date.now() - START, hash: input.images[0]!.hash }); return answer(published.length); },
    onStatus: (status) => { statuses.push(status); },
    debounceMs: 3 * SECOND, retryDelaysMs: options.retryDelaysMs ?? [5 * SECOND, 15 * SECOND, 45 * SECOND, 120 * SECOND, 300 * SECOND], failureHoldMs: 60 * SECOND,
  });
  return {
    sync, published, statuses, status: () => statuses.at(-1)!,
    edit() { content++; sync.documentChanged(); },
    setContext(next: ConfluenceLiveContext) { context = next; sync.contextChanged(); },
  };
}

describe('scheduling of Confluence publications under a server pause (#210)', () => {
  it('lets no edit, manual start or recovered network reach the server before a 3600-second Retry-After has passed', async () => {
    const h = harness((call) => call === 1 ? pause(START + 3 * SECOND + 3600 * SECOND) : synced());
    h.sync.contextChanged();
    await vi.advanceTimersByTimeAsync(3 * SECOND);
    expect(h.published).toEqual([{ at: 3 * SECOND, hash: '0'.padStart(64, '0') }]);
    expect(h.status()).toMatchObject({ state: 'retrying', retryAt: '2026-11-15T13:00:03.000Z' });
    expect(h.status().message).toContain('um eine Pause gebeten');

    // Everything that normally starts an attempt, spread over the hour.
    for (const minutes of [1, 5, 20, 45, 59]) {
      await vi.advanceTimersByTimeAsync(minutes * 60 * SECOND - (Date.now() - START - 3 * SECOND));
      h.edit(); h.edit();
      h.sync.syncNow();
      h.sync.recover();
      await vi.advanceTimersByTimeAsync(30 * SECOND);
      expect(h.published).toHaveLength(1);
      // Waiting is shown as waiting, with its end, not as a hang.
      expect(h.status()).toMatchObject({ state: 'retrying', retryAt: '2026-11-15T13:00:03.000Z' });
    }
    await vi.advanceTimersByTimeAsync(START + 3 * SECOND + 3600 * SECOND - Date.now() - 1);
    expect(h.published).toHaveLength(1);

    // At the deadline exactly one attempt goes out, with the newest state.
    await vi.advanceTimersByTimeAsync(1);
    expect(h.published).toHaveLength(2);
    expect(h.published[1]).toEqual({ at: 3 * SECOND + 3600 * SECOND, hash: '10'.padStart(64, '0') });
    expect(h.status()).toMatchObject({ state: 'synced' });
    expect(h.status()).not.toHaveProperty('retryAt');
    await vi.advanceTimersByTimeAsync(3600 * SECOND);
    expect(h.published).toHaveLength(2);
  });

  it('limits the automatic attempts when the server keeps asking for pauses, says so, and starts again on the next change', async () => {
    const h = harness(() => pause(Date.now() + 600 * SECOND), { retryDelaysMs: [5 * SECOND, 15 * SECOND] });
    h.sync.contextChanged();
    await vi.advanceTimersByTimeAsync(24 * 3600 * SECOND);
    // The first attempt and two retries, each not before the pause of the one before it ended.
    expect(h.published.map((entry) => entry.at)).toEqual([3 * SECOND, 603 * SECOND, 1203 * SECOND]);
    expect(h.status().state).toBe('error');
    expect(h.status().message).toContain('Automatische Wiederholungen sind pausiert');

    // Not a silent dead end: a change starts a new round, a manual start as well.
    h.edit();
    await vi.advanceTimersByTimeAsync(3 * SECOND);
    expect(h.published).toHaveLength(4);
    const round = h.published.length;
    await vi.advanceTimersByTimeAsync(24 * 3600 * SECOND);
    expect(h.published.length).toBe(round + 2);
    h.sync.syncNow();
    await vi.advanceTimersByTimeAsync(1);
    expect(h.published.length).toBe(round + 3);
  });

  it('applies the ordinary growing pauses when the server names no deadline', async () => {
    const h = harness((call) => call < 3 ? { status: 'retry', message: 'Confluence ist nicht erreichbar.', uploaded: 0, bodyUpdated: false } : synced());
    h.sync.contextChanged();
    await vi.advanceTimersByTimeAsync(60 * SECOND);
    expect(h.published.map((entry) => entry.at)).toEqual([3 * SECOND, 8 * SECOND, 23 * SECOND]);
    expect(h.status().state).toBe('synced');
  });

  it('drops the pause of one site when the publication belongs to another link', async () => {
    const h = harness((call) => call === 1 ? pause(START + 3600 * SECOND) : synced());
    h.sync.contextChanged();
    await vi.advanceTimersByTimeAsync(3 * SECOND);
    expect(h.published).toHaveLength(1);
    h.setContext({ kind: 'active', key: 'file\nother-profile\nother-site\npage', handleId: 'handle', document: { id: 'document:aws', title: 'AWS' } as SketchDocument });
    await vi.advanceTimersByTimeAsync(3 * SECOND);
    // The main process decides per site; this side does not hold another site back.
    expect(h.published).toHaveLength(2);
  });
});

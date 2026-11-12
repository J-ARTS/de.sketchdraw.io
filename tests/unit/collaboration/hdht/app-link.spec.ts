import { describe, expect, it, vi } from 'vitest';
import { IPC_CHANNELS } from '../../../../electron/ipc-contract';
import { createPreloadDesktopBridge, type IpcRendererAdapter } from '../../../../electron/preload';
import { APP_LINK_BASE, findAppLink, isAppLinkFragment, parseAppLink } from '../../../../src/collaboration/hdht/app-link';
import { bytesToBase64Url, randomBytes } from '../../../../src/collaboration/hdht/codec';
import { buildHdhtLink, createSessionId, isHdhtLink, parseHdhtInvitation, type HdhtInvitation } from '../../../../src/collaboration/hdht/invitation';

function invitation(): HdhtInvitation {
  return {
    version: 1, sessionId: createSessionId(), hostKey: bytesToBase64Url(randomBytes(32)), directKey: 'cd'.repeat(32),
    relayUrl: '', documentId: 'document:1', expiresAt: Date.now() + 60_000,
  };
}

describe('app link', () => {
  it('extracts exactly the invitation fragment the link builder writes', () => {
    const value = invitation();
    const link = buildHdhtLink(value);
    expect(link.startsWith(`${APP_LINK_BASE}#sketchdraw-hdht=`)).toBe(true);
    const fragment = parseAppLink(link);
    expect(fragment).toBe(link.slice(link.indexOf('#') + 1));
    expect(isAppLinkFragment(fragment)).toBe(true);
    expect(isHdhtLink(fragment!)).toBe(true);
    expect(parseHdhtInvitation(fragment!)).toEqual(value);
    // Operating systems may normalise scheme, host case and a trailing slash.
    expect(parseAppLink(link.replace('sketchdraw://join#', 'SKETCHDRAW://Join/#'))).toBe(fragment);
  });

  it('rejects every other scheme, host, path, parameter and payload character', () => {
    const fragment = parseAppLink(buildHdhtLink(invitation()))!;
    for (const value of [
      `https://de.sketchdraw.io/#${fragment}`, `sketchdraw://open#${fragment}`, `sketchdraw://join/extra#${fragment}`,
      `sketchdraw://join?x=1#${fragment}`, `sketchdraw://user@join#${fragment}`, `sketchdraw://join#${fragment}&pin=123456`,
      `sketchdraw://join#${fragment} --inspect`, `sketchdraw://join#${fragment}%0a`, 'sketchdraw://join#sketchdraw-hdht=', 'sketchdraw://join',
      `sketchdraw://join#sketchdraw-hdht=${'A'.repeat(5601)}`, `sketchdraw://join#sketchdraw-session=${'A'.repeat(64)}`,
      `--flag=sketchdraw://join#${fragment}`, '', null, undefined, 7, {}, [`sketchdraw://join#${fragment}`],
    ]) expect(parseAppLink(value), String(value).slice(0, 60)).toBeNull();
    expect(isAppLinkFragment(`${fragment}&x=1`)).toBe(false);
    expect(isAppLinkFragment(`sketchdraw://join#${fragment}`)).toBe(false);
  });

  it('finds the link among command line arguments and ignores everything else', () => {
    const first = buildHdhtLink(invitation()), second = buildHdhtLink(invitation());
    expect(findAppLink(['/opt/Sketchdraw/sketchdraw', '--no-sandbox', first])).toBe(parseAppLink(first));
    expect(findAppLink(['app.exe', first, '--allow-file-access-from-files', second])).toBe(parseAppLink(second));
    expect(findAppLink(['app.exe', '--url=https://example.org/#sketchdraw-hdht=AAAAAAAAAAAAAAAAAAAA', 42, null])).toBeNull();
    expect(findAppLink([])).toBeNull();
  });
});

describe('preload invite link bridge', () => {
  function fakeIpc(pending: unknown[]) {
    const listeners = new Map<string, Set<(...args: unknown[]) => void>>();
    const invoke = vi.fn(async (channel: string) => channel === IPC_CHANNELS.INVITE_LINK_TAKE ? (pending.shift() ?? null) : undefined);
    const ipc: IpcRendererAdapter = {
      invoke,
      on(channel, listener) { (listeners.get(channel) ?? listeners.set(channel, new Set()).get(channel)!).add(listener as (...args: unknown[]) => void); },
      removeListener(channel, listener) { listeners.get(channel)?.delete(listener as (...args: unknown[]) => void); },
    };
    const emit = (channel: string, ...args: unknown[]) => { for (const listener of Array.from(listeners.get(channel) ?? [])) listener({}, ...args); };
    return { ipc, invoke, emit, count: (channel: string) => listeners.get(channel)?.size ?? 0 };
  }
  const settle = () => new Promise(resolve => setTimeout(resolve, 0));

  it('takes a link that was pending before the listener existed, then every announced one', async () => {
    const first = parseAppLink(buildHdhtLink(invitation()))!, second = parseAppLink(buildHdhtLink(invitation()))!;
    const fake = fakeIpc([first]);
    const bridge = createPreloadDesktopBridge({ ipc: fake.ipc });
    const received: string[] = [];
    const off = bridge.onInviteLink!(link => received.push(link));
    await settle();
    expect(received).toEqual([first]);
    // The event itself carries no payload; a forged argument is never used.
    fake.emit(IPC_CHANNELS.INVITE_LINK_EVENT, 'sketchdraw-hdht=FORGEDFORGEDFORGEDFORGED');
    await settle();
    expect(received).toEqual([first]);
    fake.invoke.mockImplementationOnce(async () => second);
    fake.emit(IPC_CHANNELS.INVITE_LINK_EVENT);
    await settle();
    expect(received).toEqual([first, second]);
    off();
    expect(fake.count(IPC_CHANNELS.INVITE_LINK_EVENT)).toBe(0);
  });

  it('drops values that are not a validated link fragment and survives a failing main process', async () => {
    const fake = fakeIpc(['https://evil.example/#sketchdraw-hdht=AAAAAAAAAAAAAAAAAAAA', { link: 'x' }]);
    const bridge = createPreloadDesktopBridge({ ipc: fake.ipc });
    const received: string[] = [];
    const off = bridge.onInviteLink!(link => received.push(link));
    await settle();
    fake.emit(IPC_CHANNELS.INVITE_LINK_EVENT);
    await settle();
    fake.invoke.mockImplementationOnce(async () => { throw new Error('unauthorized'); });
    fake.emit(IPC_CHANNELS.INVITE_LINK_EVENT);
    await settle();
    expect(received).toEqual([]);
    off();
    expect(() => bridge.onInviteLink!(undefined as unknown as (link: string) => void)).toThrow();
  });
});

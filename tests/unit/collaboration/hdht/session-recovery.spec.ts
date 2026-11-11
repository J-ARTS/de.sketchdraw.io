import { afterEach, describe, expect, it, vi } from 'vitest';
import { DirectLink } from '@/collaboration/hdht/direct-link';
import { frameMessage, jsonBody, MESSAGE } from '@/collaboration/hdht/codec';
import type { HdhtInvitation } from '@/collaboration/hdht/invitation';
import { createHdhtGuestTransport, type HdhtGuestConfig } from '@/collaboration/hdht/session';
import type { SecureChannel } from '@/collaboration/hdht/types';

type Reply = { code: string; retryAfterMs?: unknown; attemptsLeft?: unknown } | 'ok' | 'wait';
const cleanups: (() => Promise<void> | void)[] = [];
afterEach(async () => { for (const cleanup of cleanups.splice(0).reverse()) await cleanup(); vi.useRealTimers(); });
const invitation: HdhtInvitation = { version: 1, sessionId: 'a'.repeat(64), hostKey: 'a'.repeat(43), directKey: 'b'.repeat(64), relayUrl: '', documentId: 'doc', expiresAt: 9_999_999_999_999 };

function setup(replies: Reply[], options: Partial<HdhtGuestConfig> = {}) {
  const channels: { channel: SecureChannel; disconnect(): void; receive(type: number, body: Uint8Array): void; sent: Uint8Array[] }[] = [];
  const link = new DirectLink({ hostStart: async () => ({ publicKey: invitation.directKey }), hostStop: async () => {}, connect: async () => {}, send: async () => {}, close: async () => {}, onEvent: () => () => {}, discover: async () => [] });
  vi.spyOn(link, 'connect').mockImplementation(async () => {
    const reply = replies[channels.length] ?? 'ok';
    let handlers: Parameters<SecureChannel['attach']>[0];
    const sent: Uint8Array[] = [];
    const channel: SecureChannel = {
      route: 'direct', binding: new Uint8Array(32), close() {},
      async send(data) { sent.push(data); },
      attach(value) {
        handlers = value;
        // This fixture exercises session state after a channel has proved the host, without a network/crypto race.
        if (reply === 'ok') handlers.message(frameMessage(MESSAGE.authOk, jsonBody({ role: 'editor', documentId: invitation.documentId })));
        else if (reply !== 'wait') handlers.message(frameMessage(MESSAGE.authFail, jsonBody(reply)));
      },
    };
    channels.push({ channel, sent, disconnect: () => handlers.close('NETWORK_CUT'), receive: (type, body) => handlers.message(frameMessage(type, body)) });
    return channel;
  });
  vi.useFakeTimers();
  const guest = createHdhtGuestTransport({ invitation, pin: '123456', direct: link, helpers: false, backoffMs: [10], maxReconnectAttempts: 4, timing: { heartbeatMs: 2_000_000, timeoutMs: 4_000_000 }, ...options });
  cleanups.push(() => { link.dispose(); return guest.close(); });
  return { guest, channels };
}

describe('bounded recovery after authentication', () => {
  it('waits out a PIN cooldown after a prior connection and authenticates again', async () => {
    const { guest, channels } = setup(['ok', { code: 'PIN_LOCKED', retryAfterMs: 1500 }, 'ok']);
    await vi.advanceTimersByTimeAsync(0);
    expect(guest.getStatus().state).toBe('ready');
    channels[0]!.disconnect();
    await vi.advanceTimersByTimeAsync(20);
    expect(guest.getStatus()).toMatchObject({ state: 'reconnecting', error: 'PIN_LOCKED', retryAfterMs: 1500 });
    expect(channels).toHaveLength(2);
    await vi.advanceTimersByTimeAsync(1400);
    expect(channels).toHaveLength(2);
    await vi.advanceTimersByTimeAsync(110);
    expect(channels).toHaveLength(3);
    expect(guest.getStatus()).toMatchObject({ state: 'ready' });
    expect(guest.getStatus().error).toBeUndefined();
  });

  it.each(['PIN_LOCKED', 'PIN_INVALID', 'PIN_RETIRED'])('keeps %s final for a guest that has never authenticated', async code => {
    const { guest, channels } = setup([{ code, retryAfterMs: 1000 }]);
    await vi.advanceTimersByTimeAsync(2000);
    expect(guest.getStatus()).toMatchObject({ state: 'error', error: code });
    expect(channels).toHaveLength(1);
  });

  it.each(['PIN_INVALID', 'PIN_RETIRED'])('does not bypass %s after an earlier successful connection', async code => {
    const { guest, channels } = setup(['ok', { code }]);
    await vi.advanceTimersByTimeAsync(0);
    channels[0]!.disconnect();
    await vi.advanceTimersByTimeAsync(2000);
    expect(guest.getStatus()).toMatchObject({ state: 'error', error: code });
    expect(channels).toHaveLength(2);
  });

  it.each([[-100, 1000], ['999999999', 1000], [1e30, 900_000]])('bounds untrusted cooldown %s to %s milliseconds', async (received, expected) => {
    const { guest, channels } = setup(['ok', { code: 'PIN_LOCKED', retryAfterMs: received, attemptsLeft: -5 }, 'ok']);
    await vi.advanceTimersByTimeAsync(0);
    channels[0]!.disconnect();
    await vi.advanceTimersByTimeAsync(20);
    expect(guest.getStatus()).toMatchObject({ retryAfterMs: expected, attemptsLeft: 0 });
    await vi.advanceTimersByTimeAsync(Number(expected) - 21);
    expect(channels).toHaveLength(2);
    await vi.advanceTimersByTimeAsync(22);
    expect(channels).toHaveLength(3);
    expect(guest.getStatus().state).toBe('ready');
  });

  it('ends repeated short authenticated connections instead of resetting the attempt budget each time', async () => {
    const { guest, channels } = setup(['ok', 'ok', 'ok'], { maxReconnectAttempts: 3 });
    await vi.advanceTimersByTimeAsync(0);
    for (let at = 0; at < 3; at++) {
      expect(guest.getStatus().state).toBe('ready');
      channels[at]!.disconnect();
      await vi.advanceTimersByTimeAsync(20);
    }
    expect(guest.getStatus()).toMatchObject({ state: 'error', error: 'CONNECTION_LOST' });
    expect(channels).toHaveLength(3);
  });

  it('resets the budget only after thirty seconds of stable authentication', async () => {
    const { guest, channels } = setup(['ok', 'ok', 'ok', 'ok', 'ok'], { maxReconnectAttempts: 3 });
    await vi.advanceTimersByTimeAsync(0);
    channels[0]!.disconnect();
    await vi.advanceTimersByTimeAsync(20);
    await vi.advanceTimersByTimeAsync(30_000);
    channels[1]!.disconnect();
    await vi.advanceTimersByTimeAsync(20);
    channels[2]!.disconnect();
    await vi.advanceTimersByTimeAsync(20);
    channels[3]!.disconnect();
    await vi.advanceTimersByTimeAsync(20);
    expect(guest.getStatus().state).toBe('ready');
    channels[4]!.disconnect();
    await vi.advanceTimersByTimeAsync(20);
    expect(guest.getStatus()).toMatchObject({ state: 'error', error: 'CONNECTION_LOST' });
    expect(channels).toHaveLength(5);
  });

  it('also bounds repeated PIN_LOCKED responses after the connection was lost', async () => {
    const { guest, channels } = setup(['ok', { code: 'PIN_LOCKED', retryAfterMs: 1000 }, { code: 'PIN_LOCKED', retryAfterMs: 1000 }], { maxReconnectAttempts: 3 });
    await vi.advanceTimersByTimeAsync(0);
    channels[0]!.disconnect();
    await vi.advanceTimersByTimeAsync(2500);
    expect(guest.getStatus()).toMatchObject({ state: 'error', error: 'CONNECTION_LOST' });
    expect(channels).toHaveLength(3);
  });
});

describe('safe terminal sync reasons', () => {
  it.each(['SYNC_FAILED', 'DOCUMENT_TOO_LARGE_FOR_COLLABORATION'])('treats authenticated host %s as final without reconnect', async reason => {
    const { guest, channels } = setup(['ok']);
    await vi.advanceTimersByTimeAsync(0);
    channels[0]!.receive(MESSAGE.bye, new TextEncoder().encode(reason));
    await vi.advanceTimersByTimeAsync(2000);
    expect(guest.getStatus()).toMatchObject({ state: 'error', error: reason });
    expect(channels).toHaveLength(1);
  });

  it('does not trust a sync-failure bye before authentication', async () => {
    const { guest, channels } = setup(['wait', 'ok']);
    await vi.advanceTimersByTimeAsync(0);
    channels[0]!.receive(MESSAGE.bye, new TextEncoder().encode('SYNC_FAILED'));
    await vi.advanceTimersByTimeAsync(20);
    expect(guest.getStatus().state).toBe('ready');
    expect(guest.getStatus().error).toBeUndefined();
  });

  it.each(['SYNC_FAILED', 'DOCUMENT_TOO_LARGE_FOR_COLLABORATION'])('preserves local %s in status and sends the reason to the host', async reason => {
    const { guest, channels } = setup(['ok']);
    await vi.advanceTimersByTimeAsync(0);
    await guest.close(reason);
    expect(guest.getStatus()).toMatchObject({ state: 'closed', error: reason });
    const goodbye = channels[0]!.sent.find(data => data[0] === MESSAGE.bye)!;
    expect(new TextDecoder().decode(goodbye.subarray(1))).toBe(reason);
  });

  it('does not expose arbitrary externally supplied close text', async () => {
    const { guest, channels } = setup(['ok']);
    await vi.advanceTimersByTimeAsync(0);
    await guest.close('SECRET_OR_UNTRUSTED_TEXT');
    expect(guest.getStatus().error).toBeUndefined();
    const goodbye = channels[0]!.sent.find(data => data[0] === MESSAGE.bye)!;
    expect(new TextDecoder().decode(goodbye.subarray(1))).toBe('SESSION_LEFT');
  });
});

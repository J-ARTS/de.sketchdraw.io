import { afterEach, describe, expect, it, vi } from 'vitest';
import { DirectLink } from '@/collaboration/hdht/direct-link';
import { createSessionId, type HdhtInvitation } from '@/collaboration/hdht/invitation';
import { createHostKeys, hostKeyToText } from '@/collaboration/hdht/relay-channel';
import { createHdhtGuestTransport, createHdhtHostTransport } from '@/collaboration/hdht/session';
import type { DirectBridge, SecureChannel } from '@/collaboration/hdht/types';

function bridge(discover: DirectBridge['discover'] = async () => []) {
  return new DirectLink({
    hostStart: async () => ({ publicKey: 'a'.repeat(64) }), hostStop: async () => {},
    connect: async () => {}, send: async () => {}, close: async () => {}, onEvent: () => () => {}, discover,
  });
}
afterEach(() => vi.useRealTimers());

describe('session lifecycle across asynchronous routes', () => {
  it('keeps a cold direct route alive beyond four seconds within the overall connection deadline', async () => {
    const keys = await createHostKeys();
    const link = bridge();
    const invitation: HdhtInvitation = {
      version: 1, sessionId: createSessionId(), hostKey: hostKeyToText(keys), directKey: 'a'.repeat(64), relayUrl: '', documentId: 'doc', expiresAt: Date.now() + 60_000,
    };
    let directSignal: AbortSignal | undefined;
    vi.spyOn(link, 'connect').mockImplementation((_key, signal) => {
      directSignal = signal;
      return new Promise<SecureChannel>(() => {});
    });
    vi.useFakeTimers();
    const guest = createHdhtGuestTransport({ invitation, pin: '123456', direct: link, helpers: false, maxInitialAttempts: 1 });
    try {
      await vi.advanceTimersByTimeAsync(6000);
      expect(directSignal?.aborted).toBe(false);
      expect(guest.getStatus()).toMatchObject({ state: 'connecting', attempt: 1 });
      await vi.advanceTimersByTimeAsync(14_000);
      expect(directSignal?.aborted).toBe(true);
      expect(guest.getStatus()).toMatchObject({ state: 'error', error: 'HOST_UNREACHABLE' });
    } finally { await guest.close(); link.dispose(); }
  });
  it('cancels the overall attempt deadline even when native discovery never resolves', async () => {
    const keys = await createHostKeys();
    let began!: () => void;
    const entered = new Promise<void>(resolve => { began = resolve; });
    const link = bridge(() => { began(); return new Promise(() => {}); });
    const invitation: HdhtInvitation = {
      version: 1, sessionId: createSessionId(), hostKey: hostKeyToText(keys), directKey: '', relayUrl: '', documentId: 'doc', expiresAt: Date.now() + 60_000,
    };
    vi.useFakeTimers();
    const guest = createHdhtGuestTransport({ invitation, pin: '123456', direct: link, attemptTimeoutMs: 20_000 });
    try {
      await entered;
      expect(vi.getTimerCount()).toBeGreaterThan(0);
      await guest.close();
      expect(guest.getStatus().state).toBe('closed');
      expect(vi.getTimerCount()).toBe(0);
      await vi.advanceTimersByTimeAsync(30_000);
      expect(guest.getStatus().state).toBe('closed');
    } finally { await guest.close(); link.dispose(); }
  });

  it('attaches a delayed native listener without restarting the session and rejects post-close attachment', async () => {
    const keys = await createHostKeys();
    const link = bridge();
    const host = createHdhtHostTransport({ sessionId: createSessionId(), documentId: 'doc', hostKeys: keys, expiresAt: Date.now() + 60_000, grantedRole: () => 'editor' });
    vi.useFakeTimers();
    try {
      const pin = host.getPin();
      expect(host.directKey).toBe('');
      host.attachDirect(link, 'a'.repeat(64));
      expect(host.directKey).toBe('a'.repeat(64));
      expect(host.getStatus().state).toBe('ready');
      expect(host.getPin()).toBe(pin);
      expect(() => host.attachDirect(link, 'a'.repeat(64))).not.toThrow();
      expect(() => host.attachDirect(link, 'b'.repeat(64))).toThrow('DIRECT_ALREADY_ATTACHED');
      await host.close();
      expect(vi.getTimerCount()).toBe(0);
      expect(() => host.attachDirect(link, 'a'.repeat(64))).toThrow('TRANSPORT_CLOSED');
    } finally { await host.close(); link.dispose(); }
  });
});

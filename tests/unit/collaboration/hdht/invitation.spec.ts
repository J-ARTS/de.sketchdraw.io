import { describe, expect, it } from 'vitest';
import { bytesToBase64Url, randomBytes } from '../../../../src/collaboration/hdht/codec';
import {
  buildHdhtLink, checkedRelayUrl, createSessionId, HDHT_LINK_PARAM, isHdhtLink, parseHdhtInvitation, type HdhtInvitation,
} from '../../../../src/collaboration/hdht/invitation';

function invitation(overrides: Partial<HdhtInvitation> = {}): HdhtInvitation {
  return {
    version: 1, sessionId: createSessionId(), hostKey: bytesToBase64Url(randomBytes(32)), directKey: 'ab'.repeat(32),
    relayUrl: 'wss://relay.example.org/', documentId: 'doc-1', expiresAt: Date.now() + 60_000, ...overrides,
  };
}

describe('session link', () => {
  it('round trips through the URL fragment and carries no PIN', () => {
    const value = invitation();
    const link = buildHdhtLink(value, 'https://de.sketchdraw.io/');
    expect(link.startsWith('https://de.sketchdraw.io/#' + HDHT_LINK_PARAM + '=')).toBe(true);
    expect(link).not.toMatch(/pin/i);
    expect(isHdhtLink(link)).toBe(true);
    expect(parseHdhtInvitation(link)).toEqual(value);
  });

  it('rejects expired, malformed and unsafe links', () => {
    const now = Date.now();
    expect(() => parseHdhtInvitation(buildHdhtLink(invitation({ expiresAt: now - 1 }), 'https://x.example/'), now)).toThrow('INVITATION_EXPIRED');
    expect(() => parseHdhtInvitation('https://x.example/#sketchdraw-hdht=%%%')).toThrow('INVITATION_INVALID');
    expect(() => parseHdhtInvitation('https://x.example/')).toThrow('INVITATION_INVALID');
    expect(() => parseHdhtInvitation(buildHdhtLink(invitation({ relayUrl: 'ws://evil.example/' }), 'https://x.example/'))).toThrow('RELAY_URL_INSECURE');
    expect(() => parseHdhtInvitation(buildHdhtLink(invitation({ expiresAt: now + 30 * 3600_000 }), 'https://x.example/'), now)).toThrow('INVITATION_INVALID');
  });

  it('accepts a link without any fixed endpoint: helpers are discovered through the DHT', () => {
    const value = invitation({ directKey: '', relayUrl: '' });
    expect(parseHdhtInvitation(buildHdhtLink(value, 'https://x.example/'))).toEqual(value);
  });

  it('relay URLs must be wss without credentials, query or fragment; ws only on loopback', () => {
    expect(checkedRelayUrl('wss://relay.example.org/')).toBe('wss://relay.example.org/');
    expect(checkedRelayUrl('ws://127.0.0.1:8787/')).toBe('ws://127.0.0.1:8787/');
    expect(checkedRelayUrl('ws://[::1]:8787/v1')).toBe('ws://localhost:8787/v1');
    expect(checkedRelayUrl('wss://[::1]:8787/')).toBe('wss://[::1]:8787/');
    for (const bad of ['ws://relay.example.org/', 'https://relay.example.org/', 'wss://user:pw@relay.example.org/', 'wss://relay.example.org/?token=1', 'wss://relay.example.org/#x', 'wss://relay .example.org/', '']) {
      expect(() => checkedRelayUrl(bad)).toThrow();
    }
  });
});

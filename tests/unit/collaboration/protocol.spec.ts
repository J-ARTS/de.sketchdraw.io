import { describe, expect, it } from 'vitest';
import { createSessionIdentity } from '../../../src/collaboration';
import { comparison, importKey, pairText, parsePair, sign, validateSdp, verify } from '../../../src/collaboration/crypto';
import type { PairPayload } from '../../../src/collaboration/crypto';
import { base64, decode, LIMIT, parse, unbase64, utf8 } from '../../../src/collaboration/primitives';
import { manifest, wire } from '../../../src/collaboration/wire';
import { RtcDouble } from './rtc-double';

const session = { documentId: 'document:unit', controllerEpoch: 'a'.repeat(32), sessionId: 'b'.repeat(32), permissionEpoch: 0 };
describe('strict signed pairing and wire boundaries', () => {
  it('verifies the exact payload bytes with real non-extractable ECDSA identities', async () => {
    const identity = await createSessionIdentity();
    expect(Object.keys(identity).sort()).toEqual(['keyHash', 'publicKeyBase64Url']);
    const key = await importKey(identity.publicKeyBase64Url);
    const signed = await sign(identity, { message: 'Grüße 👩🏽‍💻', n: 1 });
    await expect(verify(signed, key)).resolves.toBeUndefined();
    await expect(verify({ ...signed, payload: signed.payload.replace(':1', ': 1') }, key)).rejects.toMatchObject({ code: 'ACCESS_DENIED' });
    expect(unbase64(signed.signature, 64)).toHaveLength(64);
    const other = await createSessionIdentity();
    await expect(verify(signed, await importKey(other.publicKeyBase64Url))).rejects.toMatchObject({ code: 'ACCESS_DENIED' });
  });
  it('rejects duplicate escaped JSON keys, forbidden records, depth bombs and non-JSON values', () => {
    for (const text of ['{"a":1,"\\u0061":2}', '{"__proto__":{}}', '{"constructor":1}', '[NaN]', '{"x":1,}', '{/* hi */"x":1}', '['.repeat(17) + '0' + ']'.repeat(17)]) {
      expect(() => parse(text, 4096)).toThrow();
    }
    expect(parse('{"a":[true,null,1.25],"unicode":"Ä"}', 4096)).toEqual({ a: [true, null, 1.25], unicode: 'Ä' });
    expect(() => parse('"€€"', 7)).toThrow();
  });
  it('validates manual pairing signatures and hashes full signed transcripts for the full comparison code', async () => {
    const identity = await createSessionIdentity(); const pc = new RtcDouble({ iceServers: [] }); const sdp = await pc.sdp('actpass');
    const payload: PairPayload = { version: 1, type: 'offer', session, invitationId: 'c'.repeat(32), nonce: 'd'.repeat(64),
      createdAt: 1, expiresAt: 1001, publicKeyBase64Url: identity.publicKeyBase64Url, sdp,
      dtlsFingerprint: validateSdp(sdp, 'offer'), role: 'editor', resumePeerId: null, offerHash: null };
    const text = await pairText(identity, payload); const parsed = await parsePair(text, 'offer');
    expect(parsed.payload.sdp).toBe(sdp); expect(parsed.keyHash).toBe(identity.keyHash);
    const comparisonCode = await comparison(parsed.hash, 'e'.repeat(64));
    expect(comparisonCode.code.replace(/-/g, '')).toHaveLength(32);
    const json = JSON.parse(decode(unbase64(text, LIMIT.pairing)));
    json.payload = json.payload.replace('editor', 'viewer');
    await expect(parsePair(base64(utf8.encode(JSON.stringify(json))), 'offer')).rejects.toMatchObject({ code: 'ACCESS_DENIED' });
    await expect(parsePair(text + '=', 'offer')).rejects.toBeDefined();
    await expect(parsePair('x'.repeat(LIMIT.pairingText + 1), 'offer')).rejects.toMatchObject({ code: 'REQUEST_TOO_LARGE' });
  });
  it('rejects media, duplicate fingerprints, relay/service-derived candidates and absent candidates', async () => {
    const pc = new RtcDouble({ iceServers: [] }); const sdp = await pc.sdp('actpass');
    expect(validateSdp(sdp, 'offer')).toHaveLength(64);
    for (const invalid of [sdp.replace('typ host', 'typ relay'), sdp.replace('typ host', 'typ srflx'),
      sdp + 'm=audio 9 UDP/TLS/RTP/SAVPF 0\r\n', sdp + sdp.split('\r\n').find(line => line.startsWith('a=fingerprint:')) + '\r\n',
      sdp.replace(/a=candidate:[^\r]+\r\n/, ''), sdp.replace('sha-256', 'sha-1')]) {
      expect(() => validateSdp(invalid, 'offer')).toThrow();
    }
  });
  it('enforces byte/chunk count arithmetic and closed control schemas before allocation', () => {
    const good = { transferId: 'a'.repeat(32), purpose: 'snapshot', bytes: LIMIT.snapshot, hash: 'b'.repeat(64),
      chunkSize: 16352, chunks: Math.ceil(LIMIT.snapshot / 16352), revision: 7, previousHash: null, requestId: null };
    expect(() => manifest(good)).not.toThrow();
    for (const bad of [{ ...good, bytes: LIMIT.snapshot + 1 }, { ...good, chunks: good.chunks + 1 },
      { ...good, chunkSize: 16384 }, { ...good, revision: Number.MAX_SAFE_INTEGER + 1 }, { ...good, chunkSize: 1, chunks: LIMIT.snapshot }]) {
      expect(() => manifest(bad)).toThrow();
    }
    const ping = { version: 1, type: 'ping', session, connectionId: 'c'.repeat(32), nonce: 'd'.repeat(32) };
    expect(wire(JSON.stringify(ping)).type).toBe('ping');
    expect(() => wire(JSON.stringify({ ...ping, actorId: 'owner' }))).toThrow();
    expect(() => wire(JSON.stringify({ ...ping, type: 'unknown' }))).toThrow();
    const proposal = { version: 1, type: 'proposal', session, connectionId: 'c'.repeat(32), scopeId: 'd'.repeat(32),
      requestId: `${'d'.repeat(32)}:1`, clientSequence: 1, expectedRevision: 7, kind: 'undo',
      commandTransferId: null, commandHash: null, digest: 'e'.repeat(64) };
    expect(() => wire(JSON.stringify(proposal))).not.toThrow();
    expect(() => wire(JSON.stringify({ ...proposal, expectedRevision: null }))).toThrow();
    expect(() => wire(JSON.stringify({ ...proposal, digest: null }))).toThrow();

  });
});

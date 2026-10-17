import type { SessionIdentity } from './types';
import type { PeerSessionKey } from '../session';
import { base64, unbase64, sha, utf8, fail, parse, shape, hex, integer, sessionKey, LIMIT, decode } from './primitives';

const identities = new WeakMap<object, CryptoKeyPair>();
const prefix = 'sketchdraw.p2p.v1\n';
export interface SignedPayload { payload: string; signature: string }
export interface PairPayload {
  version: 1; type: 'offer' | 'answer'; session: PeerSessionKey;
  invitationId: string; nonce: string; createdAt: number; expiresAt: number;
  publicKeyBase64Url: string; sdp: string; dtlsFingerprint: string;
  role: 'editor' | 'viewer'; resumePeerId: string | null; offerHash: string | null;
}
export interface ParsedPair { payload: PairPayload; signed: SignedPayload; json: string; hash: string; key: CryptoKey; keyHash: string }
function identityKeys(identity: SessionIdentity): CryptoKeyPair {
  const keys = identity && identities.get(identity);
  if (!keys) fail('ACCESS_DENIED', 'IDENTITY_HANDLE_INVALID');
  return keys;
}
export function assertIdentity(identity: SessionIdentity): void { identityKeys(identity); }
export async function createSessionIdentity(): Promise<SessionIdentity> {
  try {
    const keys = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, false, ['sign', 'verify']);
    const bytes = new Uint8Array(await crypto.subtle.exportKey('raw', keys.publicKey));
    const handle = Object.freeze({ publicKeyBase64Url: base64(bytes), keyHash: await sha(bytes) }) as SessionIdentity;
    identities.set(handle, keys);
    return handle;
  } catch { return fail('INTERNAL_ERROR', 'WEBCRYPTO_UNAVAILABLE'); }
}
export async function importKey(text: string): Promise<CryptoKey> {
  const bytes = unbase64(text, 65);
  if (bytes.length !== 65 || bytes[0] !== 4) fail();
  try { return await crypto.subtle.importKey('raw', bytes, { name: 'ECDSA', namedCurve: 'P-256' }, false, ['verify']); }
  catch { return fail('ACCESS_DENIED', 'IDENTITY_KEY_INVALID'); }
}
export async function sign(identity: SessionIdentity, value: unknown): Promise<SignedPayload> {
  const keys = identityKeys(identity); const payload = JSON.stringify(value);
  const signature = await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, keys.privateKey, utf8.encode(prefix + payload));
  if (signature.byteLength !== 64) fail('INTERNAL_ERROR');
  return { payload, signature: base64(new Uint8Array(signature)) };
}
export function signedEnvelope(text: string, maxBytes: number): SignedPayload {
  const value = parse(text, maxBytes);
  shape(value, ['payload', 'signature']);
  if (typeof value.payload !== 'string' || typeof value.signature !== 'string' || value.signature.length !== 86) fail();
  return value as unknown as SignedPayload;
}
export async function verify(signed: SignedPayload, key: CryptoKey): Promise<void> {
  const signature = unbase64(signed.signature, 64);
  if (signature.length !== 64 || !await crypto.subtle.verify({ name: 'ECDSA', hash: 'SHA-256' }, key,
    signature, utf8.encode(prefix + signed.payload))) fail('ACCESS_DENIED', 'SIGNATURE_INVALID');
}
export function validateSdp(sdp: string, type: 'offer' | 'answer'): string {
  if (typeof sdp !== 'string' || utf8.encode(sdp).length > LIMIT.sdp || /\0/.test(sdp)) fail();
  const lines = sdp.split(/\r?\n/).filter(Boolean);
  const media = lines.filter(line => line.startsWith('m='));
  if (media.length !== 1 || !/^m=application \d+ UDP\/DTLS\/SCTP webrtc-datachannel$/.test(media[0]!)) fail();
  const one = (prefix: string): string => {
    const found = lines.filter(line => line.startsWith(prefix));
    if (found.length !== 1) fail(); return found[0]!.slice(prefix.length);
  };
  if (one('v=') !== '0') fail();
  one('o='); one('a=ice-ufrag:'); one('a=ice-pwd:'); one('a=sctp-port:'); one('a=mid:');
  const setup = one('a=setup:');
  if (type === 'offer' ? setup !== 'actpass' : !['active', 'passive'].includes(setup)) fail();
  const fingerprint = one('a=fingerprint:');
  if (!/^sha-256 (?:[0-9A-Fa-f]{2}:){31}[0-9A-Fa-f]{2}$/.test(fingerprint)) fail();
  const candidates = lines.filter(line => line.startsWith('a=candidate:'));
  if (!candidates.length || candidates.length > 64) fail('NOT_CONNECTED', 'NO_DIRECT_CANDIDATES');
  for (const candidate of candidates) {
    const parts = candidate.slice(12).split(/\s+/); const at = parts.indexOf('typ');
    if (at !== 6 || parts.length < 8 || !['host', 'prflx'].includes(parts[7]!)
      || parts[1] !== '1' || !['udp', 'tcp'].includes(parts[2]!.toLowerCase())
      || !/^\d+$/.test(parts[3]!) || !/^\d+$/.test(parts[5]!)) fail();
  }
  if (lines.some(line => /^a=(?:ssrc:|rtpmap:|msid:|rid:|simulcast:)/.test(line))) fail();
  return fingerprint.slice(8).replace(/:/g, '').toLowerCase();
}
export async function parsePair(text: string, type: 'offer' | 'answer'): Promise<ParsedPair> {
  if (typeof text !== 'string' || text.length > LIMIT.pairingText) fail('REQUEST_TOO_LARGE');
  let json: string;
  try { json = decode(unbase64(text, LIMIT.pairing)); } catch { return fail(); }
  const signed = signedEnvelope(json, LIMIT.pairing);
  const value = parse(signed.payload, LIMIT.pairing);
  shape(value, ['version', 'type', 'session', 'invitationId', 'nonce', 'createdAt', 'expiresAt', 'publicKeyBase64Url',
    'sdp', 'dtlsFingerprint', 'role', 'resumePeerId', 'offerHash']);
  sessionKey(value.session);
  if (value.version !== 1 || value.type !== type || !hex(value.invitationId) || !hex(value.nonce, 32)
    || !integer(value.createdAt) || !integer(value.expiresAt) || value.expiresAt <= value.createdAt
    || value.expiresAt - value.createdAt > LIMIT.invitationMs || typeof value.publicKeyBase64Url !== 'string'
    || typeof value.sdp !== 'string' || !hex(value.dtlsFingerprint, 32)
    || !['editor', 'viewer'].includes(value.role as string)
    || (value.resumePeerId !== null && !hex(value.resumePeerId, 32))
    || (type === 'offer' ? value.offerHash !== null : !hex(value.offerHash, 32))) fail();
  if (validateSdp(value.sdp, type) !== value.dtlsFingerprint) fail('ACCESS_DENIED', 'SDP_FINGERPRINT_MISMATCH');
  const key = await importKey(value.publicKeyBase64Url);
  await verify(signed, key);
  return { payload: value as unknown as PairPayload, signed, json, hash: await sha(json), key,
    keyHash: await sha(unbase64(value.publicKeyBase64Url, 65)) };
}
export async function pairText(identity: SessionIdentity, payload: PairPayload): Promise<string> {
  const json = JSON.stringify(await sign(identity, payload));
  if (utf8.encode(json).length > LIMIT.pairing) fail('REQUEST_TOO_LARGE');
  return base64(utf8.encode(json));
}
export async function comparison(offerHash: string, answerHash: string): Promise<{ hash: string; code: string }> {
  const hash = await sha(`sketchdraw.pair.v1\n${offerHash}\n${answerHash}`);
  return { hash, code: hash.slice(0, 32).match(/.{4}/g)!.join('-') };
}

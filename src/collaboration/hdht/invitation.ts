import { normalizeWebAppUrl } from '../session-link';
import {
  base64UrlToBytes, bytesToBase64Url, bytesToHex, concatBytes, constantTimeEqual, hexToBytes, randomBytes, SESSION_ID_BYTES, utf8,
} from './codec';

export const HDHT_LINK_PARAM = 'sketchdraw-hdht';
export const HDHT_MAX_TTL_MS = 12 * 60 * 60 * 1000;
const LINK_LIMIT_BYTES = 4096;
const LOOPBACK_HOSTS = new Set(['127.0.0.1', 'localhost', '[::1]']);

export interface HdhtInvitation {
  version: 1;
  /** High-entropy session identifier (hex, 32 bytes). */
  sessionId: string;
  /** Ed25519 public key (base64url, 32 bytes) that authenticates the host on the relay route. */
  hostKey: string;
  /** HyperDHT public key (hex, 32 bytes) of the host's direct server; empty when the host has no direct route. */
  directKey: string;
  /** Relay endpoint; empty when the host offers no relay. */
  relayUrl: string;
  documentId: string;
  expiresAt: number;
}

/**
 * A relay endpoint must be a plain wss:// URL (ws:// only for loopback). Credentials, query strings and fragments are
 * rejected so that no secret can travel in a URL that proxies or servers log.
 */
export function checkedRelayUrl(value: unknown): string {
  if (typeof value !== 'string' || value.length === 0 || value.length > 2048 || /[\u0000-\u0020\u007f]/.test(value)) throw new TypeError('RELAY_URL_INVALID');
  let url: URL;
  try { url = new URL(value); } catch { throw new TypeError('RELAY_URL_INVALID'); }
  const loopbackPlain = url.protocol === 'ws:' && LOOPBACK_HOSTS.has(url.hostname);
  if (url.protocol !== 'wss:' && !loopbackPlain) throw new TypeError('RELAY_URL_INSECURE');
  if (url.username || url.password || url.hash || url.search || !url.hostname) throw new TypeError('RELAY_URL_INVALID');
  // Chromium CSP does not support IPv6 literals as host sources. localhost resolves to loopback (including ::1)
  // and lets us keep the policy restricted to local endpoints instead of allowing arbitrary plaintext WebSockets.
  if (loopbackPlain && url.hostname === '[::1]') url.hostname = 'localhost';
  return url.toString();
}

/** Returns the checked relay URL, or null when the text is empty. */
export function optionalRelayUrl(value: string): string | null {
  const trimmed = value.trim();
  return trimmed ? checkedRelayUrl(trimmed) : null;
}

export function createSessionId(): string { return bytesToHex(randomBytes(SESSION_ID_BYTES)); }

export function buildHdhtLink(invitation: HdhtInvitation, webAppUrl: string): string {
  const payload = { v: 1, s: invitation.sessionId, h: invitation.hostKey, d: invitation.directKey, r: invitation.relayUrl, i: invitation.documentId, e: invitation.expiresAt };
  const text = bytesToBase64Url(utf8.encode(JSON.stringify(payload)));
  return `${normalizeWebAppUrl(webAppUrl)}#${HDHT_LINK_PARAM}=${text}`;
}

/** The raw fragment value of a link of this mode, or null when the text carries none. */
function fragmentValue(text: string): string | null {
  const value = text.trim();
  if (!value || value.length > LINK_LIMIT_BYTES * 2) return null;
  const marker = `${HDHT_LINK_PARAM}=`;
  const index = value.indexOf(marker);
  if (index < 0) return null;
  return (value.slice(index + marker.length).split(/[&\s]/)[0] ?? '') || null;
}

export function isHdhtLink(text: string): boolean { return fragmentValue(text) !== null; }

export function parseHdhtInvitation(text: string, now = Date.now()): HdhtInvitation {
  const raw = fragmentValue(text);
  if (!raw) throw new Error('INVITATION_INVALID');
  let value: unknown;
  try {
    const bytes = base64UrlToBytesLoose(raw);
    value = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
  } catch { throw new Error('INVITATION_INVALID'); }
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('INVITATION_INVALID');
  const record = value as Record<string, unknown>;
  const keys = Object.keys(record).sort().join(',');
  if (keys !== 'd,e,h,i,r,s,v' || record['v'] !== 1) throw new Error('INVITATION_INVALID');
  const { s, h, d, r, i, e } = record;
  if (typeof s !== 'string' || !/^[0-9a-f]{64}$/.test(s)) throw new Error('INVITATION_INVALID');
  if (typeof h !== 'string') throw new Error('INVITATION_INVALID');
  try { base64UrlToBytes(h, 32); } catch { throw new Error('INVITATION_INVALID'); }
  if (typeof d !== 'string' || (d !== '' && !/^[0-9a-f]{64}$/.test(d))) throw new Error('INVITATION_INVALID');
  if (typeof r !== 'string') throw new Error('INVITATION_INVALID');
  let relayUrl = '';
  if (r) { try { relayUrl = checkedRelayUrl(r); } catch (error) { throw new Error(error instanceof Error ? error.message : 'INVITATION_INVALID'); } }
  if (typeof i !== 'string' || !/^[A-Za-z0-9._:-]{1,128}$/.test(i)) throw new Error('INVITATION_INVALID');
  if (typeof e !== 'number' || !Number.isSafeInteger(e)) throw new Error('INVITATION_INVALID');
  if (e - now > HDHT_MAX_TTL_MS + 60_000) throw new Error('INVITATION_INVALID');
  if (now > e) throw new Error('INVITATION_EXPIRED');
  return { version: 1, sessionId: s, hostKey: h, directKey: d, relayUrl, documentId: i, expiresAt: e };
}

function base64UrlToBytesLoose(text: string): Uint8Array {
  let decoded: Uint8Array;
  try { decoded = Uint8Array.from(atob(decodeURIComponent(text).replace(/-/g, '+').replace(/_/g, '/')), char => char.charCodeAt(0)); } catch { throw new Error('INVITATION_INVALID'); }
  if (decoded.byteLength === 0 || decoded.byteLength > LINK_LIMIT_BYTES) throw new Error('INVITATION_INVALID');
  return decoded;
}

/** Six random digits, uniformly distributed (rejection sampling). */
export function generatePin(): string {
  const limit = 4_294_000_000 - (4_294_000_000 % 1_000_000);
  for (;;) {
    const value = new DataView(randomBytes(4).buffer).getUint32(0);
    if (value < limit) return String(value % 1_000_000).padStart(6, '0');
  }
}

/** Strips separators users type or paste; returns null unless exactly six digits remain. */
export function normalizePin(text: string): string | null {
  const digits = text.replace(/[\s-]/g, '');
  return /^\d{6}$/.test(digits) ? digits : null;
}

const PIN_LABEL = utf8.encode('sketchdraw-pin-v1\0');

/** HMAC(PIN, label || channel binding || session id): valid for exactly one channel of one session. */
export async function computePinProof(pin: string, binding: Uint8Array, sessionId: string): Promise<Uint8Array> {
  const key = await crypto.subtle.importKey('raw', utf8.encode(pin), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return new Uint8Array(await crypto.subtle.sign('HMAC', key, concatBytes(PIN_LABEL, binding, hexToBytes(sessionId)) as BufferSource));
}

export interface PinGateOptions {
  now?: () => number;
  /** Failed attempts allowed before a cooldown starts; the cooldown then doubles after every further block. */
  burst?: number;
  maxFailures?: number;
  baseCooldownMs?: number;
  maxCooldownMs?: number;
}

export type PinAttemptResult =
  | { ok: true }
  | { ok: false; code: 'PIN_INVALID' | 'PIN_LOCKED' | 'PIN_RETIRED' | 'PIN_STALE'; retryAfterMs: number; attemptsLeft: number };

/**
 * Host-side PIN state. Every attempt is counted when it starts (not when it finishes) and the burst cooldown is armed
 * at that moment, so parallel guesses cannot overshoot either limit. Counting is per PIN generation, never per peer
 * identity or connection, so a new identity does not reset anything. `renew()` starts a new generation; results of
 * attempts that started under an older one are inert.
 */
export class PinGate {
  private pin: string;
  private generation = 0;
  private reserved = 0;
  private lockedUntil = 0;
  private readonly now: () => number;
  private readonly burst: number;
  private readonly maxFailures: number;
  private readonly baseCooldownMs: number;
  private readonly maxCooldownMs: number;

  constructor(options: PinGateOptions = {}) {
    this.now = options.now ?? Date.now;
    this.burst = options.burst ?? 5;
    this.maxFailures = options.maxFailures ?? 20;
    this.baseCooldownMs = options.baseCooldownMs ?? 30_000;
    this.maxCooldownMs = options.maxCooldownMs ?? 15 * 60_000;
    this.pin = generatePin();
  }

  getPin(): string { return this.pin; }

  renew(): string {
    this.generation++;
    this.pin = generatePin();
    this.reserved = 0;
    this.lockedUntil = 0;
    return this.pin;
  }

  get remainingFailures(): number { return Math.max(0, this.maxFailures - this.reserved); }

  async attempt(verify: (pin: string) => Promise<boolean>): Promise<PinAttemptResult> {
    if (this.reserved >= this.maxFailures) return { ok: false, code: 'PIN_RETIRED', retryAfterMs: 0, attemptsLeft: 0 };
    const wait = this.lockedUntil - this.now();
    if (wait > 0) return { ok: false, code: 'PIN_LOCKED', retryAfterMs: wait, attemptsLeft: 0 };
    const generation = this.generation;
    const candidate = this.pin;
    const count = ++this.reserved;
    let cooldown = 0;
    let armed = 0;
    if (count % this.burst === 0 && count < this.maxFailures) {
      cooldown = Math.min(this.maxCooldownMs, this.baseCooldownMs * 2 ** (count / this.burst - 1));
      armed = this.now() + cooldown;
      this.lockedUntil = armed;
    }
    let matches = false;
    try { matches = await verify(candidate); } catch { matches = false; }
    if (generation !== this.generation) return { ok: false, code: 'PIN_STALE', retryAfterMs: 0, attemptsLeft: 0 };
    if (matches) {
      this.reserved = Math.max(0, this.reserved - 1);
      if (armed && this.lockedUntil === armed) this.lockedUntil = 0;
      return { ok: true };
    }
    if (this.reserved >= this.maxFailures) return { ok: false, code: 'PIN_RETIRED', retryAfterMs: 0, attemptsLeft: 0 };
    return { ok: false, code: 'PIN_INVALID', retryAfterMs: cooldown, attemptsLeft: this.remainingFailures };
  }
}

export function proofEquals(a: Uint8Array, b: Uint8Array): boolean { return constantTimeEqual(a, b); }

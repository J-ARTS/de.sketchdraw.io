import type { CollaborationTransportChannel } from '../transport';

export const RELAY_SUBPROTOCOL = 'sketchdraw-relay.v1';
export const SESSION_ID_BYTES = 32;

export const MESSAGE = Object.freeze({
  auth: 0x01,
  authOk: 0x02,
  authFail: 0x03,
  sync: 0x10,
  update: 0x11,
  awareness: 0x12,
  asset: 0x13,
  ping: 0x20,
  pong: 0x21,
  bye: 0x30,
} as const);

export const CHANNEL_TYPE: Readonly<Record<CollaborationTransportChannel, number>> = Object.freeze({
  sync: MESSAGE.sync,
  update: MESSAGE.update,
  awareness: MESSAGE.awareness,
  asset: MESSAGE.asset,
});

export const CHANNEL_BY_TYPE: ReadonlyMap<number, CollaborationTransportChannel> = new Map(
  (Object.entries(CHANNEL_TYPE) as [CollaborationTransportChannel, number][]).map(([channel, type]) => [type, channel]),
);

export const CHANNEL_LIMITS: Readonly<Record<CollaborationTransportChannel, number>> = Object.freeze({
  sync: 256 * 1024,
  update: 4 * 1024 * 1024,
  awareness: 64 * 1024,
  asset: 8 * 1024 * 1024,
});

/** Largest application message including its type byte. */
export const MAX_MESSAGE_BYTES = 8 * 1024 * 1024 + 1;
/** Plaintext bytes of one relay record; ciphertext adds the 16-byte GCM tag and stays below the relay frame limit. */
export const RECORD_PLAINTEXT_BYTES = 60 * 1024;
/** Largest sealed relay record on the wire (plaintext chunk + flag byte + GCM tag + slack). */
export const MAX_RECORD_WIRE_BYTES = RECORD_PLAINTEXT_BYTES + 1 + 16 + 16;
export const OUTGOING_LIMIT_BYTES = 16 * 1024 * 1024;
export const WEBSOCKET_BUFFER_LIMIT_BYTES = 8 * 1024 * 1024;

export const HANDSHAKE_TIMEOUT_MS = 10_000;
export const AUTH_TIMEOUT_MS = 10_000;
export const HEARTBEAT_INTERVAL_MS = 10_000;
export const HEARTBEAT_TIMEOUT_MS = 30_000;

export const AUTOMATIC_DEFAULT_MAX_PARTICIPANTS = 25;

export function actionAllowed(channel: CollaborationTransportChannel, role: 'owner' | 'editor' | 'viewer'): boolean {
  return role !== 'viewer' || channel === 'sync' || channel === 'awareness';
}

export function frameMessage(type: number, body: Uint8Array = new Uint8Array(0)): Uint8Array {
  const out = new Uint8Array(1 + body.byteLength);
  out[0] = type;
  out.set(body, 1);
  return out;
}

const encoder = new TextEncoder();
const decoder = new TextDecoder('utf-8', { fatal: true });

export function jsonBody(value: unknown): Uint8Array { return encoder.encode(JSON.stringify(value)); }

/** Parses a small JSON control body; throws on anything that is not a plain object. */
export function parseJsonBody(body: Uint8Array, maxBytes = 1024): Record<string, unknown> {
  if (body.byteLength > maxBytes) throw new Error('PROTOCOL_ERROR');
  let value: unknown;
  try { value = JSON.parse(decoder.decode(body)); } catch { throw new Error('PROTOCOL_ERROR'); }
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('PROTOCOL_ERROR');
  return value as Record<string, unknown>;
}

export function concatBytes(...parts: readonly Uint8Array[]): Uint8Array {
  const out = new Uint8Array(parts.reduce((sum, part) => sum + part.byteLength, 0));
  let offset = 0;
  for (const part of parts) { out.set(part, offset); offset += part.byteLength; }
  return out;
}

export function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes, byte => byte.toString(16).padStart(2, '0')).join('');
}

export function hexToBytes(text: string): Uint8Array {
  if (!/^(?:[0-9a-f]{2})+$/.test(text)) throw new Error('PROTOCOL_ERROR');
  return Uint8Array.from(text.match(/../g)!, pair => parseInt(pair, 16));
}

export function bytesToBase64Url(bytes: Uint8Array): string {
  let text = '';
  for (let i = 0; i < bytes.length; i += 8192) text += String.fromCharCode(...bytes.subarray(i, i + 8192));
  return btoa(text).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export function base64UrlToBytes(text: string, expectedBytes: number): Uint8Array {
  if (typeof text !== 'string' || !/^[A-Za-z0-9_-]+$/.test(text)) throw new Error('PROTOCOL_ERROR');
  let bytes: Uint8Array;
  try { bytes = Uint8Array.from(atob(text.replace(/-/g, '+').replace(/_/g, '/')), char => char.charCodeAt(0)); } catch { throw new Error('PROTOCOL_ERROR'); }
  if (bytes.byteLength !== expectedBytes || bytesToBase64Url(bytes) !== text) throw new Error('PROTOCOL_ERROR');
  return bytes;
}

export function constantTimeEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.byteLength !== b.byteLength) return false;
  let diff = 0;
  for (let i = 0; i < a.byteLength; i++) diff |= a[i]! ^ b[i]!;
  return diff === 0;
}

export function randomBytes(length: number): Uint8Array {
  return crypto.getRandomValues(new Uint8Array(length));
}

export function randomHex(length = 16): string { return bytesToHex(randomBytes(length)); }

export async function sha256(...parts: readonly Uint8Array[]): Promise<Uint8Array> {
  return new Uint8Array(await crypto.subtle.digest('SHA-256', concatBytes(...parts) as BufferSource));
}

export const utf8 = encoder;

const TOPIC_LABEL = utf8.encode('sketchdraw-relay-topic-v1\0');
const HOST_PROOF_LABEL = utf8.encode('sketchdraw-relay-host-v1\0');

/** Relay namespace of a host key; the relay verifies that a registering host owns the key this is derived from. */
export async function relayTopic(hostKey: Uint8Array): Promise<string> {
  return bytesToHex(await sha256(TOPIC_LABEL, hostKey));
}

/** The bytes a host signs to prove key ownership to the relay: label, topic and the relay's fresh per-connection nonce. */
export function hostProofMessage(topicHex: string, nonce: Uint8Array): Uint8Array {
  return concatBytes(HOST_PROOF_LABEL, hexToBytes(topicHex), nonce);
}

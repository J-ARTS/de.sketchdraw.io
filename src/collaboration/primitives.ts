import { visit } from 'jsonc-parser';
import { SessionAccessError } from '../session';
import type { PeerSessionKey, WriteErrorCode } from '../session';

export const LIMIT = Object.freeze({ pairing: 256 * 1024, pairingText: 350 * 1024, sdp: 192 * 1024,
  snapshot: 32 * 1024 * 1024, command: 40 * 1024 * 1024, frame: 16384, transferBytes: 80 * 1024 * 1024,
  controlQueue: 1024 * 1024, retentionBytes: 64 * 1024 * 1024, retentionCount: 256,
  resultCount: 1024, gatherMs: 20000, connectMs: 30000, invitationMs: 300000,
  confirmMs: 120000, transferMs: 120000, inactivityMs: 15000, outcomeMs: 15000 });
export const utf8 = new TextEncoder();
export const decode = (bytes: Uint8Array): string => new TextDecoder('utf-8', { fatal: true }).decode(bytes);
export function fail(code: WriteErrorCode = 'PROTOCOL_ERROR', reason = code as string): never {
  const error = new SessionAccessError(code);
  error.message = reason;
  throw error;
}
export function id(value: unknown): value is string { return typeof value === 'string' && /^[A-Za-z0-9._:-]{1,128}$/.test(value); }
export function hex(value: unknown, bytes = 16): value is string { return typeof value === 'string' && new RegExp(`^[a-f0-9]{${bytes * 2}}$`).test(value); }
export function integer(value: unknown): value is number { return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0; }
export function record(value: unknown): value is Record<string, unknown> { return !!value && typeof value === 'object' && !Array.isArray(value); }
export function shape(value: unknown, fields: string[]): asserts value is Record<string, unknown> {
  if (!record(value) || Object.keys(value).sort().join(',') !== [...fields].sort().join(',')) fail();
}
export function sessionKey(value: unknown): asserts value is PeerSessionKey {
  shape(value, ['documentId', 'controllerEpoch', 'sessionId', 'permissionEpoch']);
  if (!id(value.documentId) || !hex(value.controllerEpoch) || !hex(value.sessionId) || !integer(value.permissionEpoch)) fail();
}
export function sameSession(a: PeerSessionKey, b: PeerSessionKey): boolean {
  return a.documentId === b.documentId && a.controllerEpoch === b.controllerEpoch
    && a.sessionId === b.sessionId && a.permissionEpoch === b.permissionEpoch;
}
export function randomHex(bytes = 16): string {
  try { return toHex(crypto.getRandomValues(new Uint8Array(bytes))); } catch { return fail('INTERNAL_ERROR', 'WEBCRYPTO_UNAVAILABLE'); }
}
export function toHex(bytes: Uint8Array): string { return Array.from(bytes, b => b.toString(16).padStart(2, '0')).join(''); }
export function fromHex(text: string): Uint8Array<ArrayBuffer> {
  if (!/^(?:[a-f0-9]{2})+$/.test(text)) fail();
  return Uint8Array.from(text.match(/../g)!, x => parseInt(x, 16));
}
export function base64(bytes: Uint8Array): string {
  let text = '';
  for (let i = 0; i < bytes.length; i += 8192) text += String.fromCharCode(...bytes.subarray(i, i + 8192));
  return btoa(text).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
export function unbase64(text: string, maxBytes: number): Uint8Array<ArrayBuffer> {
  if (typeof text !== 'string' || text.length > Math.ceil(maxBytes * 4 / 3) + 2 || !/^[A-Za-z0-9_-]*$/.test(text)) fail();
  try {
    const raw = atob(text.replace(/-/g, '+').replace(/_/g, '/'));
    const bytes = Uint8Array.from(raw, c => c.charCodeAt(0));
    if (bytes.length > maxBytes || base64(bytes) !== text) fail();
    return bytes;
  } catch { return fail(); }
}
export async function sha(bytes: Uint8Array | string): Promise<string> {
  const input = typeof bytes === 'string' ? utf8.encode(bytes) : Uint8Array.from(bytes);
  return toHex(new Uint8Array(await crypto.subtle.digest('SHA-256', input)));
}

// A single strict parser pass builds the value and rejects duplicate/forbidden keys.
export function parse(text: string, maxBytes: number, maxDepth = 16): unknown {
  if (typeof text !== 'string' || text.length > maxBytes || utf8.encode(text).length > maxBytes) fail('REQUEST_TOO_LARGE');
  type Frame = { value: Record<string, unknown> | unknown[]; keys: Set<string>; key?: string };
  const stack: Frame[] = []; let root: unknown; let roots = 0;
  const add = (value: unknown): void => {
    const parent = stack.at(-1);
    if (!parent) { if (++roots !== 1) fail(); root = value; }
    else if (Array.isArray(parent.value)) parent.value.push(value);
    else { if (parent.key === undefined) fail(); parent.value[parent.key] = value; parent.key = undefined; }
  };
  const begin = (value: Frame['value']): void => {
    if (stack.length >= maxDepth) fail(); add(value); stack.push({ value, keys: new Set() });
  };
  visit(text, {
    onObjectBegin: () => begin(Object.create(null) as Record<string, unknown>),
    onArrayBegin: () => begin([]),
    onObjectProperty: key => {
      const frame = stack.at(-1)!;
      if (frame.keys.has(key) || ['__proto__', 'constructor', 'prototype'].includes(key)) fail();
      frame.keys.add(key); frame.key = key;
    },
    onLiteralValue: (value: unknown) => { if (typeof value === 'number' && !Number.isFinite(value)) fail(); add(value); },
    onObjectEnd: () => { stack.pop(); }, onArrayEnd: () => { stack.pop(); }, onError: () => fail(),
  }, { allowTrailingComma: false, disallowComments: true, allowEmptyContent: false });
  if (roots !== 1 || stack.length) fail();
  return root;
}
export function notify<T>(listeners: Iterable<(value: T) => void>, value: T): void {
  for (const listener of Array.from(listeners)) {
    try { void Promise.resolve(listener(structuredClone(value))).catch(() => undefined); } catch { /* isolate */ }
  }
}
export function deferred<T>() {
  let resolve!: (value: T) => void; let reject!: (error: unknown) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  void promise.catch(() => undefined);
  return { promise, resolve, reject };
}
export function timeout<T>(promise: Promise<T>, ms: number, reason: string): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => { const error = new SessionAccessError('NOT_CONNECTED'); error.message = reason; reject(error); }, ms);
    promise.then(value => { clearTimeout(timer); resolve(value); }, error => { clearTimeout(timer); reject(error); });
  });
}
export function boundedJson(value: unknown, limit: number): string {
  // Clone before async preparation; JSON undefined/function/accessor inputs are not wire values.
  const seen = new Set<object>();
  function check(item: unknown, depth: number): void {
    if (depth > 64) fail();
    if (item === null || typeof item === 'boolean') return;
    if (typeof item === 'string') { if (item.length > limit) fail('REQUEST_TOO_LARGE'); return; }
    if (typeof item === 'number') { if (!Number.isFinite(item)) fail(); return; }
    if (!item || typeof item !== 'object' || seen.has(item)) fail();
    if (!Array.isArray(item) && Object.getPrototypeOf(item) !== Object.prototype && Object.getPrototypeOf(item) !== null) fail();
    seen.add(item);
    for (const key of Reflect.ownKeys(item)) {
      if (Array.isArray(item) && key === 'length') continue;
      if (typeof key !== 'string' || ['__proto__', 'prototype', 'constructor'].includes(key)) fail();
      const desc = Object.getOwnPropertyDescriptor(item, key)!;
      if (!('value' in desc)) fail(); check(desc.value, depth + 1);
    }
    seen.delete(item);
  }
  check(value, 0);
  const text = JSON.stringify(value);
  if (!text || utf8.encode(text).length > limit) fail('REQUEST_TOO_LARGE');
  return text;
}

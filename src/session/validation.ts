import { SessionAccessError } from './errors';
import type { WriteIntent } from './types';

export const LIMITS = Object.freeze({
  payloadBytes: 40 * 1024 * 1024,
  pending: 64,
  localPending: 32,
  bindings: 64,
  peerBindings: 40,
  localBindings: 16,
  journalEntries: 1024,
  journalBytes: 4 * 1024 * 1024,
});
const encoder = new TextEncoder();

export function validId(value: unknown): value is string {
  return typeof value === 'string' && /^[A-Za-z0-9._:-]{1,128}$/.test(value);
}
export function validHex(value: unknown): value is string {
  return typeof value === 'string' && /^[0-9a-f]{32}$/.test(value);
}
export function validInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
}
export function randomId(): string {
  try {
    return Array.from(crypto.getRandomValues(new Uint8Array(16)), b => b.toString(16).padStart(2, '0')).join('');
  } catch {
    throw new SessionAccessError('INTERNAL_ERROR');
  }
}
export function clone<T>(value: T): T {
  return structuredClone(value);
}
export function freeze<T>(value: T): T {
  if (value !== null && typeof value === 'object') {
    for (const item of Object.values(value)) freeze(item);
    Object.freeze(value);
  }
  return value;
}

// Reject accessors/toJSON/functions/cycles before serialization. An input object is
// data, never executable code. The budget counts canonical UTF-8, not JS characters.
export function encodeIntent(value: unknown): { intent: WriteIntent; canonical: string; bytes: number } {
  const chunks: string[] = [];
  const ancestors = new Set<object>();
  let bytes = 0;
  const append = (text: string): void => {
    bytes += encoder.encode(text).byteLength;
    if (bytes > LIMITS.payloadBytes) throw new SessionAccessError('REQUEST_TOO_LARGE');
    chunks.push(text);
  };
  const fail = (): never => { throw new SessionAccessError('VALIDATION_FAILED'); };
  function walk(item: unknown, depth: number): void {
    if (depth > 64) fail();
    if (item === null || typeof item === 'boolean') { append(String(item)); return; }
    if (typeof item === 'number') {
      if (!Number.isFinite(item)) fail();
      append(JSON.stringify(item)); return;
    }
    if (typeof item === 'string') {
      if (item.length > LIMITS.payloadBytes) throw new SessionAccessError('REQUEST_TOO_LARGE');
      append(JSON.stringify(item)); return;
    }
    if (typeof item !== 'object' || ancestors.has(item)) return fail();
    const array = Array.isArray(item);
    const proto = Object.getPrototypeOf(item);
    if ((!array && proto !== Object.prototype && proto !== null)
      || Object.getOwnPropertySymbols(item).length !== 0) fail();
    ancestors.add(item);
    const keys = Object.keys(item);
    if (array) {
      if (keys.length !== item.length) fail();
      append('[');
      for (let i = 0; i < item.length; i += 1) {
        const d = Object.getOwnPropertyDescriptor(item, String(i));
        if (!d || !('value' in d)) return fail();
        if (i) append(',');
        walk(d.value, depth + 1);
      }
      append(']');
    } else {
      append('{');
      let first = true;
      for (const key of keys.sort()) {
        const d = Object.getOwnPropertyDescriptor(item, key);
        if (!d || !('value' in d)) return fail();
        if (!first) append(',');
        first = false;
        append(JSON.stringify(key)); append(':'); walk(d.value, depth + 1);
      }
      append('}');
    }
    ancestors.delete(item);
  }
  walk(value, 0);
  const canonical = chunks.join('');
  const intent = JSON.parse(canonical) as WriteIntent;
  if (!intent || Array.isArray(intent) || typeof intent !== 'object'
    || Object.keys(intent).sort().join(',') !== 'action,expectedRevision,requestId'
    || typeof intent.requestId !== 'string' || !validInteger(intent.expectedRevision)
    || !intent.action || typeof intent.action !== 'object' || Array.isArray(intent.action)) fail();
  const action = intent.action;
  const keys = Object.keys(action).sort().join(',');
  if (action.kind === 'dispatch') {
    if (keys !== 'command,kind' || !action.command || typeof action.command !== 'object'
      || Array.isArray(action.command)) fail();
  } else if ((action.kind !== 'undo' && action.kind !== 'redo') || keys !== 'kind') fail();
  return { intent, canonical, bytes };
}
export function requestSequence(requestId: unknown, scopeId: string): number | null {
  if (typeof requestId !== 'string' || !requestId.startsWith(`${scopeId}:`)) return null;
  const text = requestId.slice(33);
  if (!/^[1-9][0-9]{0,15}$/.test(text)) return null;
  const sequence = Number(text);
  return Number.isSafeInteger(sequence) ? sequence : null;
}
export async function digest(canonical: string): Promise<string> {
  const hash = await crypto.subtle.digest('SHA-256', encoder.encode(canonical));
  return Array.from(new Uint8Array(hash), b => b.toString(16).padStart(2, '0')).join('');
}

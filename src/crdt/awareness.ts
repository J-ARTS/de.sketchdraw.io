import * as Y from 'yjs';
import { Awareness, applyAwarenessUpdate, encodeAwarenessUpdate, removeAwarenessStates } from 'y-protocols/awareness';
import { AWARENESS_UPDATE_LIMIT_BYTES, type SketchAwarenessState, type ValidatedAwareness } from './types';

const ID_PATTERN = /^[A-Za-z0-9._:-]{1,128}$/;

function validateState(value: unknown): SketchAwarenessState {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new TypeError('Awareness state must be an object.');
  const raw = value as Record<string, unknown>;
  const keys = Object.keys(raw).sort().join(',');
  if (keys !== 'actorId,agent,cursor,displayName,selectionIds') throw new TypeError('Awareness state contains unknown fields.');
  if (typeof raw.actorId !== 'string' || !ID_PATTERN.test(raw.actorId)) throw new TypeError('Awareness actor ID is invalid.');
  if (typeof raw.displayName !== 'string' || raw.displayName.length < 1 || raw.displayName.length > 128) throw new TypeError('Awareness display name is invalid.');
  if (!Array.isArray(raw.selectionIds) || raw.selectionIds.length > 100 || raw.selectionIds.some(id => typeof id !== 'string' || !ID_PATTERN.test(id))) throw new TypeError('Awareness selection is invalid.');
  if (raw.cursor !== null) {
    if (!raw.cursor || typeof raw.cursor !== 'object' || Array.isArray(raw.cursor)) throw new TypeError('Awareness cursor is invalid.');
    const cursor = raw.cursor as Record<string, unknown>;
    if (Object.keys(cursor).sort().join(',') !== 'x,y' || typeof cursor.x !== 'number' || typeof cursor.y !== 'number' || !Number.isFinite(cursor.x) || !Number.isFinite(cursor.y) || Math.abs(cursor.x) > 1_000_000 || Math.abs(cursor.y) > 1_000_000) throw new TypeError('Awareness cursor is invalid.');
  }
  if (raw.agent !== null) {
    if (!raw.agent || typeof raw.agent !== 'object' || Array.isArray(raw.agent)) throw new TypeError('Awareness agent state is invalid.');
    const agent = raw.agent as Record<string, unknown>;
    if (Object.keys(agent).sort().join(',') !== 'id,state' || typeof agent.id !== 'string' || !ID_PATTERN.test(agent.id) || !['idle', 'working', 'waiting', 'error'].includes(String(agent.state))) throw new TypeError('Awareness agent state is invalid.');
  }
  return structuredClone(value) as SketchAwarenessState;
}

export function createValidatedAwareness(doc: Y.Doc): ValidatedAwareness {
  const awareness = new Awareness(doc);
  awareness.setLocalState(null);
  return {
    setLocalState(state: SketchAwarenessState | null): void {
      awareness.setLocalState(state === null ? null : validateState(state));
    },
    getStates(): ReadonlyMap<number, SketchAwarenessState> {
      const result = new Map<number, SketchAwarenessState>();
      for (const [clientId, state] of awareness.getStates()) result.set(clientId, validateState(state));
      return result;
    },
    encodeUpdate(clientIds?: readonly number[]): Uint8Array {
      const ids = clientIds ? Array.from(clientIds) : Array.from(awareness.getStates().keys());
      return encodeAwarenessUpdate(awareness, ids);
    },
    applyRemoteUpdate(update: Uint8Array, allow: (state: SketchAwarenessState, clientId: number) => boolean): void {
      if (!(update instanceof Uint8Array) || update.byteLength === 0 || update.byteLength > AWARENESS_UPDATE_LIMIT_BYTES) throw new TypeError('Awareness update is empty or too large.');
      const shadowDoc = new Y.Doc();
      const shadow = new Awareness(shadowDoc);
      shadow.setLocalState(null);
      try {
        applyAwarenessUpdate(shadow, update, 'validation');
        for (const [clientId, raw] of shadow.getStates()) {
          const state = validateState(raw);
          if (!allow(state, clientId)) throw new Error('AWARENESS_ACCESS_DENIED');
        }
        applyAwarenessUpdate(awareness, update, 'remote');
      } finally {
        shadow.destroy();
        shadowDoc.destroy();
      }
    },
    removeRemoteStates(clientIds: readonly number[]): void {
      removeAwarenessStates(awareness, Array.from(clientIds).filter(id => id !== doc.clientID), 'remote-disconnect');
    },
    destroy(): void {
      awareness.destroy();
    },
  };
}

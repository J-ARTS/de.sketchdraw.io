import * as Y from 'yjs';
import { describe, expect, it } from 'vitest';
import { createCrdtController, createCrdtControllerFromSnapshot } from '@/crdt';
import { CRDT_ROOT_KEY } from '@/crdt/projection';
import { createDocument } from '@/domain';

describe('snapshot document scope', () => {
  it.each(['applyRemoteSnapshot', 'applyRemoteUpdate'] as const)('rejects incremental document identity replacement via %s', method => {
    const host = createCrdtController(createDocument('Local authority'));
    const hostile = new Y.Doc();
    try {
      const before = host.getSnapshot();
      Y.applyUpdateV2(hostile, host.encodeUpdate());
      const vector = Y.encodeStateVector(hostile);
      hostile.getMap(CRDT_ROOT_KEY).set('id', 'doc:other-scope');
      const change = Y.encodeStateAsUpdateV2(hostile, vector);
      expect(() => host[method](change, { actorId: 'peer:authenticated', role: 'editor', source: 'peer' })).toThrow('DOCUMENT_MISMATCH');
      expect(host.getSnapshot()).toEqual(before);
    } finally { host.destroy(); hostile.destroy(); }
  });

  it('keeps Yjs history on snapshot import and applies the same viewer restriction', () => {
    const host = createCrdtController(createDocument('Before'));
    const guest = createCrdtControllerFromSnapshot(host.encodeUpdate());
    try {
      host.dispatch({ type: 'rename', title: 'After' }, { actorId: 'human:test', source: 'human', expectedRevision: 0 });
      const change = host.encodeUpdate(guest.encodeStateVector());
      expect(() => guest.applyRemoteSnapshot(change, { actorId: 'peer:viewer', role: 'viewer', source: 'peer' })).toThrow();
      guest.applyRemoteSnapshot(change, { actorId: 'peer:editor', role: 'editor', source: 'peer' });
      expect(guest.getSnapshot().document.title).toBe('After');
    } finally { host.destroy(); guest.destroy(); }
  });
});

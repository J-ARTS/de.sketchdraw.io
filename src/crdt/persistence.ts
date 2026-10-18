import { IndexeddbPersistence, clearDocument } from 'y-indexeddb';
import * as Y from 'yjs';
import type { SketchDocument } from '../domain';
import { createCrdtController, createCrdtControllerFromUpdate } from './controller';
import { readDocumentFromCrdt } from './projection';
import type { CrdtDocumentController, CrdtPersistenceHandle } from './types';

const CACHE_KEY_PATTERN = /^[A-Za-z0-9._:-]{1,256}$/;

function checkedCacheKey(cacheKey: string): string {
  if (!CACHE_KEY_PATTERN.test(cacheKey)) throw new TypeError('CRDT cache key is invalid.');
  return `sketchdraw:${cacheKey}`;
}

export function attachIndexedDbPersistence(
  controller: CrdtDocumentController,
  cacheKey: string,
): CrdtPersistenceHandle {
  const name = checkedCacheKey(cacheKey);
  let live: IndexeddbPersistence | undefined;
  let destroyed = false;
  const ready = (async () => {
    controller.reportPersistence({ cacheKey, state: 'loading' });
    const shadow = new Y.Doc({ gc: false });
    const loader = new IndexeddbPersistence(name, shadow);
    try {
      await loader.whenSynced;
      const update = Y.encodeStateAsUpdateV2(shadow);
      if (update.byteLength > 2) {
        controller.applyRemoteUpdate(update, { actorId: 'system:persistence', role: 'owner', source: 'persistence' });
      }
    } finally {
      await loader.destroy();
      shadow.destroy();
    }
    if (destroyed) return;
    live = new IndexeddbPersistence(name, controller.ydoc);
    await live.whenSynced;
    controller.reportPersistence({ cacheKey, state: 'ready' });
  })().catch((error: unknown) => {
    controller.reportPersistence({ cacheKey, state: 'error', error: error instanceof Error ? error.message : 'PERSISTENCE_ERROR' });
    throw error;
  });
  return {
    cacheKey,
    ready,
    async clear(): Promise<void> {
      await ready;
      if (live) await live.clearData(); else await clearDocument(name);
      controller.reportPersistence({ cacheKey, state: 'cleared' });
    },
    async destroy(): Promise<void> {
      destroyed = true;
      await ready.catch(() => undefined);
      if (live) await live.destroy();
      live = undefined;
    },
  };
}

export async function clearIndexedDbPersistence(cacheKey: string): Promise<void> {
  await clearDocument(checkedCacheKey(cacheKey));
}

export async function createPersistedCrdtController(
  cacheKey: string,
  fallbackDocument: SketchDocument,
  initialRevision = 0,
): Promise<{ controller: CrdtDocumentController; persistence: CrdtPersistenceHandle; recovered: boolean }> {
  const name = checkedCacheKey(cacheKey);
  const shadow = new Y.Doc({ gc: false });
  const loader = new IndexeddbPersistence(name, shadow);
  let controller: CrdtDocumentController;
  let recovered = false;
  try {
    await loader.whenSynced;
    try {
      const cached = readDocumentFromCrdt(shadow);
      if (cached.id !== fallbackDocument.id) throw new Error('DOCUMENT_MISMATCH');
      controller = createCrdtControllerFromUpdate(Y.encodeStateAsUpdateV2(shadow), initialRevision);
      recovered = true;
    } catch (error) {
      if (error instanceof Error && error.message === 'DOCUMENT_MISMATCH') throw error;
      controller = createCrdtController(fallbackDocument, initialRevision);
    }
  } finally {
    await loader.destroy();
    shadow.destroy();
  }
  const persistence = attachIndexedDbPersistence(controller!, cacheKey);
  await persistence.ready;
  return { controller: controller!, persistence, recovered };
}

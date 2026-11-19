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

/**
 * Keeps a local copy of a controller's document in IndexedDB. The cache only follows the controller: what is stored
 * from an earlier session is read into a separate Y.Doc and never written into the controller. A file or Git state
 * opened under the same document ID stays authoritative; applying the old cache to the running controller changed
 * it outside the session authority and stopped the authority with AUTHORITY_DIVERGED (#217). Restoring unsaved
 * changes is the explicit reader `createPersistedCrdtController` (#219).
 */
export function attachIndexedDbPersistence(
  controller: CrdtDocumentController,
  cacheKey: string,
): CrdtPersistenceHandle {
  const name = checkedCacheKey(cacheKey);
  let live: IndexeddbPersistence | undefined;
  let cache: Y.Doc | undefined;
  let destroyed = false;
  const follow = (update: Uint8Array): void => {
    if (cache && !destroyed) Y.applyUpdateV2(cache, update);
  };
  const stopFollowing = (): void => { controller.ydoc.off('updateV2', follow); };
  const ready = (async () => {
    controller.reportPersistence({ cacheKey, state: 'loading' });
    cache = new Y.Doc({ gc: false });
    live = new IndexeddbPersistence(name, cache);
    await live.whenSynced;
    if (destroyed) return;
    // Every change from here on, and the state the controller already has, goes into the copy only.
    Y.applyUpdateV2(cache, Y.encodeStateAsUpdateV2(controller.ydoc));
    controller.ydoc.on('updateV2', follow);
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
      stopFollowing();
      if (live) await live.clearData(); else await clearDocument(name);
      controller.reportPersistence({ cacheKey, state: 'cleared' });
    },
    async destroy(): Promise<void> {
      destroyed = true;
      stopFollowing();
      await ready.catch(() => undefined);
      stopFollowing();
      if (live) await live.destroy();
      live = undefined;
      cache?.destroy();
      cache = undefined;
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

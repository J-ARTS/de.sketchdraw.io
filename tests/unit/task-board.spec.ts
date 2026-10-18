import { afterEach, describe, expect, it, vi } from 'vitest';
import { deserializeDocument, serializeDocument, type DesktopBridge } from '@/domain';
import { createWhiteboardStore } from '@/renderer/state/whiteboard';
import type { WhiteboardStore } from '@/renderer/state/contract';

const stores: WhiteboardStore[] = [];
afterEach(() => { for (const store of stores.splice(0)) store.dispose(); });

function setup(): WhiteboardStore {
  const bridge: DesktopBridge = {
    platform: 'electron',
    openDocument: vi.fn<DesktopBridge['openDocument']>(async () => ({ status: 'cancelled' })),
    saveDocument: vi.fn<DesktopBridge['saveDocument']>(async () => ({ status: 'cancelled' })),
    exportFile: vi.fn<DesktopBridge['exportFile']>(async () => ({ status: 'cancelled' })),
    openExternal: vi.fn(async () => {}),
    onCloseRequested: () => () => {}, respondToClose: vi.fn(async () => {}), onMenuCommand: () => () => {},
  };
  const store = createWhiteboardStore({ bridge });
  stores.push(store);
  return store;
}

describe('task board creation', () => {
  it('creates validated standalone tasks in board order and keeps them in document history', async () => {
    const store = setup();

    expect(await store.createTask({ title: '   ' })).toBe(false);
    expect(await store.createTask({ title: '  Release vorbereiten  ', description: '  Installer und Hinweise prüfen  ' })).toBe(true);
    expect(await store.createTask({ title: 'Release veröffentlichen' })).toBe(true);
    expect(store.state.document.tasks).toEqual([
      expect.objectContaining({ title: 'Release vorbereiten', description: 'Installer und Hinweise prüfen', status: 'todo', rank: 0 }),
      expect.objectContaining({ title: 'Release veröffentlichen', description: '', status: 'todo', rank: 1 }),
    ]);
    expect(deserializeDocument(serializeDocument(store.state.document)).tasks).toEqual(store.state.document.tasks);

    store.undo(); await store.whenIdle();
    expect(store.state.document.tasks).toHaveLength(1);
    store.redo(); await store.whenIdle();
    expect(store.state.document.tasks).toHaveLength(2);
  });
});

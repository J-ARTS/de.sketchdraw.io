import { afterEach, expect, test, vi } from 'vitest';
import { createCrdtController } from '@/crdt';
import { createDocument } from '@/domain';
import { createWhiteboardStore } from '@/renderer/state/whiteboard';
const stores: any[] = [];
afterEach(() => { vi.restoreAllMocks(); for (const store of stores.splice(0)) store.dispose(); });
const bridge: any = { platform: 'electron', saveDocument: async () => ({status:'cancelled'}), openDocument: async () => ({status:'cancelled'}), exportFile: async () => ({status:'cancelled'}), openExternal: async () => {}, onCloseRequested: () => () => {}, respondToClose: async () => {}, onMenuCommand: () => () => {} };
function make() { const store = createWhiteboardStore({ bridge }); stores.push(store); return store; }
const tick = () => new Promise(resolve => setTimeout(resolve,0));

test('room marker and role are established before authority observers run', async () => {
 const store = make(); const seen: any[] = [];
 store.subscribeAuthority(() => { seen.push(store.getRoomGuest()); });
 expect(await store.adoptRoomDocument(createCrdtController(createDocument('Remote')), {role:'viewer'})).toBe(true);
 expect(seen.at(-1)).toEqual({role:'viewer', connected:true});
 expect(store.state.canWrite).toBe(false); store.setTitle('Denied'); await store.whenIdle();
 expect(store.state.document.title).toBe('Remote');
});

test('disconnect and error state stay read-only until an explicit local transition', async () => {
 const store = make(); await store.adoptRoomDocument(createCrdtController(createDocument('Remote')), {role:'editor'});
 store.setRoomConnected(false); expect(store.state.canWrite).toBe(false);
 expect(store.getRoomGuest()).toEqual({role:'editor',connected:false});
 store.setTitle('Denied'); await store.whenIdle(); expect(store.state.document.title).toBe('Remote');
 store.leaveRoomGuest(); expect(store.getRoomGuest()).toBeNull(); expect(store.state.canWrite).toBe(true);
 store.setTitle('Local copy'); await store.whenIdle(); expect(store.state.document.title).toBe('Local copy');
});

test('unsaved cancellation preserves local authority and avoids marking local document a guest', async () => {
 const store = make(); const authority = store.getAuthority(); store.updateTitleDraft('Unsaved');
 const pending = store.adoptRoomDocument(createCrdtController(createDocument('Remote')), {role:'viewer'});
 await tick(); expect(store.state.dialog?.kind).toBe('unsaved');
 await store.resolveDialog('cancel'); expect(await pending).toBe(false);
 expect(store.getRoomGuest()).toBeNull(); expect(store.getAuthority()).toBe(authority); expect(store.state.hasDraft).toBe(true);
});

test('same-document entry revokes local eligibility even without replacing authority', async () => {
 const store = make(); const observed: any[] = []; store.subscribeAuthority(() => observed.push(store.getRoomGuest()));
 store.enterRoomGuest('viewer'); expect(observed.at(-1)).toEqual({role:'viewer',connected:true});
 expect(store.state.canWrite).toBe(false);
});

test('write queued before disconnection is denied at the authority commit boundary', async () => {
 const store = make(); await store.adoptRoomDocument(createCrdtController(createDocument('Remote')), {role:'editor'});
 const original = crypto.subtle.digest.bind(crypto.subtle);
 let release!: () => void; let markStarted!: () => void;
 const started = new Promise<void>(resolve => { markStarted=resolve; });
 const gate = new Promise<void>(resolve => { release=resolve; });
 vi.spyOn(crypto.subtle,'digest').mockImplementation(async (...args: any[]) => { markStarted(); await gate; return original(args[0],args[1]); });
 store.setTitle('Offline mutation'); await started;
 store.setRoomConnected(false); release(); await store.whenIdle();
 expect(store.state.document.title).toBe('Remote');
});

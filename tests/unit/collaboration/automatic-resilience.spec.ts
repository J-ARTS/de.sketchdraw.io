import { describe, expect, it, vi } from 'vitest';
import { createAutomaticTransport } from '../../../src/collaboration/automatic';
import type { CollaborationTransport, CollaborationTransportChannel, CollaborationTransportMessage } from '../../../src/collaboration/transport';
import { FakeTrysteroNetwork, config, createMesh, waitFor } from './fake-trystero';

const bytes = (...values: number[]) => new Uint8Array(values);
const isReady = (...transports: CollaborationTransport[]) => transports.every(item => item.getStatus().state === 'ready');
const state = (transport: CollaborationTransport) => transport.getStatus().state;

async function readyPair(network: FakeTrysteroNetwork) {
  const mesh = await createMesh(network, 2);
  const [owner, editor] = mesh.transports as [CollaborationTransport, CollaborationTransport];
  await waitFor(() => isReady(owner, editor));
  const atOwner: CollaborationTransportMessage[] = [];
  const atEditor: CollaborationTransportMessage[] = [];
  owner.subscribeMessage(message => { atOwner.push(message); });
  editor.subscribeMessage(message => { atEditor.push(message); });
  return { ...mesh, owner, editor, atOwner, atEditor };
}

describe('automatic transport: broker outage and reconnect', () => {
  it('forgets a lost peer, refuses to send into the void and resumes with continuing sequences after reconnect', async () => {
    const network = new FakeTrysteroNetwork();
    const { owner, editor, atOwner, atEditor } = await readyPair(network);
    await editor.send('update', bytes(1));
    await waitFor(() => atOwner.length === 1);
    const firstDelivery = network.log.length - 1;

    network.drop('peer:2');
    await waitFor(() => state(owner) === 'connecting' && state(editor) === 'connecting');
    expect(owner.getStatus().peers).toEqual([]);
    expect(editor.getStatus().peers).toEqual([]);
    await expect(owner.send('update', bytes(9))).rejects.toThrow('PEER_NOT_AUTHORIZED');
    await expect(editor.send('update', bytes(9))).rejects.toThrow('PEER_NOT_AUTHORIZED');

    network.reconnect('peer:2');
    await waitFor(() => isReady(owner, editor));
    await editor.send('update', bytes(2));
    await owner.send('update', bytes(3));
    await waitFor(() => atOwner.length === 2 && atEditor.length === 1);
    expect(atOwner.map(message => Array.from(message.data))).toEqual([[1], [2]]);
    expect(Array.from(atEditor[0]!.data)).toEqual([3]);

    // An envelope that was valid before the outage stays a replay afterwards.
    await expect(network.replay(firstDelivery)).rejects.toThrow();
    expect(atOwner).toHaveLength(2);
    await owner.close();
    await editor.close();
  });

  it('keeps established peers working while the broker is down and admits newcomers once it returns', async () => {
    const network = new FakeTrysteroNetwork();
    const mesh = await createMesh(network, 3);
    const [owner, editor, late] = mesh.transports as [CollaborationTransport, CollaborationTransport, CollaborationTransport];
    await waitFor(() => mesh.transports.every(item => item.getStatus().peers.length === 2));
    network.drop('peer:3');
    await waitFor(() => owner.getStatus().peers.length === 1 && late.getStatus().peers.length === 0);

    // Nothing is discovered while the broker is unreachable, but the established connection keeps working.
    network.setBrokerAvailable(false);
    network.reconnect('peer:3');
    const received: CollaborationTransportMessage[] = [];
    owner.subscribeMessage(message => { received.push(message); });
    await editor.send('update', bytes(5));
    await waitFor(() => received.length === 1);
    expect(owner.getStatus().peers).toHaveLength(1);
    expect(late.getStatus().peers).toHaveLength(0);
    await expect(late.send('update', bytes(1))).rejects.toThrow('PEER_NOT_AUTHORIZED');

    network.setBrokerAvailable(true);
    await waitFor(() => owner.getStatus().peers.length === 2 && late.getStatus().peers.length === 2);
    await late.send('update', bytes(6));
    await waitFor(() => received.length === 2);
    await Promise.all(mesh.transports.map(item => item.close()));
  });

  it('accepts a freshly created transport of a known identity after the previous one left', async () => {
    const network = new FakeTrysteroNetwork();
    const { owner, editor, configs, atOwner } = await readyPair(network);
    await editor.send('update', bytes(1));
    await editor.send('sync', bytes(1));
    await waitFor(() => atOwner.length === 2);
    await editor.close();
    await waitFor(() => owner.getStatus().peers.length === 0);

    // The restarted transport runs later than its predecessor and must not be mistaken for a replay.
    const rejoined = await createAutomaticTransport(configs[1]!, { joinRoom: network.joinRoom, now: () => 2000 });
    await waitFor(() => isReady(owner, rejoined));
    await rejoined.send('update', bytes(2));
    await rejoined.send('sync', bytes(2));
    await waitFor(() => atOwner.length === 4);
    await owner.close();
    await rejoined.close();
  });

  it('is not disturbed by a rejected join attempt while a session is running', async () => {
    const network = new FakeTrysteroNetwork();
    const { owner, editor, configs, atOwner } = await readyPair(network);
    // A stranger who holds the room secret but no authorization.
    const stranger = await config({ role: 'editor', grantId: 'grant:stranger', grantGeneration: 0 }, {
      roomId: configs[0]!.roomId,
      password: configs[0]!.password,
      invitationId: configs[0]!.invitationId,
    });
    const rejected = await createAutomaticTransport(stranger, { joinRoom: network.joinRoom, now: () => 1000 });
    await waitFor(() => state(rejected) === 'error');
    await new Promise(resolve => setTimeout(resolve, 20));
    expect(state(owner)).toBe('ready');
    expect(state(editor)).toBe('ready');
    expect(owner.getStatus().peers).toHaveLength(1);
    expect(owner.getStatus().error).toBeUndefined();
    await editor.send('update', bytes(1));
    await waitFor(() => atOwner.length === 1);
    await Promise.all([owner.close(), editor.close(), rejected.close()]);
  });
});

describe('automatic transport: duplicate and reordered delivery', () => {
  const channels: CollaborationTransportChannel[] = ['sync', 'update', 'awareness', 'asset'];

  it.each(channels)('rejects every duplicate and out-of-order envelope on the %s channel', async channel => {
    const network = new FakeTrysteroNetwork();
    const { owner, editor, atOwner } = await readyPair(network);
    const first = network.log.length;
    for (const value of [1, 2, 3]) await editor.send(channel, bytes(value));
    await waitFor(() => atOwner.length === 3);

    for (const index of [first + 2, first + 1, first]) await expect(network.replay(index)).rejects.toThrow();
    await expect(network.replay(first + 2)).rejects.toThrow();
    expect(atOwner.map(message => message.data[0])).toEqual([1, 2, 3]);

    await editor.send(channel, bytes(4));
    await waitFor(() => atOwner.length === 4);
    expect(atOwner[3]!.data[0]).toBe(4);
    await owner.close();
    await editor.close();
  });

  it('keeps independent sequences per channel, so traffic on one channel never blocks another', async () => {
    const network = new FakeTrysteroNetwork();
    const { owner, editor, atOwner } = await readyPair(network);
    for (let index = 0; index < 5; index += 1) await editor.send('awareness', bytes(index));
    await editor.send('update', bytes(100));
    await waitFor(() => atOwner.length === 6);
    expect(atOwner.filter(message => message.channel === 'update')).toHaveLength(1);
    await owner.close();
    await editor.close();
  });
});

describe('automatic transport: backpressure and aborted transfers', () => {
  const mebibyte = 1024 * 1024;

  it('rejects sends beyond the 16 MiB outgoing budget and recovers once the link drains', async () => {
    const network = new FakeTrysteroNetwork();
    const { owner, editor, atOwner } = await readyPair(network);
    const release = network.hold();
    const big = () => new Uint8Array(4 * mebibyte).fill(7);
    const pending = [editor.send('update', big()), editor.send('update', big()), editor.send('update', big()), editor.send('update', big())];
    await expect(editor.send('update', bytes(1))).rejects.toThrow('TRANSPORT_BACKPRESSURE');
    await expect(editor.send('asset', new Uint8Array(mebibyte))).rejects.toThrow('TRANSPORT_BACKPRESSURE');
    release();
    await Promise.all(pending);
    await waitFor(() => atOwner.length === 4);
    expect(atOwner.every(message => message.data.byteLength === 4 * mebibyte)).toBe(true);

    await editor.send('update', bytes(1));
    await editor.send('asset', new Uint8Array(8 * mebibyte));
    await waitFor(() => atOwner.length === 6);
    await owner.close();
    await editor.close();
  });

  it('rejects empty, oversized and non-binary payloads before anything leaves the device', async () => {
    const network = new FakeTrysteroNetwork();
    const { owner, editor } = await readyPair(network);
    const sent = network.log.length;
    await expect(editor.send('update', new Uint8Array(0))).rejects.toThrow('TRANSPORT_MESSAGE_LIMIT');
    await expect(editor.send('update', new Uint8Array(4 * mebibyte + 1))).rejects.toThrow('TRANSPORT_MESSAGE_LIMIT');
    await expect(editor.send('sync', new Uint8Array(256 * 1024 + 1))).rejects.toThrow('TRANSPORT_MESSAGE_LIMIT');
    await expect(editor.send('awareness', new Uint8Array(64 * 1024 + 1))).rejects.toThrow('TRANSPORT_MESSAGE_LIMIT');
    await expect(editor.send('asset', new Uint8Array(8 * mebibyte + 1))).rejects.toThrow('TRANSPORT_MESSAGE_LIMIT');
    await expect(editor.send('update', [1, 2, 3] as unknown as Uint8Array)).rejects.toThrow('TRANSPORT_MESSAGE_LIMIT');
    expect(network.log).toHaveLength(sent);
    await owner.close();
    await editor.close();
  });

  it('rejects a peer that claims a stronger role than it was granted on every channel', async () => {
    const network = new FakeTrysteroNetwork();
    const mesh = await createMesh(network, 2, (value, index) => {
      // The owner only grants the second participant the viewer role although it believes to be an editor.
      if (index === 0) value.authorizePeer = request => request.keyHash === mesh.configs[1]!.identity.keyHash ? { role: 'viewer', grantId: 'grant:member:1', grantGeneration: 0 } : null;
    });
    const [owner, editor] = mesh.transports as [CollaborationTransport, CollaborationTransport];
    await waitFor(() => isReady(owner, editor));
    const received = vi.fn();
    owner.subscribeMessage(received);
    for (const channel of ['sync', 'update', 'awareness', 'asset'] as const) await expect(editor.send(channel, bytes(1))).rejects.toThrow();
    await new Promise(resolve => setTimeout(resolve, 10));
    expect(received).not.toHaveBeenCalled();
    await owner.close();
    await editor.close();
  });

  it('aborts a large transfer when the sender goes away and delivers nothing', async () => {
    const network = new FakeTrysteroNetwork();
    const { owner, editor, atOwner } = await readyPair(network);
    const release = network.hold();
    const transfer = editor.send('asset', new Uint8Array(8 * mebibyte).fill(3));
    const outcome = transfer.then(() => 'sent', (error: Error) => error.message);
    await editor.close();
    release();
    expect(await outcome).toBe('TRANSFER_ABORTED');
    await waitFor(() => owner.getStatus().peers.length === 0);
    expect(atOwner).toHaveLength(0);
    await expect(editor.send('update', bytes(1))).rejects.toThrow('TRANSPORT_CLOSED');
    await owner.close();
  });

  it('aborts a large transfer when the receiver goes away and frees the outgoing budget', async () => {
    const network = new FakeTrysteroNetwork();
    const mesh = await createMesh(network, 3);
    const [owner, editor, other] = mesh.transports as [CollaborationTransport, CollaborationTransport, CollaborationTransport];
    await waitFor(() => owner.getStatus().peers.length === 2 && other.getStatus().peers.length === 2);
    const atOther: CollaborationTransportMessage[] = [];
    other.subscribeMessage(message => { atOther.push(message); });
    const release = network.hold();
    const ownerPeerAtEditor = editor.getStatus().peers.find(peer => peer.role === 'owner')!.peerId;
    const transfer = editor.send('asset', new Uint8Array(8 * mebibyte).fill(3), [ownerPeerAtEditor]);
    const outcome = transfer.then(() => 'sent', (error: Error) => error.message);
    await owner.close();
    release();
    expect(await outcome).toBe('Receiver action is missing.');

    // The aborted transfer must not keep the 16 MiB budget occupied.
    const otherPeerAtEditor = editor.getStatus().peers.find(peer => peer.peerId !== ownerPeerAtEditor)!.peerId;
    await editor.send('asset', new Uint8Array(8 * mebibyte), [otherPeerAtEditor]);
    await editor.send('asset', new Uint8Array(8 * mebibyte), [otherPeerAtEditor]);
    await waitFor(() => atOther.length === 2);
    await Promise.all([editor.close(), other.close()]);
  });

  it('ignores messages that arrive after the receiving transport was closed', async () => {
    const network = new FakeTrysteroNetwork();
    const { owner, editor, atOwner } = await readyPair(network);
    const release = network.hold();
    const sending = editor.send('update', bytes(1)).then(() => 'sent', (error: Error) => error.message);
    await new Promise(resolve => setTimeout(resolve, 5));
    await owner.close();
    release();
    await sending;
    expect(atOwner).toHaveLength(0);
    await editor.close();
  });
});

describe('automatic transport: errors and logs never carry secrets', () => {
  it('reports failures as codes only and writes nothing to the console', async () => {
    const spies = (['log', 'info', 'warn', 'error', 'debug'] as const).map(method => vi.spyOn(console, method).mockImplementation(() => {}));
    const network = new FakeTrysteroNetwork();
    const { owner, editor, configs, atOwner } = await readyPair(network);
    const failures: string[] = [];
    const note = (error: unknown) => { failures.push(error instanceof Error ? `${error.name}: ${error.message}` : String(error)); };

    await editor.send('update', bytes(1));
    await waitFor(() => atOwner.length === 1);
    await network.replay(network.log.length - 1).catch(note);
    await editor.send('update', new Uint8Array(0)).catch(note);
    await owner.send('update', bytes(1), ['peer:unknown']).catch(note);
    network.drop('peer:2');
    await owner.send('update', bytes(1)).catch(note);

    // A participant from another document session fails the handshake.
    const foreign = await config({ role: 'editor', grantId: 'grant:foreign', grantGeneration: 0 }, configs[0]!);
    foreign.session = { ...foreign.session, documentId: 'document:foreign-secret-title' };
    foreign.authorizePeer = () => ({ role: 'owner', grantId: 'grant:owner', grantGeneration: 0 });
    const outsider = await createAutomaticTransport(foreign, { joinRoom: network.joinRoom, now: () => 1000 });
    await waitFor(() => state(outsider) === 'error');
    failures.push(outsider.getStatus().error ?? '');
    await outsider.close();

    const secrets = [
      configs[0]!.password,
      configs[0]!.roomId,
      configs[0]!.invitationId,
      configs[0]!.identity.keyHash,
      configs[0]!.identity.publicKeyBase64Url,
      configs[1]!.identity.keyHash,
      configs[1]!.identity.publicKeyBase64Url,
      configs[0]!.session.documentId,
      configs[0]!.session.sessionId,
      'foreign-secret-title',
    ];
    const reported = JSON.stringify([failures, owner.getStatus(), editor.getStatus()]);
    expect(failures.filter(Boolean).length).toBeGreaterThanOrEqual(5);
    for (const secret of secrets) expect(reported, `error text leaks ${secret.slice(0, 6)}…`).not.toContain(secret);
    for (const spy of spies) expect(spy).not.toHaveBeenCalled();
    await owner.close();
    await editor.close();
  });
});

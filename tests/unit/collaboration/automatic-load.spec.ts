import { describe, expect, it } from 'vitest';
import { AUTOMATIC_DEFAULT_MAX_PARTICIPANTS, AUTOMATIC_MAX_PARTICIPANTS_CEILING, createAutomaticTransport } from '../../../src/collaboration/automatic';
import type { CollaborationTransport } from '../../../src/collaboration/transport';
import { FakeTrysteroNetwork, config, createMesh } from './fake-trystero';

// Protocol-level load only: real signatures, hashes and envelopes over an in-memory network.
// WebRTC connection cost, bandwidth and NAT behaviour are not measured here (docs/network-test-plan.md).
const TIERS = [25, 50, 100] as const;
const UPDATE_BYTES = 64 * 1024;

const mesh = (transports: CollaborationTransport[], size: number) => transports.every(item => item.getStatus().peers.length === size - 1);

async function settle(predicate: () => boolean, label: string): Promise<void> {
  const started = Date.now();
  while (!predicate()) {
    if (Date.now() - started > 90_000) throw new Error(`${label} did not settle`);
    await new Promise(resolve => setTimeout(resolve, 10));
  }
}

describe('automatic transport: participant limit', () => {
  it('promises 25 participants by default and never more than 100', () => {
    expect(AUTOMATIC_DEFAULT_MAX_PARTICIPANTS).toBe(25);
    expect(AUTOMATIC_MAX_PARTICIPANTS_CEILING).toBe(100);
  });

  it('refuses the participant beyond the default limit without disturbing the room', async () => {
    const network = new FakeTrysteroNetwork();
    const full = await createMesh(network, AUTOMATIC_DEFAULT_MAX_PARTICIPANTS);
    await settle(() => mesh(full.transports, AUTOMATIC_DEFAULT_MAX_PARTICIPANTS), 'full room');

    const grants = new Map(full.configs.map(value => [value.identity.keyHash, { role: 'editor' as const, grantId: `grant:${value.identity.keyHash.slice(0, 8)}`, grantGeneration: 0 }]));
    const extra = await config({ role: 'editor', grantId: 'grant:extra', grantGeneration: 0 }, full.configs[0]!);
    extra.authorizePeer = request => grants.get(request.keyHash) ?? null;
    for (const value of full.configs) value.authorizePeer = request => request.keyHash === extra.identity.keyHash ? { role: 'editor', grantId: 'grant:extra', grantGeneration: 0 } : grants.get(request.keyHash) ?? null;
    const late = await createAutomaticTransport(extra, { joinRoom: network.joinRoom, now: () => 1000 });
    await settle(() => late.getStatus().state === 'error', 'rejected participant');
    await new Promise(resolve => setTimeout(resolve, 50));

    expect(late.getStatus().peers).toEqual([]);
    expect(mesh(full.transports, AUTOMATIC_DEFAULT_MAX_PARTICIPANTS)).toBe(true);
    expect(full.transports.every(item => item.getStatus().state === 'ready')).toBe(true);
    await Promise.all([late, ...full.transports].map(item => item.close()));
  }, 60_000);

  it('rejects limits outside 2..100', async () => {
    const value = await config({ role: 'owner', grantId: 'grant:owner', grantGeneration: 0 });
    for (const maxParticipants of [0, 1, 101, 2.5, -3, Number.NaN]) {
      await expect(createAutomaticTransport({ ...value, maxParticipants })).rejects.toThrow('participant limit');
    }
  });
});

describe('automatic transport: full-mesh load at 25, 50 and 100 participants', () => {
  it.each(TIERS)('connects %i participants and fans an update out to everyone exactly once', async size => {
    const network = new FakeTrysteroNetwork();
    const started = performance.now();
    const room = await createMesh(network, size, value => { value.maxParticipants = size; });
    await settle(() => mesh(room.transports, size), `${size}-participant mesh`);
    const meshMs = performance.now() - started;

    const counts = new Array<number>(size).fill(0);
    room.transports.forEach((item, index) => item.subscribeMessage(() => { counts[index] = (counts[index] ?? 0) + 1; }));
    const broadcastStarted = performance.now();
    await room.transports[0]!.send('update', new Uint8Array(UPDATE_BYTES).fill(7));
    await settle(() => counts.slice(1).every(count => count === 1), 'owner broadcast');
    const broadcastMs = performance.now() - broadcastStarted;

    // Everybody announces itself to everybody (presence traffic): size * (size - 1) deliveries.
    const awarenessStarted = performance.now();
    await Promise.all(room.transports.map(item => item.send('awareness', new Uint8Array(512).fill(1))));
    await settle(() => counts[0] === size - 1 + 0 && counts.slice(1).every(count => count === size), 'awareness round');
    const awarenessMs = performance.now() - awarenessStarted;

    expect(counts[0]).toBe(size - 1);
    expect(counts.slice(1).every(count => count === size)).toBe(true);
    expect(room.transports.every(item => item.getStatus().state === 'ready')).toBe(true);
    // Generous bounds: they only guard against accidental super-linear regressions, not against slow machines.
    expect(meshMs).toBeLessThan(60_000);
    expect(broadcastMs).toBeLessThan(30_000);
    console.info(`[p2p-load] participants=${size} connections=${size * (size - 1) / 2} mesh=${Math.round(meshMs)}ms update(64KiB)->${size - 1}peers=${Math.round(broadcastMs)}ms awareness(${size}x${size - 1})=${Math.round(awarenessMs)}ms`);
    await Promise.all(room.transports.map(item => item.close()));
  }, 180_000);
});

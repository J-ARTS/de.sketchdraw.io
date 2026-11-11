import { describe, expect, it } from 'vitest';
import { computePinProof, generatePin, normalizePin, PinGate } from '../../../../src/collaboration/hdht/invitation';

const tick = () => new Promise(resolve => setTimeout(resolve, 0));
function controlled() {
  let resolve!: (value: boolean) => void;
  const promise = new Promise<boolean>(done => { resolve = done; });
  return { promise, resolve };
}

describe('PinGate', () => {
  it('arms the cooldown for six parallel wrong guesses and blocks the seventh', async () => {
    let now = 1_000;
    const gate = new PinGate({ now: () => now });
    const gates = Array.from({ length: 6 }, () => controlled());
    const results = gates.map(entry => gate.attempt(() => entry.promise));
    gates.forEach(entry => entry.resolve(false));
    const settled = await Promise.all(results);
    expect(settled.slice(0, 5).every(result => !result.ok && result.code === 'PIN_INVALID')).toBe(true);
    const fifth = settled[4]!;
    expect(!fifth.ok && fifth.retryAfterMs).toBeGreaterThan(0);
    expect(settled[5]).toMatchObject({ ok: false, code: 'PIN_LOCKED' });
    let verified = false;
    const seventh = await gate.attempt(async () => { verified = true; return true; });
    expect(seventh).toMatchObject({ ok: false, code: 'PIN_LOCKED' });
    expect(verified).toBe(false);
    now += 31_000;
    expect(await gate.attempt(async pin => pin === gate.getPin())).toEqual({ ok: true });
  });

  it('makes a concurrent renew() inert for the old attempts and does not lock the new PIN', async () => {
    const gate = new PinGate();
    const failures = Array.from({ length: 4 }, () => gate.attempt(async () => false));
    await Promise.all(failures);
    const old = controlled();
    const pendingFifth = gate.attempt(() => old.promise);
    const renewed = gate.renew();
    old.resolve(false);
    expect(await pendingFifth).toMatchObject({ ok: false, code: 'PIN_STALE' });
    expect(await gate.attempt(async pin => pin === renewed)).toEqual({ ok: true });
  });

  it('never authenticates when an attempt that started before renew() resolves true afterwards', async () => {
    const gate = new PinGate();
    const old = controlled();
    const stale = gate.attempt(() => old.promise);
    gate.renew();
    old.resolve(true);
    expect(await stale).toMatchObject({ ok: false, code: 'PIN_STALE' });
    expect(gate.remainingFailures).toBe(20);
  });

  it('retires the PIN for good after the global maximum, independent of who asks', async () => {
    let now = 0;
    const gate = new PinGate({ now: () => now, maxFailures: 10 });
    let last: Awaited<ReturnType<PinGate['attempt']>> | undefined;
    for (let i = 0; i < 12; i++) { last = await gate.attempt(async () => false); now += 20 * 60_000; }
    expect(last).toMatchObject({ ok: false, code: 'PIN_RETIRED' });
    expect(await gate.attempt(async pin => pin === gate.getPin())).toMatchObject({ ok: false, code: 'PIN_RETIRED' });
    const fresh = gate.renew();
    expect(await gate.attempt(async pin => pin === fresh)).toEqual({ ok: true });
  });

  it('binds the PIN proof to one channel and one session without putting the PIN anywhere', async () => {
    const session = 'a'.repeat(64);
    const a = await computePinProof('123456', new Uint8Array(32).fill(1), session);
    const b = await computePinProof('123456', new Uint8Array(32).fill(2), session);
    const c = await computePinProof('123456', new Uint8Array(32).fill(1), 'b'.repeat(64));
    expect(a).not.toEqual(b);
    expect(a).not.toEqual(c);
    expect(a).toEqual(await computePinProof('123456', new Uint8Array(32).fill(1), session));
    await tick();
  });

  it('generates six digits and normalizes separators', () => {
    for (let i = 0; i < 50; i++) expect(generatePin()).toMatch(/^\d{6}$/);
    expect(normalizePin('123 456')).toBe('123456');
    expect(normalizePin('12-34-56')).toBe('123456');
    expect(normalizePin('12345')).toBeNull();
    expect(normalizePin('abcdef')).toBeNull();
  });
});

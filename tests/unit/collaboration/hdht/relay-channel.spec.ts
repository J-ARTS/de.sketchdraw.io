import { describe, expect, it, vi } from 'vitest';
import { bytesToBase64Url, bytesToHex, MAX_MESSAGE_BYTES, RECORD_PLAINTEXT_BYTES, randomBytes } from '../../../../src/collaboration/hdht/codec';
import {
  acceptRelayChannel, createHostKeys, initiateRelayChannel, type RecordWire, RelayRecordChannel, WireInbox,
} from '../../../../src/collaboration/hdht/relay-channel';

const SESSION = bytesToHex(randomBytes(32));

function wirePair() {
  const guestInbox = new WireInbox();
  const hostInbox = new WireInbox();
  const log: Uint8Array[] = [];
  const guestWire: RecordWire = { send: data => { log.push(data); queueMicrotask(() => hostInbox.push(Uint8Array.from(data))); }, bufferedAmount: () => 0, close: () => undefined };
  const hostWire: RecordWire = { send: data => { log.push(data); queueMicrotask(() => guestInbox.push(Uint8Array.from(data))); }, bufferedAmount: () => 0, close: () => undefined };
  return { guestInbox, hostInbox, guestWire, hostWire, log };
}

async function connect(opts: { sessionHost?: string; hostKey?: string } = {}) {
  const hostKeys = await createHostKeys();
  const pair = wirePair();
  const hostPromise = acceptRelayChannel(pair.hostWire, pair.hostInbox, { sessionId: opts.sessionHost ?? SESSION, hostKeys });
  const guestPromise = initiateRelayChannel(pair.guestWire, pair.guestInbox, { sessionId: SESSION, hostKey: opts.hostKey ?? bytesToBase64Url(hostKeys.publicKey) });
  return { hostKeys, pair, hostPromise, guestPromise };
}

function collect(channel: RelayRecordChannel) {
  const events: string[] = [];
  const messages: Uint8Array[] = [];
  channel.attach({ message: data => { events.push('message'); messages.push(data); }, close: reason => events.push(`close:${reason}`) });
  return { events, messages };
}
const settle = () => new Promise(resolve => setTimeout(resolve, 20));

describe('relay channel handshake', () => {
  it('derives the same binding on both ends and carries messages both ways, including large fragmented ones', async () => {
    const { hostPromise, guestPromise } = await connect();
    const [host, guest] = await Promise.all([hostPromise, guestPromise]);
    expect(host.binding).toEqual(guest.binding);
    const hostSeen = collect(host);
    const guestSeen = collect(guest);
    const big = new Uint8Array(300 * 1024);
    for (let offset = 0; offset < big.length; offset += 65_536) big.set(randomBytes(Math.min(65_536, big.length - offset)), offset);
    await guest.send(big);
    await host.send(Uint8Array.of(7, 8, 9));
    await settle();
    expect(hostSeen.messages[0]).toEqual(big);
    expect(guestSeen.messages[0]).toEqual(Uint8Array.of(7, 8, 9));
  });

  it('does not put plaintext on the wire', async () => {
    const { hostPromise, guestPromise, pair } = await connect();
    const [host, guest] = await Promise.all([hostPromise, guestPromise]);
    collect(host);
    const secret = new TextEncoder().encode('TOP-SECRET-DRAWING-PAYLOAD');
    await guest.send(secret);
    await settle();
    const wireText = new TextDecoder('latin1').decode(Uint8Array.from(pair.log.flatMap(frame => Array.from(frame))));
    expect(wireText).not.toContain('TOP-SECRET');
  });

  it('rejects a host that cannot prove the pinned key (key tamper)', async () => {
    const other = await createHostKeys();
    const { hostPromise, guestPromise } = await connect({ hostKey: bytesToBase64Url(other.publicKey) });
    hostPromise.catch(() => undefined);
    await expect(guestPromise).rejects.toThrow('HOST_KEY_MISMATCH');
  });

  it('rejects a host that signed for another session id', async () => {
    const { hostPromise, guestPromise } = await connect({ sessionHost: bytesToHex(randomBytes(32)) });
    hostPromise.catch(() => undefined);
    await expect(guestPromise).rejects.toThrow('HOST_KEY_MISMATCH');
  });

  it('uses a fresh key schedule per connection', async () => {
    const first = await connect();
    const second = await connect();
    const [a] = await Promise.all([first.hostPromise, first.guestPromise]);
    const [b] = await Promise.all([second.hostPromise, second.guestPromise]);
    expect(a.binding).not.toEqual(b.binding);
  });

  it('closes on a replayed, duplicated or reordered record', async () => {
    const { hostPromise, guestPromise, pair } = await connect();
    const [host, guest] = await Promise.all([hostPromise, guestPromise]);
    const seen = collect(host);
    await guest.send(Uint8Array.of(1));
    await settle();
    expect(seen.messages).toHaveLength(1);
    const lastFrame = pair.log.at(-1)!;
    host.deliver(Uint8Array.from(lastFrame));
    await settle();
    expect(seen.events.at(-1)).toMatch(/^close:/);
    expect(seen.messages).toHaveLength(1);
  });

  it('closes on a tampered record', async () => {
    const { hostPromise, guestPromise, pair } = await connect();
    const [host, guest] = await Promise.all([hostPromise, guestPromise]);
    const seen = collect(host);
    await guest.send(Uint8Array.of(1, 2, 3));
    await settle();
    const copy = Uint8Array.from(pair.log.at(-1)!);
    copy[copy.length - 1] = copy[copy.length - 1]! ^ 1;
    const other = await connect();
    void other;
    host.deliver(copy);
    await settle();
    expect(seen.events.some(event => event.startsWith('close:'))).toBe(true);
  });
});

describe('wire failure during the handshake (R1/R3)', () => {
  async function m1Frame(): Promise<Uint8Array> {
    const hostKeys = await createHostKeys();
    const pair = wirePair();
    const sent: Uint8Array[] = [];
    pair.guestWire.send = data => { sent.push(Uint8Array.from(data)); };
    void initiateRelayChannel(pair.guestWire, pair.guestInbox, { sessionId: SESSION, hostKey: bytesToBase64Url(hostKeys.publicKey), timeoutMs: 50 }).catch(() => undefined);
    await settle();
    return sent[0]!;
  }

  it('refuses to open a channel when the wire closed after a valid M1 was buffered', async () => {
    const m1 = await m1Frame();
    const hostKeys = await createHostKeys();
    const inbox = new WireInbox();
    const wire: RecordWire = { send: () => undefined, bufferedAmount: () => 0, close: () => undefined };
    inbox.push(m1);
    inbox.fail('WIRE_CLOSED_DURING_HANDSHAKE');
    await expect(acceptRelayChannel(wire, inbox, { sessionId: SESSION, hostKeys })).rejects.toThrow('WIRE_CLOSED_DURING_HANDSHAKE');
  });

  it('refuses when the wire fails while the asynchronous crypto of the handshake runs', async () => {
    const m1 = await m1Frame();
    const hostKeys = await createHostKeys();
    const inbox = new WireInbox();
    const sent: Uint8Array[] = [];
    const wire: RecordWire = { send: data => sent.push(data), bufferedAmount: () => 0, close: () => undefined };
    inbox.push(m1);
    const accepting = acceptRelayChannel(wire, inbox, { sessionId: SESSION, hostKeys });
    queueMicrotask(() => inbox.fail('WIRE_CLOSED_AFTER_M1'));
    await expect(accepting).rejects.toThrow('WIRE_CLOSED_AFTER_M1');
    expect(sent).toHaveLength(0);
  });

  it('refuses a guest handshake when the wire closes before M2 arrives', async () => {
    const hostKeys = await createHostKeys();
    const inbox = new WireInbox();
    const wire: RecordWire = { send: () => undefined, bufferedAmount: () => 0, close: () => undefined };
    const initiating = initiateRelayChannel(wire, inbox, { sessionId: SESSION, hostKey: bytesToBase64Url(hostKeys.publicKey) });
    queueMicrotask(() => inbox.fail('WIRE_CLOSED_BEFORE_M2'));
    await expect(initiating).rejects.toThrow('WIRE_CLOSED_BEFORE_M2');
  });

  it('delivers a close that happens right after the channel opened', async () => {
    const { hostPromise, guestPromise, pair } = await connect();
    const guest = await guestPromise;
    const host = await hostPromise;
    const seen = collect(host);
    pair.hostInbox.fail('WIRE_CLOSED_LATE');
    await settle();
    expect(seen.events).toEqual(['close:WIRE_CLOSED_LATE']);
    void guest;
  });

  it('bounds the buffer before authentication by bytes and by count', async () => {
    const byCount = new WireInbox();
    for (let i = 0; i < 40; i++) byCount.push(Uint8Array.of(1));
    await expect(byCount.next(20)).rejects.toThrow('INBOUND_OVERFLOW');
    const byBytes = new WireInbox();
    byBytes.push(new Uint8Array(60 * 1024));
    for (let i = 0; i < 20; i++) byBytes.push(new Uint8Array(60 * 1024));
    await expect(new Promise<void>((resolve, reject) => { void byBytes.next(20).then(() => byBytes.next(20)).then(() => resolve(), reject); const spin = async () => { for (let i = 0; i < 30; i++) await byBytes.next(5).catch(error => { reject(error); }); }; void spin(); })).rejects.toThrow('INBOUND_OVERFLOW');
  });

  it('rejects an oversized record outright', async () => {
    const inbox = new WireInbox();
    inbox.push(new Uint8Array(70 * 1024));
    await expect(inbox.next(20)).rejects.toThrow('RECORD_TOO_LARGE');
  });

  it('dispose rejects a waiting next() once and is idempotent', async () => {
    const inbox = new WireInbox();
    const waiting = inbox.next(5000);
    inbox.dispose('CANCELLED');
    inbox.dispose('CANCELLED');
    await expect(waiting).rejects.toThrow('CANCELLED');
    await expect(inbox.next(10)).rejects.toThrow('CANCELLED');
  });

  it('cancelling during the pre-M1 wait settles the accept', async () => {
    const hostKeys = await createHostKeys();
    const inbox = new WireInbox();
    const wire: RecordWire = { send: () => undefined, bufferedAmount: () => 0, close: () => undefined };
    const accepting = acceptRelayChannel(wire, inbox, { sessionId: SESSION, hostKeys, timeoutMs: 10_000 });
    setTimeout(() => inbox.dispose('ABORTED'), 10);
    await expect(accepting).rejects.toThrow('ABORTED');
  });
});

describe('late records after a local close (R6)', () => {
  it('never emits a message after close() called while decryption is pending', async () => {
    const { hostPromise, guestPromise, pair } = await connect();
    const [host, guest] = await Promise.all([hostPromise, guestPromise]);
    const seen = collect(host);
    const captured: Uint8Array[] = [];
    pair.guestWire.send = data => { captured.push(Uint8Array.from(data)); };
    await guest.send(Uint8Array.of(5, 5, 5));
    let started!: () => void;
    const decrypting = new Promise<void>(resolve => { started = resolve; });
    let release = () => {};
    const decrypt = crypto.subtle.decrypt.bind(crypto.subtle);
    const spy = vi.spyOn(crypto.subtle, 'decrypt').mockImplementation((algorithm, key, data) => {
      started();
      return new Promise(resolve => { release = () => resolve(decrypt(algorithm, key, data)); });
    });
    try {
      host.deliver(captured[0]!);
      await decrypting;
      host.close('DISPOSED');
      release();
      await settle();
      expect(seen.events).toEqual(['close:DISPOSED']);
      expect(seen.messages).toEqual([]);
    } finally { release(); spy.mockRestore(); guest.close(); }
  });
});

describe('bounded relay fragment grammar (R29)', () => {
  async function receiver() {
    const key = await crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
    const closed = vi.fn();
    const channel = new RelayRecordChannel({
      binding: new Uint8Array(32), sendKey: key, recvKey: key,
      wire: { send: () => {}, bufferedAmount: () => 0, close: closed },
    });
    const seen = collect(channel);
    let sequence = 0;
    const deliver = async (plain: Uint8Array) => {
      const iv = new Uint8Array(12); new DataView(iv.buffer).setUint32(8, sequence++);
      const sealed = await crypto.subtle.encrypt({ name: 'AES-GCM', iv, additionalData: new TextEncoder().encode('sketchdraw-relay-record-v1') }, key, plain as BufferSource);
      channel.deliver(new Uint8Array(sealed));
      await settle();
    };
    return { channel, seen, closed, deliver };
  }

  it.each([
    ['empty continuation', Uint8Array.of(1)],
    ['empty final record', Uint8Array.of(0)],
    ['short continuation', Uint8Array.of(1, 7)],
    ['oversized final chunk', new Uint8Array(RECORD_PLAINTEXT_BYTES + 2)],
  ])('rejects a validly encrypted %s instead of retaining fragments', async (_name, plain) => {
    const { channel, seen, closed, deliver } = await receiver();
    await deliver(plain as Uint8Array);
    expect(closed).toHaveBeenCalledExactlyOnceWith('RECORD_INVALID');
    expect(seen.events).toEqual(['close:RECORD_INVALID']);
    expect(seen.messages).toEqual([]);
    await expect(channel.send(Uint8Array.of(1))).rejects.toThrow('CHANNEL_CLOSED');
  });

  it('accepts canonical continuation chunks and a nonempty final chunk', async () => {
    const { channel, seen, closed, deliver } = await receiver();
    const continuation = new Uint8Array(RECORD_PLAINTEXT_BYTES + 1); continuation[0] = 1; continuation[1] = 42;
    await deliver(continuation);
    expect(seen.messages).toHaveLength(0);
    await deliver(Uint8Array.of(0, 19));
    expect(seen.messages[0]).toHaveLength(RECORD_PLAINTEXT_BYTES + 1);
    expect(seen.messages[0]![0]).toBe(42);
    expect(seen.messages[0]!.at(-1)).toBe(19);
    expect(closed).not.toHaveBeenCalled();
    channel.close();
  });

  it('still carries the largest application asset (8 MiB plus type) through the real crypto channel', async () => {
    const { hostPromise, guestPromise } = await connect();
    const [host, guest] = await Promise.all([hostPromise, guestPromise]);
    const received = new Promise<Uint8Array>((resolve, reject) => {
      host.attach({ message: resolve, close: reason => reject(new Error(reason)) });
    });
    const message = new Uint8Array(MAX_MESSAGE_BYTES); message[0] = 0x13; message[message.length - 1] = 91;
    await guest.send(message);
    const actual = await received;
    expect(actual.byteLength).toBe(MAX_MESSAGE_BYTES);
    expect(actual[0]).toBe(0x13);
    expect(actual.at(-1)).toBe(91);
    expect(Buffer.compare(Buffer.from(actual), Buffer.from(message))).toBe(0);
    host.close(); guest.close();
  });
});

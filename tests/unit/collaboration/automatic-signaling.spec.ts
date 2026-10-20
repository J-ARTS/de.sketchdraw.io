import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';

interface Published { url: string; topic: string; payload: string }

const broker = vi.hoisted(() => ({
  connects: [] as Array<{ url: string; options: unknown }>,
  clients: [] as unknown[],
}));

vi.mock('mqtt', async () => {
  const { EventEmitter } = await import('node:events');
  class FakeMqttClient extends EventEmitter {
    connected = true;
    readonly published: Published[] = [];
    readonly subscribed: string[][] = [];
    readonly unsubscribed: string[] = [];
    constructor(readonly url: string) { super(); }
    publish(topic: string, payload: string): this { this.published.push({ url: this.url, topic, payload: String(payload) }); return this; }
    subscribeAsync(topics: string | string[]): Promise<void> { this.subscribed.push([topics].flat()); return Promise.resolve(); }
    unsubscribe(topic: string): this { this.unsubscribed.push(topic); return this; }
    end(): this { return this; }
  }
  return {
    default: {
      connect(url: string, options: unknown) {
        const client = new FakeMqttClient(url);
        broker.connects.push({ url, options });
        broker.clients.push(client);
        return client;
      },
    },
  };
});

type FakeClient = {
  connected: boolean;
  published: Published[];
  subscribed: string[][];
  emit(event: string, ...args: unknown[]): boolean;
};

afterEach(() => {
  broker.connects.length = 0;
  broker.clients.length = 0;
});

async function waitFor(predicate: () => boolean): Promise<void> {
  for (let attempt = 0; attempt < 200; attempt += 1) {
    if (predicate()) return;
    await new Promise(resolve => setTimeout(resolve, 5));
  }
  throw new Error('Condition was not reached.');
}

async function start() {
  vi.resetModules();
  const { createAutomaticTransport } = await import('../../../src/collaboration/automatic');
  const { config } = await import('./fake-trystero');
  const value = await config({ role: 'owner', grantId: 'grant:owner', grantGeneration: 0 });
  value.rtcConfig = { iceServers: [{ urls: 'turns:turn.example.test:443?transport=tcp', username: 'turn-user', credential: 'turn-credential-secret' }] };
  const transport = await createAutomaticTransport(value);
  await waitFor(() => broker.clients.length > 0);
  const client = broker.clients[0] as FakeClient;
  await waitFor(() => client.published.length > 0);
  const secrets = [
    value.password,
    value.roomId,
    value.invitationId,
    value.identity.keyHash,
    value.identity.publicKeyBase64Url,
    value.session.documentId,
    value.session.sessionId,
    value.session.controllerEpoch,
    'turn-credential-secret',
    'turn-user',
  ];
  return { transport, client, value, secrets };
}

describe('automatic transport: what the signaling broker and the console see', () => {
  it('hands the broker only hashed topics and an announcement that carries no secret or document data', async () => {
    const { transport, client, value, secrets } = await start();
    expect(broker.connects).toHaveLength(1);
    expect(broker.connects[0]!.url).toBe('wss://mqtt.example.test/mqtt');

    const traffic = JSON.stringify({ published: client.published, subscribed: client.subscribed });
    for (const secret of secrets) expect(traffic, `signaling traffic leaks ${secret.slice(0, 6)}…`).not.toContain(secret);
    expect(traffic).not.toContain(value.appId);
    for (const message of client.published) {
      expect(message.topic).toMatch(/^[A-Za-z0-9+/=_-]+$/);
      const parsed = JSON.parse(message.payload) as Record<string, unknown>;
      expect(Object.keys(parsed).sort()).toEqual(['peerId']);
    }
    await transport.close();
  });

  it('subscribes again and re-announces itself when the broker connection returns after an outage', async () => {
    const { transport, client } = await start();
    await waitFor(() => client.subscribed.length > 0);
    const subscriptions = client.subscribed.length;
    const announcements = client.published.length;

    client.connected = false;
    client.emit('close');
    client.connected = true;
    client.emit('connect');
    await waitFor(() => client.subscribed.length > subscriptions && client.published.length > announcements);
    expect(client.subscribed.at(-1)).toEqual(client.subscribed[0]);
    expect(client.published.at(-1)).toEqual(client.published[0]);
    await transport.close();
  });

  it('keeps secrets out of the console while the broker fails and the session ends', async () => {
    const spies = (['log', 'info', 'warn', 'error', 'debug'] as const).map(method => vi.spyOn(console, method).mockImplementation(() => {}));
    const { transport, client, secrets } = await start();
    client.emit('error', new Error('connect ECONNREFUSED wss://mqtt.example.test/mqtt'));
    client.connected = false;
    client.emit('close');
    await transport.close();
    const output = JSON.stringify(spies.flatMap(spy => spy.mock.calls.map(call => call.map(String))));
    // The library reports the broker failure on the console; the check below is only meaningful because it did.
    expect(output).toContain('ECONNREFUSED');
    for (const secret of secrets) expect(output).not.toContain(secret);
    expect(transport.getStatus().state).toBe('closed');
  });

  it('has no console output in the collaboration code that could write secrets or document data into logs', () => {
    const directories = ['src/collaboration', 'src/crdt', 'src/session'];
    const offenders = directories.flatMap(directory => readdirSync(directory, { recursive: true, encoding: 'utf8' })
      .filter(file => file.endsWith('.ts'))
      .map(file => join(directory, file))
      .filter(file => /\bconsole\s*\./.test(readFileSync(file, 'utf8'))));
    expect(offenders).toEqual([]);
    expect(readFileSync('src/renderer/components/CollaborationPanel.vue', 'utf8')).not.toMatch(/\bconsole\s*\./);
  });
});

import { afterEach, describe, expect, it } from 'vitest';
import { lstat } from 'node:fs/promises';
import { createConnection, createServer } from 'node:net';
import path from 'node:path';
import { Client } from '@modelcontextprotocol/client';
import { StdioClientTransport } from '@modelcontextprotocol/client/stdio';
import { createController, createDocument, createElement } from '../../../src/domain';
import { createDocumentAuthority } from '../../../src/session';
import { createRendererAgentHandler } from '../../../src/agent-access/renderer-handler';
import { createAgentHost, type AgentHostOptions } from '../../../electron/agent-access/host';
import { connectAgent, type AgentClient } from '../../../src/mcp/client';
import type { AgentPermission, AgentRendererRequest } from '../../../src/agent-access/types';

const cleanup: (() => unknown | Promise<unknown>)[] = [];
afterEach(async () => { for (const close of cleanup.splice(0).reverse()) await close(); });
async function fixture(permission: AgentPermission = 'write', intercept?: (request: AgentRendererRequest, proceed: () => ReturnType<AgentHostOptions['onRequest']>) => ReturnType<AgentHostOptions['onRequest']>) {
  const document = { ...createDocument('Original'), id: 'doc:mcp' };
  const controller = createController(document);
  const authority = createDocumentAuthority({ controller });
  const descriptor = { documentId: document.id, sessionEpoch: 1, webContentsGeneration: 1 };
  const handler = createRendererAgentHandler(authority, descriptor);
  const host = await createAgentHost({ onControl: handler.handleControl, onRequest: request => intercept ? intercept(request, () => handler.handleRequest(request)) : handler.handleRequest(request) });
  cleanup.push(() => host.close(), () => handler.dispose());
  await host.registerSession(descriptor);
  const grant = await host.issueGrant(permission, 'test agent');
  const client = await connectAgent(grant.env); cleanup.push(() => client.close());
  return { document, controller, authority, handler, host, grant, client, descriptor };
}
const rename = (commandId: string, title = 'Changed', expectedRevision = 0) => ({ documentId: 'doc:mcp', expectedRevision, commandId, command: { type: 'rename' as const, title } });

describe('Real local agent host and renderer authority', () => {
  it('uses a private endpoint, reads the actual document and returns code/analysis', async () => {
    const f = await fixture();
    if (f.host.endpoint.startsWith('unix:')) {
      const file = f.host.endpoint.slice(5);
      expect((await lstat(file)).mode & 0o777).toBe(0o600);
      expect((await lstat(path.dirname(file))).mode & 0o777).toBe(0o700);
    } else expect(f.host.endpoint).toMatch(/^tcp:127\.0\.0\.1:\d+$/);
    expect(await f.client.request('sketchdraw_read_document', { documentId: f.document.id })).toMatchObject({ revision: 0, includeAssetData: false, document: { title: 'Original' } });
    expect(await f.client.request('sketchdraw_read_code', { documentId: f.document.id })).toMatchObject({ formatVersion: 1, code: expect.stringContaining('sketchdraw 1') });
    expect(await f.client.request('sketchdraw_analyze_document', { documentId: f.document.id })).toMatchObject({ summary: { totalElements: 0 } });
  });
  it('commits into the same authority and permits a subsequent human edit', async () => {
    const f = await fixture();
    const element = createElement('rectangle', { id: 'shape:agent', label: 'Agent box' });
    expect(await f.client.request('sketchdraw_apply_commands', { ...rename('add'), command: { type: 'add', elements: [element] } })).toMatchObject({ revision: 1, changed: true, saved: false });
    const human = f.authority.bindActor({ actorId: 'human', source: 'human', grantId: 'human', grantGeneration: 1, guard: () => ({ allowed: true }) });
    await human.gateway.submit({ requestId: human.gateway.nextRequestId()!, expectedRevision: 1, action: { kind: 'dispatch', command: { type: 'update', changes: [{ id: element.id, patch: { x: 70 } }] } } });
    expect(await f.client.request('sketchdraw_find_elements', { documentId: f.document.id, query: 'Agent box' })).toMatchObject({ revision: 2, matches: [expect.objectContaining({ id: element.id, x: 70 })] });
    expect(f.controller.getSnapshot().revision).toBe(2);
  });
  it('denies read-only writes, wrong capabilities and actor spoofing', async () => {
    const f = await fixture('read');
    await expect(f.client.request('sketchdraw_apply_commands', rename('read-only'))).rejects.toMatchObject({ code: 'ACCESS_DENIED' });
    await expect(connectAgent({ ...f.grant.env, SKETCHDRAW_MCP_CAPABILITY: '0'.repeat(64) })).rejects.toMatchObject({ code: 'ACCESS_DENIED' });
    expect(() => f.client.request('sketchdraw_apply_commands', { ...rename('spoof'), actorId: 'human' } as never)).toThrow();
    expect(f.controller.getSnapshot().revision).toBe(0);
  });
  it('coalesces concurrent identical mutations across clients and rejects changed IDs/stale revisions', async () => {
    const f = await fixture();
    const other = await connectAgent(f.grant.env); cleanup.push(() => other.close());
    const request = rename('once');
    const results = await Promise.all([f.client.request('sketchdraw_apply_commands', request), other.request('sketchdraw_apply_commands', request)]);
    expect(results.every(result => result.revision === 1)).toBe(true);
    expect(f.controller.getSnapshot().revision).toBe(1);
    await expect(f.client.request('sketchdraw_apply_commands', rename('once', 'Different'))).rejects.toMatchObject({ code: 'REQUEST_ID_REUSED' });
    await expect(f.client.request('sketchdraw_apply_commands', rename('stale'))).rejects.toMatchObject({ code: 'REVISION_CONFLICT', currentRevision: 1 });
  });
  it('journals no-ops and applies source code through the same mutation path', async () => {
    const f = await fixture();
    expect(await f.client.request('sketchdraw_apply_commands', rename('noop', 'Original'))).toMatchObject({ revision: 0, changed: false });
    expect(await f.client.request('sketchdraw_apply_commands', rename('noop', 'Original'))).toMatchObject({ revision: 0, deduplicated: true });
    const read = await f.client.request('sketchdraw_read_code', { documentId: f.document.id });
    if (!('code' in read)) throw new Error('Missing code result.');
    expect(await f.client.request('sketchdraw_apply_code', { documentId: f.document.id, expectedRevision: 0, commandId: 'code', code: read.code.replace('Original', 'Code title') })).toMatchObject({ revision: 1, changed: true });
    expect(f.authority.source.getSnapshot().document.title).toBe('Code title');
  });
  it('revokes locally before a delayed write can reach its actual commit', async () => {
    let resume!: () => void, entered!: () => void;
    const gate = new Promise<void>(resolve => { resume = resolve; });
    const received = new Promise<void>(resolve => { entered = resolve; });
    const f = await fixture('write', async (_request, proceed) => { entered(); await gate; return proceed(); });
    const write = f.client.request('sketchdraw_apply_commands', rename('delayed'));
    const failed = expect(write).rejects.toMatchObject({ code: 'OUTCOME_UNKNOWN' });
    await received; await f.host.revokeGrant(f.grant.grant.grantId); resume();
    await failed;
    await new Promise(resolve => setTimeout(resolve, 20));
    expect(f.controller.getSnapshot().revision).toBe(0);
    await expect(connectAgent(f.grant.env)).rejects.toMatchObject({ code: 'ACCESS_DENIED' });
  });
  it('keeps a timed-out mutation reserved so a retry cannot execute twice', async () => {
    let resume!: () => void;
    const gate = new Promise<void>(resolve => { resume = resolve; });
    const f = await fixture('write', async (_request, proceed) => { await gate; return proceed(); });
    await expect(f.client.request('sketchdraw_apply_commands', rename('timeout'), 20)).rejects.toMatchObject({ code: 'OUTCOME_UNKNOWN' });
    resume();
    expect(await f.client.request('sketchdraw_apply_commands', rename('timeout'))).toMatchObject({ revision: 1, deduplicated: true });
    expect(f.controller.getSnapshot().revision).toBe(1);
  });
  it('rejects old grants even when the document ID is unchanged', async () => {
    const f = await fixture();
    // A changed epoch is rejected by the old renderer handler, but old grants are already invalidated.
    await expect(f.host.registerSession({ ...f.descriptor, sessionEpoch: 2 })).rejects.toMatchObject({ code: 'ACCESS_DENIED' });
    await expect(connectAgent(f.grant.env)).rejects.toMatchObject({ code: 'ACCESS_DENIED' });
  });
  it('closes an oversized unauthenticated frame without affecting the host', async () => {
    const f = await fixture();
    const { endpointOptions } = await import('../../../electron/agent-access/auth');
    const socket = createConnection(await endpointOptions(f.host.endpoint));
    await new Promise<void>((resolve, reject) => { socket.on('error', () => {}); socket.once('connect', () => socket.write('x'.repeat(5000))); socket.once('close', () => resolve()); setTimeout(() => { socket.destroy(); reject(new Error('Unauthenticated frame was not closed.')); }, 1000).unref(); });
    expect(await f.client.request('sketchdraw_read_document', { documentId: f.document.id })).toMatchObject({ revision: 0 });
  });
  it('never sends the raw capability to a false local server', async () => {
    const f = await fixture(); let received = '';
    const server = createServer(socket => { socket.on('data', chunk => { received += chunk.toString(); socket.end(JSON.stringify({ type: 'auth-challenge', version: 1, serverNonce: '1'.repeat(64), serverMac: '0'.repeat(64) }) + '\n'); }); });
    await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
    cleanup.push(() => new Promise<void>(resolve => server.close(() => resolve())));
    const address = server.address(); if (typeof address === 'string' || !address) throw new Error('Missing listener.');
    await expect(connectAgent({ ...f.grant.env, SKETCHDRAW_MCP_ENDPOINT: `tcp:127.0.0.1:${address.port}` })).rejects.toMatchObject({ code: 'ACCESS_DENIED' });
    expect(received).not.toContain(f.grant.capability);
  });
  it('serves a genuine SDK stdio client and preserves the grant after EOF', async () => {
    const f = await fixture();
    const sdk = new Client({ name: 'sketchdraw-test', version: '1.0.0' });
    const transport = new StdioClientTransport({ command: process.execPath, args: [path.resolve('dist-mcp/server.cjs')], env: { ...f.grant.env }, stderr: 'pipe', maxBufferSize: 40 * 1024 * 1024 });
    cleanup.push(() => sdk.close());
    await sdk.connect(transport);
    expect((await sdk.listTools()).tools).toHaveLength(6);
    const result = await sdk.callTool({ name: 'sketchdraw_apply_commands', arguments: rename('sdk', 'SDK changed') });
    expect(result.isError).not.toBe(true);
    expect(result.structuredContent).toMatchObject({ revision: 1, saved: false });
    expect(f.controller.getSnapshot().document.title).toBe('SDK changed');
    await sdk.close();
    const second: AgentClient = await connectAgent(f.grant.env); cleanup.push(() => second.close());
    expect(await second.request('sketchdraw_read_document', { documentId: f.document.id })).toMatchObject({ revision: 1 });
  }, 15_000);
});

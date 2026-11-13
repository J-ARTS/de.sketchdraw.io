import { afterEach, describe, expect, it } from 'vitest';
import { lstat, mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import { writeAgentRuntimeAccess } from '../../../electron/agent-access/runtime-access';
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
async function fixture(permission: AgentPermission = 'write', intercept?: (request: AgentRendererRequest, proceed: () => ReturnType<AgentHostOptions['onRequest']>) => ReturnType<AgentHostOptions['onRequest']>, documentId = 'doc:mcp') {
  const document = { ...createDocument('Original'), id: documentId };
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
    expect(await f.client.request('sketchdraw_read_code', { documentId: f.document.id })).toMatchObject({ formatVersion: 2, code: expect.stringContaining('sketchdraw 2') });
    expect(await f.client.request('sketchdraw_analyze_document', { documentId: f.document.id })).toMatchObject({ summary: { totalElements: 0 } });
  });
  it('commits into the same authority and permits a subsequent human edit', async () => {
    const f = await fixture();
    const element = createElement('rectangle', { id: 'shape:agent', label: 'Agent box', shapeVariant: 'hexagon' });
    expect(await f.client.request('sketchdraw_apply_commands', { ...rename('add'), command: { type: 'add', elements: [element] } })).toMatchObject({ revision: 1, changed: true, saved: false });
    const human = f.authority.bindActor({ actorId: 'human', source: 'human', grantId: 'human', grantGeneration: 1, guard: () => ({ allowed: true }) });
    await human.gateway.submit({ requestId: human.gateway.nextRequestId()!, expectedRevision: 1, action: { kind: 'dispatch', command: { type: 'update', changes: [{ id: element.id, patch: { x: 70 } }] } } });
    expect(await f.client.request('sketchdraw_find_elements', { documentId: f.document.id, query: 'Agent box' })).toMatchObject({ revision: 2, matches: [expect.objectContaining({ id: element.id, x: 70, shapeVariant: 'hexagon' })] });
    expect(f.controller.getSnapshot().revision).toBe(2);
  });
  it('lets the local user undo what an agent did when the handler is given the user as history owner (#176)', async () => {
    const document = { ...createDocument('Original'), id: 'doc:undo' };
    const controller = createController(document);
    const authority = createDocumentAuthority({ controller });
    const descriptor = { documentId: document.id, sessionEpoch: 1, webContentsGeneration: 1 };
    const handler = createRendererAgentHandler(authority, descriptor, { historyActorId: 'local-user' });
    const host = await createAgentHost({ onControl: handler.handleControl, onRequest: request => handler.handleRequest(request) });
    cleanup.push(() => host.close(), () => handler.dispose());
    await host.registerSession(descriptor);
    const client = await connectAgent((await host.issueGrant('write', 'test agent')).env); cleanup.push(() => client.close());
    const human = authority.bindActor({ actorId: 'local-user', source: 'human', grantId: 'local:human', grantGeneration: 0, guard: () => ({ allowed: true }) });
    expect(await client.request('sketchdraw_apply_commands', { documentId: document.id, expectedRevision: 0, commandId: 'agent-add', command: { type: 'add', elements: [{ id: 'box:agent', kind: 'rectangle', x: 0, y: 0, text: 'Vom Agenten' }] } } as never)).toMatchObject({ revision: 1, elementCount: 1 });
    expect(human.source.getHistoryState().canUndo).toBe(true);
    expect(await human.gateway.submit({ requestId: human.gateway.nextRequestId()!, expectedRevision: 1, action: { kind: 'undo' } })).toMatchObject({ status: 'committed', revision: 2 });
    expect(controller.getSnapshot().document.elements).toEqual([]);
    // The agent sees the undo as a normal change of the document and can go on from the new revision.
    expect(await client.request('sketchdraw_analyze_document', { documentId: document.id })).toMatchObject({ revision: 2, summary: { totalElements: 0 } });
    expect(await human.gateway.submit({ requestId: human.gateway.nextRequestId()!, expectedRevision: 2, action: { kind: 'redo' } })).toMatchObject({ status: 'committed', revision: 3 });
    expect(controller.getSnapshot().document.elements.map(element => element.id)).toEqual(['box:agent']);
  });
  it('lets agents work with pages: add a page, add to it, read pages and find elements with their page', async () => {
    const f = await fixture();
    expect(await f.client.request('sketchdraw_apply_commands', { ...rename('page'), command: { type: 'add-page', page: { id: 'page:agent', name: 'Agentenseite' } } })).toMatchObject({ revision: 1, changed: true });
    const element = createElement('rectangle', { id: 'shape:page', label: 'On page two', pageId: 'page:agent' });
    expect(await f.client.request('sketchdraw_apply_commands', { ...rename('on-page', 'Original', 1), command: { type: 'add', pageId: 'page:agent', elements: [element] } })).toMatchObject({ revision: 2, changed: true });
    // With several pages an element without a page is rejected instead of silently landing on the first one.
    const loose = { ...createElement('rectangle', { id: 'shape:loose' }), pageId: undefined } as unknown as ReturnType<typeof createElement>;
    await expect(f.client.request('sketchdraw_apply_commands', { ...rename('loose', 'Original', 2), command: { type: 'add', elements: [loose] } })).rejects.toMatchObject({ code: 'VALIDATION_FAILED' });
    const read = await f.client.request('sketchdraw_read_document', { documentId: f.document.id });
    expect(read).toMatchObject({ document: { pages: [{ id: 'page:1' }, { id: 'page:agent', name: 'Agentenseite' }] } });
    expect(await f.client.request('sketchdraw_find_elements', { documentId: f.document.id, query: 'On page two' })).toMatchObject({ matches: [expect.objectContaining({ id: 'shape:page', pageId: 'page:agent' })] });
    expect(await f.client.request('sketchdraw_analyze_document', { documentId: f.document.id })).toMatchObject({ summary: { pageCount: 2, totalElements: 1 } });
    const code = await f.client.request('sketchdraw_read_code', { documentId: f.document.id });
    if (!('code' in code)) throw new Error('Missing code result.');
    expect(code.code).toContain('page "page:agent" {"name":"Agentenseite"}');
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
  it('completes lean agent commands, routes bound connectors and explains rejections field by field (#176)', async () => {
    const f = await fixture();
    const send = (commandId: string, expectedRevision: number, command: unknown) => f.client.request('sketchdraw_apply_commands', { documentId: 'doc:mcp', expectedRevision, commandId, command } as never);
    expect(await send('lean', 0, { type: 'add', elements: [
      { id: 'box:api', kind: 'rectangle', x: 100, y: 100, width: 160, height: 80, text: 'API' },
      { id: 'box:db', kind: 'rectangle', x: 420, y: 100, width: 160, height: 80, text: 'DB' },
      { id: 'link:api-db', kind: 'connector', from: { elementId: 'box:api' }, to: { elementId: 'box:db' } },
    ] })).toMatchObject({ revision: 1, changed: true, elementCount: 3 });
    const elements = f.controller.getSnapshot().document.elements;
    expect(elements[0]).toMatchObject({ id: 'box:api', pageId: 'page:1', rotation: 0, style: { textAlign: 'center' } });
    expect(elements[2]).toMatchObject({ kind: 'connector', x: 260, y: 140, width: 160, height: 0, from: { elementId: 'box:api', anchor: { x: 1, y: 0.5 } }, to: { elementId: 'box:db', anchor: { x: 0, y: 0.5 } }, connectorRouting: 'elbowed' });
    // The connector is a bound one: it follows the element it is attached to.
    expect(await send('move', 1, { type: 'update', changes: [{ id: 'box:db', patch: { y: 300 } }] })).toMatchObject({ revision: 2 });
    expect(f.controller.getSnapshot().document.elements[2]!.points!.at(-1)).toEqual({ x: 160, y: 200 });

    // Search results say what a connector joins, and the analysis does not flag arrows for having no caption.
    expect(await f.client.request('sketchdraw_find_elements', { documentId: 'doc:mcp', query: 'link:api-db' })).toMatchObject({ matches: [{ id: 'link:api-db', fromElementId: 'box:api', toElementId: 'box:db' }] });
    expect(await f.client.request('sketchdraw_analyze_document', { documentId: 'doc:mcp' })).toMatchObject({ pages: [{ id: 'page:1', name: expect.any(String), elementCount: 3 }], summary: { boundConnectorCount: 1 }, findings: [] });
    // Completion problems are reported before anything is submitted; the revision does not move.
    await expect(send('no-id', 2, { type: 'add', elements: [{ kind: 'rectangle', x: 0, y: 0 }] })).rejects.toMatchObject({ code: 'VALIDATION_FAILED', message: expect.stringContaining('elements[0].id'), issues: [{ path: 'elements[0].id', code: 'MISSING_ID' }] });
    // A rejection by the document authority is explained with the domain's own issues.
    await expect(send('unknown', 2, { type: 'update', changes: [{ id: 'nope', patch: { text: 'x' } }] })).rejects.toMatchObject({ code: 'VALIDATION_FAILED', message: expect.stringMatching(/^Command rejected: .*nope/), issues: [expect.objectContaining({ path: expect.stringContaining('changes[0]') })] });
    await expect(send('bad-type', 2, { type: 'create_box' })).rejects.toMatchObject({ code: 'VALIDATION_FAILED', issues: expect.arrayContaining([expect.objectContaining({ message: expect.any(String) })]) });
    await expect(send('duplicate', 2, { type: 'add', elements: [{ id: 'box:api', kind: 'rectangle', x: 0, y: 0 }] })).rejects.toMatchObject({ code: 'VALIDATION_FAILED', issues: [expect.objectContaining({ message: expect.stringContaining('box:api') })] });
    // A rejected call has used up its commandId; the message says so instead of only naming the clash.
    await expect(send('unknown', 2, { type: 'rename', title: 'Korrigiert' })).rejects.toMatchObject({ code: 'REQUEST_ID_REUSED', message: expect.stringContaining('new commandId') });
    await expect(send('stale', 0, { type: 'rename', title: 'Alt' })).rejects.toMatchObject({ code: 'REVISION_CONFLICT', currentRevision: 2, message: expect.stringContaining('new commandId') });
    expect(f.controller.getSnapshot().revision).toBe(2);
  });
  it('tells an SDK client what each tool is for and returns results and errors as text too (#176)', async () => {
    const f = await fixture();
    const sdk = new Client({ name: 'sketchdraw-text-only', version: '1.0.0' });
    cleanup.push(() => sdk.close());
    await sdk.connect(new StdioClientTransport({ command: process.execPath, args: [path.resolve('dist-mcp/server.cjs')], env: { ...f.grant.env }, stderr: 'pipe', maxBufferSize: 40 * 1024 * 1024 }));
    expect(sdk.getInstructions()).toContain('sketchdraw_apply_commands');
    // The adapter found the skill that ships beside it and tells the client where it is.
    expect(sdk.getInstructions()).toMatch(/installed as a skill file: .*skills[\\/]sketchdraw-desktop[\\/]SKILL\.md$/);
    expect(sdk.getServerVersion()?.version).toMatch(/^\d+\.\d+\.\d+/);
    expect(sdk.getServerVersion()?.version).not.toBe('0.0.0');
    const tools = (await sdk.listTools()).tools;
    expect(new Set(tools.map(tool => tool.description)).size).toBe(6);
    const command = (tools.find(tool => tool.name === 'sketchdraw_apply_commands')!.inputSchema.properties as Record<string, { properties?: Record<string, { enum?: string[] }> }>).command!;
    expect(command.properties!.type!.enum).toContain('add');
    // A client that hands its model only the text still gets the whole result.
    const text = (result: Awaited<ReturnType<typeof sdk.callTool>>) => (result.content as Array<{ type: string; text: string }>)[0]!.text;
    const read = await sdk.callTool({ name: 'sketchdraw_read_document', arguments: {} });
    expect(JSON.parse(text(read))).toMatchObject({ documentId: 'doc:mcp', revision: 0, document: { title: 'Original' } });
    expect(JSON.parse(text(read))).toEqual(read.structuredContent);
    const added = await sdk.callTool({ name: 'sketchdraw_apply_commands', arguments: { documentId: 'doc:mcp', expectedRevision: 0, commandId: 'text-add', command: { type: 'add', elements: [{ id: 'box:1', kind: 'rectangle', x: 0, y: 0, text: 'Eins' }] } } });
    expect(added.isError).not.toBe(true);
    expect(text(added).split('\n')[0]).toBe('Change applied to the open document; it is not saved to a file.');
    expect(JSON.parse(text(added).split('\n')[1]!)).toMatchObject({ revision: 1, elementCount: 1 });
    const failed = await sdk.callTool({ name: 'sketchdraw_apply_commands', arguments: { documentId: 'doc:mcp', expectedRevision: 1, commandId: 'text-bad', command: { type: 'delete', ids: ['box:missing'] } } });
    expect(failed.isError).toBe(true);
    expect(text(failed)).toContain('VALIDATION_FAILED: Command rejected:');
    expect(text(failed)).toContain('box:missing');
    expect(JSON.parse(text(failed).split('\n')[1]!)).toMatchObject({ error: { code: 'VALIDATION_FAILED', issues: [expect.objectContaining({ code: 'UNKNOWN_DELETE_ID' })] } });
    // Six reads at once: the adapter queues what the app would refuse as BUSY.
    const parallel = await Promise.all(Array.from({ length: 6 }, () => sdk.callTool({ name: 'sketchdraw_read_code', arguments: {} })));
    expect(parallel.map(result => result.isError === true)).toEqual([false, false, false, false, false, false]);
  }, 20_000);
  it.each([false, true])('keeps concurrent reads alive across rotation (stale startup env: %s) without retargeting writes (#176)', async staleStartup => {
    const a = await fixture(); const b = await fixture('write', undefined, 'doc:other');
    const root = await mkdtemp(path.join(os.tmpdir(), 'sketchdraw-mcp-rotation-'));
    cleanup.push(() => rm(root, { recursive: true, force: true }));
    const runtimeFile = path.join(root, 'private', 'active.json');
    const publish = (env: typeof a.grant.env) => writeAgentRuntimeAccess(runtimeFile, env, { command: process.execPath, args: [path.resolve('dist-mcp/server.cjs')], env: { SKETCHDRAW_MCP_RUNTIME_FILE: runtimeFile } });
    await publish(a.grant.env);
    const sdk = new Client({ name: 'rotation-review', version: '1.0.0' }); cleanup.push(() => sdk.close());
    await sdk.connect(new StdioClientTransport({ command: process.execPath, args: [path.resolve('dist-mcp/server.cjs')], env: { ...(staleStartup ? a.grant.env : {}), SKETCHDRAW_MCP_RUNTIME_FILE: runtimeFile }, stderr: 'pipe' }));
    if (!staleStartup) expect((await sdk.callTool({ name: 'sketchdraw_read_document', arguments: {} })).structuredContent).toMatchObject({ documentId: 'doc:mcp' });
    await publish(b.grant.env); await a.host.close();
    const reads = Array.from({ length: 8 }, () => sdk.callTool({ name: 'sketchdraw_read_code', arguments: {} }));
    const stale = sdk.callTool({ name: 'sketchdraw_apply_commands', arguments: rename('stale-queued', 'Wrong document') });
    const unbound = sdk.callTool({ name: 'sketchdraw_apply_commands', arguments: { expectedRevision: 0, commandId: 'unbound-queued', command: { type: 'rename', title: 'Wrong document' } } });
    const results = await Promise.all(reads);
    expect(results.map(result => result.isError === true)).toEqual(Array(8).fill(false));
    for (const result of results) expect(result.structuredContent).toMatchObject({ documentId: 'doc:other' });
    expect((await stale).isError).toBe(true); expect((await unbound).isError).toBe(true);
    expect(b.controller.getSnapshot()).toMatchObject({ revision: 0, document: { title: 'Original' } });
    const explicit = await sdk.callTool({ name: 'sketchdraw_apply_commands', arguments: { ...rename('explicit', 'Intended'), documentId: 'doc:other' } });
    expect(explicit.isError).not.toBe(true);
    expect(b.controller.getSnapshot()).toMatchObject({ revision: 1, document: { title: 'Intended' } });
  }, 20_000);
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

import { afterEach, expect, it } from 'vitest';
import { createController, createDocument } from '../../../src/domain';
import { createDocumentAuthority } from '../../../src/session';
import { attachRendererAgentSession } from '../../../src/agent-access/renderer-session';
import { createRendererAgentHandler } from '../../../src/agent-access/renderer-handler';
import { createAgentHost } from '../../../electron/agent-access/host';
import { connectAgent } from '../../../src/mcp/client';
import type { AgentControlMessage, AgentRendererRequest, SketchdrawAgentAccessBridge } from '../../../src/agent-access/types';

const cleanup: (() => unknown | Promise<unknown>)[] = [];
afterEach(async () => { for (const action of cleanup.splice(0).reverse()) await action(); });
async function fixture() {
  let onControl: Parameters<SketchdrawAgentAccessBridge['onControl']>[0] | undefined;
  let onRequest: Parameters<SketchdrawAgentAccessBridge['onRequest']>[0] | undefined;
  const host = await createAgentHost({ onControl: async value => { if (!onControl) throw new Error('No renderer'); return onControl(value); }, onRequest: value => { if (!onRequest) throw new Error('No renderer'); return onRequest(value); } });
  cleanup.push(() => host.close());
  const bridge: SketchdrawAgentAccessBridge = {
    isAvailable: true,
    registerSession: session => host.registerSession({ ...session, webContentsGeneration: 7 }),
    createGrant: (permission, label) => host.issueGrant(permission, label),
    revokeGrant: id => host.revokeGrant(id), listGrants: async () => host.listGrants(),
    onControl(fn) { onControl = fn; return () => { if (onControl === fn) onControl = undefined; }; },
    onRequest(fn) { onRequest = fn; return () => { if (onRequest === fn) onRequest = undefined; }; },
  };
  return { host, bridge, hasListeners: () => Boolean(onControl || onRequest) };
}
it('bootstraps the Main generation and invalidates a reopened document with the same ID', async () => {
  const f = await fixture();
  const document = createDocument('First');
  const first = createDocumentAuthority({ controller: createController(document) });
  const session = attachRendererAgentSession(first, f.bridge); cleanup.push(() => session.dispose()); await session.ready;
  const grant = await session.createGrant('write');
  const client = await connectAgent(grant.env); cleanup.push(() => client.close());
  expect(await client.request('sketchdraw_read_document', { documentId: document.id })).toMatchObject({ document: { title: 'First' } });
  const barrier = await first.lifecycleGate.beginTransition('replace', 0);
  first.lifecycleGate.completeTransition(barrier.token);
  expect(() => session.dispose()).not.toThrow();
  expect(f.hasListeners()).toBe(false);
  const next = attachRendererAgentSession(createDocumentAuthority({ controller: createController({ ...document, title: 'Reopened' }) }), f.bridge);
  cleanup.push(() => next.dispose()); await next.ready;
  expect(await next.listGrants()).toEqual([]);
  await expect(connectAgent(grant.env)).rejects.toMatchObject({ code: 'ACCESS_DENIED' });
  const replacement = await next.createGrant('read');
  const reader = await connectAgent(replacement.env); cleanup.push(() => reader.close());
  expect(await reader.request('sketchdraw_read_document', { documentId: document.id })).toMatchObject({ document: { title: 'Reopened' } });
});
it('detaches a submitted mutation before asynchronous fingerprinting', async () => {
  const document = createDocument('Initial');
  const authority = createDocumentAuthority({ controller: createController(document) });
  const session = { documentId: document.id, sessionEpoch: 1, webContentsGeneration: 1 };
  const handler = createRendererAgentHandler(authority, session); cleanup.push(() => handler.dispose());
  const grant = { grantId: 'grant:test', grantGeneration: 1, actorId: 'agent:grant:test', documentId: document.id, sessionEpoch: 1, permission: 'write' as const, active: false, revoked: false, createdAt: 1 };
  expect(handler.handleControl({ type: 'install-grant', controlId: 'install', ...session, grant }).ok).toBe(true);
  const request: AgentRendererRequest = { ...session, requestId: 'request', operation: 'sketchdraw_apply_commands', grantId: grant.grantId, grantGeneration: 1, actorId: grant.actorId, permission: 'write', commandId: 'once', expectedRevision: 0, payload: { documentId: document.id, expectedRevision: 0, commandId: 'once', command: { type: 'rename', title: 'Submitted' } } };
  const response = handler.handleRequest(request);
  (request.payload as { command: { title: string } }).command.title = 'Mutated later';
  expect(await response).toMatchObject({ ok: true });
  expect(authority.source.getSnapshot().document.title).toBe('Submitted');
});
it('does not resurrect a revoked grant when an install acknowledgment arrives late', () => {
  const document = createDocument('Initial');
  const authority = createDocumentAuthority({ controller: createController(document) });
  const session = { documentId: document.id, sessionEpoch: 1, webContentsGeneration: 1 };
  const handler = createRendererAgentHandler(authority, session); cleanup.push(() => handler.dispose());
  const grant = { grantId: 'grant:late', grantGeneration: 1, actorId: 'agent:grant:late', documentId: document.id, sessionEpoch: 1, permission: 'write' as const, active: false, revoked: false, createdAt: 1 };
  const revoke: AgentControlMessage = { type: 'revoke-grant', ...session, controlId: 'revoke', grantId: grant.grantId, grantGeneration: 1, reason: 'revoked' };
  expect(handler.handleControl(revoke).ok).toBe(true);
  expect(handler.handleControl({ type: 'install-grant', controlId: 'late-install', ...session, grant })).toMatchObject({ ok: false, error: { code: 'ACCESS_DENIED' } });
});

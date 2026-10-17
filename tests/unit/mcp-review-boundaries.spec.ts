import { afterEach, describe, expect, it } from 'vitest';
import { createController, createDocument } from '../../src/domain';
import { createDocumentAuthority } from '../../src/session';
import { createRendererAgentHandler } from '../../src/agent-access/renderer-handler';
import type { AgentRendererRequest } from '../../src/agent-access/types';

const cleanup: (() => void)[] = [];
afterEach(() => { for (const dispose of cleanup.splice(0)) dispose(); });
function fixture() {
  const document = { ...createDocument('Initial'), id: 'doc:review' };
  const controller = createController(document);
  const authority = createDocumentAuthority({ controller });
  const session = { documentId: document.id, sessionEpoch: 3, webContentsGeneration: 4 };
  const handler = createRendererAgentHandler(authority, session);
  cleanup.push(handler.dispose);
  const grant = { grantId: 'grant:review', actorId: 'agent:grant:review', grantGeneration: 7, documentId: document.id, sessionEpoch: 3, permission: 'write' as const, active: false, revoked: false, createdAt: 1 };
  expect(handler.handleControl({ type: 'install-grant', controlId: 'install', ...session, grant }).ok).toBe(true);
  const request = (commandId: string, title = 'Changed'): AgentRendererRequest => ({
    ...session, requestId: commandId, operation: 'sketchdraw_apply_commands', grantId: grant.grantId,
    actorId: grant.actorId, grantGeneration: grant.grantGeneration, permission: 'write', commandId, expectedRevision: 0,
    payload: { documentId: document.id, commandId, expectedRevision: 0, command: { type: 'rename', title } },
  });
  return { handler, controller, authority, session, grant, request };
}

describe('Independent MCP boundary review', () => {
  it('rejects spoofed actor, permission, grant generation, session and payload revision', async () => {
    const f = fixture();
    for (const patch of [
      { actorId: 'human' }, { permission: 'read' as const }, { grantGeneration: 8 },
      { sessionEpoch: 4 }, { webContentsGeneration: 5 }, { expectedRevision: 1 },
    ]) expect(await f.handler.handleRequest({ ...f.request('forged'), ...patch })).toMatchObject({ ok: false });
    expect(f.controller.getSnapshot().revision).toBe(0);
    expect(await f.handler.handleRequest(f.request('valid'))).toMatchObject({ ok: true, revision: 1 });
  });

  it('revocation during asynchronous fingerprinting blocks the real shared commit', async () => {
    const f = fixture();
    const pending = f.handler.handleRequest(f.request('waiting'));
    f.handler.revokeLocal(f.grant.grantId);
    expect(await pending).toMatchObject({ ok: false, error: { code: 'ACCESS_REVOKED' } });
    expect(f.controller.getSnapshot()).toMatchObject({ revision: 0, document: { title: 'Initial' } });
  });

  it('a close barrier blocks waiting writes, and cancelling permits only a fresh command', async () => {
    const f = fixture();
    const pending = f.handler.handleRequest(f.request('before-close'));
    const barrier = await f.authority.lifecycleGate.beginTransition('close', 0);
    expect(await pending).toMatchObject({ ok: false });
    expect(f.controller.getSnapshot().revision).toBe(0);
    f.authority.lifecycleGate.cancelTransition(barrier.token);
    // The failed command remains reserved, so replay cannot unexpectedly run later.
    expect(await f.handler.handleRequest(f.request('before-close'))).toMatchObject({ ok: false });
    expect(await f.handler.handleRequest(f.request('after-cancel'))).toMatchObject({ ok: true, revision: 1 });
  });

  it('command IDs are bound to operation as well as payload and expected revision', async () => {
    const f = fixture();
    expect(await f.handler.handleRequest(f.request('same', 'Initial'))).toMatchObject({ ok: true, revision: 0 });
    const read = await f.handler.handleRequest({ ...f.request('read'), operation: 'sketchdraw_read_code', payload: { documentId: f.session.documentId } });
    if (!read.ok || !('code' in read.result)) throw new Error('Missing code');
    const same = f.request('same');
    expect(await f.handler.handleRequest({ ...same, operation: 'sketchdraw_apply_code', payload: { documentId: f.session.documentId, commandId: 'same', expectedRevision: 0, code: read.result.code } }))
      .toMatchObject({ ok: false, error: { code: 'REQUEST_ID_REUSED' } });
    expect(f.controller.getSnapshot().revision).toBe(0);
  });
});

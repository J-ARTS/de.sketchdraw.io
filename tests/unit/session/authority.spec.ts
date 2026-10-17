import { describe, expect, it, vi } from 'vitest';
import { createController, createDocument, createElement } from '../../../src/domain';
import type { DocumentCommand } from '../../../src/domain';
import { createDocumentAuthority, SessionAccessError } from '../../../src/session';
import type { ActorBinding, ActorBindingOptions, DocumentAuthority, DocumentCommit, WriteAction } from '../../../src/session';

function setup() {
  const controller = createController(createDocument('Original'));
  const fatal = vi.fn();
  const authority = createDocumentAuthority({ controller, onFatal: fatal });
  return { controller, authority, fatal };
}
function bind(authority: DocumentAuthority, changes: Partial<ActorBindingOptions> = {}) {
  return authority.bindActor({ actorId: 'human', source: 'human', grantId: 'ui', grantGeneration: 0,
    guard: () => ({ allowed: true }), ...changes });
}
function intent(binding: ActorBinding, action: WriteAction, expectedRevision = 0) {
  return { requestId: binding.gateway.nextRequestId()!, expectedRevision, action };
}
function rename(binding: ActorBinding, title: string, revision = 0) {
  return intent(binding, { kind: 'dispatch', command: { type: 'rename', title } }, revision);
}
function expectCode(fn: () => unknown, code: string) {
  try { fn(); throw new Error('Expected SessionAccessError'); }
  catch (error) { expect(error).toBeInstanceOf(SessionAccessError); expect((error as SessionAccessError).code).toBe(code); }
}

describe('DocumentAuthority public contract', () => {
  it('deduplicates pending and terminal writes, detaches intents and journals before notification', async () => {
    const { authority } = setup();
    const human = bind(authority);
    const commits: DocumentCommit[] = [];
    const queries: Promise<unknown>[] = [];
    authority.subscribeCommits(commit => { commits.push(commit); queries.push(human.gateway.queryOutcome(commit.requestId)); });
    const request = rename(human, 'First');
    expect(human.gateway.nextRequestId()).toBe(request.requestId);
    const first = human.gateway.submit(request);
    const duplicate = human.gateway.submit(structuredClone(request));
    expect(human.gateway.nextRequestId()).toBeNull();
    expect(await human.gateway.queryOutcome(request.requestId)).toEqual({ status: 'pending', requestId: request.requestId });
    (request.action as { kind: 'dispatch'; command: { type: 'rename'; title: string } }).command.title = 'Mutated caller';
    expect(await first).toMatchObject({ status: 'committed', revision: 1 });
    expect(await duplicate).toEqual(await first);
    expect(commits).toHaveLength(1);
    expect(commits[0]?.snapshot.document.title).toBe('First');
    expect(await queries[0]).toMatchObject({ status: 'committed', revision: 1 });
    expect(await human.gateway.submit(request)).toMatchObject({ code: 'REQUEST_ID_REUSED', accepted: true });
    request.action = { kind: 'dispatch', command: { type: 'rename', title: 'First' } };
    expect(await human.gateway.submit(request)).toEqual(await first);
    expect(authority.source.getSnapshot().revision).toBe(1);
  });

  it('consumes accepted conflicts and no-ops, preserves sequence on admission rejection', async () => {
    const { authority } = setup(); const human = bind(authority); const commits = vi.fn();
    authority.subscribeCommits(commits);
    const original = rename(human, 'Original');
    expect(await human.gateway.submit({ ...original, requestId: `${human.scopeId}:2` })).toMatchObject({ code: 'SEQUENCE_GAP', accepted: false });
    expect(human.gateway.nextRequestId()).toBe(original.requestId);
    expect(await human.gateway.submit(original)).toMatchObject({ status: 'no-op', revision: 0 });
    expect(commits).not.toHaveBeenCalled();
    expect(await human.gateway.submit(rename(human, 'Stale', 4))).toMatchObject({ code: 'REVISION_CONFLICT', accepted: true, currentRevision: 0 });
    expect(human.gateway.nextRequestId()).toBe(`${human.scopeId}:3`);
    expect(await human.gateway.submit(rename(human, 'Valid'))).toMatchObject({ status: 'committed', revision: 1 });
  });

  it('rechecks a grant generation after submission and immediately before the real commit', async () => {
    const { authority } = setup(); let generation = 3;
    const checks: unknown[] = [];
    const agent = bind(authority, { actorId: 'agent', source: 'agent', grantId: 'mcp', grantGeneration: 3,
      guard: check => { checks.push(check); return check.grantGeneration === generation
        ? { allowed: true } : { allowed: false, code: 'ACCESS_REVOKED' }; } });
    const request = rename(agent, 'Denied');
    const pending = agent.gateway.submit(request);
    generation = 4;
    expect(await pending).toMatchObject({ code: 'ACCESS_REVOKED', accepted: true });
    expect(authority.source.getSnapshot().revision).toBe(0);
    expectCode(() => agent.source.getSnapshot(), 'ACCESS_REVOKED');
    expect(await agent.gateway.queryOutcome(request.requestId)).not.toHaveProperty('currentRevision');
    expect(checks).toContainEqual(expect.objectContaining({ bindingId: agent.bindingId, bindingGeneration: agent.bindingGeneration,
      grantId: 'mcp', grantGeneration: 3, actorId: 'agent', source: 'agent', permission: 'write' }));
  });

  it('synchronous revoke cancels queued writes and prevents reads or subscriber delivery', async () => {
    const { authority } = setup(); const human = bind(authority); const agent = bind(authority, { actorId: 'agent', source: 'agent' });
    const subscriber = vi.fn(); agent.source.subscribe(subscriber);
    const request = rename(agent, 'No'); const pending = agent.gateway.submit(request);
    authority.revokeBinding(agent.bindingId); authority.revokeBinding(agent.bindingId);
    expect(await pending).toMatchObject({ code: 'ACCESS_REVOKED', accepted: true });
    expectCode(() => agent.source.getHistoryState(), 'ACCESS_REVOKED');
    expectCode(() => agent.gateway.nextRequestId(), 'ACCESS_REVOKED');
    await human.gateway.submit(rename(human, 'Yes'));
    expect(subscriber).not.toHaveBeenCalled();
    expect(authority.source.getSnapshot().document.title).toBe('Yes');
  });

  it('shares human history across sources while preserving another actor and enforcing undo CAS', async () => {
    const { authority } = setup(); const human = bind(authority); const code = bind(authority, { source: 'code', grantId: 'code' });
    const agent = bind(authority, { actorId: 'agent', source: 'agent' });
    await human.gateway.submit(rename(human, 'Human'));
    await agent.gateway.submit(intent(agent, { kind: 'dispatch', command: { type: 'set-metadata', patch: { agent: 'kept' } } }, 1));
    expect(code.source.getHistoryState().canUndo).toBe(true);
    expect(await code.gateway.submit(intent(code, { kind: 'undo' }, 1))).toMatchObject({ code: 'REVISION_CONFLICT' });
    expect(await code.gateway.submit(intent(code, { kind: 'undo' }, 2))).toMatchObject({ status: 'committed', revision: 3 });
    expect(authority.source.getSnapshot().document).toMatchObject({ title: 'Original', metadata: { agent: 'kept' } });
    expect(await human.gateway.submit(intent(human, { kind: 'redo' }, 3))).toMatchObject({ status: 'committed', revision: 4 });
  });

  it('reports empty/conflicting history and validates commands atomically', async () => {
    const { authority } = setup(); const human = bind(authority); const other = bind(authority, { actorId: 'other' });
    expect(await human.gateway.submit(intent(human, { kind: 'undo' }))).toMatchObject({ code: 'HISTORY_EMPTY', accepted: true });
    await human.gateway.submit(rename(human, 'Human'));
    await other.gateway.submit(rename(other, 'Other', 1));
    expect(await human.gateway.submit(intent(human, { kind: 'undo' }, 2))).toMatchObject({ code: 'HISTORY_CONFLICT' });
    const bad: DocumentCommand = { type: 'batch', commands: [{ type: 'rename', title: 'Partial' },
      { type: 'add', elements: [{ ...createElement('rectangle'), width: -1 }] }] };
    expect(await human.gateway.submit(intent(human, { kind: 'dispatch', command: bad }, 2))).toMatchObject({ code: 'VALIDATION_FAILED' });
    expect(authority.source.getSnapshot()).toMatchObject({ revision: 2, document: { title: 'Other' } });
  });

  it('isolates listeners, orders reentrant writes and never exposes mutable journal state', async () => {
    const { authority } = setup(); const human = bind(authority); const revisions: number[] = []; let next: Promise<unknown> | undefined;
    authority.subscribeCommits(commit => { commit.snapshot.document.title = 'Tampered'; throw new Error('listener'); });
    authority.subscribeCommits(commit => {
      revisions.push(commit.snapshot.revision);
      expect(commit.snapshot.document.title).not.toBe('Tampered');
      if (commit.snapshot.revision === 1) next = human.gateway.submit(rename(human, 'Second', 1));
    });
    human.source.subscribe(() => { throw new Error('source'); });
    const first = await human.gateway.submit(rename(human, 'First'));
    expect(first).toMatchObject({ status: 'committed', revision: 1 });
    await next;
    expect(revisions).toEqual([1, 2]);
    const copy = authority.source.getSnapshot(); copy.document.title = 'Local copy';
    expect(authority.source.getSnapshot().document.title).toBe('Second');
  });

  it('one unresolved operation per actor also covers separate code/import scopes', async () => {
    const { authority } = setup(); const human = bind(authority); const code = bind(authority, { source: 'code' });
    const codeId = code.gateway.nextRequestId()!;
    const pending = human.gateway.submit(rename(human, 'Human'));
    expect(code.gateway.nextRequestId()).toBeNull();
    expect(await code.gateway.submit({ requestId: codeId, expectedRevision: 0, action: { kind: 'undo' } })).toMatchObject({ code: 'BUSY', accepted: false });
    await pending;
    expect(code.gateway.nextRequestId()).toBe(codeId);
  });

  it('barriers synchronously reject unlinearized writes, retain committed work and protect newer tokens', async () => {
    const { authority } = setup(); const human = bind(authority);
    await human.gateway.submit(rename(human, 'Committed'));
    const request = rename(human, 'Waiting', 1);
    const waiting = human.gateway.submit(request);
    const barrierPromise = authority.lifecycleGate.beginTransition('close', 4);
    expect(human.gateway.nextRequestId()).toBeNull();
    expect(await waiting).toMatchObject({ code: 'TRANSITION_PENDING', accepted: true });
    const barrier = await barrierPromise;
    expect(barrier.snapshot).toMatchObject({ revision: 1, document: { title: 'Committed' } });
    expect(barrier.unresolvedRequestIds).toEqual([]);
    expect(authority.lifecycleGate.isCurrent(barrier, 4)).toBe(true);
    expect(authority.lifecycleGate.isCurrent(barrier, 5)).toBe(false);
    await expect(authority.lifecycleGate.beginTransition('replace', 4)).rejects.toMatchObject({ code: 'TRANSITION_PENDING' });
    authority.lifecycleGate.cancelTransition(barrier.token);
    const newer = await authority.lifecycleGate.beginTransition('replace', 5);
    authority.lifecycleGate.cancelTransition(barrier.token);
    expect(authority.lifecycleGate.isCurrent(newer, 5)).toBe(true);
    authority.lifecycleGate.cancelTransition(newer.token);
    expect(await human.gateway.submit({ ...request, action: { kind: 'dispatch', command: { type: 'rename', title: 'Changed payload' } } })).toMatchObject({ code: 'REQUEST_ID_REUSED' });
    expect(await human.gateway.submit(request)).toMatchObject({ code: 'TRANSITION_PENDING', accepted: true });
    expect(await human.gateway.submit(rename(human, 'After cancel', 1))).toMatchObject({ status: 'committed' });
  });

  it('close/replace irreversibly end the authority, revoke completion permits local work', async () => {
    const { authority, controller } = setup(); const human = bind(authority);
    const revoke = await authority.lifecycleGate.beginTransition('revoke', 0);
    authority.lifecycleGate.completeTransition(revoke.token);
    expect(await human.gateway.submit(rename(human, 'After revoke'))).toMatchObject({ status: 'committed' });
    const close = await authority.lifecycleGate.beginTransition('close', 0);
    authority.lifecycleGate.completeTransition(close.token);
    expectCode(() => human.source.getSnapshot(), 'SESSION_CHANGED');
    expectCode(() => authority.lifecycleGate.cancelTransition(close.token), 'SESSION_CHANGED');
    expectCode(() => createDocumentAuthority({ controller }), 'ACCESS_DENIED');
    const replacement = createDocumentAuthority({ controller: createController(controller.getSnapshot().document, 1) });
    expect(replacement.session.controllerEpoch).not.toBe(authority.session.controllerEpoch);
  });

  it('stops on an external controller mutation without inventing commit metadata', async () => {
    const { authority, controller, fatal } = setup(); const human = bind(authority); const commits = vi.fn();
    authority.subscribeCommits(commits);
    const pending = human.gateway.submit(rename(human, 'Queued'));
    controller.dispatch({ type: 'rename', title: 'Bypass' }, { actorId: 'bypass', source: 'human', expectedRevision: 0 });
    expect(await pending).toMatchObject({ code: 'AUTHORITY_DIVERGED' });
    expectCode(() => authority.source.getSnapshot(), 'AUTHORITY_DIVERGED');
    expect(fatal).toHaveBeenCalledExactlyOnceWith({ code: 'AUTHORITY_DIVERGED' });
    expect(commits).not.toHaveBeenCalled();
  });

  it('stops on a direct reentrant controller write from a legacy subscriber', async () => {
    const controller = createController(createDocument());
    controller.subscribe(snapshot => {
      if (snapshot.revision === 1) controller.dispatch({ type: 'rename', title: 'Bypass' },
        { actorId: 'bypass', source: 'human', expectedRevision: 1 });
    });
    const fatal = vi.fn(); const authority = createDocumentAuthority({ controller, onFatal: fatal }); const human = bind(authority);
    const commits = vi.fn(); authority.subscribeCommits(commits);
    expect(await human.gateway.submit(rename(human, 'First'))).toMatchObject({ status: 'outcome-unknown' });
    expect(commits).not.toHaveBeenCalled(); expect(fatal).toHaveBeenCalledOnce();
  });

  it('rejects asynchronous, throwing, and reentrant guards even if the guard catches the error', async () => {
    for (const guard of [(() => Promise.resolve({ allowed: true })) as unknown as ActorBindingOptions['guard'],
      () => { throw new Error('IAM unavailable'); }]) {
      const { authority } = setup(); const bound = bind(authority, { guard });
      expectCode(() => bound.source.getSnapshot(), 'ACCESS_DENIED');
    }
    const { authority } = setup(); const bound = bind(authority, { guard: () => {
      try { authority.bindActor({ actorId: 'evil', source: 'agent', grantId: 'evil', grantGeneration: 0, guard: () => ({ allowed: true }) }); } catch { /* no bypass */ }
      return { allowed: true };
    } });
    expectCode(() => bound.source.getSnapshot(), 'ACCESS_DENIED');
    expect(authority.source.getSnapshot().revision).toBe(0);
  });

  it('releases only fully revoked peer groups, blocks old objects and retains local grants/history', async () => {
    const { authority } = setup(); const local = bind(authority); await local.gateway.submit(rename(local, 'Local'));
    const peerSessionId = 'a'.repeat(32);
    const peers = Array.from({ length: 32 }, (_, n) => bind(authority, { actorId: `peer:${n}`, source: 'peer', peerSessionId }));
    const old = peers[0]!; const request = rename(old, 'Pending', 1); const pending = old.gateway.submit(request);
    expectCode(() => authority.finalizePeerSession(peerSessionId), 'BUSY');
    for (const peer of peers) authority.revokeBinding(peer.bindingId);
    authority.finalizePeerSession(peerSessionId); authority.finalizePeerSession(peerSessionId);
    expect(await pending).toMatchObject({ code: 'ACCESS_REVOKED' });
    expectCode(() => old.source.getSnapshot(), 'ACCESS_REVOKED');
    expect(await old.gateway.submit(request)).toMatchObject({ code: 'ACCESS_REVOKED', accepted: true, requestId: request.requestId });
    expect(await old.gateway.queryOutcome(request.requestId)).toMatchObject({ code: 'ACCESS_REVOKED', accepted: true });
    authority.revokeBinding(old.bindingId);
    expectCode(() => bind(authority, { source: 'peer', peerSessionId }), 'ACCESS_REVOKED');
    const next = Array.from({ length: 32 }, (_, n) => bind(authority, { actorId: `new:${n}`, source: 'peer', peerSessionId: 'b'.repeat(32) }));
    expect(next).toHaveLength(32);
    expect(local.source.getHistoryState().canUndo).toBe(true);
    expect(await local.gateway.submit(intent(local, { kind: 'undo' }, 1))).toMatchObject({ status: 'committed', revision: 2 });
  });

  it('enforces binding limits including revoked bindings and validates peer grouping', () => {
    const { authority } = setup();
    expectCode(() => bind(authority, { source: 'peer' }), 'VALIDATION_FAILED');
    expectCode(() => bind(authority, { peerSessionId: 'a'.repeat(32) }), 'VALIDATION_FAILED');
    for (let n = 0; n < 16; n += 1) authority.revokeBinding(bind(authority, { actorId: `local:${n}` }).bindingId);
    expectCode(() => bind(authority), 'BUSY');
  });

  it('rejects malformed IDs, executable input, unknown fields and oversized payloads without consuming IDs', async () => {
    const { authority } = setup(); const human = bind(authority); const request = rename(human, 'Safe');
    const getter = vi.fn(() => request.action);
    const executable = { ...request };
    Object.defineProperty(executable, 'action', { enumerable: true, get: getter });
    expect(await human.gateway.submit(executable)).toMatchObject({ code: 'VALIDATION_FAILED', accepted: false });
    expect(getter).not.toHaveBeenCalled();
    expect(await human.gateway.submit({ ...request, actorId: 'forged' } as typeof request)).toMatchObject({ code: 'VALIDATION_FAILED' });
    expect(await human.gateway.submit({ ...request, requestId: `${human.scopeId}:01` })).toMatchObject({ code: 'PROTOCOL_ERROR' });
    expect(await human.gateway.submit({ ...request, expectedRevision: Number.NaN })).toMatchObject({ code: 'VALIDATION_FAILED' });
    const large = { ...request, action: { kind: 'dispatch' as const,
      command: { type: 'rename' as const, title: 'x'.repeat(40 * 1024 * 1024 + 1) } } };
    expect(await human.gateway.submit(large)).toMatchObject({ code: 'REQUEST_TOO_LARGE', accepted: false });
    expect(human.gateway.nextRequestId()).toBe(request.requestId);
    expect(authority.source.getSnapshot().revision).toBe(0);
    expect(await human.gateway.submit(request)).toMatchObject({ status: 'committed' });
  });

  it('canonicalizes key order and denies proxy reentrancy during input validation', async () => {
    const { authority } = setup(); const human = bind(authority); const first = rename(human, 'Same');
    await human.gateway.submit(first);
    const reordered = { action: { command: { title: 'Same', type: 'rename' as const }, kind: 'dispatch' as const },
      requestId: first.requestId, expectedRevision: 0 };
    expect(await human.gateway.submit(reordered)).toMatchObject({ status: 'committed', revision: 1 });
    const second = rename(human, 'Bad', 1);
    const proxied = new Proxy(second, { ownKeys(target) {
      try { authority.revokeBinding(human.bindingId); } catch { /* authority refuses */ }
      return Reflect.ownKeys(target);
    } });
    expect(await human.gateway.submit(proxied)).toMatchObject({ code: 'VALIDATION_FAILED' });
    expect(await human.gateway.submit(second)).toMatchObject({ status: 'committed', revision: 2 });
  });

  it('does not publish another actor revision to a grant revoked during notification', async () => {
    const { authority } = setup(); const human = bind(authority); let allowed = true;
    const agent = bind(authority, { actorId: 'agent', source: 'agent',
      guard: () => allowed ? { allowed: true } : { allowed: false, code: 'ACCESS_REVOKED' } });
    const listener = vi.fn(); agent.source.subscribe(listener);
    authority.subscribeCommits(() => { allowed = false; });
    await human.gateway.submit(rename(human, 'Private'));
    expect(listener).not.toHaveBeenCalled();
    expectCode(() => agent.source.getSnapshot(), 'ACCESS_REVOKED');
  });

  it('keeps a high-water mark after result eviction and never replays an old write', async () => {
    const { authority } = setup(); const human = bind(authority); const first = rename(human, 'Original');
    await human.gateway.submit(first);
    for (let n = 0; n < 1024; n += 1) await human.gateway.submit(rename(human, 'Original'));
    expect(await human.gateway.queryOutcome(first.requestId)).toEqual({ status: 'outcome-unknown', requestId: first.requestId });
    expect(await human.gateway.submit({ ...first, action: { kind: 'dispatch', command: { type: 'rename', title: 'Replay' } } }))
      .toEqual({ status: 'outcome-unknown', requestId: first.requestId });
    expect(authority.source.getSnapshot().revision).toBe(0);
  });
});

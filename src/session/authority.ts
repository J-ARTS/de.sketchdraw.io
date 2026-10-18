import {
  DomainConflictError, DomainValidationError, validateDocument,
} from '../domain';
import type { DocumentSession } from '../domain';
import { SessionAccessError } from './errors';
import type { WriteErrorCode } from './errors';
import type {
  ActorBinding, ActorBindingOptions, DocumentAuthority, DocumentAuthorityOptions,
  DocumentCommit, DocumentLifecycleGate, GrantCheck, TransitionBarrier, WriteIntent, WriteOutcome,
} from './types';
import {
  clone, digest, encodeIntent, freeze, LIMITS, randomId, requestSequence, validHex, validId, validInteger,
} from './validation';

interface BindingState {
  id: string;
  generation: number;
  scope: string;
  options: ActorBindingOptions;
  revoked: boolean;
  highWater: number;
  listeners: Set<(snapshot: DocumentSession) => void>;
}
interface Entry {
  id: string;
  binding: BindingState;
  intent?: WriteIntent;
  canonical?: string;
  digest?: string;
  hashPromise?: Promise<string>;
  hashSettled: boolean;
  bytes: number;
  journalBytes: number;
  outcome?: WriteOutcome;
  promise: Promise<WriteOutcome>;
  resolve: (outcome: WriteOutcome) => void;
}
interface Transition {
  token: string;
  reason: 'close' | 'replace' | 'revoke';
  generation: number;
  barrier?: TransitionBarrier;
}
const ownedControllers = new WeakSet<object>();
const SOURCES = new Set(['human', 'code', 'import', 'agent', 'peer']);

function reject(requestId: string, code: WriteErrorCode, accepted = false, currentRevision?: number): WriteOutcome {
  return currentRevision === undefined
    ? { status: 'rejected', requestId, code, accepted }
    : { status: 'rejected', requestId, code, accepted, currentRevision };
}
function errorCode(error: unknown): WriteErrorCode {
  return error instanceof SessionAccessError ? error.code : 'INTERNAL_ERROR';
}
function safeNotify<T>(listener: (value: T) => void, value: T): void {
  try {
    // Also isolate an async listener's rejection, without waiting for its effects.
    void Promise.resolve(listener(value)).catch(() => undefined);
  } catch { /* A listener cannot roll back a committed operation. */ }
}
function initialSnapshot(options: DocumentAuthorityOptions): DocumentSession {
  try {
    const snapshot = options.controller.getSnapshot();
    if (!validInteger(snapshot.revision)) throw new SessionAccessError('VALIDATION_FAILED');
    return { document: validateDocument(snapshot.document), revision: snapshot.revision };
  } catch (error) {
    throw new SessionAccessError(error instanceof DomainValidationError ? 'VALIDATION_FAILED'
      : errorCode(error));
  }
}

export function createDocumentAuthority(options: DocumentAuthorityOptions): DocumentAuthority {
  if (!options || !options.controller || typeof options.controller !== 'object'
    || ['getSnapshot', 'dispatch', 'undo', 'redo', 'getHistoryState', 'subscribe']
      .some(key => typeof (options.controller as unknown as Record<string, unknown>)[key] !== 'function')
    || (options.onFatal !== undefined && typeof options.onFatal !== 'function')) {
    throw new SessionAccessError('VALIDATION_FAILED');
  }
  if (ownedControllers.has(options.controller)) throw new SessionAccessError('ACCESS_DENIED');
  const controller = options.controller;
  const onFatal = options.onFatal;
  let snapshot = initialSnapshot(options);
  const session = freeze({ documentId: snapshot.document.id, controllerEpoch: randomId() });
  const bindings = new Map<string, BindingState>();
  const endedPeerSessions = new Set<string>();
  const revokedBindingIds = new Set<string>();
  const journal = new Map<string, Entry>();
  const actorPending = new Map<string, Entry>();
  const queue: Entry[] = [];
  const listeners = new Set<(snapshot: DocumentSession) => void>();
  const commitListeners = new Set<(commit: DocumentCommit) => void>();
  let bindingGeneration = 0;
  let pendingBytes = 0;
  let pendingCount = 0;
  let localPendingCount = 0;
  let journalBytes = 0;
  let pumping = false;
  let executing: Entry | undefined;
  let externalApply = false;
  let observed: DocumentSession | undefined;
  let transition: Transition | undefined;
  let stopped: WriteErrorCode | undefined;
  let inGuard = false;
  let guardViolated = false;
  let unsubscribeController = (): void => {};

  function notInGuard(): void {
    if (inGuard) {
      guardViolated = true;
      throw new SessionAccessError('ACCESS_DENIED');
    }
  }
  function running(): void {
    notInGuard();
    if (stopped) throw new SessionAccessError(stopped);
  }
  function trimJournal(): void {
    if (journal.size <= LIMITS.journalEntries && journalBytes <= LIMITS.journalBytes) return;
    for (const [id, entry] of journal) {
      if (!entry.outcome) continue;
      journal.delete(id);
      journalBytes -= entry.journalBytes;
      if (journal.size <= LIMITS.journalEntries && journalBytes <= LIMITS.journalBytes) break;
    }
  }
  function releasePayload(entry: Entry): void {
    if (entry.outcome && entry.hashSettled) {
      pendingBytes -= entry.bytes;
      entry.bytes = 0;
    }
  }
  function finish(entry: Entry, outcome: WriteOutcome): void {
    if (entry.outcome) return;
    entry.outcome = freeze(outcome);
    entry.intent = undefined;
    entry.canonical = undefined;
    releasePayload(entry);
    pendingCount -= 1;
    if (entry.binding.options.source !== 'peer') localPendingCount -= 1;
    if (actorPending.get(entry.binding.options.actorId) === entry) {
      actorPending.delete(entry.binding.options.actorId);
    }
    // The terminal journal contains IDs, a digest and a small outcome, never a document.
    entry.journalBytes += JSON.stringify(outcome).length * 3;
    journalBytes += JSON.stringify(outcome).length * 3;
    trimJournal();
    entry.resolve(entry.outcome);
  }
  function stop(code: WriteErrorCode): void {
    if (stopped) return;
    stopped = code;
    for (const entry of journal.values()) {
      if (!entry.outcome) {
        finish(entry, entry === executing ? { status: 'outcome-unknown', requestId: entry.id }
          : reject(entry.id, code, true));
      }
    }
    listeners.clear();
    commitListeners.clear();
    for (const binding of bindings.values()) binding.listeners.clear();
    unsubscribeController();
    if (code === 'AUTHORITY_DIVERGED' || code === 'INTERNAL_ERROR') {
      if (onFatal) safeNotify(onFatal, { code });
    }
  }
  function consistency(): void {
    running();
    try {
      const actual = controller.getSnapshot();
      if (actual.revision !== snapshot.revision || actual.document.id !== session.documentId) {
        stop('AUTHORITY_DIVERGED');
        throw new SessionAccessError('AUTHORITY_DIVERGED');
      }
    } catch (error) {
      if (error instanceof SessionAccessError) throw error;
      stop('INTERNAL_ERROR');
      throw new SessionAccessError('INTERNAL_ERROR');
    }
  }
  function check(binding: BindingState, permission: 'read' | 'write'): void {
    running();
    if (binding.revoked) throw new SessionAccessError('ACCESS_REVOKED');
    const data: GrantCheck = freeze({
      session, bindingId: binding.id, bindingGeneration: binding.generation,
      grantId: binding.options.grantId, grantGeneration: binding.options.grantGeneration,
      actorId: binding.options.actorId, source: binding.options.source, permission,
    });
    let denied: WriteErrorCode | undefined;
    try {
      inGuard = true;
      guardViolated = false;
      const decision: unknown = binding.options.guard(data);
      if (decision instanceof Promise) void decision.catch(() => undefined);
      if (!decision || typeof decision !== 'object'
        || (Object.getPrototypeOf(decision) !== Object.prototype && Object.getPrototypeOf(decision) !== null)) {
        denied = 'ACCESS_DENIED';
      } else {
        const allowed = Object.getOwnPropertyDescriptor(decision, 'allowed');
        const code = Object.getOwnPropertyDescriptor(decision, 'code');
        const keys = Object.keys(decision).sort().join(',');
        if (allowed && 'value' in allowed && allowed.value === true && keys === 'allowed') {
          denied = undefined;
        } else if (allowed && 'value' in allowed && allowed.value === false && keys === 'allowed,code'
          && code && 'value' in code && ['ACCESS_DENIED', 'ACCESS_REVOKED', 'SESSION_CHANGED'].includes(code.value)) {
          denied = code.value as WriteErrorCode;
        } else denied = 'ACCESS_DENIED';
      }
    } catch { denied = 'ACCESS_DENIED'; }
    finally {
      if (guardViolated) denied = 'ACCESS_DENIED';
      inGuard = false;
    }
    if (denied) throw new SessionAccessError(denied);
    if (stopped) throw new SessionAccessError(stopped);
    if (binding.revoked) throw new SessionAccessError('ACCESS_REVOKED');
  }
  function readCheck(binding?: BindingState): void {
    consistency();
    if (binding) check(binding, 'read');
  }
  function writeCheck(binding: BindingState, expectedRevision: number): void {
    consistency();
    check(binding, 'write');
    // A synchronous guard may observe changed IAM state but cannot execute any work.
    // Recheck authority-owned state after it and call the controller without an await.
    consistency();
    if (transition) throw new SessionAccessError('TRANSITION_PENDING');
    if (expectedRevision !== snapshot.revision) throw new SessionAccessError('REVISION_CONFLICT');
  }
  function subscribe(binding: BindingState | undefined, listener: (value: DocumentSession) => void): () => void {
    if (typeof listener !== 'function') throw new SessionAccessError('VALIDATION_FAILED');
    readCheck(binding);
    const set = binding ? binding.listeners : listeners;
    set.add(listener);
    return () => { notInGuard(); set.delete(listener); };
  }
  function notifySnapshot(next: DocumentSession): void {
    for (const listener of Array.from(listeners)) {
      if (stopped) return;
      if (listeners.has(listener)) safeNotify(listener, clone(next));
    }
    for (const binding of Array.from(bindings.values())) {
      for (const listener of Array.from(binding.listeners)) {
        if (stopped) return;
        if (!binding.listeners.has(listener)) continue;
        try { readCheck(binding); }
        catch { binding.listeners.clear(); break; }
        safeNotify(listener, clone(next));
      }
    }
  }
  function notify(commit: DocumentCommit): void {
    for (const listener of Array.from(commitListeners)) {
      if (stopped) return;
      if (commitListeners.has(listener)) safeNotify(listener, clone(commit));
    }
    for (const listener of Array.from(listeners)) {
      if (stopped) return;
      if (listeners.has(listener)) safeNotify(listener, clone(commit.snapshot));
    }
    for (const binding of Array.from(bindings.values())) {
      for (const listener of Array.from(binding.listeners)) {
        if (stopped) return;
        if (!binding.listeners.has(listener)) continue;
        try { readCheck(binding); }
        catch { binding.listeners.clear(); break; }
        safeNotify(listener, clone(commit.snapshot));
      }
    }
  }
  function process(entry: Entry): void {
    if (entry.outcome || !entry.intent) return;
    const intent = entry.intent;
    try {
      writeCheck(entry.binding, intent.expectedRevision);
      executing = entry;
      observed = undefined;
      const previousRevision = snapshot.revision;
      const action = intent.action;
      const result = action.kind === 'dispatch'
        ? controller.dispatch(action.command, {
          actorId: entry.binding.options.actorId, source: entry.binding.options.source,
          expectedRevision: intent.expectedRevision,
        })
        : controller[action.kind](entry.binding.options.actorId);
      if (stopped) return;
      const notification = observed as DocumentSession | undefined;
      if (result.document.id !== session.documentId
        || (result.revision !== previousRevision && result.revision !== previousRevision + 1)
        || (result.revision === previousRevision ? notification !== undefined
          : !notification || notification.revision !== result.revision)) {
        stop('AUTHORITY_DIVERGED'); return;
      }
      snapshot = clone(result);
      consistency();
      if (result.revision === previousRevision) {
        finish(entry, { status: 'no-op', requestId: entry.id, revision: result.revision });
      } else {
        const commit: DocumentCommit = {
          session, bindingId: entry.binding.id, requestId: entry.id,
          actorId: entry.binding.options.actorId, source: entry.binding.options.source,
          action: clone(action), previousRevision, snapshot: clone(snapshot),
        };
        finish(entry, { status: 'committed', requestId: entry.id, revision: result.revision });
        // Mark the journal terminal before any external listener can query or resubmit.
        executing = undefined;
        notify(commit);
      }
    } catch (error) {
      if (entry.outcome) return;
      let code: WriteErrorCode;
      if (error instanceof SessionAccessError) code = error.code;
      else if (error instanceof DomainValidationError) {
        code = error.issues.some(issue => issue.code === 'DOCUMENT_ID_MISMATCH')
          ? 'DOCUMENT_MISMATCH' : 'VALIDATION_FAILED';
      } else if (error instanceof DomainConflictError) {
        code = ['REVISION_CONFLICT', 'HISTORY_EMPTY', 'HISTORY_CONFLICT'].includes(error.code)
          ? error.code as WriteErrorCode : 'VALIDATION_FAILED';
      } else {
        stop('INTERNAL_ERROR'); return;
      }
      finish(entry, reject(entry.id, code, true,
        code === 'REVISION_CONFLICT' || code === 'HISTORY_EMPTY' || code === 'HISTORY_CONFLICT'
          ? snapshot.revision : undefined));
    } finally { executing = undefined; observed = undefined; }
  }
  async function pump(): Promise<void> {
    if (pumping) return;
    pumping = true;
    try {
      while (queue.length) {
        const entry = queue.shift()!;
        if (entry.outcome) continue;
        try {
          await entry.hashPromise;
        } catch {
          if (!entry.outcome) stop('INTERNAL_ERROR');
        }
        // Revoke/transition may have terminalized this entry during hashing.
        if (!entry.outcome) process(entry);
      }
    } finally { pumping = false; }
  }
  function visible(binding: BindingState, outcome: WriteOutcome): WriteOutcome {
    try { readCheck(binding); return clone(outcome); }
    catch (error) {
      if (!binding.revoked && (stopped === 'AUTHORITY_DIVERGED' || stopped === 'INTERNAL_ERROR')
        && outcome.status !== 'rejected') return { status: 'outcome-unknown', requestId: outcome.requestId };
      return reject(outcome.requestId, errorCode(error),
        outcome.status !== 'rejected' || outcome.accepted);
    }
  }
  function submit(binding: BindingState, input: WriteIntent): Promise<WriteOutcome> {
    // Do not use async here: registration is complete before the first await.
    let id = '';
    try {
      running();
      // Reflection on supplied JS objects can invoke Proxy traps. Treat it like
      // a guard: any attempted authority reentrancy invalidates the input.
      inGuard = true; guardViolated = false;
      try {
        const descriptor = input && typeof input === 'object'
          ? Object.getOwnPropertyDescriptor(input, 'requestId') : undefined;
        if (descriptor && 'value' in descriptor && typeof descriptor.value === 'string'
          && descriptor.value.length <= 128) id = descriptor.value;
      } finally { inGuard = false; }
      if (guardViolated) throw new SessionAccessError('VALIDATION_FAILED');
      check(binding, 'write');
      let encoded: ReturnType<typeof encodeIntent>;
      inGuard = true; guardViolated = false;
      try { encoded = encodeIntent(input); } finally { inGuard = false; }
      if (guardViolated) throw new SessionAccessError('VALIDATION_FAILED');
      id = encoded.intent.requestId;
      const sequence = requestSequence(id, binding.scope);
      if (sequence === null) return Promise.resolve(reject(id, 'PROTOCOL_ERROR'));
      consistency();
      const existing = journal.get(id);
      if (existing) {
        if (!existing.outcome) {
          if (existing.canonical !== encoded.canonical) return Promise.resolve(reject(id, 'REQUEST_ID_REUSED', true));
          return existing.promise.then(outcome => visible(binding, outcome));
        }
        return Promise.all([digest(encoded.canonical), existing.hashPromise]).then(([hash, storedHash]) =>
          visible(binding, hash === storedHash ? existing.outcome! : reject(id, 'REQUEST_ID_REUSED', true)),
        () => visible(binding, reject(id, 'INTERNAL_ERROR', true)));
      }
      if (sequence <= binding.highWater) {
        return Promise.resolve(visible(binding, { status: 'outcome-unknown', requestId: id }));
      }
      if (sequence !== binding.highWater + 1) return Promise.resolve(reject(id, 'SEQUENCE_GAP'));
      if (transition) return Promise.resolve(reject(id, 'TRANSITION_PENDING'));
      if (actorPending.has(binding.options.actorId) || pendingCount >= LIMITS.pending
        || (binding.options.source !== 'peer' && localPendingCount >= LIMITS.localPending)
        || pendingBytes + encoded.bytes > LIMITS.payloadBytes) return Promise.resolve(reject(id, 'BUSY'));
      let resolve!: (outcome: WriteOutcome) => void;
      const promise = new Promise<WriteOutcome>(done => { resolve = done; });
      const entry: Entry = {
        id, binding, intent: encoded.intent, canonical: encoded.canonical,
        bytes: encoded.bytes, journalBytes: 256 + id.length * 3, promise, resolve, hashSettled: false,
      };
      binding.highWater = sequence;
      actorPending.set(binding.options.actorId, entry);
      journal.set(id, entry);
      journalBytes += entry.journalBytes;
      pendingBytes += entry.bytes;
      pendingCount += 1;
      if (binding.options.source !== 'peer') localPendingCount += 1;
      trimJournal();
      entry.hashPromise = digest(encoded.canonical).then(hash => {
        entry.digest = hash;
        return hash;
      }).catch(() => {
        stop('INTERNAL_ERROR');
        return '';
      }).finally(() => {
        entry.hashSettled = true;
        releasePayload(entry);
      });
      queue.push(entry);
      queueMicrotask(() => { void pump(); });
      return promise.then(outcome => visible(binding, outcome));
    } catch (error) {
      const sequence = requestSequence(id, binding.scope);
      return Promise.resolve(reject(id, errorCode(error), sequence !== null && sequence <= binding.highWater));
    }
  }

  const lifecycleGate: DocumentLifecycleGate = Object.freeze<DocumentLifecycleGate>({
    beginTransition(reason, draftGeneration) {
      try {
        consistency();
        if (!['close', 'replace', 'revoke'].includes(reason) || !validInteger(draftGeneration)) {
          throw new SessionAccessError('VALIDATION_FAILED');
        }
        if (transition) throw new SessionAccessError('TRANSITION_PENDING');
        const active: Transition = { token: randomId(), reason, generation: draftGeneration };
        transition = active;
        for (const entry of journal.values()) {
          if (!entry.outcome && entry !== executing) finish(entry, reject(entry.id, 'TRANSITION_PENDING', true));
        }
        return Promise.resolve().then(() => {
          consistency();
          if (transition !== active) throw new SessionAccessError('SESSION_CHANGED');
          active.barrier = freeze({
            token: active.token, session, snapshot: clone(snapshot),
            draftGeneration, unresolvedRequestIds: [],
          });
          return active.barrier;
        });
      } catch (error) { return Promise.reject(new SessionAccessError(errorCode(error))); }
    },
    isCurrent(barrier, draftGeneration) {
      try {
        consistency();
        return transition !== undefined && transition.barrier === barrier && barrier !== undefined
          && transition.generation === draftGeneration && barrier.snapshot.revision === snapshot.revision;
      } catch { return false; }
    },
    cancelTransition(token) {
      running();
      if (transition?.token === token) transition = undefined;
    },
    completeTransition(token) {
      consistency();
      if (!transition || transition.token !== token) throw new SessionAccessError('SESSION_CHANGED');
      if (!transition.barrier || transition.barrier.snapshot.revision !== snapshot.revision) {
        throw new SessionAccessError('BUSY');
      }
      if (transition.reason === 'revoke') transition = undefined;
      else stop('SESSION_CHANGED');
    },
  });

  const authority: DocumentAuthority = {
    session,
    source: Object.freeze({
      getSnapshot() { readCheck(); return clone(snapshot); },
      subscribe(listener: (value: DocumentSession) => void) { return subscribe(undefined, listener); },
    }),
    lifecycleGate,
    applyExternalUpdate(apply) {
      running();
      if (typeof apply !== 'function' || executing || externalApply) throw new SessionAccessError('ACCESS_DENIED');
      consistency();
      const previousRevision = snapshot.revision;
      observed = undefined;
      externalApply = true;
      let result: DocumentSession;
      try { result = apply(); }
      catch (error) {
        // The update was rejected before changing anything, or the controller changed unannounced.
        if (observed !== undefined) { stop('AUTHORITY_DIVERGED'); throw new SessionAccessError('AUTHORITY_DIVERGED'); }
        throw error;
      } finally { externalApply = false; }
      if (stopped) return false;
      const notification = observed as DocumentSession | undefined;
      if (result.document.id !== session.documentId
        || (result.revision !== previousRevision && result.revision !== previousRevision + 1)
        || (result.revision === previousRevision ? notification !== undefined
          : !notification || notification.revision !== result.revision)) {
        stop('AUTHORITY_DIVERGED'); return false;
      }
      snapshot = clone(result);
      consistency();
      if (result.revision === previousRevision) return false;
      notifySnapshot(snapshot);
      return true;
    },
    bindActor(input) {
      consistency();
      if (transition) throw new SessionAccessError('TRANSITION_PENDING');
      if (!input || typeof input !== 'object' || !validId(input.actorId) || !validId(input.grantId)
        || !SOURCES.has(input.source) || !validInteger(input.grantGeneration) || typeof input.guard !== 'function'
        || (input.source === 'peer' ? !validHex(input.peerSessionId) : input.peerSessionId !== undefined)) {
        throw new SessionAccessError('VALIDATION_FAILED');
      }
      if (input.peerSessionId && endedPeerSessions.has(input.peerSessionId)) throw new SessionAccessError('ACCESS_REVOKED');
      const peer = input.source === 'peer';
      const count = Array.from(bindings.values()).filter(b => (b.options.source === 'peer') === peer).length;
      if (bindings.size >= LIMITS.bindings || count >= (peer ? LIMITS.peerBindings : LIMITS.localBindings)
        || !Number.isSafeInteger(bindingGeneration + 1)) throw new SessionAccessError('BUSY');
      const binding: BindingState = {
        id: randomId(), scope: randomId(), generation: ++bindingGeneration,
        options: Object.freeze({
          actorId: input.actorId, source: input.source, grantId: input.grantId,
          grantGeneration: input.grantGeneration, guard: input.guard, peerSessionId: input.peerSessionId,
        }),
        revoked: false, highWater: 0, listeners: new Set(),
      };
      bindings.set(binding.id, binding);
      const bound: ActorBinding = {
        bindingId: binding.id, bindingGeneration: binding.generation, scopeId: binding.scope,
        actorId: binding.options.actorId,
        source: Object.freeze({
          getSnapshot() { readCheck(binding); return clone(snapshot); },
          getHistoryState() { readCheck(binding); return clone(controller.getHistoryState(binding.options.actorId)); },
          subscribe(listener: (value: DocumentSession) => void) { return subscribe(binding, listener); },
        }),
        gateway: Object.freeze({
          session,
          nextRequestId() {
            readCheck(binding); check(binding, 'write');
            if (transition || actorPending.has(binding.options.actorId) || binding.highWater === Number.MAX_SAFE_INTEGER) return null;
            return `${binding.scope}:${binding.highWater + 1}`;
          },
          submit(intent: WriteIntent) { return submit(binding, intent); },
          queryOutcome(requestId: string) {
            try {
              readCheck(binding);
              const sequence = requestSequence(requestId, binding.scope);
              if (sequence === null) return Promise.resolve(reject(requestId, 'PROTOCOL_ERROR'));
              const entry = journal.get(requestId);
              if (entry) return Promise.resolve(entry.outcome ? clone(entry.outcome)
                : { status: 'pending' as const, requestId });
              return Promise.resolve(sequence <= binding.highWater
                ? { status: 'outcome-unknown' as const, requestId } : { status: 'not-seen' as const });
            } catch (error) {
              const sequence = requestSequence(requestId, binding.scope);
              return Promise.resolve(reject(requestId, errorCode(error), sequence !== null && sequence <= binding.highWater));
            }
          },
        }),
      };
      return Object.freeze(bound);
    },
    revokeBinding(bindingId) {
      running();
      const binding = bindings.get(bindingId);
      if (!binding) {
        if (revokedBindingIds.has(bindingId)) return;
        throw new SessionAccessError('ACCESS_DENIED');
      }
      binding.revoked = true;
      revokedBindingIds.add(bindingId);
      binding.listeners.clear();
      for (const entry of journal.values()) {
        if (entry.binding === binding && !entry.outcome && entry !== executing) {
          finish(entry, reject(entry.id, 'ACCESS_REVOKED', true));
        }
      }
    },
    finalizePeerSession(peerSessionId) {
      consistency();
      if (!validHex(peerSessionId)) throw new SessionAccessError('VALIDATION_FAILED');
      if (endedPeerSessions.has(peerSessionId)) return;
      const group = Array.from(bindings.values()).filter(b => b.options.peerSessionId === peerSessionId);
      if (group.some(b => !b.revoked)
        || Array.from(journal.values()).some(e => e.binding.options.peerSessionId === peerSessionId && !e.outcome)) {
        throw new SessionAccessError('BUSY');
      }
      endedPeerSessions.add(peerSessionId);
      for (const binding of group) bindings.delete(binding.id);
      for (const [id, entry] of journal) {
        if (entry.binding.options.peerSessionId === peerSessionId) {
          journal.delete(id); journalBytes -= entry.journalBytes;
        }
      }
    },
    subscribeCommits(listener) {
      consistency();
      if (typeof listener !== 'function') throw new SessionAccessError('VALIDATION_FAILED');
      commitListeners.add(listener);
      return () => { notInGuard(); commitListeners.delete(listener); };
    },
  };
  try {
    unsubscribeController = controller.subscribe(actual => {
      if (stopped) return;
      if (!(executing || externalApply) || observed || actual.revision !== snapshot.revision + 1
        || actual.document.id !== session.documentId) {
        stop('AUTHORITY_DIVERGED'); return;
      }
      observed = clone(actual);
    });
  } catch { throw new SessionAccessError('INTERNAL_ERROR'); }
  ownedControllers.add(controller);
  return Object.freeze(authority);
}

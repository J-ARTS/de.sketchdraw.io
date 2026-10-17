import { applyCommand, deserializeDocument, serializeDocument } from '../domain';
import type { DocumentCommand, DocumentSession, HistoryAvailability } from '../domain';
import { SessionAccessError } from '../session';
import type { DocumentLifecycleGate, PeerSessionKey, TransitionBarrier, WriteAction, WriteErrorCode, WriteIntent, WriteOutcome } from '../session';
import type { CollaborationStatus, GuestOptions, GuestPairing, GuestSession, PairingReview, PeerState } from './types';
import { assertIdentity, pairText, parsePair, comparison, validateSdp } from './crypto';
import type { ParsedPair, PairPayload } from './crypto';
import { PeerLink } from './link';
import { intentDigest } from './owner';
import type { Wire } from './wire';
import { requestId as validRequestId } from './wire';
import { LIMIT, utf8, decode, sha, fail, randomHex, notify, sameSession, boundedJson, parse, shape, integer, deferred } from './primitives';

interface LocalIntent {
  requestId: string; revision: number; kind: WriteAction['kind']; commandText: string | null;
  commandHash: string | null; digest: string; prepared: Promise<void>;
  result: ReturnType<typeof deferred<WriteOutcome>>; outcome?: WriteOutcome;
  sent: boolean; sending: boolean;
}
type QueryOutcome = WriteOutcome | { status: 'pending'; requestId: string } | { status: 'not-seen' };
function rejected(requestId: string, code: WriteErrorCode, accepted = false): WriteOutcome {
  return { status: 'rejected', requestId, code, accepted };
}
function freeze<T>(value: T): T {
  if (value !== null && typeof value === 'object') { for (const child of Object.values(value)) freeze(child); Object.freeze(value); }
  return value;
}
class Guest {
  readonly session: PeerSessionKey;
  readonly options: GuestOptions;
  readonly ownerHash: string;
  private role: 'editor' | 'viewer'; private state: PeerState = 'pairing';
  private link?: PeerLink; private mirror?: DocumentSession; private mirrorHash?: string; private history?: { revision: number; value: HistoryAvailability };
  private scope?: string; private sequence = 1; private highWater = 0;
  private intents = new Map<string, LocalIntent>(); private pending?: LocalIntent;
  private queries = new Map<string, ReturnType<typeof deferred<QueryOutcome>>>();
  private disconnected = deferred<void>();
  private listeners = new Set<(status: CollaborationStatus) => void>();
  private sourceListeners = new Set<(snapshot: DocumentSession) => void>();
  private messages: Array<{ link: PeerLink; value: Wire }> = []; private draining = false;
  private nonce?: string; private resyncAttempts = 0; private grant = false; private ended = false;
  private transition?: { token: string; reason: 'close' | 'replace' | 'revoke'; generation: number; barrier?: TransitionBarrier };
  private gateWaiters = new Set<ReturnType<typeof deferred<void>>>();
  readonly api: GuestSession;

  constructor(offer: ParsedPair, options: GuestOptions) {
    this.session = Object.freeze({ ...offer.payload.session }); this.role = offer.payload.role;
    this.ownerHash = offer.keyHash; this.options = options;
    if (options.onStatus) this.listeners.add(options.onStatus);
    const lifecycleGate: DocumentLifecycleGate = {
      beginTransition: (reason, generation) => {
        try {
          if (this.ended) fail('SESSION_CHANGED');
          if (this.transition) fail('TRANSITION_PENDING');
          if (!['close', 'replace', 'revoke'].includes(reason) || !integer(generation)) fail('VALIDATION_FAILED');
          const snapshot = this.snapshot();
          const active = { token: randomHex(), reason, generation, barrier: undefined as TransitionBarrier | undefined };
          this.transition = active;
          if (this.pending && !this.pending.sent) this.finish(this.pending, rejected(this.pending.requestId, 'TRANSITION_PENDING'));
          active.barrier = freeze({ token: active.token, session: { documentId: this.session.documentId, controllerEpoch: this.session.controllerEpoch },
            snapshot, draftGeneration: generation, unresolvedRequestIds: Array.from(this.intents.values()).filter(i => i.sent && !i.outcome).map(i => i.requestId) });
          return Promise.resolve(active.barrier);
        } catch (error) { return Promise.reject(error); }
      },
      isCurrent: (barrier, generation) => !this.ended && this.transition?.barrier === barrier
        && this.transition.generation === generation && this.mirror?.revision === barrier.snapshot.revision,
      cancelTransition: token => {
        if (this.transition?.token !== token) return;
        this.transition = undefined; for (const waiter of this.gateWaiters) waiter.resolve(); this.gateWaiters.clear();
        void this.drain();
      },
      completeTransition: token => {
        if (!this.transition || this.transition.token !== token || !this.transition.barrier) fail('SESSION_CHANGED');
        // The trusted UI already asked the user to keep/discard unresolved drafts.
        void this.leave();
      },
    };
    this.api = Object.freeze({
      source: Object.freeze({ getSnapshot: () => this.snapshot(), subscribe: (listener: (snapshot: DocumentSession) => void) => {
        if (typeof listener !== 'function') fail('VALIDATION_FAILED'); this.sourceListeners.add(listener); return () => { this.sourceListeners.delete(listener); };
      }, getHistoryState: () => this.state === 'ready' && this.history !== undefined && this.history.revision === this.mirror?.revision
        ? structuredClone(this.history.value) : { canUndo: false, canRedo: false } }),
      gateway: Object.freeze({ session: Object.freeze({ documentId: this.session.documentId, controllerEpoch: this.session.controllerEpoch }),
        nextRequestId: () => this.ready() && !this.pending && this.scope && Number.isSafeInteger(this.sequence)
          ? `${this.scope}:${this.sequence}` : null,
        submit: (intent: WriteIntent) => this.submit(intent), queryOutcome: (requestId: string) => this.query(requestId) }),
      lifecycleGate: Object.freeze(lifecycleGate), getStatus: () => this.status(),
      subscribeStatus: (listener: (status: CollaborationStatus) => void) => {
        if (typeof listener !== 'function') fail('VALIDATION_FAILED'); this.listeners.add(listener); return () => { this.listeners.delete(listener); };
      },
      acceptReconnectOffer: async (text: string) => {
        if (this.ended || this.transition) fail('SESSION_CHANGED');
        const offer = await parsePair(text, 'offer');
        if (!sameSession(offer.payload.session, this.session) || offer.keyHash !== this.ownerHash
          || offer.payload.resumePeerId !== options.identity.keyHash || offer.payload.role !== this.role) fail('ACCESS_DENIED');
        return this.pair(offer);
      }, leave: () => this.leave(),
    });
  }
  private snapshot(): DocumentSession { if (!this.mirror) fail('PEER_NOT_READY'); return structuredClone(this.mirror); }
  private ready(): boolean { return !this.ended && !this.transition && this.state === 'ready' && this.role === 'editor' && !!this.link?.authorized && !this.link.closed; }
  private status(): CollaborationStatus {
    return { mode: 'guest', state: this.state, session: this.session, role: this.role, confirmedRevision: this.mirror?.revision ?? 0,
      pendingWrites: this.pending ? 1 : 0, hasUnresolvedOutcome: !!this.pending?.sent,
      peers: [{ peerId: this.ownerHash, role: 'owner', state: this.state }] };
  }
  private emit(): void { notify(this.listeners, this.status()); }
  private current(link: PeerLink): boolean { return !this.ended && this.link === link && link.authorized && !link.closed; }
  private async openGate(link: PeerLink): Promise<void> {
    if (this.transition) { const waiting = deferred<void>(); this.gateWaiters.add(waiting); await waiting.promise; this.gateWaiters.delete(waiting); }
    if (!this.current(link)) fail('NOT_CONNECTED');
  }
  async pair(offer: ParsedPair): Promise<GuestPairing> {
    if (this.ended) fail('SESSION_CHANGED');
    const old = this.link; this.link = undefined; old?.close('CONNECTION_REPLACED');
    this.disconnected.resolve(); this.disconnected = deferred<void>();
    this.state = 'pairing'; this.grant = false; this.resyncAttempts = 0; this.nonce = undefined; this.messages.length = 0; this.emit();
    const link: PeerLink = new PeerLink({ owner: false, identity: this.options.identity, session: this.session, connectionId: offer.payload.invitationId,
      onAuthenticated: () => { if (this.link === link) { this.state = 'syncing'; this.emit(); } },
      onMessage: value => {
        if (!this.current(link)) return;
        if (this.messages.length >= 64) fail('BUSY', 'MIRROR_BUFFER_FULL');
        this.messages.push({ link, value }); void this.drain();
      },
      onClose: () => {
        if (this.link !== link || this.ended) return;
        if (this.state !== 'resync-required') this.state = 'disconnected'; this.grant = false; this.disconnected.resolve();
        for (const waiter of this.gateWaiters) waiter.reject(new SessionAccessError('NOT_CONNECTED')); this.gateWaiters.clear();
        this.emit();
      },
      allowTransfer: () => this.current(link) && this.grant,
    });
    this.link = link;
    try {
      await link.setRemote(offer);
      await link.pc.setLocalDescription(await link.pc.createAnswer()); const sdp = await link.gather();
      if (this.ended || this.link !== link) fail('SESSION_CHANGED');
      const payload: PairPayload = { version: 1, type: 'answer', session: this.session, invitationId: offer.payload.invitationId,
        nonce: randomHex(32), createdAt: offer.payload.createdAt, expiresAt: offer.payload.expiresAt,
        publicKeyBase64Url: this.options.identity.publicKeyBase64Url, sdp, dtlsFingerprint: validateSdp(sdp, 'answer'),
        role: this.role, resumePeerId: offer.payload.resumePeerId, offerHash: offer.hash };
      const text = await pairText(this.options.identity, payload); const answer = await parsePair(text, 'answer');
      const compared = await comparison(offer.hash, answer.hash); link.setTranscript(compared.hash, compared.code);
      const review: PairingReview = { invitationId: offer.payload.invitationId, ownerKeyFingerprint: offer.keyHash,
        peerKeyFingerprint: this.options.identity.keyHash, ownerDtlsFingerprint: offer.payload.dtlsFingerprint,
        peerDtlsFingerprint: payload.dtlsFingerprint, comparisonCode: compared.code, role: this.role };
      this.state = 'awaiting-confirmation'; this.emit();
      return Object.freeze({ answer: { invitationId: payload.invitationId, text, expiresAt: payload.expiresAt }, review,
        confirmOwner: async (code: string) => { await link.confirm(code); if (this.link !== link || this.ended) fail('SESSION_CHANGED'); return this.api; },
        cancel: () => { link.close('PAIRING_CANCELLED'); },
      });
    } catch (error) { link.close('PAIRING_FAILED'); throw error; }
  }
  private async resync(link: PeerLink, automatic: boolean): Promise<void> {
    if (!this.current(link) || !this.grant) return;
    if (this.nonce) return;
    if (automatic && ++this.resyncAttempts > 2) { this.state = 'resync-required'; link.close('RESYNC_REQUIRED'); this.emit(); return; }
    this.nonce = randomHex(); this.state = 'syncing'; this.emit();
    await link.send('resume', { revision: this.mirror?.revision ?? null, hash: this.mirrorHash ?? null, nonce: this.nonce });
  }
  private install(snapshot: DocumentSession, hash: string): void {
    this.mirror = snapshot; this.mirrorHash = hash; notify(this.sourceListeners, this.snapshot());
    this.emit();
  }
  private async drain(): Promise<void> {
    if (this.draining || this.transition) return;
    this.draining = true;
    try {
      while (this.messages.length && !this.transition) {
        const { link, value } = this.messages.shift()!;
        if (!this.current(link)) continue;
        try { await this.handle(link, value); }
        catch (error) {
          if (this.current(link)) link.close(error instanceof Error ? error.message : 'PROTOCOL_ERROR');
        }
      }
    } finally { this.draining = false; }
  }
  private async handle(link: PeerLink, value: Wire): Promise<void> {
    if (value.type !== 'grant' && value.type !== 'session-ended' && !this.grant) fail('ACCESS_DENIED');
    switch (value.type) {
      case 'grant': {
        if (this.grant || value.peerKeyHash !== this.options.identity.keyHash || value.role !== this.role) fail('ACCESS_DENIED');
        const scopes = value.scopes as { scopeId: string; actorId: string; kind: string }[];
        const humans = scopes.filter(scope => scope.kind === 'human');
        if (humans.length !== 1 || humans[0]!.actorId !== `peer:${this.options.identity.keyHash}:human`
          || (this.scope && this.scope !== humans[0]!.scopeId)) fail('ACCESS_DENIED');
        this.scope = humans[0]!.scopeId; this.grant = true;
        await this.resync(link, false); return;
      }
      case 'checkpoint': {
        if (!this.nonce || value.nonce !== this.nonce) fail();
        if (value.transferId === null) {
          if (!this.mirror || this.mirror.revision !== value.revision || this.mirrorHash !== value.hash) fail();
          await this.openGate(link); this.nonce = undefined;
          await link.send('applied', { revision: value.revision, hash: value.hash }); return;
        }
        const data = await link.takeTransfer(value.transferId as string, 'snapshot');
        const text = decode(data.bytes); const document = deserializeDocument(text); const revision = value.revision as number;
        if (data.manifest.hash !== value.hash || data.manifest.revision !== revision || data.manifest.previousHash !== null
          || document.id !== this.session.documentId || serializeDocument(document) !== text
          || (this.mirror && (revision < this.mirror.revision || (revision === this.mirror.revision && value.hash !== this.mirrorHash)))) fail();
        await this.openGate(link);
        if (value.nonce !== this.nonce) fail();
        this.nonce = undefined; this.install({ document, revision }, value.hash as string); data.release();
        await link.send('applied', { revision, hash: this.mirrorHash }); return;
      }
      case 'commit': {
        const purpose = value.kind === 'dispatch' ? 'command' : 'snapshot';
        const data = await link.takeTransfer(value.transferId as string, purpose);
        if (data.manifest.revision !== value.revision || data.manifest.previousHash !== value.previousHash
          || data.manifest.requestId !== value.requestId) fail();
        if (this.nonce) { data.release(); return; }
        if (!this.mirror || value.previousRevision !== this.mirror.revision || value.previousHash !== this.mirrorHash) {
          data.release(); await this.resync(link, true); return;
        }
        const text = decode(data.bytes);
        const document = value.kind === 'dispatch'
          ? applyCommand(this.mirror.document, parse(text, LIMIT.command, 64) as DocumentCommand)
          : deserializeDocument(text);
        const canonical = serializeDocument(document);
        if (document.id !== this.session.documentId || (value.kind !== 'dispatch' && canonical !== text)
          || await sha(canonical) !== value.hash) { data.release(); await this.resync(link, true); return; }
        await this.openGate(link);
        if (this.mirror.revision !== value.previousRevision || this.mirrorHash !== value.previousHash) fail();
        this.install({ document, revision: value.revision as number }, value.hash as string); data.release();
        await link.send('applied', { revision: value.revision, hash: value.hash }); return;
      }
      case 'history': {
        if (value.scopeId !== this.scope || !this.mirror) fail();
        const revision = value.revision as number;
        if (revision < this.mirror.revision) return;
        this.history = { revision, value: structuredClone(value.availability as HistoryAvailability) };
        if (!this.nonce && revision === this.mirror.revision) {
          this.state = 'ready'; this.emit();
          if (this.pending?.sent) void this.query(this.pending.requestId);
        }
        return;
      }
      case 'result': case 'outcome': {
        const requestId = value.requestId as string; const entry = this.intents.get(requestId);
        if (!entry || value.digest !== entry.digest) fail();
        const outcome = value.outcome as QueryOutcome;
        this.queries.get(requestId)?.resolve(structuredClone(outcome));
        if (outcome.status === 'pending' || outcome.status === 'not-seen' || outcome.status === 'outcome-unknown') { this.emit(); return; }
        this.finish(entry, outcome); return;
      }
      case 'session-ended':
        this.state = value.reason === 'revoked' ? 'revoked' : 'disconnected'; this.ended = true;
        this.disconnected.resolve(); link.close('SESSION_ENDED'); this.emit(); return;
      case 'actor-scope': return; // No Guest-MCP bridge; owner explicitly refuses registration.
      default: fail();
    }
  }
  private finish(entry: LocalIntent, outcome: WriteOutcome): void {
    if (entry.outcome) return;
    entry.outcome = structuredClone(outcome);
    if (outcome.status !== 'rejected' || outcome.accepted) {
      const n = Number(entry.requestId.slice(33)); this.highWater = Math.max(this.highWater, n); this.sequence = n + 1;
    } else this.intents.delete(entry.requestId);
    if (this.pending === entry) this.pending = undefined;
    entry.commandText = null; entry.result.resolve(structuredClone(outcome));
    while (this.intents.size > LIMIT.resultCount) {
      const oldest = Array.from(this.intents).find(([, value]) => value.outcome);
      if (!oldest) break; this.intents.delete(oldest[0]);
    }
    this.emit();
  }
  private async waitResult(entry: LocalIntent): Promise<WriteOutcome> {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const unknown: WriteOutcome = { status: 'outcome-unknown', requestId: entry.requestId };
    try { return await Promise.race([entry.result.promise,
      new Promise<WriteOutcome>(resolve => { timer = setTimeout(() => resolve(unknown), LIMIT.outcomeMs); }),
      this.disconnected.promise.then(() => unknown)]); }
    finally { clearTimeout(timer); }
  }
  private submit(input: WriteIntent): Promise<WriteOutcome> {
    let requestId = '';
    try {
      const text = boundedJson(input, LIMIT.command); const intent = parse(text, LIMIT.command, 64);
      shape(intent, ['requestId', 'expectedRevision', 'action']);
      if (typeof intent.requestId === 'string') requestId = intent.requestId;
      if (!validRequestId(requestId) || !this.scope || !requestId.startsWith(`${this.scope}:`) || !integer(intent.expectedRevision)) fail('PROTOCOL_ERROR');
      const action = intent.action; if (!action || typeof action !== 'object') fail();
      const kind = (action as WriteAction).kind;
      shape(action, kind === 'dispatch' ? ['kind', 'command'] : ['kind']);
      if (!['dispatch', 'undo', 'redo'].includes(kind)) fail();
      const commandText = kind === 'dispatch' ? boundedJson(action.command, LIMIT.command) : null;
      const old = this.intents.get(requestId);
      if (old) {
        if (!old.outcome) {
          if (old.revision !== intent.expectedRevision || old.kind !== kind || old.commandText !== commandText) return Promise.resolve(rejected(requestId, 'REQUEST_ID_REUSED', true));
          if (!old.sending && this.ready()) void this.transmit(old);
          return this.waitResult(old);
        }
        return (async () => {
          const hash = await intentDigest(this.session, this.scope!, requestId, intent.expectedRevision as number, kind, commandText === null ? null : await sha(commandText));
          return hash === old.digest ? structuredClone(old.outcome!) : rejected(requestId, 'REQUEST_ID_REUSED', true);
        })();
      }
      const sequence = Number(requestId.slice(33));
      if (sequence <= this.highWater) return Promise.resolve({ status: 'outcome-unknown', requestId });
      if (sequence !== this.sequence) return Promise.resolve(rejected(requestId, 'SEQUENCE_GAP'));
      if (this.role !== 'editor') return Promise.resolve(rejected(requestId, 'ACCESS_DENIED'));
      if (!this.ready()) return Promise.resolve(rejected(requestId, this.transition ? 'TRANSITION_PENDING' : 'NOT_CONNECTED'));
      if (this.pending) return Promise.resolve(rejected(requestId, 'BUSY'));
      const entry: LocalIntent = { requestId, revision: intent.expectedRevision, kind, commandText, commandHash: null, digest: '',
        prepared: Promise.resolve(), result: deferred(), sent: false, sending: false };
      this.intents.set(requestId, entry); this.pending = entry; this.emit();
      entry.prepared = (async () => {
        entry.commandHash = commandText === null ? null : await sha(commandText);
        entry.digest = await intentDigest(this.session, this.scope!, requestId, entry.revision, kind, entry.commandHash);
      })();
      void entry.prepared.catch(() => { if (!entry.sent) this.finish(entry, rejected(requestId, 'INTERNAL_ERROR')); });
      void this.transmit(entry); return this.waitResult(entry);
    } catch (error) { return Promise.resolve(rejected(requestId, error instanceof SessionAccessError ? error.code : 'VALIDATION_FAILED')); }
  }
  private async transmit(entry: LocalIntent): Promise<void> {
    if (entry.sending || entry.outcome) return;
    entry.sending = true; const link = this.link;
    try {
      await entry.prepared;
      if (entry.outcome || !link || !this.current(link) || !this.ready()) fail('NOT_CONNECTED');
      let commandTransferId: string | null = null;
      if (entry.kind === 'dispatch') commandTransferId = await link.sendTransfer(utf8.encode(entry.commandText!),
        { purpose: 'command', revision: null, previousHash: null, requestId: entry.requestId });
      if (entry.outcome || !this.current(link) || !this.ready()) fail('TRANSITION_PENDING');
      await link.send('proposal', { scopeId: this.scope, clientSequence: Number(entry.requestId.slice(33)), requestId: entry.requestId,
        expectedRevision: entry.revision, kind: entry.kind, commandTransferId, commandHash: entry.commandHash, digest: entry.digest },
      () => { if (entry.outcome || !this.current(link) || !this.ready()) fail('TRANSITION_PENDING'); }, () => { entry.sent = true; this.emit(); });
    } catch (error) {
      if (!entry.sent && !entry.outcome) this.finish(entry, rejected(entry.requestId, error instanceof SessionAccessError ? error.code : 'NOT_CONNECTED'));
    } finally { entry.sending = false; }
  }
  private async query(requestId: string): Promise<QueryOutcome> {
    if (!validRequestId(requestId) || !this.scope || !requestId.startsWith(`${this.scope}:`)) return rejected(requestId, 'ACCESS_DENIED');
    const entry = this.intents.get(requestId);
    if (!entry) return Number(requestId.slice(33)) <= this.highWater ? { status: 'outcome-unknown', requestId } : { status: 'not-seen' };
    if (entry.outcome) return structuredClone(entry.outcome);
    if (!entry.sent) return { status: 'pending', requestId };
    const link = this.link;
    if (!link || !this.current(link) || this.transition) return { status: 'outcome-unknown', requestId };
    await entry.prepared;
    let query = this.queries.get(requestId);
    if (!query) {
      query = deferred<QueryOutcome>(); this.queries.set(requestId, query);
      void link.send('query-outcome', { scopeId: this.scope, requestId, digest: entry.digest }).catch(error => query!.reject(error));
    }
    let timer: ReturnType<typeof setTimeout> | undefined;
    try { return await Promise.race([query.promise,
      new Promise<QueryOutcome>(resolve => { timer = setTimeout(() => resolve({ status: 'outcome-unknown', requestId }), LIMIT.outcomeMs); }),
      this.disconnected.promise.then(() => ({ status: 'outcome-unknown' as const, requestId }))]); }
    catch { return { status: 'outcome-unknown', requestId }; }
    finally { clearTimeout(timer); if (this.queries.get(requestId) === query) this.queries.delete(requestId); }
  }
  private async leave(): Promise<void> {
    if (this.ended) return;
    this.ended = true; this.state = 'closed'; this.disconnected.resolve();
    for (const waiter of this.gateWaiters) waiter.reject(new SessionAccessError('SESSION_CHANGED')); this.gateWaiters.clear();
    this.messages.length = 0; this.link?.close('GUEST_LEFT'); this.emit();
  }
}
export async function acceptInvitation(text: string, options: GuestOptions): Promise<GuestPairing> {
  assertIdentity(options.identity); const offer = await parsePair(text, 'offer');
  if (offer.payload.resumePeerId !== null) fail('ACCESS_DENIED', 'RECONNECT_REQUIRES_LIVE_SESSION');
  return new Guest(offer, options).pair(offer);
}

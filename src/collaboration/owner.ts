import { serializeDocument } from '../domain';
import type { DocumentCommand } from '../domain';
import type { ActorBinding, DocumentCommit, PeerSessionKey, WriteAction, WriteOutcome } from '../session';
import type { CollaborationStatus, OwnerSession, OwnerSessionOptions, PairingReview, PeerState } from './types';
import { assertIdentity, pairText, parsePair, comparison, validateSdp } from './crypto';
import type { ParsedPair, PairPayload } from './crypto';
import { PeerLink } from './link';
import type { Wire } from './wire';
import { LIMIT, utf8, decode, sha, fail, randomHex, notify, sameSession, boundedJson, parse } from './primitives';

interface OutcomeEntry { digest: string; promise: Promise<WriteOutcome>; outcome?: WriteOutcome }
interface Peer {
  id: string; role: 'editor' | 'viewer'; state: PeerState; link?: PeerLink; binding?: ActorBinding;
  pendingConnection?: string; outcomes: Map<string, OutcomeEntry>;
  confirmed: number; sent: number; sentHashes: Map<number, string>; syncStarted: boolean;
  sending: Promise<void>; bufferedBytes: number; bufferedCount: number; pending: number;
}
interface Invitation { link: PeerLink; offer?: ParsedPair; role: 'editor' | 'viewer'; resume?: Peer; used: boolean; created: number; timer: ReturnType<typeof setTimeout>; review?: PairingReview }
interface CommitRecord { previousRevision: number; revision: number; previousHash: string; hash: string;
  kind: WriteAction['kind']; actorId: string; requestId: string; bytes: Uint8Array; }
const activeOwners = new WeakSet<object>();
export async function intentDigest(session: PeerSessionKey, scopeId: string, requestId: string,
  expectedRevision: number, kind: WriteAction['kind'], commandHash: string | null): Promise<string> {
  return sha(`sketchdraw.intent.v1\n${JSON.stringify([session.documentId, session.controllerEpoch, scopeId, requestId, expectedRevision, kind, commandHash])}`);
}

export async function createOwnerSession(options: OwnerSessionOptions): Promise<OwnerSession> {
  assertIdentity(options.identity);
  if (activeOwners.has(options.authority)) fail('BUSY');
  const authority = options.authority; const base = authority.source.getSnapshot();
  activeOwners.add(authority);
  const session: PeerSessionKey = Object.freeze({ ...authority.session, sessionId: randomHex(), permissionEpoch: 0 });
  const peers = new Map<string, Peer>(); const invitations = new Map<string, Invitation>();
  const listeners = new Set<(status: CollaborationStatus) => void>(); if (options.onStatus) listeners.add(options.onStatus);
  let ended: 'closed' | 'revoked' | undefined;
  let latestRevision = base.revision; let latestHash = ''; let baseHash = ''; let queueBytes = 0; let queueCount = 0;
  let retainedBytes = 0; let snapshotBytes = 0; let observedRevision = base.revision;
  const retained = new Map<CommitRecord, number>(); const log: CommitRecord[] = [];
  const outcomes = new Map<string, { peer: Peer; entry: OutcomeEntry }>();
  let commits = sha(serializeDocument(base.document)).then(hash => { latestHash = hash; baseHash = hash; });
  let unsubscribe = (): void => {};
  function status(): CollaborationStatus {
    const revision = ended ? observedRevision : authority.source.getSnapshot().revision;
    return { mode: 'owner', state: ended ?? (Array.from(peers.values()).some(p => p.state === 'ready') ? 'ready' : 'pairing'),
      session, role: 'owner', confirmedRevision: revision, pendingWrites: Array.from(peers.values()).reduce((sum, p) => sum + p.pending, 0),
      hasUnresolvedOutcome: false, peers: Array.from(peers.values(), p => ({ peerId: p.id, role: p.role, state: p.state })) };
  }
  function emit(): void { try { notify(listeners, status()); } catch { /* The local document may already be closed. */ } }
  function alive(): void { if (ended) fail('SESSION_CHANGED'); authority.source.getSnapshot(); }
  function current(peer: Peer, link: PeerLink): boolean { return !ended && peer.link === link && link.authorized && !link.closed; }
  async function sendHistory(peer: Peer, link: PeerLink): Promise<void> {
    if (!current(peer, link) || !peer.binding) return;
    const revision = authority.source.getSnapshot().revision;
    await link.send('history', { scopeId: peer.binding.scopeId, revision, availability: peer.binding.source.getHistoryState() });
  }
  function enqueue(peer: Peer, bytes: number, operation: (link: PeerLink) => Promise<void>, release = (): void => {}): void {
    const link = peer.link; if (!link || !current(peer, link)) { release(); return; }
    if (peer.bufferedCount + 1 > LIMIT.retentionCount || peer.bufferedBytes + bytes > LIMIT.retentionBytes) {
      release(); link.close('PEER_BACKLOG_FULL'); return;
    }
    peer.bufferedCount += 1; peer.bufferedBytes += bytes;
    peer.sending = peer.sending.then(async () => { if (current(peer, link)) await operation(link); })
      .catch(() => { if (peer.link === link) link.close('SYNC_FAILED'); })
      .finally(() => { peer.bufferedCount -= 1; peer.bufferedBytes -= bytes; release(); });
  }
  function retain(record: CommitRecord): () => void {
    const references = retained.get(record) ?? 0;
    if (!references) retainedBytes += record.bytes.length;
    retained.set(record, references + 1);
    return () => {
      const remaining = retained.get(record)! - 1;
      if (remaining) retained.set(record, remaining);
      else { retained.delete(record); retainedBytes -= record.bytes.length; }
    };
  }
  function evictRecord(): void {
    const record = log.shift()!; const remaining = retained.get(record)! - 1;
    if (remaining) retained.set(record, remaining);
    else { retained.delete(record); retainedBytes -= record.bytes.length; }
  }
  function capacity(bytes: number, count: number): boolean {
    const fits = () => retainedBytes + queueBytes + snapshotBytes + bytes <= LIMIT.retentionBytes
      && retained.size + queueCount + count <= LIMIT.retentionCount;
    while (!fits() && log.length) evictRecord();
    return fits();
  }
  function sendRecord(peer: Peer, record: CommitRecord): void {
    const release = retain(record);
    enqueue(peer, record.bytes.length, async link => {
      if (record.revision <= peer.sent) return;
      if (record.previousRevision !== peer.sent) { link.close('COMMIT_GAP'); return; }
      const transferId = await link.sendTransfer(record.bytes, { purpose: record.kind === 'dispatch' ? 'command' : 'snapshot',
        revision: record.revision, previousHash: record.previousHash, requestId: record.requestId });
      if (!current(peer, link)) return;
      await link.send('commit', { previousRevision: record.previousRevision, revision: record.revision,
        previousHash: record.previousHash, hash: record.hash, actorId: record.actorId, requestId: record.requestId, kind: record.kind, transferId });
      peer.sent = record.revision; peer.sentHashes.set(record.revision, record.hash);
      while (peer.sentHashes.size > LIMIT.retentionCount) peer.sentHashes.delete(peer.sentHashes.keys().next().value!);
      await sendHistory(peer, link);
    }, release);
  }
  function broadcast(record: CommitRecord): void {
    for (const peer of peers.values()) {
      if (peer.syncStarted && peer.link?.authorized) sendRecord(peer, record);
    }
  }
  function committed(commit: DocumentCommit): void {
    if (ended) return;
    observedRevision = commit.snapshot.revision;
    try {
      const text = serializeDocument(commit.snapshot.document);
      const bytes = utf8.encode(commit.action.kind === 'dispatch' ? boundedJson(commit.action.command, LIMIT.command) : text);
      const held = bytes.length;
      if (!capacity(held, 1)) { void end('technical'); return; }
      queueCount += 1; queueBytes += held; let reserved = true;
      commits = commits.then(async () => {
        if (ended) return;
        if (commit.previousRevision !== latestRevision || commit.snapshot.revision !== latestRevision + 1) fail('AUTHORITY_DIVERGED');
        const record: CommitRecord = { previousRevision: latestRevision, revision: commit.snapshot.revision,
          previousHash: latestHash, hash: await sha(text), kind: commit.action.kind,
          actorId: commit.actorId, requestId: commit.requestId, bytes };
        if (ended) return;
        latestRevision = record.revision; latestHash = record.hash;
        // Transfer the reservation from the hashing queue to shared log/peer refs.
        queueBytes -= held; queueCount -= 1; reserved = false;
        retain(record); log.push(record);
        broadcast(record); emit();
      }).catch(() => { void end('technical'); }).finally(() => { if (reserved) { queueCount -= 1; queueBytes -= held; } });
    } catch { void end('technical'); }
  }
  async function result(link: PeerLink, requestId: string, digest: string, outcome: WriteOutcome): Promise<void> {
    if (!link.closed) await link.send('result', { requestId, digest, outcome });
  }
  async function proposal(peer: Peer, link: PeerLink, message: Wire): Promise<void> {
    if (!current(peer, link) || !peer.binding) return;
    const requestId = message.requestId as string; const fingerprint = message.digest as string;
    const reject = (code: 'ACCESS_DENIED' | 'PEER_NOT_READY' | 'REQUEST_ID_REUSED' | 'BUSY') => result(link, requestId, fingerprint,
      { status: 'rejected', requestId, code, accepted: false });
    if (peer.role !== 'editor' || message.scopeId !== peer.binding.scopeId) { await reject('ACCESS_DENIED'); return; }
    if (peer.state !== 'ready') { await reject('PEER_NOT_READY'); return; }
    let action: WriteAction; let release = (): void => {};
    if (message.kind === 'dispatch') {
      const transfer = await link.takeTransfer(message.commandTransferId as string, 'command');
      if (transfer.manifest.requestId !== requestId || transfer.manifest.hash !== message.commandHash || transfer.manifest.revision !== null) fail();
      action = { kind: 'dispatch', command: parse(decode(transfer.bytes), LIMIT.command, 64) as DocumentCommand }; release = transfer.release;
    } else action = { kind: message.kind as 'undo' | 'redo' };
    const expected = await intentDigest(session, peer.binding.scopeId, requestId, message.expectedRevision as number,
      action.kind, message.commandHash as string | null);
    if (!current(peer, link)) return;
    if (expected !== fingerprint) fail('PROTOCOL_ERROR');
    release();
    const old = peer.outcomes.get(requestId);
    if (old) {
      if (old.digest !== fingerprint) { await reject('REQUEST_ID_REUSED'); return; }
      await result(link, requestId, fingerprint, await old.promise); return;
    }
    if (peer.pending) { await reject('BUSY'); return; }
    // The authority reserves this request synchronously before its first await.
    peer.pendingConnection = link.options.connectionId; peer.pending += 1;
    const entry: OutcomeEntry = { digest: fingerprint, promise: peer.binding.gateway.submit({ requestId,
      expectedRevision: message.expectedRevision as number, action }) };
    while (outcomes.size >= LIMIT.resultCount) {
      const oldest = Array.from(outcomes).find(([, candidate]) => candidate.entry.outcome);
      if (!oldest) break; oldest[1].peer.outcomes.delete(oldest[0]); outcomes.delete(oldest[0]);
    }
    peer.outcomes.set(requestId, entry); outcomes.set(requestId, { peer, entry }); emit();
    try {
      entry.outcome = await entry.promise;
      if (entry.outcome.status === 'rejected' && !entry.outcome.accepted) { peer.outcomes.delete(requestId); outcomes.delete(requestId); }
      // Scope IDs are unique. Only bounded digests and terminal outcomes are held;
      // even 1,024 maximum wire outcomes remain below the 4 MiB journal budget.
      while (outcomes.size > LIMIT.resultCount) {
        const oldest = Array.from(outcomes).find(([, candidate]) => candidate.entry.outcome);
        if (!oldest) break; oldest[1].peer.outcomes.delete(oldest[0]); outcomes.delete(oldest[0]);
      }
      if (current(peer, link)) await result(link, requestId, fingerprint, entry.outcome);
    } finally { peer.pending -= 1; peer.pendingConnection = undefined; emit(); }
  }
  async function resume(peer: Peer, link: PeerLink, message: Wire): Promise<void> {
    if (!current(peer, link)) return;
    await commits;
    if (!current(peer, link)) return;
    const snapshot = authority.source.getSnapshot();
    if (message.revision !== null && (message.revision as number) > snapshot.revision) fail();
    peer.state = 'syncing'; peer.syncStarted = true; emit();
    const revision = message.revision as number | null;
    const knownHash = revision === base.revision ? baseHash : log.find(record => record.revision === revision)?.hash;
    const missing = revision === null ? [] : log.filter(record => record.revision > revision);
    const rangeAvailable = revision !== null && latestRevision === snapshot.revision && knownHash === message.hash
      && missing.length === latestRevision - revision
      && (missing.length === 0 || missing[0]!.previousRevision === revision);
    if (rangeAvailable) {
      // A nonce-bound checkpoint with no transfer pins the already verified local
      // base; the retained next revisions follow. It cannot install a new state.
      enqueue(peer, 0, async active => {
        peer.sent = revision!; peer.sentHashes.clear(); peer.sentHashes.set(revision!, knownHash!);
        await active.send('checkpoint', { revision, hash: knownHash, nonce: message.nonce, transferId: null });
      });
      for (const record of missing) sendRecord(peer, record);
      enqueue(peer, 0, active => sendHistory(peer, active));
      return;
    }
    const text = serializeDocument(snapshot.document); const bytes = utf8.encode(text);
    if (!capacity(bytes.length, 0)) { link.close('PEER_BACKLOG_FULL'); return; }
    snapshotBytes += bytes.length;
    // A full checkpoint is the bounded fallback for a missing retained range.
    enqueue(peer, bytes.length, async active => {
      const hash = await sha(text);
      const transferId = await active.sendTransfer(bytes, { purpose: 'snapshot', revision: snapshot.revision, previousHash: null, requestId: null });
      if (!current(peer, active)) return;
      await active.send('checkpoint', { revision: snapshot.revision, hash, nonce: message.nonce, transferId });
      peer.sent = snapshot.revision; peer.sentHashes.clear(); peer.sentHashes.set(snapshot.revision, hash);
      await sendHistory(peer, active);
    }, () => { snapshotBytes -= bytes.length; });
  }
  async function message(peer: Peer, link: PeerLink, value: Wire): Promise<void> {
    if (!current(peer, link)) return;
    switch (value.type) {
      case 'proposal': await proposal(peer, link, value); return;
      case 'query-outcome': {
        if (!peer.binding || value.scopeId !== peer.binding.scopeId) fail('ACCESS_DENIED');
        const requestId = value.requestId as string; const entry = peer.outcomes.get(requestId);
        if (entry && entry.digest !== value.digest) {
          await link.send('outcome', { requestId, digest: value.digest, outcome: { status: 'rejected', requestId, code: 'REQUEST_ID_REUSED', accepted: true } }); return;
        }
        const outcome = entry?.outcome ?? await peer.binding.gateway.queryOutcome(requestId);
        if (current(peer, link)) await link.send('outcome', { requestId, digest: value.digest, outcome });
        return;
      }
      case 'resume': await resume(peer, link, value); return;
      case 'applied': {
        const revision = value.revision as number;
        if (revision < peer.confirmed || revision > peer.sent || peer.sentHashes.get(revision) !== value.hash) fail();
        peer.confirmed = revision;
        if (revision === peer.sent && revision === authority.source.getSnapshot().revision) peer.state = 'ready'; emit(); return;
      }
      case 'register-agent-scope':
        // Guest-MCP's local Grant bridge is deliberately not exposed until its
        // separate approved integration can supply both authorization layers.
        await link.send('actor-scope', { grantRef: value.grantRef, scope: null, code: 'ACCESS_DENIED' }); return;
      default: fail('PROTOCOL_ERROR');
    }
  }
  function newLink(invitationId: string, resumePeer?: Peer): PeerLink {
    let link!: PeerLink;
    link = new PeerLink({ owner: true, identity: options.identity, session, connectionId: invitationId,
      onAuthenticated: async () => {
        alive(); const peer = Array.from(peers.values()).find(p => p.link === link); if (!peer) fail();
        const invitation = invitations.get(invitationId);
        if (invitation) clearTimeout(invitation.timer); invitations.delete(invitationId);
        peer.state = 'syncing';
        if (!peer.binding) {
          peer.binding = authority.bindActor({ actorId: `peer:${peer.id}:human`, source: 'peer', peerSessionId: session.sessionId,
            grantId: `peer:${peer.id}`, grantGeneration: session.permissionEpoch,
            guard: check => {
              const active = peer.link;
              if (ended || !active?.authorized || active.closed) return { allowed: false, code: 'ACCESS_REVOKED' };
              if (check.permission === 'write' && (peer.role !== 'editor' || peer.state !== 'ready'
                || (peer.pendingConnection !== undefined && peer.pendingConnection !== active.options.connectionId))) return { allowed: false, code: 'ACCESS_DENIED' };
              return { allowed: true };
            } });
        }
        await link.send('grant', { peerKeyHash: peer.id, role: peer.role,
          scopes: [{ scopeId: peer.binding.scopeId, actorId: peer.binding.actorId, kind: 'human' }] }); emit();
      },
      onMessage: value => { const peer = Array.from(peers.values()).find(p => p.link === link); if (!peer) fail(); return message(peer, link, value); },
      onClose: () => {
        const invitation = invitations.get(invitationId);
        if (invitation) clearTimeout(invitation.timer); invitations.delete(invitationId);
        const peer = Array.from(peers.values()).find(p => p.link === link);
        if (peer && !ended) { peer.state = 'disconnected'; peer.syncStarted = false; emit(); }
      },
      allowTransfer: value => {
        const peer = Array.from(peers.values()).find(p => p.link === link);
        return !!peer && current(peer, link) && peer.role === 'editor' && peer.state === 'ready'
          && value.purpose === 'command' && value.requestId !== null && value.requestId.startsWith(`${peer.binding?.scopeId}:`);
      },
    });
    if (resumePeer) {
      const old = resumePeer.link; resumePeer.link = link; resumePeer.state = 'pairing'; resumePeer.syncStarted = false;
      old?.close('CONNECTION_REPLACED');
    }
    return link;
  }
  async function end(reason: 'closed' | 'revoked' | 'technical'): Promise<void> {
    if (ended) return;
    ended = reason === 'revoked' ? 'revoked' : 'closed';
    // Document replacement can stop the authority before the UI closes us.
    // Cleanup must remain total even when those authorization calls now reject.
    let authorityStopped = false;
    const cleanup = (operation: () => void): void => {
      try { operation(); }
      catch { authorityStopped = true; } // No authority failure may prevent transport cleanup.
    };
    cleanup(unsubscribe);
    for (const peer of peers.values()) {
      peer.state = ended;
      if (peer.binding) cleanup(() => authority.revokeBinding(peer.binding!.bindingId));
      peer.outcomes.clear();
    }
    cleanup(() => authority.finalizePeerSession(session.sessionId));
    const links = new Set([...Array.from(invitations.values(), i => i.link),
      ...Array.from(peers.values(), p => p.link).filter((p): p is PeerLink => !!p)]);
    for (const invitation of invitations.values()) clearTimeout(invitation.timer);
    invitations.clear(); outcomes.clear(); while (log.length) evictRecord();
    activeOwners.delete(authority); emit();
    // No remote ACK is required. A stalled send cannot delay teardown indefinitely.
    await Promise.all(Array.from(links, async link => {
      if (!link.authorized || authorityStopped) { link.close(reason); return; }
      let timer: ReturnType<typeof setTimeout> | undefined;
      try { await Promise.race([link.send('session-ended', { reason }).catch(() => undefined),
        new Promise<void>(resolve => { timer = setTimeout(resolve, 250); })]); }
      finally { clearTimeout(timer); link.close(reason); }
    }));
  }
  unsubscribe = authority.subscribeCommits(committed);
  try { await commits; } catch { activeOwners.delete(authority); unsubscribe(); fail('INTERNAL_ERROR'); }
  const owner: OwnerSession = {
    source: authority.source,
    async createInvitation(role, opts) {
      alive(); if (!['editor', 'viewer'].includes(role)) fail('VALIDATION_FAILED');
      const pending = Array.from(invitations.values()).filter(i => !i.used && !i.link.closed);
      if (pending.length >= 2) fail('BUSY');
      const resumePeer = opts?.resumePeerId ? peers.get(opts.resumePeerId) : undefined;
      if (opts?.resumePeerId && !resumePeer) fail('ACCESS_DENIED');
      if (resumePeer && resumePeer.role !== role) fail('ACCESS_DENIED');
      if (!resumePeer && peers.size >= 4) fail('BUSY');
      const invitationId = randomHex(); const link = newLink(invitationId, resumePeer); const created = Date.now();
      const invitation: Invitation = { link, role, resume: resumePeer, used: false, created: performance.now(),
        timer: setTimeout(() => { if (!invitation.used) link.close('INVITATION_EXPIRED'); }, LIMIT.invitationMs) };
      invitations.set(invitationId, invitation);
      try {
        await link.pc.setLocalDescription(await link.pc.createOffer()); const sdp = await link.gather();
        alive();
        const payload: PairPayload = { version: 1, type: 'offer', session, invitationId, nonce: randomHex(32), createdAt: created,
          expiresAt: created + LIMIT.invitationMs, publicKeyBase64Url: options.identity.publicKeyBase64Url,
          sdp, dtlsFingerprint: validateSdp(sdp, 'offer'), role, resumePeerId: resumePeer?.id ?? null, offerHash: null };
        const text = await pairText(options.identity, payload); invitation.offer = await parsePair(text, 'offer');
        emit(); return { invitationId, text, expiresAt: payload.expiresAt };
      } catch (error) { clearTimeout(invitation.timer); link.close('PAIRING_FAILED'); throw error; }
    },
    async acceptAnswer(text) {
      alive(); const answer = await parsePair(text, 'answer'); alive();
      const invitation = invitations.get(answer.payload.invitationId);
      if (!invitation?.offer || invitation.used || invitation.link.closed || performance.now() - invitation.created > LIMIT.invitationMs) fail('ACCESS_DENIED', 'INVITATION_EXPIRED_OR_USED');
      if (!sameSession(answer.payload.session, session) || answer.payload.offerHash !== invitation.offer.hash
        || answer.payload.role !== invitation.role || answer.payload.resumePeerId !== (invitation.resume?.id ?? null)
        || (invitation.resume ? answer.keyHash !== invitation.resume.id : peers.has(answer.keyHash))) fail('ACCESS_DENIED');
      if (!invitation.resume && peers.size >= 4) fail('BUSY');
      invitation.used = true; clearTimeout(invitation.timer);
      let peer = invitation.resume;
      if (!peer) {
        peer = { id: answer.keyHash, role: invitation.role, state: 'awaiting-confirmation', link: invitation.link,
          outcomes: new Map(), confirmed: base.revision, sent: base.revision, sentHashes: new Map(), syncStarted: false,
          sending: Promise.resolve(), bufferedBytes: 0, bufferedCount: 0, pending: 0 };
        peers.set(peer.id, peer);
      }
      const compared = await comparison(invitation.offer.hash, answer.hash);
      const review: PairingReview = { invitationId: answer.payload.invitationId, ownerKeyFingerprint: options.identity.keyHash,
        peerKeyFingerprint: answer.keyHash, ownerDtlsFingerprint: invitation.offer.payload.dtlsFingerprint,
        peerDtlsFingerprint: answer.payload.dtlsFingerprint, comparisonCode: compared.code, role: invitation.role };
      invitation.review = review; invitation.link.setTranscript(compared.hash, compared.code);
      await invitation.link.setRemote(answer); peer.state = 'awaiting-confirmation'; emit(); return structuredClone(review);
    },
    async confirmPeer(invitationId, comparisonCode) {
      alive(); const invitation = invitations.get(invitationId);
      if (!invitation?.review) fail('ACCESS_DENIED'); await invitation.link.confirm(comparisonCode);
    },
    async revokePeer(peerId) { alive(); if (!peers.has(peerId)) fail('ACCESS_DENIED'); await end('revoked'); },
    getStatus: status,
    subscribeStatus(listener) { if (typeof listener !== 'function') fail('VALIDATION_FAILED'); listeners.add(listener); return () => { listeners.delete(listener); }; },
    close: () => end('closed'),
  };
  return Object.freeze(owner);
}

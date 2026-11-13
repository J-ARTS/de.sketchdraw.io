// Transport-neutral relay hub: forwards opaque, end-to-end encrypted records between one host and its guests.
// It is used by the self-hosted WebSocket relay (server.mjs) and by native peer relays (Electron main process).
// State is in memory only; the hub never sees the PIN, keys or document content and never logs identifiers.
import crypto from 'node:crypto';

const ID_BYTES = 16;
const TOPIC_PATTERN = /^[0-9a-f]{64}$/;
// Both supported adapters account framing in bufferedAmount: native uses 5 bytes, WebSocket at most 14.
const MAX_FRAME_OVERHEAD_BYTES = 14;

export const DEFAULT_LIMITS = Object.freeze({
  maxRecordBytes: 66 * 1024,
  maxConnections: 2000,
  maxTopics: 1000,
  maxGuestsPerTopic: 24,
  joinTimeoutMs: 5000,
  idleTimeoutMs: 60_000,
  maxSessionMs: 13 * 60 * 60 * 1000,
  messagesPerSecond: 250,
  messageBurst: 400,
  // One application message may be 8 MiB (about 137 records); the burst must cover it and clients pace below the rate.
  bytesPerSecond: 4 * 1024 * 1024,
  byteBurst: 10 * 1024 * 1024,
  maxBufferedBytes: 12 * 1024 * 1024,
  maxControlBufferedBytes: 64 * 1024,
  maxTotalBufferedBytes: 64 * 1024 * 1024,
  // Shared cap over all connections of one hub (volunteer helpers); Infinity for a dedicated server.
  aggregateBytesPerSecond: Infinity,
  aggregateByteBurst: Infinity,
  // Pending aggregate pacing is separate from adapter buffers, with a finite lifetime and per-sender share.
  maxAggregateQueuedBytes: 8 * 1024 * 1024,
  maxAggregateQueuedBytesPerConnection: 1024 * 1024,
  maxAggregateQueuedRecordsPerConnection: 128,
  aggregateQueueTimeoutMs: 5000,
});

const HOST_PROOF_LABEL = 'sketchdraw-relay-host-v1\0';
const TOPIC_LABEL = 'sketchdraw-relay-topic-v1\0';
const SESSION_AD_LABEL = 'sketchdraw-relay-session-ad-v1\0';
const SERVICE_AD_LABEL = 'sketchdraw-relay-service-ad-v1\0';
const ED25519_SPKI_PREFIX = Buffer.from('302a300506032b6570032100', 'hex');

/** The relay namespace of a host key: a host can only register the topic that belongs to its own public key. */
export function topicForHostKey(rawKey) {
  return crypto.createHash('sha256').update(TOPIC_LABEL).update(rawKey).digest('hex');
}

/** DHT topic under which a helper advertises that it currently serves the session behind a relay topic. */
export function sessionAdTopic(relayTopicHex) {
  return crypto.createHash('sha256').update(SESSION_AD_LABEL).update(Buffer.from(relayTopicHex, 'hex')).digest();
}

/** DHT topic under which volunteer peers advertise that they offer relay capacity (versioned service namespace). */
export function serviceAdTopic() {
  return crypto.createHash('sha256').update(SERVICE_AD_LABEL).digest();
}

function decodeKey(text) {
  if (typeof text !== 'string' || !/^[A-Za-z0-9_-]{43}$/.test(text)) return null;
  const raw = Buffer.from(text, 'base64url');
  return raw.length === 32 && raw.toString('base64url') === text ? raw : null;
}

function verifyHostProof(rawKey, topic, nonce, signature) {
  try {
    const key = crypto.createPublicKey({ key: Buffer.concat([ED25519_SPKI_PREFIX, rawKey]), format: 'der', type: 'spki' });
    return crypto.verify(null, Buffer.concat([Buffer.from(HOST_PROOF_LABEL), Buffer.from(topic, 'hex'), nonce]), key, signature);
  } catch { return false; }
}

function bucket(ratePerSecond, burst, now) { return { tokens: burst, rate: ratePerSecond, burst, at: now }; }
function take(b, amount, now) {
  b.tokens = Math.min(b.burst, b.tokens + ((now - b.at) / 1000) * b.rate);
  b.at = now;
  if (b.tokens < amount) return false;
  b.tokens -= amount;
  return true;
}

/**
 * A connection is any ordered message transport: `send(data, binary)`, `bufferedAmount()`, `close(code, reason)`,
 * optional `terminate()`. `accept` returns a handler (`message`, `touch`, `closed`) or null when the hub is full.
 */
export function createRelayHub(options = {}) {
  const limits = { ...DEFAULT_LIMITS, ...(options.limits ?? {}) };
  const now = options.now ?? Date.now;
  const topics = new Map();
  // The hub owns cleanup even when an adapter never reports its transport's close event.
  const connections = new Map();
  const counters = { forwardedRecords: 0, closedForLimit: 0 };
  const aggregate = Number.isFinite(limits.aggregateBytesPerSecond) ? bucket(limits.aggregateBytesPerSecond, limits.aggregateByteBurst, now()) : null;
  // Insertion order is the next sender to serve. Each sender retains FIFO order; one record per turn.
  const forwarding = new Map();
  let queuedBytes = 0;
  let forwardingTimer = null;
  let draining = false;
  let disposed = false;

  function forgetForwarding(conn) {
    for (const [source, queue] of forwarding) {
      const remaining = source === conn ? [] : queue.records.filter(record => record.target !== conn);
      const bytes = remaining.reduce((sum, record) => sum + record.frame.length, 0);
      queuedBytes -= queue.bytes - bytes;
      if (!remaining.length) forwarding.delete(source);
      else { queue.records = remaining; queue.bytes = bytes; }
    }
    if (!forwarding.size && forwardingTimer) { clearTimeout(forwardingTimer); forwardingTimer = null; }
  }

  function scheduleForwarding(delay) {
    if (forwardingTimer || disposed || !forwarding.size) return;
    forwardingTimer = setTimeout(() => { forwardingTimer = null; drainForwarding(); }, Math.max(1, Math.ceil(delay)));
    forwardingTimer.unref?.();
  }

  function sendFrame(target, frame) {
    if (!canSend(target, frame.length, limits.maxBufferedBytes)) return;
    counters.forwardedRecords++;
    try { target.send(frame, true); } catch { closeConnection(target, 1011, 'send-failed'); }
  }

  function drainForwarding() {
    if (draining || disposed) return;
    draining = true;
    try {
      while (forwarding.size) {
        for (const [source, queue] of forwarding) {
          if (now() - queue.records[0].at >= limits.aggregateQueueTimeoutMs) {
            counters.closedForLimit++;
            closeConnection(source, 4429, 'aggregate-queue-timeout');
          }
        }
        if (!forwarding.size) break;
        const [source, queue] = forwarding.entries().next().value;
        const record = queue.records[0];
        if (!take(aggregate, record.frame.length, now())) {
          const wait = (record.frame.length - aggregate.tokens) * 1000 / aggregate.rate;
          // Also honor the oldest waiting sender's deadline, even behind another sender.
          const deadline = Math.min(...Array.from(forwarding.values(), value => value.records[0].at + limits.aggregateQueueTimeoutMs));
          scheduleForwarding(Math.min(wait, Math.max(1, deadline - now())));
          break;
        }
        forwarding.delete(source);
        queue.records.shift(); queue.bytes -= record.frame.length; queuedBytes -= record.frame.length;
        if (queue.records.length) forwarding.set(source, queue);
        sendFrame(record.target, record.frame);
      }
      if (!forwarding.size && forwardingTimer) { clearTimeout(forwardingTimer); forwardingTimer = null; }
    } finally { draining = false; }
  }

  function paceForwarding(source, target, frame) {
    if (!aggregate) { sendFrame(target, frame); return; }
    // Only validated forwarding targets reach this point; join/ping/drop controls never spend payload tokens.
    if (!forwarding.size && take(aggregate, frame.length, now())) { sendFrame(target, frame); return; }
    const queue = forwarding.get(source) ?? { records: [], bytes: 0 };
    if (frame.length > aggregate.burst || queue.bytes + frame.length > limits.maxAggregateQueuedBytesPerConnection
      || queue.records.length >= limits.maxAggregateQueuedRecordsPerConnection || frame.length > limits.maxAggregateQueuedBytes) {
      counters.closedForLimit++; closeConnection(source, 4429, 'aggregate-queue-full'); return;
    }
    while (queuedBytes + frame.length > limits.maxAggregateQueuedBytes) {
      // Shed the greatest producer, never the unrelated connection that happened to arrive next.
      let largest = source, largestBytes = queue.bytes + frame.length;
      for (const [candidate, pending] of forwarding) if (pending.bytes > largestBytes) { largest = candidate; largestBytes = pending.bytes; }
      counters.closedForLimit++; closeConnection(largest, 4429, 'aggregate-queue-full');
      if (largest === source || !connections.has(source) || !connections.has(target)) return;
    }
    // Copy so a tiny retained view cannot pin a much larger adapter input allocation.
    queue.records.push({ target, frame: Buffer.from(frame), at: now() }); queue.bytes += frame.length; queuedBytes += frame.length;
    forwarding.set(source, queue);
    drainForwarding();
  }

  function closeConnection(conn, code, reason, terminate = false) {
    const entry = connections.get(conn);
    if (!entry || entry.closing) return;
    entry.closing = true;
    try {
      if (terminate && conn.terminate) conn.terminate(code, reason);
      else conn.close(code, reason);
    } catch { /* Ownership is released below even if the adapter has stopped. */ }
    finally {
      // Close the outgoing queue before leave() emits more controls; callbacks may be synchronous or absent.
      entry.closed();
    }
  }

  function canSend(conn, size, perConnectionLimit) {
    const entry = connections.get(conn);
    if (!entry || entry.closing || !conn.isOpen()) return false;
    const framedSize = size + MAX_FRAME_OVERHEAD_BYTES;
    let tooMuch = conn.bufferedAmount() + framedSize > perConnectionLimit;
    if (!tooMuch) {
      let total = framedSize;
      // Adapter counters update synchronously on send and decrease on drain. Pacing has its own bounded queue.
      for (const connection of connections.keys()) {
        total += connection.bufferedAmount();
        if (total > limits.maxTotalBufferedBytes) { tooMuch = true; break; }
      }
    }
    if (!tooMuch) return true;
    counters.closedForLimit++;
    closeConnection(conn, 4408, 'slow-consumer', true);
    return false;
  }

  function control(conn, value) {
    const entry = connections.get(conn);
    if (!entry) return false;
    const data = JSON.stringify(value);
    const joined = entry.state.role === 'host' || entry.state.role === 'guest';
    if (!canSend(conn, Buffer.byteLength(data), joined ? limits.maxBufferedBytes : limits.maxControlBufferedBytes)) return false;
    try { conn.send(data, false); } catch { closeConnection(conn, 1011, 'send-failed'); return false; }
    return connections.has(conn) && conn.isOpen();
  }

  function accept(conn) {
    if (disposed || connections.has(conn) || connections.size >= limits.maxConnections) return null;
    const state = { role: null, topic: null, id: null, lastSeen: now(), msgs: bucket(limits.messagesPerSecond, limits.messageBurst, now()), bytes: bucket(limits.bytesPerSecond, limits.byteBurst, now()) };
    connections.set(conn, { state, closed, closing: false });
    const joinTimer = setTimeout(() => closeConnection(conn, 4408, 'join-timeout'), limits.joinTimeoutMs);
    const lifeTimer = setTimeout(() => closeConnection(conn, 4410, 'session-limit'), limits.maxSessionMs);
    const idleTimer = setInterval(() => {
      if (now() - state.lastSeen > limits.idleTimeoutMs) closeConnection(conn, 4408, 'idle', true);
    }, Math.max(1000, Math.floor(limits.idleTimeoutMs / 3)));
    for (const timer of [joinTimer, lifeTimer, idleTimer]) timer.unref?.();
    let ended = false;

    function message(data, isBinary) {
      if (ended) return;
      state.lastSeen = now();
      const size = data.length;
      if (size > limits.maxRecordBytes) { counters.closedForLimit++; closeConnection(conn, 1009, 'too-large'); return; }
      if (!take(state.msgs, 1, now()) || !take(state.bytes, size, now())) { counters.closedForLimit++; closeConnection(conn, 4429, 'rate-limit'); return; }
      if (!state.role) {
        if (isBinary || size > 256) { closeConnection(conn, 1008, 'bad-join'); return; }
        let join;
        try { join = JSON.parse(Buffer.from(data).toString('utf8')); } catch { closeConnection(conn, 1008, 'bad-join'); return; }
        if (join?.t === 'ping') { state.role = null; control(conn, { t: 'pong' }); return; }
        if (!join || typeof join !== 'object' || !['host', 'guest'].includes(join.t) || typeof join.topic !== 'string' || !TOPIC_PATTERN.test(join.topic)) { closeConnection(conn, 1008, 'bad-join'); return; }
        if (join.t === 'guest') { clearTimeout(joinTimer); joinAsGuest(conn, state, join.topic); return; }
        const rawKey = decodeKey(join.key);
        if (!rawKey || topicForHostKey(rawKey) !== join.topic) { closeConnection(conn, 1008, 'bad-topic'); return; }
        state.role = 'pending-host'; state.topic = join.topic; state.hostKey = rawKey; state.nonce = crypto.randomBytes(32);
        control(conn, { t: 'challenge', nonce: state.nonce.toString('hex') });
        return;
      }
      if (state.role === 'pending-host') {
        if (isBinary || size > 256) { closeConnection(conn, 1008, 'bad-proof'); return; }
        let proof;
        try { proof = JSON.parse(Buffer.from(data).toString('utf8')); } catch { closeConnection(conn, 1008, 'bad-proof'); return; }
        const signature = typeof proof?.sig === 'string' && /^[A-Za-z0-9_-]{86}$/.test(proof.sig) ? Buffer.from(proof.sig, 'base64url') : null;
        const nonce = state.nonce;
        state.nonce = null;
        if (proof?.t !== 'proof' || !signature || signature.length !== 64 || !verifyHostProof(state.hostKey, state.topic, nonce, signature)) { closeConnection(conn, 4401, 'bad-proof'); return; }
        clearTimeout(joinTimer);
        joinAsHost(conn, state, state.topic);
        return;
      }
      if (!isBinary) {
        // Text after the join is only a keep-alive from clients without protocol-level pings.
        try { if (JSON.parse(Buffer.from(data).toString('utf8'))?.t === 'ping') { control(conn, { t: 'pong' }); return; } } catch { /* falls through */ }
        closeConnection(conn, 1003, 'binary-only');
        return;
      }
      forward(conn, state, data);
    }

    function closed() {
      if (ended) return;
      ended = true;
      clearTimeout(joinTimer); clearTimeout(lifeTimer); clearInterval(idleTimer);
      connections.delete(conn);
      forgetForwarding(conn);
      leave(conn, state);
    }

    return { message, touch() { state.lastSeen = now(); }, closed };
  }

  function joinAsHost(conn, state, topicKey) {
    const previous = topics.get(topicKey);
    if (!previous && topics.size >= limits.maxTopics) { control(conn, { t: 'error', code: 'FULL' }); closeConnection(conn, 4503, 'full'); return; }
    // Transfer ownership first: both synchronous and delayed closes of the previous generation are now inert.
    const topic = { host: conn, guests: new Map() };
    topics.set(topicKey, topic);
    state.role = 'host'; state.topic = topicKey;
    if (previous) {
      control(previous.host, { t: 'replaced' });
      for (const guest of previous.guests.values()) closeConnection(guest, 4410, 'host-replaced');
      previous.guests.clear();
      closeConnection(previous.host, 4409, 'replaced');
    }
    if (control(conn, { t: 'ready', capacity: limits.maxGuestsPerTopic, hosts: topics.size, maxHosts: limits.maxTopics }) && topics.get(topicKey) === topic) {
      options.onHostRegistered?.(topicKey);
    }
  }

  function joinAsGuest(conn, state, topicKey) {
    const topic = topics.get(topicKey);
    if (!topic?.host) { control(conn, { t: 'error', code: 'HOST_OFFLINE' }); closeConnection(conn, 4404, 'host-offline'); return; }
    if (topic.guests.size >= limits.maxGuestsPerTopic) { control(conn, { t: 'error', code: 'ROOM_FULL' }); closeConnection(conn, 4503, 'full'); return; }
    const id = crypto.randomBytes(ID_BYTES);
    state.role = 'guest'; state.topic = topicKey; state.id = id;
    topic.guests.set(id.toString('hex'), conn);
    if (!control(conn, { t: 'ready' })) return;
    if (!control(topic.host, { t: 'guest-join', id: id.toString('hex') })) closeConnection(conn, 4503, 'busy');
  }

  function forward(conn, state, data) {
    const topic = topics.get(state.topic);
    if (!topic) return;
    let target; let frame;
    if (state.role === 'guest') {
      if (topic.guests.get(state.id.toString('hex')) !== conn) return;
      target = topic.host; if (!target) return;
      if (data.length + ID_BYTES > limits.maxRecordBytes) { counters.closedForLimit++; closeConnection(conn, 1009, 'too-large'); return; }
      frame = Buffer.concat([state.id, data]);
    } else {
      if (topic.host !== conn) return;
      if (data.length < ID_BYTES) { closeConnection(conn, 1008, 'bad-frame'); return; }
      target = topic.guests.get(Buffer.from(data.subarray(0, ID_BYTES)).toString('hex'));
      if (!target) return;
      // A frame that carries only the guest id asks the relay to drop that guest.
      if (data.length === ID_BYTES) { closeConnection(target, 4411, 'dropped'); return; }
      frame = data.subarray(ID_BYTES);
    }
    paceForwarding(conn, target, frame);
  }

  function leave(conn, state) {
    if (!state.topic) return;
    const topic = topics.get(state.topic);
    if (!topic) return;
    if (state.role === 'host' && topic.host === conn) {
      topics.delete(state.topic);
      for (const guest of topic.guests.values()) closeConnection(guest, 4410, 'host-left');
      topic.guests.clear();
      options.onHostGone?.(state.topic);
    } else if (state.role === 'guest') {
      const key = state.id.toString('hex');
      if (topic.guests.get(key) === conn) {
        topic.guests.delete(key);
        if (topic.host) control(topic.host, { t: 'guest-leave', id: key });
      }
    }
  }

  return {
    accept,
    limits,
    stats: () => ({ connections: connections.size, topics: topics.size, guests: Array.from(topics.values()).reduce((sum, topic) => sum + topic.guests.size, 0), ...counters }),
    /** Closes every connection; used when the owner of the hub stops. */
    dispose() {
      disposed = true;
      if (forwardingTimer) clearTimeout(forwardingTimer);
      forwardingTimer = null;
      for (const conn of Array.from(connections.keys())) closeConnection(conn, 1001, 'shutdown');
    },
  };
}

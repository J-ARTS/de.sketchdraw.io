import type { SessionIdentity } from './types';
import type { PeerSessionKey } from '../session';
import { SessionAccessError } from '../session';
import type { ParsedPair } from './crypto';
import { sign, signedEnvelope, verify } from './crypto';
import type { Manifest, Wire } from './wire';
import { wire, manifest as validateManifest } from './wire';
import { LIMIT, utf8, sha, fail, randomHex, deferred, timeout, fromHex, toHex, sameSession } from './primitives';

const CONTROL = 'sketchdraw-control-v1'; const BULK = 'sketchdraw-bulk-v1'; const PROTOCOL = 'sketchdraw.p2p.v1';
let reservedBytes = 0; let reservedTransfers = 0;
interface Incoming {
  manifest: Manifest; bytes: Uint8Array<ArrayBuffer>; seen: Set<number>; count: number;
  done: ReturnType<typeof deferred<Uint8Array<ArrayBuffer>>>; consumed: ReturnType<typeof deferred<void>>;
  idle: ReturnType<typeof setTimeout>; total: ReturnType<typeof setTimeout>; released: boolean;
}
export interface LinkOptions {
  owner: boolean; identity: SessionIdentity; session: PeerSessionKey; connectionId: string;
  onAuthenticated: () => void | Promise<void>; onMessage: (message: Wire) => void | Promise<void>;
  onClose: (reason: string) => void;
  allowTransfer: (manifest: Manifest) => boolean;
}
export class PeerLink {
  readonly pc: RTCPeerConnection;
  readonly authenticated = deferred<void>();
  control?: RTCDataChannel; bulk?: RTCDataChannel;
  remote?: ParsedPair;
  transcript = ''; code = ''; closed = false; authorized = false;
  private confirmed = false; private remoteConfirmed = false; private certVerified = false; private certChecking = false;
  private sentConfirmation = false; private maxMessage = 0;
  private controlChain = Promise.resolve(); private sendChain = Promise.resolve(); private controlBytes = 0; private sendingBytes = 0;
  private inbound?: Incoming; private manifestPending = false; private applicationJobs = 0;
  private outbound?: { id: string; ready: ReturnType<typeof deferred<void>> };
  private connectTimer?: ReturnType<typeof setTimeout>; private confirmTimer?: ReturnType<typeof setTimeout>;
  private heartbeat?: ReturnType<typeof setInterval>; private ping?: { nonce: string; at: number };
  private aborters = new Set<(error: Error) => void>();

  constructor(readonly options: LinkOptions) {
    if (typeof RTCPeerConnection !== 'function') fail('NOT_CONNECTED', 'WEBRTC_UNAVAILABLE');
    this.pc = new RTCPeerConnection({ iceServers: [], iceTransportPolicy: 'all', iceCandidatePoolSize: 0 });
    this.pc.addEventListener('track', () => this.close('MEDIA_FORBIDDEN'));
    this.pc.addEventListener('datachannel', event => {
      if (options.owner) { event.channel.close(); this.close('EXTRA_CHANNEL'); }
      else this.channel(event.channel);
    });
    this.pc.addEventListener('connectionstatechange', () => {
      if (['failed', 'closed', 'disconnected'].includes(this.pc.connectionState)) this.close('NOT_CONNECTED');
      else void this.transportReady();
    });
    this.pc.addEventListener('negotiationneeded', () => { if (this.authorized) this.close('RENEGOTIATION_FORBIDDEN'); });
    if (options.owner) {
      this.channel(this.pc.createDataChannel(CONTROL, { ordered: true, protocol: PROTOCOL }));
      this.channel(this.pc.createDataChannel(BULK, { ordered: true, protocol: PROTOCOL }));
    }
  }
  private channel(channel: RTCDataChannel): void {
    if (this.closed || ![CONTROL, BULK].includes(channel.label) || channel.protocol !== PROTOCOL || !channel.ordered
      || channel.maxRetransmits !== null || channel.maxPacketLifeTime !== null
      || (channel.label === CONTROL ? this.control : this.bulk)) { channel.close(); this.close('CHANNEL_INVALID'); return; }
    if (channel.label === CONTROL) this.control = channel; else this.bulk = channel;
    channel.binaryType = 'arraybuffer'; channel.bufferedAmountLowThreshold = 256 * 1024;
    channel.addEventListener('open', () => { void this.transportReady(); });
    channel.addEventListener('close', () => this.close('NOT_CONNECTED'));
    channel.addEventListener('error', () => this.close('NOT_CONNECTED'));
    channel.addEventListener('message', event => {
      try {
        if (channel === this.control) this.controlMessage(event.data as unknown);
        else this.bulkMessage(event.data as unknown);
      } catch (error) { this.close(error instanceof Error ? error.message : 'PROTOCOL_ERROR'); }
    });
  }
  async gather(): Promise<string> {
    if (this.closed) fail('NOT_CONNECTED');
    const gathered = deferred<void>();
    const check = (): void => { if (this.pc.iceGatheringState === 'complete') gathered.resolve(); };
    const abort = (error: Error): void => gathered.reject(error);
    this.aborters.add(abort); this.pc.addEventListener('icegatheringstatechange', check); check();
    try {
      await timeout(gathered.promise, LIMIT.gatherMs, 'GATHERING_TIMEOUT');
      if (this.closed || !this.pc.localDescription?.sdp) fail('NOT_CONNECTED');
      return this.pc.localDescription.sdp;
    } catch (error) { this.close('GATHERING_TIMEOUT'); throw error; }
    finally { this.pc.removeEventListener('icegatheringstatechange', check); this.aborters.delete(abort); }
  }
  async setRemote(pair: ParsedPair): Promise<void> {
    if (this.closed || this.remote) fail('SESSION_CHANGED');
    this.remote = pair;
    this.connectTimer = setTimeout(() => this.close('DIRECT_CONNECTION_TIMEOUT'), LIMIT.connectMs);
    try { await this.pc.setRemoteDescription({ type: pair.payload.type, sdp: pair.payload.sdp }); }
    catch { this.close('SDP_REJECTED'); fail('PROTOCOL_ERROR'); }
    void this.transportReady();
  }
  setTranscript(hash: string, code: string): void {
    this.transcript = hash; this.code = code;
    this.confirmTimer = setTimeout(() => this.close('CONFIRMATION_TIMEOUT'), LIMIT.confirmMs);
    void this.transportReady();
  }
  async confirm(code: string): Promise<void> {
    if (code !== this.code || !this.code) fail('ACCESS_DENIED', 'COMPARISON_CODE_MISMATCH');
    if (this.closed) fail('NOT_CONNECTED');
    this.confirmed = true; await this.transportReady();
    return this.authenticated.promise;
  }
  private async transportReady(): Promise<void> {
    if (this.closed || !this.remote || !this.transcript || this.control?.readyState !== 'open' || this.bulk?.readyState !== 'open') return;
    try {
      if (!this.certVerified) {
        if (this.certChecking) return;
        this.certChecking = true;
        const sctp = this.pc.sctp;
        if (!sctp || typeof sctp.transport.getRemoteCertificates !== 'function') fail('NOT_CONNECTED', 'REMOTE_CERTIFICATE_UNAVAILABLE');
        const certificates = sctp.transport.getRemoteCertificates();
        if (!certificates[0]) fail('ACCESS_DENIED', 'REMOTE_CERTIFICATE_UNAVAILABLE');
        if (await sha(new Uint8Array(certificates[0])) !== this.remote.payload.dtlsFingerprint) fail('ACCESS_DENIED', 'DTLS_FINGERPRINT_MISMATCH');
        if (this.closed) return;
        const size = sctp.maxMessageSize;
        if (!(size >= 4096)) fail('NOT_CONNECTED', 'TRANSPORT_LIMIT_UNSUPPORTED');
        this.maxMessage = Math.min(LIMIT.frame, size); this.certVerified = true;
        clearTimeout(this.connectTimer);
      }
      if (this.confirmed && !this.sentConfirmation) {
        this.sentConfirmation = true;
        await this.send('pair-confirm', { transcriptHash: this.transcript });
      }
      if (!this.closed && this.certVerified && this.confirmed && this.remoteConfirmed && !this.authorized) {
        this.authorized = true; clearTimeout(this.confirmTimer);
        this.authenticated.resolve();
        this.heartbeat = setInterval(() => {
          if (this.ping && performance.now() - this.ping.at >= LIMIT.inactivityMs) { this.close('HEARTBEAT_TIMEOUT'); return; }
          if (!this.ping) {
            this.ping = { nonce: randomHex(), at: performance.now() };
            void this.send('ping', { nonce: this.ping.nonce }).catch(() => this.close('NOT_CONNECTED'));
          }
        }, 5000);
        await this.options.onAuthenticated();
      }
    } catch (error) { this.close(error instanceof Error ? error.message : 'AUTHENTICATION_FAILED'); }
    finally { this.certChecking = false; }
  }
  private controlMessage(data: unknown): void {
    if (this.closed) return;
    if (typeof data !== 'string' || data.length > LIMIT.frame) fail();
    const bytes = utf8.encode(data).length;
    if (bytes > (this.maxMessage || LIMIT.frame) || this.controlBytes + bytes > LIMIT.controlQueue) fail('BUSY');
    this.controlBytes += bytes;
    this.controlChain = this.controlChain.then(async () => {
      if (this.closed || !this.remote) return;
      const signed = signedEnvelope(data, this.maxMessage || LIMIT.frame); const message = wire(signed.payload);
      if (!sameSession(message.session, this.options.session) || message.connectionId !== this.options.connectionId) fail('SESSION_CHANGED');
      await verify(signed, this.remote.key);
      if (this.closed) return;
      if (message.type === 'pair-confirm') {
        if (message.transcriptHash !== this.transcript) fail('ACCESS_DENIED');
        this.remoteConfirmed = true; void this.transportReady(); return;
      }
      if (!this.authorized) fail('ACCESS_DENIED');
      if (message.type === 'ping') { void this.send('pong', { nonce: message.nonce }).catch(() => this.close('NOT_CONNECTED')); return; }
      if (message.type === 'pong') {
        if (!this.ping || message.nonce !== this.ping.nonce) fail(); this.ping = undefined; return;
      }
      if (message.type === 'transfer-ready') {
        if (!this.outbound || this.outbound.id !== message.transferId) fail(); this.outbound.ready.resolve(); return;
      }
      if (message.type === 'transfer-abort') {
        if (this.outbound && this.outbound.id === message.transferId) this.outbound.ready.reject(new SessionAccessError('BUSY'));
        if (this.inbound?.manifest.transferId === message.transferId) this.releaseInbound(new SessionAccessError('PROTOCOL_ERROR'));
        return;
      }
      if (message.type === 'transfer-manifest') {
        void this.receiveManifest(message.manifest as Manifest).catch(error => this.close(error instanceof Error ? error.message : 'PROTOCOL_ERROR')); return;
      }
      // Application handlers may await bulk completion; they must not block the control channel that carries ready/abort.
      if (this.applicationJobs >= 64) fail('BUSY', 'APPLICATION_QUEUE_FULL');
      this.applicationJobs += 1;
      void Promise.resolve().then(() => { if (!this.closed) return this.options.onMessage(message); })
        .catch(error => this.close(error instanceof Error ? error.message : 'PROTOCOL_ERROR'))
        .finally(() => { this.applicationJobs -= 1; });
    }).catch(error => this.close(error instanceof Error ? error.message : 'PROTOCOL_ERROR'))
      .finally(() => { this.controlBytes -= bytes; });
  }
  async send(type: string, fields: Record<string, unknown>, authorize?: () => void, onSent?: () => void): Promise<void> {
    if (this.closed || (!this.authorized && type !== 'pair-confirm')) fail('NOT_CONNECTED');
    const message: Wire = { version: 1, type, session: this.options.session, connectionId: this.options.connectionId, ...fields };
    wire(JSON.stringify(message));
    const reserved = utf8.encode(JSON.stringify(message)).length + 256;
    if (this.sendingBytes + reserved > LIMIT.controlQueue) fail('BUSY'); this.sendingBytes += reserved;
    const work = this.sendChain.then(async () => {
      const data = JSON.stringify(await sign(this.options.identity, message));
      if (utf8.encode(data).length > this.maxMessage) fail('REQUEST_TOO_LARGE');
      await this.sendData(this.control!, data, authorize, onSent);
    }).finally(() => { this.sendingBytes -= reserved; });
    this.sendChain = work.catch(() => undefined);
    return work;
  }
  private async sendData(channel: RTCDataChannel, data: string | ArrayBuffer, authorize?: () => void, onSent?: () => void): Promise<void> {
    const bytes = typeof data === 'string' ? utf8.encode(data).length : data.byteLength;
    if (!this.maxMessage || bytes > this.maxMessage) fail('REQUEST_TOO_LARGE');
    while (!this.closed && (this.control?.bufferedAmount ?? 0) + (this.bulk?.bufferedAmount ?? 0) + bytes > 1024 * 1024) {
      const low = deferred<void>();
      const wake = (): void => low.resolve(); const abort = (error: Error): void => low.reject(error);
      this.aborters.add(abort);
      this.control?.addEventListener('bufferedamountlow', wake); this.bulk?.addEventListener('bufferedamountlow', wake);
      if ((this.control?.bufferedAmount ?? 0) + (this.bulk?.bufferedAmount ?? 0) <= 256 * 1024) low.resolve();
      try { await timeout(low.promise, LIMIT.inactivityMs, 'SEND_BACKPRESSURE_TIMEOUT'); }
      finally { this.aborters.delete(abort); this.control?.removeEventListener('bufferedamountlow', wake); this.bulk?.removeEventListener('bufferedamountlow', wake); }
    }
    if (this.closed || channel.readyState !== 'open') fail('NOT_CONNECTED');
    if ((this.control?.bufferedAmount ?? 0) + (this.bulk?.bufferedAmount ?? 0) + bytes > 1024 * 1024) fail('BUSY');
    authorize?.();
    if (typeof data === 'string') channel.send(data); else channel.send(data);
    onSent?.();
  }
  async sendTransfer(bytes: Uint8Array, metadata: Pick<Manifest, 'purpose' | 'revision' | 'previousHash' | 'requestId'>): Promise<string> {
    if (!this.authorized || this.closed) fail('NOT_CONNECTED');
    if (this.outbound) fail('BUSY');
    const transferId = randomHex(); const outgoing = { id: transferId, ready: deferred<void>() }; this.outbound = outgoing;
    const abort = (error: Error): void => outgoing.ready.reject(error); this.aborters.add(abort);
    try {
      const chunkSize = this.maxMessage - 32;
      const value: Manifest = { ...metadata, transferId, bytes: bytes.length, hash: await sha(bytes), chunkSize, chunks: Math.ceil(bytes.length / chunkSize) };
      validateManifest(value);
      await this.send('transfer-manifest', { manifest: value });
      await timeout(outgoing.ready.promise, LIMIT.inactivityMs, 'TRANSFER_READY_TIMEOUT');
      const start = performance.now();
      for (let index = 0; index < value.chunks; index += 1) {
        if (performance.now() - start > LIMIT.transferMs) fail('REQUEST_TIMEOUT');
        const offset = index * chunkSize; const length = Math.min(chunkSize, bytes.length - offset);
        const frame = new ArrayBuffer(32 + length); const view = new DataView(frame); const data = new Uint8Array(frame);
        data.set([0x53, 0x44, 0x50, 1]); data.set(fromHex(transferId), 4);
        view.setUint32(20, index); view.setUint32(24, offset); view.setUint32(28, length); data.set(bytes.subarray(offset, offset + length), 32);
        await this.sendData(this.bulk!, frame);
      }
      return transferId;
    } finally { if (this.outbound === outgoing) this.outbound = undefined; this.aborters.delete(abort); }
  }
  private async receiveManifest(value: Manifest): Promise<void> {
    validateManifest(value);
    if (!this.options.allowTransfer(value) || value.chunkSize + 32 > this.maxMessage) fail('ACCESS_DENIED');
    if (this.manifestPending) fail('BUSY');
    this.manifestPending = true;
    try {
      if (this.inbound) await timeout(this.inbound.consumed.promise, LIMIT.inactivityMs, 'TRANSFER_NOT_CONSUMED');
      if (this.closed) return;
      if (reservedTransfers >= 2 || reservedBytes + value.bytes > LIMIT.transferBytes) {
        await this.send('transfer-abort', { transferId: value.transferId }); return;
      }
      reservedTransfers += 1; reservedBytes += value.bytes;
      let bytes: Uint8Array<ArrayBuffer>;
      try { bytes = new Uint8Array(value.bytes); } catch { reservedTransfers -= 1; reservedBytes -= value.bytes; fail('BUSY'); }
      this.inbound = { manifest: value, bytes, seen: new Set(), count: 0, done: deferred(), consumed: deferred(), released: false,
        idle: setTimeout(() => this.close('TRANSFER_INACTIVITY'), LIMIT.inactivityMs), total: setTimeout(() => this.close('TRANSFER_TIMEOUT'), LIMIT.transferMs) };
      await this.send('transfer-ready', { transferId: value.transferId });
    } finally { this.manifestPending = false; }
  }
  private bulkMessage(raw: unknown): void {
    if (this.closed) return;
    if (!this.authorized || !(raw instanceof ArrayBuffer) || raw.byteLength > this.maxMessage || raw.byteLength < 32) fail();
    const incoming = this.inbound; if (!incoming) fail();
    const bytes = new Uint8Array(raw); const view = new DataView(raw); const m = incoming.manifest;
    if (bytes[0] !== 0x53 || bytes[1] !== 0x44 || bytes[2] !== 0x50 || bytes[3] !== 1 || toHex(bytes.subarray(4, 20)) !== m.transferId) fail();
    const index = view.getUint32(20); const offset = view.getUint32(24); const length = view.getUint32(28);
    if (index >= m.chunks || offset !== index * m.chunkSize || length !== Math.min(m.chunkSize, m.bytes - offset) || raw.byteLength !== length + 32) fail();
    const payload = bytes.subarray(32);
    if (incoming.seen.has(index)) {
      if (payload.some((byte, i) => byte !== incoming.bytes[offset + i])) fail(); return;
    }
    incoming.bytes.set(payload, offset); incoming.seen.add(index); incoming.count += 1;
    clearTimeout(incoming.idle); incoming.idle = setTimeout(() => this.close('TRANSFER_INACTIVITY'), LIMIT.inactivityMs);
    if (incoming.count === m.chunks) {
      void sha(incoming.bytes).then(hash => {
        if (this.closed || this.inbound !== incoming) return;
        if (hash !== m.hash) { this.close('TRANSFER_HASH_MISMATCH'); return; }
        incoming.done.resolve(incoming.bytes);
      }).catch(() => this.close('TRANSFER_HASH_FAILED'));
    }
  }
  async takeTransfer(transferId: string, purpose: Manifest['purpose']): Promise<{ bytes: Uint8Array<ArrayBuffer>; manifest: Manifest; release: () => void }> {
    const incoming = this.inbound;
    if (!incoming || incoming.manifest.transferId !== transferId || incoming.manifest.purpose !== purpose) fail();
    const bytes = await incoming.done.promise;
    if (this.closed || this.inbound !== incoming) fail('NOT_CONNECTED');
    return { bytes, manifest: incoming.manifest, release: () => { if (this.inbound === incoming) this.releaseInbound(); } };
  }
  private releaseInbound(error?: Error): void {
    const incoming = this.inbound; if (!incoming || incoming.released) return;
    incoming.released = true; clearTimeout(incoming.idle); clearTimeout(incoming.total);
    reservedBytes -= incoming.manifest.bytes; reservedTransfers -= 1; this.inbound = undefined;
    if (error) incoming.done.reject(error); incoming.consumed.resolve();
  }
  close(reason = 'CLOSED'): void {
    if (this.closed) return;
    this.closed = true; this.authorized = false;
    clearTimeout(this.connectTimer); clearTimeout(this.confirmTimer); clearInterval(this.heartbeat);
    const error = new SessionAccessError('NOT_CONNECTED'); error.message = reason;
    this.authenticated.reject(error); this.releaseInbound(error);
    for (const abort of this.aborters) abort(error); this.aborters.clear();
    this.control?.close(); this.bulk?.close(); this.pc.close(); this.options.onClose(reason);
  }
}

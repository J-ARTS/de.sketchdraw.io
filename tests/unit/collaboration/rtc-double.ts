// Deterministic unit-test transport only. Crypto stays real. This cannot prove ICE/DTLS interoperability.
import { sha, utf8 } from '../../../src/collaboration/primitives';
export class Channel extends EventTarget {
  readonly ordered = true; readonly protocol = 'sketchdraw.p2p.v1';
  readonly maxRetransmits = null; readonly maxPacketLifeTime = null;
  binaryType = 'arraybuffer'; bufferedAmountLowThreshold = 0; bufferedAmount = 0;
  readyState: RTCDataChannelState = 'connecting'; remote?: Channel;
  constructor(readonly label: string, readonly pc: RtcDouble) { super(); }
  send(data: string | ArrayBuffer) {
    if (this.readyState !== 'open') throw new Error('Not open');
    const cloned = typeof data === 'string' ? data : data.slice(0);
    RtcDouble.sent.push({ pc: this.pc.id, label: this.label, data: cloned });
    if (RtcDouble.drop?.(this, cloned)) return;
    this.bufferedAmount += typeof cloned === 'string' ? utf8.encode(cloned).length : cloned.byteLength;
    queueMicrotask(() => {
      this.bufferedAmount = 0; this.dispatchEvent(new Event('bufferedamountlow'));
      if (this.remote?.readyState === 'open') this.remote.dispatchEvent(new MessageEvent('message', { data: cloned }));
    });
  }
  close() {
    if (this.readyState === 'closed') return;
    this.readyState = 'closed'; this.dispatchEvent(new Event('close')); this.remote?.close();
  }
}
export class RtcDouble extends EventTarget {
  static all: RtcDouble[] = []; static sent: Array<{ pc: number; label: string; data: string | ArrayBuffer }> = [];
  static drop?: (channel: Channel, data: string | ArrayBuffer) => boolean;
  readonly id: number; readonly cert: Uint8Array<ArrayBuffer>; readonly config: RTCConfiguration;
  localDescription: RTCSessionDescriptionInit | null = null; remoteDescription: RTCSessionDescriptionInit | null = null;
  iceGatheringState: RTCIceGatheringState = 'new'; connectionState: RTCPeerConnectionState = 'new';
  channels: Channel[] = []; remote?: RtcDouble;
  sctp = { maxMessageSize: 16384, transport: { getRemoteCertificates: (): ArrayBuffer[] => this.remote ? [this.remote.cert.buffer] : [] } };
  constructor(configuration: RTCConfiguration) {
    super(); this.config = structuredClone(configuration); this.id = RtcDouble.all.length + 1;
    this.cert = utf8.encode(`Unit fixture certificate ${this.id}`); RtcDouble.all.push(this);
  }
  static reset() { for (const pc of this.all) pc.close(); this.all = []; this.sent = []; this.drop = undefined; }
  createDataChannel(label: string) { const channel = new Channel(label, this); this.channels.push(channel); return channel; }
  async createOffer(): Promise<RTCSessionDescriptionInit> { return { type: 'offer', sdp: await this.sdp('actpass') }; }
  async createAnswer(): Promise<RTCSessionDescriptionInit> { return { type: 'answer', sdp: await this.sdp('active') }; }
  async sdp(setup: string) {
    const fingerprint = (await sha(this.cert)).toUpperCase().match(/../g)!.join(':');
    return [`v=0`, `o=- ${this.id} 1 IN IP4 127.0.0.1`, 's=-', 't=0 0',
      'm=application 9 UDP/DTLS/SCTP webrtc-datachannel', 'c=IN IP4 0.0.0.0', 'a=mid:0',
      'a=ice-ufrag:unit', 'a=ice-pwd:unit-test-password', `a=setup:${setup}`, `a=fingerprint:sha-256 ${fingerprint}`,
      'a=sctp-port:5000', 'a=candidate:1 1 udp 2122260223 127.0.0.1 40000 typ host', 'a=end-of-candidates', ''].join('\r\n');
  }
  async setLocalDescription(description: RTCSessionDescriptionInit) {
    this.localDescription = description; this.iceGatheringState = 'complete'; this.dispatchEvent(new Event('icegatheringstatechange'));
  }
  async setRemoteDescription(description: RTCSessionDescriptionInit) {
    this.remoteDescription = description;
    const id = Number(description.sdp!.match(/o=- (\d+)/)![1]); this.remote = RtcDouble.all.find(pc => pc.id === id)!;
    if (description.type === 'answer') {
      const other = this.remote;
      for (const channel of this.channels) {
        const remote = new Channel(channel.label, other); channel.remote = remote; remote.remote = channel; other.channels.push(remote);
        const event = new Event('datachannel') as RTCDataChannelEvent;
        Object.defineProperty(event, 'channel', { value: remote }); other.dispatchEvent(event);
      }
      for (const pc of [this, other]) {
        pc.connectionState = 'connected'; pc.dispatchEvent(new Event('connectionstatechange'));
        for (const channel of pc.channels) { channel.readyState = 'open'; channel.dispatchEvent(new Event('open')); }
      }
    }
  }
  close() {
    if (this.connectionState === 'closed') return;
    this.connectionState = 'closed'; for (const channel of this.channels) channel.close();
    this.dispatchEvent(new Event('connectionstatechange'));
  }
}

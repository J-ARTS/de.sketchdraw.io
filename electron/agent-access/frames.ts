import type { Socket } from 'node:net';
import { AGENT_ACCESS_LIMITS as L } from '../../src/agent-access/types';

/** Shared accounting covers incomplete incoming frames, queued writes and held requests. */
export class ByteBudget {
  private used = 0;
  acquire(bytes: number): () => void {
    if (!Number.isSafeInteger(bytes) || bytes < 0 || this.used + bytes > L.TOTAL_BUFFER_BUDGET_BYTES) throw new Error('Transport budget exceeded.');
    this.used += bytes;
    let released = false;
    return () => { if (!released) { released = true; this.used -= bytes; } };
  }
}

export class JsonFrames {
  onFrame: (value: unknown, bytes: number) => void = () => {};
  onClose: () => void = () => {};
  limit: number = L.PRE_AUTH_FRAME_BYTES;
  private chunks: Buffer[] = [];
  private releases: (() => void)[] = [];
  private bytes = 0;
  private ended = false;
  constructor(readonly socket: Socket, readonly budget = new ByteBudget()) {
    socket.on('data', (data: Buffer) => {
      try {
        let cursor = 0;
        while (cursor < data.length && !this.ended) {
          const newline = data.indexOf(10, cursor);
          const end = newline < 0 ? data.length : newline;
          const part = data.subarray(cursor, end);
          if (this.bytes + part.length + 1 > this.limit) throw new Error('Frame too large.');
          if (part.length) { this.releases.push(this.budget.acquire(part.length)); this.chunks.push(Buffer.from(part)); this.bytes += part.length; }
          cursor = end + 1;
          if (newline < 0) break;
          const bytes = this.bytes;
          const raw = Buffer.concat(this.chunks, bytes);
          this.clearInput();
          const text = new TextDecoder('utf-8', { fatal: true }).decode(raw);
          // Reject deeply nested envelopes before parsing; strings do not count as structure.
          let depth = 0, quoted = false, escape = false;
          for (const char of text) {
            if (quoted) { if (escape) escape = false; else if (char === '\\') escape = true; else if (char === '"') quoted = false; }
            else if (char === '"') quoted = true;
            else if (char === '{' || char === '[') { if (++depth > 80) throw new Error('Frame too deep.'); }
            else if (char === '}' || char === ']') depth--;
          }
          this.onFrame(JSON.parse(text), bytes);
        }
      } catch { this.destroy(); }
    });
    socket.on('error', () => this.destroy());
    socket.on('close', () => {
      this.ended = true; this.clearInput(); this.onClose();
    });
  }
  private clearInput(): void { this.chunks = []; this.bytes = 0; this.releases.splice(0).forEach(release => release()); }
  send(value: unknown): void {
    if (this.ended) throw new Error('Transport closed.');
    const encoded = Buffer.from(JSON.stringify(value) + '\n');
    if (encoded.length > this.limit) throw new Error('Response too large.');
    const release = this.budget.acquire(encoded.length);
    try { this.socket.write(encoded, () => release()); } catch (error) { release(); throw error; }
  }
  destroy(): void { this.ended = true; this.clearInput(); this.socket.destroy(); }
}

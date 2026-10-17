import { createHash, randomBytes } from 'node:crypto';
import { chmod, lstat, mkdtemp, realpath, rm } from 'node:fs/promises';
import { createServer, type Server, type Socket } from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { AgentAccessError, mapDomainErrorToPayload } from '../../src/agent-access/errors';
import { canonicalizeMutationRequest, validateAgentId, validateExpectedRevision } from '../../src/agent-access/fingerprint';
import { helloSchema, verifySchema, toolRequestSchema, parseOperationInput } from '../../src/agent-access/schema';
import {
  AGENT_ACCESS_LIMITS as L, AGENT_AUTH_LABELS, AGENT_WRITE_OPERATIONS,
  type AgentControlMessage, type AgentControlAck, type AgentGrantSummary,
  type AgentIssuedGrant, type AgentPermission, type AgentRendererRequest,
  type AgentRendererResponse, type AgentSessionDescriptor, type AgentOperationName,
  type AgentOperationInput, type AgentOperationOutput,
} from '../../src/agent-access/types';
import { authMac, sameMac } from './auth';
import { ByteBudget, JsonFrames } from './frames';

export interface AgentHostOptions {
  onRequest(request: AgentRendererRequest, signal: AbortSignal): Promise<AgentRendererResponse>;
  onControl(message: AgentControlMessage): Promise<AgentControlAck> | AgentControlAck;
}
type JournalEntry = { fingerprint: string; result: Promise<AgentOperationOutput> };
type Grant = { summary: AgentGrantSummary; capability: string; journal: Map<string, JournalEntry> };
type Connection = { frames: JsonFrames; grant?: Grant; authenticated: boolean; pending: number; timer: NodeJS.Timeout };
const randomId = () => randomBytes(16).toString('hex');

export class AgentHost {
  readonly appEpoch = randomId();
  endpoint = '';
  private readonly server: Server;
  private readonly budget = new ByteBudget();
  private readonly connections = new Set<Connection>();
  private readonly grants = new Map<string, Grant>();
  private readonly requests = new Set<AbortController>();
  private session?: AgentSessionDescriptor;
  private generation = 0;
  private closed = false;
  private directory?: string;
  private closing?: Promise<void>;
  constructor(private readonly options: AgentHostOptions) {
    this.server = createServer(socket => this.accept(socket));
    this.server.on('error', () => { if (this.endpoint) void this.close(); });
    this.server.on('close', () => { if (!this.closed) void this.close(); });
  }
  async start(): Promise<this> {
    if (this.endpoint || this.closed) throw new AgentAccessError('ACCESS_DENIED', 'Host cannot be restarted.');
    let listen: { host: string; port: number; exclusive: boolean } | { path: string };
    if (process.platform === 'win32') listen = { host: '127.0.0.1', port: 0, exclusive: true };
    else {
      const base = await realpath(os.tmpdir());
      this.directory = await mkdtemp(path.join(base, 'sd-'));
      await chmod(this.directory, 0o700);
      const stat = await lstat(this.directory);
      const socketPath = path.join(this.directory, 'agent.sock');
      if (stat.uid !== process.getuid?.() || stat.isSymbolicLink() || Buffer.byteLength(socketPath) > L.UNIX_SOCKET_MAX_PATH_BYTES) {
        await rm(this.directory, { recursive: true, force: true });
        throw new AgentAccessError('ACCESS_DENIED', 'Cannot create private local endpoint.');
      }
      listen = { path: socketPath };
    }
    try {
      await new Promise<void>((resolve, reject) => {
        const fail = (error: Error) => reject(error);
        this.server.once('error', fail);
        this.server.listen(listen, () => { this.server.off('error', fail); resolve(); });
      });
      const address = this.server.address();
      if (typeof address === 'string') { await chmod(address, 0o600); this.endpoint = `unix:${address}`; }
      else if (address?.address === '127.0.0.1' && address.family === 'IPv4') this.endpoint = `tcp:127.0.0.1:${address.port}`;
      else throw new AgentAccessError('ACCESS_DENIED', 'Listener bound to an invalid address.');
      return this;
    } catch (error) { await this.close(); throw error; }
  }
  private control(message: AgentControlMessage): Promise<AgentControlAck> {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new AgentAccessError('REQUEST_TIMEOUT', 'Application did not acknowledge access change.')), L.DEFAULT_CONTROL_TIMEOUT_MS);
      Promise.resolve().then(() => this.options.onControl(message)).then(ack => {
        if (!ack.ok || ack.controlId !== message.controlId || ack.sessionEpoch !== message.sessionEpoch || ack.documentId !== message.documentId || ack.webContentsGeneration !== message.webContentsGeneration) {
          throw new AgentAccessError('ACCESS_DENIED', 'Application rejected access change.');
        }
        if (message.type === 'install-grant' && (ack.grantId !== message.grant.grantId || ack.grantGeneration !== message.grant.grantGeneration)) throw new AgentAccessError('ACCESS_DENIED', 'Grant acknowledgment mismatch.');
        if (message.type === 'revoke-grant' && (ack.grantId !== message.grantId || ack.grantGeneration !== message.grantGeneration)) throw new AgentAccessError('ACCESS_DENIED', 'Revocation acknowledgment mismatch.');
        resolve(ack);
      }).catch(reject).finally(() => clearTimeout(timer));
    });
  }
  async registerSession(descriptor: AgentSessionDescriptor): Promise<AgentSessionDescriptor> {
    validateAgentId(descriptor.documentId, 'documentId');
    validateExpectedRevision(descriptor.sessionEpoch, 'sessionEpoch');
    validateExpectedRevision(descriptor.webContentsGeneration, 'webContentsGeneration');
    if (this.closed) throw new AgentAccessError('ACCESS_REVOKED', 'Host closed.');
    for (const grant of this.grants.values()) this.invalidate(grant);
    this.grants.clear();
    const session = { ...descriptor }; this.session = session;
    await this.control({ type: 'sync-session', controlId: randomId(), ...session });
    if (this.session !== session || this.closed) throw new AgentAccessError('SESSION_CHANGED', 'Document session changed.');
    return { ...session };
  }
  listGrants(): AgentGrantSummary[] { return Array.from(this.grants.values(), grant => ({ ...grant.summary })); }
  async issueGrant(permission: AgentPermission, label?: string): Promise<AgentIssuedGrant> {
    const session = this.session;
    if (!session || this.closed || !this.endpoint) throw new AgentAccessError('ACCESS_DENIED', 'No active document session.');
    if (permission !== 'read' && permission !== 'write') throw new AgentAccessError('VALIDATION_FAILED', 'Invalid permission.');
    if (label !== undefined && (typeof label !== 'string' || label.length > 120)) throw new AgentAccessError('VALIDATION_FAILED', 'Invalid grant label.');
    if (this.grants.size >= L.MAX_ACTIVE_GRANTS || this.generation === Number.MAX_SAFE_INTEGER) throw new AgentAccessError('BUSY', 'Grant limit reached.');
    const grantId = randomId();
    const grant: Grant = {
      summary: { grantId, grantGeneration: ++this.generation, actorId: `agent:${grantId}`, ...(label === undefined ? {} : { label }), documentId: session.documentId, sessionEpoch: session.sessionEpoch, permission, active: false, revoked: false, createdAt: Date.now() },
      capability: randomBytes(L.CAPABILITY_BYTES).toString('hex'), journal: new Map(),
    };
    this.grants.set(grantId, grant);
    try {
      await this.control({ type: 'install-grant', controlId: randomId(), ...session, grant: { ...grant.summary } });
      if (this.closed || this.session !== session || grant.summary.revoked) throw new AgentAccessError('SESSION_CHANGED', 'Document session changed.');
      grant.summary.active = true;
      return {
        grant: { ...grant.summary }, capability: grant.capability, appEpoch: this.appEpoch, endpoint: this.endpoint,
        env: { SKETCHDRAW_MCP_ENDPOINT: this.endpoint, SKETCHDRAW_MCP_CAPABILITY: grant.capability, SKETCHDRAW_MCP_GRANT_ID: grantId, SKETCHDRAW_MCP_APP_EPOCH: this.appEpoch, SKETCHDRAW_MCP_DOCUMENT_ID: session.documentId },
      };
    } catch (error) {
      this.invalidate(grant); this.grants.delete(grantId);
      void this.control({ type: 'revoke-grant', controlId: randomId(), ...session, grantId, grantGeneration: grant.summary.grantGeneration, reason: 'revoked' }).catch(() => {});
      throw error;
    }
  }
  revokeGrant(grantId: string): Promise<void> {
    const grant = this.grants.get(grantId), session = this.session;
    if (!grant || !session) return Promise.resolve();
    this.invalidate(grant); // Before the first asynchronous boundary.
    return this.control({ type: 'revoke-grant', controlId: randomId(), ...session, grantId, grantGeneration: grant.summary.grantGeneration, reason: 'revoked' })
      .then(() => { this.grants.delete(grantId); });
  }
  private invalidate(grant: Grant): void {
    grant.summary.active = false; grant.summary.revoked = true; grant.capability = ''; grant.journal.clear();
    for (const connection of this.connections) if (connection.grant === grant) connection.frames.destroy();
  }
  private allowed(grant: Grant, write = false): AgentSessionDescriptor {
    const session = this.session;
    if (this.closed || !grant.summary.active || grant.summary.revoked) throw new AgentAccessError('ACCESS_REVOKED', 'Access is no longer available.');
    if (!session || session.documentId !== grant.summary.documentId || session.sessionEpoch !== grant.summary.sessionEpoch) throw new AgentAccessError('SESSION_CHANGED', 'Document session changed.');
    if (write && grant.summary.permission !== 'write') throw new AgentAccessError('ACCESS_DENIED', 'This grant is read-only.');
    return session;
  }
  private accept(socket: Socket): void {
    if (this.closed || this.connections.size >= L.MAX_TOTAL_CONNECTIONS || [...this.connections].filter(c => !c.authenticated).length >= L.MAX_UNAUTHENTICATED_CONNECTIONS) { socket.destroy(); return; }
    const frames = new JsonFrames(socket, this.budget);
    const connection: Connection = { frames, authenticated: false, pending: 0, timer: setTimeout(() => frames.destroy(), L.AUTH_TIMEOUT_MS) };
    this.connections.add(connection);
    frames.onClose = () => { clearTimeout(connection.timer); this.connections.delete(connection); };
    let expectedMac: string | undefined;
    frames.onFrame = (raw, bytes) => {
      try {
        if (!connection.grant) {
          const hello = helloSchema.parse(raw), grant = this.grants.get(hello.grantId);
          if (!grant || hello.appEpoch !== this.appEpoch) throw new Error('Denied.');
          this.allowed(grant); connection.grant = grant;
          const serverNonce = randomBytes(32).toString('hex');
          expectedMac = authMac(grant.capability, AGENT_AUTH_LABELS.CLIENT, hello.grantId, hello.appEpoch, hello.clientNonce, serverNonce);
          frames.send({ type: 'auth-challenge', version: 1, serverNonce, serverMac: authMac(grant.capability, AGENT_AUTH_LABELS.SERVER, hello.grantId, hello.appEpoch, hello.clientNonce, serverNonce) });
        } else if (!connection.authenticated) {
          const verify = verifySchema.parse(raw);
          if (!expectedMac || !sameMac(verify.clientMac, expectedMac)) throw new Error('Denied.');
          const session = this.allowed(connection.grant); expectedMac = undefined;
          frames.send({ type: 'auth-ok', version: 1, documentId: session.documentId, sessionEpoch: session.sessionEpoch, grantGeneration: connection.grant.summary.grantGeneration, permission: connection.grant.summary.permission });
          frames.limit = L.POST_AUTH_FRAME_BYTES; connection.authenticated = true; clearTimeout(connection.timer);
        } else {
          const request = toolRequestSchema.parse(raw);
          if (connection.pending >= L.MAX_CLIENT_CONCURRENT_REQUESTS || this.requests.size >= L.MAX_IN_FLIGHT_REQUESTS) throw new AgentAccessError('BUSY', 'Request limit reached.');
          const release = this.budget.acquire(bytes); connection.pending++;
          const controller = new AbortController(); this.requests.add(controller);
          void Promise.resolve().then(() => this.execute(connection.grant!, request.operation, request.payload, controller.signal)).then(
            result => ({ type: 'tool-response', version: 1, requestId: request.requestId, operation: request.operation, ok: true, result }),
            error => ({ type: 'tool-response', version: 1, requestId: request.requestId, operation: request.operation, ok: false, error: mapDomainErrorToPayload(error) }),
          ).then(response => { try { frames.send(response); } catch { frames.destroy(); } })
            .finally(() => { release(); connection.pending--; this.requests.delete(controller); });
        }
      } catch { frames.destroy(); }
    };
  }
  private execute(grant: Grant, operation: AgentOperationName, raw: unknown, signal: AbortSignal): Promise<AgentOperationOutput> {
    const write = AGENT_WRITE_OPERATIONS.has(operation);
    const session = this.allowed(grant, write);
    const payload: AgentOperationInput = parseOperationInput(operation, raw);
    if (payload.documentId !== session.documentId) throw new AgentAccessError('DOCUMENT_MISMATCH', 'The grant belongs to a different document.');
    const mutation = 'commandId' in payload ? payload : undefined;
    const fingerprint = mutation ? createHash('sha256').update(canonicalizeMutationRequest({ operation, documentId: payload.documentId, expectedRevision: mutation.expectedRevision, canonicalPayload: payload })).digest('hex') : '';
    if (mutation) {
      const entry = grant.journal.get(mutation.commandId);
      if (entry) {
        if (entry.fingerprint !== fingerprint) throw new AgentAccessError('REQUEST_ID_REUSED', 'Command ID already has a different payload.');
        return entry.result.then(result => ({ ...result, deduplicated: true }));
      }
      if (grant.journal.size >= L.MAX_JOURNAL_ENTRIES_PER_GRANT) throw new AgentAccessError('JOURNAL_FULL', 'Create a new grant to continue.');
    }
    const request: AgentRendererRequest = {
      requestId: randomId(), operation, grantId: grant.summary.grantId, grantGeneration: grant.summary.grantGeneration,
      actorId: grant.summary.actorId, permission: grant.summary.permission, ...session,
      ...(mutation ? { commandId: mutation.commandId, expectedRevision: mutation.expectedRevision } : {}), payload,
    };
    // The microtask cannot run before its entry is reserved below.
    const result = Promise.resolve().then(async () => {
      this.allowed(grant, write);
      const response = await this.options.onRequest(request, signal);
      this.allowed(grant, write);
      if (this.session !== session || response.sessionEpoch !== session.sessionEpoch || response.documentId !== session.documentId || response.requestId !== request.requestId || response.operation !== operation) throw new AgentAccessError('SESSION_CHANGED', 'Application response does not match this session.');
      if (!response.ok) throw new AgentAccessError(response.error.code, response.error.message, response.error);
      const length = Buffer.byteLength(JSON.stringify(response.result));
      if (length > (write ? 64 * 1024 : L.POST_AUTH_FRAME_BYTES - 4096)) throw new AgentAccessError('REQUEST_TOO_LARGE', 'Application result exceeds the transport limit.');
      return response.result;
    });
    if (mutation) grant.journal.set(mutation.commandId, { fingerprint, result });
    return result;
  }
  close(): Promise<void> {
    if (this.closing) return this.closing;
    this.closed = true; this.session = undefined;
    for (const grant of this.grants.values()) this.invalidate(grant);
    this.grants.clear();
    for (const request of this.requests) request.abort();
    for (const connection of this.connections) connection.frames.destroy();
    this.closing = new Promise<void>(resolve => this.server.close(() => resolve()))
      .then(async () => { if (this.directory) await rm(this.directory, { recursive: true, force: true }); });
    return this.closing;
  }
}
export async function createAgentHost(options: AgentHostOptions): Promise<AgentHost> { return new AgentHost(options).start(); }

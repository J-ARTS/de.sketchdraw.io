import { randomBytes } from 'node:crypto';
import { createConnection } from 'node:net';
import { AGENT_AUTH_LABELS, AGENT_ACCESS_LIMITS as L, AGENT_WRITE_OPERATIONS, type AgentOperationName, type AgentOperationInput, type AgentOperationOutput, type AgentIssuedGrant } from '../agent-access/types';
import { AgentAccessError, isAgentAccessErrorPayload } from '../agent-access/errors';
import { authOkSchema, challengeSchema, hex16, hex32, idSchema, parseOperationInput } from '../agent-access/schema';
import { agentRuntimeFilePath, readAgentRuntimeAccess } from '../../electron/agent-access/runtime-access';
import { authMac, endpointOptions, sameMac } from '../../electron/agent-access/auth';
import { JsonFrames } from '../../electron/agent-access/frames';

export type AgentClientConfig = AgentIssuedGrant['env'];
export function clientConfigFromEnv(env: NodeJS.ProcessEnv): AgentClientConfig {
  const endpoint = env.SKETCHDRAW_MCP_ENDPOINT;
  if (!endpoint || endpoint.length > 256) throw new AgentAccessError('ACCESS_DENIED', 'Agent access has not been configured.');
  const capability = hex32.safeParse(env.SKETCHDRAW_MCP_CAPABILITY);
  const grantId = idSchema.safeParse(env.SKETCHDRAW_MCP_GRANT_ID);
  const appEpoch = hex16.safeParse(env.SKETCHDRAW_MCP_APP_EPOCH);
  const documentId = idSchema.safeParse(env.SKETCHDRAW_MCP_DOCUMENT_ID);
  if (!capability.success || !grantId.success || !appEpoch.success || !documentId.success) throw new AgentAccessError('ACCESS_DENIED', 'Agent access configuration is incomplete.');
  return { SKETCHDRAW_MCP_ENDPOINT: endpoint, SKETCHDRAW_MCP_CAPABILITY: capability.data, SKETCHDRAW_MCP_GRANT_ID: grantId.data, SKETCHDRAW_MCP_APP_EPOCH: appEpoch.data, SKETCHDRAW_MCP_DOCUMENT_ID: documentId.data };
}

export async function loadAgentClientConfig(
  env: NodeJS.ProcessEnv,
  preferRuntime = false,
): Promise<AgentClientConfig> {
  if (!preferRuntime && env.SKETCHDRAW_MCP_ENDPOINT) return clientConfigFromEnv(env);
  const runtime = await readAgentRuntimeAccess(agentRuntimeFilePath(env));
  if (runtime) return clientConfigFromEnv(runtime.grant);
  if (env.SKETCHDRAW_MCP_ENDPOINT) return clientConfigFromEnv(env);
  throw new AgentAccessError('ACCESS_DENIED', 'Sketchdraw Desktop has no open local document.');
}
type Pending = { resolve(value: AgentOperationOutput): void; reject(error: unknown): void; timer: NodeJS.Timeout; write: boolean; operation: AgentOperationName };
export class AgentClient {
  private readonly pending = new Map<string, Pending>();
  private closed = false;
  constructor(private readonly frames: JsonFrames, readonly documentId: string) {
    frames.limit = L.POST_AUTH_FRAME_BYTES;
    frames.onClose = () => {
      this.closed = true;
      for (const p of this.pending.values()) { clearTimeout(p.timer); p.reject(new AgentAccessError(p.write ? 'OUTCOME_UNKNOWN' : 'ACCESS_REVOKED', p.write ? 'Connection lost; a submitted change may have committed.' : 'Connection closed.')); }
      this.pending.clear();
    };
    frames.onFrame = value => {
      if (!value || typeof value !== 'object') { frames.destroy(); return; }
      const response = value as Record<string, unknown>;
      const p = typeof response.requestId === 'string' ? this.pending.get(response.requestId) : undefined;
      if (!p) return; // A bounded request may already have timed out.
      if (response.type !== 'tool-response' || response.version !== 1 || response.operation !== p.operation || typeof response.ok !== 'boolean') { frames.destroy(); return; }
      this.pending.delete(response.requestId as string); clearTimeout(p.timer);
      if (response.ok) {
        if (!response.result || typeof response.result !== 'object' || (response.result as Record<string, unknown>).documentId !== this.documentId) { p.reject(new AgentAccessError('SESSION_CHANGED', 'Response belongs to another document.')); frames.destroy(); }
        else p.resolve(response.result as AgentOperationOutput);
      } else if (isAgentAccessErrorPayload(response.error)) p.reject(new AgentAccessError(response.error.code, response.error.message, response.error));
      else { p.reject(new AgentAccessError('VALIDATION_FAILED', 'Invalid error response.')); frames.destroy(); }
    };
  }
  request(operation: AgentOperationName, input: AgentOperationInput, timeoutMs: number = L.DEFAULT_REQUEST_TIMEOUT_MS): Promise<AgentOperationOutput> {
    if (this.closed) return Promise.reject(new AgentAccessError('ACCESS_REVOKED', 'Connection closed.'));
    if (this.pending.size >= L.MAX_CLIENT_CONCURRENT_REQUESTS) return Promise.reject(new AgentAccessError('BUSY', 'Client request limit reached.'));
    const payload = parseOperationInput(operation, input);
    if (payload.documentId !== this.documentId) return Promise.reject(new AgentAccessError('DOCUMENT_MISMATCH', 'Grant belongs to a different document.'));
    const requestId = randomBytes(16).toString('hex');
    const write = AGENT_WRITE_OPERATIONS.has(operation);
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(requestId);
        reject(new AgentAccessError(write ? 'OUTCOME_UNKNOWN' : 'REQUEST_TIMEOUT', write ? 'No reply; do not retry this change with a new command ID.' : 'Application response timed out.'));
      }, Math.max(1, Math.min(timeoutMs, 60_000)));
      this.pending.set(requestId, { resolve, reject, timer, write, operation });
      try { this.frames.send({ type: 'tool-request', version: 1, requestId, operation, payload }); }
      catch { clearTimeout(timer); this.pending.delete(requestId); reject(new AgentAccessError('REQUEST_TOO_LARGE', 'Cannot send request within the transport budget.')); }
    });
  }
  close(): void { this.closed = true; this.frames.destroy(); }
}
export async function connectAgent(configInput: AgentClientConfig): Promise<AgentClient> {
  const config = clientConfigFromEnv(configInput);
  const options = await endpointOptions(config.SKETCHDRAW_MCP_ENDPOINT).catch(() => { throw new AgentAccessError('ACCESS_DENIED', 'Local endpoint is unavailable.'); });
  const frames = new JsonFrames(createConnection(options));
  return new Promise((resolve, reject) => {
    let challenged = false, done = false;
    const timer = setTimeout(() => fail(), L.AUTH_TIMEOUT_MS);
    const fail = () => { if (!done) { done = true; clearTimeout(timer); frames.destroy(); reject(new AgentAccessError('ACCESS_DENIED', 'Local authentication failed.')); } };
    const clientNonce = randomBytes(32).toString('hex');
    frames.onClose = fail;
    frames.socket.once('connect', () => {
      try { frames.send({ type: 'auth-hello', version: 1, grantId: config.SKETCHDRAW_MCP_GRANT_ID, appEpoch: config.SKETCHDRAW_MCP_APP_EPOCH, clientNonce }); } catch { fail(); }
    });
    frames.onFrame = raw => {
      try {
        if (!challenged) {
          const challenge = challengeSchema.parse(raw);
          const args = [config.SKETCHDRAW_MCP_GRANT_ID, config.SKETCHDRAW_MCP_APP_EPOCH, clientNonce, challenge.serverNonce] as const;
          if (!sameMac(challenge.serverMac, authMac(config.SKETCHDRAW_MCP_CAPABILITY, AGENT_AUTH_LABELS.SERVER, ...args))) { fail(); return; }
          frames.send({ type: 'auth-verify', version: 1, clientMac: authMac(config.SKETCHDRAW_MCP_CAPABILITY, AGENT_AUTH_LABELS.CLIENT, ...args) });
          challenged = true;
        } else {
          const ok = authOkSchema.parse(raw);
          if (ok.documentId !== config.SKETCHDRAW_MCP_DOCUMENT_ID) { fail(); return; }
          done = true; clearTimeout(timer); resolve(new AgentClient(frames, ok.documentId));
        }
      } catch { fail(); }
    };
  });
}

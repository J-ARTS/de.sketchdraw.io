import { app, ipcMain, type BrowserWindow, type IpcMainInvokeEvent } from 'electron';
import path from 'node:path';
import { z } from 'zod';
import { AgentAccessError } from '../../src/agent-access/errors';
import { idSchema } from '../../src/agent-access/schema';
import { AGENT_ACCESS_LIMITS as L, type AgentControlAck, type AgentControlMessage, type AgentRendererRequest, type AgentRendererResponse } from '../../src/agent-access/types';
import { validateIpcSender, type IpcSecurityContext, type IpcSenderEventLike } from '../security';
import { createAgentHost, type AgentHost } from './host';
import { AGENT_IPC } from './ipc';

type Reply = AgentControlAck | AgentRendererResponse;
interface Pending { kind: 'control' | 'request'; generation: number; resolve(value: Reply): void; reject(error: unknown): void; timer: NodeJS.Timeout; cleanup(): void }
export function installElectronAgentBridge(window: BrowserWindow, context: () => IpcSecurityContext): () => void {
  let generation = 0, disposed = false;
  let hostPromise: Promise<AgentHost> | undefined;
  const pending = new Map<string, Pending>();
  const authorized = (event: IpcMainInvokeEvent) => {
    if (disposed || !validateIpcSender(event as unknown as IpcSenderEventLike, context()).ok) throw new Error('Unauthorized agent IPC sender.');
  };
  function invalidate(): void {
    generation++;
    for (const entry of pending.values()) { clearTimeout(entry.timer); entry.cleanup(); entry.reject(new AgentAccessError('SESSION_CHANGED', 'Application session changed.')); }
    pending.clear();
    const old = hostPromise; hostPromise = undefined;
    void old?.then(host => host.close()).catch(() => {});
  }
  function send(kind: 'control' | 'request', value: AgentControlMessage | AgentRendererRequest, epoch: number, signal?: AbortSignal): Promise<Reply> {
    if (epoch !== generation || disposed || window.isDestroyed() || signal?.aborted) return Promise.reject(new AgentAccessError('SESSION_CHANGED', 'Application session changed.'));
    if (pending.size >= 24) return Promise.reject(new AgentAccessError('BUSY', 'Application request limit reached.'));
    const id = 'controlId' in value ? value.controlId : value.requestId;
    return new Promise((resolve, reject) => {
      const finish = (error: AgentAccessError) => { const entry = pending.get(id); if (entry) { pending.delete(id); clearTimeout(entry.timer); entry.cleanup(); reject(error); } };
      const abort = () => finish(new AgentAccessError('OUTCOME_UNKNOWN', 'Request stopped; a submitted change may have committed.'));
      const timer = setTimeout(() => finish(new AgentAccessError(kind === 'request' ? 'OUTCOME_UNKNOWN' : 'REQUEST_TIMEOUT', 'Application acknowledgment timed out.')), kind === 'request' ? L.DEFAULT_REQUEST_TIMEOUT_MS : L.DEFAULT_CONTROL_TIMEOUT_MS);
      const cleanup = () => signal?.removeEventListener('abort', abort);
      pending.set(id, { kind, generation: epoch, resolve, reject, timer, cleanup });
      signal?.addEventListener('abort', abort, { once: true });
      try { window.webContents.send(kind === 'control' ? AGENT_IPC.CONTROL : AGENT_IPC.REQUEST, value); }
      catch { finish(new AgentAccessError('SESSION_CHANGED', 'Application is unavailable.')); }
    });
  }
  function getHost(): Promise<AgentHost> {
    if (disposed) return Promise.reject(new AgentAccessError('ACCESS_REVOKED', 'Application closed.'));
    if (!hostPromise) {
      const epoch = generation;
      hostPromise = createAgentHost({
        onControl: message => send('control', message, epoch) as Promise<AgentControlAck>,
        onRequest: (request, signal) => send('request', request, epoch, signal) as Promise<AgentRendererResponse>,
      }).then(async host => { if (epoch !== generation || disposed) { await host.close(); throw new AgentAccessError('SESSION_CHANGED', 'Application changed.'); } return host; });
    }
    return hostPromise;
  }
  const registerSchema = z.strictObject({ documentId: idSchema, sessionEpoch: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER) });
  ipcMain.handle(AGENT_IPC.REGISTER, async (event, raw: unknown) => {
    authorized(event); const value = registerSchema.parse(raw);
    return (await getHost()).registerSession({ ...value, webContentsGeneration: generation });
  });
  ipcMain.handle(AGENT_IPC.LIST, async event => { authorized(event); return hostPromise ? (await hostPromise).listGrants() : []; });
  ipcMain.handle(AGENT_IPC.CREATE, async (event, raw: unknown) => {
    authorized(event);
    const value = z.strictObject({ permission: z.enum(['read', 'write']), label: z.string().max(120).optional(), userInitiated: z.literal(true) }).parse(raw);
    const issued = await (await getHost()).issueGrant(value.permission, value.label);
    return { ...issued, clientConfiguration: { command: process.execPath, args: [path.join(app.getAppPath(), 'dist-mcp/server.cjs')], env: { ...issued.env, ELECTRON_RUN_AS_NODE: '1' } } };
  });
  ipcMain.handle(AGENT_IPC.REVOKE, async (event, raw: unknown) => { authorized(event); const value = z.strictObject({ grantId: idSchema }).parse(raw); if (hostPromise) await (await hostPromise).revokeGrant(value.grantId); });
  ipcMain.handle(AGENT_IPC.REPLY, (event, raw: unknown) => {
    authorized(event);
    if (!raw || typeof raw !== 'object') throw new Error('Invalid agent response.');
    const body = raw as Record<string, unknown>, response = body.response as Record<string, unknown> | undefined;
    if ((body.kind !== 'control' && body.kind !== 'request') || !response || typeof response !== 'object') throw new Error('Invalid agent response.');
    const id = body.kind === 'control' ? response.controlId : response.requestId;
    if (typeof id !== 'string') throw new Error('Invalid response ID.');
    const entry = pending.get(id);
    if (!entry || entry.kind !== body.kind || entry.generation !== generation) throw new Error('Stale agent response.');
    if (Buffer.byteLength(JSON.stringify(response)) > L.POST_AUTH_FRAME_BYTES) throw new Error('Agent response is too large.');
    pending.delete(id); clearTimeout(entry.timer); entry.cleanup(); entry.resolve(response as unknown as Reply);
  });
  const navigate = (_event: unknown, _url: string, sameDocument: boolean, mainFrame: boolean) => { if (mainFrame && !sameDocument) invalidate(); };
  window.webContents.on('did-start-navigation', navigate);
  window.webContents.on('render-process-gone', invalidate);
  const dispose = () => {
    if (disposed) return; disposed = true; invalidate();
    for (const channel of [AGENT_IPC.REGISTER, AGENT_IPC.LIST, AGENT_IPC.CREATE, AGENT_IPC.REVOKE, AGENT_IPC.REPLY]) ipcMain.removeHandler(channel);
    if (!window.webContents.isDestroyed()) { window.webContents.off('did-start-navigation', navigate); window.webContents.off('render-process-gone', invalidate); }
  };
  window.once('closed', dispose);
  return dispose;
}

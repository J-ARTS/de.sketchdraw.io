import { app, ipcMain, type BrowserWindow, type IpcMainInvokeEvent } from 'electron';
import path from 'node:path';
import { z } from 'zod';
import { AgentAccessError } from '../../src/agent-access/errors';
import { idSchema } from '../../src/agent-access/schema';
import { agentRuntimeFilePath, clearAgentRuntimeAccess, writeAgentRuntimeAccess } from './runtime-access';
import { AGENT_ACCESS_LIMITS as L, type AgentControlAck, type AgentControlMessage, type AgentRendererRequest, type AgentRendererResponse } from '../../src/agent-access/types';
import { validateIpcSender, type IpcSecurityContext, type IpcSenderEventLike } from '../security';
import { createAgentHost, type AgentHost } from './host';
import { AGENT_IPC } from './ipc';

type Reply = AgentControlAck | AgentRendererResponse;
interface Pending { kind: 'control' | 'request'; generation: number; resolve(value: Reply): void; reject(error: unknown): void; timer: NodeJS.Timeout; cleanup(): void }
export function installElectronAgentBridge(window: BrowserWindow, context: () => IpcSecurityContext): () => void {
  // BrowserWindow.webContents throws after the native window has been destroyed.
  // Keep the WebContents wrapper captured while both objects are still alive so the
  // closed-event cleanup can inspect its lifecycle without dereferencing BrowserWindow.
  const contents = window.webContents;
  let generation = 0, disposed = false;
  let hostPromise: Promise<AgentHost> | undefined;
  let lifecycle: Promise<void> = Promise.resolve();
  let active: { documentId: string; sessionEpoch: number; grantId: string; appEpoch: string } | undefined;
  const runtimeFile = agentRuntimeFilePath();
  const pending = new Map<string, Pending>();
  const authorized = (event: IpcMainInvokeEvent) => {
    if (disposed || !validateIpcSender(event as unknown as IpcSenderEventLike, context()).ok) throw new Error('Unauthorized agent IPC sender.');
  };
  function invalidate(): void {
    generation++;
    for (const entry of pending.values()) { clearTimeout(entry.timer); entry.cleanup(); entry.reject(new AgentAccessError('SESSION_CHANGED', 'Application session changed.')); }
    pending.clear();
    const previous = active; active = undefined;
    if (previous) void clearAgentRuntimeAccess(runtimeFile, previous).catch(() => {});
    const old = hostPromise; hostPromise = undefined;
    void old?.then(host => host.close()).catch(() => {});
  }
  function serialize<T>(task: () => Promise<T>): Promise<T> {
    const run = lifecycle.then(task, task);
    lifecycle = run.then(() => {}, () => {});
    return run;
  }
  function send(kind: 'control' | 'request', value: AgentControlMessage | AgentRendererRequest, epoch: number, signal?: AbortSignal): Promise<Reply> {
    if (epoch !== generation || disposed || contents.isDestroyed() || signal?.aborted) return Promise.reject(new AgentAccessError('SESSION_CHANGED', 'Application session changed.'));
    if (pending.size >= 24) return Promise.reject(new AgentAccessError('BUSY', 'Application request limit reached.'));
    const id = 'controlId' in value ? value.controlId : value.requestId;
    return new Promise((resolve, reject) => {
      const finish = (error: AgentAccessError) => { const entry = pending.get(id); if (entry) { pending.delete(id); clearTimeout(entry.timer); entry.cleanup(); reject(error); } };
      const abort = () => finish(new AgentAccessError('OUTCOME_UNKNOWN', 'Request stopped; a submitted change may have committed.'));
      const timer = setTimeout(() => finish(new AgentAccessError(kind === 'request' ? 'OUTCOME_UNKNOWN' : 'REQUEST_TIMEOUT', 'Application acknowledgment timed out.')), kind === 'request' ? L.DEFAULT_REQUEST_TIMEOUT_MS : L.DEFAULT_CONTROL_TIMEOUT_MS);
      const cleanup = () => signal?.removeEventListener('abort', abort);
      pending.set(id, { kind, generation: epoch, resolve, reject, timer, cleanup });
      signal?.addEventListener('abort', abort, { once: true });
      try { contents.send(kind === 'control' ? AGENT_IPC.CONTROL : AGENT_IPC.REQUEST, value); }
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
    return serialize(async () => {
      const epoch = generation;
      const previous = active; active = undefined;
      if (previous) await clearAgentRuntimeAccess(runtimeFile, previous);
      const host = await getHost();
      const descriptor = await host.registerSession({ ...value, webContentsGeneration: epoch });
      const issued = await host.issueGrant('write', 'Automatic local agent access');
      try {
        await writeAgentRuntimeAccess(runtimeFile, issued.env, {
          command: process.execPath,
          args: [path.join(app.getAppPath(), 'dist-mcp/server.cjs')],
          env: { ELECTRON_RUN_AS_NODE: '1', SKETCHDRAW_MCP_RUNTIME_FILE: runtimeFile },
        });
        if (disposed || epoch !== generation) throw new AgentAccessError('SESSION_CHANGED', 'Application session changed.');
        active = { documentId: descriptor.documentId, sessionEpoch: descriptor.sessionEpoch, grantId: issued.grant.grantId, appEpoch: issued.appEpoch };
        return descriptor;
      } catch (error) {
        await clearAgentRuntimeAccess(runtimeFile, { grantId: issued.grant.grantId, appEpoch: issued.appEpoch }).catch(() => {});
        await host.revokeGrant(issued.grant.grantId).catch(() => {});
        throw error;
      }
    });
  });
  ipcMain.handle(AGENT_IPC.UNREGISTER, async (event, raw: unknown) => {
    authorized(event); const value = registerSchema.parse(raw);
    await serialize(async () => {
      const current = active;
      if (!current || current.documentId !== value.documentId || current.sessionEpoch !== value.sessionEpoch) return;
      active = undefined;
      await clearAgentRuntimeAccess(runtimeFile, current);
      invalidate();
    });
  });
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
  contents.on('did-start-navigation', navigate);
  contents.on('render-process-gone', invalidate);
  const dispose = () => {
    if (disposed) return; disposed = true; invalidate();
    for (const channel of [AGENT_IPC.REGISTER, AGENT_IPC.UNREGISTER, AGENT_IPC.REPLY]) ipcMain.removeHandler(channel);
    if (!contents.isDestroyed()) { contents.off('did-start-navigation', navigate); contents.off('render-process-gone', invalidate); }
  };
  window.once('closed', dispose);
  return dispose;
}

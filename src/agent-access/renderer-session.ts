import type { DocumentAuthority } from '../session';
import { AgentAccessError } from './errors';
import { createRendererAgentHandler, type RendererAgentHandler } from './renderer-handler';
import type { AgentControlAck, AgentGrantSummary, AgentIssuedGrant, AgentPermission, SketchdrawAgentAccessBridge } from './types';

let nextSessionEpoch = 0;
export interface RendererAgentSession {
  readonly ready: Promise<void>;
  listGrants(): Promise<AgentGrantSummary[]>;
  createGrant(permission: AgentPermission, label?: string): Promise<AgentIssuedGrant>;
  revokeGrant(grantId: string): Promise<void>;
  dispose(): void;
}

/** Attach once per authority, including when a document with the same ID is reopened. */
export function attachRendererAgentSession(authority: DocumentAuthority, bridge: SketchdrawAgentAccessBridge): RendererAgentSession {
  if (!bridge.isAvailable || nextSessionEpoch >= Number.MAX_SAFE_INTEGER) throw new AgentAccessError('ACCESS_DENIED', 'Agent access is unavailable.');
  const sessionEpoch = ++nextSessionEpoch;
  const documentId = authority.session.documentId;
  let disposed = false, handler: RendererAgentHandler | undefined, generation: number | undefined;
  const issuedIds = new Set<string>();
  const check = () => { if (disposed || !handler) throw new AgentAccessError('SESSION_CHANGED', 'Document session changed.'); };
  // Main supplies its webContents generation in the first authenticated control.
  // Install listeners before registration so the synchronization acknowledgment can flow.
  const offControl = bridge.onControl(message => {
    const rejected: AgentControlAck = { controlId: message.controlId, documentId, sessionEpoch, webContentsGeneration: message.webContentsGeneration, ok: false, error: { code: 'SESSION_CHANGED', message: 'Document session changed.' } };
    if (disposed || message.documentId !== documentId || message.sessionEpoch !== sessionEpoch) return rejected;
    if (!handler) {
      if (message.type !== 'sync-session' || !Number.isSafeInteger(message.webContentsGeneration) || message.webContentsGeneration < 0) return rejected;
      generation = message.webContentsGeneration;
      handler = createRendererAgentHandler(authority, { documentId, sessionEpoch, webContentsGeneration: generation });
    }
    return handler.handleControl(message);
  });
  const offRequest = bridge.onRequest(async request => {
    if (!disposed && handler) return handler.handleRequest(request);
    return { requestId: request.requestId, operation: request.operation, documentId, sessionEpoch, ok: false, error: { code: 'SESSION_CHANGED', message: 'Document session changed.' } };
  });
  const ready = bridge.registerSession({ documentId, sessionEpoch }).then(descriptor => {
    check();
    if (descriptor.documentId !== documentId || descriptor.sessionEpoch !== sessionEpoch || descriptor.webContentsGeneration !== generation) throw new AgentAccessError('SESSION_CHANGED', 'Application acknowledgment does not match.');
  }).catch(error => { dispose(); throw error; });
  function dispose(): void {
    if (disposed) return;
    disposed = true;
    try { handler?.dispose(); }
    finally {
      offRequest(); offControl();
      for (const id of issuedIds) void bridge.revokeGrant(id).catch(() => {});
      issuedIds.clear();
    }
  }
  return {
    ready,
    async listGrants() { await ready; check(); const grants = await bridge.listGrants(); check(); return grants.filter(grant => grant.documentId === documentId && grant.sessionEpoch === sessionEpoch); },
    async createGrant(permission, label) {
      await ready; check();
      const issued = await bridge.createGrant(permission, label);
      if (disposed || issued.grant.documentId !== documentId || issued.grant.sessionEpoch !== sessionEpoch) {
        handler?.revokeLocal(issued.grant.grantId);
        await bridge.revokeGrant(issued.grant.grantId).catch(() => {});
        throw new AgentAccessError('SESSION_CHANGED', 'Document changed while creating the grant.');
      }
      issuedIds.add(issued.grant.grantId);
      return issued;
    },
    async revokeGrant(id) {
      // Revoke synchronously before any IPC wait; queued authority writes lose access.
      handler?.revokeLocal(id);
      await bridge.revokeGrant(id);
      issuedIds.delete(id);
    },
    dispose,
  };
}

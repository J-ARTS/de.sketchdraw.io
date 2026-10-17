import { ipcRenderer, type IpcRendererEvent } from 'electron';
import type { AgentControlMessage, AgentRendererRequest, SketchdrawAgentAccessBridge } from '../../src/agent-access/types';
import { AGENT_IPC } from './ipc';
export function createAgentAccessPreload(hasUserGesture: () => boolean): SketchdrawAgentAccessBridge {
  let requestListener: ((_event: IpcRendererEvent, request: AgentRendererRequest) => void) | undefined;
  let controlListener: ((_event: IpcRendererEvent, message: AgentControlMessage) => void) | undefined;
  return Object.freeze({
    isAvailable: true,
    registerSession: (value: { documentId: string; sessionEpoch: number }) => ipcRenderer.invoke(AGENT_IPC.REGISTER, value),
    listGrants: () => ipcRenderer.invoke(AGENT_IPC.LIST),
    createGrant: (permission: 'read' | 'write', label?: string) => {
      if (!hasUserGesture()) return Promise.reject(new Error('Agent access requires a human interaction.'));
      return ipcRenderer.invoke(AGENT_IPC.CREATE, { permission, label, userInitiated: true });
    },
    revokeGrant: (grantId: string) => ipcRenderer.invoke(AGENT_IPC.REVOKE, { grantId }),
    onRequest(handler: (request: AgentRendererRequest) => Promise<import('../../src/agent-access/types').AgentRendererResponse>) {
      if (typeof handler !== 'function') throw new Error('Agent handler must be a function.');
      if (requestListener) ipcRenderer.removeListener(AGENT_IPC.REQUEST, requestListener);
      const listener = (_event: IpcRendererEvent, request: AgentRendererRequest) => {
        void Promise.resolve().then(() => handler(request)).then(response => ipcRenderer.invoke(AGENT_IPC.REPLY, { kind: 'request', response })).catch(() => {});
      };
      requestListener = listener; ipcRenderer.on(AGENT_IPC.REQUEST, listener);
      return () => { ipcRenderer.removeListener(AGENT_IPC.REQUEST, listener); if (requestListener === listener) requestListener = undefined; };
    },
    onControl(handler: (message: AgentControlMessage) => Promise<import('../../src/agent-access/types').AgentControlAck> | import('../../src/agent-access/types').AgentControlAck) {
      if (typeof handler !== 'function') throw new Error('Agent handler must be a function.');
      if (controlListener) ipcRenderer.removeListener(AGENT_IPC.CONTROL, controlListener);
      const listener = (_event: IpcRendererEvent, message: AgentControlMessage) => {
        void Promise.resolve().then(() => handler(message)).then(response => ipcRenderer.invoke(AGENT_IPC.REPLY, { kind: 'control', response })).catch(() => {});
      };
      controlListener = listener; ipcRenderer.on(AGENT_IPC.CONTROL, listener);
      return () => { ipcRenderer.removeListener(AGENT_IPC.CONTROL, listener); if (controlListener === listener) controlListener = undefined; };
    },
  });
}

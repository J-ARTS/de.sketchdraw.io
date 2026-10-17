/** Fixed channels: never exposed as a generic IPC API. Browser-safe imports only. */
export const AGENT_IPC = Object.freeze({
  REGISTER: 'sketchdraw-agent:register', LIST: 'sketchdraw-agent:list',
  CREATE: 'sketchdraw-agent:create', REVOKE: 'sketchdraw-agent:revoke',
  REQUEST: 'sketchdraw-agent:request', CONTROL: 'sketchdraw-agent:control',
  REPLY: 'sketchdraw-agent:reply',
});

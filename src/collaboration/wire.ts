import type { PeerSessionKey, WriteOutcome } from '../session';
import { fail, shape, sessionKey, hex, integer, id, record, parse, LIMIT } from './primitives';
export interface Wire { version: 1; type: string; session: PeerSessionKey; connectionId: string; [key: string]: unknown }
export interface Manifest {
  transferId: string; purpose: 'snapshot' | 'command'; bytes: number; hash: string;
  chunkSize: number; chunks: number; revision: number | null; previousHash: string | null; requestId: string | null;
}
const fields: Record<string, string[]> = {
  'pair-confirm': ['transcriptHash'], grant: ['peerKeyHash', 'role', 'scopes'],
  'register-agent-scope': ['grantRef'], 'actor-scope': ['grantRef', 'scope', 'code'],
  proposal: ['scopeId', 'clientSequence', 'requestId', 'expectedRevision', 'kind', 'commandTransferId', 'commandHash', 'digest'],
  result: ['requestId', 'digest', 'outcome'], outcome: ['requestId', 'digest', 'outcome'],
  commit: ['previousRevision', 'revision', 'previousHash', 'hash', 'actorId', 'requestId', 'kind', 'transferId'],
  history: ['scopeId', 'revision', 'availability'], 'query-outcome': ['scopeId', 'requestId', 'digest'],
  resume: ['revision', 'hash', 'nonce'], checkpoint: ['revision', 'hash', 'nonce', 'transferId'],
  'transfer-manifest': ['manifest'], 'transfer-ready': ['transferId'], 'transfer-abort': ['transferId'],
  applied: ['revision', 'hash'], ping: ['nonce'], pong: ['nonce'], 'session-ended': ['reason'],
};
const errorCodes = new Set(['ACCESS_DENIED', 'ACCESS_REVOKED', 'SESSION_CHANGED', 'DOCUMENT_MISMATCH', 'REVISION_CONFLICT',
  'HISTORY_EMPTY', 'HISTORY_CONFLICT', 'VALIDATION_FAILED', 'REQUEST_TOO_LARGE', 'BUSY', 'TRANSITION_PENDING', 'NOT_CONNECTED',
  'PEER_NOT_READY', 'SEQUENCE_GAP', 'REQUEST_ID_REUSED', 'REQUEST_TIMEOUT', 'PROTOCOL_ERROR', 'AUTHORITY_DIVERGED', 'INTERNAL_ERROR']);
export function requestId(value: unknown): value is string {
  if (typeof value !== 'string' || !/^[a-f0-9]{32}:[1-9][0-9]{0,15}$/.test(value)) return false;
  return Number.isSafeInteger(Number(value.slice(33)));
}
export function validateOutcome(value: unknown): asserts value is WriteOutcome | { status: 'pending'; requestId: string } | { status: 'not-seen' } {
  if (!record(value)) fail();
  switch (value.status) {
    case 'not-seen': shape(value, ['status']); return;
    case 'pending': case 'outcome-unknown': shape(value, ['status', 'requestId']); break;
    case 'committed': case 'no-op': shape(value, ['status', 'requestId', 'revision']); if (!integer(value.revision)) fail(); break;
    case 'rejected':
      shape(value, ['status', 'requestId', 'code', 'accepted', ...('currentRevision' in value ? ['currentRevision'] : [])]);
      if (!errorCodes.has(value.code as string) || typeof value.accepted !== 'boolean'
        || ('currentRevision' in value && !integer(value.currentRevision))) fail(); break;
    default: fail();
  }
  if (!requestId(value.requestId)) fail();
}
export function manifest(value: unknown): asserts value is Manifest {
  shape(value, ['transferId', 'purpose', 'bytes', 'hash', 'chunkSize', 'chunks', 'revision', 'previousHash', 'requestId']);
  if (!hex(value.transferId) || !['snapshot', 'command'].includes(value.purpose as string)
    || !integer(value.bytes) || value.bytes < 1 || value.bytes > (value.purpose === 'snapshot' ? LIMIT.snapshot : LIMIT.command)
    || !hex(value.hash, 32) || !integer(value.chunkSize) || value.chunkSize < 1 || value.chunkSize > LIMIT.frame - 32
    || !integer(value.chunks) || value.chunks !== Math.ceil(value.bytes / value.chunkSize) || value.chunks > 65536
    || (value.revision !== null && !integer(value.revision)) || (value.previousHash !== null && !hex(value.previousHash, 32))
    || (value.requestId !== null && !requestId(value.requestId))) fail();
  if (value.purpose === 'snapshot' && value.revision === null) fail();
}
export function wire(payload: string): Wire {
  const value = parse(payload, LIMIT.frame);
  if (!record(value) || typeof value.type !== 'string' || !Object.hasOwn(fields, value.type)) fail();
  shape(value, ['version', 'type', 'session', 'connectionId', ...fields[value.type]!]);
  if (value.version !== 1 || !hex(value.connectionId)) fail(); sessionKey(value.session);
  const hashFields = ['transcriptHash', 'peerKeyHash', 'digest', 'previousHash', 'hash'];
  for (const key of hashFields) if (key in value && !(key === 'hash' && value.type === 'resume' && value[key] === null) && !hex(value[key], 32)) fail();
  for (const key of ['scopeId', 'transferId', 'nonce']) if (key in value && !(key === 'transferId' && value.type === 'checkpoint' && value[key] === null) && !hex(value[key])) fail();
  for (const key of ['revision', 'previousRevision', 'expectedRevision', 'clientSequence']) {
    if (key in value && !(key === 'revision' && value.type === 'resume' && value[key] === null) && !integer(value[key])) fail();
  }
  if ('requestId' in value && !requestId(value.requestId)) fail();
  if ('kind' in value && !['dispatch', 'undo', 'redo'].includes(value.kind as string)) fail();
  switch (value.type) {
    case 'grant':
      if (!['editor', 'viewer'].includes(value.role as string) || !Array.isArray(value.scopes) || value.scopes.length < 1 || value.scopes.length > 8) fail();
      for (const scope of value.scopes) {
        shape(scope, ['scopeId', 'actorId', 'kind']);
        if (!hex(scope.scopeId) || !id(scope.actorId) || !['human', 'agent'].includes(scope.kind as string)) fail();
      }
      if (new Set(value.scopes.map(scope => scope.scopeId)).size !== value.scopes.length) fail(); break;
    case 'proposal':
      if ((value.requestId as string).slice(0, 32) !== value.scopeId || Number((value.requestId as string).slice(33)) !== value.clientSequence) fail();
      if (value.kind === 'dispatch' ? !hex(value.commandTransferId) || !hex(value.commandHash, 32)
        : value.commandTransferId !== null || value.commandHash !== null) fail(); break;
    case 'commit':
      if (!id(value.actorId) || !integer(value.previousRevision) || !integer(value.revision)
        || value.revision !== value.previousRevision + 1 || !hex(value.hash, 32) || !hex(value.previousHash, 32)) fail(); break;
    case 'resume':
      if (value.revision === null ? value.hash !== null : !integer(value.revision) || !hex(value.hash, 32)) fail(); break;
    case 'checkpoint': case 'applied': if (!integer(value.revision) || !hex(value.hash, 32)) fail(); break;
    case 'history':
      if (!record(value.availability)) fail();
      shape(value.availability, ['canUndo', 'canRedo', ...('undoConflict' in value.availability ? ['undoConflict'] : []), ...('redoConflict' in value.availability ? ['redoConflict'] : [])]);
      if (typeof value.availability.canUndo !== 'boolean' || typeof value.availability.canRedo !== 'boolean') fail();
      for (const key of ['undoConflict', 'redoConflict']) if (key in value.availability && (typeof value.availability[key] !== 'string' || value.availability[key].length > 4096)) fail(); break;
    case 'result': case 'outcome':
      validateOutcome(value.outcome);
      if (value.outcome.status !== 'not-seen' && value.outcome.requestId !== value.requestId) fail(); break;
    case 'transfer-manifest': manifest(value.manifest); break;
    case 'session-ended': if (!['closed', 'revoked', 'technical'].includes(value.reason as string)) fail(); break;
    case 'register-agent-scope': if (!id(value.grantRef)) fail(); break;
    case 'actor-scope': if (!id(value.grantRef) || value.scope !== null || value.code !== 'ACCESS_DENIED') fail(); break;
  }
  return value as Wire;
}

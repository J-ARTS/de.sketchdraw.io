export type WriteErrorCode =
  | 'ACCESS_DENIED' | 'ACCESS_REVOKED' | 'SESSION_CHANGED' | 'DOCUMENT_MISMATCH'
  | 'REVISION_CONFLICT' | 'HISTORY_EMPTY' | 'HISTORY_CONFLICT' | 'VALIDATION_FAILED'
  | 'REQUEST_TOO_LARGE' | 'BUSY' | 'TRANSITION_PENDING' | 'NOT_CONNECTED'
  | 'PEER_NOT_READY' | 'SEQUENCE_GAP' | 'REQUEST_ID_REUSED' | 'REQUEST_TIMEOUT'
  | 'PROTOCOL_ERROR' | 'AUTHORITY_DIVERGED' | 'INTERNAL_ERROR';
export class SessionAccessError extends Error {
  readonly code: WriteErrorCode;

  constructor(code: WriteErrorCode) {
    super(code);
    this.name = 'SessionAccessError';
    this.code = code;
  }
}

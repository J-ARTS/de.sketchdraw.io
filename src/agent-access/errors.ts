import { DomainConflictError, DomainValidationError } from '../domain/errors';
import type { ParseDiagnostic, ValidationIssue } from '../domain/types';
import type { AgentAccessErrorCode, AgentAccessErrorPayload } from './types';

const VALID_ERROR_CODES: ReadonlySet<AgentAccessErrorCode> = new Set<AgentAccessErrorCode>([
  'ACCESS_DENIED',
  'ACCESS_REVOKED',
  'DOCUMENT_MISMATCH',
  'SESSION_CHANGED',
  'REVISION_CONFLICT',
  'VALIDATION_FAILED',
  'REQUEST_TOO_LARGE',
  'BUSY',
  'REQUEST_TIMEOUT',
  'OUTCOME_UNKNOWN',
  'JOURNAL_FULL',
  'REQUEST_ID_REUSED',
]);

export interface AgentAccessErrorOptions {
  currentRevision?: number;
  issues?: ValidationIssue[];
  diagnostics?: ParseDiagnostic[];
  retryable?: boolean;
}

export class AgentAccessError extends Error {
  readonly code: AgentAccessErrorCode;
  readonly currentRevision?: number;
  readonly issues?: ValidationIssue[];
  readonly diagnostics?: ParseDiagnostic[];
  readonly retryable: boolean;

  constructor(
    code: AgentAccessErrorCode,
    message: string,
    options?: AgentAccessErrorOptions,
  ) {
    super(message);
    this.name = 'AgentAccessError';
    this.code = code;
    if (options?.currentRevision !== undefined) {
      this.currentRevision = options.currentRevision;
    }
    if (options?.issues !== undefined) {
      this.issues = options.issues;
    }
    if (options?.diagnostics !== undefined) {
      this.diagnostics = options.diagnostics;
    }
    this.retryable =
      options?.retryable ??
      (code === 'BUSY' || code === 'REQUEST_TIMEOUT');
  }

  toPayload(options?: { includeCurrentRevision?: boolean }): AgentAccessErrorPayload {
    const includeRev = options?.includeCurrentRevision ?? true;
    const payload: AgentAccessErrorPayload = {
      code: this.code,
      message: this.message,
      retryable: this.retryable,
    };
    if (includeRev && this.currentRevision !== undefined) {
      payload.currentRevision = this.currentRevision;
    }
    if (this.issues !== undefined && this.issues.length > 0) {
      payload.issues = this.issues;
    }
    if (this.diagnostics !== undefined && this.diagnostics.length > 0) {
      payload.diagnostics = this.diagnostics;
    }
    return payload;
  }
}

export function isAgentAccessErrorCode(value: unknown): value is AgentAccessErrorCode {
  return typeof value === 'string' && VALID_ERROR_CODES.has(value as AgentAccessErrorCode);
}

export function isAgentAccessErrorPayload(value: unknown): value is AgentAccessErrorPayload {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return false;
  }
  const rec = value as Record<string, unknown>;
  if (!isAgentAccessErrorCode(rec.code) || typeof rec.message !== 'string') {
    return false;
  }
  if (
    rec.currentRevision !== undefined &&
    (typeof rec.currentRevision !== 'number' || !Number.isSafeInteger(rec.currentRevision))
  ) {
    return false;
  }
  return true;
}

export function createErrorPayload(
  code: AgentAccessErrorCode,
  message: string,
  options?: AgentAccessErrorOptions,
): AgentAccessErrorPayload {
  return new AgentAccessError(code, message, options).toPayload();
}

export function mapDomainErrorToPayload(
  error: unknown,
  options?: { authorized?: boolean; fallbackMessage?: string },
): AgentAccessErrorPayload {
  const authorized = options?.authorized ?? true;

  if (error instanceof AgentAccessError) {
    return error.toPayload({ includeCurrentRevision: authorized });
  }

  if (isAgentAccessErrorPayload(error)) {
    const copy: AgentAccessErrorPayload = {
      code: error.code,
      message: error.message,
    };
    if (error.retryable !== undefined) {
      copy.retryable = error.retryable;
    }
    if (authorized && error.currentRevision !== undefined) {
      copy.currentRevision = error.currentRevision;
    }
    if (error.issues !== undefined) {
      copy.issues = error.issues;
    }
    if (error.diagnostics !== undefined) {
      copy.diagnostics = error.diagnostics;
    }
    return copy;
  }

  if (error instanceof DomainConflictError) {
    const payload: AgentAccessErrorPayload = {
      code: error.code === 'REVISION_CONFLICT' ? 'REVISION_CONFLICT' : 'VALIDATION_FAILED',
      message: error.message,
      retryable: false,
    };
    if (authorized && error.currentRevision !== undefined) {
      payload.currentRevision = error.currentRevision;
    }
    return payload;
  }

  if (error instanceof DomainValidationError) {
    const firstIssue = error.issues[0];
    const isTooLarge = error.issues.some((iss) => iss.code === 'LIMIT_EXCEEDED');
    return {
      code: isTooLarge ? 'REQUEST_TOO_LARGE' : 'VALIDATION_FAILED',
      message: firstIssue
        ? `${firstIssue.path ? `${firstIssue.path}: ` : ''}[${firstIssue.code}] ${firstIssue.message}`
        : error.message,
      issues: error.issues,
      retryable: false,
    };
  }

  return {
    code: 'VALIDATION_FAILED',
    message: options?.fallbackMessage ?? 'Operation failed due to an unexpected validation error.',
    retryable: false,
  };
}

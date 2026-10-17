import { DOMAIN_LIMITS } from '../domain/limits';
import { FORBIDDEN_KEYS, ID_PATTERN, utf8ByteLength } from '../domain/validation';
import { AgentAccessError } from './errors';
import type { AgentOperationName } from './types';

const MAX_CANONICAL_DEPTH = 64;

export function validateAgentId(value: unknown, fieldPath: string): string {
  if (typeof value !== 'string' || value.length === 0) {
    throw new AgentAccessError(
      'VALIDATION_FAILED',
      `${fieldPath} must be a non-empty string.`,
      {
        issues: [
          {
            path: fieldPath,
            code: 'INVALID_ID',
            message: `${fieldPath} must be a non-empty string.`,
          },
        ],
      },
    );
  }
  if (
    value.length > DOMAIN_LIMITS.MAX_ID_LENGTH ||
    utf8ByteLength(value) > DOMAIN_LIMITS.MAX_ID_LENGTH ||
    !ID_PATTERN.test(value) ||
    FORBIDDEN_KEYS.has(value)
  ) {
    throw new AgentAccessError(
      'VALIDATION_FAILED',
      `${fieldPath} must be 1..${DOMAIN_LIMITS.MAX_ID_LENGTH} ASCII characters matching [A-Za-z0-9._:-].`,
      {
        issues: [
          {
            path: fieldPath,
            code: 'INVALID_ID',
            message: `${fieldPath} must be 1..${DOMAIN_LIMITS.MAX_ID_LENGTH} ASCII characters matching [A-Za-z0-9._:-].`,
          },
        ],
      },
    );
  }
  return value;
}

export function validateExpectedRevision(value: unknown, fieldPath = 'expectedRevision'): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) {
    throw new AgentAccessError(
      'VALIDATION_FAILED',
      `${fieldPath} must be a non-negative safe integer.`,
      {
        issues: [
          {
            path: fieldPath,
            code: 'INVALID_REVISION',
            message: `${fieldPath} must be a non-negative safe integer.`,
          },
        ],
      },
    );
  }
  return Object.is(value, -0) ? 0 : value;
}

export function canonicalizeJsonValue(value: unknown, depth = 0): string {
  if (depth > MAX_CANONICAL_DEPTH) {
    throw new AgentAccessError(
      'VALIDATION_FAILED',
      `Payload exceeds maximum nesting depth of ${MAX_CANONICAL_DEPTH}.`,
    );
  }

  if (value === null) {
    return 'null';
  }

  const valueType = typeof value;
  if (valueType === 'boolean') {
    return (value as boolean) ? 'true' : 'false';
  }

  if (valueType === 'number') {
    const num = value as number;
    if (!Number.isFinite(num)) {
      throw new AgentAccessError(
        'VALIDATION_FAILED',
        'Payload contains a non-finite number.',
      );
    }
    const normalized = Object.is(num, -0) ? 0 : num;
    return JSON.stringify(normalized);
  }

  if (valueType === 'string') {
    return JSON.stringify(value as string);
  }

  if (Array.isArray(value)) {
    const parts: string[] = [];
    for (let i = 0; i < value.length; i += 1) {
      const item = value[i];
      parts.push(item === undefined ? 'null' : canonicalizeJsonValue(item, depth + 1));
    }
    return `[${parts.join(',')}]`;
  }

  if (valueType === 'object') {
    const proto = Object.getPrototypeOf(value);
    if (proto !== Object.prototype && proto !== null) {
      throw new AgentAccessError(
        'VALIDATION_FAILED',
        'Payload contains a non-plain object.',
      );
    }
    const record = value as Record<string, unknown>;
    const rawKeys = Object.getOwnPropertyNames(record);
    for (const k of rawKeys) {
      if (FORBIDDEN_KEYS.has(k)) {
        throw new AgentAccessError(
          'VALIDATION_FAILED',
          `Forbidden property key "${k}" in payload.`,
        );
      }
    }
    const sortedKeys = Object.keys(record).sort();
    const parts: string[] = [];
    for (const key of sortedKeys) {
      const propVal = record[key];
      if (propVal === undefined) {
        continue;
      }
      parts.push(`${JSON.stringify(key)}:${canonicalizeJsonValue(propVal, depth + 1)}`);
    }
    return `{${parts.join(',')}}`;
  }

  throw new AgentAccessError(
    'VALIDATION_FAILED',
    `Unsupported value type "${valueType}" in payload.`,
  );
}

export interface MutationFingerprintInput {
  operation: AgentOperationName;
  documentId: string;
  expectedRevision: number;
  canonicalPayload: unknown;
}

export function canonicalizeMutationRequest(input: MutationFingerprintInput): string {
  const normalizedRevision = Object.is(input.expectedRevision, -0) ? 0 : input.expectedRevision;
  return canonicalizeJsonValue([
    input.operation,
    input.documentId,
    normalizedRevision,
    input.canonicalPayload,
  ]);
}

export async function computeMutationFingerprint(input: MutationFingerprintInput): Promise<string> {
  const bytes = new TextEncoder().encode(canonicalizeMutationRequest(input));
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(digest), value => value.toString(16).padStart(2, '0')).join('');
}

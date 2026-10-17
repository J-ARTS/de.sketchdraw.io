import { z } from 'zod';
import type { AgentOperationInput, AgentOperationName } from './types';
import { AgentAccessError } from './errors';
import { AGENT_ACCESS_LIMITS as L } from './types';

export const idSchema = z.string().min(1).max(128).regex(/^[A-Za-z0-9._:-]+$/)
  .refine(v => !['__proto__', 'prototype', 'constructor'].includes(v));
const revision = z.number().int().min(0).max(Number.MAX_SAFE_INTEGER);
const base = { documentId: idSchema };
const write = { ...base, expectedRevision: revision, commandId: idSchema };
export const operationSchemas = {
  sketchdraw_read_document: z.strictObject({ ...base, includeAssetData: z.boolean().optional() }),
  sketchdraw_find_elements: z.strictObject({ ...base, query: z.string().max(L.MAX_QUERY_LENGTH), limit: z.number().int().min(1).max(L.MAX_FIND_LIMIT).optional() }),
  sketchdraw_analyze_document: z.strictObject(base),
  sketchdraw_apply_commands: z.strictObject({ ...write, command: z.unknown().refine(v => v !== undefined) }),
  sketchdraw_read_code: z.strictObject(base),
  sketchdraw_apply_code: z.strictObject({ ...write, code: z.string().max(32 * 1024 * 1024) }),
} as const;
export const operations = Object.keys(operationSchemas) as AgentOperationName[];
export const operationSchema = z.enum(operations as [AgentOperationName, ...AgentOperationName[]]);
export const hex32 = z.string().regex(/^[a-f0-9]{64}$/);
export const hex16 = z.string().regex(/^[a-f0-9]{32}$/);
export const helloSchema = z.strictObject({ type: z.literal('auth-hello'), version: z.literal(1), grantId: idSchema, appEpoch: hex16, clientNonce: hex32 });
export const challengeSchema = z.strictObject({ type: z.literal('auth-challenge'), version: z.literal(1), serverNonce: hex32, serverMac: hex32 });
export const verifySchema = z.strictObject({ type: z.literal('auth-verify'), version: z.literal(1), clientMac: hex32 });
export const authOkSchema = z.strictObject({ type: z.literal('auth-ok'), version: z.literal(1), documentId: idSchema, sessionEpoch: revision, grantGeneration: revision, permission: z.enum(['read', 'write']) });
export const toolRequestSchema = z.strictObject({ type: z.literal('tool-request'), version: z.literal(1), requestId: hex16, operation: operationSchema, payload: z.unknown() });
export function parseOperationInput(operation: AgentOperationName, input: unknown): AgentOperationInput {
  const result = operationSchemas[operation].safeParse(input);
  if (!result.success) throw new AgentAccessError('VALIDATION_FAILED', 'Invalid tool input.');
  return result.data as AgentOperationInput;
}

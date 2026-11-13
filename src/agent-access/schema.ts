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
/**
 * What `tools/list` tells an agent about a command (#176). Deliberately loose and flat – no unions, extra keys allowed –
 * so every client can render it and the domain remains the one place that validates. Field descriptions are the
 * agent's only reference, so they name the fields that matter and their defaults.
 */
const point = z.looseObject({ x: z.number(), y: z.number() });
const endpoint = z.looseObject({
  elementId: idSchema.describe('ID of the element this end is attached to.'),
  anchor: point.optional().describe('Attachment point on that element, normalized 0..1 (x:1,y:0.5 = middle of the right side). Chosen automatically when omitted.'),
});
export const ELEMENT_KINDS = ['rectangle', 'ellipse', 'diamond', 'text', 'sticky-note', 'container', 'frame', 'connector', 'component', 'annotation', 'table', 'image', 'web-embed', 'path'] as const;
const mcpElement = z.looseObject({
  id: idSchema.describe('Stable ID you choose, unique in the document, e.g. "box:api". Letters, digits, . _ : - only.'),
  kind: z.enum(ELEMENT_KINDS),
  x: z.number().optional().describe('Left edge in document units (y grows downwards). Required except for a connector bound at both ends.'),
  y: z.number().optional().describe('Top edge.'),
  width: z.number().optional().describe('Defaults per kind (rectangle 120) when omitted.'),
  height: z.number().optional().describe('Defaults per kind (rectangle 80) when omitted.'),
  text: z.string().optional().describe('Visible caption inside the element.'),
  label: z.string().optional().describe('Accessible name; shown as caption when "text" is empty.'),
  parentId: idSchema.optional().describe('ID of the container or frame this element belongs to; coordinates stay absolute.'),
  pageId: idSchema.optional().describe('Page of the element. May be omitted only while the document has a single page; otherwise give it here or once as the command\'s "pageId". sketchdraw_analyze_document lists the page IDs.'),
  style: z.looseObject({}).optional().describe('Any of stroke, fill, textColor (CSS colors), strokeWidth, opacity (0..1), fontSize, textAlign (left|center|right), strokeDash (solid|dashed|dotted|animated), fontFamily (sans|mono|roboto|scribbled), fontWeight (normal|bold), cornerRadius. Omitted keys get the defaults of the kind.'),
  from: endpoint.optional().describe('Connector only: start. With "from" and "to" and no "points", position and route are computed from the two elements.'),
  to: endpoint.optional().describe('Connector only: end (arrowhead side).'),
  connectorRouting: z.enum(['straight', 'elbowed', 'curved']).optional().describe('Connector only. Computed connectors default to "elbowed".'),
  startMarker: z.string().optional().describe('Connector only: none | line-arrow | solid-arrow | triangle | solid-triangle | … Default none.'),
  endMarker: z.string().optional().describe('Connector only. Default line-arrow.'),
  points: z.array(point).optional().describe('Connector/path only: route relative to x/y. Leave out for a connector bound at both ends.'),
});
export const COMMAND_TYPES = ['add', 'update', 'delete', 'reorder', 'rename', 'batch', 'add-page', 'rename-page', 'delete-page', 'reorder-pages', 'set-metadata', 'set-component-sets', 'set-comments', 'set-tasks', 'replace'] as const;
const mcpCommand = z.looseObject({
  type: z.enum(COMMAND_TYPES).describe('add: new elements. update: patch existing elements. delete: remove elements by ID. rename: document title. batch: several commands as one atomic change. reorder: z-order (back to front). add-page | rename-page | delete-page | reorder-pages: pages. set-metadata: document key/value metadata.'),
  elements: z.array(mcpElement).optional().describe('add: the elements to create. Connectors may refer to elements of the same command.'),
  changes: z.array(z.looseObject({
    id: idSchema,
    patch: z.looseObject({}).describe('Fields to change: x, y, width, height, rotation, text, label, description, parentId, style (only the keys that change), from, to, points, connectorRouting, startMarker, endMarker, metadata. Use null to clear an optional field. Connectors attached to a moved element follow it.'),
  })).optional().describe('update: one entry per element.'),
  ids: z.array(idSchema).optional().describe('delete: element IDs. Children of a deleted container go with it; connectors attached to a deleted element stay and are detached, so list them too if they should go. reorder / reorder-pages: IDs in the new order.'),
  title: z.string().optional().describe('rename: the new document title.'),
  commands: z.array(z.looseObject({ type: z.enum(COMMAND_TYPES) })).optional().describe('batch: commands applied in order, all or nothing. Same shape as this object.'),
  page: z.looseObject({ id: idSchema, name: z.string() }).optional().describe('add-page: the new page.'),
  pageId: idSchema.optional().describe('add: page for all elements of this command, required once the document has several pages. rename-page / delete-page: the page.'),
  name: z.string().optional().describe('rename-page: the new name.'),
  patch: z.looseObject({}).optional().describe('set-metadata: string values to set, null to remove a key.'),
}).describe('One document command. Example: {"type":"add","elements":[{"id":"box:api","kind":"rectangle","x":100,"y":100,"text":"API"},{"id":"box:db","kind":"rectangle","x":420,"y":100,"text":"DB"},{"id":"link:api-db","kind":"connector","from":{"elementId":"box:api"},"to":{"elementId":"box:db"}}]}');

/** Reads can discover the current document; writes always bind the document the caller read. */
const mcpDocumentId = idSchema.optional().describe('ID of the document you read. Optional for reads; pass it on writes so a change can never land in a document the user opened in the meantime.');
const mcpRevision = revision.describe('The "revision" returned by your latest read or write of this document.');
const mcpCommandId = idSchema.describe('ID you invent per change, e.g. "add-api-box-1". Repeat the same ID only to retry the identical change after an unknown outcome; every new or corrected change needs a new one.');
const mcpBase = { documentId: mcpDocumentId };
const mcpWrite = { documentId: idSchema.describe('Required: ID of the document you read. A queued change must never follow the user to another document.'), expectedRevision: mcpRevision, commandId: mcpCommandId };
export const mcpOperationSchemas = {
  sketchdraw_read_document: z.strictObject({ ...mcpBase, includeAssetData: z.boolean().optional().describe('Include embedded image bytes (large). Default false: assets are summarized.') }),
  sketchdraw_find_elements: z.strictObject({ ...mcpBase, query: z.string().max(L.MAX_QUERY_LENGTH).describe('Case-insensitive text matched against ID, kind, text, label, description and metadata. An empty string lists all elements.'), limit: z.number().int().min(1).max(L.MAX_FIND_LIMIT).optional().describe('Default 50.') }),
  sketchdraw_analyze_document: z.strictObject(mcpBase),
  sketchdraw_apply_commands: z.strictObject({ ...mcpWrite, command: mcpCommand }),
  sketchdraw_read_code: z.strictObject(mcpBase),
  sketchdraw_apply_code: z.strictObject({ ...mcpWrite, code: z.string().max(32 * 1024 * 1024).describe('The complete diagram code as returned by sketchdraw_read_code, edited. It replaces the whole document.') }),
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

export function parseMcpOperationInput(
  operation: AgentOperationName,
  input: unknown,
  currentDocumentId: string,
): AgentOperationInput {
  const result = mcpOperationSchemas[operation].safeParse(input);
  if (!result.success) throw new AgentAccessError('VALIDATION_FAILED', 'Invalid tool input.');
  if (result.data.documentId !== undefined && result.data.documentId !== currentDocumentId) {
    throw new AgentAccessError('DOCUMENT_MISMATCH', 'The requested document is not currently open.');
  }
  return { ...result.data, documentId: currentDocumentId } as AgentOperationInput;
}

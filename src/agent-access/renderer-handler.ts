import { formatDiagram, parseDiagram } from '../codec';
import type { DocumentCommand, ElementKind } from '../domain';
import { SessionAccessError, type ActorBinding, type DocumentAuthority } from '../session';
import { AgentAccessError, mapDomainErrorToPayload } from './errors';
import { canonicalizeMutationRequest } from './fingerprint';
import { parseOperationInput } from './schema';
import {
  AGENT_ACCESS_LIMITS as L, AGENT_WRITE_OPERATIONS, type AgentControlAck, type AgentControlMessage,
  type AgentGrantSummary, type AgentRendererRequest, type AgentRendererResponse,
  type AgentSessionDescriptor, type AgentOperationOutput, type AnalyzeDocumentOutput,
  type ReadDocumentOutput,
} from './types';

interface LocalGrant { summary: AgentGrantSummary; binding: ActorBinding; journal: Map<string, Entry> }
interface Entry { canonical?: string; fingerprint?: string; result: Promise<AgentOperationOutput> }
async function digest(text: string): Promise<string> {
  const value = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return Array.from(new Uint8Array(value), byte => byte.toString(16).padStart(2, '0')).join('');
}
export interface RendererAgentHandler {
  handleControl(message: AgentControlMessage): AgentControlAck;
  handleRequest(request: AgentRendererRequest): Promise<AgentRendererResponse>;
  revokeLocal(grantId: string): void;
  dispose(): void;
}
/** Uses the actual shared authority; it never creates a private document/controller. */
export function createRendererAgentHandler(authority: DocumentAuthority, session: AgentSessionDescriptor): RendererAgentHandler {
  if (authority.session.documentId !== session.documentId) throw new AgentAccessError('DOCUMENT_MISMATCH', 'Invalid document authority.');
  const grants = new Map<string, LocalGrant>();
  let closed = false;
  const revoked = new Set<string>();
  const checkSession = (value: AgentSessionDescriptor) => {
    if (closed || value.documentId !== session.documentId || value.sessionEpoch !== session.sessionEpoch || value.webContentsGeneration !== session.webContentsGeneration) throw new AgentAccessError('SESSION_CHANGED', 'Document session changed.');
  };
  function revokeLocal(id: string): void {
    revoked.add(id);
    const grant = grants.get(id);
    if (grant) {
      grant.summary.active = false; grant.summary.revoked = true;
      try { authority.revokeBinding(grant.binding.bindingId); }
      catch (error) { if (!(error instanceof SessionAccessError) || !['SESSION_CHANGED', 'AUTHORITY_DIVERGED', 'ACCESS_REVOKED'].includes(error.code)) throw error; }
      finally { grant.journal.clear(); grants.delete(id); }
    }
  }
  function check(request: AgentRendererRequest, write: boolean): LocalGrant {
    checkSession(request);
    const grant = grants.get(request.grantId);
    if (!grant || !grant.summary.active || grant.summary.revoked || request.grantGeneration !== grant.summary.grantGeneration || request.actorId !== grant.summary.actorId || request.permission !== grant.summary.permission) throw new AgentAccessError('ACCESS_REVOKED', 'Grant is unavailable.');
    if (write && grant.summary.permission !== 'write') throw new AgentAccessError('ACCESS_DENIED', 'Grant is read-only.');
    return grant;
  }
  function handleControl(message: AgentControlMessage): AgentControlAck {
    const ack: AgentControlAck = { controlId: message.controlId, ok: false, documentId: session.documentId, sessionEpoch: session.sessionEpoch, webContentsGeneration: session.webContentsGeneration };
    try {
      checkSession(message);
      if (message.type === 'sync-session') for (const id of grants.keys()) revokeLocal(id);
      else if (message.type === 'revoke-grant') {
        const existing = grants.get(message.grantId);
        if (existing && existing.summary.grantGeneration !== message.grantGeneration) throw new AgentAccessError('ACCESS_DENIED', 'Grant generation mismatch.');
        revokeLocal(message.grantId);
        ack.grantId = message.grantId; ack.grantGeneration = message.grantGeneration;
      } else if (message.type === 'install-grant') {
        const summary = { ...message.grant, active: true, revoked: false };
        if (summary.documentId !== session.documentId || summary.sessionEpoch !== session.sessionEpoch || grants.has(summary.grantId) || revoked.has(summary.grantId) || grants.size >= L.MAX_ACTIVE_GRANTS || !['read', 'write'].includes(summary.permission) || summary.actorId !== `agent:${summary.grantId}`) throw new AgentAccessError('ACCESS_DENIED', 'Invalid grant.');
        const binding = authority.bindActor({ actorId: summary.actorId, source: 'agent', grantId: summary.grantId, grantGeneration: summary.grantGeneration, guard: request => {
          const local = grants.get(summary.grantId);
          if (closed || local?.summary !== summary || !summary.active || summary.revoked || request.grantGeneration !== summary.grantGeneration || request.grantId !== summary.grantId || request.actorId !== summary.actorId || request.session.controllerEpoch !== authority.session.controllerEpoch || request.bindingId !== local.binding.bindingId || request.bindingGeneration !== local.binding.bindingGeneration || request.source !== 'agent') return { allowed: false, code: 'ACCESS_REVOKED' };
          return request.permission === 'read' || summary.permission === 'write' ? { allowed: true } : { allowed: false, code: 'ACCESS_DENIED' };
        } });
        grants.set(summary.grantId, { summary, binding, journal: new Map() });
        ack.grantId = summary.grantId; ack.grantGeneration = summary.grantGeneration;
      } else throw new AgentAccessError('VALIDATION_FAILED', 'Unknown control message.');
      ack.ok = true;
    } catch (error) { ack.error = mapDomainErrorToPayload(error); }
    return ack;
  }
  async function execute(request: AgentRendererRequest, grant: LocalGrant): Promise<AgentOperationOutput> {
    check(request, AGENT_WRITE_OPERATIONS.has(request.operation));
    const input = parseOperationInput(request.operation, request.payload);
    if (input.documentId !== session.documentId) throw new AgentAccessError('DOCUMENT_MISMATCH', 'Grant belongs to another document.');
    const snapshot = grant.binding.source.getSnapshot();
    const document = snapshot.document;
    const base = { documentId: document.id, revision: snapshot.revision };
    if (request.operation === 'sketchdraw_read_document') {
      const includeAssetData = 'includeAssetData' in input && input.includeAssetData === true;
      const assetSummaries: ReadDocumentOutput['assetSummaries'] = {};
      for (const [id, asset] of Object.entries(document.assets)) assetSummaries[id] = { id, name: asset.name, mimeType: asset.mimeType, dataByteLength: Math.floor(asset.dataUrl.slice(asset.dataUrl.indexOf(',') + 1).length * 3 / 4) - (asset.dataUrl.endsWith('==') ? 2 : asset.dataUrl.endsWith('=') ? 1 : 0), dataUrlOmitted: !includeAssetData };
      const { assets: _assets, ...summary } = document;
      return { ...base, includeAssetData, document: includeAssetData ? document : summary, assetSummaries };
    }
    if (request.operation === 'sketchdraw_read_code') return { ...base, formatVersion: 1, code: formatDiagram(document) };
    if (request.operation === 'sketchdraw_find_elements' && 'query' in input) {
      const query = input.query.toLocaleLowerCase();
      const matches = document.elements.flatMap(element => {
        const fields: Record<string, string> = { id: element.id, kind: element.kind, shapeVariant: element.shapeVariant ?? '', label: element.label ?? '', description: element.description ?? '', text: element.text ?? '', author: element.author ?? '', componentType: element.componentType ?? '', metadata: JSON.stringify(element.metadata ?? {}) };
        const matchedFields = Object.keys(fields).filter(key => fields[key]!.toLocaleLowerCase().includes(query));
        return matchedFields.length ? [{ id: element.id, kind: element.kind, ...(element.shapeVariant ? { shapeVariant: element.shapeVariant } : {}), x: element.x, y: element.y, width: element.width, height: element.height, ...(element.label ? { label: element.label } : {}), ...(element.text ? { text: element.text } : {}), ...(element.parentId ? { parentId: element.parentId } : {}), ...(element.componentType ? { componentType: element.componentType } : {}), matchedFields }] : [];
      });
      const limit = input.limit ?? L.DEFAULT_FIND_LIMIT;
      return { ...base, query: input.query, totalMatches: matches.length, truncated: matches.length > limit, matches: matches.slice(0, limit) };
    }
    if (request.operation === 'sketchdraw_analyze_document') {
      const counts = Object.fromEntries(['rectangle', 'ellipse', 'diamond', 'text', 'path', 'image', 'connector', 'container', 'component', 'sticky-note', 'annotation', 'table'].map(kind => [kind, 0])) as Record<ElementKind, number>;
      const findings: AnalyzeDocumentOutput['findings'] = [];
      const byId = new Map(document.elements.map(element => [element.id, element]));
      const parents = new Set(document.elements.flatMap(element => element.parentId ? [element.parentId] : []));
      let maxDepth = 0, bound = 0, partial = 0, unbound = 0;
      for (const element of document.elements) {
        counts[element.kind]++;
        let depth = 0, parent = element.parentId;
        while (parent && depth <= 32) { depth++; parent = byId.get(parent)?.parentId; }
        maxDepth = Math.max(maxDepth, depth);
        if (element.kind === 'connector') {
          const endpoints = Number(Boolean(element.from?.elementId)) + Number(Boolean(element.to?.elementId));
          if (endpoints === 2) bound++; else if (endpoints === 1) { partial++; findings.push({ code: 'PARTIALLY_BOUND_CONNECTOR', severity: 'info', elementId: element.id, message: 'One endpoint is unbound.' }); } else { unbound++; findings.push({ code: 'UNBOUND_CONNECTOR', severity: 'info', elementId: element.id, message: 'Both endpoints are unbound.' }); }
        }
        if (element.kind === 'container' && !parents.has(element.id)) findings.push({ code: 'EMPTY_CONTAINER', severity: 'info', elementId: element.id, message: 'Container has no children.' });
        if (!element.label && !element.text) findings.push({ code: 'UNLABELED_ELEMENT', severity: 'info', elementId: element.id, message: 'Element has no human-readable label.' });
      }
      return { ...base, title: document.title, summary: { totalElements: document.elements.length, countsByKind: counts, containerCount: counts.container, maxContainerDepth: maxDepth, connectorCount: counts.connector, boundConnectorCount: bound, unboundConnectorCount: unbound, partiallyBoundConnectorCount: partial, assetCount: Object.keys(document.assets).length, totalAssetDataUrlBytes: Object.values(document.assets).reduce((total, asset) => total + new TextEncoder().encode(asset.dataUrl).length, 0), componentSetCount: document.componentSets.length, totalComponentDefinitions: document.componentSets.reduce((total, set) => total + set.components.length, 0) }, findings };
    }
    if (!('commandId' in input) || request.commandId !== input.commandId || request.expectedRevision !== input.expectedRevision) throw new AgentAccessError('VALIDATION_FAILED', 'Mutation metadata mismatch.');
    let command: DocumentCommand;
    let diagnostics: import('../domain').ParseDiagnostic[] = [];
    if ('code' in input) {
      const parsed = parseDiagram(input.code, document);
      if (!parsed.ok) throw new AgentAccessError('VALIDATION_FAILED', 'Diagram code is invalid.', { diagnostics: parsed.diagnostics });
      if (parsed.document.id !== document.id) throw new AgentAccessError('DOCUMENT_MISMATCH', 'Code cannot replace a different document.');
      diagnostics = parsed.diagnostics; command = { type: 'replace', document: parsed.document };
    } else command = input.command;
    check(request, true);
    const requestId = grant.binding.gateway.nextRequestId();
    if (!requestId) throw new AgentAccessError('BUSY', 'A previous agent change is unresolved.');
    const outcome = await grant.binding.gateway.submit({ requestId, expectedRevision: input.expectedRevision, action: { kind: 'dispatch', command } });
    if (outcome.status === 'outcome-unknown') throw new AgentAccessError('OUTCOME_UNKNOWN', 'The mutation outcome is not confirmed.');
    if (outcome.status === 'rejected') {
      const code = ['ACCESS_DENIED', 'ACCESS_REVOKED', 'SESSION_CHANGED', 'DOCUMENT_MISMATCH', 'REVISION_CONFLICT', 'REQUEST_TOO_LARGE', 'BUSY', 'REQUEST_TIMEOUT', 'REQUEST_ID_REUSED'].includes(outcome.code) ? outcome.code as import('./types').AgentAccessErrorCode : 'VALIDATION_FAILED';
      throw new AgentAccessError(code, 'Change was rejected by the shared document authority.', { currentRevision: outcome.currentRevision });
    }
    check(request, true);
    return { documentId: document.id, commandId: input.commandId, previousRevision: input.expectedRevision, revision: outcome.revision, changed: outcome.status === 'committed', saved: false, persistence: 'unsaved-open-document', deduplicated: false, elementCount: grant.binding.source.getSnapshot().document.elements.length, ...('code' in input ? { diagnostics } : {}) };
  }
  async function handleRequest(rawRequest: AgentRendererRequest): Promise<AgentRendererResponse> {
    const request = structuredClone(rawRequest);
    const base = { requestId: request.requestId, operation: request.operation, documentId: session.documentId, sessionEpoch: session.sessionEpoch };
    try {
      const write = AGENT_WRITE_OPERATIONS.has(request.operation);
      const grant = check(request, write);
      let result: AgentOperationOutput;
      if (write) {
        const payload = parseOperationInput(request.operation, request.payload);
        if (!('commandId' in payload) || payload.documentId !== session.documentId || request.commandId !== payload.commandId || request.expectedRevision !== payload.expectedRevision) throw new AgentAccessError('VALIDATION_FAILED', 'Invalid mutation envelope.');
        const canonical = canonicalizeMutationRequest({ operation: request.operation, documentId: payload.documentId, expectedRevision: payload.expectedRevision, canonicalPayload: payload });
        const previous = grant.journal.get(payload.commandId);
        if (previous) {
          if (previous.canonical !== undefined ? previous.canonical !== canonical : previous.fingerprint !== await digest(canonical)) throw new AgentAccessError('REQUEST_ID_REUSED', 'Command ID has a different payload.');
          result = { ...await previous.result, deduplicated: true };
        } else {
          if (grant.journal.size >= L.MAX_JOURNAL_ENTRIES_PER_GRANT) throw new AgentAccessError('JOURNAL_FULL', 'Create a new grant to continue.');
          const entry: Entry = { canonical, result: Promise.resolve().then(async () => {
            entry.fingerprint = await digest(canonical); entry.canonical = undefined;
            return execute(request, grant);
          }) };
          grant.journal.set(payload.commandId, entry);
          result = await entry.result;
        }
      } else result = await execute(request, grant);
      check(request, write);
      return { ...base, ok: true, revision: result.revision, result };
    } catch (error) {
      const mapped = error instanceof SessionAccessError ? new AgentAccessError(error.code === 'ACCESS_REVOKED' || error.code === 'SESSION_CHANGED' ? error.code : 'ACCESS_DENIED', 'Document authority is unavailable.') : error;
      return { ...base, ok: false, error: mapDomainErrorToPayload(mapped) };
    }
  }
  return { handleControl, handleRequest, revokeLocal, dispose: () => { closed = true; for (const id of grants.keys()) revokeLocal(id); } };
}

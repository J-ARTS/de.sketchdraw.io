import type {
  DocumentCommand,
  ElementKind,
  ParseDiagnostic,
  SketchAsset,
  SketchDocument,
  ShapeVariant,
  ValidationIssue,
} from '../domain/types';

export const AGENT_ACCESS_LIMITS = Object.freeze({
  PRE_AUTH_FRAME_BYTES: 4 * 1024,
  AUTH_TIMEOUT_MS: 5_000,
  POST_AUTH_FRAME_BYTES: 40 * 1024 * 1024,
  TOTAL_BUFFER_BUDGET_BYTES: 128 * 1024 * 1024,
  MAX_TOTAL_CONNECTIONS: 16,
  MAX_UNAUTHENTICATED_CONNECTIONS: 8,
  MAX_ACTIVE_GRANTS: 8,
  MAX_IN_FLIGHT_REQUESTS: 16,
  MAX_CLIENT_CONCURRENT_REQUESTS: 2,
  MAX_JOURNAL_ENTRIES_PER_GRANT: 4096,
  DEFAULT_FIND_LIMIT: 50,
  MAX_FIND_LIMIT: 200,
  MAX_QUERY_LENGTH: 1024,
  DEFAULT_REQUEST_TIMEOUT_MS: 15_000,
  DEFAULT_CONTROL_TIMEOUT_MS: 5_000,
  CAPABILITY_BYTES: 32,
  CAPABILITY_HEX_LENGTH: 64,
  NONCE_BYTES: 32,
  NONCE_HEX_LENGTH: 64,
  UNIX_SOCKET_MAX_PATH_BYTES: 100,
});

export const AGENT_AUTH_LABELS = Object.freeze({
  SERVER: 'sketchdraw-mcp-server-v1',
  CLIENT: 'sketchdraw-mcp-client-v1',
} as const);

export type AgentPermission = 'read' | 'write';

export type AgentAccessErrorCode =
  | 'ACCESS_DENIED'
  | 'ACCESS_REVOKED'
  | 'DOCUMENT_MISMATCH'
  | 'SESSION_CHANGED'
  | 'REVISION_CONFLICT'
  | 'VALIDATION_FAILED'
  | 'REQUEST_TOO_LARGE'
  | 'BUSY'
  | 'REQUEST_TIMEOUT'
  | 'OUTCOME_UNKNOWN'
  | 'JOURNAL_FULL'
  | 'REQUEST_ID_REUSED';

export interface AgentAccessErrorPayload {
  code: AgentAccessErrorCode;
  message: string;
  currentRevision?: number;
  issues?: ValidationIssue[];
  diagnostics?: ParseDiagnostic[];
  retryable?: boolean;
}

export type AgentOperationName =
  | 'sketchdraw_read_document'
  | 'sketchdraw_find_elements'
  | 'sketchdraw_analyze_document'
  | 'sketchdraw_apply_commands'
  | 'sketchdraw_read_code'
  | 'sketchdraw_apply_code';

export const AGENT_READ_OPERATIONS: ReadonlySet<AgentOperationName> = new Set<AgentOperationName>([
  'sketchdraw_read_document',
  'sketchdraw_find_elements',
  'sketchdraw_analyze_document',
  'sketchdraw_read_code',
]);

export const AGENT_WRITE_OPERATIONS: ReadonlySet<AgentOperationName> = new Set<AgentOperationName>([
  'sketchdraw_apply_commands',
  'sketchdraw_apply_code',
]);

export interface AgentSessionDescriptor {
  documentId: string;
  sessionEpoch: number;
  webContentsGeneration: number;
}

export interface AgentGrantSummary {
  grantId: string;
  grantGeneration: number;
  actorId: string;
  label?: string;
  documentId: string;
  sessionEpoch: number;
  permission: AgentPermission;
  active: boolean;
  revoked: boolean;
  createdAt: number;
}

export interface AgentIssuedGrant {
  clientConfiguration?: { command: string; args: string[]; env: Record<string, string> };
  grant: AgentGrantSummary;
  capability: string;
  appEpoch: string;
  endpoint: string;
  env: {
    SKETCHDRAW_MCP_ENDPOINT: string;
    SKETCHDRAW_MCP_CAPABILITY: string;
    SKETCHDRAW_MCP_GRANT_ID: string;
    SKETCHDRAW_MCP_APP_EPOCH: string;
    SKETCHDRAW_MCP_DOCUMENT_ID: string;
  };
}

export interface ReadDocumentInput {
  documentId: string;
  includeAssetData?: boolean;
}

export interface SanitizedAssetSummary {
  id: string;
  name: string;
  mimeType: SketchAsset['mimeType'];
  dataByteLength: number;
  dataUrlOmitted: boolean;
}

export interface ReadDocumentOutput {
  documentId: string;
  revision: number;
  includeAssetData: boolean;
  document: SketchDocument | Omit<SketchDocument, 'assets'>;
  assetSummaries: Record<string, SanitizedAssetSummary>;
}

export interface FindElementsInput {
  documentId: string;
  query: string;
  limit?: number;
}

export interface ElementMatchSummary {
  id: string;
  kind: ElementKind;
  shapeVariant?: ShapeVariant;
  label?: string;
  description?: string;
  text?: string;
  componentType?: string;
  parentId?: string;
  x: number;
  y: number;
  width: number;
  height: number;
  matchedFields: string[];
}

export interface FindElementsOutput {
  documentId: string;
  revision: number;
  query: string;
  totalMatches: number;
  truncated: boolean;
  matches: ElementMatchSummary[];
}

export interface AnalyzeDocumentInput {
  documentId: string;
}

export interface DocumentAnalysisFinding {
  code:
    | 'UNBOUND_CONNECTOR'
    | 'PARTIALLY_BOUND_CONNECTOR'
    | 'EMPTY_CONTAINER'
    | 'UNLABELED_ELEMENT';
  severity: 'info' | 'warning';
  message: string;
  elementId?: string;
}

export interface AnalyzeDocumentOutput {
  documentId: string;
  revision: number;
  title: string;
  summary: {
    totalElements: number;
    countsByKind: Record<ElementKind, number>;
    containerCount: number;
    maxContainerDepth: number;
    connectorCount: number;
    boundConnectorCount: number;
    unboundConnectorCount: number;
    partiallyBoundConnectorCount: number;
    assetCount: number;
    totalAssetDataUrlBytes: number;
    componentSetCount: number;
    totalComponentDefinitions: number;
  };
  findings: DocumentAnalysisFinding[];
}

export interface ApplyCommandsInput {
  documentId: string;
  expectedRevision: number;
  commandId: string;
  command: DocumentCommand;
}

export interface ApplyCommandsOutput {
  documentId: string;
  commandId: string;
  revision: number;
  previousRevision: number;
  changed: boolean;
  saved: false;
  persistence: 'unsaved-open-document';
  deduplicated: boolean;
  elementCount: number;
}

export interface ReadCodeInput {
  documentId: string;
}

export interface ReadCodeOutput {
  documentId: string;
  revision: number;
  formatVersion: 1;
  code: string;
}

export interface ApplyCodeInput {
  documentId: string;
  expectedRevision: number;
  commandId: string;
  code: string;
}

export interface ApplyCodeOutput {
  documentId: string;
  commandId: string;
  revision: number;
  previousRevision: number;
  changed: boolean;
  saved: false;
  persistence: 'unsaved-open-document';
  deduplicated: boolean;
  elementCount: number;
  diagnostics: ParseDiagnostic[];
}

export interface AgentOperationPayloadMap {
  sketchdraw_read_document: {
    input: ReadDocumentInput;
    output: ReadDocumentOutput;
  };
  sketchdraw_find_elements: {
    input: FindElementsInput;
    output: FindElementsOutput;
  };
  sketchdraw_analyze_document: {
    input: AnalyzeDocumentInput;
    output: AnalyzeDocumentOutput;
  };
  sketchdraw_apply_commands: {
    input: ApplyCommandsInput;
    output: ApplyCommandsOutput;
  };
  sketchdraw_read_code: {
    input: ReadCodeInput;
    output: ReadCodeOutput;
  };
  sketchdraw_apply_code: {
    input: ApplyCodeInput;
    output: ApplyCodeOutput;
  };
}

export type AgentOperationInput<K extends AgentOperationName = AgentOperationName> =
  AgentOperationPayloadMap[K]['input'];

export type AgentOperationOutput<K extends AgentOperationName = AgentOperationName> =
  AgentOperationPayloadMap[K]['output'];

export type AgentRendererRequest<K extends AgentOperationName = AgentOperationName> = {
  requestId: string;
  operation: K;
  grantId: string;
  grantGeneration: number;
  actorId: string;
  permission: AgentPermission;
  documentId: string;
  sessionEpoch: number;
  webContentsGeneration: number;
  commandId?: string;
  expectedRevision?: number;
  payload: AgentOperationInput<K>;
};

export type AgentRendererResponse<K extends AgentOperationName = AgentOperationName> =
  | {
      requestId: string;
      ok: true;
      operation: K;
      documentId: string;
      sessionEpoch: number;
      revision: number;
      result: AgentOperationOutput<K>;
    }
  | {
      requestId: string;
      ok: false;
      operation: K;
      documentId: string;
      sessionEpoch: number;
      error: AgentAccessErrorPayload;
    };

export type AgentControlMessage =
  | {
      type: 'install-grant';
      controlId: string;
      sessionEpoch: number;
      webContentsGeneration: number;
      documentId: string;
      grant: AgentGrantSummary;
    }
  | {
      type: 'revoke-grant';
      controlId: string;
      sessionEpoch: number;
      webContentsGeneration: number;
      documentId: string;
      grantId: string;
      grantGeneration: number;
      reason: 'revoked' | 'downgraded' | 'session-changed' | 'closed';
      nextPermission?: AgentPermission;
    }
  | {
      type: 'sync-session';
      controlId: string;
      sessionEpoch: number;
      webContentsGeneration: number;
      documentId: string;
    };

export interface AgentControlAck {
  controlId: string;
  ok: boolean;
  sessionEpoch: number;
  webContentsGeneration: number;
  documentId: string;
  grantId?: string;
  grantGeneration?: number;
  error?: AgentAccessErrorPayload;
}

export type AgentWireAuthHello = {
  type: 'auth-hello';
  version: 1;
  grantId: string;
  appEpoch: string;
  clientNonce: string;
};

export type AgentWireAuthChallenge = {
  type: 'auth-challenge';
  version: 1;
  serverNonce: string;
  serverMac: string;
};

export type AgentWireAuthVerify = {
  type: 'auth-verify';
  version: 1;
  clientMac: string;
};

export type AgentWireAuthOk = {
  type: 'auth-ok';
  version: 1;
  documentId: string;
  sessionEpoch: number;
  grantGeneration: number;
  permission: AgentPermission;
};

export type AgentWireAuthError = {
  type: 'auth-error';
  version: 1;
  error: AgentAccessErrorPayload;
};

export type AgentWireToolRequest<K extends AgentOperationName = AgentOperationName> = {
  type: 'tool-request';
  version: 1;
  requestId: string;
  operation: K;
  payload: AgentOperationInput<K>;
};

export type AgentWireToolResponse<K extends AgentOperationName = AgentOperationName> =
  | {
      type: 'tool-response';
      version: 1;
      requestId: string;
      ok: true;
      operation: K;
      result: AgentOperationOutput<K>;
    }
  | {
      type: 'tool-response';
      version: 1;
      requestId: string;
      ok: false;
      operation: K;
      error: AgentAccessErrorPayload;
    };

export type AgentWireClientFrame =
  | AgentWireAuthHello
  | AgentWireAuthVerify
  | AgentWireToolRequest;

export type AgentWireServerFrame =
  | AgentWireAuthChallenge
  | AgentWireAuthOk
  | AgentWireAuthError
  | AgentWireToolResponse;

export interface SketchdrawAgentAccessBridge {
  readonly isAvailable: boolean;
  registerSession(session: { documentId: string; sessionEpoch: number }): Promise<AgentSessionDescriptor>;
  unregisterSession(session: { documentId: string; sessionEpoch: number }): Promise<void>;
  onRequest(handler: (request: AgentRendererRequest) => Promise<AgentRendererResponse>): () => void;
  onControl(handler: (message: AgentControlMessage) => Promise<AgentControlAck> | AgentControlAck): () => void;
}

import type { EmitterMixin } from 'nanoevents';
import type * as Y from 'yjs';
import type {
  DocumentController,
  DocumentSession,
  HistoryAvailability,
  SketchDocument,
} from '../domain';

/** 2: pages (document schema v2) are part of the shared state. */
export const CRDT_SCHEMA_VERSION = 2 as const;
export const CRDT_UPDATE_LIMIT_BYTES = 4 * 1024 * 1024;
export const AWARENESS_UPDATE_LIMIT_BYTES = 64 * 1024;

export type CrdtChangeSource = 'human' | 'code' | 'import' | 'agent' | 'peer' | 'persistence' | 'undo' | 'redo';

export interface CrdtCommitEvent {
  revision: number;
  source: CrdtChangeSource;
  actorId: string;
  changedElementIds: readonly string[];
  commentsChanged: boolean;
  tasksChanged: boolean;
}

export interface CrdtUpdateEvent {
  update: Uint8Array;
  source: CrdtChangeSource;
  actorId: string;
  excludePeerId?: string;
}

export interface CrdtPersistenceEvent {
  cacheKey: string;
  state: 'loading' | 'ready' | 'cleared' | 'error';
  error?: string;
}

export interface CrdtEvents {
  committed: (event: CrdtCommitEvent) => void;
  update: (event: CrdtUpdateEvent) => void;
  persistence: (event: CrdtPersistenceEvent) => void;
}

export interface RemoteUpdateContext {
  actorId: string;
  role: 'owner' | 'editor' | 'viewer';
  source: 'peer' | 'persistence';
  peerId?: string;
}

export interface CrdtDocumentController extends DocumentController, EmitterMixin<CrdtEvents> {
  /** Internal CRDT document for transport and persistence adapters. */
  readonly ydoc: Y.Doc;
  encodeStateVector(): Uint8Array;
  encodeUpdate(remoteStateVector?: Uint8Array): Uint8Array;
  applyRemoteUpdate(update: Uint8Array, context: RemoteUpdateContext): DocumentSession;
  reportPersistence(event: CrdtPersistenceEvent): void;
  destroy(): void;
}

export interface CrdtProjection {
  document: SketchDocument;
  stateVector: Uint8Array;
}

export interface CrdtPersistenceHandle {
  readonly cacheKey: string;
  readonly ready: Promise<void>;
  clear(): Promise<void>;
  destroy(): Promise<void>;
}

export interface AwarenessCursor { x: number; y: number }
export interface AwarenessAgentState { id: string; state: 'idle' | 'working' | 'waiting' | 'error' }
export interface SketchAwarenessState {
  actorId: string;
  displayName: string;
  cursor: AwarenessCursor | null;
  selectionIds: string[];
  agent: AwarenessAgentState | null;
}

export interface ValidatedAwareness {
  setLocalState(state: SketchAwarenessState | null): void;
  getStates(): ReadonlyMap<number, SketchAwarenessState>;
  encodeUpdate(clientIds?: readonly number[]): Uint8Array;
  applyRemoteUpdate(update: Uint8Array, allow: (state: SketchAwarenessState, clientId: number) => boolean): void;
  removeRemoteStates(clientIds: readonly number[]): void;
  destroy(): void;
}

export interface CrdtHistoryView extends HistoryAvailability {
  actorId: string;
}

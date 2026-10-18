export interface DomainLimits {
  readonly MAX_DOCUMENT_JSON_BYTES: number;
  readonly MAX_ELEMENTS: number;
  readonly MAX_CONTAINER_DEPTH: number;
  readonly MAX_ID_LENGTH: number;
  readonly MAX_TEXT_LENGTH: number;
  readonly MAX_POINTS_PER_ELEMENT: number;
  readonly MAX_ASSET_BYTES: number;
  readonly MAX_TOTAL_ASSET_BYTES: number;
  readonly MAX_COORDINATE_ABS: number;
  readonly MAX_DIMENSION: number;
  readonly MAX_BATCH_COMMANDS: number;
  readonly MAX_BATCH_DEPTH: number;
  readonly MAX_COMMENT_THREADS: number;
  readonly MAX_COMMENTS_PER_THREAD: number;
  readonly MAX_TASKS: number;
  readonly [key: string]: number;
}

export const DOMAIN_LIMITS: DomainLimits = Object.freeze({
  MAX_DOCUMENT_JSON_BYTES: 32 * 1024 * 1024,
  MAX_ELEMENTS: 10_000,
  MAX_CONTAINER_DEPTH: 32,
  MAX_ID_LENGTH: 128,
  MAX_TEXT_LENGTH: 50_000,
  MAX_POINTS_PER_ELEMENT: 10_000,
  MAX_ASSET_BYTES: 8 * 1024 * 1024,
  MAX_TOTAL_ASSET_BYTES: 20 * 1024 * 1024,
  MAX_COORDINATE_ABS: 1_000_000,
  MAX_DIMENSION: 1_000_000,
  MAX_BATCH_COMMANDS: 1_000,
  MAX_BATCH_DEPTH: 4,
  MAX_COMMENT_THREADS: 5_000,
  MAX_COMMENTS_PER_THREAD: 1_000,
  MAX_TASKS: 5_000,
});

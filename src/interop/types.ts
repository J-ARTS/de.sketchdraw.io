import type { ConversionWarning, ImportResult } from '../domain/types';

export type InteropFormat = 'drawio' | 'svg';

export type InteropDiagnosticSeverity = 'info' | 'warning' | 'error';

export type InteropDiagnosticEffect =
  | 'normalized'
  | 'approximated'
  | 'preserved-as-data'
  | 'omitted'
  | 'rejected';

export interface InteropDiagnostic extends ConversionWarning {
  code: string;
  severity: InteropDiagnosticSeverity;
  effect: InteropDiagnosticEffect;
  pageIndex?: number;
  elementId?: string;
  /** Parser path (e.g. /mxfile[0]/diagram[0]/mxGraphModel[0]), never an OS path. */
  sourcePath?: string;
}

export class InteropError extends Error {
  readonly code: string;
  readonly diagnostics: readonly InteropDiagnostic[];

  constructor(code: string, message: string, diagnostics: readonly InteropDiagnostic[] = []) {
    const normalizedDiagnostics =
      diagnostics.length > 0
        ? diagnostics.map((diag) => cloneDiagnostic(diag))
        : [
            {
              code,
              severity: 'error' as const,
              effect: 'rejected' as const,
              message,
            },
          ];
    super(message);
    this.name = 'InteropError';
    this.code = code;
    this.diagnostics = Object.freeze(normalizedDiagnostics);
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

export interface DrawioPageInfo {
  /** Zero-based and unambiguous, even if foreign page IDs repeat. */
  index: number;
  id?: string;
  name: string;
  encoding: 'xml' | 'deflate-base64';
}

export interface ImportOptions {
  /**
   * Explicit new identity; otherwise preserve valid own metadata,
   * or generate a fresh ID with the existing domain factory.
   */
  documentId?: string;
  /** Explicit override; otherwise own title / page name / SVG title. */
  title?: string;
}

export interface DrawioImportOptions extends ImportOptions {
  /** A zero-based page, or 'all' to import every page as a page of the document. */
  pageIndex?: number | 'all';
}

export type InteropFidelity = 'own-roundtrip' | 'supported-subset' | 'approximate';

export interface InteropImportResult extends ImportResult {
  diagnostics: InteropDiagnostic[];
  fidelity: InteropFidelity;
  requiresConfirmation: boolean;
  source: { format: InteropFormat; page?: DrawioPageInfo };
}

export interface InteropExportOptions {
  /** SVG shows one page: the page with this id (default: the first page). draw.io always exports every page. */
  pageId?: string;
  /** Default true; explicit false creates a portable projection without embedded envelope. */
  embedDocument?: boolean;
}

export interface InteropExportResult {
  format: InteropFormat;
  contents: string;
  mimeType: 'application/xml' | 'image/svg+xml';
  suggestedExtension: '.drawio' | '.svg';
  diagnostics: InteropDiagnostic[];
  requiresConfirmation: boolean;
  embedsDocument: boolean;
}

export function cloneDiagnostic(diag: InteropDiagnostic): InteropDiagnostic {
  const cloned: InteropDiagnostic = {
    code: diag.code,
    severity: diag.severity,
    effect: diag.effect,
    message: diag.message,
  };
  if (diag.sourceId !== undefined) cloned.sourceId = diag.sourceId;
  if (diag.property !== undefined) cloned.property = diag.property;
  if (diag.pageIndex !== undefined) cloned.pageIndex = diag.pageIndex;
  if (diag.elementId !== undefined) cloned.elementId = diag.elementId;
  if (diag.sourcePath !== undefined) cloned.sourcePath = diag.sourcePath;
  return cloned;
}

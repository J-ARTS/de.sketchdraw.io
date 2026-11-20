import { applyCommand, createDocument, type SketchDocument, type SketchElement } from '@/domain';
import { importMermaid, InteropError, type InteropDiagnostic, type InteropImportResult } from '@/interop';
import { ELEMENT_CLIPBOARD_FORMAT, elementClipboardPayload, planElementPaste, type ElementClipboardPayload } from '@/renderer/state/element-clipboard';
import { t } from '@/renderer/i18n';
import { parseSequenceCode } from './sequence-code';
import { buildSequence } from './sequence-model';

/**
 * Import of Mermaid code (#248). Flowcharts (`flowchart`, `graph`) are converted by the exchange layer into
 * ordinary shapes; a `sequenceDiagram` becomes a sequence diagram of the app, built by the same reader and
 * layout as the code panel, so it can be edited on the canvas and as code afterwards.
 */
export type MermaidImportKind = 'flowchart' | 'sequence' | 'other';

/** The code without a surrounding Markdown fence, as people copy it from documentation. */
function unfenced(source: string): string {
  const text = source.replace(/^﻿/, '').replace(/\r\n?/g, '\n').trim();
  const fence = /^(`{3,}|~{3,})[^\n]*\n([\s\S]*?)\n\1\s*$/.exec(text);
  return fence ? fence[2]! : text;
}

/** Which kind of diagram the code declares in its first line that is not a comment or directive. */
export function mermaidImportKind(source: string): MermaidImportKind {
  for (const raw of unfenced(source).split('\n')) {
    const line = raw.trim();
    if (!line || line.startsWith('%%')) continue;
    if (/^sequenceDiagram\b/i.test(line)) return 'sequence';
    return /^(?:flowchart|graph)\b/.test(line) ? 'flowchart' : 'other';
  }
  return 'other';
}

/** The code of a sequence diagram has errors; `diagnostics` names them by line. */
export const MERMAID_SEQUENCE_INVALID = 'MERMAID_SEQUENCE_INVALID';

function importSequence(source: string): InteropImportResult {
  const parsed = parseSequenceCode(unfenced(source));
  const diagnostics: InteropDiagnostic[] = parsed.diagnostics.map((entry) => ({
    code: entry.severity === 'error' ? MERMAID_SEQUENCE_INVALID : 'MERMAID_SEQUENCE_APPROXIMATED',
    severity: entry.severity === 'error' ? 'error' : 'warning',
    effect: entry.severity === 'error' ? 'rejected' : 'approximated',
    sourceId: t('Zeile {line}', { line: entry.line }),
    message: entry.message,
  }));
  if (diagnostics.some((entry) => entry.severity === 'error') || !parsed.model.participants.length) {
    throw new InteropError(MERMAID_SEQUENCE_INVALID, 'The sequence diagram cannot be read.', diagnostics.filter((entry) => entry.severity === 'error'));
  }
  // Built like a diagram from the library and placed like a paste, which gives every element an id of its own.
  let serial = 0;
  const payload: ElementClipboardPayload = { format: ELEMENT_CLIPBOARD_FORMAT, version: 1, elements: buildSequence(parsed.model), assets: {}, componentSets: [] };
  let document: SketchDocument = createDocument('Imported Mermaid');
  document = applyCommand(document, planElementPaste(payload, document, { x: 0, y: 0 }, (prefix) => `${prefix}:mermaid-${serial += 1}`).command);
  return {
    document,
    warnings: [],
    diagnostics,
    fidelity: diagnostics.length ? 'approximate' : 'supported-subset',
    requiresConfirmation: diagnostics.length > 0,
    source: { format: 'mermaid', pageId: document.pages[0]!.id },
  };
}

/** Converts Mermaid code into a document; throws an `InteropError` when it cannot be read. */
export function importMermaidCode(source: string): InteropImportResult {
  return mermaidImportKind(source) === 'sequence' ? importSequence(source) : importMermaid(source);
}

/** The elements of one page of an imported document as something that can be inserted into another document. */
export function importedPagePayload(document: SketchDocument, pageId: string | undefined): ElementClipboardPayload | null {
  const page = document.pages.find((entry) => entry.id === pageId) ?? document.pages[0];
  const elements: SketchElement[] = document.elements.filter((element) => element.pageId === page?.id);
  return elementClipboardPayload(document, elements.map((element) => element.id));
}

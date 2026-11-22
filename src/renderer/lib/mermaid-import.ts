import { applyCommand, createDocument, type SketchDocument, type SketchElement } from '@/domain';
import { importMermaid, InteropError, readMermaidEnvelope, type InteropDiagnostic, type InteropImportResult } from '@/interop';
import { ELEMENT_CLIPBOARD_FORMAT, elementClipboardPayload, planElementPaste, type ElementClipboardPayload } from '@/renderer/state/element-clipboard';
import { t } from '@/renderer/i18n';
import { flowToCode } from './flow-code';
import { readFlows } from './mermaid-export';
import { parseSequenceCode, sequenceToCode } from './sequence-code';
import { buildSequence, readSequences } from './sequence-model';

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

/**
 * A diagram exported by the app carries the whole document in a comment. It is restored when the code still is
 * what one of the sequence diagrams or processes on the embedded page reads as; an edited code is read as it stands.
 */
function restoreOwnDiagram(source: string): InteropImportResult | null {
  let own: ReturnType<typeof readMermaidEnvelope>;
  try { own = readMermaidEnvelope(source); } catch { return null; }
  const page = own.document?.pages[own.pageIndex ?? -1];
  if (!own.document || !page) return null;
  const visible = own.visible.replace(/\r\n?/g, '\n').trim();
  const onPage = own.document.elements.filter((element) => element.pageId === page.id);
  const unchanged = readSequences(onPage).some((diagram) => sequenceToCode(diagram.model).trim() === visible) || readFlows(onPage).some((flow) => flowToCode(flow.model).trim() === visible);
  if (!unchanged) return null;
  return {
    document: own.document,
    warnings: [],
    diagnostics: [{ code: 'EMBEDDED_MODEL_RESTORED', severity: 'info', effect: 'preserved-as-data', property: 'metadata', message: `Mermaid: Restored the complete embedded document (${own.document.pages.length} pages). The diagram was verified against page ${own.pageIndex! + 1}: ${page.name}.` }],
    fidelity: 'own-roundtrip',
    requiresConfirmation: false,
    source: { format: 'mermaid', pageId: page.id },
  };
}

function importSequence(source: string): InteropImportResult {
  const restored = restoreOwnDiagram(source);
  if (restored) return restored;
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
  if (mermaidImportKind(source) === 'sequence') return importSequence(source);
  // The flowchart of a process is the code of the code panel, not the flowchart of the whole page that the exchange
  // layer verifies; so the own export of a process is recognised here first.
  return (mermaidImportKind(source) === 'flowchart' ? restoreOwnDiagram(source) : null) ?? importMermaid(source);
}

/** The elements of one page of an imported document as something that can be inserted into another document. */
export function importedPagePayload(document: SketchDocument, pageId: string | undefined): ElementClipboardPayload | null {
  const page = document.pages.find((entry) => entry.id === pageId) ?? document.pages[0];
  const elements: SketchElement[] = document.elements.filter((element) => element.pageId === page?.id);
  return elementClipboardPayload(document, elements.map((element) => element.id));
}

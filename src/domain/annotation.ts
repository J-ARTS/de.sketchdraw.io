import type { AnnotationDocument, AnnotationRun } from './types';

export function createAnnotationDocument(text = ''): AnnotationDocument {
  return { version: 1, blocks: [{ type: 'paragraph', runs: [{ text }] }] };
}

export function annotationPlainText(document: AnnotationDocument): string {
  // Factories and import boundaries call this before validation has completed.
  // Stay total for hostile runtime values so validation can return diagnostics
  // instead of leaking an unrelated TypeError.
  const candidate = document as unknown as { blocks?: unknown } | null;
  if (!candidate || !Array.isArray(candidate.blocks)) return '';
  return candidate.blocks.map((block) => {
    if (!block || typeof block !== 'object' || !Array.isArray((block as { runs?: unknown }).runs)) return '';
    return (block as { runs: unknown[] }).runs.map((run) => (
      run && typeof run === 'object' && typeof (run as { text?: unknown }).text === 'string'
        ? (run as { text: string }).text
        : ''
    )).join('');
  }).join('\n');
}

function cloneRun(run: AnnotationRun): AnnotationRun {
  return {
    text: run.text,
    ...(run.bold ? { bold: true as const } : {}),
    ...(run.italic ? { italic: true as const } : {}),
    ...(run.underline ? { underline: true as const } : {}),
    ...(run.color ? { color: run.color } : {}),
  };
}

export function cloneAnnotationDocument(document: AnnotationDocument): AnnotationDocument {
  return {
    version: 1,
    blocks: document.blocks.map((block) => ({
      type: block.type,
      runs: block.runs.map(cloneRun),
    })),
  };
}

export function areAnnotationDocumentsEqual(
  a: AnnotationDocument | undefined,
  b: AnnotationDocument | undefined,
): boolean {
  if (a === b) return true;
  if (!a || !b || a.version !== b.version || a.blocks.length !== b.blocks.length) return false;
  return a.blocks.every((block, blockIndex) => {
    const other = b.blocks[blockIndex];
    return Boolean(other && block.type === other.type && block.runs.length === other.runs.length && block.runs.every((run, runIndex) => {
      const candidate = other.runs[runIndex];
      return Boolean(candidate && run.text === candidate.text && run.bold === candidate.bold && run.italic === candidate.italic && run.underline === candidate.underline && run.color === candidate.color);
    }));
  });
}

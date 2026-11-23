import type { SketchElement } from '@/domain';
import { t } from '@/renderer/i18n';
import { flowToCode, parseFlowCode } from './flow-code';
import { readFlow } from './flow-model';
import { parseSequenceCode, sequenceToCode, type SequenceCodeDiagnostic } from './sequence-code';
import { sequenceSelection } from './sequence-diagram';
import { readSequence, sequenceRole } from './sequence-model';
import { mermaidCodeOf, mermaidDiagramName } from './mermaid-render';

/**
 * The Mermaid code of the diagram an element belongs to (#206): a `sequenceDiagram` for a sequence diagram,
 * a `flowchart` for a process (BPMN), and the code of a diagram that Mermaid drew as an image (#279). One place
 * decides which notation applies, so the code panel and the store need not know the kinds of diagrams.
 */
export type DiagramCodeKind = 'sequence' | 'flow' | 'mermaid';
export interface DiagramCodeView {
  kind: DiagramCodeKind;
  /** An element of the diagram that names it from now on. */
  anchorId: string;
  /** What the diagram is about, to tell diagrams apart: its participants, or its pools and first steps. */
  names: string;
  code: string;
}

const flat = (text: string): string => text.replace(/\s+/g, ' ').trim();

/** The code of the diagram `anchorId` belongs to, or null when it belongs to none that has code. */
export function diagramCodeView(elements: readonly SketchElement[], anchorId: string): DiagramCodeView | null {
  const anchor = elements.find((element) => element.id === anchorId);
  if (!anchor) return null;
  const drawn = mermaidCodeOf(anchor);
  if (drawn !== null) return { kind: 'mermaid', anchorId: anchor.id, names: mermaidDiagramName(drawn), code: drawn };
  if (sequenceRole(anchor)) {
    const diagram = readSequence(elements, anchorId);
    if (!diagram) return null;
    return { kind: 'sequence', anchorId: diagram.model.participants[0]!.id, names: diagram.model.participants.map((participant) => flat(participant.name)).join(', '), code: sequenceToCode(diagram.model) };
  }
  const flow = readFlow(elements, anchorId);
  if (!flow) return null;
  const first = flow.model.nodes[0]?.id ?? flow.model.groups[0]?.id;
  if (!first) return null;
  const named = [...flow.model.groups.filter((group) => !group.parent), ...(flow.model.groups.length ? [] : flow.model.nodes)].map((entry) => flat(entry.text)).filter(Boolean);
  return { kind: 'flow', anchorId: flow.elementOf.get(first)!, names: named.slice(0, 4).join(', '), code: flowToCode(flow.model) };
}

/** The diagram with code that a selection stands for: all of it must belong to the same diagram. */
export function diagramCodeAnchor(elements: readonly SketchElement[], selection: readonly string[]): { kind: DiagramCodeKind; anchorId: string } | null {
  if (!selection.length) return null;
  const sequence = sequenceSelection(elements, selection);
  if (sequence) return { kind: 'sequence', anchorId: sequence.diagram.model.participants[0]!.id };
  const first = elements.find((element) => element.id === selection[0]);
  // An image Mermaid drew is a diagram of its own: it is the anchor when it alone is selected.
  if (first && mermaidCodeOf(first) !== null) return selection.length === 1 ? { kind: 'mermaid', anchorId: first.id } : null;
  if (!first || sequenceRole(first)) return null;
  const flow = readFlow(elements, first.id);
  if (!flow || !selection.every((id) => flow.members.has(id))) return null;
  const anchor = flow.model.nodes[0]?.id ?? flow.model.groups[0]?.id;
  return anchor ? { kind: 'flow', anchorId: flow.elementOf.get(anchor)! } : null;
}

/** What is wrong with code of the given kind, by line. */
export function diagramCodeDiagnostics(kind: DiagramCodeKind, code: string): SequenceCodeDiagnostic[] {
  // Only Mermaid can read the code of a diagram it drew; what it says comes back when the diagram is drawn again.
  if (kind === 'mermaid') return code.trim() ? [] : [{ line: 1, severity: 'error', message: t('Der Code ist leer.') }];
  return kind === 'sequence' ? parseSequenceCode(code).diagnostics : parseFlowCode(code).diagnostics;
}

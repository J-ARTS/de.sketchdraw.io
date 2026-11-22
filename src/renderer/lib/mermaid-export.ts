import { validateDocument, type SketchDocument, type SketchElement } from '@/domain';
import { InteropError, mermaidEnvelopeLine, prepareMermaidExport, type InteropDiagnostic, type InteropExportOptions, type InteropExportResult } from '@/interop';
import { flowToCode } from './flow-code';
import { readFlow, type FlowDiagram } from './flow-model';
import { sequenceToCode } from './sequence-code';
import { readSequences, sequenceRole, type SequenceDiagram } from './sequence-model';

/**
 * Export as Mermaid code (#261). A Mermaid file holds one diagram of one type, so a page is not written as a
 * whole: a sequence diagram becomes a `sequenceDiagram` – the same code the code panel shows – and everything a
 * flowchart can show becomes a `flowchart`. What Mermaid has no form for is left out rather than approximated.
 */
export interface MermaidExportTarget {
  /** `flowchart`, `sequence:` and the id of the first lifeline, or `flow:` and the id of the first element of a process. */
  id: string;
  kind: 'sequence' | 'flow' | 'flowchart';
  /** What tells this diagram apart from the others on the page: its participants, or its pools and first steps. Empty for the flowchart of the page. */
  names: string;
}

export const MERMAID_FLOWCHART_TARGET = 'flowchart';
const NOT_IN_A_FLOWCHART: ReadonlySet<SketchElement['kind']> = new Set(['connector', 'image', 'web-embed', 'table', 'annotation', 'path', 'frame']);
const flat = (text: string): string => text.replace(/\s+/g, ' ').trim();
const sequenceTargetId = (diagram: SequenceDiagram): string => `sequence:${diagram.model.participants[0]!.id}`;
const pageElements = (document: SketchDocument, pageId: string): SketchElement[] => document.elements.filter((element) => element.pageId === pageId);

/** Whether an element is, or lies inside, a part of a sequence diagram. */
function inSequence(element: SketchElement, byId: ReadonlyMap<string, SketchElement>): boolean {
  for (let current: SketchElement | undefined = element, depth = 0; current && depth < 64; current = current.parentId ? byId.get(current.parentId) : undefined, depth += 1) {
    if (sequenceRole(current)) return true;
  }
  return false;
}

/** The first element of a process in page order names it. */
const flowTargetId = (flow: FlowDiagram, elements: readonly SketchElement[]): string => `flow:${elements.find((element) => flow.members.has(element.id))!.id}`;
/** Every process on a page: shapes joined by arrows, with their pools and lanes – what the code panel shows as a flowchart. */
export function readFlows(elements: readonly SketchElement[]): FlowDiagram[] {
  const flows: FlowDiagram[] = [];
  const seen = new Set<string>();
  for (const element of elements) {
    if (seen.has(element.id) || element.kind === 'connector') continue;
    const flow = readFlow(elements, element.id);
    if (!flow || !flow.members.has(element.id)) continue;
    for (const id of flow.members) seen.add(id);
    if (flow.model.nodes.length || flow.model.groups.length) flows.push(flow);
  }
  return flows;
}
function flowNames(flow: FlowDiagram): string {
  const named = [...flow.model.groups.filter((group) => !group.parent), ...(flow.model.groups.length ? [] : flow.model.nodes)].map((entry) => flat(entry.text)).filter(Boolean);
  return named.slice(0, 4).join(', ');
}

/**
 * What a page can be exported as, in the order it is offered: every sequence diagram, every process (with the code
 * the code panel shows for it), and the flowchart of the whole page when it holds more than one single process.
 * A page without any diagram still offers the flowchart.
 */
export function mermaidExportTargets(document: SketchDocument, pageId: string): MermaidExportTarget[] {
  const elements = pageElements(document, pageId);
  const byId = new Map(elements.map((element) => [element.id, element]));
  const sequences: MermaidExportTarget[] = readSequences(elements)
    .filter((diagram) => diagram.model.participants.length > 0)
    .map((diagram) => ({ id: sequenceTargetId(diagram), kind: 'sequence', names: diagram.model.participants.map((participant) => flat(participant.name)).filter(Boolean).join(', ') }));
  const flowDiagrams = readFlows(elements);
  const flows: MermaidExportTarget[] = flowDiagrams.map((flow) => ({ id: flowTargetId(flow, elements), kind: 'flow', names: flowNames(flow) }));
  const flowchartElements = elements.filter((element) => !NOT_IN_A_FLOWCHART.has(element.kind) && !inSequence(element, byId));
  // One process that holds every shape of the page is the flowchart of the page: there is nothing else to offer.
  const onlyOneFlow = flowDiagrams.length === 1 && flowchartElements.every((element) => flowDiagrams[0]!.members.has(element.id));
  const page: MermaidExportTarget[] = (flowchartElements.length && !onlyOneFlow) || (!sequences.length && !flows.length) ? [{ id: MERMAID_FLOWCHART_TARGET, kind: 'flowchart', names: '' }] : [];
  return [...sequences, ...flows, ...page];
}

/** The target for a selection: the sequence diagram all of it belongs to, otherwise the first one that is offered. */
export function defaultMermaidExportTarget(document: SketchDocument, pageId: string, selection: readonly string[] = []): string {
  const targets = mermaidExportTargets(document, pageId);
  const elements = pageElements(document, pageId);
  const picked = selection.filter((id) => elements.some((element) => element.id === id));
  if (picked.length) {
    const diagram = readSequences(elements).find((entry) => picked.every((id) => entry.members.has(id)));
    if (diagram && targets.some((target) => target.id === sequenceTargetId(diagram))) return sequenceTargetId(diagram);
    const flow = readFlows(elements).find((entry) => picked.every((id) => entry.members.has(id)));
    if (flow && targets.some((target) => target.id === flowTargetId(flow, elements))) return flowTargetId(flow, elements);
    if (targets.some((target) => target.id === MERMAID_FLOWCHART_TARGET)) return MERMAID_FLOWCHART_TARGET;
  }
  return targets[0]!.id;
}

/** Prepares the Mermaid file of one diagram of a page. Without `target` the first diagram that is offered is taken. */
export function prepareMermaidCodeExport(document: SketchDocument, options: InteropExportOptions & { target?: string } = {}): InteropExportResult {
  const full = validateDocument(document);
  const pageId = options.pageId ?? full.pages[0]!.id;
  const pageIndex = full.pages.findIndex((page) => page.id === pageId);
  if (pageIndex < 0) throw new InteropError('PAGE_NOT_FOUND', 'The selected Mermaid export page does not exist.');
  const targets = mermaidExportTargets(full, pageId);
  const target = targets.find((entry) => entry.id === options.target) ?? targets[0]!;
  if (target.kind === 'flowchart') return prepareMermaidExport(full, { pageId, ...(options.embedDocument === undefined ? {} : { embedDocument: options.embedDocument }) });

  const elements = pageElements(full, pageId);
  const sequence = target.kind === 'sequence' ? readSequences(elements).find((entry) => sequenceTargetId(entry) === target.id)! : null;
  const flow = sequence ? null : readFlows(elements).find((entry) => flowTargetId(entry, elements) === target.id)!;
  const members = sequence ? sequence.members : flow!.members;
  const code = sequence ? sequenceToCode(sequence.model) : flowToCode(flow!.model);
  const embed = options.embedDocument !== false;
  const others = elements.filter((element) => !members.has(element.id)).length;
  const diagnostics: InteropDiagnostic[] = [
    ...(others ? [{ code: 'MERMAID_ELEMENTS_OMITTED', severity: 'warning', effect: embed ? 'approximated' : 'omitted', property: 'elements', message: `${others} element(s) of the page are not part of this diagram and not in the Mermaid code.` } satisfies InteropDiagnostic] : []),
    ...(embed ? [{ code: 'MERMAID_EMBEDDED_DOCUMENT', severity: 'info', effect: 'preserved-as-data', property: 'metadata', message: 'Mermaid: The comment contains the complete document. Other Mermaid tools ignore these data.' } satisfies InteropDiagnostic] : []),
  ];
  const contents = `${code.endsWith('\n') ? code : `${code}\n`}${embed ? `${mermaidEnvelopeLine(full, pageIndex)}\n` : ''}`;
  return { format: 'mermaid', contents, mimeType: 'text/plain', suggestedExtension: '.mmd', diagnostics, requiresConfirmation: diagnostics.some((entry) => entry.severity === 'warning'), embedsDocument: embed };
}

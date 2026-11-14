import type { DocumentCommand, ElementPatch, Point, SketchDocument, SketchElement } from '@/domain';
import { SEQUENCE_LIFELINE, SEQUENCE_ROLE_KEY, sequenceLifeline, sequenceMessage, type SequenceRole } from './diagram-libraries';

/**
 * Extending a sequence diagram by click (#192). The parts are ordinary elements marked in their metadata
 * (see diagram-libraries.ts): a lifeline is a container with its head and its dashed line as children, a
 * message is a connector bound to two lifeline containers.
 */
export interface SequenceContext {
  /** The lifeline the selection belongs to. */
  lifeline: SketchElement;
  /** All lifelines of the same diagram, left to right. */
  lifelines: SketchElement[];
  /** The messages between those lifelines. */
  messages: SketchElement[];
}
export interface SequencePlan { command: DocumentCommand; selection: string[] }

const roleOf = (element: SketchElement | undefined): SequenceRole | undefined => element?.metadata?.[SEQUENCE_ROLE_KEY] as SequenceRole | undefined;
const isLifeline = (element: SketchElement | undefined): boolean => element?.kind === 'container' && roleOf(element) === 'lifeline';
const centreX = (lifeline: SketchElement): number => lifeline.x + lifeline.width / 2;
/** Height of a message end on its lifeline, in document coordinates. */
const messageY = (message: SketchElement, byId: Map<string, SketchElement>): number => {
  const end = message.from ?? message.to;
  const lifeline = end ? byId.get(end.elementId) : undefined;
  return lifeline && end ? lifeline.y + end.anchor.y * lifeline.height : message.y;
};

/** The sequence diagram a selection belongs to: a lifeline, one of its parts, or a message between lifelines. */
export function sequenceContext(document: SketchDocument, pageId: string, selection: readonly string[]): SequenceContext | null {
  if (selection.length !== 1) return null;
  const onPage = document.elements.filter((element) => (element.pageId ?? document.pages[0]?.id) === pageId);
  const byId = new Map(onPage.map((element) => [element.id, element]));
  const selected = byId.get(selection[0]!);
  if (!selected) return null;
  const candidate = isLifeline(selected) ? selected
    : selected.parentId && ['head', 'line'].includes(roleOf(selected) ?? '') ? byId.get(selected.parentId)
    : selected.kind === 'connector' && roleOf(selected) === 'message' ? byId.get(selected.from?.elementId ?? '') ?? byId.get(selected.to?.elementId ?? '')
    : undefined;
  if (!candidate || !isLifeline(candidate)) return null;
  // One page may hold several diagrams: lifelines belong together when they overlap vertically.
  const lifelines = onPage
    .filter((element) => isLifeline(element) && element.y < candidate.y + candidate.height && candidate.y < element.y + element.height)
    .sort((a, b) => a.x - b.x);
  const ids = new Set(lifelines.map((lifeline) => lifeline.id));
  const messages = onPage.filter((element) => element.kind === 'connector' && roleOf(element) === 'message' && Boolean(element.from && ids.has(element.from.elementId)) && Boolean(element.to && ids.has(element.to.elementId)));
  return { lifeline: candidate, lifelines, messages };
}

function nextName(lifelines: readonly SketchElement[], base: string): string {
  const taken = new Set(lifelines.map((lifeline) => lifeline.label));
  for (let index = lifelines.length + 1; ; index += 1) if (!taken.has(`${base} ${index}`)) return `${base} ${index}`;
}
function lifelineAt(context: SequenceContext, createId: (prefix: string) => string, base: string, height: number): SketchElement[] {
  const last = context.lifelines[context.lifelines.length - 1]!;
  const top = Math.min(...context.lifelines.map((lifeline) => lifeline.y));
  return sequenceLifeline(createId('container'), { x: last.x + last.width + SEQUENCE_LIFELINE.gap, y: top }, nextName(context.lifelines, base), height);
}

/** A new lifeline right of the outermost one, as tall as the diagram. */
export function planAddLifeline(context: SequenceContext, createId: (prefix: string) => string, base: string): SequencePlan {
  const height = Math.max(...context.lifelines.map((lifeline) => lifeline.y + lifeline.height)) - Math.min(...context.lifelines.map((lifeline) => lifeline.y));
  const elements = lifelineAt(context, createId, base, height);
  return { command: { type: 'add', elements }, selection: [elements[0]!.id] };
}

/**
 * A new message from the selection's lifeline to its right neighbour (the left one at the right edge; a new
 * lifeline when there is only one), below the lowest message. Lifelines that are too short grow, and the
 * messages already on them keep their height.
 */
export function planAddMessage(context: SequenceContext, document: SketchDocument, createId: (prefix: string) => string, text: string, base: string): SequencePlan {
  const byId = new Map(document.elements.map((element) => [element.id, element]));
  const commands: DocumentCommand[] = [];
  let lifelines = context.lifelines;
  const index = lifelines.findIndex((lifeline) => lifeline.id === context.lifeline.id);
  let target = lifelines[index + 1] ?? lifelines[index - 1];
  const top = Math.min(...lifelines.map((lifeline) => lifeline.y));
  const lowest = context.messages.length ? Math.max(...context.messages.map((message) => messageY(message, byId))) : null;
  const y = lowest === null ? top + SEQUENCE_LIFELINE.firstMessage : lowest + SEQUENCE_LIFELINE.messageStep;
  const bottom = Math.max(y + SEQUENCE_LIFELINE.messageStep, ...lifelines.map((lifeline) => lifeline.y + lifeline.height));

  // Grow every lifeline that ends above the new bottom; anchors are fractions of the height, so the messages
  // on a grown lifeline get new fractions for their unchanged heights.
  const grown = new Map<string, SketchElement>();
  for (const lifeline of lifelines) {
    if (lifeline.y + lifeline.height >= bottom) continue;
    const height = bottom - lifeline.y;
    grown.set(lifeline.id, { ...lifeline, height });
    const changes: Array<{ id: string; patch: ElementPatch }> = [{ id: lifeline.id, patch: { height } }];
    const line = document.elements.find((element) => element.parentId === lifeline.id && roleOf(element) === 'line');
    if (line) { const length = lifeline.y + height - line.y; changes.push({ id: line.id, patch: { height: length, points: [{ x: 0, y: 0 }, { x: 0, y: length }] } }); }
    commands.push({ type: 'update', changes });
  }
  if (grown.size) {
    lifelines = lifelines.map((lifeline) => grown.get(lifeline.id) ?? lifeline);
    const fraction = (lifeline: SketchElement, at: number): Point => ({ x: 0.5, y: Math.max(0, Math.min(1, (at - lifeline.y) / Math.max(1, lifeline.height))) });
    const changes = context.messages.filter((message) => grown.has(message.from!.elementId) || grown.has(message.to!.elementId)).map((message) => {
      const at = messageY(message, byId);
      const from = lifelines.find((lifeline) => lifeline.id === message.from!.elementId)!;
      const to = lifelines.find((lifeline) => lifeline.id === message.to!.elementId)!;
      const left = Math.min(centreX(from), centreX(to));
      return { id: message.id, patch: {
        from: { elementId: from.id, anchor: fraction(from, at) }, to: { elementId: to.id, anchor: fraction(to, at) },
        x: left, y: at, width: Math.abs(centreX(to) - centreX(from)), height: 0,
        points: [{ x: centreX(from) - left, y: 0 }, { x: centreX(to) - left, y: 0 }],
      } satisfies ElementPatch };
    });
    if (changes.length) commands.push({ type: 'update', changes });
  }

  const source = lifelines[index]!;
  const added: SketchElement[] = [];
  if (!target) {
    const created = lifelineAt({ ...context, lifelines }, createId, base, bottom - top);
    added.push(...created);
    target = created[0]!;
  } else target = lifelines.find((lifeline) => lifeline.id === target!.id)!;
  const message = sequenceMessage(createId('connector'), source, target, y, text);
  commands.push({ type: 'add', elements: [...added, message] });
  return { command: commands.length === 1 ? commands[0]! : { type: 'batch', commands }, selection: [message.id] };
}

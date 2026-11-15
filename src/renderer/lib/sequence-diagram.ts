import type { DocumentCommand, SketchElement } from '@/domain';
import {
  isSequenceLifeline, locateSequenceItem, planSequence, readSequence, readSequences, sequenceRole,
  type SequenceDiagram, type SequenceItem, type SequenceMessage, type SequenceMessageKind, type SequenceModel, type SequenceParticipant,
} from './sequence-model';

/**
 * Editing a sequence diagram by click (#192, #199): every action changes the diagram's model and lets the one
 * layout in sequence-model.ts place everything. Changes people make to parts of a diagram in other ways
 * (text, moving, deleting, dropping a fragment on it) go through the same layout, see `withSequenceLayout`.
 */
export interface SequenceSelection {
  diagram: SequenceDiagram;
  /** The lifeline the selection stands for, when it is a lifeline or one of its parts. */
  lifelineId: string | null;
  /** The selected message, note or fragment; for a divider its fragment. */
  itemId: string | null;
  /** The selected divider of a fragment. */
  sectionId: string | null;
}
export interface SequenceEdit { command: DocumentCommand | null; selection: string[] }
export type SequenceAddition = SequenceMessageKind | 'self';
export interface SequenceTexts { message: string; reply: string; participant: string }

/** The lifeline a selection stands for: the lifeline itself or its head, line or an activation. */
export function selectedLifeline(elements: readonly SketchElement[], id: string | undefined): SketchElement | null {
  const element = elements.find((candidate) => candidate.id === id);
  if (!element) return null;
  if (isSequenceLifeline(element)) return element;
  const part = sequenceRole(element);
  if (!element.parentId || !(part === 'head' || part === 'line' || part === 'activation')) return null;
  const parent = elements.find((candidate) => candidate.id === element.parentId);
  return parent && isSequenceLifeline(parent) ? parent : null;
}

/** What a single selected element is in its sequence diagram, or null when it is not part of one. */
export function sequenceSelection(elements: readonly SketchElement[], selection: readonly string[]): SequenceSelection | null {
  if (selection.length !== 1) return null;
  const selected = elements.find((element) => element.id === selection[0]);
  if (!selected || !sequenceRole(selected)) return null;
  const lifeline = selectedLifeline(elements, selected.id);
  const divider = sequenceRole(selected) === 'divider' && selected.parentId ? selected : null;
  const diagram = readSequence(elements, lifeline?.id ?? divider?.parentId ?? selected.id);
  if (!diagram) return null;
  if (lifeline) return { diagram, lifelineId: lifeline.id, itemId: null, sectionId: null };
  if (divider) return { diagram, lifelineId: null, itemId: divider.parentId!, sectionId: divider.id };
  return diagram.members.has(selected.id) ? { diagram, lifelineId: null, itemId: selected.id, sectionId: null } : null;
}

function nextName(participants: readonly SequenceParticipant[], base: string): string {
  const taken = new Set(participants.map((participant) => participant.name));
  for (let index = participants.length + 1; ; index += 1) if (!taken.has(`${base} ${index}`)) return `${base} ${index}`;
}
const copy = (model: SequenceModel): SequenceModel => structuredClone(model);
const finish = (elements: readonly SketchElement[], selection: SequenceSelection, model: SequenceModel, pageId: string, select: string): SequenceEdit =>
  ({ command: planSequence(elements, selection.diagram, model, { pageId }).command, selection: [select] });

/** A new lifeline right of the selected one; the lifelines further right move over. */
export function addSequenceLifeline(elements: readonly SketchElement[], selection: SequenceSelection, pageId: string, createId: (prefix: string) => string, texts: SequenceTexts): SequenceEdit {
  const model = copy(selection.diagram.model);
  const selected = selection.itemId ? locateSequenceItem(model.items, selection.itemId) : null;
  const item = selected && selected.index >= 0 ? selected.list[selected.index] : undefined;
  // Beside the selected lifeline; for a message beside the right one of its two lifelines.
  const order = model.participants.map((participant) => participant.id);
  const beside = selection.lifelineId ?? (item?.type === 'message' ? [item.from, item.to].sort((a, b) => order.indexOf(a) - order.indexOf(b))[1]! : order.at(-1)!);
  const added: SequenceParticipant = { id: createId('container'), name: nextName(model.participants, texts.participant), actor: false };
  model.participants.splice(order.indexOf(beside) + 1, 0, added);
  return finish(elements, selection, model, pageId, added.id);
}

/** Who a lifeline would answer: the sender of the last call into it that has no reply yet. */
function openCaller(messages: readonly SequenceMessage[], lifelineId: string): string | null {
  const open = new Map<string, string[]>();
  for (const message of messages) {
    if (message.from === message.to) continue;
    if (message.kind === 'reply') open.get(message.from)?.pop();
    else if (message.kind === 'sync') open.set(message.to, [...(open.get(message.to) ?? []), message.from]);
  }
  return open.get(lifelineId)?.at(-1) ?? null;
}
/** The messages that happen before position `index` of `list`, a list somewhere in `items`. */
function messagesBefore(items: readonly SequenceItem[], list: readonly SequenceItem[], index: number): SequenceMessage[] {
  const before: SequenceMessage[] = [];
  let reached = false;
  const walk = (current: readonly SequenceItem[]): void => {
    for (let at = 0; at < current.length && !reached; at += 1) {
      if (current === list && at === index) { reached = true; return; }
      const item = current[at]!;
      if (item.type === 'message') before.push(item);
      else if (item.type === 'fragment') for (const section of item.sections) { if (!reached) walk(section.items); }
    }
    if (current === list) reached = true;
  };
  walk(items);
  return before;
}

/**
 * A new message, reply or call to oneself. With a message, note or fragment selected it comes directly below
 * (inside a selected fragment: at the end of the selected section), with a lifeline selected at the end.
 */
export function addSequenceMessage(elements: readonly SketchElement[], selection: SequenceSelection, kind: SequenceAddition, pageId: string, createId: (prefix: string) => string, texts: SequenceTexts): SequenceEdit {
  const model = copy(selection.diagram.model);
  const order = model.participants.map((participant) => participant.id);
  let list = model.items;
  let index = list.length;
  let above: SequenceItem | undefined;
  if (selection.itemId) {
    const found = locateSequenceItem(model.items, selection.sectionId ?? selection.itemId);
    if (found && found.index < 0) { list = found.list; index = list.length; }
    else if (found) {
      const item = found.list[found.index]!;
      // A fragment takes the message in: at the end of its last section.
      if (item.type === 'fragment' && !selection.sectionId) { list = item.sections.at(-1)!.items; index = list.length; }
      else { list = found.list; index = found.index + 1; above = item; }
    }
  }
  const before = messagesBefore(model.items, list, index);
  const neighbour = (id: string, direction: number): string | undefined => order[order.indexOf(id) + direction];
  const ensureOther = (id: string): string => {
    const other = neighbour(id, 1) ?? neighbour(id, -1);
    if (other) return other;
    const added: SequenceParticipant = { id: createId('container'), name: nextName(model.participants, texts.participant), actor: false };
    model.participants.push(added);
    order.push(added.id);
    return added.id;
  };
  const selectedMessage = above?.type === 'message' ? above : null;
  const start = selection.lifelineId ?? order[0]!;
  let from: string;
  let to: string;
  if (kind === 'self') {
    from = to = selectedMessage ? selectedMessage.to : start;
  } else if (kind === 'reply') {
    if (selectedMessage && selectedMessage.kind !== 'reply' && selectedMessage.from !== selectedMessage.to) { from = selectedMessage.to; to = selectedMessage.from; }
    else {
      // After a reply, or from a lifeline: back to whoever is still waiting for an answer.
      from = selectedMessage ? selectedMessage.to : selection.lifelineId ?? before.at(-1)?.to ?? start;
      to = openCaller(before, from) ?? (selectedMessage && selectedMessage.from !== from ? selectedMessage.from : neighbour(from, -1) ?? ensureOther(from));
    }
  } else if (selectedMessage) {
    if (selectedMessage.kind === 'reply' || selectedMessage.from === selectedMessage.to) { from = selectedMessage.to; to = selectedMessage.kind === 'reply' && selectedMessage.from !== from ? selectedMessage.from : ensureOther(from); }
    else {
      // The call goes on: from the receiver to the next lifeline in the same direction, if there is one.
      const direction = Math.sign(order.indexOf(selectedMessage.to) - order.indexOf(selectedMessage.from));
      const next = neighbour(selectedMessage.to, direction);
      [from, to] = next ? [selectedMessage.to, next] : [selectedMessage.from, selectedMessage.to];
    }
  } else { from = start; to = ensureOther(from); }
  const message: SequenceMessage = { type: 'message', id: createId('connector'), from, to, text: kind === 'reply' ? texts.reply : texts.message, kind: kind === 'self' ? 'sync' : kind };
  list.splice(index, 0, message);
  return finish(elements, selection, model, pageId, message.id);
}

/** Turns the running numbers of the diagram's messages on or off. */
export function toggleSequenceNumbers(elements: readonly SketchElement[], selection: SequenceSelection, pageId: string, select: string): SequenceEdit {
  const model = copy(selection.diagram.model);
  model.autonumber = !model.autonumber;
  return finish(elements, selection, model, pageId, select);
}

function touchedIds(command: DocumentCommand, into: Set<string> = new Set()): Set<string> {
  if (command.type === 'update') for (const change of command.changes) into.add(change.id);
  else if (command.type === 'delete') for (const id of command.ids) into.add(id);
  else if (command.type === 'add') for (const element of command.elements) into.add(element.id);
  else if (command.type === 'batch') for (const inner of command.commands) touchedIds(inner, into);
  return into;
}
const addedElements = (command: DocumentCommand): SketchElement[] => command.type === 'add' ? command.elements : command.type === 'batch' ? command.commands.flatMap(addedElements) : [];
const hasSequence = (elements: readonly SketchElement[]): boolean => elements.some((element) => Boolean(sequenceRole(element)));

/**
 * `command` followed by the layout of every sequence diagram it touches, as one command. `apply` returns the
 * page's elements after a command, or null when the command cannot be applied. A command that leaves the
 * diagrams as the layout would place them comes back unchanged.
 */
export function withSequenceLayout(elements: readonly SketchElement[], command: DocumentCommand, pageId: string, apply: (command: DocumentCommand) => readonly SketchElement[] | null): DocumentCommand {
  // Nothing of a sequence diagram on the page and none coming in: nothing to do, and nothing to compute.
  if (!hasSequence(elements) && !hasSequence(addedElements(command))) return command;
  const touched = touchedIds(command);
  if (!touched.size) return command;
  let after = apply(command);
  if (!after || !hasSequence(after)) return command;
  // A command that changes nothing (a click without a drag) is no reason to lay anything out.
  const was = new Map(elements.map((element) => [element.id, element]));
  const now = new Map(after.map((element) => [element.id, element]));
  if ([...touched].every((id) => JSON.stringify(was.get(id)) === JSON.stringify(now.get(id)))) return command;
  // Diagrams that lost a part are found again through their lifelines.
  const lifelinesBefore = new Set<string>();
  for (const diagram of readSequences(elements)) {
    if (![...diagram.members].some((id) => touched.has(id))) continue;
    for (const participant of diagram.model.participants) lifelinesBefore.add(participant.id);
  }
  const affected = (diagram: SequenceDiagram): boolean => [...diagram.members].some((id) => touched.has(id)) || diagram.model.participants.some((participant) => lifelinesBefore.has(participant.id));
  const commands: DocumentCommand[] = [command];
  const done = new Set<string>();
  for (let pass = 0; pass < 32; pass += 1) {
    const diagram = readSequences(after).find((candidate) => affected(candidate) && !done.has(candidate.model.participants[0]!.id));
    if (!diagram) break;
    done.add(diagram.model.participants[0]!.id);
    const plan = planSequence(after, diagram, diagram.model, { pageId }).command;
    if (!plan) continue;
    commands.push(plan);
    const next = apply({ type: 'batch', commands });
    if (!next) { commands.pop(); continue; }
    after = next;
  }
  return commands.length === 1 ? command : { type: 'batch', commands };
}

import { describe, expect, test } from 'vitest';
import { applyCommand, createDocument, type DocumentCommand, type SketchDocument, type SketchElement } from '@/domain';
import { connectorLabelPlacement, connectorLabelSize } from '@/renderer/lib/connector-label';
import { diagramTemplate } from '@/renderer/lib/diagram-libraries';
import { addSequenceLifeline, addSequenceMessage, moveSequenceMessage, sequenceSelection, toggleSequenceNumbers, withSequenceLayout, type SequenceEdit } from '@/renderer/lib/sequence-diagram';
import {
  buildSequence, messageKind, planSequence, readSequence, readSequences, sequenceFragmentElements, sequenceMessages, sequenceNoteElement, sequenceRole,
  SEQUENCE_COLOURS, SEQUENCE_LAYOUT, SEQUENCE_LIFELINE, SEQUENCE_NUMBER_KEY, type SequenceFragment, type SequenceItem, type SequenceModel,
} from '@/renderer/lib/sequence-model';
import { planElementPaste } from '@/renderer/state/element-clipboard';

let counter = 0;
const createId = (prefix: string) => `${prefix}:t${counter += 1}`;
const texts = { message: 'Nachricht', reply: 'Antwort', participant: 'Teilnehmer' };
const page = (document: SketchDocument): SketchElement[] => document.elements.filter((element) => element.pageId === document.pages[0]!.id);
const pageId = (document: SketchDocument) => document.pages[0]!.id;

const message = (id: string, from: string, to: string, text = id, kind: 'sync' | 'async' | 'reply' = 'sync'): SequenceItem => ({ type: 'message', id, from, to, text, kind });
const three = (items: SequenceItem[], autonumber = false): SequenceModel => ({
  autonumber,
  participants: [{ id: 'a', name: 'Client', actor: false }, { id: 'b', name: 'Dienst', actor: false }, { id: 'c', name: 'Bank', actor: false }],
  items,
});
function documentOf(model: SequenceModel, at = { x: 100, y: 100 }): SketchDocument {
  const document = createDocument('Sequence');
  return applyCommand(document, { type: 'add', elements: buildSequence(model, at).map((element) => ({ ...element, pageId: document.pages[0]!.id })) });
}
const by = (document: SketchDocument, id: string): SketchElement => document.elements.find((element) => element.id === id)!;
/** Height and both ends of a message as drawn, in document coordinates. */
const drawn = (element: SketchElement) => ({ from: { x: element.x + element.points![0]!.x, y: element.y + element.points![0]!.y }, to: { x: element.x + element.points!.at(-1)!.x, y: element.y + element.points!.at(-1)!.y } });
const centre = (element: SketchElement) => element.x + element.width / 2;
const activations = (document: SketchDocument, lifelineId: string) => page(document).filter((element) => element.parentId === lifelineId && sequenceRole(element) === 'activation').sort((a, b) => a.y - b.y);
const edit = (document: SketchDocument, selected: string, run: (selection: NonNullable<ReturnType<typeof sequenceSelection>>) => SequenceEdit): { document: SketchDocument; selection: string[] } => {
  const result = run(sequenceSelection(page(document), [selected])!);
  return { document: applyCommand(document, result.command!), selection: result.selection };
};
const order = (document: SketchDocument, anchor = 'a') => sequenceMessages(readSequence(page(document), anchor)!.model.items).map((entry) => entry.text);

describe('reading and laying out a sequence diagram (#199)', () => {
  test('a model becomes elements and reads back as the same model; laying it out again changes nothing', () => {
    const loop: SequenceFragment = { type: 'fragment', id: 'f', operator: 'alt', sections: [
      { id: null, label: 'ok', items: [message('m2', 'b', 'c', 'prüfen'), message('m3', 'c', 'b', 'frei', 'reply')] },
      { id: 'f:else', label: 'sonst', items: [message('m4', 'b', 'b', 'verwerfen')] },
    ] };
    const model = three([message('m1', 'a', 'b', 'bestellen'), loop, { type: 'note', id: 'n', text: 'Ein Auftrag', side: 'over', from: 'a', to: 'c' }, message('m5', 'b', 'a', 'fertig', 'reply')], true);
    const document = documentOf(model);
    const read = readSequence(page(document), 'm3')!;
    expect(read.model).toEqual(model);
    // Every part is a member, including heads, lines, activations and the divider.
    expect(read.members.has('a:head') && read.members.has('a:line') && read.members.has('f:else') && read.members.has('n')).toBe(true);
    expect(planSequence(page(document), read, read.model, { pageId: pageId(document) }).command).toBeNull();
  });

  test('messages run level between their lifelines, top to bottom in equal steps, with their text above the arrow', () => {
    const document = documentOf(three([message('m1', 'a', 'b', 'eins', 'async'), message('m2', 'b', 'c', 'zwei', 'async'), message('m3', 'c', 'a', 'drei', 'async')]));
    const [one, two, three_] = ['m1', 'm2', 'm3'].map((id) => drawn(by(document, id)));
    for (const entry of [one!, two!, three_!]) expect(entry.from.y).toBe(entry.to.y);
    expect(one!.from.y).toBe(100 + SEQUENCE_LIFELINE.firstMessage);
    expect(two!.from.y - one!.from.y).toBe(SEQUENCE_LAYOUT.step);
    expect(three_!.from.y - two!.from.y).toBe(SEQUENCE_LAYOUT.step);
    // Without activations the ends sit on the lifelines.
    expect([one!.from.x, one!.to.x]).toEqual([centre(by(document, 'a')), centre(by(document, 'b'))]);
    expect(connectorLabelPlacement(by(document, 'm1'))).toBe('above');
    // The lifelines are as tall as the diagram needs, and all the same.
    const heights = ['a', 'b', 'c'].map((id) => by(document, id).height);
    expect(new Set(heights).size).toBe(1);
    expect(100 + heights[0]!).toBeGreaterThan(three_!.from.y);
    expect(by(document, 'a:line').height).toBe(heights[0]! - SEQUENCE_LIFELINE.headHeight);
  });

  test('a text with several lines makes room above its message, a single line does not', () => {
    const plain = documentOf(three([message('m1', 'a', 'b', 'eins'), message('m2', 'b', 'a', 'zwei', 'reply')]));
    const tall = documentOf(three([message('m1', 'a', 'b', 'eins'), message('m2', 'b', 'a', 'zwei\ndrei\nvier\nfünf', 'reply')]));
    const gap = (document: SketchDocument) => drawn(by(document, 'm2')).from.y - drawn(by(document, 'm1')).from.y;
    expect(gap(plain)).toBe(SEQUENCE_LAYOUT.step);
    expect(gap(tall)).toBeGreaterThan(SEQUENCE_LAYOUT.step + 2 * 14);
    expect(by(tall, 'a').height).toBeGreaterThan(by(plain, 'a').height);
  });

  test('a call activates its receiver until the reply; nested calls nest, async calls and unanswered ones differ', () => {
    const document = documentOf(three([
      message('m1', 'a', 'b'), message('m2', 'b', 'c'), message('m3', 'c', 'b', 'r1', 'reply'), message('m4', 'b', 'a', 'r2', 'reply'),
      message('m5', 'a', 'c', 'fire', 'async'), message('m6', 'a', 'b', 'offen'),
    ]));
    const y = (id: string) => drawn(by(document, id)).from.y;
    const [first, open] = activations(document, 'b');
    expect([first!.y, first!.y + first!.height]).toEqual([y('m1'), y('m4')]);
    // Never answered: active to the end of the diagram.
    expect(open!.y).toBe(y('m6'));
    expect(open!.y + open!.height).toBeGreaterThan(y('m6'));
    const [bank] = activations(document, 'c');
    expect([bank!.y, bank!.y + bank!.height]).toEqual([y('m2'), y('m3')]);
    // The asynchronous call opened nothing, and the first caller has no box.
    expect(activations(document, 'c')).toHaveLength(1);
    expect(activations(document, 'a')).toHaveLength(0);
    // Arrows end at the edge of the activation, not in its middle.
    const half = SEQUENCE_LAYOUT.activation / 2;
    expect(drawn(by(document, 'm1')).to.x).toBe(centre(by(document, 'b')) - half);
    expect(drawn(by(document, 'm2')).from.x).toBe(centre(by(document, 'b')) + half);
    expect(drawn(by(document, 'm4')).from.x).toBe(centre(by(document, 'b')) - half);
  });

  test('a call to oneself is a loop on its lifeline with the text beside it', () => {
    const document = documentOf(three([message('m1', 'a', 'b'), message('m2', 'b', 'b', 'prüfen'), message('m3', 'b', 'a', 'ok', 'reply')]));
    const loop = by(document, 'm2');
    expect(loop.from!.elementId).toBe('b');
    expect(loop.to!.elementId).toBe('b');
    expect(loop.connectorRouting).toBe('elbowed');
    expect(loop.points).toHaveLength(4);
    const ends = drawn(loop);
    expect(ends.to.y - ends.from.y).toBe(SEQUENCE_LAYOUT.loopHeight);
    expect(ends.from.x).toBe(ends.to.x);
    expect(loop.width).toBe(SEQUENCE_LAYOUT.loopWidth);
    expect(connectorLabelPlacement(loop)).toBe('right');
    // The next message comes below the loop.
    expect(drawn(by(document, 'm3')).from.y).toBe(ends.to.y + SEQUENCE_LAYOUT.step);
    // On an idle lifeline the loop gets a short activation of its own.
    const idle = documentOf(three([message('m1', 'a', 'a', 'denken')]));
    expect(activations(idle, 'a')).toHaveLength(1);
  });

  test('numbers count the messages in the order they happen, also through fragments', () => {
    const inner: SequenceFragment = { type: 'fragment', id: 'f', operator: 'loop', sections: [{ id: null, label: 'täglich', items: [message('m2', 'b', 'c'), message('m3', 'c', 'b', 'r', 'reply')] }] };
    const document = documentOf(three([message('m1', 'a', 'b'), inner, message('m4', 'b', 'a', 'r', 'reply')], true));
    expect(['m1', 'm2', 'm3', 'm4'].map((id) => by(document, id).metadata?.[SEQUENCE_NUMBER_KEY])).toEqual(['1', '2', '3', '4']);
    const off = documentOf(three([message('m1', 'a', 'b')]));
    expect(by(off, 'm1').metadata?.[SEQUENCE_NUMBER_KEY]).toBeUndefined();
  });

  test('a fragment frames its messages, nested ones lie inside, dividers cross the frame between the sections', () => {
    const inner: SequenceFragment = { type: 'fragment', id: 'in', operator: 'opt', sections: [{ id: null, label: 'neu', items: [message('m3', 'b', 'c', 'anlegen', 'async')] }] };
    const outer: SequenceFragment = { type: 'fragment', id: 'out', operator: 'alt', sections: [
      { id: null, label: 'ok', items: [message('m2', 'a', 'b', 'weiter', 'async'), inner] },
      { id: 'out:else', label: 'sonst', items: [message('m4', 'a', 'b', 'abbrechen', 'async')] },
    ] };
    const document = documentOf(three([message('m1', 'a', 'b', 'start', 'async'), outer, message('m5', 'b', 'a', 'ende', 'async')]));
    const [out, inn, divider] = [by(document, 'out'), by(document, 'in'), by(document, 'out:else')];
    const y = (id: string) => drawn(by(document, id)).from.y;
    // Around its own messages, not around the ones before and after.
    expect(out.y).toBeGreaterThan(y('m1'));
    expect(out.y).toBeLessThan(y('m2'));
    expect(out.y + out.height).toBeGreaterThan(y('m4'));
    expect(out.y + out.height).toBeLessThan(y('m5'));
    // The inner fragment lies inside the outer one, on every side.
    expect(inn.x).toBeGreaterThan(out.x);
    expect(inn.x + inn.width).toBeLessThan(out.x + out.width);
    expect(inn.y).toBeGreaterThan(y('m2'));
    expect(inn.y + inn.height).toBeLessThan(divider.y);
    // It spans the lifelines it involves.
    expect(out.x).toBeLessThan(centre(by(document, 'a')));
    expect(out.x + out.width).toBeGreaterThan(centre(by(document, 'c')));
    // The divider belongs to the frame and crosses it between the two sections.
    expect([divider.parentId, divider.x, divider.width]).toEqual(['out', out.x, out.width]);
    expect(divider.y).toBeGreaterThan(inn.y + inn.height);
    expect(divider.y).toBeLessThan(y('m4'));
  });

  test('a fragment dropped over messages takes them in; a note lies over the lifelines it covers', () => {
    let document = documentOf(three([message('m1', 'a', 'b', 'eins', 'async'), message('m2', 'b', 'c', 'zwei', 'async'), message('m3', 'c', 'a', 'drei', 'async')]));
    const y = (id: string) => drawn(by(document, id)).from.y;
    const frame = sequenceFragmentElements('f', { x: 120, y: y('m2') - 20, width: 300, height: 40 }, 'loop', 'bis fertig').map((element) => ({ ...element, pageId: pageId(document) }));
    const note = { ...sequenceNoteElement('n', { x: centre(by(document, 'b')) - 30, y: y('m3') + 10, width: 260, height: 40 }, 'Hinweis'), pageId: pageId(document) };
    const before = page(document);
    const apply = (command: DocumentCommand) => { try { return page(applyCommand(document, command)); } catch { return null; } };
    document = applyCommand(document, withSequenceLayout(before, { type: 'add', elements: [...frame, note] }, pageId(document), apply));
    const model = readSequence(page(document), 'a')!.model;
    expect(model.items.map((item) => item.type)).toEqual(['message', 'fragment', 'message', 'note']);
    const fragment = model.items[1] as SequenceFragment;
    expect(sequenceMessages(fragment.sections[0]!.items).map((entry) => entry.id)).toEqual(['m2']);
    // The frame was fitted around the message, and the note spans the lifelines it covered.
    const f = by(document, 'f');
    expect(f.y).toBeLessThan(y('m2'));
    expect(f.y + f.height).toBeGreaterThan(y('m2'));
    expect(f.y + f.height).toBeLessThan(y('m3'));
    expect(model.items[3]).toMatchObject({ side: 'over', from: 'b', to: 'c' });
    expect(by(document, 'n').y).toBeGreaterThan(y('m3'));
  });

  test('two diagrams on a page stay two, also when one is a copy laid over the other', () => {
    const model = three([message('m1', 'a', 'b'), message('m2', 'b', 'c'), message('m3', 'c', 'a', 'r', 'reply')]);
    let document = documentOf(model);
    const copy = buildSequence(model, { x: 124, y: 124 }).map((element) => ({ ...element, pageId: pageId(document) }));
    const renamed = JSON.parse(JSON.stringify(copy).replace(/"(a|b|c|m1|m2|m3)(:[a-z0-9]+)?"/g, '"x$1$2"')) as SketchElement[];
    document = applyCommand(document, { type: 'add', elements: renamed });
    const diagrams = readSequences(page(document));
    expect(diagrams.map((diagram) => diagram.model.participants.map((participant) => participant.id))).toEqual([['a', 'b', 'c'], ['xa', 'xb', 'xc']]);
    expect(diagrams.map((diagram) => sequenceMessages(diagram.model.items).length)).toEqual([3, 3]);
  });

  test('how a message is drawn says what it is', () => {
    const document = documentOf(three([message('m1', 'a', 'b', 's'), message('m2', 'a', 'b', 'a', 'async'), message('m3', 'b', 'a', 'r', 'reply')]));
    expect(['m1', 'm2', 'm3'].map((id) => messageKind(by(document, id)))).toEqual(['sync', 'async', 'reply']);
    expect([by(document, 'm1').endMarker, by(document, 'm2').endMarker, by(document, 'm3').style.strokeDash]).toEqual(['solid-arrow', 'line-arrow', 'dashed']);
  });
});

describe('extending a sequence diagram by click (#192, #199)', () => {
  const base = () => documentOf(three([message('m1', 'a', 'b', 'eins'), message('m2', 'b', 'a', 'zwei', 'reply')]));

  test('a lifeline, its parts and the messages lead to the diagram; other selections to none', () => {
    const document = base();
    expect(sequenceSelection(page(document), ['a'])).toMatchObject({ lifelineId: 'a', itemId: null });
    expect(sequenceSelection(page(document), ['b:head'])).toMatchObject({ lifelineId: 'b' });
    expect(sequenceSelection(page(document), ['b:line'])).toMatchObject({ lifelineId: 'b' });
    expect(sequenceSelection(page(document), [activations(document, 'b')[0]!.id])).toMatchObject({ lifelineId: 'b' });
    expect(sequenceSelection(page(document), ['m1'])).toMatchObject({ lifelineId: null, itemId: 'm1' });
    // Several parts of one diagram stand for the diagram; mixed with something else they do not.
    expect(sequenceSelection(page(document), ['a', 'b', 'm1'])).toMatchObject({ lifelineId: null, itemId: null });
    expect(sequenceSelection(page(document), [])).toBeNull();
    const other = createDocument('Other');
    const task = applyCommand(other, planElementPaste(diagramTemplate('bpmn.task')!.build(), other, { x: 0, y: 0 }, createId).command);
    expect(sequenceSelection(page(task), [task.elements[0]!.id])).toBeNull();
    const mixed = applyCommand(document, { type: 'add', elements: [{ ...task.elements[0]!, id: 'other', pageId: pageId(document) }] });
    expect(sequenceSelection(page(mixed), ['a', 'other'])).toBeNull();
  });

  test('a new lifeline stands right of the selected one, the ones further right move over with their messages', () => {
    const start = documentOf(three([message('m1', 'a', 'c', 'weit')]));
    const before = { b: by(start, 'b').x, c: by(start, 'c').x };
    const { document, selection } = edit(start, 'a:head', (selected) => addSequenceLifeline(page(start), selected, pageId(start), createId, texts));
    const added = by(document, selection[0]!);
    expect(readSequence(page(document), 'a')!.model.participants.map((participant) => participant.name)).toEqual(['Client', 'Teilnehmer 4', 'Dienst', 'Bank']);
    expect(added.x).toBe(before.b);
    const step = SEQUENCE_LIFELINE.width + SEQUENCE_LIFELINE.gap;
    expect([by(document, 'b').x, by(document, 'c').x]).toEqual([before.b + step, before.c + step]);
    // Head and line moved with their lifeline, and the message still ends on it.
    expect(by(document, 'c:head').x).toBe(by(document, 'c').x);
    expect(by(document, 'c:line').x).toBe(centre(by(document, 'c')));
    expect(drawn(by(document, 'm1')).to.x).toBe(centre(by(document, 'c')) - SEQUENCE_LAYOUT.activation / 2);
    // Same top, same height as the others.
    expect([added.y, added.height]).toEqual([by(document, 'a').y, by(document, 'a').height]);
  });

  test('a new message comes directly below the selected one and goes on from its receiver', () => {
    const start = documentOf(three([message('m1', 'a', 'b', 'eins'), message('m2', 'b', 'a', 'zwei', 'reply')]));
    const { document, selection } = edit(start, 'm1', (selected) => addSequenceMessage(page(start), selected, 'sync', pageId(start), createId, texts));
    expect(order(document)).toEqual(['eins', 'Nachricht', 'zwei']);
    const added = by(document, selection[0]!);
    expect([added.from!.elementId, added.to!.elementId]).toEqual(['b', 'c']);
    // The messages below moved down by one step.
    expect(drawn(by(document, 'm2')).from.y - drawn(added).from.y).toBe(SEQUENCE_LAYOUT.step);
    expect(drawn(added).from.y - drawn(by(document, 'm1')).from.y).toBe(SEQUENCE_LAYOUT.step);
  });

  test('a reply answers the selected message; from a lifeline it answers whoever still waits', () => {
    const start = documentOf(three([message('m1', 'a', 'b', 'eins'), message('m2', 'b', 'c', 'zwei')]));
    const answered = edit(start, 'm2', (selected) => addSequenceMessage(page(start), selected, 'reply', pageId(start), createId, texts));
    const reply = by(answered.document, answered.selection[0]!);
    expect([reply.from!.elementId, reply.to!.elementId, reply.text, messageKind(reply)]).toEqual(['c', 'b', 'Antwort', 'reply']);
    expect(order(answered.document)).toEqual(['eins', 'zwei', 'Antwort']);
    // The activation of the bank now ends at the reply.
    const [bank] = activations(answered.document, 'c');
    expect(bank!.y + bank!.height).toBe(drawn(reply).from.y);
    // With the reply selected, the next reply goes back to the first caller.
    const second = edit(answered.document, reply.id, (selected) => addSequenceMessage(page(answered.document), selected, 'reply', pageId(start), createId, texts));
    const outer = by(second.document, second.selection[0]!);
    expect([outer.from!.elementId, outer.to!.elementId]).toEqual(['b', 'a']);
    // From the lifeline: at the end, to the caller that waits.
    const fromLifeline = edit(start, 'c:head', (selected) => addSequenceMessage(page(start), selected, 'reply', pageId(start), createId, texts));
    const last = by(fromLifeline.document, fromLifeline.selection[0]!);
    expect([last.from!.elementId, last.to!.elementId]).toEqual(['c', 'b']);
  });

  test('a call to oneself lands on the receiver of the selected message, or on the selected lifeline', () => {
    const start = base();
    const below = edit(start, 'm1', (selected) => addSequenceMessage(page(start), selected, 'self', pageId(start), createId, texts));
    const loop = by(below.document, below.selection[0]!);
    expect([loop.from!.elementId, loop.to!.elementId]).toEqual(['b', 'b']);
    expect(order(below.document)).toEqual(['eins', 'Nachricht', 'zwei']);
    const onLifeline = edit(start, 'a', (selected) => addSequenceMessage(page(start), selected, 'self', pageId(start), createId, texts));
    expect(by(onLifeline.document, onLifeline.selection[0]!).from!.elementId).toBe('a');
    expect(order(onLifeline.document)).toEqual(['eins', 'zwei', 'Nachricht']);
  });

  test('a single lifeline gets a second one with its first message; a selected fragment takes the message in', () => {
    const alone = documentOf({ autonumber: false, participants: [{ id: 'a', name: 'Teilnehmer', actor: false }], items: [] });
    const { document } = edit(alone, 'a', (selected) => addSequenceMessage(page(alone), selected, 'sync', pageId(alone), createId, texts));
    expect(readSequence(page(document), 'a')!.model.participants.map((participant) => participant.name)).toEqual(['Teilnehmer', 'Teilnehmer 2']);
    const fragment: SequenceFragment = { type: 'fragment', id: 'f', operator: 'loop', sections: [{ id: null, label: 'x', items: [] }] };
    const withFragment = documentOf(three([message('m1', 'a', 'b', 'eins', 'async'), fragment]));
    const inside = edit(withFragment, 'f', (selected) => addSequenceMessage(page(withFragment), selected, 'async', pageId(withFragment), createId, texts));
    const read = readSequence(page(inside.document), 'a')!.model;
    expect(sequenceMessages((read.items[1] as SequenceFragment).sections[0]!.items).map((entry) => entry.id)).toEqual(inside.selection);
  });

  test('numbering turns on for all messages, new ones join in, and it turns off again', () => {
    const start = base();
    const on = edit(start, 'm1', (selected) => toggleSequenceNumbers(page(start), selected, pageId(start), ['m1']));
    expect(['m1', 'm2'].map((id) => by(on.document, id).metadata?.[SEQUENCE_NUMBER_KEY])).toEqual(['1', '2']);
    const more = edit(on.document, 'm1', (selected) => addSequenceMessage(page(on.document), selected, 'async', pageId(start), createId, texts));
    expect([by(more.document, more.selection[0]!).metadata?.[SEQUENCE_NUMBER_KEY], by(more.document, 'm2').metadata?.[SEQUENCE_NUMBER_KEY]]).toEqual(['2', '3']);
    const off = edit(more.document, 'm1', (selected) => toggleSequenceNumbers(page(more.document), selected, pageId(start), ['m1']));
    expect(by(off.document, 'm2').metadata?.[SEQUENCE_NUMBER_KEY]).toBeUndefined();
  });
});

describe('changes to a sequence diagram are followed by its layout (#199)', () => {
  const run = (document: SketchDocument, command: DocumentCommand): SketchDocument => {
    const apply = (next: DocumentCommand) => { try { return page(applyCommand(document, next)); } catch { return null; } };
    return applyCommand(document, withSequenceLayout(page(document), command, pageId(document), apply));
  };
  const start = () => documentOf(three([message('m1', 'a', 'b', 'eins'), message('m2', 'b', 'c', 'zwei'), message('m3', 'c', 'b', 'drei', 'reply'), message('m4', 'b', 'a', 'vier', 'reply')]));

  test('moving a lifeline takes head, line and activations along and keeps the messages attached', () => {
    const document = start();
    const moved = run(document, { type: 'update', changes: [{ id: 'c', patch: { x: by(document, 'c').x + 300 } }] });
    const c = by(moved, 'c');
    expect(c.x).toBe(by(document, 'c').x + 300);
    expect(by(moved, 'c:head').x).toBe(c.x);
    expect(by(moved, 'c:line').x).toBe(centre(c));
    expect(centre(activations(moved, 'c')[0]!)).toBe(centre(c));
    expect(drawn(by(moved, 'm2')).to.x).toBe(centre(c) - SEQUENCE_LAYOUT.activation / 2);
    expect(by(moved, 'm2').width).toBe(drawn(by(moved, 'm2')).to.x - drawn(by(moved, 'm2')).from.x);
  });

  test('a lifeline dragged past another one takes its place; arrows turn round and meet the other side of the boxes', () => {
    const document = start();
    const moved = run(document, { type: 'update', changes: [{ id: 'a', patch: { x: by(document, 'b').x + 40 } }] });
    expect(readSequence(page(moved), 'a')!.model.participants.map((participant) => participant.id)).toEqual(['b', 'a', 'c']);
    // No overlap: the dragged lifeline stands a full step right of the one it passed.
    expect(by(moved, 'a').x).toBe(by(moved, 'b').x + SEQUENCE_LIFELINE.width + SEQUENCE_LIFELINE.gap);
    expect(by(moved, 'c').x).toBe(by(moved, 'a').x + SEQUENCE_LIFELINE.width + SEQUENCE_LIFELINE.gap);
    // "eins" now runs from right to left and ends at the right edge of the activation.
    const first = drawn(by(moved, 'm1'));
    expect(first.from.x).toBeGreaterThan(first.to.x);
    expect(first.to.x).toBe(centre(by(moved, 'b')) + SEQUENCE_LAYOUT.activation / 2);
    // The order of the messages did not change.
    expect(order(moved)).toEqual(['eins', 'zwei', 'drei', 'vier']);
  });

  test('deleting a message closes the gap and re-derives the activations; changing a text makes room', () => {
    const document = start();
    const removed = run(document, { type: 'delete', ids: ['m3'] });
    expect(order(removed)).toEqual(['eins', 'zwei', 'vier']);
    expect(drawn(by(removed, 'm4')).from.y - drawn(by(removed, 'm2')).from.y).toBe(SEQUENCE_LAYOUT.step);
    // The bank is never answered now: its activation runs to the end.
    const [bank] = activations(removed, 'c');
    expect(bank!.y + bank!.height).toBeGreaterThan(drawn(by(removed, 'm4')).from.y);
    const retexted = run(document, { type: 'update', changes: [{ id: 'm3', patch: { text: 'drei\nvier\nfünf\nsechs' } }] });
    expect(drawn(by(retexted, 'm3')).from.y - drawn(by(retexted, 'm2')).from.y).toBeGreaterThan(SEQUENCE_LAYOUT.step);
  });

  test('an end dragged onto the line, the head or an activation of another lifeline joins that lifeline, also across lifelines', () => {
    const document = start();
    const before = drawn(by(document, 'm1')).from.y;
    // "eins" ran from the client to the service; its end is dropped on the dashed line of the bank.
    const onLine = run(document, { type: 'update', changes: [{ id: 'm1', patch: { to: { elementId: 'c:line', anchor: { x: 0.5, y: 0.1 } } } }] });
    const message = by(onLine, 'm1');
    expect([message.from!.elementId, message.to!.elementId]).toEqual(['a', 'c']);
    expect(order(onLine)).toEqual(['eins', 'zwei', 'drei', 'vier']);
    const ends = drawn(message);
    expect([ends.from.y, ends.to.y]).toEqual([before, before]);
    expect(ends.from.x).toBe(centre(by(onLine, 'a')));
    expect(ends.to.x).toBe(centre(by(onLine, 'c')) - SEQUENCE_LAYOUT.activation / 2);
    // It crosses the service, which is no longer called by it.
    expect(readSequence(page(onLine), 'a')!.members.has('m1')).toBe(true);
    expect(activations(onLine, 'b').map((box) => box.y)).not.toContain(before);
    // A start dragged to another lifeline keeps the row of its message, wherever on the lifeline it is dropped.
    const restart = run(document, { type: 'update', changes: [{ id: 'm2', patch: { from: { elementId: 'a', anchor: { x: 0, y: 0.9 } } } }] });
    expect([by(restart, 'm2').from!.elementId, by(restart, 'm2').to!.elementId]).toEqual(['a', 'c']);
    expect(order(restart)).toEqual(['eins', 'zwei', 'drei', 'vier']);
    // The same for the start of a message dropped on a head or on an activation.
    const onHead = run(document, { type: 'update', changes: [{ id: 'm4', patch: { to: { elementId: 'c:head', anchor: { x: 0.5, y: 1 } } } }] });
    expect(by(onHead, 'm4').to!.elementId).toBe('c');
    const box = activations(document, 'c')[0]!;
    const onBox = run(document, { type: 'update', changes: [{ id: 'm1', patch: { to: { elementId: box.id, anchor: { x: 0, y: 0.5 } } } }] });
    expect(by(onBox, 'm1').to!.elementId).toBe('c');
    expect(readSequence(page(onBox), 'a')!.members.has('m1')).toBe(true);
  });

  test('a command that changes nothing, or touches nothing of a diagram, comes back as it is', () => {
    const document = start();
    const apply = (next: DocumentCommand) => page(applyCommand(document, next));
    const idle: DocumentCommand = { type: 'update', changes: [{ id: 'a', patch: { x: by(document, 'a').x } }] };
    expect(withSequenceLayout(page(document), idle, pageId(document), apply)).toBe(idle);
    const colour: DocumentCommand = { type: 'update', changes: [{ id: 'm1', patch: { style: { stroke: '#ff0000' } } }] };
    expect(withSequenceLayout(page(document), colour, pageId(document), apply)).toBe(colour);
    // Restyling a message into a reply is a change of the diagram.
    const dashed: DocumentCommand = { type: 'update', changes: [{ id: 'm2', patch: { style: { strokeDash: 'dashed' } } }] };
    expect(withSequenceLayout(page(document), dashed, pageId(document), apply)).not.toBe(dashed);
  });
});

describe('long texts move the lifelines apart (#202)', () => {
  const long = 'eine ziemlich lange Nachricht ohne Zeilenumbruch';
  const width = connectorLabelSize(long, 14).width;
  const step = SEQUENCE_LIFELINE.width + SEQUENCE_LIFELINE.gap;
  const distance = (document: SketchDocument, a: string, b: string) => centre(by(document, b)) - centre(by(document, a));

  test('short texts keep the usual distance; a long one widens it and takes the lifelines further right along', () => {
    const short = documentOf(three([message('m1', 'a', 'b', 'kurz')]));
    expect([distance(short, 'a', 'b'), distance(short, 'b', 'c')]).toEqual([step, step]);
    const wide = documentOf(three([message('m1', 'a', 'b', long)]));
    expect(distance(wide, 'a', 'b')).toBeGreaterThan(width);
    expect(distance(wide, 'a', 'b')).toBeGreaterThan(step);
    // The bank keeps its distance to the service.
    expect(distance(wide, 'b', 'c')).toBe(step);
    // The text fits between the two ends of its arrow.
    const ends = drawn(by(wide, 'm1'));
    expect(ends.to.x - ends.from.x).toBeGreaterThan(width);
  });

  test('across several lifelines the whole distance counts; numbers need room as well', () => {
    // Too long for one step, but the message spans two: nothing moves.
    const medium = 'dreißig Zeichen langer Text hier';
    expect(connectorLabelSize(medium, 14).width).toBeGreaterThan(step);
    const across = documentOf(three([message('m1', 'a', 'c', medium)]));
    expect([distance(across, 'a', 'b'), distance(across, 'a', 'c')]).toEqual([step, 2 * step]);
    const longer = `${long} ${long}`;
    const far = documentOf(three([message('m1', 'a', 'c', longer)]));
    expect(distance(far, 'a', 'c')).toBeGreaterThan(connectorLabelSize(longer, 14).width);
    expect(distance(far, 'a', 'b')).toBe(step);
    const plain = documentOf(three([message('m1', 'a', 'b', long)]));
    const numbered = documentOf(three([message('m1', 'a', 'b', long)], true));
    expect(distance(numbered, 'a', 'b')).toBeGreaterThan(distance(plain, 'a', 'b'));
  });

  test('the text beside a call to oneself and a note beside a lifeline keep the next lifeline away', () => {
    const loop = documentOf(three([message('m1', 'a', 'a', long)]));
    expect(distance(loop, 'a', 'b')).toBeGreaterThan(SEQUENCE_LAYOUT.loopWidth + width);
    const label = by(loop, 'm1');
    expect(label.x + SEQUENCE_LAYOUT.loopWidth + width).toBeLessThan(centre(by(loop, 'b')));
    const note = documentOf(three([{ type: 'note', id: 'n', text: long, side: 'right', from: 'b', to: 'b' }]));
    expect(by(note, 'n').x + by(note, 'n').width).toBeLessThan(centre(by(note, 'c')));
    expect(distance(note, 'a', 'b')).toBe(step);
    // On the last lifeline there is nothing to keep away.
    const last = documentOf(three([message('m1', 'c', 'c', long)]));
    expect(distance(last, 'b', 'c')).toBe(step);
  });

  test('typing a long text widens the diagram; a lifeline cannot be pulled closer than the text allows; a shorter text leaves it wide', () => {
    const run = (document: SketchDocument, command: DocumentCommand): SketchDocument => {
      const apply = (next: DocumentCommand) => { try { return page(applyCommand(document, next)); } catch { return null; } };
      return applyCommand(document, withSequenceLayout(page(document), command, pageId(document), apply));
    };
    const start = documentOf(three([message('m1', 'a', 'b', 'kurz'), message('m2', 'b', 'c', 'auch kurz', 'async')]));
    const typed = run(start, { type: 'update', changes: [{ id: 'm1', patch: { text: long } }] });
    const needed = distance(typed, 'a', 'b');
    expect(needed).toBeGreaterThan(width);
    expect(distance(typed, 'b', 'c')).toBe(step);
    // The second message still joins its lifelines.
    expect(drawn(by(typed, 'm2')).to.x).toBe(centre(by(typed, 'c')));
    const pulled = run(typed, { type: 'update', changes: [{ id: 'b', patch: { x: by(typed, 'b').x - 150 } }] });
    expect(distance(pulled, 'a', 'b')).toBe(needed);
    const shorter = run(typed, { type: 'update', changes: [{ id: 'm1', patch: { text: 'kurz' } }] });
    expect(distance(shorter, 'a', 'b')).toBe(needed);
  });
});

describe('a message is dragged to another place in the order (#201)', () => {
  const start = () => documentOf(three([message('m1', 'a', 'b', 'eins'), message('m2', 'b', 'c', 'zwei'), message('m3', 'c', 'b', 'drei', 'reply'), message('m4', 'b', 'a', 'vier', 'reply')], true));
  const drag = (document: SketchDocument, id: string, dy: number) => {
    const apply = (next: DocumentCommand) => { try { return page(applyCommand(document, next)); } catch { return null; } };
    const moved = moveSequenceMessage(page(document), id, dy, pageId(document), apply)!;
    return { ...moved, document: applyCommand(document, moved.command) };
  };
  const y = (document: SketchDocument, id: string) => drawn(by(document, id)).from.y;

  test('a short drag only moves the message with the pointer and reorders nothing', () => {
    const document = start();
    const moved = drag(document, 'm2', 20);
    expect(moved.reordered).toBe(false);
    expect(y(moved.document, 'm2')).toBeCloseTo(y(document, 'm2') + 20, 6);
    expect(drawn(by(moved.document, 'm2')).to.y).toBeCloseTo(y(document, 'm2') + 20, 6);
    expect(y(moved.document, 'm3')).toBe(y(document, 'm3'));
  });

  test('dragged past its neighbour the message takes its place; spacing, numbers and activations follow', () => {
    const document = start();
    const moved = drag(document, 'm1', SEQUENCE_LAYOUT.step * 2 + 10);
    expect(moved.reordered).toBe(true);
    expect(order(moved.document)).toEqual(['zwei', 'drei', 'eins', 'vier']);
    const heights = ['m2', 'm3', 'm1', 'm4'].map((id) => y(moved.document, id));
    expect(heights.map((height, index) => (index ? height - heights[index - 1]! : 0))).toEqual([0, SEQUENCE_LAYOUT.step, SEQUENCE_LAYOUT.step, SEQUENCE_LAYOUT.step]);
    expect(['m2', 'm3', 'm1', 'm4'].map((id) => by(moved.document, id).metadata?.[SEQUENCE_NUMBER_KEY])).toEqual(['1', '2', '3', '4']);
    // The service is now active from "eins" to "vier" only; before that its reply had nothing to close.
    const [service] = activations(moved.document, 'b');
    expect([service!.y, service!.y + service!.height]).toEqual([y(moved.document, 'm1'), y(moved.document, 'm4')]);
    // Dragging up works the same way.
    const back = drag(moved.document, 'm1', -(SEQUENCE_LAYOUT.step * 2 + 10));
    expect(order(back.document)).toEqual(['eins', 'zwei', 'drei', 'vier']);
  });

  test('a message cannot leave its lifelines: far up it becomes the first, far down the last', () => {
    const document = start();
    expect(order(drag(document, 'm3', -5000).document)).toEqual(['drei', 'eins', 'zwei', 'vier']);
    expect(order(drag(document, 'm1', 5000).document)).toEqual(['zwei', 'drei', 'vier', 'eins']);
    // The first message does not climb onto the heads.
    const up = drag(document, 'm1', -5000);
    expect(up.reordered).toBe(false);
    expect(y(up.document, 'm1')).toBeGreaterThan(by(document, 'a:head').y + by(document, 'a:head').height);
  });

  test('dragged into a fragment the message joins it, dragged out it leaves; a call to oneself moves as a whole', () => {
    const loop: SequenceFragment = { type: 'fragment', id: 'f', operator: 'loop', sections: [{ id: null, label: 'x', items: [message('m2', 'b', 'c', 'zwei', 'async'), message('m3', 'b', 'b', 'selbst')] }] };
    const document = documentOf(three([message('m1', 'a', 'b', 'eins', 'async'), loop, message('m4', 'b', 'a', 'vier', 'async')]));
    const inside = (doc: SketchDocument) => sequenceMessages((readSequence(page(doc), 'a')!.model.items.find((item) => item.type === 'fragment') as SequenceFragment).sections[0]!.items).map((entry) => entry.text);
    const into = drag(document, 'm1', y(document, 'm2') - y(document, 'm1') + 10);
    expect(into.reordered).toBe(true);
    expect(inside(into.document)).toEqual(['zwei', 'eins', 'selbst']);
    const out = drag(document, 'm2', y(document, 'm4') - y(document, 'm2') + 10);
    expect(inside(out.document)).toEqual(['selbst']);
    expect(order(out.document)).toEqual(['eins', 'selbst', 'vier', 'zwei']);
    // The loop of the call to oneself keeps its height while it is dragged.
    const self = drag(document, 'm3', -10);
    const ends = drawn(by(self.document, 'm3'));
    expect(ends.to.y - ends.from.y).toBeCloseTo(SEQUENCE_LAYOUT.loopHeight, 6);
  });

  test('only messages between lifelines can be dragged this way', () => {
    const document = start();
    const apply = (next: DocumentCommand) => page(applyCommand(document, next));
    expect(moveSequenceMessage(page(document), 'a:head', 50, pageId(document), apply)).toBeNull();
    expect(moveSequenceMessage(page(document), 'missing', 50, pageId(document), apply)).toBeNull();
  });
});

describe('lifelines have colours, and their activations wear them (#205)', () => {
  const run = (document: SketchDocument, command: DocumentCommand): SketchDocument => {
    const apply = (next: DocumentCommand) => { try { return page(applyCommand(document, next)); } catch { return null; } };
    return applyCommand(document, withSequenceLayout(page(document), command, pageId(document), apply));
  };
  const look = (element: SketchElement) => ({ fill: element.style.fill, stroke: element.style.stroke });
  const calls = () => documentOf(three([message('m1', 'a', 'b'), message('m2', 'b', 'c'), message('m3', 'c', 'b', 'r', 'reply'), message('m4', 'b', 'a', 'r', 'reply')]));

  test('every lifeline of a new diagram has its own colour, in the order of the palette, with dark text', () => {
    const document = calls();
    expect(['a', 'b', 'c'].map((id) => look(by(document, `${id}:head`)))).toEqual(SEQUENCE_COLOURS.slice(0, 3));
    expect(new Set(['a', 'b', 'c'].map((id) => by(document, `${id}:head`).style.textColor)).size).toBe(1);
    expect(by(document, 'a:head').style.textColor).not.toBe(by(document, 'a:head').style.stroke);
  });

  test('activations have the fill and border of the head of their lifeline', () => {
    const document = calls();
    expect(look(activations(document, 'b')[0]!)).toEqual(look(by(document, 'b:head')));
    expect(look(activations(document, 'c')[0]!)).toEqual(look(by(document, 'c:head')));
    expect(look(activations(document, 'b')[0]!)).not.toEqual(look(activations(document, 'c')[0]!));
  });

  test('a new lifeline takes the first colour its diagram does not use; with all in use the colours start over', () => {
    let document = calls();
    const added = edit(document, 'a', (selected) => addSequenceLifeline(page(document), selected, pageId(document), createId, texts));
    expect(look(by(added.document, `${added.selection[0]}:head`))).toEqual(SEQUENCE_COLOURS[3]);
    // A colour that was freed by recolouring a head is taken again first.
    document = run(document, { type: 'update', changes: [{ id: 'a:head', patch: { style: { fill: '#123456' } } }] });
    const reused = edit(document, 'a', (selected) => addSequenceLifeline(page(document), selected, pageId(document), createId, texts));
    expect(look(by(reused.document, `${reused.selection[0]}:head`))).toEqual(SEQUENCE_COLOURS[0]);
    // More lifelines than colours: no failure, the palette repeats.
    let many = calls();
    for (let index = 0; index < SEQUENCE_COLOURS.length; index += 1) many = edit(many, 'a', (selected) => addSequenceLifeline(page(many), selected, pageId(many), createId, texts)).document;
    const fills = page(many).filter((element) => sequenceRole(element) === 'head').map((element) => element.style.fill);
    expect(fills).toHaveLength(SEQUENCE_COLOURS.length + 3);
    expect(new Set(fills).size).toBe(SEQUENCE_COLOURS.length);
  });

  test('recolouring a head recolours the activations of that lifeline, and only those', () => {
    const document = calls();
    const other = look(activations(document, 'c')[0]!);
    const recoloured = run(document, { type: 'update', changes: [{ id: 'b:head', patch: { style: { fill: '#ffe3e3', stroke: '#c92a2a' } } }] });
    expect(look(activations(recoloured, 'b')[0]!)).toEqual({ fill: '#ffe3e3', stroke: '#c92a2a' });
    expect(look(activations(recoloured, 'c')[0]!)).toEqual(other);
    // An activation cannot be coloured on its own: it follows its lifeline again.
    const alone = run(document, { type: 'update', changes: [{ id: activations(document, 'b')[0]!.id, patch: { style: { fill: '#000000' } } }] });
    expect(look(activations(alone, 'b')[0]!)).toEqual(look(by(alone, 'b:head')));
  });

  test('an actor has no box: its activations stay white with a dark border', () => {
    const document = documentOf({ autonumber: false, participants: [{ id: 'a', name: 'Dienst', actor: false }, { id: 'k', name: 'Kunde', actor: true }], items: [message('m1', 'a', 'k')] });
    expect(look(activations(document, 'k')[0]!)).toEqual({ fill: '#ffffff', stroke: by(document, 'm1').style.stroke });
    // The actor does not use up a colour.
    expect(look(by(document, 'a:head'))).toEqual(SEQUENCE_COLOURS[0]);
  });
});

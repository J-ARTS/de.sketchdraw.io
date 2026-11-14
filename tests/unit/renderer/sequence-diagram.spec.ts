import { describe, expect, test } from 'vitest';
import { applyCommand, createDocument, type SketchDocument, type SketchElement } from '@/domain';
import { diagramTemplate, SEQUENCE_LIFELINE, SEQUENCE_ROLE_KEY } from '@/renderer/lib/diagram-libraries';
import { planElementPaste } from '@/renderer/state/element-clipboard';
import { planAddLifeline, planAddMessage, sequenceContext } from '@/renderer/lib/sequence-diagram';

let counter = 0;
const createId = (prefix: string) => `${prefix}:t${counter += 1}`;
const role = (element: SketchElement) => element.metadata?.[SEQUENCE_ROLE_KEY];
const pageId = (document: SketchDocument) => document.pages[0]!.id;

function withTemplate(id: string, at = { x: 400, y: 300 }): SketchDocument {
  const document = createDocument('Sequence');
  return applyCommand(document, planElementPaste(diagramTemplate(id)!.build(), document, at, createId).command);
}
const lifelines = (document: SketchDocument) => document.elements.filter((element) => role(element) === 'lifeline').sort((a, b) => a.x - b.x);
const messages = (document: SketchDocument) => document.elements.filter((element) => role(element) === 'message');
/** Document height of a message, taken from its drawn geometry. */
const drawnY = (message: SketchElement) => message.y + message.points![0]!.y;

describe('extending a sequence diagram (#192)', () => {
  test('a lifeline, its parts and its messages lead to the same diagram; other selections to none', () => {
    const document = withTemplate('sequence.example');
    const [client, service] = lifelines(document);
    const head = document.elements.find((element) => element.parentId === service!.id && role(element) === 'head')!;
    const [request] = messages(document);
    expect(sequenceContext(document, pageId(document), [client!.id])!.lifelines.map((entry) => entry.id)).toEqual([client!.id, service!.id]);
    expect(sequenceContext(document, pageId(document), [head.id])!.lifeline.id).toBe(service!.id);
    expect(sequenceContext(document, pageId(document), [request!.id])).toMatchObject({ lifeline: { id: request!.from!.elementId }, messages: [{}, {}] });
    expect(sequenceContext(document, pageId(document), [client!.id, service!.id])).toBeNull();
    expect(sequenceContext(document, pageId(document), [])).toBeNull();
    expect(sequenceContext(withTemplate('bpmn.task'), pageId(document), [withTemplate('bpmn.task').elements[0]!.id])).toBeNull();
  });

  test('a new lifeline stands right of the outermost one, as tall as the others, with the next name', () => {
    let document = withTemplate('sequence.example');
    const before = lifelines(document);
    const plan = planAddLifeline(sequenceContext(document, pageId(document), [before[0]!.id])!, createId, 'Teilnehmer');
    document = applyCommand(document, plan.command);
    const after = lifelines(document);
    expect(after).toHaveLength(3);
    const added = after[2]!;
    expect(plan.selection).toEqual([added.id]);
    expect(added).toMatchObject({ x: before[1]!.x + before[1]!.width + SEQUENCE_LIFELINE.gap, y: before[1]!.y, height: before[1]!.height, label: 'Teilnehmer 3' });
    expect(document.elements.filter((element) => element.parentId === added.id).map(role).sort()).toEqual(['head', 'line']);
  });

  test('a new message runs to the right neighbour below the lowest message, horizontally and bound to both lifelines', () => {
    let document = withTemplate('sequence.example');
    const [client, service] = lifelines(document);
    const lowest = Math.max(...messages(document).map(drawnY));
    const plan = planAddMessage(sequenceContext(document, pageId(document), [client!.id])!, document, createId, 'Nachricht', 'Teilnehmer');
    document = applyCommand(document, plan.command);
    const added = document.elements.find((element) => element.id === plan.selection[0])!;
    expect(added).toMatchObject({ kind: 'connector', text: 'Nachricht', from: { elementId: client!.id }, to: { elementId: service!.id } });
    expect(drawnY(added)).toBeCloseTo(lowest + SEQUENCE_LIFELINE.messageStep, 5);
    expect(added.points![0]!.y).toBeCloseTo(added.points![1]!.y, 5);
    expect(added.x).toBeCloseTo(client!.x + client!.width / 2, 5);
    expect(added.width).toBeCloseTo(service!.x - client!.x, 5);

    // From the right edge the message runs to the left neighbour.
    const back = planAddMessage(sequenceContext(document, pageId(document), [service!.id])!, document, createId, 'Antwort', 'Teilnehmer');
    document = applyCommand(document, back.command);
    expect(document.elements.find((element) => element.id === back.selection[0])).toMatchObject({ from: { elementId: service!.id }, to: { elementId: client!.id } });
  });

  test('lifelines grow when messages reach their end, and the messages already there keep their height', () => {
    let document = withTemplate('sequence.example');
    const start = lifelines(document)[0]!;
    const heights = () => messages(document).map(drawnY).sort((a, b) => a - b);
    for (let index = 0; index < 9; index += 1) {
      const known = heights();
      const plan = planAddMessage(sequenceContext(document, pageId(document), [start.id])!, document, createId, 'Nachricht', 'Teilnehmer');
      document = applyCommand(document, plan.command);
      const now = heights();
      expect(now).toHaveLength(known.length + 1);
      known.forEach((value, position) => expect(now[position]).toBeCloseTo(value, 4));
    }
    const grown = lifelines(document);
    expect(grown[0]!.height).toBeGreaterThan(SEQUENCE_LIFELINE.height);
    expect(grown[1]!.height).toBe(grown[0]!.height);
    for (const lifeline of grown) {
      const line = document.elements.find((element) => element.parentId === lifeline.id && role(element) === 'line')!;
      expect(line.y + line.height).toBeCloseTo(lifeline.y + lifeline.height, 5);
    }
    const bottom = grown[0]!.y + grown[0]!.height;
    for (const y of heights()) expect(y).toBeLessThan(bottom);
    // The anchors agree with the drawn heights, so moving a lifeline keeps every message level.
    for (const message of messages(document)) {
      const from = grown.find((lifeline) => lifeline.id === message.from!.elementId)!;
      expect(from.y + message.from!.anchor.y * from.height).toBeCloseTo(drawnY(message), 4);
    }
  });

  test('with a single lifeline a message brings its partner along', () => {
    let document = withTemplate('sequence.lifeline');
    const [only] = lifelines(document);
    const plan = planAddMessage(sequenceContext(document, pageId(document), [only!.id])!, document, createId, 'Nachricht', 'Teilnehmer');
    document = applyCommand(document, plan.command);
    expect(lifelines(document)).toHaveLength(2);
    expect(messages(document)).toHaveLength(1);
    expect(messages(document)[0]).toMatchObject({ from: { elementId: only!.id }, to: { elementId: lifelines(document)[1]!.id } });
  });
});

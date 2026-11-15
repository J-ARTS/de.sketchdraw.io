import { describe, expect, test } from 'vitest';
import { createDocument } from '@/domain';
import { DIAGRAM_LIBRARIES, diagramLibrary, diagramTemplate } from '@/renderer/lib/diagram-libraries';
import { SEQUENCE_ROLE_KEY } from '@/renderer/lib/sequence-model';
import { parseElementClipboard, planElementPaste } from '@/renderer/state/element-clipboard';

describe('diagram libraries (#191)', () => {
  const templates = DIAGRAM_LIBRARIES.flatMap((library) => library.templates.map((template) => ({ library: library.id, template })));

  test('there is a library for ER, BPMN and sequence diagrams, each with unique template ids', () => {
    expect(DIAGRAM_LIBRARIES.map((library) => library.id)).toEqual(['er', 'bpmn', 'sequence']);
    const ids = templates.map(({ template }) => template.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const { library, template } of templates) expect(template.id.startsWith(`${library}.`)).toBe(true);
    expect(diagramTemplate('bpmn.task')?.name).toBe('Aufgabe');
    expect(diagramTemplate('nope')).toBeUndefined();
    expect(diagramLibrary('er').templates.length).toBeGreaterThanOrEqual(8);
  });

  test.each(templates.map(({ template }) => [template.id, template] as const))('%s is a valid selection and pastes into an empty document', (_id, template) => {
    const built = template.build();
    const checked = parseElementClipboard(JSON.stringify(built));
    expect(checked, 'the template must pass the same check as clipboard text').not.toBeNull();
    expect(checked!.elements).toHaveLength(built.elements.length);
    let counter = 0;
    const plan = planElementPaste(checked!, createDocument('Target'), { x: 500, y: 400 }, (prefix) => `${prefix}:new-${counter += 1}`);
    expect(plan.selection).toHaveLength(built.elements.length);
  });

  test('entities are tables with a header row, and relationships carry crow\'s foot markers', () => {
    const [entity] = diagramTemplate('er.entity')!.build().elements;
    expect(entity).toMatchObject({ kind: 'table', width: 260, height: 144 });
    expect(entity!.table!.cells.filter((cell) => cell.style.fontWeight === 'bold').map((cell) => cell.text)).toEqual(['Entität', '']);
    const [link] = diagramTemplate('er.one-to-many')!.build().elements;
    // Relationships react like the curved arrow.
    expect(link).toMatchObject({ kind: 'connector', connectorRouting: 'curved', startMarker: 'exactly-one', endMarker: 'one-or-many' });
    for (const id of ['er.one-to-one', 'er.optional-to-many', 'er.many-to-many']) expect(diagramTemplate(id)!.build().elements[0]!.connectorRouting).toBe('curved');
    const example = diagramTemplate('er.example')!.build().elements;
    expect(example.find((element) => element.kind === 'connector')).toMatchObject({ connectorRouting: 'curved', from: { elementId: 'a' }, to: { elementId: 'b' } });
    // The flows of other diagram types keep their straight lines.
    expect(diagramTemplate('bpmn.sequence-flow')!.build().elements[0]!.connectorRouting).toBe('straight');
  });

  test('a sequence lifeline is one container with its box and line, and messages bind to the containers', () => {
    const lifeline = diagramTemplate('sequence.lifeline')!.build().elements;
    expect(lifeline.map((element) => [element.kind, element.metadata?.[SEQUENCE_ROLE_KEY], element.parentId])).toEqual([
      ['container', 'lifeline', undefined], ['rectangle', 'head', 'a'], ['path', 'line', 'a'],
    ]);
    const example = diagramTemplate('sequence.example')!.build().elements;
    const messages = example.filter((element) => element.metadata?.[SEQUENCE_ROLE_KEY] === 'message');
    expect(messages.map((message) => [message.from!.elementId, message.to!.elementId, message.style.strokeDash])).toEqual([['a', 'b', 'solid'], ['b', 'a', 'dashed']]);
    // Horizontal: both ends sit at the same height on their lifelines.
    for (const message of messages) expect(message.from!.anchor.y).toBeCloseTo(message.to!.anchor.y, 6);
  });
});

import { describe, expect, test } from 'vitest';
import { applyCommand, createDocument, type SketchDocument, type SketchElement } from '@/domain';
import { parseSequenceCode, reconcileSequence, sequenceToCode } from '@/renderer/lib/sequence-code';
import { buildSequence, planSequence, readSequence, sequenceMessages, SEQUENCE_NUMBER_KEY, type SequenceFragment, type SequenceItem, type SequenceModel } from '@/renderer/lib/sequence-model';

let counter = 0;
const createId = (prefix: string) => `${prefix}:n${counter += 1}`;
const message = (id: string, from: string, to: string, text: string, kind: 'sync' | 'async' | 'reply' = 'sync'): SequenceItem => ({ type: 'message', id, from, to, text, kind });
const shop: SequenceModel = {
  autonumber: true,
  participants: [{ id: 'k', name: 'Kunde', actor: true }, { id: 's', name: 'Web app', actor: false }, { id: 'b', name: 'Bank', actor: false }],
  items: [
    message('m1', 'k', 's', 'bestellen'),
    { type: 'fragment', id: 'f', operator: 'alt', sections: [
      { id: null, label: 'lieferbar', items: [message('m2', 's', 'b', 'Zahlung\nfreigeben'), message('m3', 'b', 's', 'ok', 'reply'), message('m4', 's', 's', 'buchen')] },
      { id: 'f:else', label: 'sonst', items: [message('m5', 's', 'k', 'Absage', 'async')] },
    ] },
    { type: 'note', id: 'n', text: 'Ein Auftrag', side: 'over', from: 'k', to: 'b' },
    message('m6', 's', 'k', 'fertig', 'reply'),
  ],
};
const page = (document: SketchDocument): SketchElement[] => document.elements.filter((element) => element.pageId === document.pages[0]!.id);
function documentOf(model: SequenceModel): SketchDocument {
  const document = createDocument('Sequence');
  return applyCommand(document, { type: 'add', elements: buildSequence(model, { x: 100, y: 100 }).map((element) => ({ ...element, pageId: document.pages[0]!.id })) });
}
/** A model without ids, to compare what two models say. */
const shape = (model: SequenceModel) => {
  const name = new Map(model.participants.map((participant) => [participant.id, participant.name]));
  const items = (list: readonly SequenceItem[]): unknown[] => list.map((item) => item.type === 'message' ? [name.get(item.from), item.kind, name.get(item.to), item.text]
    : item.type === 'note' ? ['note', item.side, name.get(item.from), name.get(item.to), item.text]
      : [item.operator, ...item.sections.map((section) => [section.label, items(section.items)])]);
  return { autonumber: model.autonumber, participants: model.participants.map((participant) => [participant.name, participant.actor]), items: items(model.items) };
};

describe('a sequence diagram as code (#200)', () => {
  test('the code names participants, messages, blocks and notes in Mermaid notation', () => {
    expect(sequenceToCode(shop)).toBe([
      'sequenceDiagram',
      '    autonumber',
      '    actor Kunde',
      '    participant Webapp as Web app',
      '    participant Bank',
      '    Kunde->>Webapp: bestellen',
      '    alt lieferbar',
      '        Webapp->>Bank: Zahlung<br/>freigeben',
      '        Bank-->>Webapp: ok',
      '        Webapp->>Webapp: buchen',
      '    else sonst',
      '        Webapp-)Kunde: Absage',
      '    end',
      '    Note over Kunde,Bank: Ein Auftrag',
      '    Webapp-->>Kunde: fertig',
      '',
    ].join('\n'));
  });

  test('code reads back as what it was written from', () => {
    const { model, diagnostics } = parseSequenceCode(sequenceToCode(shop));
    expect(diagnostics).toEqual([]);
    expect(shape(model)).toEqual(shape(shop));
  });

  test('names that are no plain word, start with a digit, repeat or are keywords get keys of their own', () => {
    const model: SequenceModel = { autonumber: false, items: [], participants: [
      { id: '1', name: 'API gateway', actor: false }, { id: '2', name: '2. Stufe', actor: false }, { id: '3', name: 'Dienst', actor: false },
      { id: '4', name: 'Dienst', actor: false }, { id: '5', name: 'end', actor: false }, { id: '6', name: 'Zwei\nZeilen', actor: false }, { id: '7', name: '…', actor: false },
    ] };
    const code = sequenceToCode(model);
    expect(code.split('\n').slice(1, -1).map((line) => line.trim())).toEqual([
      'participant APIgateway as API gateway', 'participant T2Stufe as 2. Stufe', 'participant Dienst', 'participant Dienst2 as Dienst',
      'participant Tend as end', 'participant ZweiZeilen as Zwei<br/>Zeilen', 'participant T as …',
    ]);
    expect(shape(parseSequenceCode(code).model)).toEqual(shape(model));
  });

  test('Mermaid written by hand is read: undeclared participants, every arrow, all blocks, notes beside a lifeline, comments', () => {
    const { model, diagnostics } = parseSequenceCode(`sequenceDiagram
      %% ein Kommentar
      participant A as Alice
      A->>John: Hello John;
      John-->>A: Great!
      A-)John: See you
      A->John: plain
      loop Every minute
        John->>John: think
        opt maybe
          critical Connect
            A->>John: try
          option Timeout
            A->>John: retry
          end
        end
      end
      par one
        A->>John: a
      and two
        A->>John: b
      end
      break when broken
        A->>John: stop
      end
      rect rgb(191, 223, 255)
        Note right of John: Text<br/>zwei
      end
      Note left of A: links
    `);
    expect(diagnostics.filter((entry) => entry.severity === 'error')).toEqual([]);
    expect(model.participants.map((participant) => [participant.id, participant.name])).toEqual([['A', 'Alice'], ['John', 'John']]);
    expect(sequenceMessages(model.items).map((entry) => entry.kind).slice(0, 5)).toEqual(['sync', 'reply', 'async', 'sync', 'sync']);
    const blocks = model.items.filter((item): item is SequenceFragment => item.type === 'fragment');
    expect(blocks.map((block) => [block.operator, block.sections.map((section) => section.label)])).toEqual([['loop', ['Every minute']], ['par', ['one', 'two']], ['break', ['when broken']], ['rect', ['']]]);
    const critical = ((blocks[0]!.sections[0]!.items[1] as SequenceFragment).sections[0]!.items[0] as SequenceFragment);
    expect([critical.operator, critical.sections.map((section) => section.label)]).toEqual(['critical', ['Connect', 'Timeout']]);
    expect(blocks[3]!.fill).toBe('rgb(191, 223, 255)');
    expect(blocks[3]!.sections[0]!.items[0]).toMatchObject({ type: 'note', side: 'right', from: 'John', text: 'Text\nzwei' });
    expect(model.items.at(-1)).toMatchObject({ type: 'note', side: 'left', from: 'A', text: 'links' });
    // The plain arrow was read as a call, and says so.
    expect(diagnostics.map((entry) => [entry.line, entry.severity])).toEqual([[7, 'hint']]);
  });

  test('errors name their line; what Mermaid knows beyond the supported part is a hint', () => {
    const { diagnostics } = parseSequenceCode(['sequenceDiagram', 'participant A', 'participant A', 'A->>B: ok', 'else x', 'hallo welt', 'loop a', 'A->>+B: go', 'activate B', 'box Aqua Gruppe', 'participant C', 'end', 'create participant D', 'end', 'end'].join('\n'));
    expect(diagnostics.map((entry) => [entry.line, entry.severity])).toEqual([[3, 'error'], [5, 'error'], [6, 'error'], [9, 'hint'], [10, 'hint'], [13, 'hint'], [15, 'error']]);
    expect(parseSequenceCode('sequenceDiagram\nloop offen\nA->>B: x').diagnostics.map((entry) => [entry.line, entry.severity])).toEqual([[2, 'error']]);
    expect(parseSequenceCode('sequenceDiagram\n').diagnostics.map((entry) => entry.severity)).toEqual(['error']);
    expect(parseSequenceCode('A->>B: ohne Kopfzeile').diagnostics).toEqual([]);
  });

  test('applying changed code keeps the elements of what stayed, moves and adds the rest', () => {
    let document = documentOf(shop);
    const current = readSequence(page(document), 'k')!;
    const coloured = applyCommand(document, { type: 'update', changes: [{ id: 'm1', patch: { style: { stroke: '#ff0000' } } }, { id: 's:head', patch: { style: { fill: '#ffeeee' } } }] });
    document = coloured;
    const code = sequenceToCode(current.model)
      .replace('    participant Bank\n', '    participant Bank\n    participant Lager\n')
      .replace('Kunde->>Webapp: bestellen', 'Kunde->>Webapp: bestellen\n    Webapp->>Lager: reservieren\n    Lager-->>Webapp: reserviert')
      .replace('participant Webapp as Web app', 'participant Webapp as Shop')
      .replace('        Webapp->>Webapp: buchen\n', '')
      .replace('    autonumber\n', '');
    const parsed = parseSequenceCode(code);
    expect(parsed.diagnostics).toEqual([]);
    const next = reconcileSequence(parsed.model, current.model, createId);
    document = applyCommand(document, planSequence(page(document), readSequence(page(document), 'k'), next, { pageId: document.pages[0]!.id }).command!);
    const read = readSequence(page(document), 'k')!;
    expect(shape(read.model)).toEqual(shape(parsed.model));
    // The renamed participant kept its lifeline and its colour; messages kept theirs.
    expect(read.model.participants.map((participant) => participant.id).slice(0, 3)).toEqual(['k', 's', 'b']);
    const by = (id: string) => document.elements.find((element) => element.id === id);
    expect(by('s:head')).toMatchObject({ text: 'Shop', style: { fill: '#ffeeee' } });
    expect(by('m1')!.style.stroke).toBe('#ff0000');
    expect(by('m2')!.text).toBe('Zahlung\nfreigeben');
    // Removed: the call to oneself and the numbers. Added: a lifeline and two messages.
    expect(by('m4')).toBeUndefined();
    expect(by('m1')!.metadata?.[SEQUENCE_NUMBER_KEY]).toBeUndefined();
    expect(sequenceMessages(read.model.items).map((entry) => entry.text)).toEqual(['bestellen', 'reservieren', 'reserviert', 'Zahlung\nfreigeben', 'ok', 'Absage', 'fertig']);
    // The fragment and its divider are the same elements.
    expect(by('f')).toBeDefined();
    expect(by('f:else')!.parentId).toBe('f');
    // Laying the result out again changes nothing.
    expect(planSequence(page(document), read, read.model, { pageId: document.pages[0]!.id }).command).toBeNull();
  });

  test('swapping two participants in the code swaps their lifelines, without moving the diagram', () => {
    let document = documentOf(shop);
    const current = readSequence(page(document), 'k')!;
    const left = Math.min(...page(document).filter((element) => ['k', 's', 'b'].includes(element.id)).map((element) => element.x));
    const code = sequenceToCode(current.model).replace('    actor Kunde\n    participant Webapp as Web app\n', '    participant Webapp as Web app\n    actor Kunde\n');
    const next = reconcileSequence(parseSequenceCode(code).model, current.model, createId);
    document = applyCommand(document, planSequence(page(document), current, next, { pageId: document.pages[0]!.id }).command!);
    const x = (id: string) => document.elements.find((element) => element.id === id)!.x;
    expect(x('s')).toBe(left);
    expect(x('k')).toBeGreaterThan(x('s'));
    expect(x('b')).toBeGreaterThan(x('k'));
  });

  test('a participant that becomes an actor gets the figure instead of the box, and back', () => {
    let document = documentOf(shop);
    const current = readSequence(page(document), 'k')!;
    const head = (id: string) => document.elements.find((element) => element.id === `${id}:head`)!;
    const boxHeight = head('s').height;
    const code = sequenceToCode(current.model).replace('participant Webapp as Web app', 'actor Webapp as Web app').replace('actor Kunde', 'participant Kunde');
    const next = reconcileSequence(parseSequenceCode(code).model, current.model, createId);
    document = applyCommand(document, planSequence(page(document), current, next, { pageId: document.pages[0]!.id }).command!);
    expect(head('s')).toMatchObject({ style: { fill: 'transparent', stroke: 'transparent' } });
    expect(head('s').height).toBeGreaterThan(boxHeight);
    expect(head('k')).toMatchObject({ height: boxHeight, style: { fill: '#e7f5ff' } });
    expect(head('k').style.stroke).not.toBe('transparent');
    // The dashed line starts below each head.
    const line = (id: string) => document.elements.find((element) => element.id === `${id}:line`)!;
    expect(line('s').y).toBe(head('s').y + head('s').height);
    expect(line('k').y).toBe(head('k').y + head('k').height);
  });

  test('changing only the text of a message, the condition of a block or a note keeps their elements', () => {
    const current = shop;
    const code = sequenceToCode(current).replace('Kunde->>Webapp: bestellen', 'Kunde->>Webapp: Bestellung absenden').replace('alt lieferbar', 'alt auf Lager').replace('Ein Auftrag', 'Genau ein Auftrag');
    const next = reconcileSequence(parseSequenceCode(code).model, current, createId);
    expect(next.items.map((item) => item.id)).toEqual(['m1', 'f', 'n', 'm6']);
    expect((next.items[1] as SequenceFragment).sections.map((section) => section.id)).toEqual([null, 'f:else']);
  });
});

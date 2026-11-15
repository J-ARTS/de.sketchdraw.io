import { describe, expect, test } from 'vitest';
import { applyCommand, createDocument, createElement, type SketchDocument, type SketchElement } from '@/domain';
import { BPMN_ICON_KEY } from '@/renderer/lib/bpmn';
import { diagramCodeAnchor, diagramCodeView } from '@/renderer/lib/diagram-code';
import { diagramTemplate } from '@/renderer/lib/diagram-libraries';
import { flowToCode, parseFlowCode } from '@/renderer/lib/flow-code';
import { FLOW_ID_KEY, flowNodeKind, planFlow, readFlow } from '@/renderer/lib/flow-model';
import { planElementPaste } from '@/renderer/state/element-clipboard';

let counter = 0;
const createId = (prefix: string) => `${prefix}:f${counter += 1}`;
const page = (document: SketchDocument): SketchElement[] => document.elements.filter((element) => element.pageId === document.pages[0]!.id);
function withTemplate(id: string, document: SketchDocument = createDocument('Flow'), at = { x: 400, y: 300 }): SketchDocument {
  return applyCommand(document, planElementPaste(diagramTemplate(id)!.build(), document, at, createId).command);
}
const lines = (code: string) => code.trimEnd().split('\n').map((line) => line.trim());
const anyOf = (document: SketchDocument, test: (element: SketchElement) => boolean) => page(document).find(test)!;
/** Applies code to the process that `anchor` belongs to and returns the document and the elements behind the names of the code. */
function applyCode(document: SketchDocument, anchor: string, code: string) {
  const parsed = parseFlowCode(code);
  expect(parsed.diagnostics.filter((entry) => entry.severity === 'error')).toEqual([]);
  const plan = planFlow(page(document), readFlow(page(document), anchor)!, parsed.model, createId, document.pages[0]!.id);
  const next = plan.command ? applyCommand(document, plan.command) : document;
  const element = (id: string) => next.elements.find((candidate) => candidate.id === plan.elementOf.get(id))!;
  return { document: next, element, command: plan.command };
}
const overlapping = (a: SketchElement, b: SketchElement) => a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;
const EXAMPLE = ['flowchart LR', 'e1(( )):::start-message', 't1(Antrag prüfen)', 'g1{X}', 'e2(( )):::end', 'e1 --> t1', 't1 --> g1', 'g1 --> e2'];
const example = () => { const document = withTemplate('bpmn.example'); return { document, anchor: anyOf(document, (element) => element.kind === 'diamond').id }; };

describe('a process as Mermaid code (#206)', () => {
  test('the example of the library reads as events, a task and a gateway joined by flows', () => {
    const { document, anchor } = example();
    const flow = readFlow(page(document), anchor)!;
    expect(lines(flowToCode(flow.model))).toEqual(EXAMPLE);
    // Any element of the process leads to it, also an arrow.
    const arrow = anyOf(document, (element) => element.kind === 'connector');
    expect(flowToCode(readFlow(page(document), arrow.id)!.model)).toBe(flowToCode(flow.model));
    expect(flow.members.size).toBe(7);
  });

  test('code reads back as the model it was written from, with every kind of node, arrow and text', () => {
    const code = [
      'flowchart TD', '    subgraph p1 [Bestellung]', '        subgraph l1 [Vertrieb]', '            e1(( )):::start-timer', '            t1(Prüfen):::user-task', '        end',
      '        subgraph l2 ["Lager (Nord)"]', '            g1{+}', '            d1[(Bestand)]', '            d2[/Lieferschein/]', '        end', '    end',
      '    n1[Kasten]', '    n2(["Text mit (Klammern)<br/>und Umbruch"])', '    e2((Ende)):::end-error', '    g2{Betrag über 100?}',
      '    e1 --> t1', '    t1 -->|ok| g1', '    g1 -.-> d1', '    d1 -.- d2', '    n1 --- n2', '    g1 -->|"a | b"| e2', '',
    ].join('\n');
    const { model, diagnostics } = parseFlowCode(code);
    expect(diagnostics).toEqual([]);
    expect(flowToCode(model)).toBe(code);
    expect(model.direction).toBe('TD');
    expect(model.groups).toEqual([{ id: 'p1', text: 'Bestellung', parent: null }, { id: 'l1', text: 'Vertrieb', parent: 'p1' }, { id: 'l2', text: 'Lager (Nord)', parent: 'p1' }]);
    expect(model.nodes.map((node) => [node.id, node.shape, node.type, node.text, node.group])).toEqual([
      ['e1', 'event', 'start-timer', '', 'l1'], ['t1', 'task', 'user-task', 'Prüfen', 'l1'], ['g1', 'gateway', null, '+', 'l2'], ['d1', 'store', null, 'Bestand', 'l2'], ['d2', 'data', null, 'Lieferschein', 'l2'],
      ['n1', 'box', null, 'Kasten', null], ['n2', 'round', null, 'Text mit (Klammern)\nund Umbruch', null], ['e2', 'event', 'end-error', 'Ende', null], ['g2', 'gateway', null, 'Betrag über 100?', null],
    ]);
    expect(model.edges.map((edge) => [edge.from, edge.kind, edge.to, edge.text])).toEqual([['e1', 'flow', 't1', ''], ['t1', 'flow', 'g1', 'ok'], ['g1', 'message', 'd1', ''], ['d1', 'association', 'd2', ''], ['n1', 'line', 'n2', ''], ['g1', 'flow', 'e2', 'a | b']]);
  });

  test('Mermaid written by hand is read: chains, nodes described in passing, texts inside the arrow, other brackets', () => {
    const { model, diagnostics } = parseFlowCode('graph LR\n  %% Kommentar\n  a((Start)) --> b(Prüfen) -- ja --> c{X}\n  c -. Mahnung .-> d[[Teilprozess]]\n  c ==> e(((Zwischen)));\n  f --> a\n  classDef rot fill:#f00\n  g{{Sechseck}}\n');
    expect(diagnostics.map((entry) => [entry.line, entry.severity])).toEqual([[7, 'hint'], [8, 'hint']]);
    expect(model.nodes.map((node) => [node.id, node.shape, node.type, node.text])).toEqual([
      ['a', 'event', 'start', 'Start'], ['b', 'task', null, 'Prüfen'], ['c', 'gateway', null, '✕'], ['d', 'task', 'subprocess', 'Teilprozess'], ['e', 'event', 'intermediate', 'Zwischen'],
      // A node that is only named is a box with its name as text, as in Mermaid.
      ['f', 'box', null, 'f'], ['g', 'box', null, 'Sechseck'],
    ]);
    expect(model.edges.map((edge) => [edge.from, edge.kind, edge.to, edge.text])).toEqual([['a', 'flow', 'b', ''], ['b', 'flow', 'c', 'ja'], ['c', 'message', 'd', 'Mahnung'], ['c', 'flow', 'e', ''], ['f', 'flow', 'a', '']]);
  });

  test('errors name their line', () => {
    const code = ['flowchart LR', 'a((x)):::kein-ereignis', 'b(offen', 'c & d --> e', 'subgraph p [Pool]', 'f --', 'g --> ', 'p --> f', 'subgraph p [Nochmal]', 'end'].join('\n');
    expect(parseFlowCode(code).diagnostics.filter((entry) => entry.severity === 'error').map((entry) => entry.line)).toEqual([2, 3, 4, 5, 6, 7, 8, 9]);
    expect(parseFlowCode('flowchart LR\n').diagnostics.map((entry) => entry.severity)).toEqual(['error']);
    expect(parseFlowCode('flowchart XY\na --> b').diagnostics.map((entry) => entry.line)).toEqual([1]);
    expect(parseFlowCode('a --> b').diagnostics).toEqual([]);
  });
});

describe('applying the code of a process changes only what the code changed (#206)', () => {
  test('applying the code as it was read only remembers the names; a second time nothing at all', () => {
    const { document, anchor } = example();
    const before = page(document);
    const first = applyCode(document, anchor, EXAMPLE.join('\n'));
    for (const element of before) {
      const after = first.document.elements.find((candidate) => candidate.id === element.id)!;
      expect({ ...after, metadata: undefined }).toEqual({ ...element, metadata: undefined });
    }
    expect(first.element('t1').metadata?.[FLOW_ID_KEY]).toBe('t1');
    expect(applyCode(first.document, anchor, EXAMPLE.join('\n')).command).toBeNull();
    // The names now come from the elements, whatever their order on the canvas.
    const moved = applyCommand(first.document, { type: 'update', changes: [{ id: first.element('e2').id, patch: { x: 0 } }] });
    expect(lines(flowToCode(readFlow(page(moved), anchor)!.model))).toContain('e2(( )):::end');
  });

  test('a changed text and kind change the element in place', () => {
    const { document, anchor } = example();
    const task = anyOf(document, (element) => element.text === 'Antrag prüfen');
    const code = EXAMPLE.join('\n').replace('t1(Antrag prüfen)', 't1(Antrag bewerten):::user-task').replace('e2(( )):::end', 'e2((Fertig)):::end-message').replace('g1{X}', 'g1{+}');
    const { element } = applyCode(document, anchor, code);
    expect(element('t1')).toMatchObject({ id: task.id, text: 'Antrag bewerten', x: task.x, y: task.y, metadata: { [BPMN_ICON_KEY]: 'user' } });
    expect(flowNodeKind(element('t1'))).toEqual({ shape: 'task', type: 'user-task' });
    expect(flowNodeKind(element('e2'))).toEqual({ shape: 'event', type: 'end-message' });
    expect(element('e2').text).toBe('Fertig');
    expect(element('g1').text).toBe('+');
  });

  test('a new node stands beside the node it follows, without covering another one, and its arrows are attached', () => {
    const { document, anchor } = example();
    const code = [...EXAMPLE, 'g1 -->|nein| t2(Nachfragen):::send-task', 't2 --> t1'].join('\n');
    const applied = applyCode(document, anchor, code);
    const added = applied.element('t2');
    const gateway = applied.element('g1');
    expect(added.x).toBeGreaterThan(gateway.x + gateway.width);
    for (const other of ['e1', 't1', 'g1', 'e2']) expect(overlapping(added, applied.element(other))).toBe(false);
    const arrows = page(applied.document).filter((element) => element.kind === 'connector');
    expect(arrows).toHaveLength(5);
    const no = arrows.find((arrow) => arrow.text === 'nein')!;
    expect([no.from!.elementId, no.to!.elementId, no.endMarker]).toEqual([gateway.id, added.id, 'solid-arrow']);
    expect(arrows.some((arrow) => arrow.from!.elementId === added.id && arrow.to!.elementId === applied.element('t1').id)).toBe(true);
    // Nothing that was there moved.
    for (const element of page(document).filter((candidate) => candidate.kind !== 'connector')) expect(applied.document.elements.find((candidate) => candidate.id === element.id)).toMatchObject({ x: element.x, y: element.y });
    expect(lines(flowToCode(readFlow(page(applied.document), anchor)!.model))).toEqual(expect.arrayContaining(['t2(Nachfragen):::send-task', 'g1 -->|nein| t2', 't2 --> t1']));
  });

  test('a node left out of the code goes with its arrows; an arrow can change its kind and its text', () => {
    const { document, anchor } = example();
    const end = anyOf(document, (element) => element.kind === 'ellipse' && element.style.strokeWidth === 4);
    const removed = applyCode(document, anchor, EXAMPLE.filter((line) => !line.includes('e2')).join('\n'));
    expect(removed.document.elements.some((element) => element.id === end.id)).toBe(false);
    expect(page(removed.document).filter((element) => element.kind === 'connector')).toHaveLength(2);
    const changed = applyCode(document, anchor, EXAMPLE.join('\n').replace('t1 --> g1', 't1 -.->|Rückfrage| g1'));
    const arrow = page(changed.document).find((element) => element.text === 'Rückfrage')!;
    expect([arrow.style.strokeDash, arrow.startMarker, arrow.endMarker]).toEqual(['dashed', 'circle', 'triangle']);
    expect(page(changed.document).filter((element) => element.kind === 'connector')).toHaveLength(3);
  });

  test('a task that becomes a gateway is a new element in the same place, and its arrows move over', () => {
    const { document, anchor } = example();
    const task = anyOf(document, (element) => element.text === 'Antrag prüfen');
    const { document: after, element } = applyCode(document, anchor, EXAMPLE.join('\n').replace('t1(Antrag prüfen)', 't1{O}'));
    const made = element('t1');
    expect(made.kind).toBe('diamond');
    expect(made.id).not.toBe(task.id);
    expect(after.elements.some((candidate) => candidate.id === task.id)).toBe(false);
    expect([made.x + made.width / 2, made.y + made.height / 2]).toEqual([task.x + task.width / 2, task.y + task.height / 2]);
    const arrows = page(after).filter((candidate) => candidate.kind === 'connector');
    expect(arrows).toHaveLength(3);
    expect(arrows.filter((arrow) => arrow.to!.elementId === made.id || arrow.from!.elementId === made.id)).toHaveLength(2);
    // Read again, it is the node with the same name.
    expect(lines(flowToCode(readFlow(page(after), made.id)!.model))).toContain('t1{O}');
  });

  test('pools and lanes are subgraphs: nodes are put into lanes, move between them, and lanes and pools can be added and removed', () => {
    const pool = withTemplate('bpmn.pool-lanes');
    const anchor = anyOf(pool, (element) => !element.parentId).id;
    const start = ['flowchart LR', 'subgraph p1 [Pool]', 'subgraph l1 [Bahn 1]', 'end', 'subgraph l2 [Bahn 2]', 'end', 'end'];
    expect(lines(flowToCode(readFlow(page(pool), anchor)!.model))).toEqual(start);

    // Nodes written into the lanes are created there, in the middle of their lane.
    const filled = applyCode(pool, anchor, ['flowchart LR', 'subgraph p1 [Pool]', 'subgraph l1 [Vertrieb]', 'e1((Start))', 't1(Prüfen)', 'end', 'subgraph l2 [Bahn 2]', 't2(Liefern)', 'end', 'end', 'e1 --> t1', 't1 --> t2'].join('\n'));
    const [first, second] = [filled.element('l1'), filled.element('l2')];
    expect(first.text).toBe('Vertrieb');
    expect([filled.element('e1').parentId, filled.element('t1').parentId, filled.element('t2').parentId]).toEqual([first.id, first.id, second.id]);
    expect(filled.element('t1').y + filled.element('t1').height / 2).toBe(first.y + first.height / 2);
    expect(filled.element('t2').y + filled.element('t2').height / 2).toBe(second.y + second.height / 2);
    expect(filled.element('t1').x).toBeGreaterThan(filled.element('e1').x + filled.element('e1').width);
    // The shapes are drawn above the lanes they are in.
    const order = page(filled.document).map((element) => element.id);
    expect(order.indexOf(filled.element('t1').id)).toBeGreaterThan(order.indexOf(first.id));

    // Moved to the other lane in the code, the task changes its lane and its row, not its column.
    const moved = applyCode(filled.document, anchor, flowToCode(readFlow(page(filled.document), anchor)!.model).replace('            t1(Prüfen)\n', '').replace('t2(Liefern)', 't2(Liefern)\n            t1(Prüfen)'));
    expect(moved.element('t1').parentId).toBe(second.id);
    expect(moved.element('t1').x).toBe(filled.element('t1').x);
    expect(moved.element('t1').y + moved.element('t1').height / 2).toBe(second.y + second.height / 2);

    // A third lane comes below the others and the pool grows; a new pool comes below the diagram.
    const height = filled.element('p1').height;
    const grown = applyCode(filled.document, anchor, flowToCode(readFlow(page(filled.document), anchor)!.model).replace('    end\n    e1 -->', '        subgraph l3 [Versand]\n            t3(Packen)\n        end\n    end\n    subgraph p2 [Kunde]\n        e9((Erhalten)):::end\n    end\n    t2 --> t3\n    e1 -->'));
    const third = grown.element('l3');
    expect(third.parentId).toBe(grown.element('p1').id);
    expect(third.y).toBe(second.y + second.height);
    expect(grown.element('p1').height).toBe(height + third.height);
    expect(grown.element('t3').parentId).toBe(third.id);
    const customer = grown.element('p2');
    expect(customer.y).toBeGreaterThan(grown.element('p1').y + grown.element('p1').height);
    expect(grown.element('e9').parentId).toBe(customer.id);

    // A lane left out of the code goes; what was in it and is still in the code stays on the canvas.
    const kept = applyCode(filled.document, anchor, ['flowchart LR', 'subgraph p1 [Pool]', 'subgraph l1 [Vertrieb]', 'e1((Start))', 't1(Prüfen)', 'end', 'end', 't2(Liefern)', 'e1 --> t1', 't1 --> t2'].join('\n'));
    expect(kept.document.elements.some((element) => element.id === second.id)).toBe(false);
    expect(kept.element('t2').id).toBe(filled.element('t2').id);
    expect(kept.element('t2').parentId).toBeUndefined();
    expect(page(kept.document).filter((element) => element.kind === 'connector')).toHaveLength(2);
  });

  test('a pool grows to the right with the nodes that are added to it', () => {
    const pool = withTemplate('bpmn.pool-lanes');
    const anchor = anyOf(pool, (element) => !element.parentId).id;
    const width = anyOf(pool, (element) => !element.parentId).width;
    const chain = Array.from({ length: 7 }, (_, index) => `t${index + 1}(Schritt ${index + 1})`);
    const arrows = chain.slice(1).map((_, index) => `t${index + 1} --> t${index + 2}`);
    const { element } = applyCode(pool, anchor, ['flowchart LR', 'subgraph p1 [Pool]', 'subgraph l1 [Bahn 1]', ...chain, 'end', 'subgraph l2 [Bahn 2]', 'end', 'end', ...arrows].join('\n'));
    const last = element('t7');
    expect(element('p1').width).toBeGreaterThan(width);
    expect(last.x + last.width).toBeLessThan(element('p1').x + element('p1').width);
    expect(element('l2').x + element('l2').width).toBe(element('p1').x + element('p1').width);
  });
});

describe('which diagram has Mermaid code (#206)', () => {
  test('a process by any of its parts, a sequence diagram by its parts, nothing else', () => {
    let document = withTemplate('bpmn.example');
    const gateway = anyOf(document, (element) => element.kind === 'diamond');
    const all = page(document).map((element) => element.id);
    expect(diagramCodeAnchor(page(document), [gateway.id])?.kind).toBe('flow');
    expect(diagramCodeAnchor(page(document), all)?.kind).toBe('flow');
    expect(diagramCodeView(page(document), gateway.id)).toMatchObject({ kind: 'flow', names: 'Antrag prüfen, ✕' });
    // A lone box is no process; a lone BPMN event is one; two boxes joined by an arrow are one.
    document = applyCommand(document, { type: 'add', elements: [
      createElement('rectangle', { id: 'box', x: 2000, y: 0, width: 100, height: 60, pageId: document.pages[0]!.id }),
      createElement('rectangle', { id: 'a', x: 2000, y: 300, width: 100, height: 60, text: 'A', pageId: document.pages[0]!.id }),
      createElement('rectangle', { id: 'b', x: 2300, y: 300, width: 100, height: 60, text: 'B', pageId: document.pages[0]!.id }),
      createElement('connector', { id: 'ab', x: 2100, y: 330, width: 200, height: 0, points: [{ x: 0, y: 0 }, { x: 200, y: 0 }], from: { elementId: 'a', anchor: { x: 1, y: 0.5 } }, to: { elementId: 'b', anchor: { x: 0, y: 0.5 } }, endMarker: 'solid-arrow', pageId: document.pages[0]!.id }),
    ] });
    expect(diagramCodeAnchor(page(document), ['box'])).toBeNull();
    expect(diagramCodeAnchor(page(document), ['a'])?.kind).toBe('flow');
    expect(lines(diagramCodeView(page(document), 'ab')!.code)).toEqual(['flowchart LR', 'n1[A]', 'n2[B]', 'n1 --> n2']);
    expect(diagramCodeAnchor(page(document), [gateway.id, 'a'])).toBeNull();
    const event = withTemplate('bpmn.timer');
    expect(diagramCodeAnchor(page(event), [page(event)[0]!.id])?.kind).toBe('flow');
    const sequence = withTemplate('sequence.example');
    const lifeline = anyOf(sequence, (element) => element.kind === 'container');
    expect(diagramCodeAnchor(page(sequence), [lifeline.id])).toEqual({ kind: 'sequence', anchorId: lifeline.id });
    expect(diagramCodeView(page(sequence), lifeline.id)).toMatchObject({ kind: 'sequence', names: 'Client, Dienst' });
    const table = withTemplate('er.entity');
    expect(diagramCodeAnchor(page(table), [page(table)[0]!.id])).toBeNull();
  });
});

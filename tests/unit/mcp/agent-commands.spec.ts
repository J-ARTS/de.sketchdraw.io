import { describe, expect, it } from 'vitest';
import { applyCommand, createDocument, createElement, type DocumentCommand, type SketchElement } from '../../../src/domain';
import { explainCommandRejection, prepareAgentCommand, summarizeIssues } from '../../../src/agent-access/agent-commands';

// #176: an agent that knows only the tool schema sends lean commands; they must become complete, valid elements.
const lean = (command: unknown) => command as DocumentCommand;
function base() {
  const document = createDocument('Agent');
  document.elements = [
    createElement('rectangle', { id: 'box:a', x: 100, y: 100, width: 160, height: 80 }),
    createElement('rectangle', { id: 'box:b', x: 420, y: 100, width: 160, height: 80 }),
    createElement('rectangle', { id: 'box:below', x: 100, y: 400, width: 160, height: 80 }),
  ];
  return document;
}
const added = (command: DocumentCommand) => (command as Extract<DocumentCommand, { type: 'add' }>).elements;

describe('prepareAgentCommand', () => {
  it('completes a lean shape with rotation, size and a centred default style, and leaves the page to the domain', () => {
    const document = createDocument('Agent');
    const { command, issues } = prepareAgentCommand(lean({ type: 'add', elements: [{ id: 'box:api', kind: 'rectangle', x: 40, y: 60, text: 'API' }] }), document);
    expect(issues).toEqual([]);
    const [element] = added(command);
    expect(element).toMatchObject({ id: 'box:api', kind: 'rectangle', x: 40, y: 60, width: 120, height: 80, rotation: 0, text: 'API', style: { textAlign: 'center', strokeDash: 'solid', opacity: 1 } });
    expect(element).not.toHaveProperty('pageId');
    // The completed command is what the domain accepts as it is.
    expect(applyCommand(document, command).elements).toHaveLength(1);
  });

  it('keeps every style key the agent chose and only fills the rest', () => {
    const { command } = prepareAgentCommand(lean({ type: 'add', elements: [
      { id: 'box:x', kind: 'rectangle', x: 0, y: 0, style: { fill: '#fee2e2', textAlign: 'left' } },
      { id: 'note:x', kind: 'sticky-note', x: 0, y: 200, text: 'Hinweis' },
    ] }), createDocument('Agent'));
    expect(added(command)[0]!.style).toMatchObject({ fill: '#fee2e2', textAlign: 'left', strokeWidth: 2 });
    // Kinds with their own look keep it; only plain shapes get centred captions.
    expect(added(command)[1]!.style.textAlign).toBe('left');
  });

  it('routes a connector that only names its two ends, on the sides that face each other', () => {
    const document = base();
    const { command, issues } = prepareAgentCommand(lean({ type: 'add', elements: [
      { id: 'link:ab', kind: 'connector', from: { elementId: 'box:a' }, to: { elementId: 'box:b' } },
      { id: 'link:down', kind: 'connector', from: { elementId: 'box:a' }, to: { elementId: 'box:below' }, connectorRouting: 'straight', endMarker: 'solid-arrow' },
    ] }), document);
    expect(issues).toEqual([]);
    const [across, down] = added(command) as [SketchElement, SketchElement];
    // Right side of A (x 260) to left side of B (x 420), both at mid height (y 140).
    expect(across).toMatchObject({ x: 260, y: 140, width: 160, height: 0, points: [{ x: 0, y: 0 }, { x: 160, y: 0 }], from: { elementId: 'box:a', anchor: { x: 1, y: 0.5 } }, to: { elementId: 'box:b', anchor: { x: 0, y: 0.5 } }, connectorRouting: 'elbowed', endMarker: 'line-arrow' });
    // Bottom of A (y 180) to top of the box below (y 400); what the agent specified stays.
    expect(down).toMatchObject({ x: 180, y: 180, width: 0, height: 220, points: [{ x: 0, y: 0 }, { x: 0, y: 220 }], from: { anchor: { x: 0.5, y: 1 } }, to: { anchor: { x: 0.5, y: 0 } }, connectorRouting: 'straight', endMarker: 'solid-arrow' });
    expect(applyCommand(document, command).elements).toHaveLength(5);
  });

  it('connects elements created in the same command, in a batch and regardless of their order', () => {
    const document = createDocument('Agent');
    const { command, issues } = prepareAgentCommand(lean({ type: 'batch', commands: [
      { type: 'add', elements: [
        { id: 'link:1', kind: 'connector', from: { elementId: 'n:1' }, to: { elementId: 'n:2' } },
        { id: 'n:1', kind: 'ellipse', x: 0, y: 0, width: 100, height: 100, text: 'Start' },
        { id: 'n:2', kind: 'diamond', x: 300, y: 0, width: 100, height: 100, text: 'Prüfung' },
      ] },
      { type: 'add', elements: [{ id: 'n:3', kind: 'rectangle', x: 600, y: 10 }, { id: 'link:2', kind: 'connector', from: { elementId: 'n:2' }, to: { elementId: 'n:3' } }] },
      { type: 'rename', title: 'Ablauf' },
    ] }), document);
    expect(issues).toEqual([]);
    const result = applyCommand(document, command);
    expect(result.title).toBe('Ablauf');
    expect(result.elements.map(element => element.id)).toEqual(['link:1', 'n:1', 'n:2', 'n:3', 'link:2']);
    expect(result.elements[0]).toMatchObject({ x: 100, y: 50, width: 200, from: { elementId: 'n:1' }, to: { elementId: 'n:2' } });
  });

  it('honours anchors, rotation and an explicit route', () => {
    const document = base();
    document.elements[1] = { ...document.elements[1]!, rotation: 90 };
    const { command } = prepareAgentCommand(lean({ type: 'add', elements: [
      { id: 'link:anchored', kind: 'connector', from: { elementId: 'box:a', anchor: { x: 0.5, y: 0 } }, to: { elementId: 'box:b', anchor: { x: 0.5, y: 0 } } },
      { id: 'link:manual', kind: 'connector', x: 5, y: 6, width: 10, height: 0, points: [{ x: 0, y: 0 }, { x: 10, y: 0 }], from: { elementId: 'box:a', anchor: { x: 1, y: 0.5 } } },
    ] }), document);
    const [anchored, manual] = added(command) as [SketchElement, SketchElement];
    // Top centre of A is (180,100); the top centre of B, rotated by 90° about (500,140), lies at (540,140).
    expect(anchored.x).toBeCloseTo(180); expect(anchored.y).toBeCloseTo(100);
    expect(anchored.width).toBeCloseTo(360); expect(anchored.height).toBeCloseTo(40);
    expect(manual).toMatchObject({ x: 5, y: 6, width: 10, points: [{ x: 0, y: 0 }, { x: 10, y: 0 }] });
    expect(manual.connectorRouting).toBe('straight');
  });

  it('the domain aligns a new connector with a target moved earlier in the same batch', () => {
    const document = base();
    const { command, issues } = prepareAgentCommand(lean({ type: 'batch', commands: [
      { type: 'update', changes: [{ id: 'box:a', patch: { x: 150, y: 150 } }] },
      { type: 'add', elements: [{ id: 'link:moved', kind: 'connector', from: { elementId: 'box:a' }, to: { elementId: 'box:b' } }] },
    ] }), document);
    expect(issues).toEqual([]);
    const result = applyCommand(document, command);
    const link = result.elements.find(element => element.id === 'link:moved')!;
    expect(link.x + link.points![0]!.x).toBe(310);
    expect(link.y + link.points![0]!.y).toBe(190);
    expect(link.x + link.points!.at(-1)!.x).toBe(420);
    expect(link.y + link.points!.at(-1)!.y).toBe(140);
    expect(document.elements[0]).toMatchObject({ x: 100, y: 100 });
  });

  it('chooses facing anchors after a target crosses the other shape in a batch', () => {
    const { command, issues } = prepareAgentCommand(lean({ type: 'batch', commands: [
      { type: 'update', changes: [{ id: 'box:a', patch: { x: 700 } }] },
      { type: 'add', elements: [{ id: 'link:crossed', kind: 'connector', from: { elementId: 'box:a' }, to: { elementId: 'box:b' } }] },
    ] }), base());
    expect(issues).toEqual([]);
    const link = applyCommand(base(), command).elements.find(element => element.id === 'link:crossed')!;
    expect(link.from?.anchor).toEqual({ x: 0, y: 0.5 });
    expect(link.to?.anchor).toEqual({ x: 1, y: 0.5 });
  });

  it('reports what it cannot complete with the path of the element, and then changes nothing', () => {
    const original = lean({ type: 'add', elements: [
      { kind: 'rectangle', x: 0, y: 0 },
      { id: 'web:1', kind: 'web-embed', x: 0, y: 0 },
      { id: 'img:1', kind: 'image', x: 0, y: 0 },
      { id: 'box:typo', kind: 'rectangle', x: 0, y: 0, colour: 'red', style: { background: 'red' } },
      { id: 'box:kind', kind: 'square', x: 0, y: 0 },
    ] });
    const { command, issues } = prepareAgentCommand(original, createDocument('Agent'));
    expect(command).toBe(original);
    expect(issues.map(issue => [issue.path, issue.code])).toEqual([
      ['elements[0].id', 'MISSING_ID'], ['elements[1].embedUrl', 'MISSING_EMBED_URL'], ['elements[2].assetId', 'MISSING_ASSET'],
      ['elements[3].colour', 'UNKNOWN_FIELD'], ['elements[3].style.background', 'UNKNOWN_FIELD'], ['elements[4].kind', 'INVALID_ELEMENT_KIND'],
    ]);
    expect(summarizeIssues(issues)).toBe('Command rejected: elements[0].id: Every added element needs an "id" you choose, for example "box:api". (+5 more in "issues")');
  });

  it('passes other commands, unknown references and non-objects through for the domain to judge', () => {
    const document = base();
    const update = lean({ type: 'update', changes: [{ id: 'box:a', patch: { text: 'A' } }] });
    expect(prepareAgentCommand(update, document)).toEqual({ command: update, issues: [] });
    // A connector to something that does not exist is named as such, not as a missing route.
    const dangling = prepareAgentCommand(lean({ type: 'add', elements: [{ id: 'link:x', kind: 'connector', from: { elementId: 'nope' }, to: { elementId: 'box:b' } }] }), document);
    expect(dangling.issues).toEqual([{ path: 'elements[0].from.elementId', code: 'UNKNOWN_CONNECTOR_TARGET', message: 'Cannot attach to "nope": no such shape in the document or in this command.' }]);
    // An unbound connector with its own geometry needs no targets.
    expect(prepareAgentCommand(lean({ type: 'add', elements: [{ id: 'line:free', kind: 'connector', x: 0, y: 0, width: 100, height: 0 }] }), document).issues).toEqual([]);
    for (const odd of ['rename', null, 7, { type: 'add', elements: 'none' }, { type: 'add', elements: [null, 'x'] }]) expect(prepareAgentCommand(lean(odd), document).issues).toEqual([]);
  });
});

describe('explainCommandRejection', () => {
  it('names the field the domain refuses and stays silent for a valid command', () => {
    const document = base();
    expect(explainCommandRejection(document, lean({ type: 'rename', title: 'Neu' }))).toEqual([]);
    const unknown = explainCommandRejection(document, lean({ type: 'update', changes: [{ id: 'nope', patch: { text: 'x' } }] }));
    expect(unknown[0]).toMatchObject({ path: expect.stringContaining('changes[0]') });
    expect(unknown[0]!.message).toContain('nope');
    const type = explainCommandRejection(document, lean({ type: 'create_box' }));
    expect(type.length).toBeGreaterThan(0);
    expect(summarizeIssues(type)).toMatch(/^Command rejected: /);
    expect(summarizeIssues([])).toBe('Change was rejected by the shared document authority.');
    // At most twenty issues travel to the agent.
    const many = explainCommandRejection(document, lean({ type: 'delete', ids: Array.from({ length: 60 }, (_, index) => `missing:${index}`) }));
    expect(many).toHaveLength(20);
  });
});

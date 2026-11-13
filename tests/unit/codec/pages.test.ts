import { describe, expect, it } from 'vitest';
import { applyCommand, createDocument, createElement } from '../../../src/domain';
import { formatDiagram, parseDiagram } from '../../../src/codec';

const script = [
  'sketchdraw 2',
  'document {"id":"doc:pages","title":"Mehrere Seiten"}',
  '',
  'page "page:1" {"name":"Übersicht"}',
  'rectangle "a" {"x":0,"y":0,"width":80,"height":40}',
  'page "page:2" {"name":"Details"}',
  'rectangle "b" {"x":10,"y":10,"width":80,"height":40}',
  'ellipse "c" {"x":100,"y":10,"width":80,"height":40}',
].join('\n');

describe('Diagram as code with pages', () => {
  it('parses page sections: the elements after a page line belong to it', () => {
    const result = parseDiagram(script);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.document.pages).toEqual([{ id: 'page:1', name: 'Übersicht' }, { id: 'page:2', name: 'Details' }]);
    expect(result.document.elements.map((element) => [element.id, element.pageId])).toEqual([['a', 'page:1'], ['b', 'page:2'], ['c', 'page:2']]);
  });

  it('round-trips pages deterministically', () => {
    const parsed = parseDiagram(script);
    if (!parsed.ok) throw new Error('parse failed');
    const formatted = formatDiagram(parsed.document);
    expect(formatted).toContain('page "page:2" {"name":"Details"}');
    const again = parseDiagram(formatted);
    expect(again.ok).toBe(true);
    if (!again.ok) return;
    expect(again.document).toEqual(parsed.document);
    expect(formatDiagram(again.document)).toBe(formatted);
  });

  it('formats a document with several pages in page order, each page in stacking order', () => {
    let doc = createDocument('x');
    doc = applyCommand(doc, { type: 'add-page', page: { id: 'page:2', name: 'Zwei' } });
    doc = applyCommand(doc, { type: 'add', pageId: 'page:2', elements: [createElement('rectangle', { id: 'z', pageId: 'page:2' })] });
    doc = applyCommand(doc, { type: 'add', pageId: 'page:1', elements: [createElement('rectangle', { id: 'y', pageId: 'page:1' })] });
    const text = formatDiagram(doc);
    expect(text.indexOf('rectangle "y"')).toBeLessThan(text.indexOf('page "page:2"'));
    expect(text.indexOf('page "page:2"')).toBeLessThan(text.indexOf('rectangle "z"'));
  });

  it('keeps reading version-1 scripts as a single default page', () => {
    const result = parseDiagram('sketchdraw 1\ndocument {"id":"d1","title":"alt"}\nrectangle "r" {"x":0,"y":0,"width":10,"height":10}');
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.document.pages).toEqual([{ id: 'page:1', name: 'Seite 1' }]);
    expect(result.document.elements[0]!.pageId).toBe('page:1');
  });

  it('an explicit declaration of the default page after its first elements names it instead of duplicating it', () => {
    const result = parseDiagram('sketchdraw 2\ndocument {"id":"d1","title":"t"}\nrectangle "r" {"x":0,"y":0,"width":10,"height":10}\npage "page:1" {"name":"Benannt"}\nrectangle "s" {"x":0,"y":0,"width":10,"height":10}');
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.document.pages).toEqual([{ id: 'page:1', name: 'Benannt' }]);
    expect(result.document.elements).toHaveLength(2);
  });

  it('reports duplicate pages, unknown page fields, a repeated pageId in element JSON and bad names', () => {
    const duplicate = parseDiagram('sketchdraw 2\ndocument {"id":"d","title":"t"}\npage "p" {"name":"A"}\npage "p" {"name":"B"}');
    expect(duplicate.ok).toBe(false);
    if (!duplicate.ok) expect(duplicate.diagnostics.map((entry) => entry.code)).toContain('DUPLICATE_DECLARATION');
    const unknown = parseDiagram('sketchdraw 2\ndocument {"id":"d","title":"t"}\npage "p" {"name":"A","color":"red"}');
    expect(unknown.ok).toBe(false);
    if (!unknown.ok) expect(unknown.diagnostics.map((entry) => entry.code)).toContain('UNKNOWN_FIELD');
    const repeated = parseDiagram('sketchdraw 2\ndocument {"id":"d","title":"t"}\npage "p" {"name":"A"}\nrectangle "r" {"pageId":"p","x":0,"y":0,"width":1,"height":1}');
    expect(repeated.ok).toBe(false);
    if (!repeated.ok) expect(repeated.diagnostics.map((entry) => entry.code)).toContain('UNKNOWN_FIELD');
    const blank = parseDiagram('sketchdraw 2\ndocument {"id":"d","title":"t"}\npage "p" {"name":"   "}');
    expect(blank.ok).toBe(false);
    if (!blank.ok) expect(blank.diagnostics.map((entry) => entry.code)).toContain('INVALID_PAGE_NAME');
  });
});

// #176: a connector line may name its two ends and leave the route to the parser.
describe('Diagram as code with connectors bound at both ends', () => {
  const head = ['sketchdraw 2', 'document {"id":"doc:lean","title":"Lean","metadata":{}}', ''];
  const parse = (...lines: string[]) => parseDiagram([...head, ...lines, ''].join('\n'));

  it('computes position, points and anchors from the two elements, wherever they stand in the script', () => {
    const result = parse(
      'connector "link:ab" {"from":{"elementId":"box:a"},"to":{"elementId":"box:b"}}',
      'rectangle "box:a" {"x":100,"y":100,"width":160,"height":80,"text":"A"}',
      'rectangle "box:b" {"x":420,"y":100,"width":160,"height":80,"text":"B"}',
      'connector "link:down" {"from":{"elementId":"box:a"},"to":{"elementId":"box:c"},"connectorRouting":"straight","endMarker":"solid-arrow"}',
      'ellipse "box:c" {"x":100,"y":400,"width":160,"height":80}',
    );
    expect(result.diagnostics).toEqual([]);
    if (!result.ok) throw new Error('Expected the script to parse.');
    const [across, , , down] = result.document.elements;
    expect(across).toMatchObject({ id: 'link:ab', x: 260, y: 140, width: 160, height: 0, points: [{ x: 0, y: 0 }, { x: 160, y: 0 }], from: { elementId: 'box:a', anchor: { x: 1, y: 0.5 } }, to: { elementId: 'box:b', anchor: { x: 0, y: 0.5 } }, connectorRouting: 'elbowed' });
    expect(down).toMatchObject({ id: 'link:down', x: 180, y: 180, width: 0, height: 220, connectorRouting: 'straight', endMarker: 'solid-arrow' });
    // What the parser computed is written out in full, and reading that back changes nothing.
    const written = formatDiagram(result.document);
    expect(written).toContain('"points":[{"x":0,"y":0},{"x":160,"y":0}]');
    const again = parseDiagram(written, result.document);
    expect(again.ok && again.document.elements).toEqual(result.document.elements);
  });

  it('takes a connector with its own route as written and still reports a missing end', () => {
    const explicit = parse(
      'rectangle "box:a" {"x":0,"y":0,"width":100,"height":50}',
      'rectangle "box:b" {"x":300,"y":0,"width":100,"height":50}',
      'connector "link:own" {"x":10,"y":20,"width":50,"height":0,"points":[{"x":0,"y":0},{"x":50,"y":0}],"from":{"elementId":"box:a","anchor":{"x":1,"y":0.5}},"to":{"elementId":"box:b","anchor":{"x":0,"y":0.5}}}',
    );
    expect(explicit.ok && explicit.document.elements[2]).toMatchObject({ x: 10, y: 20, width: 50, points: [{ x: 0, y: 0 }, { x: 50, y: 0 }] });
    expect(explicit.ok && explicit.document.elements[2]!.connectorRouting).toBeUndefined();

    const dangling = parse('rectangle "box:a" {"x":0,"y":0,"width":100,"height":50}', 'connector "link:x" {"from":{"elementId":"box:a"},"to":{"elementId":"box:nowhere"}}');
    expect(dangling.ok).toBe(false);
    expect(dangling.diagnostics.some(diagnostic => diagnostic.line === 5)).toBe(true);
  });

  it('does not route across pages', () => {
    const result = parse(
      'page "page:1" {"name":"Eins"}',
      'rectangle "box:a" {"x":0,"y":0,"width":100,"height":50}',
      'page "page:2" {"name":"Zwei"}',
      'rectangle "box:b" {"x":300,"y":0,"width":100,"height":50}',
      'connector "link:cross" {"from":{"elementId":"box:a"},"to":{"elementId":"box:b"}}',
    );
    expect(result.ok).toBe(false);
  });

  it.each([
    ['points with the wrong type', { points: 'invalid' }, 'points'],
    ['a route with only one point', { points: [{ x: 4, y: 5 }] }, 'points'],
    ['an explicit invalid anchor', { from: { elementId: 'box:a', anchor: 'invalid' } }, 'from.anchor'],
    ['an explicit null anchor', { to: { elementId: 'box:b', anchor: null } }, 'to.anchor'],
    ['an explicit null routing', { connectorRouting: null }, 'connectorRouting'],
  ])('rejects %s instead of replacing it with inferred geometry', (_name, fields, field) => {
    const result = parse(
      'rectangle "box:a" {"x":0,"y":0,"width":100,"height":50}',
      'rectangle "box:b" {"x":300,"y":0,"width":100,"height":50}',
      `connector "link:invalid" ${JSON.stringify({ from: { elementId: 'box:a' }, to: { elementId: 'box:b' }, ...fields })}`,
    );
    expect(result.ok).toBe(false);
    expect(result.diagnostics).toContainEqual(expect.objectContaining({ line: 6, issuePath: `elements[2].${field}` }));
  });
});

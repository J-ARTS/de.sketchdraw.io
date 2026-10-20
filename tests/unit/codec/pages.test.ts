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

import { describe, expect, test } from 'vitest';
import { applyCommand, createDocument, createElement } from '@/domain';
import { importDrawio, inspectDrawio, importSvg, InteropError, prepareDrawioExport, prepareSvgExport } from '@/interop';

function twoPageDocument() {
  let doc = createDocument('Architektur');
  doc = applyCommand(doc, { type: 'rename-page', pageId: 'page:1', name: 'Übersicht' });
  doc = applyCommand(doc, { type: 'add-page', page: { id: 'page:2', name: 'Details' } });
  doc = applyCommand(doc, { type: 'add', pageId: 'page:1', elements: [createElement('rectangle', { id: 'a', pageId: 'page:1', x: 0, y: 0, width: 80, height: 40, text: 'Eins' })] });
  doc = applyCommand(doc, { type: 'add', pageId: 'page:2', elements: [
    createElement('rectangle', { id: 'b', pageId: 'page:2', x: 10, y: 10, width: 80, height: 40, text: 'Zwei' }),
    createElement('rectangle', { id: 'c', pageId: 'page:2', x: 200, y: 10, width: 80, height: 40, text: 'Drei' }),
  ] });
  return doc;
}

const foreign = `<mxfile><diagram id="p1" name="Erste"><mxGraphModel><root><mxCell id="0"/><mxCell id="1" parent="0"/>
<mxCell id="2" value="A" style="rounded=0;" vertex="1" parent="1"><mxGeometry x="0" y="0" width="80" height="40" as="geometry"/></mxCell>
<mxCell id="3" value="B" style="rounded=0;" vertex="1" parent="1"><mxGeometry x="200" y="0" width="80" height="40" as="geometry"/></mxCell>
<mxCell id="4" edge="1" parent="1" source="2" target="3"><mxGeometry relative="1" as="geometry"/></mxCell></root></mxGraphModel></diagram>
<diagram id="p2" name="Zweite"><mxGraphModel><root><mxCell id="0"/><mxCell id="1" parent="0"/>
<mxCell id="2" value="C" style="rounded=0;" vertex="1" parent="1"><mxGeometry x="5" y="5" width="60" height="30" as="geometry"/></mxCell></root></mxGraphModel></diagram></mxfile>`;

describe('multi-page interoperability', () => {
  test('draw.io export writes one diagram per page in page order and round-trips the whole document', () => {
    const doc = twoPageDocument();
    const exported = prepareDrawioExport(doc);
    expect(inspectDrawio(exported.contents).map((page) => page.name)).toEqual(['Übersicht', 'Details']);
    const imported = importDrawio(exported.contents, { pageIndex: 'all' });
    expect(imported.fidelity).toBe('own-roundtrip');
    expect(imported.document.pages).toEqual(doc.pages);
    expect(imported.document.elements.map((element) => [element.id, element.pageId])).toEqual([['a', 'page:1'], ['b', 'page:2'], ['c', 'page:2']]);
  });

  test('a single selected page of an own export narrows to that page', () => {
    const exported = prepareDrawioExport(twoPageDocument());
    const first = importDrawio(exported.contents, { pageIndex: 0 });
    expect(first.document.pages.map((page) => page.name)).toEqual(['Übersicht']);
    expect(first.document.elements.map((element) => element.id)).toEqual(['a']);
    const second = importDrawio(exported.contents, { pageIndex: 1 });
    expect(second.document.elements).toHaveLength(2);
  });

  test('importing all pages of a foreign file keeps names, order and disambiguates repeated cell ids', () => {
    const result = importDrawio(foreign, { pageIndex: 'all' });
    expect(result.document.pages.map((page) => page.name)).toEqual(['Erste', 'Zweite']);
    const byPage = (pageId: string) => result.document.elements.filter((element) => element.pageId === pageId);
    expect(byPage('page:1').map((element) => element.text)).toEqual(expect.arrayContaining(['A', 'B']));
    expect(byPage('page:2').map((element) => element.text)).toEqual(['C']);
    expect(new Set(result.document.elements.map((element) => element.id)).size).toBe(result.document.elements.length);
    const edge = byPage('page:1').find((element) => element.kind === 'connector')!;
    expect(edge.from?.elementId).toBeDefined();
    expect(byPage('page:1').some((element) => element.id === edge.from!.elementId)).toBe(true);
  });

  test('a multi-page file still needs an explicit choice unless "all" is requested', () => {
    try { importDrawio(foreign); throw new Error('should fail'); } catch (error) {
      expect(error).toBeInstanceOf(InteropError);
      expect((error as InteropError).code).toBe('PAGE_SELECTION_REQUIRED');
    }
  });

  test('SVG shows one page: the first by default, or the requested one', () => {
    const doc = twoPageDocument();
    const first = prepareSvgExport(doc, { embedDocument: false });
    expect(first.contents).toContain('Eins');
    expect(first.contents).not.toContain('Zwei');
    expect(first.diagnostics.find((diagnostic) => diagnostic.code === 'PAGE_EXPORTED_SINGLE')?.severity).toBe('info');
    const second = prepareSvgExport(doc, { pageId: 'page:2' });
    expect(second.contents).toContain('Zwei');
    expect(importSvg(second.contents).document.pages).toEqual([{ id: 'page:2', name: 'Details' }]);
    expect(() => prepareSvgExport(doc, { pageId: 'nope' })).toThrow(InteropError);
  });
});

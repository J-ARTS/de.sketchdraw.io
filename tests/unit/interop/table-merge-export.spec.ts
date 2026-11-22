import { describe, expect, it } from 'vitest';
import { createDocument, createElement, createTableDocument } from '@/domain';
import { TABLE_MERGES_KEY } from '@/domain/table-merge';
import { importDrawio, importSvg, prepareDrawioExport, prepareSvgExport } from '@/interop';
import { drawioProjectionForValidation, svgProjectionForValidation } from '@/interop/export';

// #287: a cell below a merge is not drawn on the canvas, so the export must not show its text either.
const HIDDEN = 'Interner Entwurf';
function mergedTable() {
  const document = createDocument('Tabelle');
  const table = createTableDocument(2, 2);
  const at = (row: number, column: number) => table.cells.find((cell) => cell.rowId === table.rows[row]!.id && cell.columnId === table.columns[column]!.id)!;
  at(0, 0).text = 'Freigabe'; at(0, 1).text = HIDDEN; at(1, 0).text = 'Unten links'; at(1, 1).text = 'Unten rechts';
  const element = createElement('table', { id: 'table', pageId: document.pages[0]!.id, x: 0, y: 0, width: 400, height: 120, table, metadata: { [TABLE_MERGES_KEY]: `${at(0, 0).id}>${at(0, 1).id}` } });
  return { ...document, elements: [element] };
}
const cells = (svg: string) => [...svg.matchAll(/<rect x="([^"]+)" y="([^"]+)" width="([^"]+)" height="([^"]+)" fill="[^"]+" stroke="#cbd5e1"/g)].map((match) => match.slice(1, 5).map(Number));
const picture = (drawio: string) => Buffer.from(/image=data:image\/svg\+xml,([^;"]+)/.exec(drawio)![1]!, 'base64').toString('utf8');

describe('export of merged table cells', () => {
  it('SVG draws the merge as one cell over both columns and leaves the hidden text out', () => {
    const svg = prepareSvgExport(mergedTable(), { embedDocument: false }).contents;
    expect(svg).toContain('Freigabe');
    expect(svg).not.toContain(HIDDEN);
    expect(cells(svg)).toEqual([[0, 0, 400, 60], [0, 60, 200, 60], [200, 60, 200, 60]]);
  });

  it('the picture inside a draw.io file and the hidden text of its cell leave it out as well', () => {
    const drawio = prepareDrawioExport(mergedTable(), { embedDocument: false }).contents;
    expect(picture(drawio)).toContain('Freigabe');
    expect(picture(drawio)).not.toContain(HIDDEN);
    expect(drawio).not.toContain(HIDDEN);
    // The file read back shows what it showed: the cell next to "Freigabe" is empty.
    const table = importDrawio(drawio).document.elements[0]!.table!;
    expect(table.cells.map((cell) => cell.text)).toEqual(['Freigabe', '', 'Unten links', 'Unten rechts']);
  });

  it('a table without merges is drawn cell by cell as before', () => {
    const document = mergedTable();
    const plain = { ...document, elements: [{ ...document.elements[0]!, metadata: {} }] };
    // Apart from the embedded document, which names its picture.
    const drawn = (svg: string) => svg.replace(/<metadata>.*<\/metadata>/s, '');
    expect(drawn(svgProjectionForValidation(plain, 3)) === drawn(svgProjectionForValidation(plain, 2))).toBe(true);
    expect(cells(svgProjectionForValidation(plain, 3))).toHaveLength(4);
  });

  it('earlier pictures stay what their exporter drew, for files written with them', () => {
    const document = mergedTable();
    expect(svgProjectionForValidation(document, 2)).toContain(HIDDEN);
    expect(cells(svgProjectionForValidation(document, 2))).toHaveLength(4);
    expect(picture(drawioProjectionForValidation(document, 4))).toContain(HIDDEN);
    expect(picture(drawioProjectionForValidation(document, 5))).not.toContain(HIDDEN);
  });

  it('with the embedded document the table comes back whole, hidden cell and merge included', () => {
    const document = mergedTable();
    for (const result of [importSvg(prepareSvgExport(document).contents), importDrawio(prepareDrawioExport(document).contents)]) {
      expect(result.fidelity).toBe('own-roundtrip');
      const table = result.document.elements[0]!;
      expect(table.table!.cells.map((cell) => cell.text)).toContain(HIDDEN);
      expect(table.metadata?.[TABLE_MERGES_KEY]).toBe(document.elements[0]!.metadata![TABLE_MERGES_KEY]);
    }
  });
});

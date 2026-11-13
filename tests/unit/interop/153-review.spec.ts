import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createDocument, createElement, DOMAIN_LIMITS, extractPage, MAX_TABLE_CELLS, serializeDocument } from '../../../src/domain';
import { importDrawio } from '../../../src/interop/drawio';
import { importSvg } from '../../../src/interop/svg';
import { prepareDrawioExport, prepareSvgExport } from '../../../src/interop/export';

const allocationRequests = vi.hoisted(() => [] as number[]);
vi.mock('../../../src/domain', async importOriginal => {
  const actual = await importOriginal<typeof import('../../../src/domain')>();
  return {
    ...actual,
    createTableDocument(rows: number, columns: number) {
      allocationRequests.push(rows * columns);
      // Keep the independent resource-limit probe safe even if the importer has no guard yet.
      if (rows * columns > actual.MAX_TABLE_CELLS) throw new Error('REVIEW_BLOCKED_OVERSIZED_TABLE_ALLOCATION');
      return actual.createTableDocument(rows, columns);
    },
  };
});
beforeEach(() => { allocationRequests.length = 0; });

function multipage() {
  const doc = createDocument('Own multi-page document');
  doc.pages.push({ id: 'page:details', name: 'Details' });
  doc.metadata = { review: 'keep me' };
  doc.elements = [createElement('rectangle', { id: 'overview', text: 'Overview' }), createElement('sticky-note', {
    id: 'original-note', pageId: 'page:details', text: 'Detailed plan', author: 'Alice', metadata: { issue: '153' },
  })];
  return doc;
}
function foreignCell(label: string, style = '') {
  const value = label.replaceAll('\t', '&#9;').replaceAll('\n', '&#10;');
  return `<mxGraphModel><root><mxCell id="0"/><mxCell id="1" parent="0"/><mxCell id="cell" parent="1" vertex="1" value="${value}" style="html=0;${style}"><mxGeometry width="200" height="100" as="geometry"/></mxCell></root></mxGraphModel>`;
}
function foreignTable(label: string, style = '') {
  return foreignCell(label, `sketchdrawKind=table;shape=table;${style}`);
}

describe('independent interoperability regressions (#153)', () => {
  it('restores the own model when selecting a later draw.io page', () => {
    const source = multipage();
    const imported = importDrawio(prepareDrawioExport(source).contents, { pageIndex: 1 });
    expect(imported.fidelity).toBe('own-roundtrip');
    expect(serializeDocument(imported.document)).toBe(serializeDocument(extractPage(source, 'page:details')));
  });

  it.each(['Overview', 'Detailed plan'])('does not restore metadata if visible text %s changed on either page', changedText => {
    const source = multipage();
    const xml = prepareDrawioExport(source).contents.replace(`value="${changedText}"`, 'value="Changed externally"');
    const imported = importDrawio(xml, { pageIndex: 1 });
    expect(imported.fidelity).not.toBe('own-roundtrip');
    expect(imported.diagnostics.some(item => item.code === 'EMBEDDED_MODEL_STALE')).toBe(true);
    expect(imported.document.elements[0]!.text).toBe(changedText === 'Detailed plan' ? 'Changed externally' : 'Detailed plan');
    expect(imported.document.elements[0]!.metadata?.['issue']).toBeUndefined();
  });

  it('falls back to the selected native page when the first-page envelope is invalid', () => {
    const xml = prepareDrawioExport(multipage()).contents.replace(/sketchdrawInterop="[^"]+"/, 'sketchdrawInterop="invalid"');
    const imported = importDrawio(xml, { pageIndex: 1 });
    expect(imported.fidelity).not.toBe('own-roundtrip');
    expect(imported.diagnostics.some(item => item.code === 'EMBEDDED_MODEL_INVALID')).toBe(true);
    expect(imported.document.elements[0]!.text).toBe('Detailed plan');
  });

  it('rejects a sparse table label before requesting a Cartesian cell allocation above the domain limit', () => {
    const label = ['x\t'.repeat(31) + 'x', ...Array.from({ length: 32 }, () => 'x')].join('\n');
    expect(() => importDrawio(foreignTable(label))).toThrow(expect.objectContaining({ code: 'LIMIT_EXCEEDED' }));
    expect(allocationRequests).toEqual([]);
  });

  it('rejects excessive table text before requesting even one cell', () => {
    expect(() => importDrawio(foreignTable('x'.repeat(DOMAIN_LIMITS.MAX_TEXT_LENGTH + 1))))
      .toThrow(expect.objectContaining({ code: 'LIMIT_EXCEEDED' }));
    expect(allocationRequests).toEqual([]);
  });

  it('budgets padding tabs before allocating a sparse table near the text limit', () => {
    const label = 'a\tb\tc\td\te\tf\tg\th\ti\tj\n' + 'x'.repeat(49_975) + '\ny';
    expect(label.length).toBe(49_997);
    expect(() => importDrawio(foreignTable(label))).toThrow(expect.objectContaining({ code: 'LIMIT_EXCEEDED' }));
    expect(allocationRequests).toEqual([]);
  });

  it('accepts the cell budget boundary and fills missing sparse cells without shifting text', () => {
    const label = ['A\tB\tC\tD\tE', ...Array.from({ length: 99 }, () => 'Z')].join('\n');
    const table = importDrawio(foreignTable(label)).document.elements[0]!.table!;
    expect(table.cells).toHaveLength(MAX_TABLE_CELLS);
    expect(table.cells.slice(0, 7).map(cell => cell.text)).toEqual(['A', 'B', 'C', 'D', 'E', 'Z', '']);
    expect(allocationRequests).toEqual([MAX_TABLE_CELLS]);
  });

  it('imports an empty table as one editable cell', () => {
    const table = importDrawio(foreignTable('')).document.elements[0]!.table!;
    expect(table.cells).toHaveLength(1);
    expect(table.cells[0]!.text).toBe('');
  });

  it('uses the native draw.io fontColor for imported table text independently of the outline', () => {
    const xml = foreignTable('Cell text', 'fontColor=#ff0000;strokeColor=#0000ff');
    const element = importDrawio(xml).document.elements[0]!;
    expect(element.style.stroke).toBe('#0000ff');
    expect(element.table!.cells[0]!.style.color).toBe('#ff0000');
  });

  it.each(['#f00', '#ff0000', 'rgb(255, 0, 0)', '#f00f', '#ff0000ff', 'rgba(255, 0, 0, 1)'])('normalizes opaque table ink %s to the cell color contract', ink => {
    const imported = importDrawio(foreignTable('Cell', `fontColor=${ink};fillColor=#fff;strokeColor=#0000ff`));
    expect(imported.document.elements[0]!.table!.cells[0]!.style).toMatchObject({ color: '#ff0000', fill: '#ffffff' });
    expect(imported.diagnostics.filter(item => item.property === 'fontColor')).toEqual([]);
  });

  it.each(['#f008', '#ff000080', 'rgba(255, 0, 0, 0.5)'])('keeps table hue and diagnoses unsupported cell transparency for %s', ink => {
    const imported = importDrawio(foreignTable('Cell', `fontColor=${ink};fillColor=rgba(255, 255, 255, 0.5)`));
    expect(imported.document.elements[0]!.table!.cells[0]!.style).toMatchObject({ color: '#ff0000', fill: '#ffffff' });
    expect(imported.diagnostics).toContainEqual(expect.objectContaining({ code: 'STYLE_APPROXIMATED', property: 'fontColor' }));
    expect(imported.diagnostics).toContainEqual(expect.objectContaining({ code: 'STYLE_APPROXIMATED', property: 'fillColor' }));
  });

  it('diagnoses transparent table ink and fill while using valid independent defaults', () => {
    const imported = importDrawio(foreignTable('Cell', 'fontColor=none;fillColor=none;strokeColor=#ff0000'));
    expect(imported.document.elements[0]!.table!.cells[0]!.style).toMatchObject({ color: '#000000', fill: '#ffffff' });
    expect(imported.diagnostics).toContainEqual(expect.objectContaining({ code: 'STYLE_APPROXIMATED', property: 'fontColor' }));
    expect(imported.diagnostics).toContainEqual(expect.objectContaining({ code: 'STYLE_APPROXIMATED', property: 'fillColor' }));
  });

  // #157 supersedes the former outline-color fallback assertion from #156:
  // draw.io defaults fontColor independently, so colored borders must not tint text.
  it.each(['shape=rectangle;', 'shape=text;', 'sketchdrawKind=table;shape=table;'])('uses independent default text ink for %s and reports theme approximation', shape => {
    const imported = importDrawio(foreignCell('Default ink', `${shape}strokeColor=#ff0000;`));
    const element = imported.document.elements[0]!;
    expect(element.style.textColor).toBe('#000000');
    expect(element.style.stroke).toBe('#ff0000');
    if (element.table) expect(element.table.cells[0]!.style.color).toBe('#000000');
    expect(imported.diagnostics).toContainEqual(expect.objectContaining({ code: 'STYLE_APPROXIMATED', property: 'fontColor' }));
  });

  it.each(['shape=rectangle;', 'shape=text;', 'sketchdrawKind=table;shape=table;'])('preserves explicit text ink for %s', shape => {
    const imported = importDrawio(foreignCell('Explicit ink', `${shape}fontColor=#00ff00;strokeColor=#ff0000;`));
    const element = imported.document.elements[0]!;
    expect(element.style.textColor).toBe('#00ff00');
    if (element.table) expect(element.table.cells[0]!.style.color).toBe('#00ff00');
    expect(imported.diagnostics.filter(item => item.property === 'fontColor')).toEqual([]);
  });

  it('uses the independent default for unresolved theme colors rather than the outline', () => {
    const imported = importDrawio(foreignTable('Themed ink', 'fontColor=default;strokeColor=#ff0000;'));
    expect(imported.document.elements[0]!.table!.cells[0]!.style.color).toBe('#000000');
    expect(imported.diagnostics).toContainEqual(expect.objectContaining({ code: 'STYLE_APPROXIMATED', property: 'fontColor' }));
  });

  it('does not add default ink to an unchanged own model that intentionally uses its outline as text color', () => {
    const source = multipage();
    source.elements[0]!.style.stroke = '#ff0000';
    delete source.elements[0]!.style.textColor;
    const imported = importDrawio(prepareDrawioExport(source).contents, { pageIndex: 'all' });
    expect(imported.fidelity).toBe('own-roundtrip');
    expect(serializeDocument(imported.document)).toBe(serializeDocument(source));
  });

  it('preserves the whole own draw.io document and the explicitly selected SVG page', () => {
    const source = multipage();
    expect(serializeDocument(importDrawio(prepareDrawioExport(source).contents, { pageIndex: 'all' }).document)).toBe(serializeDocument(source));
    expect(serializeDocument(importSvg(prepareSvgExport(source, { pageId: 'page:details' }).contents).document)).toBe(serializeDocument(extractPage(source, 'page:details')));
  });
});

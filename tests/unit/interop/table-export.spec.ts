import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { createDocument, createElement, createTableDocument, serializeDocument } from '../../../src/domain';
import { importDrawio, prepareDrawioExport } from '../../../src/interop';

const legacy = readFileSync('tests/unit/interop/fixtures/table-colors-v1.drawio', 'utf8');
function tableDocument(color = '#242424', fill = '#ffffff') {
  const doc = createDocument('Table colors');
  const table = createTableDocument(1, 2);
  for (const cell of table.cells) { cell.text = 'Table'; cell.style.color = color; cell.style.fill = fill; }
  doc.elements = [createElement('table', { id: 'table', table })];
  return doc;
}
function projectionVersion(xml: string, version: string) {
  return xml.replace(/sketchdrawInterop="([^"]+)"/, (_, encoded: string) => {
    const envelope = JSON.parse(Buffer.from(encoded, 'base64').toString('utf8'));
    envelope.projection = version;
    return `sketchdrawInterop="${Buffer.from(JSON.stringify(envelope)).toString('base64')}"`;
  });
}

describe('draw.io table export colors (#180)', () => {
  it.each([['#242424', '#ffffff'], ['#123456', '#abcdef']])('projects cell ink %s and fill %s independently of the border', (color, fill) => {
    const doc = tableDocument(color, fill);
    const output = prepareDrawioExport(doc, { embedDocument: false });
    expect(output.contents).toContain('strokeColor=#cbd5e1;');
    expect(output.contents).toContain(`fontColor=${color};`);
    expect(output.contents).toContain(`fillColor=${fill};`);
    const imported = importDrawio(output.contents).document.elements[0]!;
    expect(imported.style.stroke).toBe('#cbd5e1');
    for (const cell of imported.table!.cells) expect(cell.style).toMatchObject({ color, fill });
  });

  it('reports mixed cell colors and uses the first visible cell consistently', () => {
    const doc = tableDocument('#123456', '#abcdef');
    doc.elements[0]!.table!.cells[1]!.style.color = '#654321';
    doc.elements[0]!.table!.cells[1]!.style.fill = '#fedcba';
    doc.elements[0]!.table!.cells.reverse();
    const output = prepareDrawioExport(doc);
    expect(output.contents).toContain('fontColor=#123456;');
    expect(output.contents).toContain('fillColor=#abcdef;');
    expect(output.diagnostics).toContainEqual(expect.objectContaining({ code: 'STYLE_APPROXIMATED', property: 'table.colors', severity: 'warning' }));
    expect(output.requiresConfirmation).toBe(true);
    expect(serializeDocument(importDrawio(output.contents).document)).toBe(serializeDocument(doc));
  });

  it('restores a captured legacy v1 export with its original IDs, pages, metadata and cell colors', () => {
    const imported = importDrawio(legacy, { pageIndex: 'all' });
    expect(imported.fidelity).toBe('own-roundtrip');
    expect(imported.document.metadata).toEqual({ regression: 'drawio-v1' });
    expect(imported.document.elements[0]!.id).toBe('legacy-table');
    expect(imported.document.elements[0]!.table!.cells[0]!.style).toMatchObject({ color: '#123456', fill: '#abcdef' });
    expect(importDrawio(legacy, { pageIndex: 1 }).fidelity).toBe('own-roundtrip');
  });

  it('treats uppercase and lowercase hex spellings as the same cell colors', () => {
    const doc = tableDocument('#ABCDEF', '#FEDCBA');
    doc.elements[0]!.table!.cells[1]!.style.color = '#abcdef';
    doc.elements[0]!.table!.cells[1]!.style.fill = '#fedcba';
    const output = prepareDrawioExport(doc);
    expect(output.diagnostics.filter(item => item.property === 'table.colors')).toEqual([]);
    expect(output.contents).toContain('fontColor=#abcdef;');
  });

  it('states that mixed colors are omitted when exporting without metadata', () => {
    const doc = tableDocument();
    doc.elements[0]!.table!.cells[1]!.style.color = '#ff0000';
    const output = prepareDrawioExport(doc, { embedDocument: false });
    const warning = output.diagnostics.find(item => item.property === 'table.colors')!;
    expect(warning.effect).toBe('omitted');
    expect(warning.message).toContain('omitted');
    expect(warning.message).not.toContain('remain in embedded metadata');
    expect(output.requiresConfirmation).toBe(true);
  });

  it.each(['Visible table', 'Later page'])('rejects changed legacy content on any page: %s', value => {
    const imported = importDrawio(legacy.replace(`value="${value}"`, 'value="Changed"'), { pageIndex: 1 });
    expect(imported.fidelity).not.toBe('own-roundtrip');
    expect(imported.diagnostics).toContainEqual(expect.objectContaining({ code: 'EMBEDDED_MODEL_STALE' }));
  });

  it('restores new v2 exports and respects visible edits after metadata becomes stale', () => {
    const doc = tableDocument('#123456', '#abcdef');
    const output = prepareDrawioExport(doc).contents;
    const encoded = /sketchdrawInterop="([^"]+)"/.exec(output)![1]!;
    expect(JSON.parse(Buffer.from(encoded, 'base64').toString('utf8')).projection).toBe('drawio-v2');
    expect(serializeDocument(importDrawio(output).document)).toBe(serializeDocument(doc));
    const edited = importDrawio(output.replace('fontColor=#123456;', 'fontColor=#654321;'));
    expect(edited.diagnostics).toContainEqual(expect.objectContaining({ code: 'EMBEDDED_MODEL_STALE' }));
    for (const cell of edited.document.elements[0]!.table!.cells) expect(cell.style.color).toBe('#654321');
  });

  it('does not validate visible colors against a different projection version or unknown version', () => {
    const v2 = prepareDrawioExport(tableDocument('#123456', '#abcdef')).contents;
    for (const xml of [projectionVersion(legacy, 'drawio-v2'), projectionVersion(v2, 'drawio-v1'), projectionVersion(v2, 'drawio-v999')]) {
      const imported = importDrawio(xml, { pageIndex: 'all' });
      expect(imported.fidelity).not.toBe('own-roundtrip');
      expect(imported.diagnostics).toContainEqual(expect.objectContaining({ code: 'EMBEDDED_MODEL_STALE' }));
    }
  });
});

import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { importDrawio, inspectDrawio } from '../../../src/interop';
import { prepareDrawioExport } from '../../../src/interop';
import { parseXmlDocument, getElementChildren, type XmlElementNode } from '../../../src/interop/xml';
import type { SketchDocument } from '../../../src/domain';

describe('Actual diagrams.net 32.5.4 export, captured 2026-10-17', () => {
  it('imports the final real container export with its fill, bounds and child coordinates', () => {
    const result = importDrawio(readFileSync('tests/fixtures/interop/external/diagrams-net-container-fixed.drawio', 'utf8'));
    expect(result.document.elements).toHaveLength(6);
    expect(result.document.elements.find(e => e.id === 'sd-0')).toMatchObject({ kind: 'container', text: 'Synthetic workspace', x: 40, y: 40, width: 680, height: 320, style: { stroke: '#16243a', fill: '#f7f9fc' } });
    expect(result.document.elements.find(e => e.id === 'sd-1')).toMatchObject({ parentId: 'sd-0', x: 80, y: 115, text: 'Input label only' });
  });
  it('exports a visible native container rectangle with unchanged parent-local child positions', () => {
    const document = JSON.parse(readFileSync('tests/fixtures/interop/external/synthetic.sketchdraw.json', 'utf8')) as SketchDocument;
    const xml = prepareDrawioExport(document, { embedDocument: false }).contents;
    const walk = (node: XmlElementNode): XmlElementNode[] => [node, ...getElementChildren(node).flatMap(walk)];
    const cells = walk(parseXmlDocument(xml)).filter(n => n.local === 'mxCell');
    const container = cells.find(n => n.attributes['id'] === 'sd-0')!;
    expect(container.attributes['style']).toContain('container=1;');
    expect(container.attributes['style']).toContain('verticalAlign=top;');
    expect(container.attributes['style']).not.toContain(';group;');
    expect(container.attributes['style']).toContain('strokeColor=#16243a;fillColor=#f7f9fc;');
    const child = cells.find(n => n.attributes['id'] === 'sd-1')!;
    expect(child.attributes['parent']).toBe('sd-0');
    expect(getElementChildren(child)[0]!.attributes).toMatchObject({ x: '40', y: '75' });
    const imported = importDrawio(xml);
    expect(imported.document.elements.find(e => e.id === 'sd-0')).toMatchObject({ kind: 'container', x: 40, y: 40, width: 680, height: 320 });
    expect(imported.document.elements.find(e => e.id === 'sd-1')).toMatchObject({ parentId: 'sd-0', x: 80, y: 115, width: 170, height: 90 });
  });
  it('imports the edited compressed native file without restoring stale own metadata', () => {
    const xml = readFileSync('tests/fixtures/interop/external/diagrams-net-edited.drawio', 'utf8');
    expect(inspectDrawio(xml)).toMatchObject([{ encoding: 'deflate-base64' }]);
    const result = importDrawio(xml);
    expect(result.document.elements).toHaveLength(6);
    expect(result.document.elements.map(e => e.text)).toEqual(expect.arrayContaining([
      'Synthetic workspace', 'Edited in diagrams.net', 'Output fallback', 'Flow', 'Choice',
      'Independent Chromium + diagrams.net check',
    ]));
    expect(result.document.elements.some(e => e.text === 'Input label only')).toBe(false);
    expect(result.document.elements.map(e => e.kind)).toEqual(expect.arrayContaining(['rectangle', 'ellipse', 'diamond', 'container', 'connector', 'text']));
    const edge = result.document.elements.find(e => e.kind === 'connector')!;
    expect(edge.from).toEqual({ elementId: 'sd-1', anchor: { x: 1, y: .5 } });
    expect(edge.to).toEqual({ elementId: 'sd-2', anchor: { x: 0, y: .5 } });
    expect(result.diagnostics.some(d => d.code === 'EMBEDDED_MODEL_STALE')).toBe(true);
  });
});

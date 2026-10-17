import { describe, it, expect } from 'vitest';
import { createDocument, createElement, validateDocument, serializeDocument } from '../../../src/domain';
import { importDrawio, importSvg, prepareDrawioExport, prepareSvgExport } from '../../../src/interop';
import { parseDiagram, formatDiagram } from '../../../src/codec';

type Family = 'sans' | 'mono' | 'roboto' | 'scribbled';
const families: Family[] = ['sans', 'mono', 'roboto', 'scribbled'];
function docWith(fontFamily: Family) {
  const doc = createDocument('Fonts');
  doc.id = 'fonts';
  doc.elements = [createElement('text', { id: 't', text: 'Hi', style: { ...createElement('text', { id: 'base' }).style, fontFamily } })];
  return validateDocument(doc);
}

describe('fontFamily contract (#43)', () => {
  it('accepts all four values and keeps the sans default', () => {
    for (const f of families) expect(docWith(f).elements[0]!.style.fontFamily).toBe(f);
    expect(createElement('text', { id: 'd' }).style.fontFamily).toBe('sans');
  });

  it('rejects unknown values with a precise message', () => {
    const doc = docWith('sans');
    (doc.elements[0]!.style as { fontFamily: string }).fontFamily = 'comic';
    expect(() => validateDocument(doc)).toThrow(/"sans", "mono", "roboto" or "scribbled"/);
  });

  it('preserves roboto/scribbled through JSON serialization', () => {
    for (const f of ['roboto', 'scribbled'] as const) {
      const round = validateDocument(JSON.parse(serializeDocument(docWith(f))));
      expect(round.elements[0]!.style.fontFamily).toBe(f);
    }
  });

  it('round-trips all values through diagram-as-code', () => {
    for (const f of families) {
      const result = parseDiagram(formatDiagram(docWith(f)));
      if (!result.ok) throw new Error(JSON.stringify(result.diagnostics));
      expect(result.document.elements.find(e => e.id === 't')?.style.fontFamily).toBe(f);
    }
  });

  it('exports CSS font stacks to SVG and draw.io', () => {
    const svg = (f: Family) => prepareSvgExport(docWith(f), { embedDocument: false }).contents;
    const dio = (f: Family) => prepareDrawioExport(docWith(f), { embedDocument: false }).contents;
    expect(svg('roboto')).toContain('font-family="Roboto, sans-serif"');
    expect(svg('scribbled')).toContain('font-family="Caveat, cursive"');
    expect(svg('sans')).toContain('font-family="Inter, sans-serif"');
    expect(dio('roboto')).toContain('fontFamily=Roboto, sans-serif');
    expect(dio('scribbled')).toContain('fontFamily=Caveat, cursive');
    expect(dio('mono')).toContain('fontFamily=monospace');
  });

  it('round-trips exact values via embedded metadata', () => {
    for (const f of families) {
      const svg = importSvg(prepareSvgExport(docWith(f)).contents);
      const dio = importDrawio(prepareDrawioExport(docWith(f)).contents);
      expect(svg.document.elements[0]!.style.fontFamily).toBe(f);
      expect(dio.document.elements[0]!.style.fontFamily).toBe(f);
    }
  });

  it('maps the exported stacks without embedded metadata and keeps foreign fonts conservative', () => {
    for (const [f, fam] of [['roboto', 'Roboto, sans-serif'], ['scribbled', 'Caveat, cursive']] as const) {
      const imported = importSvg(prepareSvgExport(docWith(f), { embedDocument: false }).contents);
      const t = imported.document.elements.find(e => e.kind === 'text')!;
      expect(t.style.fontFamily).toBe(f);
      expect(imported.diagnostics.some(d => d.code === 'FONT_RENDERING_DEPENDENT' && d.message.includes('Foreign'))).toBe(false);
      void fam;
    }
    const foreign = importSvg('<svg xmlns="http://www.w3.org/2000/svg"><text x="0" y="10" font-family="Comic Sans MS">x</text></svg>');
    expect(foreign.document.elements[0]!.style.fontFamily).toBe('sans');
    expect(foreign.diagnostics.map(d => d.code)).toContain('FONT_RENDERING_DEPENDENT');
    const foreignDio = importDrawio('<mxGraphModel><root><mxCell id="0"/><mxCell id="1" parent="0"/><mxCell id="a" value="x" style="text;fontFamily=Comic Sans MS" vertex="1" parent="1"><mxGeometry width="40" height="20" as="geometry"/></mxCell></root></mxGraphModel>');
    expect(foreignDio.document.elements.find(e => e.id.includes('a'))?.style.fontFamily).toBe('sans');
    expect(foreignDio.diagnostics.map(d => d.code)).toContain('FONT_RENDERING_DEPENDENT');
  });
});

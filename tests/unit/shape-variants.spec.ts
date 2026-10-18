import { describe, expect, it } from 'vitest';
import {
  applyCommand, createDocument, createElement, deserializeDocument, effectiveShapeVariant,
  serializeDocument, SHAPE_VARIANTS,
} from '../../src/domain';
import { formatDiagram, parseDiagram } from '../../src/codec';
import { importDrawio, prepareDrawioExport, prepareSvgExport } from '../../src/interop';

describe('shape variants (#39)', () => {
  it('validates and serializes every supported variant while retaining legacy defaults', () => {
    expect(effectiveShapeVariant(createElement('rectangle'))).toBe('square');
    for (const shapeVariant of SHAPE_VARIANTS) {
      const element = createElement(shapeVariant === 'circle' ? 'ellipse' : shapeVariant === 'diamond' ? 'diamond' : 'rectangle', { shapeVariant });
      const document = createDocument(shapeVariant);
      document.elements = [element];
      expect(deserializeDocument(serializeDocument(document)).elements[0]?.shapeVariant).toBe(shapeVariant);
    }
    expect(() => createElement('text', { shapeVariant: 'triangle' })).toThrow();
    expect(() => createElement('rectangle', { shapeVariant: 'unknown' as never })).toThrow();
  });

  it('changes the shape in place and round-trips through Diagram as Code', () => {
    const document = createDocument();
    document.elements = [createElement('rectangle', { id: 'shape:stable' })];
    const changed = applyCommand(document, { type: 'update', changes: [{ id: 'shape:stable', patch: { shapeVariant: 'hexagon' } }] });
    expect(changed.elements[0]).toMatchObject({ id: 'shape:stable', kind: 'rectangle', shapeVariant: 'hexagon' });
    const result = parseDiagram(formatDiagram(changed));
    expect(result.ok && result.document.elements[0]?.shapeVariant).toBe('hexagon');
  });

  it('preserves variants in SVG metadata and editable draw.io native styles', () => {
    const document = createDocument();
    document.elements = [createElement('rectangle', { id: 'shape:doc', shapeVariant: 'document' })];
    expect(prepareSvgExport(document).contents).toContain('data-sketchdraw-shape="document"');
    const drawio = prepareDrawioExport(document, { embedDocument: false }).contents;
    expect(drawio).toContain('sketchdrawShapeVariant=document');
    expect(importDrawio(drawio).document.elements[0]).toMatchObject({ shapeVariant: 'document' });
  });
});

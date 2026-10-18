import { describe, expect, it } from 'vitest';
import { createDocument, createElement, deserializeDocument, DomainValidationError, serializeDocument } from '@/domain';
import { prepareDrawioExport } from '@/interop';

// Corner radius of rounded rectangles: validated, persisted and exported.
function rounded(cornerRadius: number) {
  const base = createElement('rectangle', { shapeVariant: 'rounded', x: 0, y: 0, width: 200, height: 100 });
  return { ...base, style: { ...base.style, cornerRadius } };
}

describe('corner radius', () => {
  it('round-trips through serialization', () => {
    const document = createDocument('Radius'); document.elements = [rounded(24)];
    expect(deserializeDocument(serializeDocument(document)).elements[0]!.style.cornerRadius).toBe(24);
  });

  it('rejects negative and non-finite radii', () => {
    for (const bad of [-1, Number.NaN, Number.POSITIVE_INFINITY]) {
      const document = createDocument('Radius'); document.elements = [rounded(bad)];
      expect(() => serializeDocument(document)).toThrow(DomainValidationError);
    }
  });

  it('exports the radius as a draw.io arcSize percentage of the shorter side', () => {
    const document = createDocument('Radius'); document.elements = [rounded(25)];
    expect(JSON.stringify(prepareDrawioExport(document))).toContain('arcSize=25');
  });
});

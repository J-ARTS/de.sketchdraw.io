import { describe, expect, test } from 'vitest';
import { createDocument, createElement } from '@/domain';
import { importDrawio, prepareDrawioExport, prepareSvgExport } from '@/interop';

function connectorDocument() {
  const document = createDocument('Connector export');
  document.elements = [
    createElement('rectangle', { id: 'source', x: 0, y: 0, width: 120, height: 80 }),
    createElement('rectangle', { id: 'target', x: 360, y: 120, width: 120, height: 80 }),
    createElement('connector', {
      id: 'edge', x: 120, y: 40, width: 240, height: 120,
      points: [{ x: 0, y: 0 }, { x: 240, y: 120 }],
      from: { elementId: 'source', anchor: { x: 1, y: .5 } },
      to: { elementId: 'target', anchor: { x: 0, y: .5 } },
      connectorRouting: 'curved', startMarker: 'circle', endMarker: 'diamond', text: 'HTTPS',
    }),
  ];
  return document;
}

describe('connector interoperability', () => {
  test('native SVG contains the routed path, endpoint markers and centered label', () => {
    const result = prepareSvgExport(connectorDocument(), { embedDocument: false });
    expect(result.contents).toContain('<path d="M 0 0 C');
    expect(result.contents).toContain('marker-start="url(#sd-2-start)"');
    expect(result.contents).toContain('marker-end="url(#sd-2-end)"');
    expect(result.contents).toContain('dominant-baseline="middle"');
    expect(result.contents).toContain('>HTTPS</tspan>');
  });

  test('draw.io projection round-trips supported routing and endpoint styles without an embedded model', () => {
    const result = prepareDrawioExport(connectorDocument(), { embedDocument: false });
    expect(result.contents).toContain('startArrow=oval');
    expect(result.contents).toContain('endArrow=diamond');
    expect(result.contents).toContain('curved=1');
    const imported = importDrawio(result.contents);
    expect(imported.document.elements.find((element) => element.kind === 'connector')).toMatchObject({
      connectorRouting: 'curved', startMarker: 'circle', endMarker: 'diamond',
    });
  });
});

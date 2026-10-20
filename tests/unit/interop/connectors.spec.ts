import { describe, expect, test } from 'vitest';
import { createDocument, createElement, type ConnectorMarker } from '@/domain';
import { importDrawio, prepareDrawioExport, prepareSvgExport } from '@/interop';

function connectorDocument(startMarker: ConnectorMarker = 'circle', endMarker: ConnectorMarker = 'diamond') {
  const document = createDocument('Connector export');
  document.elements = [
    createElement('rectangle', { id: 'source', x: 0, y: 0, width: 120, height: 80 }),
    createElement('rectangle', { id: 'target', x: 360, y: 120, width: 120, height: 80 }),
    createElement('connector', {
      id: 'edge', x: 120, y: 40, width: 240, height: 120,
      points: [{ x: 0, y: 0 }, { x: 240, y: 120 }],
      from: { elementId: 'source', anchor: { x: 1, y: .5 } },
      to: { elementId: 'target', anchor: { x: 0, y: .5 } },
      connectorRouting: 'curved', startMarker, endMarker, text: 'HTTPS',
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

  test('draw.io projection round-trips entity relationship endpoint styles', () => {
    const result = prepareDrawioExport(connectorDocument('zero-or-one', 'one-or-many'), { embedDocument: false });
    expect(result.contents).toContain('startArrow=ERzeroToOne');
    expect(result.contents).toContain('endArrow=ERoneToMany');
    const imported = importDrawio(result.contents);
    expect(imported.document.elements.find((element) => element.kind === 'connector')).toMatchObject({
      startMarker: 'zero-or-one', endMarker: 'one-or-many',
    });
  });

  test('an animated dashed line keeps its flow animation through draw.io and falls back to dashes in SVG', () => {
    const document = connectorDocument();
    document.elements = document.elements.map((element) => element.kind === 'connector' ? { ...element, style: { ...element.style, strokeDash: 'animated' as const } } : element);
    const drawio = prepareDrawioExport(document, { embedDocument: false });
    expect(drawio.contents).toContain('dashed=1');
    expect(drawio.contents).toContain('flowAnimation=1');
    expect(importDrawio(drawio.contents).document.elements.find((element) => element.kind === 'connector')?.style.strokeDash).toBe('animated');
    expect(prepareSvgExport(document, { embedDocument: false }).contents).toContain('stroke-dasharray="8 6"');
  });

  test('filled circle and triangle markers stay distinct in SVG and draw.io projections', () => {
    const document = connectorDocument('solid-circle', 'solid-triangle');
    const svg = prepareSvgExport(document, { embedDocument: false });
    expect(svg.contents).toMatch(/<circle[^>]+fill="#1e293b"/);
    expect(svg.contents).toMatch(/<path d="M1 1L12 7L1 13Z" fill="#1e293b"/);

    const drawio = prepareDrawioExport(document, { embedDocument: false });
    expect(drawio.contents).toContain('startArrow=oval');
    expect(drawio.contents).toContain('startFill=1');
    expect(drawio.contents).toContain('endArrow=block');
    expect(drawio.contents).toContain('endFill=1');
    expect(importDrawio(drawio.contents).document.elements.find((element) => element.kind === 'connector')).toMatchObject({
      startMarker: 'solid-circle', endMarker: 'solid-triangle',
    });
  });
});

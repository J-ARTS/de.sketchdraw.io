import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { deflateSync, strToU8 } from 'fflate';
import { createDocument, createElement, serializeDocument, validateDocument } from '../../../src/domain';
import { resolveAnchorWorldPoint } from '../../../src/domain/geometry';
import { importDrawio, inspectDrawio, importSvg, prepareDrawioExport, prepareSvgExport, exportSvg, exportDrawio, InteropError } from '../../../src/interop';
import { encodeBytesToBase64, inflateRawDeflateBounded } from '../../../src/interop/compression';
import { flattenPath, parseTransform, transformPoint } from '../../../src/interop/geometry';
import { parseXmlDocument, getElementChildren, getElementTextContent, type XmlElementNode } from '../../../src/interop/xml';
import { DiagnosticCollector } from '../../../src/interop/diagnostics';
const fixture = (name: string) => readFileSync(resolve('tests/fixtures/interop', name), 'utf8');
const png = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLbtAAAAABJRU5ErkJggg==';
function allKinds() {
  const doc = createDocument('All Ω\u0001');
  doc.id = 'all';
  doc.componentSets = [{ id: 'generic', name: 'Generic', version: '1', components: [{ type: 'generic.component', name: 'Component', provider: 'generic', category: 'Basic', defaultWidth: 100, defaultHeight: 80, style: {}, widgets: [{ key: 'region', label: 'Region', kind: 'text' }] }] }];
  doc.metadata = { owner: 'human', note: 'inert <script>' };
  doc.assets = { img: { id: 'img', mimeType: 'image/png', dataUrl: png, name: 'pixel' }, unused: { id: 'unused', mimeType: 'image/png', dataUrl: png, name: 'unused' } };
  doc.elements = [createElement('container', { id: 'group', x: -50, y: -30, width: 500, height: 400 }), ...(['rectangle', 'ellipse', 'diamond', 'text', 'path', 'image', 'connector', 'component', 'sticky-note'] as const).map((kind, i) => createElement(kind, { id: kind, x: i * 130, y: 40, width: kind === 'sticky-note' ? 240 : 100, height: kind === 'sticky-note' ? 240 : 80, text: kind === 'text' ? 'Line 1\nΩ & <\ud800' : kind, label: `${kind} label`, description: 'Description', metadata: { key: 'value' }, ...(kind === 'sticky-note' ? { author: 'Jeremy Teichmann', style: { ...createElement('sticky-note').style, fill: '#aeeebd', fontWeight: 'bold' as const } } : {}), ...(kind === 'image' ? { assetId: 'img' } : {}), ...(kind === 'rectangle' ? { parentId: 'group', rotation: 30 } : {}), ...(kind === 'connector' ? { from: { elementId: 'rectangle', anchor: { x: 1, y: .5 } }, to: { elementId: 'ellipse', anchor: { x: 0, y: .5 } } } : {}), ...(kind === 'path' ? { points: [{ x: 0, y: 0 }, { x: 50, y: 60 }, { x: 100, y: 0 }] } : {}) }))];
  return validateDocument(doc);
}
const codes = (result: {
  diagnostics: readonly {
    code: string;
  }[];
}) => result.diagnostics.map(d => d.code);
function errorCode(action: () => unknown, code: string) { try {
  action();
  throw new Error('Expected failure');
}
catch (error) {
  expect(error).toBeInstanceOf(InteropError);
  expect((error as InteropError).code).toBe(code);
} }
describe('native draw.io', () => {
  it('imports independent XML coordinates, ports, explicit rotated anchors and source stacking', () => { const result = importDrawio(fixture('native.drawio')); const byId = new Map(result.document.elements.map(e => [e.id, e])); expect(byId.get('box')).toMatchObject({ kind: 'rectangle', x: 120, y: 80, rotation: 30, parentId: 'group', text: 'API & Daten' }); expect(byId.get('port')).toMatchObject({ kind: 'ellipse', x: 495, y: 165, parentId: 'group' }); const edge = byId.get('edge')!; expect(edge.from).toEqual({ elementId: 'box', anchor: { x: 1, y: .5 } }); const first = resolveAnchorWorldPoint(byId.get('box')!, { x: 1, y: .5 }); expect(edge.x + edge.points![0]!.x).toBeCloseTo(first.x); expect(edge.y + edge.points![0]!.y).toBeCloseTo(first.y); expect(result.document.elements.map(e => e.id)).toEqual(['group', 'box', 'port', 'target', 'edge']); expect(codes(result)).toContain('RELATIVE_LAYOUT_FLATTENED'); });
  it('imports equivalent raw-DEFLATE page and inspects without decompressing unselected pages', () => { const xml = fixture('native.drawio'); const model = xml.slice(xml.indexOf('<mxGraphModel>'), xml.indexOf('</mxGraphModel>') + 15); const compressed = encodeBytesToBase64(deflateSync(strToU8(encodeURIComponent(model)))); const file = `<mxfile><diagram id="a" name="Plan Ü">${compressed}</diagram><diagram id="a" name="Broken">not compressed!</diagram></mxfile>`; expect(inspectDrawio(file)).toHaveLength(2); errorCode(() => importDrawio(file), 'PAGE_SELECTION_REQUIRED'); const result = importDrawio(file, { pageIndex: 0, documentId: 'fixed' }); expect(result.document.elements.map(e => [e.id, e.x, e.y])).toEqual(importDrawio(xml).document.elements.map(e => [e.id, e.x, e.y])); expect(codes(result)).toContain('DUPLICATE_PAGE_ID'); errorCode(() => importDrawio(file, { pageIndex: 2 }), 'PAGE_NOT_FOUND'); });
  it('rejects duplicate IDs, cycles and broken compression', () => { errorCode(() => importDrawio(fixture('native.drawio').replace('id="target"', 'id="box"')), 'DUPLICATE_SOURCE_ID'); errorCode(() => importDrawio(fixture('native.drawio').replace('id="group" value="Container"', 'id="group" value="Container"').replace('vertex="1" parent="1"><mxGeometry x="100"', 'vertex="1" parent="box"><mxGeometry x="100"')), 'INVALID_REFERENCE'); errorCode(() => importDrawio('<mxfile><diagram>!!!!</diagram></mxfile>'), 'INVALID_COMPRESSION'); });
  it('converts HTML and unknown/external shapes visibly, never fetches', () => { const xml = '<mxGraphModel><root><mxCell id="0"/><mxCell id="1" parent="0"/><mxCell id="unknown" parent="1" vertex="1" value="&lt;b&gt;Hello&lt;/b&gt;&lt;br&gt;World" style="shape=aws.magic;html=1;shadow=1;"><mxGeometry width="80" height="40" as="geometry"/></mxCell><mxCell id="image" parent="1" vertex="1" style="shape=image;image=https://private.example/a.png;"><mxGeometry x="100" width="20" height="20" as="geometry"/></mxCell></root></mxGraphModel>'; const result = importDrawio(xml); expect(result.document.elements[0]!.text).toBe('Hello\nWorld'); expect(result.document.elements[1]!.kind).toBe('rectangle'); expect(codes(result)).toEqual(expect.arrayContaining(['UNSUPPORTED_SHAPE', 'TEXT_FORMATTING_LOST', 'EXTERNAL_RESOURCE_BLOCKED'])); expect(result.requiresConfirmation).toBe(true); });
});
describe('native SVG', () => {
  it('imports independent primitives, transform order, local reuse and all curve commands', () => { const result = importSvg(fixture('native.svg')); const rectangle = result.document.elements.find(e => e.id === 'rectangle')!; expect(rectangle).toMatchObject({ kind: 'rectangle', x: 20, y: 40, width: 80, height: 40 }); expect(result.document.elements.filter(e => e.id.includes('symbol'))).toHaveLength(2); expect(result.document.elements.find(e => e.id === 'curves')!.points!.length).toBeGreaterThan(20); expect(codes(result)).toContain('CURVE_FLATTENED'); expect(new Set(result.document.elements.map(e => e.id)).size).toBe(result.document.elements.length); });
  it('handles images, nonzero viewBox origin, nested viewport and reflected vectors', () => { const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="100 200 400 300"><image id="image" x="110" y="220" width="20" height="30" href="${png}" preserveAspectRatio="none"/><svg x="100" y="20" width="200" height="100" viewBox="10 20 20 10"><rect id="nested" x="10" y="20" width="20" height="10"/></svg><rect id="mirror" x="-50" width="20" height="10" transform="scale(-1 1)"/></svg>`; const result = importSvg(svg); expect(result.document.elements.find(e => e.id === 'image')).toMatchObject({ kind: 'image', x: 110, y: 220 }); expect(result.document.elements.find(e => e.id === 'nested')).toMatchObject({ x: 100, y: 20, width: 200, height: 100 }); expect(result.document.elements.find(e => e.id === 'mirror')!.kind).toBe('path'); expect(Object.keys(result.document.assets)).toHaveLength(1); });
  it('rejects local cycles and records active/remote/style omissions', () => { errorCode(() => importSvg('<svg xmlns="http://www.w3.org/2000/svg"><defs><g id="cycle"><use href="#cycle"/></g></defs><use href="#cycle"/></svg>'), 'INVALID_REFERENCE'); const result = importSvg('<svg xmlns="http://www.w3.org/2000/svg"><script>throw 1</script><rect id="r" width="30" height="20" onclick="bad()" fill="url(http://bad)" filter="url(#filter)"/><image width="20" height="20" href="file:///secret"/><foreignObject width="20" height="20"><div xmlns="http://www.w3.org/1999/xhtml">Hello</div></foreignObject></svg>'); expect(codes(result)).toEqual(expect.arrayContaining(['ACTIVE_CONTENT_OMITTED', 'STYLE_APPROXIMATED', 'EXTERNAL_RESOURCE_BLOCKED'])); expect(result.document.elements.length).toBe(3); });
  it('bounds adaptive cubic error independently and implements relative smooth/arcs', () => { const flat = flattenPath('M0 0 C0 100 100 100 100 0'); const points = flat.subpaths[0]!; for (let i = 0; i <= 1000; i++) {
    const t = i / 1000;
    const p = { x: 300 * t * t - 200 * t * t * t, y: 300 * t - 300 * t * t };
    const distance = Math.min(...points.slice(1).map((b, j) => { const a = points[j]!, dx = b.x - a.x, dy = b.y - a.y; const u = Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / (dx * dx + dy * dy))); return Math.hypot(p.x - a.x - u * dx, p.y - a.y - u * dy); }));
    expect(distance).toBeLessThanOrEqual(.25);
  } expect(flattenPath('M0 0 h10 v10 l-10 0 z m30 0 q10 20 20 0 t20 0 a10 10 0 01 20 0').subpaths).toHaveLength(2); expect(transformPoint(parseTransform('translate(10 20) scale(2)'), { x: 3, y: 4 })).toEqual({ x: 16, y: 28 }); });
});
describe('native projection and validated own metadata', () => {
  it('exports visible label fallback as native text, including empty text and component labels', () => {
    const doc = allKinds();
    doc.elements = [
      createElement('rectangle', { id: 'label', label: 'Label only' }),
      createElement('rectangle', { id: 'empty', x: 200, text: '', label: 'Empty text fallback' }),
      createElement('component', { id: 'component', x: 400, componentType: 'generic.component', label: 'Readable component' }),
      createElement('text', { id: 'preferred', x: 600, text: 'Preferred text', label: 'Alternative label', style: { ...createElement('text').style, opacity: 0, stroke: '#ff0000' } }),
    ];
    const walk = (node: XmlElementNode): XmlElementNode[] => [node, ...getElementChildren(node).flatMap(walk)];
    const nodes = walk(parseXmlDocument(prepareSvgExport(doc, { embedDocument: false }).contents));
    const visibleTexts = nodes.filter(n => n.local === 'text');
    const expected = ['Label only', 'Empty text fallback', 'Readable component', 'Preferred text'];
    expect(visibleTexts.map(getElementTextContent)).toEqual(expected);
    expect(visibleTexts.at(-1)!.attributes['opacity']).toBe('0');
    expect(visibleTexts.at(-1)!.attributes['fill']).toBe('#ff0000');
    const drawio = prepareDrawioExport(doc, { embedDocument: false }).contents;
    const cells = walk(parseXmlDocument(drawio)).filter(n => n.local === 'mxCell' && n.attributes['vertex'] === '1');
    expect(cells.map(n => n.attributes['value'])).toEqual(expected);
    expect(importDrawio(drawio).document.elements.at(-1)!.style.stroke).toBe('#ff0000');
  });
  for (const format of ['svg', 'drawio'] as const) {
    const prepare = format === 'svg' ? prepareSvgExport : prepareDrawioExport, convert = format === 'svg' ? importSvg : importDrawio;
    it(`${format}: all ten kinds roundtrip exactly, with actual native objects`, () => { const doc = allKinds(), before = serializeDocument(doc); const result = prepare(doc); expect(result.contents).toContain(format === 'svg' ? '<polyline' : 'edge="1"'); expect(result.contents).toContain(format === 'svg' ? '<image' : 'shape=image'); expect(result.contents).toContain(format === 'svg' ? '<text' : 'mxGeometry'); const imported = convert(result.contents); expect(imported.fidelity).toBe('own-roundtrip'); expect(serializeDocument(imported.document)).toBe(before); expect(serializeDocument(doc)).toBe(before); const native = convert(prepare(doc, { embedDocument: false }).contents); expect(native.fidelity).not.toBe('own-roundtrip'); expect(native.document.elements.length).toBeGreaterThanOrEqual(10); expect(native.document.elements.some(e => e.kind === 'image')).toBe(true); });
    it(`${format}: stale visible geometry and added native objects cannot be overwritten by metadata`, () => { const doc = createDocument('Simple'); doc.id = 'simple'; doc.elements = [createElement('rectangle', { id: 'r', x: 10, y: 20, width: 100, height: 80 })]; const xml = prepare(doc).contents; const changed = xml.replace('width="100"', 'width="150"'); const imported = convert(changed); expect(codes(imported)).toContain('EMBEDDED_MODEL_STALE'); expect(imported.document.elements.some(e => e.width === 150)).toBe(true); const added = format === 'svg' ? xml.replace('</svg>', '<rect width="33" height="22"/></svg>') : xml.replace('</root>', '<mxCell id="new" vertex="1" parent="1"><mxGeometry width="33" height="22" as="geometry"/></mxCell></root>'); expect(codes(convert(added))).toContain('EMBEDDED_MODEL_STALE'); expect(convert(added).document.elements.some(e => e.width === 33)).toBe(true); });
  }
  it('requires confirmation in legacy string wrappers and validates export input', () => { const doc = allKinds(); errorCode(() => exportSvg(doc), 'LOSS_CONFIRMATION_REQUIRED'); errorCode(() => exportDrawio(doc), 'LOSS_CONFIRMATION_REQUIRED'); expect(() => prepareSvgExport({ ...doc, id: 'bad id' })).toThrow(); });
  it('malformed/duplicated metadata falls back with diagnostics', () => { const doc = createDocument('Simple'); doc.elements = [createElement('rectangle', { id: 'r' })]; const svg = prepareSvgExport(doc).contents; const broken = svg.replace(/<sd:document[^>]*>[^<]+/, '<sd:document xmlns:sd="https://sketchdraw.io/ns/interop/1">!!!!'); expect(codes(importSvg(broken))).toContain('EMBEDDED_MODEL_INVALID'); const envelope = svg.match(/<sd:document.*?<\/sd:document>/)![0]; expect(codes(importSvg(svg.replace('</metadata>', envelope + '</metadata>')))).toContain('EMBEDDED_MODEL_INVALID'); });
});
describe('resource limits and XML safety', () => {
  it('rejects DTD, entities, PI, duplicate attrs, deep XML and wrong namespaces', () => { for (const xml of ['<!DOCTYPE svg [<!ENTITY x "hi">]><svg/>', '<?xml-stylesheet href="https://bad"?><svg/>'])
    errorCode(() => parseXmlDocument(xml), 'XML_FORBIDDEN_CONSTRUCT'); errorCode(() => parseXmlDocument('<svg x="1" x="2"/>'), 'XML_SYNTAX'); errorCode(() => parseXmlDocument('<a>'.repeat(65) + '</a>'.repeat(65)), 'LIMIT_EXCEEDED'); errorCode(() => importSvg('<svg xmlns="https://evil"/>'), 'UNSUPPORTED_FORMAT'); });
  it('bounded inflater rejects an expansion bomb and truncated streams', () => { const compressed = deflateSync(strToU8('A'.repeat(2 * 1024 * 1024))); errorCode(() => inflateRawDeflateBounded(compressed, 1024), 'LIMIT_EXCEEDED'); errorCode(() => inflateRawDeflateBounded(compressed.subarray(0, compressed.length - 5)), 'INVALID_COMPRESSION'); });
  it('caps diagnostic retention before finalization and rejects path budget excess', () => { const d = new DiagnosticCollector(); for (let i = 0; i < 10000; i++)
    d.add({ code: `D${i}`, message: 'test', severity: 'warning', effect: 'omitted' }); expect(d.finalize()).toHaveLength(201); expect(d.finalize().at(-1)!.code).toBe('DIAGNOSTICS_TRUNCATED'); errorCode(() => flattenPath('M0 0 ' + 'L1 1 '.repeat(10001)), 'PATH_COMPLEXITY_LIMIT'); });
});
describe('additional safety and interoperability regressions', () => {
  it('shares XML node budget across outer XML and decompressed page parses', () => {
    const nodeBudget = { used: 0 };
    parseXmlDocument('<mxfile><diagram>compressed</diagram></mxfile>', { nodeBudget, maxNodes: 4 });
    expect(nodeBudget.used).toBe(3);
    errorCode(() => parseXmlDocument('<mxGraphModel><root/></mxGraphModel>', { nodeBudget, maxNodes: 4 }), 'LIMIT_EXCEEDED');
  });
  it('unknown projection versions fall back to native content as stale', () => {
    const doc = createDocument(); doc.elements = [createElement('rectangle', { id: 'r', label: 'Native' })];
    for (const format of ['svg', 'drawio'] as const) {
      const prepare = format === 'svg' ? prepareSvgExport : prepareDrawioExport;
      const convert = format === 'svg' ? importSvg : importDrawio;
      const xml = prepare(doc).contents;
      const envelope = format === 'svg' ? xml.match(/<sd:document[^>]*>([^<]+)/)![1]! : xml.match(/sketchdrawInterop="([^"]+)/)![1]!;
      const value = JSON.parse(Buffer.from(envelope, 'base64').toString('utf8')); value.projection = `${format}-v999`;
      const changed = xml.replace(envelope, Buffer.from(JSON.stringify(value)).toString('base64'));
      expect(codes(convert(changed))).toContain('EMBEDDED_MODEL_STALE');
      expect(convert(changed).document.elements.some(e => e.text === 'Native')).toBe(true);
    }
  });
  it('draw.io shared image definitions resolve repeatedly and cycles are rejected', () => { const image = png.replace(';base64,', ','); const xml = `<mxGraphModel><defs><def data="${image}"/></defs><root><mxCell id="0"/><mxCell id="1" parent="0"/>${['a', 'b'].map((id, i) => `<mxCell id="${id}" parent="1" vertex="1" style="shape=image;image=def(0);"><mxGeometry x="${i * 30}" width="20" height="20" as="geometry"/></mxCell>`).join('')}</root></mxGraphModel>`; const result = importDrawio(xml); expect(result.document.elements.map(e => e.kind)).toEqual(['image', 'image']); expect(Object.keys(result.document.assets)).toHaveLength(1); errorCode(() => importDrawio(xml.replace(image, 'def(0)')), 'INVALID_REFERENCE'); });
  it('draw.io missing terminals use explicit free endpoints or visible placeholders, and empty text stays empty', () => { const xml = '<mxGraphModel><root><mxCell id="0"/><mxCell id="1" parent="0"/><mxCell id="a" edge="1" parent="1" source="missing"><mxGeometry as="geometry"><mxPoint as="sourcePoint" x="30" y="40"/><mxPoint as="targetPoint" x="80" y="90"/></mxGeometry></mxCell><mxCell id="b" edge="1" parent="1"/><mxCell id="t" vertex="1" parent="1" value="" style="text;"><mxGeometry width="80" height="40"/></mxCell></root></mxGraphModel>'; const result = importDrawio(xml); expect(result.document.elements.find(e => e.id === 'a')).toMatchObject({ kind: 'connector', x: 30, y: 40 }); expect(result.document.elements.some(e => e.kind === 'rectangle' && e.text === 'Unresolved edge')).toBe(true); expect(result.document.elements.find(e => e.id === 't')!.text).toBe(''); expect(codes(result)).toEqual(expect.arrayContaining(['INVALID_REFERENCE', 'EDGE_ENDPOINT_UNRESOLVED'])); });
  it('hidden SVG visibility may be overridden but ancestor display none cannot be overridden', () => { const result = importSvg('<svg xmlns="http://www.w3.org/2000/svg"><g visibility="hidden"><rect id="hidden" width="20" height="10"/><rect id="visible" visibility="visible" width="20" height="10"/></g><g display="none"><rect id="display" display="inline" width="20" height="10"/></g></svg>'); const values = Object.fromEntries(result.document.elements.map(e => [e.id, e.style.opacity])); expect(values['hidden']).toBe(0); expect(values['visible']).toBe(1); expect(values['display']).toBe(0); });
  it('SVG text uses fill as editable text ink and px geometry; path stroke scales with geometry', () => { const result = importSvg('<svg xmlns="http://www.w3.org/2000/svg"><text id="t" x="10px" y="20px" fill="red">Visible</text><path id="p" d="M0 0 L10 0" transform="scale(2)" stroke="blue" stroke-width="3"/></svg>'); expect(result.document.elements.find(e => e.id === 't')!.style.stroke).toBe('#ff0000'); expect(result.document.elements.find(e => e.id === 'p')!.style.strokeWidth).toBe(6); });
  it('shared blocked use resources and singular transforms remain valid labelled previews', () => { const result = importSvg('<svg xmlns="http://www.w3.org/2000/svg"><defs><image id="img" width="20" height="20" href="https://bad"/></defs><use href="#img"/><use href="#img" x="30"/><rect id="collapsed" width="20" height="20" transform="scale(0)"/></svg>'); expect(new Set(result.document.elements.map(e => e.id)).size).toBe(result.document.elements.length); expect(result.document.elements.every(e => e.kind === 'rectangle')).toBe(true); expect(codes(result)).toContain('TRANSFORM_APPROXIMATED'); });
  it('metadata equality includes root bounds, transforms, whitespace-sensitive text and additional metadata', () => {
    const doc = createDocument('Title');
    doc.elements = [createElement('text', { id: 't', text: ' spaced ', x: 10, y: 20 })];
    const svg = prepareSvgExport(doc).contents;
    for (const changed of [svg.replace('viewBox="', 'viewBox="1 '), svg.replace('translate(10 20)', 'translate(11 20)'), svg.replace(' spaced ', 'spaced'), svg.replace('</metadata>', '<extra xmlns="urn:foreign">data</extra></metadata>')]) {
      if (changed.includes('viewBox="1 '))
        errorCode(() => importSvg(changed), 'INVALID_GEOMETRY');
      else
        expect(codes(importSvg(changed))).toContain('EMBEDDED_MODEL_STALE');
    }
    const spaced = svg.replace('><', '>\n  <').replace('xmlns:sd=', 'xmlns:q=').replaceAll('sd:document', 'q:document');
    expect(importSvg(spaced).fidelity).toBe('own-roundtrip');
  });
  it('native draw.io cell attributes outside the root envelope are part of the stale check', () => { const doc = createDocument(); doc.elements = [createElement('rectangle', { id: 'r' })]; const xml = prepareDrawioExport(doc).contents.replace('id="sd-0"', 'id="sd-0" sketchdrawInterop="extra"'); expect(codes(importDrawio(xml))).toContain('EMBEDDED_MODEL_STALE'); });
  it('rejects attributes/text/comments beyond parser budgets and bad finite domain candidates structurally', () => { errorCode(() => parseXmlDocument('<r a="1" b="2"/>', { maxAttributesPerNode: 1 }), 'LIMIT_EXCEEDED'); errorCode(() => parseXmlDocument('<r>a<c/>b</r>', { maxNodes: 3 }), 'LIMIT_EXCEEDED'); errorCode(() => parseXmlDocument('<r><!--x--><!--y--></r>', { maxNodes: 2 }), 'LIMIT_EXCEEDED'); errorCode(() => importSvg('<svg xmlns="http://www.w3.org/2000/svg"><rect width="20" height="20" opacity="2"/></svg>'), 'INVALID_GEOMETRY'); expect(() => importSvg('<svg xmlns="http://www.w3.org/2000/svg"><rect width="1000001" height="20"/></svg>')).toThrow(InteropError); });
  it('bounded decompression rejects appended bytes and path point totals before generation', () => { const compressed = deflateSync(strToU8('hello')); const extra = new Uint8Array(compressed.length + 1); extra.set(compressed); errorCode(() => inflateRawDeflateBounded(extra), 'INVALID_COMPRESSION'); errorCode(() => flattenPath('M0 0 L1 1 L2 2', undefined, 2), 'PATH_COMPLEXITY_LIMIT'); });
  it('elliptical arc chords meet the independent tolerance bound under a transform', () => { const points = flattenPath('M10 0 A10 10 0 0 1 0 10', parseTransform('scale(2)')).subpaths[0]!; expect(points.at(-1)!.x).toBeCloseTo(0); expect(points.at(-1)!.y).toBeCloseTo(20); for (let i = 1; i < points.length; i++) {
    const a = points[i - 1]!, b = points[i]!;
    expect(20 - Math.hypot((a.x + b.x) / 2, (a.y + b.y) / 2)).toBeLessThanOrEqual(.25);
  } });
});

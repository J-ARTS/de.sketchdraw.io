import { serializeDocument, validateDocument } from '../domain';
import type { Point, SketchDocument, SketchElement } from '../domain';
import { resolveAnchorWorldPoint, syncConnectorEndpoints } from '../domain/geometry';
import { resolveCatalogIcon, type SafeSvgElementNode } from '../catalog/icon';
import { builtInComponentSets } from '../catalog';
import { DiagnosticCollector, XmlOutputBuilder, escapeXmlAttr, escapeXmlText, hasWarningDiagnostics, sanitizeXml10Text } from './diagnostics';
import { SVG_NS, OWN_NS, color, encodeEnvelope } from './common';
import { parseXmlDocument } from './xml';
import { InteropError, type InteropExportOptions, type InteropExportResult, type InteropFormat } from './types';
const n = (v: number): string => String(Object.is(v, -0) ? 0 : v);
export function worldPoint(el: SketchElement, point: Point): Point {
  return resolveAnchorWorldPoint({ ...el, width: 2, height: 2, x: el.x + el.width / 2 - 1, y: el.y + el.height / 2 - 1 }, { x: (point.x - el.width / 2) / 2 + 0.5, y: (point.y - el.height / 2) / 2 + 0.5 });
}
function diagnostic(d: DiagnosticCollector, el: SketchElement | undefined, code: string, message: string, warning = true) {
  d.add({ code, elementId: el?.id, property: 'projection', severity: warning ? 'warning' : 'info', effect: warning ? 'approximated' : 'preserved-as-data', message });
}
function safeColor(v: string, d: DiagnosticCollector, el: SketchElement): string {
  return color(v, '#000000', () => diagnostic(d, el, 'STYLE_APPROXIMATED', 'Unsafe or unsupported color replaced with black.'));
}
function xmlText(value: string, d: DiagnosticCollector, el?: SketchElement): string {
  return sanitizeXml10Text(value, d, { elementId: el?.id });
}
function attrs(values: Record<string, string | number | undefined>): string {
  return Object.entries(values).filter(([, v]) => v !== undefined).map(([k, v]) => ` ${k}="${escapeXmlAttr(String(v))}"`).join('');
}
function svgPaint(el: SketchElement, d: DiagnosticCollector): string {
  return attrs({ stroke: safeColor(el.style.stroke, d, el), fill: safeColor(el.style.fill, d, el), 'stroke-width': el.style.strokeWidth, opacity: el.style.opacity,
    ...(el.style.strokeDash === 'solid' ? {} : { 'stroke-dasharray': el.style.strokeDash === 'dashed' ? '8 6' : '2 4' }) });
}
function nativeText(el: SketchElement, d: DiagnosticCollector): string {
  const visibleText = el.text || el.label || '';
  if (visibleText === '')
    return '';
  diagnostic(d, el, 'FONT_RENDERING_DEPENDENT', 'Editable text depends on fonts available in the receiving application.');
  const font = el.style.fontSize, align = el.style.textAlign;
  const x = align === 'center' ? el.width / 2 : align === 'right' ? el.width : 0;
  const text = xmlText(visibleText, d, el);
  return `<text${attrs({ x, y: font, 'font-size': font, 'font-family': el.style.fontFamily === 'mono' ? 'JetBrains Mono, monospace' : 'Inter, sans-serif', 'text-anchor': align === 'center' ? 'middle' : align === 'right' ? 'end' : 'start', fill: safeColor(el.style.stroke, d, el), opacity: el.style.opacity, stroke: 'none', 'xml:space': 'preserve' })}>${text.split('\n').map((line, i) => `<tspan${attrs({ x, y: font + i * font * 1.2 })}>${escapeXmlText(line)}</tspan>`).join('')}</text>`;
}
function safeIcon(node: SafeSvgElementNode): string {
  return `<${node.tag}${attrs(node.attributes)}>${node.children.map(safeIcon).join('')}</${node.tag}>`;
}
function nativeSvg(document: SketchDocument, d: DiagnosticCollector, embed: boolean): string {
  const out = new XmlOutputBuilder();
  const map = new Map(document.elements.map(el => [el.id, el]));
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const raw of document.elements) {
    const el = syncConnectorEndpoints(raw, map);
    const points = el.points ?? [{ x: 0, y: 0 }, { x: el.width, y: 0 }, { x: el.width, y: el.height }, { x: 0, y: el.height }];
    for (const local of points) {
      const p = worldPoint(el, local);
      const pad = el.style.strokeWidth / 2 + 16;
      minX = Math.min(minX, p.x - pad);
      minY = Math.min(minY, p.y - pad);
      maxX = Math.max(maxX, p.x + pad);
      maxY = Math.max(maxY, p.y + pad);
    }
  }
  const bounds = document.elements.length ? [minX, minY, maxX - minX, maxY - minY] : [0, 0, 1, 1];
  out.append(`<svg xmlns="${SVG_NS}" viewBox="${bounds.map(n).join(' ')}"><title>${escapeXmlText(xmlText(document.title, d))}</title>`);
  if (embed)
    out.append(`<metadata><sd:document xmlns:sd="${OWN_NS}">${encodeEnvelope(document, 'svg')}</sd:document></metadata>`);
  for (let index = 0; index < document.elements.length; index++) {
    const el = syncConnectorEndpoints(document.elements[index]!, map);
    out.append(`<g${attrs({ id: `sd-${index}`, transform: `translate(${n(el.x)} ${n(el.y)}) rotate(${n(el.rotation)} ${n(el.width / 2)} ${n(el.height / 2)})` })}>`);
    if (el.label !== undefined)
      out.append(`<title>${escapeXmlText(xmlText(el.label, d, el))}</title>`);
    if (el.description !== undefined)
      out.append(`<desc>${escapeXmlText(xmlText(el.description, d, el))}</desc>`);
    const paint = svgPaint(el, d);
    if (['rectangle', 'container', 'component'].includes(el.kind))
      out.append(`<rect x="0" y="0" width="${n(el.width)}" height="${n(el.height)}"${paint}/>`);
    else if (el.kind === 'ellipse')
      out.append(`<ellipse cx="${n(el.width / 2)}" cy="${n(el.height / 2)}" rx="${n(el.width / 2)}" ry="${n(el.height / 2)}"${paint}/>`);
    else if (el.kind === 'diamond')
      out.append(`<polygon points="${n(el.width / 2)},0 ${n(el.width)},${n(el.height / 2)} ${n(el.width / 2)},${n(el.height)} 0,${n(el.height / 2)}"${paint}/>`);
    else if (el.kind === 'path' || el.kind === 'connector')
      out.append(`<polyline points="${el.points!.map(p => `${n(p.x)},${n(p.y)}`).join(' ')}"${paint}/>`);
    else if (el.kind === 'image')
      out.append(`<image${attrs({ x: 0, y: 0, width: el.width, height: el.height, href: document.assets[el.assetId!]!.dataUrl, opacity: el.style.opacity, preserveAspectRatio: 'none' })}/>`);
    if (el.kind === 'component') {
      const definition = [...document.componentSets, ...builtInComponentSets].flatMap(set => set.components).find(c => c.type === el.componentType);
      const icon = resolveCatalogIcon(definition?.iconSvg);
      if (icon.isFallback)
        diagnostic(d, el, 'COMPONENT_ICON_FALLBACK', 'Component uses the safe generic icon; provider semantics remain metadata.');
      const tree = icon.tree;
      out.append(`<svg${attrs({ ...tree.attributes, x: 4, y: 4, width: Math.min(32, el.width), height: Math.min(32, el.height), viewBox: tree.viewBox, color: safeColor(el.style.stroke,d,el), opacity: el.style.opacity })}>${tree.children.map(safeIcon).join('')}</svg>`);
    }
    out.append(nativeText(el, d));
    out.append('</g>');
  }
  out.append('</svg>');
  return out.toString();
}
function nativeDrawio(document: SketchDocument, d: DiagnosticCollector, embed: boolean): string {
  const out = new XmlOutputBuilder();
  const ids = new Map(document.elements.map((e, i) => [e.id, `sd-${i}`]));
  const map = new Map(document.elements.map(e => [e.id, e]));
  out.append(`<mxfile compressed="false"><diagram id="page-1" name="${escapeXmlAttr(xmlText(document.title, d))}"><mxGraphModel><root><object id="0"${embed ? ` sketchdrawInterop="${encodeEnvelope(document, 'drawio')}"` : ''}><mxCell/></object><mxCell id="1" parent="0"/>`);
  for (const raw of document.elements) {
    const el = syncConnectorEndpoints(raw, map), parent = el.parentId ? map.get(el.parentId) : undefined;
    const p = { x: parent?.x ?? 0, y: parent?.y ?? 0 };
    const text = xmlText(el.text || el.label || '', d, el);
    const style = [`html=0`, `strokeColor=${safeColor(el.style.stroke, d, el)}`, `fillColor=${safeColor(el.style.fill, d, el)}`, `strokeWidth=${el.style.strokeWidth}`, `opacity=${el.style.opacity * 100}`, `fontSize=${el.style.fontSize}`, `fontColor=${safeColor(el.style.stroke,d,el)}`, `fontFamily=${el.style.fontFamily === 'mono' ? 'monospace' : 'sans-serif'}`, `align=${el.style.textAlign}`, `rotation=${el.rotation}`, `dashed=${el.style.strokeDash === 'solid' ? 0 : 1}`, `dashPattern=${el.style.strokeDash === 'dotted' ? '2 4' : '8 6'}`, `startArrow=none`, `endArrow=none`];
    if (el.kind === 'ellipse')
      style.push('ellipse');
    else if (el.kind === 'diamond')
      style.push('rhombus');
    else if (el.kind === 'text')
      style.push('text', 'strokeColor=none', 'fillColor=none');
    else if (el.kind === 'container')
      style.push('group');
    else if (el.kind === 'image')
      style.push('shape=image', `image=${document.assets[el.assetId!]!.dataUrl.replace(';base64,', ',')}`, 'imageAspect=0');
    const edge = el.kind === 'connector' || el.kind === 'path';
    if (edge) {
      style.push('edgeStyle=none', 'noEdgeStyle=1');
      if (el.rotation !== 0)
        style.push('rotation=0');
      for (const [side, endpoint] of [['exit', el.from], ['entry', el.to]] as const)
        if (endpoint)
          style.push(`${side}X=${endpoint.anchor.x}`, `${side}Y=${endpoint.anchor.y}`, `${side}Perimeter=0`);
      if (el.kind === 'path')
        diagnostic(d, el, 'PATH_PROJECTION_APPROXIMATED', 'Freehand path is projected as an editable native edge; path identity/fill may differ.');
    }
    if (el.kind === 'component')
      diagnostic(d, el, 'COMPONENT_ICON_FALLBACK', 'draw.io component is an editable named rectangle; catalog/icon semantics remain metadata.');
    if (text)
      diagnostic(d, el, 'FONT_RENDERING_DEPENDENT', 'Text rendering depends on receiver fonts and text layout.');
    out.append(`<mxCell${attrs({ id: ids.get(el.id), parent: el.parentId ? ids.get(el.parentId) : '1', value: text, style: style.join(';') + ';', ...(edge ? { edge: '1', source: el.from ? ids.get(el.from.elementId) : undefined, target: el.to ? ids.get(el.to.elementId) : undefined } : { vertex: '1' }) })}>`);
    if (edge) {
      const points = el.points!.map(point => worldPoint(el, point));
      out.append('<mxGeometry relative="1" as="geometry">');
      for (const [point, as] of [[points[0]!, 'sourcePoint'], [points.at(-1)!, 'targetPoint']] as const)
        out.append(`<mxPoint${attrs({ x: point.x - p.x, y: point.y - p.y, as })}/>`);
      out.append('<Array as="points">');
      for (const point of points.slice(1, -1))
        out.append(`<mxPoint${attrs({ x: point.x - p.x, y: point.y - p.y })}/>`);
      out.append('</Array></mxGeometry>');
    }
    else
      out.append(`<mxGeometry${attrs({ x: el.x - p.x, y: el.y - p.y, width: el.width, height: el.height, as: 'geometry' })}/>`);
    out.append('</mxCell>');
  }
  // mxGraph paints children together. Detect non-contiguous descendants in the flat domain order.
  for (const parent of document.elements.filter(e => e.kind === 'container')) {
    const descendants = new Set([parent.id]);
    for (let pass = 0; pass < 32; pass++)
      for (const el of document.elements)
        if (el.parentId && descendants.has(el.parentId))
          descendants.add(el.id);
    const indices = document.elements.map((e, i) => descendants.has(e.id) ? i : -1).filter(i => i >= 0);
    if (indices.length > 1 && indices.at(-1)! - indices[0]! + 1 !== indices.length)
      diagnostic(d, parent, 'STACKING_ORDER_APPROXIMATED', 'Native hierarchy groups descendants and can change flat stacking order.');
  }
  out.append('</root></mxGraphModel></diagram></mxfile>');
  return out.toString();
}
export function prepareExport(document: SketchDocument, format: InteropFormat, options: InteropExportOptions = {}): InteropExportResult {
  const doc = validateDocument(document);
  serializeDocument(doc);
  const d = new DiagnosticCollector(), embed = options.embedDocument !== false;
  if (doc.componentSets.length || Object.keys(doc.metadata).length || Object.keys(doc.assets).length || doc.elements.some(e => e.parentId || e.from || e.to || e.metadata || e.label || e.description || e.componentType))
    diagnostic(d, undefined, embed ? 'SEMANTICS_IN_METADATA' : 'SEMANTICS_OMITTED', embed ? 'Additional document semantics and resources are embedded as data, including information not visible on the canvas.' : 'Portable projection omits native document identity, catalog, binding and metadata semantics.', !embed);
  const contents = format === 'svg' ? nativeSvg(doc, d, embed) : nativeDrawio(doc, d, embed);
  // Do not produce an output whose native projection exceeds our import limits.
  parseXmlDocument(contents);
  const diagnostics = d.finalize();
  return { format, contents, mimeType: format === 'svg' ? 'image/svg+xml' : 'application/xml', suggestedExtension: format === 'svg' ? '.svg' : '.drawio', diagnostics, requiresConfirmation: hasWarningDiagnostics(diagnostics), embedsDocument: embed };
}
export const prepareSvgExport = (doc: SketchDocument, options?: InteropExportOptions): InteropExportResult => prepareExport(doc, 'svg', options);
export const prepareDrawioExport = (doc: SketchDocument, options?: InteropExportOptions): InteropExportResult => prepareExport(doc, 'drawio', options);
function stringExport(result: InteropExportResult): string { if (result.requiresConfirmation)
  throw new InteropError('LOSS_CONFIRMATION_REQUIRED', 'Export requires loss confirmation.', result.diagnostics); return result.contents; }
export const exportSvg = (doc: SketchDocument): string => stringExport(prepareSvgExport(doc));
export const exportDrawio = (doc: SketchDocument): string => stringExport(prepareDrawioExport(doc));

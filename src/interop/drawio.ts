import { createElement, createTableDocument, shapeBaseKind, SHAPE_VARIANTS, tablePlainText } from '../domain';
import type { ConnectorMarker, Endpoint, Point, ShapeVariant, SketchElement } from '../domain';
import { resolveAnchorWorldPoint } from '../domain/geometry';
import { decompressDrawioPageXml } from './compression';
import { INTEROP_LIMITS as L } from './limits';
import { context, importBoundary, add, baseStyle, color, decodeEnvelope, fail, finish, imageAsset, number, plainHtml, placeholder, pointsElement, warn, type ImportContext } from './common';
import { prepareDrawioExport } from './export';
import { areXmlTreesEquivalent, stripDrawioEnvelopeFromXmlRoot as stripEnvelope, getElementChildren as children, getElementTextContent as text, parseXmlDocument, type XmlElementNode } from './xml';
import { InteropError, type DrawioImportOptions, type DrawioPageInfo, type InteropImportResult } from './types';
function named(node: XmlElementNode, local: string): boolean { return node.uri === '' && node.local === local; }
function outer(xml: string, nodeBudget?: { used: number }): {
  root: XmlElementNode;
  pages: XmlElementNode[];
  infos: DrawioPageInfo[];
} {
  const root = parseXmlDocument(xml, { nodeBudget });
  const pages = named(root, 'mxGraphModel') ? [root] : named(root, 'mxfile') ? children(root).filter(n => named(n, 'diagram')) : fail('UNSUPPORTED_FORMAT', 'Expected mxfile or mxGraphModel.');
  if (!pages.length || pages.length > L.MAX_PAGES)
    fail('LIMIT_EXCEEDED', 'draw.io requires between one and 100 pages.');
  const infos = pages.map((page, index): DrawioPageInfo => ({ index, ...(page.attributes['id'] ? { id: page.attributes['id'] } : {}), name: page.attributes['name'] ?? `Seite ${index + 1}`, encoding: named(page, 'mxGraphModel') || children(page).some(n => named(n, 'mxGraphModel')) ? 'xml' : 'deflate-base64' }));
  return { root, pages, infos };
}
export function inspectDrawio(xml: string): DrawioPageInfo[] { return outer(xml).infos; }
interface Cell {
  id: string;
  node: XmlElementNode;
  wrapper?: XmlElementNode;
  parent?: string;
  edge: boolean;
  vertex: boolean;
  value: string;
  style: Record<string, string>;
  geometry?: XmlElementNode;
  world?: {
    x: number;
    y: number;
    width: number;
    height: number;
  };
  hidden?: boolean;
}
function styles(value: string, ctx: ImportContext, node: XmlElementNode, defs: string[], chain = new Set<number>()): Record<string, string> {
  const result: Record<string, string> = Object.create(null);
  for (const part of value.split(';')) {
    if (!part)
      continue;
    const ref = /^def\((\d+)\)$/.exec(part);
    if (ref) {
      const i = Number(ref[1]);
      if (i >= defs.length || chain.has(i) || chain.size > 16)
        fail('INVALID_REFERENCE', 'Invalid or cyclic draw.io style definition.');
      Object.assign(result, styles(defs[i]!, ctx, node, defs, new Set([...chain, i])));
      continue;
    }
    const at = part.indexOf('=');
    const key = at < 0 ? part : part.slice(0, at);
    if (['__proto__', 'prototype', 'constructor'].includes(key))
      fail('INVALID_REFERENCE', 'Forbidden style key.');
    let resolved = at < 0 ? '1' : part.slice(at + 1);
    if (key === 'image' || key === 'shape') {
      const visited = new Set<number>();
      while (/^def\(\d+\)$/.test(resolved)) {
        const i = Number(resolved.slice(4, -1));
        if (i >= defs.length || visited.has(i) || visited.size >= 16)
          fail('INVALID_REFERENCE', 'Invalid or cyclic draw.io definition.');
        visited.add(i);
        resolved = defs[i]!;
      }
    }
    result[key] = resolved;
  }
  return result;
}
const knownStyles = new Set(['html', 'strokeColor', 'fillColor', 'strokeWidth', 'opacity', 'fontSize', 'fontColor', 'fontFamily', 'fontStyle', 'align', 'rotation', 'dashed', 'dashPattern', 'startArrow', 'endArrow', 'startFill', 'endFill', 'ellipse', 'rhombus', 'text', 'group', 'shape', 'image', 'imageAspect', 'edgeStyle', 'noEdgeStyle', 'curved', 'exitX', 'exitY', 'entryX', 'entryY', 'exitPerimeter', 'entryPerimeter', 'whiteSpace', 'verticalAlign', 'spacing', 'labelBackgroundColor', 'container', 'rounded', 'arcSize', 'direction', 'shadow', 'swimlane', 'childLayout', 'sketchdrawAuthor', 'sketchdrawListStyle', 'sketchdrawShapeVariant', 'sketchdrawKind']);
const shapeVariants = new Set<ShapeVariant>(SHAPE_VARIANTS);
const DRAWIO_MARKERS: Readonly<Record<string, ConnectorMarker>> = { none: 'none', open: 'line-arrow', classic: 'solid-arrow', classicThin: 'solid-arrow', block: 'triangle', blockThin: 'triangle', oval: 'circle', diamond: 'diamond', diamondThin: 'diamond' };
function styleOf(cell: Cell, ctx: ImportContext) {
  const s = baseStyle(), v = cell.style, node = cell.node;
  s.fill = color(v['fillColor'], cell.edge ? 'transparent' : '#ffffff', () => warn(ctx, node, 'STYLE_APPROXIMATED', 'fillColor', 'Unsupported fill replaced.'));
  s.stroke = color(v['strokeColor'], '#1e293b', () => warn(ctx, node, 'STYLE_APPROXIMATED', 'strokeColor', 'Unsupported stroke replaced.'));
  if(v['fontColor']) {
    const ink=color(v['fontColor'],s.stroke,()=>warn(ctx,node,'STYLE_APPROXIMATED','fontColor','Unsupported text ink replaced.'));
    if(v['text']==='1'||v['shape']==='text')s.stroke=ink;
    else if(ink!==s.stroke)warn(ctx,node,'TEXT_FORMATTING_LOST','fontColor','Independent label color approximated by shape stroke color.');
  }
  s.strokeWidth = number(v['strokeWidth'], 2);
  s.opacity = number(v['opacity'], 100) / 100;
  s.fontSize = number(v['fontSize'], 16);
  if (['left', 'center', 'right'].includes(v['align'] ?? ''))
    s.textAlign = v['align'] as typeof s.textAlign;
  if (v['fontFamily']) {
    const family = v['fontFamily'].trim();
    s.fontFamily = /^Roboto, sans-serif$/i.test(family) ? 'roboto' : /^Caveat, cursive$/i.test(family) ? 'scribbled' : /mono/i.test(family) ? 'mono' : 'sans';
    if (!/^(?:sans-serif|monospace|Inter|JetBrains Mono|Roboto, sans-serif|Caveat, cursive)$/i.test(family))
      warn(ctx, node, 'FONT_RENDERING_DEPENDENT', 'fontFamily', 'Foreign font mapped to bundled sans/mono family.');
  }
  if (v['fontStyle'] !== undefined) {
    const fontStyle = Math.max(0, Math.trunc(number(v['fontStyle'], 0)));
    s.fontWeight = (fontStyle & 1) === 1 ? 'bold' : 'normal';
    s.textDecoration = (fontStyle & 8) === 8 ? 'line-through' : 'none';
  }
  if (v['sketchdrawListStyle'] !== undefined)
    s.listStyle = v['sketchdrawListStyle'] === 'bullet' ? 'bullet' : 'none';
  s.strokeDash = v['dashed'] === '1' ? (v['dashPattern'] === '2 4' ? 'dotted' : 'dashed') : 'solid';
  for (const [key, value] of Object.entries(v))
    if (!knownStyles.has(key) || (['rounded', 'shadow'].includes(key) && value !== '0' && !(key === 'rounded' && cell.edge && value === '1') && v['sketchdrawKind'] !== 'annotation') || (['startArrow', 'endArrow'].includes(key) && !DRAWIO_MARKERS[value]))
      warn(ctx, node, 'STYLE_APPROXIMATED', key, `Style ${key} is not represented exactly.`);
  if (cell.hidden) {
    s.opacity = 0;
    warn(ctx, node, 'VISIBILITY_FLATTENED', 'visible', 'Hidden state is retained as opacity zero.');
  }
  return s;
}
function label(cell: Cell, ctx: ImportContext): string {
  if (cell.style['html'] === '1') {
    warn(ctx, cell.node, 'TEXT_FORMATTING_LOST', 'value', 'HTML label converted to inert plain text.');
    return plainHtml(cell.value);
  }
  return cell.value;
}
function pointNode(geometry: XmlElementNode | undefined, name: string): Point | undefined {
  const p = geometry && children(geometry).find(n => named(n, 'mxPoint') && n.attributes['as'] === name);
  return p ? { x: number(p.attributes['x']), y: number(p.attributes['y']) } : undefined;
}
function convertDrawio(xml: string, options: DrawioImportOptions = {}): InteropImportResult {
  const nodeBudget = { used: 0 };
  const { root, pages, infos } = outer(xml, nodeBudget);
  if (pages.length > 1 && options.pageIndex === undefined)
    fail('PAGE_SELECTION_REQUIRED', 'Select a draw.io page explicitly.');
  const index = options.pageIndex ?? 0;
  if (!Number.isInteger(index) || index < 0 || index >= pages.length)
    fail('PAGE_NOT_FOUND', 'draw.io page index does not exist.');
  const page = pages[index]!, info = infos[index]!, ctx = context('drawio', info.name);
  if (new Set(infos.filter(p => p.id !== undefined).map(p => p.id)).size !== infos.filter(p => p.id !== undefined).length)
    warn(ctx, root, 'DUPLICATE_PAGE_ID', 'id', 'Repeated page IDs are disambiguated by page index.');
  ctx.diagnostics.add({ code: 'PAGE_SELECTED', severity: 'info', effect: 'normalized', pageIndex: index, message: `drawio: Selected page ${index + 1} of ${pages.length}; other pages are not imported.` });
  const models = named(page, 'mxGraphModel') ? [page] : children(page).filter(n => named(n, 'mxGraphModel'));
  const model = info.encoding === 'xml' ? (models.length === 1 ? models[0]! : fail('UNSUPPORTED_FORMAT', 'Expected exactly one graph model.')) : parseXmlDocument(decompressDrawioPageXml(text(page), index, page.path), { maxInputBytes: L.MAX_DECODED_PAGE_BYTES, nodeBudget });
  if (!named(model, 'mxGraphModel'))
    fail('UNSUPPORTED_FORMAT', 'Decoded page is not an mxGraphModel.');
  const graphRoots = children(model).filter(n => named(n, 'root'));
  if (graphRoots.length !== 1)
    fail('UNSUPPORTED_FORMAT', 'Graph model requires one root.');
  const graph = graphRoots[0]!, nodes = children(graph), cells: Cell[] = [], byId = new Map<string, Cell>();
  const definitions = children(model).filter(n => named(n, 'defs')).flatMap(n => children(n).filter(c => named(c, 'def')).map(n => n.attributes['data'] ?? ''));
  const envelopes: {
    node: XmlElementNode;
    value: string;
  }[] = [];
  for (const item of nodes) {
    let node: XmlElementNode, wrapper: XmlElementNode | undefined;
    if (named(item, 'mxCell'))
      node = item;
    else {
      const nested = children(item).filter(n => named(n, 'mxCell'));
      if (nested.length !== 1) {
        warn(ctx, item, 'UNSUPPORTED_SHAPE', 'node', 'Unknown graph entry is represented as a placeholder.');
        placeholder(ctx, item, 'Unsupported graph entry');
        continue;
      }
      node = nested[0]!;
      wrapper = item;
    }
    const id = wrapper?.attributes['id'] ?? node.attributes['id'];
    if (!id)
      fail('INVALID_REFERENCE', 'Cell ID is missing.');
    if (wrapper?.attributes['id'] && node.attributes['id'] && wrapper.attributes['id'] !== node.attributes['id'])
      fail('INVALID_REFERENCE', 'Wrapper and cell IDs disagree.');
    if (byId.has(id))
      fail('DUPLICATE_SOURCE_ID', 'Duplicate draw.io cell ID.');
    if (wrapper?.attributes['sketchdrawInterop'])
      envelopes.push({ node: wrapper, value: wrapper.attributes['sketchdrawInterop'] });
    const cell: Cell = { id, node, wrapper, parent: node.attributes['parent'], edge: node.attributes['edge'] === '1', vertex: node.attributes['vertex'] === '1', value: wrapper?.attributes['label'] ?? node.attributes['value'] ?? '', style: styles(node.attributes['style'] ?? '', ctx, node, definitions), geometry: children(node).find(n => named(n, 'mxGeometry')) };
    cells.push(cell);
    byId.set(id, cell);
  }
  if (envelopes.length) {
    try {
      if (envelopes.length !== 1 || envelopes[0]!.node.attributes['id'] !== '0')
        throw new Error('Duplicate or misplaced metadata');
      const doc = decodeEnvelope(envelopes[0]!.value, 'drawio');
      const expected = parseXmlDocument(prepareDrawioExport(doc).contents);
      if (areXmlTreesEquivalent(stripEnvelope(root), stripEnvelope(expected)))
        return finish(ctx, options, doc, info);
      warn(ctx, envelopes[0]!.node, 'EMBEDDED_MODEL_STALE', 'sketchdrawInterop', 'Visible native projection changed; embedded document ignored.');
    }
    catch (error) {
      const code = error instanceof InteropError && error.code === 'EMBEDDED_MODEL_STALE' ? error.code : 'EMBEDDED_MODEL_INVALID';
      warn(ctx, envelopes[0]!.node, code, 'sketchdrawInterop', 'Embedded model cannot be verified; native projection used.');
    }
  }
  function world(cell: Cell, chain = new Set<string>()): {
    x: number;
    y: number;
    width: number;
    height: number;
  } {
    if (cell.world)
      return cell.world;
    if (chain.has(cell.id) || chain.size > 32)
      fail('INVALID_REFERENCE', 'Cyclic or overdeep cell parent chain.');
    chain.add(cell.id);
    const parent = cell.parent ? byId.get(cell.parent) : undefined;
    if (cell.parent && !parent)
      fail('INVALID_REFERENCE', 'Missing cell parent.');
    const origin = parent ? world(parent, chain) : { x: 0, y: 0, width: 0, height: 0 };
    const g = cell.geometry?.attributes ?? {}, off = pointNode(cell.geometry, 'offset') ?? { x: 0, y: 0 };
    const relative = g['relative'] === '1' && cell.vertex && !parent?.edge;
    if (relative)
      warn(ctx, cell.node, 'RELATIVE_LAYOUT_FLATTENED', 'geometry', 'Relative layout is flattened into absolute coordinates.');
    cell.hidden = cell.node.attributes['visible'] === '0' || parent?.hidden === true;
    cell.world = { x: origin.x + number(g['x']) * (relative ? origin.width : 1) + off.x, y: origin.y + number(g['y']) * (relative ? origin.height : 1) + off.y, width: number(g['width'], cell.vertex ? 120 : 0), height: number(g['height'], cell.vertex ? 80 : 0) };
    return cell.world;
  }
  for (const cell of cells)
    world(cell);
  const layers = cells.filter(c => !c.vertex && !c.edge && c.parent !== undefined).map(c => ({ id: c.id, name: c.value, hidden: c.hidden, parent: c.parent }));
  if (layers.length)
    ctx.sourceBudget.attach(ctx.document.metadata, { format: 'drawio', sourceType: 'layers', pageIndex: index, extraAttributes: { layers: JSON.stringify(layers) } }, ctx.diagnostics, { elementId: ctx.document.id, pageIndex: index, sourcePath: graph.path });
  for (const cell of cells)
    for (const [key] of Object.entries(cell.wrapper?.attributes ?? {}))
      if (!['id', 'label', 'sketchdrawInterop'].includes(key))
        warn(ctx, cell.wrapper, 'SEMANTICS_IN_METADATA', key, 'User-object semantics retained only as inert source data.', 'preserved-as-data');
  const elements = new Map<string, SketchElement>();
  const childCounts = new Map<string, number>();
  for (const c of cells)
    if (c.parent)
      childCounts.set(c.parent, (childCounts.get(c.parent) ?? 0) + 1);
  for (const cell of cells.filter(c => c.vertex && !byId.get(c.parent ?? '')?.edge)) {
    const s = cell.style, hasChildren = (childCounts.get(cell.id) ?? 0) > 0;
    const shapeVariant = typeof s['sketchdrawShapeVariant'] === 'string' && shapeVariants.has(s['sketchdrawShapeVariant'] as ShapeVariant) ? s['sketchdrawShapeVariant'] as ShapeVariant : undefined;
    let kind: SketchElement['kind'] = shapeVariant ? shapeBaseKind(shapeVariant) : s['sketchdrawKind'] === 'table' ? 'table' : s['sketchdrawKind'] === 'annotation' ? 'annotation' : s['shape'] === 'note' ? 'sticky-note' : s['ellipse'] === '1' || s['shape'] === 'ellipse' ? 'ellipse' : s['rhombus'] === '1' || s['shape'] === 'rhombus' ? 'diamond' : s['text'] === '1' || s['shape'] === 'text' ? 'text' : s['shape'] === 'image' || s['image'] === '1' ? 'image' : hasChildren || s['group'] === '1' || s['container'] === '1' || s['swimlane'] === '1' ? 'container' : 'rectangle';
    if (!shapeVariant && s['shape'] && !['rectangle', 'ellipse', 'rhombus', 'text', 'image', 'note', 'table'].includes(s['shape']))
      warn(ctx, cell.node, 'UNSUPPORTED_SHAPE', 'shape', 'Foreign stencil represented by an editable rectangle.');
    const rotation = number(s['rotation']);
    if (kind === 'container' && (rotation !== 0 || cell.node.attributes['collapsed'] === '1'))
      warn(ctx, cell.node, 'CONTAINER_LAYOUT_APPROXIMATED', 'geometry', 'Container is expanded/unrotated; child positions retained.');
    const bounds = world(cell);
    if (bounds.width <= 0 || bounds.height <= 0)
      fail('INVALID_GEOMETRY', 'Vertex bounds must be positive.');
    const assetId = kind === 'image' ? imageAsset(ctx, s['image']?.replace(/^data:(image\/(?:png|jpeg|webp)),/, 'data:$1;base64,'), cell.node) : undefined;
    if (kind === 'image' && !assetId)
      kind = 'rectangle';
    let author: string | undefined;
    if (kind === 'sticky-note') {
      try { author = decodeURIComponent(s['sketchdrawAuthor'] ?? '') || 'Importiert'; }
      catch { author = 'Importiert'; warn(ctx, cell.node, 'STYLE_APPROXIMATED', 'sketchdrawAuthor', 'Invalid sticky-note author encoding was replaced.'); }
    }
    const importedLabel = label(cell, ctx);
    const importedText = kind === 'sticky-note' && s['sketchdrawListStyle'] === 'bullet'
      ? importedLabel.split('\n').map(line => line.replace(/^•\s?/, '')).join('\n')
      : importedLabel;
    const outerStyle = styleOf(cell, ctx);
    let table = kind === 'table' ? createTableDocument(Math.max(1, importedText.split('\n').length), Math.max(1, ...importedText.split('\n').map((row) => row.split('\t').length))) : undefined;
    if (table) table.cells.forEach((entry, cellIndex) => {
      const rowIndex = Math.floor(cellIndex / table!.columns.length); const columnIndex = cellIndex % table!.columns.length;
      entry.text = importedText.split('\n')[rowIndex]?.split('\t')[columnIndex] ?? '';
      entry.style = { fill: outerStyle.fill === 'transparent' ? '#ffffff' : outerStyle.fill, color: outerStyle.stroke, fontSize: outerStyle.fontSize, fontFamily: outerStyle.fontFamily ?? 'sans', fontWeight: outerStyle.fontWeight ?? 'normal', textDecoration: outerStyle.textDecoration ?? 'none', listStyle: outerStyle.listStyle ?? 'none', textAlign: outerStyle.textAlign };
    });
    const element = createElement(kind, { ...bounds, id: ctx.ids.resolveId(cell.id, 'cell', ctx.diagnostics, { sourcePath: cell.node.path }), rotation: kind === 'container' ? 0 : rotation, style: outerStyle, text: table ? tablePlainText(table) : importedText || (s['shape'] === 'image' && !assetId ? 'Blocked image' : ''), ...(table ? { table } : {}), ...(shapeVariant ? { shapeVariant } : {}), ...(assetId ? { assetId } : {}), ...(author ? { author } : {}) });
    add(ctx, element, cell.wrapper ?? cell.node);
    elements.set(cell.id, element);
  }
  for (const cell of cells.filter(c => c.edge)) {
    const origin = cell.parent ? world(byId.get(cell.parent)!) : { x: 0, y: 0 };
    const edgeStyle = styleOf(cell, ctx);
    const endpoints: Array<{
      point?: Point;
      binding?: Endpoint;
    }> = [];
    for (const [attr, side, pointName] of [['source', 'exit', 'sourcePoint'], ['target', 'entry', 'targetPoint']] as const) {
      const targetId = cell.node.attributes[attr], target = targetId ? elements.get(targetId) : undefined;
      const free = pointNode(cell.geometry, pointName);
      const anchorX = cell.style[`${side}X`], anchorY = cell.style[`${side}Y`];
      if (target) {
        const exact = anchorX !== undefined && anchorY !== undefined && cell.style[`${side}Perimeter`] === '0';
        const anchor = exact ? { x: number(anchorX), y: number(anchorY) } : { x: .5, y: .5 };
        if (anchor.x < 0 || anchor.x > 1 || anchor.y < 0 || anchor.y > 1)
          fail('INVALID_REFERENCE', 'Anchor must lie within its terminal.');
        if (!exact)
          warn(ctx, cell.node, 'ROUTING_APPROXIMATED', attr, 'Automatic terminal/perimeter routing uses the terminal center.');
        endpoints.push({ point: resolveAnchorWorldPoint(target, anchor), binding: { elementId: target.id, anchor } });
      }
      else if (free) {
        if (targetId)
          warn(ctx, cell.node, 'INVALID_REFERENCE', attr, 'Missing terminal detached using explicit free endpoint.');
        endpoints.push({ point: { x: free.x + origin.x, y: free.y + origin.y } });
      }
      else
        endpoints.push({});
    }
    if (!endpoints[0]!.point || !endpoints[1]!.point) {
      warn(ctx, cell.node, 'EDGE_ENDPOINT_UNRESOLVED', 'geometry', 'Unresolved edge becomes a labelled placeholder.');
      placeholder(ctx, cell.node, label(cell, ctx) || 'Unresolved edge');
      continue;
    }
    const waypointArray = cell.geometry && children(cell.geometry).find(n => named(n, 'Array') && n.attributes['as'] === 'points');
    const waypoints = waypointArray ? children(waypointArray).filter(n => named(n, 'mxPoint')).map(n => ({ x: number(n.attributes['x']) + origin.x, y: number(n.attributes['y']) + origin.y })) : [];
    if (cell.style['edgeStyle'] && !['none', 'orthogonalEdgeStyle'].includes(cell.style['edgeStyle']))
      warn(ctx, cell.node, 'ROUTING_APPROXIMATED', 'edgeStyle', 'Stored waypoints are retained without executing a foreign router.');
    const element = pointsElement(ctx, [endpoints[0]!.point!, ...waypoints, endpoints[1]!.point!], cell.node, edgeStyle, 'connector', ctx.ids.resolveId(cell.id, 'edge', ctx.diagnostics));
    element.connectorRouting = cell.style['curved'] === '1' ? 'curved' : cell.style['edgeStyle'] === 'orthogonalEdgeStyle' ? 'elbowed' : 'straight';
    element.startMarker = DRAWIO_MARKERS[cell.style['startArrow'] ?? 'none'] ?? 'none';
    element.endMarker = DRAWIO_MARKERS[cell.style['endArrow'] ?? 'none'] ?? 'none';
    if (endpoints[0]!.binding)
      element.from = endpoints[0]!.binding;
    if (endpoints[1]!.binding)
      element.to = endpoints[1]!.binding;
    if (cell.value)
      element.text = label(cell, ctx);
    elements.set(cell.id, element);
  }
  for (const cell of cells.filter(c => c.vertex && byId.get(c.parent ?? '')?.edge)) {
    const edge = elements.get(cell.parent!);
    if (!edge?.points) {
      warn(ctx, cell.node, 'EDGE_ENDPOINT_UNRESOLVED', 'parent', 'Edge label has no resolved edge.');
      placeholder(ctx, cell.node, label(cell, ctx));
      continue;
    }
    const points = edge.points, first = points[0]!, last = points.at(-1)!, fraction = (number(cell.geometry?.attributes['x']) + 1) / 2;
    warn(ctx, cell.node, 'TEXT_BOUNDS_APPROXIMATED', 'geometry', 'Edge label placed along endpoint chord; foreign label routing/offset approximated.');
    const e = createElement('text', { id: ctx.ids.resolveId(cell.id, 'label', ctx.diagnostics), x: edge.x + first.x + (last.x - first.x) * fraction, y: edge.y + first.y + (last.y - first.y) * fraction, text: label(cell, ctx), style: styleOf(cell, ctx) });
    add(ctx, e, cell.node);
    elements.set(cell.id, e);
  }
  for (const cell of cells) {
    const el = elements.get(cell.id), parent = elements.get(cell.parent ?? '');
    if (el && parent?.kind === 'container')
      el.parentId = parent.id;
  }
  // Match the source cell stacking order; placeholders retain their insertion order at the end.
  const order = new Map(cells.map((c, i) => [elements.get(c.id)?.id, i]));
  ctx.document.elements.sort((a, b) => (order.get(a.id) ?? cells.length) - (order.get(b.id) ?? cells.length));
  return finish(ctx, options, undefined, info);
}
export function importDrawio(xml: string, options: DrawioImportOptions = {}): InteropImportResult { return importBoundary(() => convertDrawio(xml, options)); }

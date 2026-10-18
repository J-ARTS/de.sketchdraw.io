import { createElement, DOMAIN_LIMITS, shapeBaseKind, SHAPE_VARIANTS } from '../domain';
import type { ElementStyle, Point, ShapeVariant } from '../domain';
import { context, importBoundary, add, baseStyle, color, decodeEnvelope, fail, findOwnSvgEnvelope, finish, imageAsset, length, number, placeholder, pointsElement, SVG_NS, textOf, warn } from './common';
import { flattenPath, IDENTITY, multiply, parseNumbers, parseTransform, rectangleTransform, transformPoint, type Matrix } from './geometry';
import { INTEROP_LIMITS as L } from './limits';
import { prepareSvgExport } from './export';
import { areXmlTreesEquivalent, stripSvgEnvelopeFromXmlRoot as stripEnvelope, getElementChildren as children, parseXmlDocument, type XmlElementNode } from './xml';
import { InteropError, type ImportOptions, type InteropImportResult } from './types';
const presentation = new Set(['fill', 'stroke', 'stroke-width', 'opacity', 'font-size', 'font-family', 'text-anchor', 'stroke-dasharray', 'display', 'visibility', 'color', 'fill-opacity', 'stroke-opacity', 'fill-rule', 'stroke-linecap', 'stroke-linejoin', 'clip-path', 'filter', 'mask', 'marker-start', 'marker-mid', 'marker-end', 'mix-blend-mode', 'font-weight', 'font-style', 'text-decoration', 'writing-mode', 'direction']);
const shapeVariants = new Set<ShapeVariant>(SHAPE_VARIANTS);
function convertSvg(xml: string, options: ImportOptions = {}): InteropImportResult {
  const root = parseXmlDocument(xml);
  if (root.uri !== SVG_NS || root.local !== 'svg')
    fail('UNSUPPORTED_FORMAT', 'Expected a namespaced SVG root.');
  const title = children(root).find(n => n.uri === SVG_NS && n.local === 'title');
  const ctx = context('svg', title ? textOf(title) : 'Imported SVG');
  const byId = new Map<string, XmlElementNode>();
  let indexed = 0;
  function index(node: XmlElementNode) { if (++indexed > L.MAX_XML_NODES)
    fail('LIMIT_EXCEEDED', 'SVG node budget exceeded.'); const id = node.attributes['id']; if (id !== undefined) {
    if (byId.has(id))
      fail('DUPLICATE_SOURCE_ID', 'Duplicate SVG ID.');
    byId.set(id, node);
  } for (const child of children(node))
    index(child); }
  index(root);
  const envelope = findOwnSvgEnvelope(root);
  if (envelope.length) {
    try {
      if (envelope.length !== 1 || envelope[0]!.local !== 'document')
        throw new Error('Bad envelope');
      const doc = decodeEnvelope(textOf(envelope[0]!), 'svg');
      const expected = parseXmlDocument(prepareSvgExport(doc).contents);
      if (areXmlTreesEquivalent(stripEnvelope(root), stripEnvelope(expected)))
        return finish(ctx, options, doc);
      warn(ctx, envelope[0], 'EMBEDDED_MODEL_STALE', 'metadata', 'Visible projection changed; embedded document ignored.');
    }
    catch (error) {
      const code = error instanceof InteropError && error.code === 'EMBEDDED_MODEL_STALE' ? error.code : 'EMBEDDED_MODEL_INVALID';
      warn(ctx, envelope[0], code, 'metadata', 'Unverifiable own metadata ignored; native SVG used.');
    }
  }
  const vb = root.attributes['viewBox'] ? parseNumbers(root.attributes['viewBox']) : undefined;
  if (vb && (vb.length !== 4 || vb[2]! <= 0 || vb[3]! <= 0))
    fail('INVALID_GEOMETRY', 'viewBox needs positive finite bounds.');
  const viewport = { width: vb?.[2] ?? (root.attributes['width'] ? length(root.attributes['width']) : undefined), height: vb?.[3] ?? (root.attributes['height'] ? length(root.attributes['height']) : undefined) };
  let expanded = 0;
  function id(node: XmlElementNode, instance: string) { return ctx.ids.resolveId(node.attributes['id'] ? `${instance}${node.attributes['id']}` : undefined, 'svg', ctx.diagnostics, { sourcePath: node.path }); }
  function style(node: XmlElementNode, inherited: Record<string, string>, parentOpacity: number): {
    values: Record<string, string>;
    style: ElementStyle;
    opacity: number;
  } {
    const values = { ...inherited };
    delete values['opacity'];
    for (const key of presentation)
      if (node.attributes[key] !== undefined)
        values[key] = node.attributes[key]!;
    if (node.attributes['style'])
      for (const declaration of node.attributes['style'].split(';')) {
        if (!declaration.trim())
          continue;
        const at = declaration.indexOf(':');
        const key = declaration.slice(0, at).trim(), value = declaration.slice(at + 1).trim();
        if (at < 1 || !presentation.has(key) || /!important|var\(|url\(|@import/i.test(value)) {
          warn(ctx, node, 'STYLE_APPROXIMATED', 'style', 'Unsupported or resource-bearing CSS declaration omitted.', 'omitted');
          continue;
        }
        values[key] = value;
      }
    for (const attribute of node.attributeList)
      if (/^on/i.test(attribute.local))
        warn(ctx, node, 'ACTIVE_CONTENT_OMITTED', attribute.name, 'Event handler omitted.', 'omitted');
    const report = (prop: string) => () => warn(ctx, node, 'STYLE_APPROXIMATED', prop, 'Unsupported presentation value replaced.');
    const result = baseStyle();
    const resolvedColor = values['color'] ? color(values['color'], '#000000', report('color')) : undefined;
    const paint = (key: string, fallback: string) => { const value = values[key]; if (value === 'currentColor') {
      if (resolvedColor)
        return resolvedColor;
      report(key)();
      return fallback;
    } return color(value, fallback, report(key)); };
    result.fill = paint('fill', '#000000');
    result.stroke = paint('stroke', 'transparent');
    result.strokeWidth = length(values['stroke-width'], 1);
    result.opacity = parentOpacity * number(values['opacity'], 1);
    result.fontSize = length(values['font-size'], 16);
    result.textAlign = values['text-anchor'] === 'middle' ? 'center' : values['text-anchor'] === 'end' ? 'right' : 'left';
    if (values['font-family']) {
      const family = values['font-family'].trim();
      result.fontFamily = /^Roboto, sans-serif$/i.test(family) ? 'roboto' : /^Caveat, cursive$/i.test(family) ? 'scribbled' : /mono|JetBrains/i.test(family) ? 'mono' : 'sans';
      if (!/^(?:Inter, sans-serif|JetBrains Mono, monospace|sans-serif|monospace|Roboto, sans-serif|Caveat, cursive)$/i.test(family))
        warn(ctx, node, 'FONT_RENDERING_DEPENDENT', 'font-family', 'Foreign font mapped to bundled sans/mono.');
    }
    const dash = values['stroke-dasharray'];
    if (dash && dash !== 'none') {
      const a = parseNumbers(dash);
      result.strokeDash = a.length === 2 && a[0] === 2 && a[1] === 4 ? 'dotted' : 'dashed';
      if (a.length !== 2 || !(a[0] === 8 && a[1] === 6 || a[0] === 2 && a[1] === 4))
        report('stroke-dasharray')();
    }
    for (const key of ['fill-opacity', 'stroke-opacity', 'clip-path', 'filter', 'mask', 'marker-start', 'marker-mid', 'marker-end', 'mix-blend-mode', 'font-weight', 'font-style', 'text-decoration', 'writing-mode', 'direction', 'stroke-linecap', 'stroke-linejoin'])
      if (values[key] !== undefined)
        warn(ctx, node, 'STYLE_APPROXIMATED', key, `Presentation ${key} is not fully represented.`);
    const effectiveOpacity = result.opacity;
    if (values['display'] === 'none')
      values['_ancestorDisplayNone'] = '1';
    if (values['_ancestorDisplayNone'] === '1' || values['visibility'] === 'hidden' || values['visibility'] === 'collapse') {
      result.opacity = 0;
      warn(ctx, node, 'VISIBILITY_FLATTENED', 'visibility', 'Hidden content retained with opacity zero.');
    }
    if (result.opacity < 0 || result.opacity > 1 || result.strokeWidth < 0 || result.fontSize <= 0)
      fail('INVALID_GEOMETRY', 'Invalid presentation bounds.');
    return { values, style: result, opacity: effectiveOpacity };
  }
  function visit(node: XmlElementNode, parent: Matrix, inherited: Record<string, string>, opacity: number, instance = '', useChain = new Set<string>(), view = viewport): void {
    if (++expanded > L.MAX_XML_NODES)
      fail('LIMIT_EXCEEDED', 'SVG expansion budget exceeded.');
    if (node.uri !== SVG_NS) {
      warn(ctx, node, 'UNSUPPORTED_SHAPE', 'namespace', 'Unknown namespaced subtree replaced.');
      placeholder(ctx, node, 'Unsupported SVG extension', undefined, id(node, instance));
      return;
    }
    if (['defs', 'metadata', 'title', 'desc'].includes(node.local))
      return;
    if (['script', 'animate', 'animateMotion', 'animateTransform', 'set', 'style'].includes(node.local)) {
      warn(ctx, node, node.local === 'style' ? 'STYLE_APPROXIMATED' : 'ACTIVE_CONTENT_OMITTED', node.local, 'Active content or stylesheet omitted.', 'omitted');
      return;
    }
    const painted = style(node, inherited, opacity);
    let matrix = multiply(parent, parseTransform(node.attributes['transform']));
    const attrs = node.attributes;
    if (node.local === 'use') {
      const href = attrs['href'] ?? node.attributeList.find(a => a.uri === 'http://www.w3.org/1999/xlink' && a.local === 'href')?.value;
      if (!href?.startsWith('#')) {
        warn(ctx, node, 'EXTERNAL_RESOURCE_BLOCKED', 'href', 'Only local use references are accepted.', 'omitted');
        placeholder(ctx, node, 'Blocked reference', undefined, id(node, instance));
        return;
      }
      const ref = href.slice(1), target = byId.get(ref);
      if (!target || useChain.has(ref) || useChain.size >= L.MAX_USE_DEPTH)
        fail('INVALID_REFERENCE', 'Missing, cyclic or overdeep use reference.');
      matrix = multiply(matrix, [1, 0, 0, 1, length(attrs['x'], 0, view.width), length(attrs['y'], 0, view.height)]);
      visit(target, matrix, painted.values, painted.opacity, `${instance}use${expanded}:`, new Set([...useChain, ref]), view);
      return;
    }
    if (node.local === 'svg' || node.local === 'symbol') {
      if (node !== root) {
        const box = attrs['viewBox'] ? parseNumbers(attrs['viewBox']) : undefined;
        const width = length(attrs['width'], box?.[2] ?? view.width ?? 160, view.width), height = length(attrs['height'], box?.[3] ?? view.height ?? 80, view.height);
        const shapeVariant = attrs['data-sketchdraw-shape'];
        if (shapeVariant && shapeVariants.has(shapeVariant as ShapeVariant)) {
          const positioned = multiply(matrix, [1, 0, 0, 1, length(attrs['x'], 0, view.width), length(attrs['y'], 0, view.height)]);
          const shape = rectangleTransform(positioned, 0, 0, width, height);
          if (!shape) fail('INVALID_GEOMETRY', 'Sketchdraw shape uses an unsupported transform.');
          add(ctx, createElement(shapeBaseKind(shapeVariant as ShapeVariant), { id: id(node, instance), ...shape, style: painted.style, shapeVariant: shapeVariant as ShapeVariant }), node);
          return;
        }
        matrix = multiply(matrix, [1, 0, 0, 1, length(attrs['x'], 0, view.width), length(attrs['y'], 0, view.height)]);
        if (box) {
          if (box.length !== 4 || box[2]! <= 0 || box[3]! <= 0 || width <= 0 || height <= 0)
            fail('INVALID_GEOMETRY', 'Invalid nested viewport.');
          let sx = width / box[2]!, sy = height / box[3]!, dx = 0, dy = 0;
          const preserve = attrs['preserveAspectRatio'] ?? 'xMidYMid meet';
          if (preserve !== 'none') {
            const match = /^(xMin|xMid|xMax)(YMin|YMid|YMax)(?:\s+(meet|slice))?$/.exec(preserve);
            if (!match)
              fail('INVALID_GEOMETRY', 'Unsupported preserveAspectRatio.');
            const scale = match[3] === 'slice' ? Math.max(sx, sy) : Math.min(sx, sy);
            sx = sy = scale;
            dx = (width - box[2]! * scale) * (match[1] === 'xMin' ? 0 : match[1] === 'xMid' ? .5 : 1);
            dy = (height - box[3]! * scale) * (match[2] === 'YMin' ? 0 : match[2] === 'YMid' ? .5 : 1);
            if (match[3] === 'slice')
              warn(ctx, node, 'STYLE_APPROXIMATED', 'overflow', 'Nested viewport clipping not retained.');
          }
          matrix = multiply(matrix, [sx, 0, 0, sy, dx - box[0]! * sx, dy - box[1]! * sy]);
          view = { width: box[2], height: box[3] };
        }
        else
          view = { width, height };
        warn(ctx, node, 'NESTED_VIEWPORT_FLATTENED', 'viewport', 'Nested viewport transformed into document coordinates; clipping semantics flattened.');
      }
      for (const child of children(node))
        visit(child, matrix, painted.values, painted.opacity, instance, useChain, view);
      return;
    }
    if (node.local === 'g' && attrs['data-sketchdraw-shape'] && shapeVariants.has(attrs['data-sketchdraw-shape'] as ShapeVariant)) {
      const shapeVariant = attrs['data-sketchdraw-shape'] as ShapeVariant;
      const width = length(attrs['width'], 120, view.width), height = length(attrs['height'], 80, view.height);
      const shape = rectangleTransform(matrix, 0, 0, width, height);
      if (!shape) fail('INVALID_GEOMETRY', 'Sketchdraw shape uses an unsupported transform.');
      add(ctx, createElement(shapeBaseKind(shapeVariant), { id: id(node, instance), ...shape, style: painted.style, shapeVariant }), node);
      return;
    }
    if (node.local === 'g' || node.local === 'a') {
      if (node.local === 'a')
        warn(ctx, node, 'LINK_PRESERVED_AS_TEXT', 'href', 'Link is not activated during import.', 'omitted');
      const start = ctx.document.elements.length;
      for (const child of children(node))
        visit(child, matrix, painted.values, painted.opacity, instance, useChain, view);
      const descendants = ctx.document.elements.slice(start);
      if (!descendants.length)
        return;
      const corners = descendants.flatMap(e => { const angle = e.rotation * Math.PI / 180, c = Math.cos(angle), s = Math.sin(angle); return [[0, 0], [e.width, 0], [e.width, e.height], [0, e.height]].map(([x, y]) => ({ x: e.x + e.width / 2 + (x! - e.width / 2) * c - (y! - e.height / 2) * s, y: e.y + e.height / 2 + (x! - e.width / 2) * s + (y! - e.height / 2) * c })); });
      const x = Math.min(...corners.map(p => p.x)), y = Math.min(...corners.map(p => p.y));
      const container = createElement('container', { id: id(node, instance), x, y, width: Math.max(1, Math.max(...corners.map(p => p.x)) - x), height: Math.max(1, Math.max(...corners.map(p => p.y)) - y), style: { ...baseStyle(), stroke: 'transparent', fill: 'transparent', strokeWidth: 0 } });
      add(ctx, container, node);
      ctx.document.elements.splice(ctx.document.elements.length - 1, 1);
      ctx.document.elements.splice(start, 0, container);
      for (const child of descendants)
        if (!child.parentId)
          child.parentId = container.id;
      if (attrs['opacity'])
        warn(ctx, node, 'GROUP_OPACITY_APPROXIMATED', 'opacity', 'Group opacity applied per child; overlap blending can differ.');
      return;
    }
    const elementId = id(node, instance);
    const sx = Math.hypot(matrix[0], matrix[1]), sy = Math.hypot(matrix[2], matrix[3]);
    if (sx === 0 || sy === 0 || Math.abs(matrix[0] * matrix[3] - matrix[1] * matrix[2]) < 1e-14) {
      warn(ctx, node, 'TRANSFORM_APPROXIMATED', 'transform', 'Singular transform replaced with a labelled placeholder.');
      placeholder(ctx, node, 'Collapsed ' + node.local, undefined, elementId);
      return;
    }
    painted.style.strokeWidth *= Math.sqrt(sx * sy);
    if (Math.abs(sx - sy) > 1e-8 && painted.style.strokeWidth)
      warn(ctx, node, 'STYLE_APPROXIMATED', 'stroke-width', 'Nonuniform stroke scaling approximated.');
    const label = children(node).find(n => n.local === 'title' && n.uri === SVG_NS);
    const description = children(node).find(n => n.local === 'desc' && n.uri === SVG_NS);
    const accessible = { ...(label ? { label: textOf(label) } : {}), ...(description ? { description: textOf(description) } : {}) };
    const x = () => length(attrs['x'], 0, view.width), y = () => length(attrs['y'], 0, view.height), width = () => length(attrs['width'], 0, view.width), height = () => length(attrs['height'], 0, view.height);
    if (node.local === 'rect' || node.local === 'ellipse' || node.local === 'circle' || node.local === 'image') {
      const circle = node.local === 'circle', ellipse = node.local === 'ellipse' || circle;
      const rx = ellipse ? length(circle ? attrs['r'] : attrs['rx'], 0, view.width) : width() / 2, ry = ellipse ? length(circle ? attrs['r'] : attrs['ry'], 0, view.height) : height() / 2;
      if (rx < 0 || ry < 0)
        fail('INVALID_GEOMETRY', 'Negative shape size.');
      if (rx === 0 || ry === 0) {
        warn(ctx, node, 'ZERO_SIZE_GEOMETRY', 'geometry', 'Zero-size shape omitted.', 'omitted');
        return;
      }
      const left = ellipse ? length(attrs['cx'], 0, view.width) - rx : x(), top = ellipse ? length(attrs['cy'], 0, view.height) - ry : y(), shape = rectangleTransform(matrix, left, top, rx * 2, ry * 2);
      if (attrs['rx'] && !ellipse || attrs['ry'] && !ellipse)
        warn(ctx, node, 'STYLE_APPROXIMATED', 'radius', 'Rounded corners approximated by square corners.');
      if (node.local === 'image') {
        const asset = imageAsset(ctx, attrs['href'] ?? node.attributeList.find(a => a.uri === 'http://www.w3.org/1999/xlink' && a.local === 'href')?.value, node);
        if (!shape || !asset) {
          warn(ctx, node, 'IMAGE_TRANSFORM_APPROXIMATED', 'geometry', 'Image replaced because transform or resource is unsupported.');
          placeholder(ctx, node, 'Unsupported image', shape, elementId);
          return;
        }
        if (attrs['preserveAspectRatio'] !== 'none')
          warn(ctx, node, 'IMAGE_ASPECT_APPROXIMATED', 'preserveAspectRatio', 'Image uses explicit editable bounds; intrinsic aspect fitting may differ.');
        add(ctx, createElement('image', { id: elementId, ...shape, style: painted.style, assetId: asset, ...accessible }), node);
        return;
      }
      if (shape) {
        const style = { ...painted.style };
        add(ctx, createElement(ellipse ? 'ellipse' : 'rectangle', { id: elementId, ...shape, style, ...accessible }), node);
      }
      else {
        warn(ctx, node, 'TRANSFORM_FLATTENED', 'transform', 'Skew/reflection transformed to editable points.');
        const path = ellipse ? flattenPath(`M ${left} ${top + ry} A ${rx} ${ry} 0 1 0 ${left + rx * 2} ${top + ry} A ${rx} ${ry} 0 1 0 ${left} ${top + ry} Z`, matrix, Math.min(L.MAX_GENERATED_POINTS, L.MAX_TOTAL_GENERATED_POINTS - ctx.totalPoints)).subpaths[0]! : [{ x: left, y: top }, { x: left + rx * 2, y: top }, { x: left + rx * 2, y: top + ry * 2 }, { x: left, y: top + ry * 2 }, { x: left, y: top }].map(p => transformPoint(matrix, p));
        pointsElement(ctx, path, node, painted.style, 'path', elementId);
      }
      return;
    }
    if (['path', 'line', 'polyline', 'polygon'].includes(node.local)) {
      let paths: Point[][];
      if (node.local === 'path') {
        const path = flattenPath(attrs['d'] ?? '', matrix, Math.min(L.MAX_GENERATED_POINTS, L.MAX_TOTAL_GENERATED_POINTS - ctx.totalPoints));
        paths = path.subpaths;
        if (path.curved)
          warn(ctx, node, 'CURVE_FLATTENED', 'd', 'Curves flattened within 0.25 document units.');
        if (paths.length > 1 && painted.style.fill !== 'transparent') {
          warn(ctx, node, 'COMPOUND_FILL_APPROXIMATED', 'fill', 'Compound fill replaced with separately editable contours.');
          painted.style.fill = 'transparent';
          if (painted.style.stroke === 'transparent')
            painted.style.stroke = '#000000';
        }
      }
      else if (node.local === 'line')
        paths = [[{ x: length(attrs['x1'], 0, view.width), y: length(attrs['y1'], 0, view.height) }, { x: length(attrs['x2'], 0, view.width), y: length(attrs['y2'], 0, view.height) }].map(p => transformPoint(matrix, p))];
      else {
        const values = parseNumbers(attrs['points'] ?? '');
        if (values.length % 2)
          fail('INVALID_GEOMETRY', 'Odd point coordinate count.');
        if (values.length / 2 + (node.local === 'polygon' ? 1 : 0) > Math.min(L.MAX_GENERATED_POINTS, L.MAX_TOTAL_GENERATED_POINTS - ctx.totalPoints))
          fail('LIMIT_EXCEEDED', 'Point generation budget exceeded.');
        let points: Array<Point> = [];
        for (let i = 0; i < values.length; i += 2)
          points.push(transformPoint(matrix, { x: values[i]!, y: values[i + 1]! }));
        if (node.local === 'polygon' && points.length)
          points = [...points, points[0]!];
        paths = [points];
      }
      for (let i = 0; i < paths.length; i++) {
        const path = paths[i]!;
        if (path.length < 2) {
          warn(ctx, node, 'EMPTY_PATH', 'geometry', 'Path without a drawable segment omitted.', 'omitted');
          continue;
        }
        const e = pointsElement(ctx, path, node, painted.style, 'path', i === 0 ? elementId : ctx.ids.resolveId(`${elementId}:part${i}`, 'path', ctx.diagnostics));
        Object.assign(e, accessible);
      }
      return;
    }
    if (node.local === 'text') {
      const spans = children(node).filter(c => c.local === 'tspan' && c.uri === SVG_NS);
      let value = '';
      for (const child of node.children) {
        if (child.kind === 'text')
          value += child.text;
        else if (child.local === 'tspan') {
          if (value && child.attributes['y'] !== undefined)
            value += '\n';
          value += textOf(child);
        }
        else if (!['title', 'desc'].includes(child.local))
          warn(ctx, child, 'TEXT_FORMATTING_LOST', 'text', 'Unsupported text subtree omitted.', 'omitted');
      }
      for (const span of spans)
        if (span.attributes['style'] || span.attributes['dx'] || span.attributes['dy'] || span.attributes['font-size'])
          warn(ctx, span, 'TEXT_FORMATTING_LOST', 'tspan', 'Complex text positioning/styles simplified.');
      const positions = (value: string, reference?: number) => value.trim().split(/[\s,]+/).map(v => length(v, 0, reference));
      const xs = positions(attrs['x'] ?? spans[0]?.attributes['x'] ?? '0', view.width), ys = positions(attrs['y'] ?? spans[0]?.attributes['y'] ?? '0', view.height);
      if (xs.length > 1 || ys.length > 1)
        warn(ctx, node, 'TEXT_FORMATTING_LOST', 'position', 'Per-glyph positions simplified.');
      const lines = value.split('\n'), w = Math.max(1, ...lines.map(line => line.length * painted.style.fontSize * .6)), h = Math.max(1, lines.length * painted.style.fontSize * 1.2), left = (xs[0] ?? 0) - (painted.style.textAlign === 'center' ? w / 2 : painted.style.textAlign === 'right' ? w : 0), top = (ys[0] ?? 0) - painted.style.fontSize;
      warn(ctx, node, 'TEXT_BOUNDS_APPROXIMATED', 'geometry', 'Text bounds use 0.6em per character and 1.2em line height.');
      const transformed = rectangleTransform(matrix, left, top, w, h);
      if (!transformed) {
        warn(ctx, node, 'TEXT_TRANSFORM_APPROXIMATED', 'transform', 'Unsupported text transform replaced by a labelled rectangle.');
        placeholder(ctx, node, value, undefined, elementId);
        return;
      }
      painted.style.fontSize *= Math.hypot(matrix[2], matrix[3]);
      if (painted.style.stroke !== 'transparent')
        warn(ctx, node, 'TEXT_FORMATTING_LOST', 'stroke', 'Text outline is not represented separately.');
      painted.style.stroke = painted.style.fill;
      painted.style.fill = 'transparent';
      add(ctx, createElement('text', { id: elementId, ...transformed, style: painted.style, text: value, ...accessible }), node);
      return;
    }
    warn(ctx, node, node.local === 'foreignObject' ? 'ACTIVE_CONTENT_OMITTED' : 'UNSUPPORTED_SHAPE', node.local, 'Unsupported subtree becomes a labelled placeholder; active content is not rendered.');
    placeholder(ctx, node, node.local === 'foreignObject' ? textOf(node).slice(0, DOMAIN_LIMITS.MAX_TEXT_LENGTH) : `Unsupported ${node.local}`, width() > 0 && height() > 0 ? rectangleTransform(matrix, x(), y(), width(), height()) : undefined, elementId);
  }
  visit(root, IDENTITY, {}, 1);
  return finish(ctx, options);
}
export function importSvg(xml: string, options: ImportOptions = {}): InteropImportResult { return importBoundary(() => convertSvg(xml, options)); }

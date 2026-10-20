import { Parser } from 'htmlparser2';
import { createDocument, createElement, DEFAULT_PAGE_ID, serializeDocument, validateDocument, DOMAIN_LIMITS } from '../domain';
import type { ElementStyle, Point, SketchDocument, SketchElement, ValidationIssue } from '../domain';
import { validateAsset, utf8ByteLength } from '../domain/validation';
import { parseStrictJsonObject } from '../codec/json';
import { decodeBase64ToUtf8String, encodeUtf8JsonToBase64 } from './compression';
import { DiagnosticCollector, DeterministicIdMapper, SourceMetadataBudget, computeImportFidelity, extractWarnings, hasWarningDiagnostics } from './diagnostics';
import { InteropError, type ImportOptions, type InteropFormat, type InteropImportResult, type DrawioPageInfo } from './types';
import { INTEROP_LIMITS as L } from './limits';
import { getElementChildren, getElementTextContent, type XmlElementNode } from './xml';
export const SVG_NS = 'http://www.w3.org/2000/svg';
export const OWN_NS = 'https://sketchdraw.io/ns/interop/1';
export interface ImportContext {
  format: InteropFormat;
  document: SketchDocument;
  diagnostics: DiagnosticCollector;
  ids: DeterministicIdMapper;
  sourceBudget: SourceMetadataBudget;
  totalPoints: number;
  assetBytes: number;
  /** Page that receives the elements added by `add` (draw.io pages). */
  pageId: string;
}
export function context(format: InteropFormat, title: string): ImportContext {
  return { format, document: createDocument(title), diagnostics: new DiagnosticCollector(), ids: new DeterministicIdMapper(), sourceBudget: new SourceMetadataBudget(), totalPoints: 0, assetBytes: 0, pageId: DEFAULT_PAGE_ID };
}
export function warn(ctx: Pick<ImportContext, 'diagnostics' | 'format'>, node: XmlElementNode | undefined, code: string, property: string, message: string, effect: 'approximated' | 'omitted' | 'preserved-as-data' = 'approximated'): void {
  ctx.diagnostics.add({ code, property, message: `${ctx.format}: ${message}`, severity: 'warning', effect, sourceId: node?.attributes['id'], sourcePath: node?.path ?? '/', });
}
export function fail(code: string, message: string): never { throw new InteropError(code, message); }
export function number(value: string | undefined, fallback = 0): number {
  if (value === undefined || value.trim() === '')
    return fallback;
  if (!/^[+-]?(?:\d+\.?\d*|\.\d+)(?:e[+-]?\d+)?$/i.test(value.trim()))
    return fail('INVALID_GEOMETRY', 'Geometry contains an invalid number.');
  const n = Number(value);
  if (!Number.isFinite(n) || Math.abs(n) > DOMAIN_LIMITS.MAX_COORDINATE_ABS)
    return fail('LIMIT_EXCEEDED', 'Geometry exceeds the coordinate limit.');
  return Object.is(n, -0) ? 0 : n;
}
export function length(value: string | undefined, fallback = 0, reference?: number): number {
  if (value === undefined)
    return fallback;
  const match = /^([+-]?(?:\d+\.?\d*|\.\d+)(?:e[+-]?\d+)?)(px|pt|pc|mm|cm|in|%)?$/i.exec(value.trim());
  if (!match)
    return fail('UNSUPPORTED_UNIT', 'Unsupported or unresolved geometry unit.');
  const unit = match[2]?.toLowerCase() ?? 'px';
  if (unit === '%' && reference === undefined)
    return fail('UNSUPPORTED_UNIT', 'Percentage has no known viewport.');
  return number(String(number(match[1]) * ({ px: 1, pt: 96 / 72, pc: 16, mm: 96 / 25.4, cm: 96 / 2.54, in: 96, '%': (reference ?? 0) / 100 }[unit]!)));
}
export function numbers(value: string): number[] {
  const pieces = value.trim().match(/[+-]?(?:\d+\.?\d*|\.\d+)(?:e[+-]?\d+)?|[^\s,]+/gi) ?? [];
  return pieces.map(v => number(v));
}
export const NAMED_COLORS: Readonly<Record<string, string>> = Object.freeze({ black: '#000000', white: '#ffffff', red: '#ff0000', green: '#008000', blue: '#0000ff', yellow: '#ffff00', gray: '#808080', grey: '#808080', silver: '#c0c0c0', orange: '#ffa500', purple: '#800080', pink: '#ffc0cb', cyan: '#00ffff', magenta: '#ff00ff', navy: '#000080', teal: '#008080', lime: '#00ff00', maroon: '#800000', olive: '#808000', transparent: 'transparent', none: 'transparent' });
export function color(value: string | undefined, fallback: string, report: () => void): string {
  if (value === undefined)
    return fallback;
  const v = value.trim().toLowerCase();
  if (/^#(?:[\da-f]{3}|[\da-f]{4}|[\da-f]{6}|[\da-f]{8})$/.test(v))
    return v;
  if (Object.hasOwn(NAMED_COLORS, v))
    return NAMED_COLORS[v]!;
  const m = /^rgba?\(\s*(\d+(?:\.\d+)?)\s*,\s*(\d+(?:\.\d+)?)\s*,\s*(\d+(?:\.\d+)?)(?:\s*,\s*(\d*\.?\d+))?\s*\)$/.exec(v);
  if (m && m.slice(1, 4).every(n => Number(n) <= 255) && (m[4] === undefined || Number(m[4]) <= 1))
    return v;
  report();
  return fallback;
}
export function plainHtml(value: string): string {
  let text = '';
  let blocked = 0;
  const blocks = new Set(['div', 'p', 'br', 'li', 'tr', 'h1', 'h2', 'h3']);
  const parser = new Parser({ onopentag(name) { if (['script', 'style'].includes(name))
      blocked++; if (!blocked && blocks.has(name) && text && !text.endsWith('\n'))
      text += '\n'; }, ontext(value) { if (!blocked)
      text += value; }, onclosetag(name) { if (['script', 'style'].includes(name))
      blocked = Math.max(0, blocked - 1); if (!blocked && blocks.has(name) && text && !text.endsWith('\n'))
      text += '\n'; } }, { decodeEntities: true });
  parser.write(value);
  parser.end();
  return text.replace(/\n$/, '');
}
export function add(ctx: ImportContext, element: SketchElement, node?: XmlElementNode, sourceType = node?.local ?? element.kind): SketchElement {
  if (ctx.document.elements.length >= DOMAIN_LIMITS.MAX_ELEMENTS)
    fail('LIMIT_EXCEEDED', 'Too many imported elements.');
  ctx.totalPoints += element.points?.length ?? 0;
  if ((element.points?.length ?? 0) > L.MAX_GENERATED_POINTS || ctx.totalPoints > L.MAX_TOTAL_GENERATED_POINTS)
    fail('LIMIT_EXCEEDED', 'Imported point budget exceeded.');
  if (node) {
    element.metadata ??= {};
    ctx.sourceBudget.attach(element.metadata, { format: ctx.format, sourceId: node.attributes['id'], sourceType, extraAttributes: { ...node.attributes } }, ctx.diagnostics, { elementId: element.id, sourcePath: node.path, sourceId: node.attributes['id'] });
  }
  element.pageId = ctx.pageId;
  ctx.document.elements.push(element);
  return element;
}
export function placeholder(ctx: ImportContext, node: XmlElementNode, text: string, bounds?: {
  x: number;
  y: number;
  width: number;
  height: number;
}, explicitId?: string): SketchElement {
  if (!bounds)
    warn(ctx, node, 'PLACEHOLDER_LAYOUT', 'geometry', 'Unknown geometry uses a labelled replacement at the next list position.');
  return add(ctx, createElement('rectangle', { id: explicitId ?? ctx.ids.resolveId(node.attributes['id'], 'placeholder', ctx.diagnostics, { sourcePath: node.path }), ...(bounds ?? { x: 0, y: ctx.document.elements.length * 100, width: 160, height: 80 }), text, label: text }), node);
}
export function imageAsset(ctx: ImportContext, value: string | undefined, node: XmlElementNode): string | undefined {
  const m = /^data:(image\/(?:png|jpeg|webp));base64,/.exec(value ?? '');
  if (!m) {
    warn(ctx, node, 'EXTERNAL_RESOURCE_BLOCKED', 'href', 'Only embedded PNG/JPEG/WebP images are accepted; image replaced.', 'omitted');
    return;
  }
  const existing = Object.values(ctx.document.assets).find(a => a.dataUrl === value && a.mimeType === m[1]);
  if (existing)
    return existing.id;
  const id = `asset:interop:${Object.keys(ctx.document.assets).length + 1}`;
  const asset = { id, dataUrl: value!, mimeType: m[1] as 'image/png' | 'image/jpeg' | 'image/webp', name: 'Imported image' };
  const issues: ValidationIssue[] = [];
  const bytes = validateAsset(asset, id, 'assets', new Set(), issues);
  if (issues.length) {
    warn(ctx, node, 'INVALID_IMAGE', 'href', 'Embedded image failed MIME, signature or size validation; replaced.', 'omitted');
    return;
  }
  if (ctx.assetBytes + bytes > DOMAIN_LIMITS.MAX_TOTAL_ASSET_BYTES)
    fail('LIMIT_EXCEEDED', 'Total image asset budget exceeded.');
  ctx.assetBytes += bytes;
  ctx.document.assets[id] = asset;
  return id;
}
export function finish(ctx: ImportContext, options: ImportOptions, restored?: SketchDocument, page?: DrawioPageInfo): InteropImportResult {
  const doc = restored ?? ctx.document;
  for (const [key, code] of [['documentId', 'IDENTITY_OVERRIDDEN'], ['title', 'TITLE_OVERRIDDEN']] as const) {
    if (options[key] !== undefined) {
      if (key === 'documentId')
        doc.id = options[key]!;
      else
        doc.title = options[key]!;
      ctx.diagnostics.add({ code, severity: 'info', effect: 'normalized', property: key, message: `${ctx.format}: Explicit ${key} override applied.` });
    }
  }
  let document: SketchDocument;
  try {
    document = validateDocument(doc);
    serializeDocument(document);
  }
  catch {
    return fail('INVALID_DOCUMENT', 'Converted document violates domain bounds, references or size limits.');
  }
  const diagnostics = ctx.diagnostics.finalize();
  return { document, diagnostics, warnings: extractWarnings(diagnostics), requiresConfirmation: hasWarningDiagnostics(diagnostics), fidelity: computeImportFidelity(diagnostics, !!restored), source: { format: ctx.format, ...(page ? { page } : {}) } };
}
export function encodeEnvelope(document: SketchDocument, format: InteropFormat): string {
  const json = JSON.stringify({ format: 'sketchdraw-interop', version: 1, projection: `${format}-v1`, encoding: 'base64-json', document: JSON.parse(serializeDocument(document)) });
  if (utf8ByteLength(json) > L.MAX_EMBEDDED_DOCUMENT_BYTES)
    fail('LIMIT_EXCEEDED', 'Embedded document envelope exceeds its byte limit.');
  return encodeUtf8JsonToBase64(json);
}
export function decodeEnvelope(value: string, format: InteropFormat): SketchDocument {
  const json = decodeBase64ToUtf8String(value, L.MAX_EMBEDDED_DOCUMENT_BYTES);
  const parsed = parseStrictJsonObject(json, { lineNumber: 1, lineOffset: 0 });
  if (!parsed.ok)
    fail('EMBEDDED_MODEL_INVALID', 'Invalid or duplicate embedded JSON fields.');
  const data = parsed.value;
  if (Object.keys(data).sort().join(',') !== 'document,encoding,format,projection,version' || data['format'] !== 'sketchdraw-interop' || data['version'] !== 1 || data['encoding'] !== 'base64-json')
    fail('EMBEDDED_MODEL_INVALID', 'Unsupported embedded envelope.');
  if (data['projection'] !== `${format}-v1`)
    fail('EMBEDDED_MODEL_STALE', 'Unknown projection version cannot confirm the native projection.');
  return validateDocument(data['document']);
}
export function findOwnSvgEnvelope(root: XmlElementNode): XmlElementNode[] {
  return getElementChildren(root).filter(n => n.uri === SVG_NS && n.local === 'metadata').flatMap(n => getElementChildren(n).filter(c => c.uri === OWN_NS));
}
export function textOf(node: XmlElementNode): string { return getElementTextContent(node); }
export function baseStyle(): ElementStyle { return createElement('rectangle').style; }
export function pointsElement(ctx: ImportContext, points: Point[], node: XmlElementNode, style: ElementStyle, kind: 'path' | 'connector' = 'path', id?: string): SketchElement {
  if (points.length < 2)
    fail('INVALID_GEOMETRY', 'A visible path requires at least two points.');
  const xs = points.map(p => p.x), ys = points.map(p => p.y);
  const x = Math.min(...xs), y = Math.min(...ys);
  return add(ctx, createElement(kind, { id: id ?? ctx.ids.resolveId(node.attributes['id'], 'path', ctx.diagnostics, { sourcePath: node.path }), x, y, width: Math.max(...xs) - x, height: Math.max(...ys) - y, points: points.map(p => ({ x: p.x - x, y: p.y - y })), style }), node);
}
export function checkText(value: string): string { if (value.length > DOMAIN_LIMITS.MAX_TEXT_LENGTH || utf8ByteLength(value) > L.MAX_INPUT_BYTES)
  fail('LIMIT_EXCEEDED', 'Text exceeds its limit.'); return value; }
/** Keep fatal import failures structured; never return a partly valid candidate. */
export function importBoundary<T>(convert: () => T): T {
  try {
    return convert();
  }
  catch (error) {
    if (error instanceof InteropError)
      throw error;
    throw new InteropError('INVALID_DOCUMENT', 'Conversion failed domain or resource validation; no document was imported.');
  }
}

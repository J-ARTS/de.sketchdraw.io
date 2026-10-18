import { cloneDocument, normalizeZero } from './geometry';
import { DomainValidationError } from './errors';
import { DOMAIN_LIMITS } from './limits';
import type {
  ComponentDefinition,
  AnnotationBlockType,
  ComponentSet,
  ConnectorMarker,
  ConnectorRouting,
  ElementKind,
  ElementStyle,
  Endpoint,
  Point,
  ShapeVariant,
  SketchAsset,
  SketchDocument,
  SketchElement,
  ValidationIssue,
} from './types';
import { SHAPE_KINDS, SHAPE_VARIANTS } from './shapes';
import { annotationPlainText } from './annotation';

export const FORBIDDEN_KEYS: ReadonlySet<string> = new Set([
  '__proto__',
  'constructor',
  'prototype',
]);

export const ID_PATTERN = /^[A-Za-z0-9._:-]+$/;
const BASE64_LINEAR_PATTERN = /^[A-Za-z0-9+/]+={0,2}$/;

export const ELEMENT_KINDS: ReadonlySet<ElementKind> = new Set<ElementKind>([
  'rectangle',
  'ellipse',
  'diamond',
  'text',
  'path',
  'image',
  'connector',
  'container',
  'component',
  'sticky-note',
  'annotation',
]);

const POSITIVE_AREA_KINDS: ReadonlySet<ElementKind> = new Set<ElementKind>([
  'rectangle',
  'ellipse',
  'diamond',
  'text',
  'image',
  'container',
  'component',
  'sticky-note',
  'annotation',
]);

const TEXT_ALIGNS: ReadonlySet<ElementStyle['textAlign']> = new Set(['left', 'center', 'right']);
const STROKE_DASHES: ReadonlySet<ElementStyle['strokeDash']> = new Set([
  'solid',
  'dashed',
  'dotted',
]);
const FONT_FAMILIES: ReadonlySet<NonNullable<ElementStyle['fontFamily']>> = new Set([
  'sans',
  'mono',
  'roboto',
  'scribbled',
]);
const FONT_WEIGHTS: ReadonlySet<NonNullable<ElementStyle['fontWeight']>> = new Set(['normal', 'bold']);
const TEXT_DECORATIONS: ReadonlySet<NonNullable<ElementStyle['textDecoration']>> = new Set(['none', 'line-through']);
const LIST_STYLES: ReadonlySet<NonNullable<ElementStyle['listStyle']>> = new Set(['none', 'bullet']);
const CONNECTOR_ROUTINGS: ReadonlySet<ConnectorRouting> = new Set(['straight', 'elbowed', 'curved']);
const CONNECTOR_MARKERS: ReadonlySet<ConnectorMarker> = new Set([
  'none', 'line-arrow', 'solid-arrow', 'triangle', 'circle', 'diamond',
]);
const VALID_SHAPE_VARIANTS: ReadonlySet<ShapeVariant> = new Set(SHAPE_VARIANTS);
const ASSET_MIME_TYPES: ReadonlySet<SketchAsset['mimeType']> = new Set([
  'image/png',
  'image/jpeg',
  'image/webp',
]);
const COMPONENT_PROVIDERS: ReadonlySet<ComponentDefinition['provider']> = new Set([
  'aws',
  'azure',
  'gcp',
  'kubernetes',
  'generic',
  'custom',
]);
const WIDGET_KINDS: ReadonlySet<'text' | 'number' | 'select'> = new Set([
  'text',
  'number',
  'select',
]);

const DOCUMENT_KEYS: ReadonlySet<string> = new Set([
  'schemaVersion',
  'id',
  'title',
  'elements',
  'assets',
  'componentSets',
  'metadata',
]);

export const ELEMENT_KEYS: ReadonlySet<string> = new Set([
  'id',
  'kind',
  'shapeVariant',
  'x',
  'y',
  'width',
  'height',
  'rotation',
  'style',
  'label',
  'description',
  'text',
  'annotation',
  'author',
  'points',
  'connectorRouting',
  'startMarker',
  'endMarker',
  'assetId',
  'from',
  'to',
  'parentId',
  'componentType',
  'metadata',
  'documentationUrl',
]);

export const STYLE_KEYS: ReadonlySet<string> = new Set([
  'stroke',
  'fill',
  'strokeWidth',
  'opacity',
  'fontSize',
  'textAlign',
  'strokeDash',
  'fontFamily',
  'fontWeight',
  'textDecoration',
  'listStyle',
]);

const POINT_KEYS: ReadonlySet<string> = new Set(['x', 'y']);
const ENDPOINT_KEYS: ReadonlySet<string> = new Set(['elementId', 'anchor']);
const ASSET_KEYS: ReadonlySet<string> = new Set(['id', 'mimeType', 'dataUrl', 'name']);
const COMPONENT_SET_KEYS: ReadonlySet<string> = new Set(['id', 'name', 'version', 'components']);
const COMPONENT_DEF_KEYS: ReadonlySet<string> = new Set([
  'type',
  'name',
  'provider',
  'category',
  'aliases',
  'defaultWidth',
  'defaultHeight',
  'style',
  'metadata',
  'documentationUrl',
  'iconSvg',
  'widgets',
]);
const WIDGET_KEYS: ReadonlySet<string> = new Set(['key', 'label', 'kind', 'options']);
const ANNOTATION_KEYS: ReadonlySet<string> = new Set(['version', 'blocks']);
const ANNOTATION_BLOCK_KEYS: ReadonlySet<string> = new Set(['type', 'runs']);
const ANNOTATION_RUN_KEYS: ReadonlySet<string> = new Set(['text', 'bold', 'italic', 'underline', 'color']);
const ANNOTATION_BLOCK_TYPES: ReadonlySet<AnnotationBlockType> = new Set([
  'paragraph', 'heading-1', 'heading-2', 'heading-3', 'heading-4', 'bullet', 'numbered', 'quote',
]);
const ANNOTATION_COLOR = /^#[0-9a-fA-F]{6}$/;

const textEncoder = new TextEncoder();

export function utf8ByteLength(text: string): number {
  return textEncoder.encode(text).byteLength;
}

export function joinPath(base: string, segment: string | number): string {
  if (typeof segment === 'number') {
    return `${base}[${segment}]`;
  }
  return base.length > 0 ? `${base}.${segment}` : segment;
}

export function isPlainRecord(value: unknown): value is Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return false;
  }
  const proto = Object.getPrototypeOf(value);
  if (proto !== Object.prototype && proto !== null) {
    return false;
  }
  return Object.getOwnPropertySymbols(value).length === 0;
}

export function isValidId(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    value.length >= 1 &&
    value.length <= DOMAIN_LIMITS.MAX_ID_LENGTH &&
    ID_PATTERN.test(value)
  );
}

export function validateIdField(
  value: unknown,
  path: string,
  issues: ValidationIssue[],
  code = 'INVALID_ID',
): value is string {
  if (typeof value !== 'string') {
    issues.push({ path, code, message: 'ID must be a string.' });
    return false;
  }
  if (value.length === 0) {
    issues.push({ path, code, message: 'ID must not be empty.' });
    return false;
  }
  if (value.length > DOMAIN_LIMITS.MAX_ID_LENGTH) {
    issues.push({
      path,
      code: 'ID_TOO_LONG',
      message: `ID exceeds maximum length of ${DOMAIN_LIMITS.MAX_ID_LENGTH} characters.`,
    });
    return false;
  }
  if (!ID_PATTERN.test(value)) {
    issues.push({
      path,
      code,
      message: 'ID contains invalid characters; only ASCII A-Z, a-z, 0-9, ., _, :, - are allowed.',
    });
    return false;
  }
  return true;
}

export function checkObjectKeys(
  record: Record<string, unknown>,
  path: string,
  allowedKeys: ReadonlySet<string> | null,
  issues: ValidationIssue[],
): void {
  const keys = Object.getOwnPropertyNames(record);
  for (const key of keys) {
    const fieldPath = joinPath(path, key);
    if (FORBIDDEN_KEYS.has(key)) {
      issues.push({
        path: fieldPath,
        code: 'FORBIDDEN_KEY',
        message: `Forbidden property key "${key}" is not allowed.`,
      });
      continue;
    }
    if (allowedKeys !== null && !allowedKeys.has(key)) {
      issues.push({
        path: fieldPath,
        code: 'UNKNOWN_FIELD',
        message: `Unknown property "${key}".`,
      });
      continue;
    }
    const val = record[key];
    if (val === undefined) {
      issues.push({
        path: fieldPath,
        code: 'NON_JSON_VALUE',
        message: `Property "${key}" must not be undefined.`,
      });
    }
  }
}

function validateAnnotationDocument(
  value: unknown,
  path: string,
  ancestors: Set<object>,
  issues: ValidationIssue[],
): boolean {
  const initialIssueCount = issues.length;
  if (!isPlainRecord(value)) {
    issues.push({ path, code: 'INVALID_ANNOTATION', message: 'Annotation content must be a plain object.' });
    return false;
  }
  if (ancestors.has(value)) {
    issues.push({ path, code: 'CYCLIC_OBJECT', message: 'Cyclic reference in annotation content.' });
    return false;
  }
  ancestors.add(value);
  checkObjectKeys(value, path, ANNOTATION_KEYS, issues);
  if (value.version !== 1) {
    issues.push({ path: joinPath(path, 'version'), code: 'INVALID_ANNOTATION_VERSION', message: 'Annotation version must be 1.' });
  }
  if (!Array.isArray(value.blocks)) {
    issues.push({ path: joinPath(path, 'blocks'), code: 'INVALID_ANNOTATION_BLOCKS', message: 'Annotation blocks must be an array.' });
    ancestors.delete(value);
    return false;
  }
  if (ancestors.has(value.blocks)) {
    issues.push({ path: joinPath(path, 'blocks'), code: 'CYCLIC_OBJECT', message: 'Cyclic reference in annotation blocks.' });
    ancestors.delete(value);
    return false;
  }
  ancestors.add(value.blocks);
  if (value.blocks.length < 1 || value.blocks.length > 1_000) {
    issues.push({ path: joinPath(path, 'blocks'), code: 'INVALID_ANNOTATION_BLOCK_COUNT', message: 'Annotation content must contain between 1 and 1000 blocks.' });
  }
  let totalTextLength = 0;
  let totalRuns = 0;
  for (let blockIndex = 0; blockIndex < Math.min(value.blocks.length, 1_000); blockIndex += 1) {
    const block = value.blocks[blockIndex];
    const blockPath = joinPath(joinPath(path, 'blocks'), blockIndex);
    if (!isPlainRecord(block)) {
      issues.push({ path: blockPath, code: 'INVALID_ANNOTATION_BLOCK', message: 'Annotation block must be a plain object.' });
      continue;
    }
    checkObjectKeys(block, blockPath, ANNOTATION_BLOCK_KEYS, issues);
    if (typeof block.type !== 'string' || !ANNOTATION_BLOCK_TYPES.has(block.type as AnnotationBlockType)) {
      issues.push({ path: joinPath(blockPath, 'type'), code: 'INVALID_ANNOTATION_BLOCK_TYPE', message: 'Annotation block type is not supported.' });
    }
    if (!Array.isArray(block.runs) || block.runs.length < 1 || block.runs.length > 5_000) {
      issues.push({ path: joinPath(blockPath, 'runs'), code: 'INVALID_ANNOTATION_RUNS', message: 'Annotation block must contain between 1 and 5000 text runs.' });
      continue;
    }
    totalRuns += block.runs.length;
    for (let runIndex = 0; runIndex < Math.min(block.runs.length, 5_000); runIndex += 1) {
      const run = block.runs[runIndex];
      const runPath = joinPath(joinPath(blockPath, 'runs'), runIndex);
      if (!isPlainRecord(run)) {
        issues.push({ path: runPath, code: 'INVALID_ANNOTATION_RUN', message: 'Annotation text run must be a plain object.' });
        continue;
      }
      checkObjectKeys(run, runPath, ANNOTATION_RUN_KEYS, issues);
      if (typeof run.text !== 'string') {
        issues.push({ path: joinPath(runPath, 'text'), code: 'INVALID_TEXT', message: 'Annotation text run must contain a string.' });
      } else {
        totalTextLength += run.text.length;
      }
      for (const mark of ['bold', 'italic', 'underline'] as const) {
        if (Object.prototype.hasOwnProperty.call(run, mark) && run[mark] !== true) {
          issues.push({ path: joinPath(runPath, mark), code: 'INVALID_ANNOTATION_MARK', message: `Annotation mark "${mark}" must be true when present.` });
        }
      }
      if (Object.prototype.hasOwnProperty.call(run, 'color') && (typeof run.color !== 'string' || !ANNOTATION_COLOR.test(run.color))) {
        issues.push({ path: joinPath(runPath, 'color'), code: 'INVALID_ANNOTATION_COLOR', message: 'Annotation text color must be a six-digit RGB hex value.' });
      }
    }
  }
  if (totalRuns > 10_000) {
    issues.push({ path: joinPath(path, 'blocks'), code: 'TOO_MANY_ANNOTATION_RUNS', message: 'Annotation content exceeds 10000 text runs.' });
  }
  if (totalTextLength > DOMAIN_LIMITS.MAX_TEXT_LENGTH) {
    issues.push({ path, code: 'TEXT_TOO_LONG', message: `Annotation content exceeds maximum length of ${DOMAIN_LIMITS.MAX_TEXT_LENGTH} characters.` });
  }
  ancestors.delete(value.blocks);
  ancestors.delete(value);
  return issues.length === initialIssueCount;
}

export function validateDocumentationUrl(
  value: unknown,
  path: string,
  issues: ValidationIssue[],
): value is string {
  if (typeof value !== 'string') {
    issues.push({
      path,
      code: 'INVALID_URL',
      message: 'Documentation URL must be a string.',
    });
    return false;
  }
  if (value.length === 0 || value.length > DOMAIN_LIMITS.MAX_TEXT_LENGTH) {
    issues.push({
      path,
      code: 'INVALID_URL',
      message: 'Documentation URL must be non-empty and within text length limits.',
    });
    return false;
  }
  if (!/^https?:\/\//.test(value)) {
    issues.push({
      path,
      code: 'UNSUPPORTED_URL_PROTOCOL',
      message: 'Documentation URL must be an absolute HTTP or HTTPS URL.',
    });
    return false;
  }
  try {
    const parsed = new URL(value);
    if (
      (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') ||
      parsed.hostname.length === 0 ||
      parsed.username.length > 0 ||
      parsed.password.length > 0
    ) {
      issues.push({
        path,
        code: 'INVALID_URL',
        message: 'Documentation URL must be a valid absolute HTTP(S) URL without credentials.',
      });
      return false;
    }
  } catch {
    issues.push({
      path,
      code: 'INVALID_URL',
      message: 'Documentation URL is malformed.',
    });
    return false;
  }
  return true;
}

export function validateStringMetadata(
  value: unknown,
  path: string,
  ancestors: Set<object>,
  issues: ValidationIssue[],
): value is Record<string, string> {
  if (!isPlainRecord(value)) {
    issues.push({
      path,
      code: 'INVALID_METADATA',
      message: 'Metadata must be a plain object.',
    });
    return false;
  }
  if (ancestors.has(value)) {
    issues.push({
      path,
      code: 'CYCLIC_OBJECT',
      message: 'Cyclic object reference detected in metadata.',
    });
    return false;
  }
  ancestors.add(value);
  checkObjectKeys(value, path, null, issues);
  const keys = Object.getOwnPropertyNames(value);
  for (const key of keys) {
    if (FORBIDDEN_KEYS.has(key)) continue;
    const keyPath = joinPath(path, key);
    if (key.length === 0 || key.length > DOMAIN_LIMITS.MAX_ID_LENGTH) {
      issues.push({
        path: keyPath,
        code: 'INVALID_METADATA_KEY',
        message: `Metadata key must be between 1 and ${DOMAIN_LIMITS.MAX_ID_LENGTH} characters.`,
      });
    }
    const entry = value[key];
    if (typeof entry === 'object' && entry !== null && ancestors.has(entry)) {
      issues.push({
        path: keyPath,
        code: 'CYCLIC_OBJECT',
        message: 'Cyclic object reference detected in metadata value.',
      });
      continue;
    }
    if (typeof entry !== 'string') {
      issues.push({
        path: keyPath,
        code: 'INVALID_METADATA_VALUE',
        message: 'Metadata value must be a string.',
      });
      continue;
    }
    if (entry.length > DOMAIN_LIMITS.MAX_TEXT_LENGTH) {
      issues.push({
        path: keyPath,
        code: 'TEXT_TOO_LONG',
        message: `Metadata value exceeds maximum length of ${DOMAIN_LIMITS.MAX_TEXT_LENGTH} characters.`,
      });
    }
  }
  ancestors.delete(value);
  return true;
}

export function validatePoint(
  value: unknown,
  path: string,
  ancestors: Set<object>,
  issues: ValidationIssue[],
  minCoord = -DOMAIN_LIMITS.MAX_COORDINATE_ABS,
  maxCoord = DOMAIN_LIMITS.MAX_COORDINATE_ABS,
): value is Point {
  if (!isPlainRecord(value)) {
    issues.push({ path, code: 'INVALID_POINT', message: 'Point must be a plain object.' });
    return false;
  }
  if (ancestors.has(value)) {
    issues.push({ path, code: 'CYCLIC_OBJECT', message: 'Cyclic reference in point.' });
    return false;
  }
  ancestors.add(value);
  checkObjectKeys(value, path, POINT_KEYS, issues);
  const { x, y } = value;
  if (typeof x !== 'number' || !Number.isFinite(x) || x < minCoord || x > maxCoord) {
    issues.push({
      path: joinPath(path, 'x'),
      code: 'INVALID_COORDINATE',
      message: `Coordinate x must be a finite number between ${minCoord} and ${maxCoord}.`,
    });
  }
  if (typeof y !== 'number' || !Number.isFinite(y) || y < minCoord || y > maxCoord) {
    issues.push({
      path: joinPath(path, 'y'),
      code: 'INVALID_COORDINATE',
      message: `Coordinate y must be a finite number between ${minCoord} and ${maxCoord}.`,
    });
  }
  ancestors.delete(value);
  return true;
}

export function validateEndpoint(
  value: unknown,
  path: string,
  ancestors: Set<object>,
  issues: ValidationIssue[],
): value is Endpoint {
  if (!isPlainRecord(value)) {
    issues.push({ path, code: 'INVALID_ENDPOINT', message: 'Endpoint must be a plain object.' });
    return false;
  }
  if (ancestors.has(value)) {
    issues.push({ path, code: 'CYCLIC_OBJECT', message: 'Cyclic reference in endpoint.' });
    return false;
  }
  ancestors.add(value);
  checkObjectKeys(value, path, ENDPOINT_KEYS, issues);
  validateIdField(value.elementId, joinPath(path, 'elementId'), issues);
  validatePoint(value.anchor, joinPath(path, 'anchor'), ancestors, issues, 0, 1);
  ancestors.delete(value);
  return true;
}

export function validateStyle(
  value: unknown,
  path: string,
  ancestors: Set<object>,
  issues: ValidationIssue[],
  partial = false,
): boolean {
  if (!isPlainRecord(value)) {
    issues.push({ path, code: 'INVALID_STYLE', message: 'Style must be a plain object.' });
    return false;
  }
  if (ancestors.has(value)) {
    issues.push({ path, code: 'CYCLIC_OBJECT', message: 'Cyclic reference in style.' });
    return false;
  }
  ancestors.add(value);
  checkObjectKeys(value, path, STYLE_KEYS, issues);

  if (!partial || Object.prototype.hasOwnProperty.call(value, 'stroke')) {
    if (
      typeof value.stroke !== 'string' ||
      value.stroke.length === 0 ||
      value.stroke.length > DOMAIN_LIMITS.MAX_ID_LENGTH
    ) {
      issues.push({
        path: joinPath(path, 'stroke'),
        code: 'INVALID_STYLE_FIELD',
        message: 'Style stroke must be a non-empty string within length limits.',
      });
    }
  }

  if (!partial || Object.prototype.hasOwnProperty.call(value, 'fill')) {
    if (
      typeof value.fill !== 'string' ||
      value.fill.length === 0 ||
      value.fill.length > DOMAIN_LIMITS.MAX_ID_LENGTH
    ) {
      issues.push({
        path: joinPath(path, 'fill'),
        code: 'INVALID_STYLE_FIELD',
        message: 'Style fill must be a non-empty string within length limits.',
      });
    }
  }

  if (!partial || Object.prototype.hasOwnProperty.call(value, 'strokeWidth')) {
    if (
      typeof value.strokeWidth !== 'number' ||
      !Number.isFinite(value.strokeWidth) ||
      value.strokeWidth < 0 ||
      value.strokeWidth > DOMAIN_LIMITS.MAX_DIMENSION
    ) {
      issues.push({
        path: joinPath(path, 'strokeWidth'),
        code: 'INVALID_STYLE_FIELD',
        message: 'Style strokeWidth must be a finite non-negative number.',
      });
    }
  }

  if (!partial || Object.prototype.hasOwnProperty.call(value, 'opacity')) {
    if (
      typeof value.opacity !== 'number' ||
      !Number.isFinite(value.opacity) ||
      value.opacity < 0 ||
      value.opacity > 1
    ) {
      issues.push({
        path: joinPath(path, 'opacity'),
        code: 'INVALID_STYLE_FIELD',
        message: 'Style opacity must be a finite number between 0 and 1.',
      });
    }
  }

  if (!partial || Object.prototype.hasOwnProperty.call(value, 'fontSize')) {
    if (
      typeof value.fontSize !== 'number' ||
      !Number.isFinite(value.fontSize) ||
      value.fontSize <= 0 ||
      value.fontSize > DOMAIN_LIMITS.MAX_DIMENSION
    ) {
      issues.push({
        path: joinPath(path, 'fontSize'),
        code: 'INVALID_STYLE_FIELD',
        message: 'Style fontSize must be a finite positive number.',
      });
    }
  }

  if (!partial || Object.prototype.hasOwnProperty.call(value, 'textAlign')) {
    if (
      typeof value.textAlign !== 'string' ||
      !TEXT_ALIGNS.has(value.textAlign as ElementStyle['textAlign'])
    ) {
      issues.push({
        path: joinPath(path, 'textAlign'),
        code: 'INVALID_STYLE_FIELD',
        message: 'Style textAlign must be "left", "center", or "right".',
      });
    }
  }

  if (!partial || Object.prototype.hasOwnProperty.call(value, 'strokeDash')) {
    if (
      typeof value.strokeDash !== 'string' ||
      !STROKE_DASHES.has(value.strokeDash as ElementStyle['strokeDash'])
    ) {
      issues.push({
        path: joinPath(path, 'strokeDash'),
        code: 'INVALID_STYLE_FIELD',
        message: 'Style strokeDash must be "solid", "dashed", or "dotted".',
      });
    }
  }

  if (Object.prototype.hasOwnProperty.call(value, 'fontFamily') && value.fontFamily !== undefined) {
    if (
      typeof value.fontFamily !== 'string' ||
      !FONT_FAMILIES.has(value.fontFamily as NonNullable<ElementStyle['fontFamily']>)
    ) {
      issues.push({
        path: joinPath(path, 'fontFamily'),
        code: 'INVALID_STYLE_FIELD',
        message: 'Style fontFamily must be "sans", "mono", "roboto" or "scribbled".',
      });
    }
  }

  if (Object.prototype.hasOwnProperty.call(value, 'fontWeight') && value.fontWeight !== undefined) {
    if (typeof value.fontWeight !== 'string' || !FONT_WEIGHTS.has(value.fontWeight as NonNullable<ElementStyle['fontWeight']>)) {
      issues.push({ path: joinPath(path, 'fontWeight'), code: 'INVALID_STYLE_FIELD', message: 'Style fontWeight must be "normal" or "bold".' });
    }
  }

  if (Object.prototype.hasOwnProperty.call(value, 'textDecoration') && value.textDecoration !== undefined) {
    if (typeof value.textDecoration !== 'string' || !TEXT_DECORATIONS.has(value.textDecoration as NonNullable<ElementStyle['textDecoration']>)) {
      issues.push({ path: joinPath(path, 'textDecoration'), code: 'INVALID_STYLE_FIELD', message: 'Style textDecoration must be "none" or "line-through".' });
    }
  }

  if (Object.prototype.hasOwnProperty.call(value, 'listStyle') && value.listStyle !== undefined) {
    if (typeof value.listStyle !== 'string' || !LIST_STYLES.has(value.listStyle as NonNullable<ElementStyle['listStyle']>)) {
      issues.push({ path: joinPath(path, 'listStyle'), code: 'INVALID_STYLE_FIELD', message: 'Style listStyle must be "none" or "bullet".' });
    }
  }

  ancestors.delete(value);
  return true;
}

function base64CharValue(code: number): number {
  if (code >= 65 && code <= 90) return code - 65; // A-Z
  if (code >= 97 && code <= 122) return code - 71; // a-z
  if (code >= 48 && code <= 57) return code + 4; // 0-9
  if (code === 43) return 62; // +
  if (code === 47) return 63; // /
  return -1;
}

function decodeBase64Prefix(base64: string, maxBytes: number): Uint8Array {
  const groups = Math.min(Math.floor(base64.length / 4), Math.ceil(maxBytes / 3));
  const out = new Uint8Array(groups * 3);
  let outIndex = 0;
  for (let i = 0; i < groups * 4; i += 4) {
    const c0 = base64CharValue(base64.charCodeAt(i));
    const c1 = base64CharValue(base64.charCodeAt(i + 1));
    const ch2 = base64.charCodeAt(i + 2);
    const ch3 = base64.charCodeAt(i + 3);
    const c2 = ch2 === 61 ? 0 : base64CharValue(ch2);
    const c3 = ch3 === 61 ? 0 : base64CharValue(ch3);
    const triple = (c0 << 18) | (c1 << 12) | (c2 << 6) | c3;
    out[outIndex++] = (triple >> 16) & 0xff;
    if (ch2 !== 61) out[outIndex++] = (triple >> 8) & 0xff;
    if (ch3 !== 61) out[outIndex++] = triple & 0xff;
  }
  return out.subarray(0, Math.min(outIndex, maxBytes));
}

function hasValidMagicSignature(
  mimeType: SketchAsset['mimeType'],
  headerBytes: Uint8Array,
  decodedByteLength: number,
): boolean {
  if (mimeType === 'image/png') {
    if (decodedByteLength < 8 || headerBytes.length < 8) return false;
    return (
      headerBytes[0] === 0x89 &&
      headerBytes[1] === 0x50 &&
      headerBytes[2] === 0x4e &&
      headerBytes[3] === 0x47 &&
      headerBytes[4] === 0x0d &&
      headerBytes[5] === 0x0a &&
      headerBytes[6] === 0x1a &&
      headerBytes[7] === 0x0a
    );
  }
  if (mimeType === 'image/jpeg') {
    if (decodedByteLength < 4 || headerBytes.length < 3) return false;
    return headerBytes[0] === 0xff && headerBytes[1] === 0xd8 && headerBytes[2] === 0xff;
  }
  if (mimeType === 'image/webp') {
    if (decodedByteLength < 12 || headerBytes.length < 12) return false;
    return (
      headerBytes[0] === 0x52 &&
      headerBytes[1] === 0x49 &&
      headerBytes[2] === 0x46 &&
      headerBytes[3] === 0x46 &&
      headerBytes[8] === 0x57 &&
      headerBytes[9] === 0x45 &&
      headerBytes[10] === 0x42 &&
      headerBytes[11] === 0x50
    );
  }
  return false;
}

const validatedDataUrlCache = new Map<
  string,
  { mimeType: SketchAsset['mimeType']; decodedBytes: number }
>();

export function validateAsset(
  value: unknown,
  expectedIdKey: string | null,
  path: string,
  ancestors: Set<object>,
  issues: ValidationIssue[],
): number {
  if (!isPlainRecord(value)) {
    issues.push({ path, code: 'INVALID_ASSET', message: 'Asset must be a plain object.' });
    return 0;
  }
  if (ancestors.has(value)) {
    issues.push({ path, code: 'CYCLIC_OBJECT', message: 'Cyclic reference in asset.' });
    return 0;
  }
  ancestors.add(value);
  checkObjectKeys(value, path, ASSET_KEYS, issues);

  const idPath = joinPath(path, 'id');
  if (validateIdField(value.id, idPath, issues) && expectedIdKey !== null && value.id !== expectedIdKey) {
    issues.push({
      path: idPath,
      code: 'ASSET_ID_MISMATCH',
      message: `Asset id "${value.id}" does not match record key "${expectedIdKey}".`,
    });
  }

  if (
    typeof value.name !== 'string' ||
    value.name.length === 0 ||
    value.name.length > DOMAIN_LIMITS.MAX_TEXT_LENGTH
  ) {
    issues.push({
      path: joinPath(path, 'name'),
      code: 'INVALID_ASSET_NAME',
      message: 'Asset name must be a non-empty string within text length limits.',
    });
  }

  const mimeType = value.mimeType;
  const mimeValid =
    typeof mimeType === 'string' && ASSET_MIME_TYPES.has(mimeType as SketchAsset['mimeType']);
  if (!mimeValid) {
    issues.push({
      path: joinPath(path, 'mimeType'),
      code: 'INVALID_ASSET_MIME_TYPE',
      message: 'Asset mimeType must be "image/png", "image/jpeg", or "image/webp".',
    });
  }

  const dataUrl = value.dataUrl;
  const dataUrlPath = joinPath(path, 'dataUrl');
  let decodedBytes = 0;

  if (typeof dataUrl !== 'string' || dataUrl.length === 0) {
    issues.push({
      path: dataUrlPath,
      code: 'INVALID_ASSET_DATA_URL',
      message: 'Asset dataUrl must be a non-empty base64 data URL string.',
    });
  } else if (mimeValid) {
    const typedMime = mimeType as SketchAsset['mimeType'];
    const cached = validatedDataUrlCache.get(dataUrl);
    if (cached && cached.mimeType === typedMime) {
      decodedBytes = cached.decodedBytes;
    } else {
      const expectedPrefix = `data:${typedMime};base64,`;
      if (!dataUrl.startsWith(expectedPrefix)) {
        issues.push({
          path: dataUrlPath,
          code: 'ASSET_PREFIX_MISMATCH',
          message: `Asset dataUrl must start with "${expectedPrefix}".`,
        });
      } else {
        const base64 = dataUrl.slice(expectedPrefix.length);
        if (
          base64.length === 0 ||
          base64.length % 4 !== 0 ||
          !BASE64_LINEAR_PATTERN.test(base64)
        ) {
          issues.push({
            path: dataUrlPath,
            code: 'INVALID_ASSET_BASE64',
            message: 'Asset dataUrl contains malformed base64 payload.',
          });
        } else {
          const padding = base64.endsWith('==') ? 2 : base64.endsWith('=') ? 1 : 0;
          decodedBytes = (base64.length / 4) * 3 - padding;
          if (decodedBytes <= 0) {
            issues.push({
              path: dataUrlPath,
              code: 'INVALID_ASSET_BASE64',
              message: 'Asset decoded payload must not be empty.',
            });
          } else if (decodedBytes > DOMAIN_LIMITS.MAX_ASSET_BYTES) {
            issues.push({
              path: dataUrlPath,
              code: 'ASSET_TOO_LARGE',
              message: `Asset decoded byte length (${decodedBytes}) exceeds limit of ${DOMAIN_LIMITS.MAX_ASSET_BYTES} bytes.`,
            });
          } else {
            const headerBytes = decodeBase64Prefix(base64, 16);
            if (!hasValidMagicSignature(typedMime, headerBytes, decodedBytes)) {
              issues.push({
                path: dataUrlPath,
                code: 'ASSET_SIGNATURE_MISMATCH',
                message: `Asset binary signature does not match declared MIME type "${typedMime}".`,
              });
            } else {
              if (validatedDataUrlCache.size >= 64) {
                const oldestKey = validatedDataUrlCache.keys().next().value;
                if (oldestKey !== undefined) {
                  validatedDataUrlCache.delete(oldestKey);
                }
              }
              validatedDataUrlCache.set(dataUrl, { mimeType: typedMime, decodedBytes });
            }
          }
        }
      }
    }
  }

  ancestors.delete(value);
  return decodedBytes;
}

export function validateElementIntrinsic(
  value: unknown,
  path: string,
  ancestors: Set<object>,
  issues: ValidationIssue[],
): value is SketchElement {
  if (!isPlainRecord(value)) {
    issues.push({ path, code: 'INVALID_ELEMENT', message: 'Element must be a plain object.' });
    return false;
  }
  if (ancestors.has(value)) {
    issues.push({ path, code: 'CYCLIC_OBJECT', message: 'Cyclic reference in element.' });
    return false;
  }
  ancestors.add(value);
  checkObjectKeys(value, path, ELEMENT_KEYS, issues);

  validateIdField(value.id, joinPath(path, 'id'), issues);

  const kind = value.kind;
  const kindValid = typeof kind === 'string' && ELEMENT_KINDS.has(kind as ElementKind);
  if (!kindValid) {
    issues.push({
      path: joinPath(path, 'kind'),
      code: 'INVALID_ELEMENT_KIND',
      message: 'Element kind must be one of the supported ElementKind values.',
    });
  }
  const typedKind = kindValid ? (kind as ElementKind) : null;

  if (Object.prototype.hasOwnProperty.call(value, 'shapeVariant') && value.shapeVariant !== undefined) {
    if (typedKind !== null && !SHAPE_KINDS.has(typedKind)) {
      issues.push({ path: joinPath(path, 'shapeVariant'), code: 'FORBIDDEN_ELEMENT_FIELD', message: 'Property "shapeVariant" is only allowed on geometric shape elements.' });
    } else if (typeof value.shapeVariant !== 'string' || !VALID_SHAPE_VARIANTS.has(value.shapeVariant as ShapeVariant)) {
      issues.push({ path: joinPath(path, 'shapeVariant'), code: 'INVALID_SHAPE_VARIANT', message: 'Element shapeVariant is not supported.' });
    }
  }

  for (const coordKey of ['x', 'y'] as const) {
    const coord = value[coordKey];
    if (
      typeof coord !== 'number' ||
      !Number.isFinite(coord) ||
      Math.abs(coord) > DOMAIN_LIMITS.MAX_COORDINATE_ABS
    ) {
      issues.push({
        path: joinPath(path, coordKey),
        code: 'INVALID_COORDINATE',
        message: `Element ${coordKey} must be a finite number within ±${DOMAIN_LIMITS.MAX_COORDINATE_ABS}.`,
      });
    }
  }

  const width = value.width;
  const height = value.height;
  const requiresPositiveBoth = typedKind === null || POSITIVE_AREA_KINDS.has(typedKind);

  if (
    typeof width !== 'number' ||
    !Number.isFinite(width) ||
    width < 0 ||
    (requiresPositiveBoth && width <= 0) ||
    width > DOMAIN_LIMITS.MAX_DIMENSION
  ) {
    issues.push({
      path: joinPath(path, 'width'),
      code: 'INVALID_DIMENSION',
      message: requiresPositiveBoth
        ? `Element width must be a positive number <= ${DOMAIN_LIMITS.MAX_DIMENSION}.`
        : `Element width must be a non-negative number <= ${DOMAIN_LIMITS.MAX_DIMENSION}.`,
    });
  }

  if (
    typeof height !== 'number' ||
    !Number.isFinite(height) ||
    height < 0 ||
    (requiresPositiveBoth && height <= 0) ||
    height > DOMAIN_LIMITS.MAX_DIMENSION
  ) {
    issues.push({
      path: joinPath(path, 'height'),
      code: 'INVALID_DIMENSION',
      message: requiresPositiveBoth
        ? `Element height must be a positive number <= ${DOMAIN_LIMITS.MAX_DIMENSION}.`
        : `Element height must be a non-negative number <= ${DOMAIN_LIMITS.MAX_DIMENSION}.`,
    });
  }

  if (
    !requiresPositiveBoth &&
    typeof width === 'number' &&
    typeof height === 'number' &&
    width === 0 &&
    height === 0
  ) {
    issues.push({
      path: joinPath(path, 'width'),
      code: 'INVALID_DIMENSION',
      message: 'Path and connector elements may have zero size in at most one axis.',
    });
  }

  const rotation = value.rotation;
  if (
    typeof rotation !== 'number' ||
    !Number.isFinite(rotation) ||
    Math.abs(rotation) > DOMAIN_LIMITS.MAX_COORDINATE_ABS
  ) {
    issues.push({
      path: joinPath(path, 'rotation'),
      code: 'INVALID_ROTATION',
      message: 'Element rotation must be a finite number.',
    });
  } else if (typedKind === 'container' && rotation !== 0) {
    issues.push({
      path: joinPath(path, 'rotation'),
      code: 'CONTAINER_ROTATION_FORBIDDEN',
      message: 'Container elements must have rotation 0.',
    });
  }

  validateStyle(value.style, joinPath(path, 'style'), ancestors, issues, false);

  for (const textKey of ['label', 'description', 'text', 'author'] as const) {
    if (Object.prototype.hasOwnProperty.call(value, textKey) && value[textKey] !== undefined) {
      const strVal = value[textKey];
      if (typeof strVal !== 'string') {
        issues.push({
          path: joinPath(path, textKey),
          code: 'INVALID_TEXT',
          message: `Element ${textKey} must be a string.`,
        });
      } else if (strVal.length > DOMAIN_LIMITS.MAX_TEXT_LENGTH) {
        issues.push({
          path: joinPath(path, textKey),
          code: 'TEXT_TOO_LONG',
          message: `Element ${textKey} exceeds maximum length of ${DOMAIN_LIMITS.MAX_TEXT_LENGTH} characters.`,
        });
      }
    }
  }

  const hasAnnotation = Object.prototype.hasOwnProperty.call(value, 'annotation') && value.annotation !== undefined;
  if (typedKind === 'annotation' && !hasAnnotation) {
    issues.push({ path: joinPath(path, 'annotation'), code: 'MISSING_ANNOTATION', message: 'Annotation elements must contain structured annotation content.' });
  }
  if (hasAnnotation) {
    if (typedKind !== null && typedKind !== 'annotation') {
      issues.push({ path: joinPath(path, 'annotation'), code: 'FORBIDDEN_ELEMENT_FIELD', message: 'Property "annotation" is only allowed on annotation elements.' });
    } else if (validateAnnotationDocument(value.annotation, joinPath(path, 'annotation'), ancestors, issues)) {
      const fallback = annotationPlainText(value.annotation as import('./types').AnnotationDocument);
      if (value.text !== fallback) {
        issues.push({ path: joinPath(path, 'text'), code: 'ANNOTATION_TEXT_MISMATCH', message: 'Annotation text must equal the plain-text fallback derived from annotation content.' });
      }
    }
  }

  if (Object.prototype.hasOwnProperty.call(value, 'author') && value.author !== undefined && typedKind !== null && typedKind !== 'sticky-note') {
    issues.push({ path: joinPath(path, 'author'), code: 'FORBIDDEN_ELEMENT_FIELD', message: 'Property "author" is only allowed on sticky-note elements.' });
  }

  // Kind-specific field rules:
  // points: only allowed on path and connector; required on connector (at least 2 points)
  const hasPoints = Object.prototype.hasOwnProperty.call(value, 'points') && value.points !== undefined;
  if (typedKind === 'connector' && !hasPoints) {
    issues.push({
      path: joinPath(path, 'points'),
      code: 'MISSING_CONNECTOR_POINTS',
      message: 'Connector elements must define at least two points.',
    });
  }
  if (hasPoints) {
    if (typedKind !== null && typedKind !== 'path' && typedKind !== 'connector') {
      issues.push({
        path: joinPath(path, 'points'),
        code: 'FORBIDDEN_ELEMENT_FIELD',
        message: 'Property "points" is only allowed on path and connector elements.',
      });
    } else if (!Array.isArray(value.points)) {
      issues.push({
        path: joinPath(path, 'points'),
        code: 'INVALID_POINTS',
        message: 'Element points must be an array.',
      });
    } else {
      if (ancestors.has(value.points)) {
        issues.push({
          path: joinPath(path, 'points'),
          code: 'CYCLIC_OBJECT',
          message: 'Cyclic reference in element points.',
        });
      } else {
        ancestors.add(value.points);
        if (value.points.length < 2) {
          issues.push({
            path: joinPath(path, 'points'),
            code: 'TOO_FEW_POINTS',
            message: 'Element points must contain at least 2 points.',
          });
        } else if (value.points.length > DOMAIN_LIMITS.MAX_POINTS_PER_ELEMENT) {
          issues.push({
            path: joinPath(path, 'points'),
            code: 'TOO_MANY_POINTS',
            message: `Element points count exceeds maximum of ${DOMAIN_LIMITS.MAX_POINTS_PER_ELEMENT}.`,
          });
        }
        const limit = Math.min(value.points.length, DOMAIN_LIMITS.MAX_POINTS_PER_ELEMENT);
        for (let i = 0; i < limit; i += 1) {
          validatePoint(
            value.points[i],
            joinPath(joinPath(path, 'points'), i),
            ancestors,
            issues,
          );
        }
        ancestors.delete(value.points);
      }
    }
  }

  // assetId: only allowed on image, required on image
  const hasAssetId = Object.prototype.hasOwnProperty.call(value, 'assetId') && value.assetId !== undefined;
  if (typedKind === 'image' && !hasAssetId) {
    issues.push({
      path: joinPath(path, 'assetId'),
      code: 'MISSING_ASSET_ID',
      message: 'Image elements must specify an assetId.',
    });
  }
  if (hasAssetId) {
    if (typedKind !== null && typedKind !== 'image') {
      issues.push({
        path: joinPath(path, 'assetId'),
        code: 'FORBIDDEN_ELEMENT_FIELD',
        message: 'Property "assetId" is only allowed on image elements.',
      });
    } else {
      validateIdField(value.assetId, joinPath(path, 'assetId'), issues);
    }
  }

  // componentType: only allowed on component, required on component
  const hasComponentType =
    Object.prototype.hasOwnProperty.call(value, 'componentType') &&
    value.componentType !== undefined;
  if (typedKind === 'component' && !hasComponentType) {
    issues.push({
      path: joinPath(path, 'componentType'),
      code: 'MISSING_COMPONENT_TYPE',
      message: 'Component elements must specify a componentType.',
    });
  }
  if (hasComponentType) {
    if (typedKind !== null && typedKind !== 'component') {
      issues.push({
        path: joinPath(path, 'componentType'),
        code: 'FORBIDDEN_ELEMENT_FIELD',
        message: 'Property "componentType" is only allowed on component elements.',
      });
    } else {
      validateIdField(value.componentType, joinPath(path, 'componentType'), issues);
    }
  }

  // from / to: only allowed on connector
  for (const endKey of ['from', 'to'] as const) {
    if (Object.prototype.hasOwnProperty.call(value, endKey) && value[endKey] !== undefined) {
      if (typedKind !== null && typedKind !== 'connector') {
        issues.push({
          path: joinPath(path, endKey),
          code: 'FORBIDDEN_ELEMENT_FIELD',
          message: `Property "${endKey}" is only allowed on connector elements.`,
        });
      } else {
        validateEndpoint(value[endKey], joinPath(path, endKey), ancestors, issues);
      }
    }
  }

  if (Object.prototype.hasOwnProperty.call(value, 'connectorRouting') && value.connectorRouting !== undefined) {
    if (typedKind !== null && typedKind !== 'connector') {
      issues.push({ path: joinPath(path, 'connectorRouting'), code: 'FORBIDDEN_ELEMENT_FIELD', message: 'Property "connectorRouting" is only allowed on connector elements.' });
    } else if (typeof value.connectorRouting !== 'string' || !CONNECTOR_ROUTINGS.has(value.connectorRouting as ConnectorRouting)) {
      issues.push({ path: joinPath(path, 'connectorRouting'), code: 'INVALID_CONNECTOR_ROUTING', message: 'Connector routing must be "straight", "elbowed", or "curved".' });
    }
  }

  for (const markerKey of ['startMarker', 'endMarker'] as const) {
    if (!Object.prototype.hasOwnProperty.call(value, markerKey) || value[markerKey] === undefined) continue;
    if (typedKind !== null && typedKind !== 'connector') {
      issues.push({ path: joinPath(path, markerKey), code: 'FORBIDDEN_ELEMENT_FIELD', message: `Property "${markerKey}" is only allowed on connector elements.` });
    } else if (typeof value[markerKey] !== 'string' || !CONNECTOR_MARKERS.has(value[markerKey] as ConnectorMarker)) {
      issues.push({ path: joinPath(path, markerKey), code: 'INVALID_CONNECTOR_MARKER', message: `Connector ${markerKey} has an unsupported marker.` });
    }
  }

  if (Object.prototype.hasOwnProperty.call(value, 'parentId') && value.parentId !== undefined) {
    validateIdField(value.parentId, joinPath(path, 'parentId'), issues);
  }

  if (Object.prototype.hasOwnProperty.call(value, 'metadata') && value.metadata !== undefined) {
    validateStringMetadata(value.metadata, joinPath(path, 'metadata'), ancestors, issues);
  }

  if (
    Object.prototype.hasOwnProperty.call(value, 'documentationUrl') &&
    value.documentationUrl !== undefined
  ) {
    validateDocumentationUrl(value.documentationUrl, joinPath(path, 'documentationUrl'), issues);
  }

  ancestors.delete(value);
  return true;
}

function isSafeIconSvg(svg: string): boolean {
  if (svg.length > DOMAIN_LIMITS.MAX_TEXT_LENGTH) return false;
  const lower = svg.toLowerCase();
  if (
    lower.includes('<script') ||
    lower.includes('javascript:') ||
    lower.includes('data:text/html') ||
    /\bon[a-z]+\s*=/.test(lower)
  ) {
    return false;
  }
  return true;
}

export function validateComponentSet(
  value: unknown,
  path: string,
  ancestors: Set<object>,
  seenSetIds: Set<string>,
  seenComponentTypes: Set<string>,
  issues: ValidationIssue[],
): value is ComponentSet {
  if (!isPlainRecord(value)) {
    issues.push({
      path,
      code: 'INVALID_COMPONENT_SET',
      message: 'ComponentSet must be a plain object.',
    });
    return false;
  }
  if (ancestors.has(value)) {
    issues.push({
      path,
      code: 'CYCLIC_OBJECT',
      message: 'Cyclic reference in ComponentSet.',
    });
    return false;
  }
  ancestors.add(value);
  checkObjectKeys(value, path, COMPONENT_SET_KEYS, issues);

  const idPath = joinPath(path, 'id');
  if (validateIdField(value.id, idPath, issues)) {
    if (seenSetIds.has(value.id)) {
      issues.push({
        path: idPath,
        code: 'DUPLICATE_COMPONENT_SET_ID',
        message: `Duplicate ComponentSet id "${value.id}".`,
      });
    } else {
      seenSetIds.add(value.id);
    }
  }

  if (
    typeof value.name !== 'string' ||
    value.name.length === 0 ||
    value.name.length > DOMAIN_LIMITS.MAX_TEXT_LENGTH
  ) {
    issues.push({
      path: joinPath(path, 'name'),
      code: 'INVALID_COMPONENT_SET_NAME',
      message: 'ComponentSet name must be a non-empty string within text limits.',
    });
  }

  if (
    typeof value.version !== 'string' ||
    value.version.length === 0 ||
    value.version.length > DOMAIN_LIMITS.MAX_ID_LENGTH
  ) {
    issues.push({
      path: joinPath(path, 'version'),
      code: 'INVALID_COMPONENT_SET_VERSION',
      message: 'ComponentSet version must be a non-empty string.',
    });
  }

  const compsPath = joinPath(path, 'components');
  if (!Array.isArray(value.components)) {
    issues.push({
      path: compsPath,
      code: 'INVALID_COMPONENTS',
      message: 'ComponentSet components must be an array.',
    });
  } else if (ancestors.has(value.components)) {
    issues.push({
      path: compsPath,
      code: 'CYCLIC_OBJECT',
      message: 'Cyclic reference in ComponentSet components.',
    });
  } else {
    ancestors.add(value.components);
    for (let i = 0; i < value.components.length; i += 1) {
      const comp = value.components[i];
      const compPath = joinPath(compsPath, i);
      if (!isPlainRecord(comp)) {
        issues.push({
          path: compPath,
          code: 'INVALID_COMPONENT_DEFINITION',
          message: 'ComponentDefinition must be a plain object.',
        });
        continue;
      }
      if (ancestors.has(comp)) {
        issues.push({
          path: compPath,
          code: 'CYCLIC_OBJECT',
          message: 'Cyclic reference in ComponentDefinition.',
        });
        continue;
      }
      ancestors.add(comp);
      checkObjectKeys(comp, compPath, COMPONENT_DEF_KEYS, issues);

      const typePath = joinPath(compPath, 'type');
      if (validateIdField(comp.type, typePath, issues)) {
        if (seenComponentTypes.has(comp.type)) {
          issues.push({
            path: typePath,
            code: 'DUPLICATE_COMPONENT_TYPE',
            message: `Duplicate component type "${comp.type}".`,
          });
        } else {
          seenComponentTypes.add(comp.type);
        }
      }

      if (
        typeof comp.name !== 'string' ||
        comp.name.length === 0 ||
        comp.name.length > DOMAIN_LIMITS.MAX_TEXT_LENGTH
      ) {
        issues.push({
          path: joinPath(compPath, 'name'),
          code: 'INVALID_COMPONENT_NAME',
          message: 'ComponentDefinition name must be a non-empty string.',
        });
      }

      if (
        typeof comp.provider !== 'string' ||
        !COMPONENT_PROVIDERS.has(comp.provider as ComponentDefinition['provider'])
      ) {
        issues.push({
          path: joinPath(compPath, 'provider'),
          code: 'INVALID_COMPONENT_PROVIDER',
          message: 'ComponentDefinition provider must be aws, azure, gcp, kubernetes, generic, or custom.',
        });
      }

      if (
        typeof comp.category !== 'string' ||
        comp.category.length === 0 ||
        comp.category.length > DOMAIN_LIMITS.MAX_TEXT_LENGTH
      ) {
        issues.push({
          path: joinPath(compPath, 'category'),
          code: 'INVALID_COMPONENT_CATEGORY',
          message: 'ComponentDefinition category must be a non-empty string.',
        });
      }

      for (const dimKey of ['defaultWidth', 'defaultHeight'] as const) {
        const dim = comp[dimKey];
        if (
          typeof dim !== 'number' ||
          !Number.isFinite(dim) ||
          dim <= 0 ||
          dim > DOMAIN_LIMITS.MAX_DIMENSION
        ) {
          issues.push({
            path: joinPath(compPath, dimKey),
            code: 'INVALID_DIMENSION',
            message: `ComponentDefinition ${dimKey} must be a positive finite number <= ${DOMAIN_LIMITS.MAX_DIMENSION}.`,
          });
        }
      }

      validateStyle(comp.style, joinPath(compPath, 'style'), ancestors, issues, true);

      if (Object.prototype.hasOwnProperty.call(comp, 'aliases') && comp.aliases !== undefined) {
        const aliasesPath = joinPath(compPath, 'aliases');
        if (!Array.isArray(comp.aliases)) {
          issues.push({
            path: aliasesPath,
            code: 'INVALID_ALIASES',
            message: 'ComponentDefinition aliases must be an array of strings.',
          });
        } else {
          for (let aIdx = 0; aIdx < comp.aliases.length; aIdx += 1) {
            validateIdField(comp.aliases[aIdx], joinPath(aliasesPath, aIdx), issues);
          }
        }
      }

      if (Object.prototype.hasOwnProperty.call(comp, 'metadata') && comp.metadata !== undefined) {
        validateStringMetadata(comp.metadata, joinPath(compPath, 'metadata'), ancestors, issues);
      }

      if (
        Object.prototype.hasOwnProperty.call(comp, 'documentationUrl') &&
        comp.documentationUrl !== undefined
      ) {
        validateDocumentationUrl(
          comp.documentationUrl,
          joinPath(compPath, 'documentationUrl'),
          issues,
        );
      }

      if (Object.prototype.hasOwnProperty.call(comp, 'iconSvg') && comp.iconSvg !== undefined) {
        if (typeof comp.iconSvg !== 'string' || !isSafeIconSvg(comp.iconSvg)) {
          issues.push({
            path: joinPath(compPath, 'iconSvg'),
            code: 'UNSAFE_ICON_SVG',
            message: 'ComponentDefinition iconSvg must be a safe SVG string without scripts or event handlers.',
          });
        }
      }

      if (Object.prototype.hasOwnProperty.call(comp, 'widgets') && comp.widgets !== undefined) {
        const widgetsPath = joinPath(compPath, 'widgets');
        if (!Array.isArray(comp.widgets)) {
          issues.push({
            path: widgetsPath,
            code: 'INVALID_WIDGETS',
            message: 'ComponentDefinition widgets must be an array.',
          });
        } else {
          for (let wIdx = 0; wIdx < comp.widgets.length; wIdx += 1) {
            const widget = comp.widgets[wIdx];
            const wPath = joinPath(widgetsPath, wIdx);
            if (!isPlainRecord(widget)) {
              issues.push({
                path: wPath,
                code: 'INVALID_WIDGET',
                message: 'Widget must be a plain object.',
              });
              continue;
            }
            checkObjectKeys(widget, wPath, WIDGET_KEYS, issues);
            validateIdField(widget.key, joinPath(wPath, 'key'), issues);
            if (
              typeof widget.label !== 'string' ||
              widget.label.length === 0 ||
              widget.label.length > DOMAIN_LIMITS.MAX_TEXT_LENGTH
            ) {
              issues.push({
                path: joinPath(wPath, 'label'),
                code: 'INVALID_WIDGET_LABEL',
                message: 'Widget label must be a non-empty string.',
              });
            }
            if (
              typeof widget.kind !== 'string' ||
              !WIDGET_KINDS.has(widget.kind as 'text' | 'number' | 'select')
            ) {
              issues.push({
                path: joinPath(wPath, 'kind'),
                code: 'INVALID_WIDGET_KIND',
                message: 'Widget kind must be "text", "number", or "select".',
              });
            }
            if (
              Object.prototype.hasOwnProperty.call(widget, 'options') &&
              widget.options !== undefined
            ) {
              if (
                !Array.isArray(widget.options) ||
                !widget.options.every(
                  (opt) => typeof opt === 'string' && opt.length <= DOMAIN_LIMITS.MAX_TEXT_LENGTH,
                )
              ) {
                issues.push({
                  path: joinPath(wPath, 'options'),
                  code: 'INVALID_WIDGET_OPTIONS',
                  message: 'Widget options must be an array of strings.',
                });
              }
            }
          }
        }
      }

      ancestors.delete(comp);
    }
    ancestors.delete(value.components);
  }

  ancestors.delete(value);
  return true;
}

function canonicalizeValue(value: unknown): unknown {
  if (typeof value === 'number') {
    return normalizeZero(value);
  }
  if (
    value === null ||
    typeof value === 'string' ||
    typeof value === 'boolean' ||
    typeof value === 'undefined'
  ) {
    return value;
  }
  if (Array.isArray(value)) {
    return value.map(canonicalizeValue);
  }
  if (typeof value === 'object') {
    const record = value as Record<string, unknown>;
    const sortedKeys = Object.keys(record).sort();
    const out: Record<string, unknown> = {};
    for (const key of sortedKeys) {
      const entry = record[key];
      if (entry !== undefined) {
        out[key] = canonicalizeValue(entry);
      }
    }
    return out;
  }
  return value;
}

function formatCanonicalDocument(validated: SketchDocument): string {
  const canonical = canonicalizeValue(validated);
  const serialized = `${JSON.stringify(canonical, null, 2)}\n`;
  if (serialized.length > DOMAIN_LIMITS.MAX_DOCUMENT_JSON_BYTES) {
    const byteLength = utf8ByteLength(serialized);
    throw new DomainValidationError([
      {
        path: '',
        code: 'DOCUMENT_JSON_TOO_LARGE',
        message: `Serialized document size (${byteLength} bytes) exceeds limit of ${DOMAIN_LIMITS.MAX_DOCUMENT_JSON_BYTES} bytes.`,
      },
    ]);
  }
  if (serialized.length * 3 > DOMAIN_LIMITS.MAX_DOCUMENT_JSON_BYTES) {
    const byteLength = utf8ByteLength(serialized);
    if (byteLength > DOMAIN_LIMITS.MAX_DOCUMENT_JSON_BYTES) {
      throw new DomainValidationError([
        {
          path: '',
          code: 'DOCUMENT_JSON_TOO_LARGE',
          message: `Serialized document size (${byteLength} bytes) exceeds limit of ${DOMAIN_LIMITS.MAX_DOCUMENT_JSON_BYTES} bytes.`,
        },
      ]);
    }
  }
  return serialized;
}

export function validateAndSerializeDocument(input: unknown): {
  document: SketchDocument;
  serialized: string;
} {
  const issues: ValidationIssue[] = [];
  const ancestors = new Set<object>();

  if (!isPlainRecord(input)) {
    throw new DomainValidationError([
      { path: '', code: 'INVALID_DOCUMENT', message: 'Document must be a plain object.' },
    ]);
  }

  ancestors.add(input);
  checkObjectKeys(input, '', DOCUMENT_KEYS, issues);

  if (input.schemaVersion !== 1) {
    issues.push({
      path: 'schemaVersion',
      code: 'UNSUPPORTED_SCHEMA_VERSION',
      message: 'Document schemaVersion must be 1.',
    });
  }

  validateIdField(input.id, 'id', issues);

  if (typeof input.title !== 'string') {
    issues.push({
      path: 'title',
      code: 'INVALID_TITLE',
      message: 'Document title must be a string.',
    });
  } else if (input.title.length > DOMAIN_LIMITS.MAX_TEXT_LENGTH) {
    issues.push({
      path: 'title',
      code: 'TEXT_TOO_LONG',
      message: `Document title exceeds maximum length of ${DOMAIN_LIMITS.MAX_TEXT_LENGTH} characters.`,
    });
  }

  validateStringMetadata(input.metadata, 'metadata', ancestors, issues);

  // Validate assets
  const assetIds = new Set<string>();
  let totalAssetBytes = 0;
  if (!isPlainRecord(input.assets)) {
    issues.push({
      path: 'assets',
      code: 'INVALID_ASSETS',
      message: 'Document assets must be a plain object.',
    });
  } else if (ancestors.has(input.assets)) {
    issues.push({
      path: 'assets',
      code: 'CYCLIC_OBJECT',
      message: 'Cyclic reference in document assets.',
    });
  } else {
    ancestors.add(input.assets);
    checkObjectKeys(input.assets, 'assets', null, issues);
    for (const key of Object.getOwnPropertyNames(input.assets)) {
      if (FORBIDDEN_KEYS.has(key)) continue;
      const assetPath = joinPath('assets', key);
      validateIdField(key, assetPath, issues);
      const bytes = validateAsset(input.assets[key], key, assetPath, ancestors, issues);
      totalAssetBytes += bytes;
      assetIds.add(key);
    }
    if (totalAssetBytes > DOMAIN_LIMITS.MAX_TOTAL_ASSET_BYTES) {
      issues.push({
        path: 'assets',
        code: 'TOTAL_ASSETS_TOO_LARGE',
        message: `Total decoded asset bytes (${totalAssetBytes}) exceed maximum of ${DOMAIN_LIMITS.MAX_TOTAL_ASSET_BYTES} bytes.`,
      });
    }
    ancestors.delete(input.assets);
  }

  // Validate componentSets
  const seenSetIds = new Set<string>();
  const seenComponentTypes = new Set<string>();
  if (!Array.isArray(input.componentSets)) {
    issues.push({
      path: 'componentSets',
      code: 'INVALID_COMPONENT_SETS',
      message: 'Document componentSets must be an array.',
    });
  } else if (ancestors.has(input.componentSets)) {
    issues.push({
      path: 'componentSets',
      code: 'CYCLIC_OBJECT',
      message: 'Cyclic reference in document componentSets.',
    });
  } else {
    ancestors.add(input.componentSets);
    for (let i = 0; i < input.componentSets.length; i += 1) {
      validateComponentSet(
        input.componentSets[i],
        joinPath('componentSets', i),
        ancestors,
        seenSetIds,
        seenComponentTypes,
        issues,
      );
    }
    ancestors.delete(input.componentSets);
  }

  // Validate elements and graph invariants
  if (!Array.isArray(input.elements)) {
    issues.push({
      path: 'elements',
      code: 'INVALID_ELEMENTS',
      message: 'Document elements must be an array.',
    });
  } else if (ancestors.has(input.elements)) {
    issues.push({
      path: 'elements',
      code: 'CYCLIC_OBJECT',
      message: 'Cyclic reference in document elements.',
    });
  } else {
    ancestors.add(input.elements);
    if (input.elements.length > DOMAIN_LIMITS.MAX_ELEMENTS) {
      issues.push({
        path: 'elements',
        code: 'TOO_MANY_ELEMENTS',
        message: `Element count (${input.elements.length}) exceeds maximum of ${DOMAIN_LIMITS.MAX_ELEMENTS}.`,
      });
    }

    const elementById = new Map<string, { element: SketchElement; index: number }>();
    const limit = Math.min(input.elements.length, DOMAIN_LIMITS.MAX_ELEMENTS);

    for (let i = 0; i < limit; i += 1) {
      const el = input.elements[i];
      const elPath = joinPath('elements', i);
      if (validateElementIntrinsic(el, elPath, ancestors, issues)) {
        if (typeof el.id === 'string' && el.id.length > 0) {
          if (elementById.has(el.id)) {
            issues.push({
              path: joinPath(elPath, 'id'),
              code: 'DUPLICATE_ELEMENT_ID',
              message: `Duplicate element id "${el.id}".`,
            });
          } else {
            elementById.set(el.id, { element: el, index: i });
          }
        }
      }
    }

    // Cross-element reference checks (parentId, from, to, assetId, componentType)
    for (const [id, { element: el, index }] of elementById.entries()) {
      const elPath = joinPath('elements', index);

      if (el.kind === 'image' && typeof el.assetId === 'string') {
        if (!assetIds.has(el.assetId)) {
          issues.push({
            path: joinPath(elPath, 'assetId'),
            code: 'MISSING_ASSET_REFERENCE',
            message: `Image element "${id}" references non-existent asset "${el.assetId}".`,
          });
        }
      }

      if (el.kind === 'component' && typeof el.componentType === 'string') {
        if (!seenComponentTypes.has(el.componentType)) {
          issues.push({
            path: joinPath(elPath, 'componentType'),
            code: 'MISSING_COMPONENT_REFERENCE',
            message: `Component element "${id}" references unknown componentType "${el.componentType}".`,
          });
        }
      }

      if (el.kind === 'connector') {
        for (const endKey of ['from', 'to'] as const) {
          const endpoint = el[endKey];
          if (isPlainRecord(endpoint) && typeof endpoint.elementId === 'string') {
            if (endpoint.elementId === id) {
              issues.push({
                path: joinPath(joinPath(elPath, endKey), 'elementId'),
                code: 'SELF_CONNECTOR_REFERENCE',
                message: `Connector "${id}" cannot bind "${endKey}" to itself.`,
              });
            } else if (!elementById.has(endpoint.elementId)) {
              issues.push({
                path: joinPath(joinPath(elPath, endKey), 'elementId'),
                code: 'DANGLING_CONNECTOR_REFERENCE',
                message: `Connector "${id}" ${endKey} references missing element "${endpoint.elementId}".`,
              });
            }
          }
        }
      }

      if (typeof el.parentId === 'string') {
        const parentEntry = elementById.get(el.parentId);
        if (!parentEntry) {
          issues.push({
            path: joinPath(elPath, 'parentId'),
            code: 'MISSING_PARENT_CONTAINER',
            message: `Element "${id}" references missing parent container "${el.parentId}".`,
          });
        } else if (parentEntry.element.kind !== 'container') {
          issues.push({
            path: joinPath(elPath, 'parentId'),
            code: 'INVALID_PARENT_KIND',
            message: `Parent "${el.parentId}" of element "${id}" must be a container.`,
          });
        } else {
          const visited = new Set<string>([id]);
          let currentId: string | undefined = el.parentId;
          let depth = 0;
          while (currentId !== undefined) {
            if (visited.has(currentId)) {
              issues.push({
                path: joinPath(elPath, 'parentId'),
                code: 'CONTAINER_CYCLE',
                message: `Cyclic container hierarchy detected involving "${id}".`,
              });
              break;
            }
            depth += 1;
            if (depth > DOMAIN_LIMITS.MAX_CONTAINER_DEPTH) {
              issues.push({
                path: joinPath(elPath, 'parentId'),
                code: 'CONTAINER_DEPTH_EXCEEDED',
                message: `Container hierarchy depth exceeds maximum of ${DOMAIN_LIMITS.MAX_CONTAINER_DEPTH}.`,
              });
              break;
            }
            visited.add(currentId);
            const nextParent = elementById.get(currentId);
            if (!nextParent || nextParent.element.kind !== 'container') {
              break;
            }
            currentId = nextParent.element.parentId;
          }
        }
      }
    }

    ancestors.delete(input.elements);
  }

  ancestors.delete(input);

  if (issues.length > 0) {
    throw new DomainValidationError(issues);
  }

  const cloned = cloneDocument(input as unknown as SketchDocument);
  const serialized = formatCanonicalDocument(cloned);
  return { document: cloned, serialized };
}

export function validateDocument(input: unknown): SketchDocument {
  return validateAndSerializeDocument(input).document;
}

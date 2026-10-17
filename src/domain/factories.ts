import { DomainValidationError } from './errors';
import { cloneElement, normalizeZero } from './geometry';
import { DEFAULT_CONNECTOR_ROUTING, DEFAULT_END_MARKER, DEFAULT_START_MARKER } from './connectors';
import type { ElementKind, ElementStyle, SketchDocument, SketchElement, ValidationIssue } from './types';
import {
  ELEMENT_KEYS,
  ELEMENT_KINDS,
  FORBIDDEN_KEYS,
  isPlainRecord,
  joinPath,
  STYLE_KEYS,
  validateDocument,
  validateElementIntrinsic,
} from './validation';

let fallbackCounter = 0;

function generateUniqueId(prefix: string): string {
  if (typeof globalThis.crypto !== 'undefined' && typeof globalThis.crypto.randomUUID === 'function') {
    return `${prefix}:${globalThis.crypto.randomUUID()}`;
  }
  fallbackCounter += 1;
  const randomPart = Math.random().toString(36).slice(2, 10);
  return `${prefix}:${Date.now().toString(36)}-${fallbackCounter}-${randomPart}`;
}

function createDefaultStyle(kind: ElementKind): ElementStyle {
  const sticky = kind === 'sticky-note';
  return {
    stroke: sticky ? '#53675a' : '#1e293b',
    fill:
      kind === 'container'
        ? '#f8fafc'
        : sticky
          ? '#aeeebd'
        : kind === 'text' || kind === 'path' || kind === 'connector'
          ? 'transparent'
          : '#ffffff',
    strokeWidth: sticky ? 0 : 2,
    opacity: 1,
    fontSize: sticky ? 20 : 16,
    textAlign: 'left',
    strokeDash: 'solid',
    fontFamily: 'sans',
    ...(sticky ? { fontWeight: 'normal' as const, textDecoration: 'none' as const, listStyle: 'none' as const } : {}),
  };
}

export function createDocument(title = 'Untitled'): SketchDocument {
  const doc: SketchDocument = {
    schemaVersion: 1,
    id: generateUniqueId('document'),
    title,
    elements: [],
    assets: {},
    componentSets: [],
    metadata: {},
  };
  return validateDocument(doc);
}

export function createElement(
  kind: ElementKind,
  overrides?: Partial<SketchElement>,
): SketchElement {
  if (typeof kind !== 'string' || !ELEMENT_KINDS.has(kind)) {
    throw new DomainValidationError([
      {
        path: 'kind',
        code: 'INVALID_ELEMENT_KIND',
        message: `Unsupported element kind "${String(kind)}".`,
      },
    ]);
  }

  const issues: ValidationIssue[] = [];
  if (overrides !== undefined) {
    if (!isPlainRecord(overrides)) {
      throw new DomainValidationError([
        {
          path: 'overrides',
          code: 'INVALID_OVERRIDES',
          message: 'Element overrides must be a plain object.',
        },
      ]);
    }
    for (const key of Object.getOwnPropertyNames(overrides)) {
      if (FORBIDDEN_KEYS.has(key)) {
        issues.push({
          path: joinPath('overrides', key),
          code: 'FORBIDDEN_KEY',
          message: `Forbidden property key "${key}".`,
        });
      } else if (!ELEMENT_KEYS.has(key)) {
        issues.push({
          path: joinPath('overrides', key),
          code: 'UNKNOWN_FIELD',
          message: `Unknown element override property "${key}".`,
        });
      }
    }
    if (overrides.kind !== undefined && overrides.kind !== kind) {
      issues.push({
        path: 'overrides.kind',
        code: 'KIND_MISMATCH',
        message: `Override kind "${String(overrides.kind)}" does not match requested kind "${kind}".`,
      });
    }
    if (overrides.style !== undefined) {
      if (!isPlainRecord(overrides.style)) {
        issues.push({
          path: 'overrides.style',
          code: 'INVALID_STYLE',
          message: 'Element style override must be a plain object.',
        });
      } else {
        for (const sKey of Object.getOwnPropertyNames(overrides.style)) {
          if (FORBIDDEN_KEYS.has(sKey)) {
            issues.push({
              path: joinPath('overrides.style', sKey),
              code: 'FORBIDDEN_KEY',
              message: `Forbidden style key "${sKey}".`,
            });
          } else if (!STYLE_KEYS.has(sKey)) {
            issues.push({
              path: joinPath('overrides.style', sKey),
              code: 'UNKNOWN_FIELD',
              message: `Unknown style property "${sKey}".`,
            });
          }
        }
      }
    }
    if (issues.length > 0) {
      throw new DomainValidationError(issues);
    }
  }

  const defaultWidth = kind === 'container' ? 320 : kind === 'sticky-note' ? 240 : kind === 'text' ? 160 : 120;
  const defaultHeight = kind === 'container' ? 200 : kind === 'sticky-note' ? 240 : kind === 'text' ? 32 : 80;

  const width = overrides?.width !== undefined ? overrides.width : defaultWidth;
  const height = overrides?.height !== undefined ? overrides.height : defaultHeight;

  const baseStyle = createDefaultStyle(kind);
  const mergedStyle: ElementStyle = isPlainRecord(overrides?.style)
    ? {
        stroke:
          overrides.style.stroke !== undefined ? overrides.style.stroke : baseStyle.stroke,
        fill: overrides.style.fill !== undefined ? overrides.style.fill : baseStyle.fill,
        strokeWidth:
          overrides.style.strokeWidth !== undefined
            ? overrides.style.strokeWidth
            : baseStyle.strokeWidth,
        opacity:
          overrides.style.opacity !== undefined ? overrides.style.opacity : baseStyle.opacity,
        fontSize:
          overrides.style.fontSize !== undefined ? overrides.style.fontSize : baseStyle.fontSize,
        textAlign:
          overrides.style.textAlign !== undefined
            ? overrides.style.textAlign
            : baseStyle.textAlign,
        strokeDash:
          overrides.style.strokeDash !== undefined
            ? overrides.style.strokeDash
            : baseStyle.strokeDash,
        ...(overrides.style.fontFamily !== undefined
          ? { fontFamily: overrides.style.fontFamily }
          : baseStyle.fontFamily !== undefined
            ? { fontFamily: baseStyle.fontFamily }
            : {}),
        ...(overrides.style.fontWeight !== undefined
          ? { fontWeight: overrides.style.fontWeight }
          : baseStyle.fontWeight !== undefined ? { fontWeight: baseStyle.fontWeight } : {}),
        ...(overrides.style.textDecoration !== undefined
          ? { textDecoration: overrides.style.textDecoration }
          : baseStyle.textDecoration !== undefined ? { textDecoration: baseStyle.textDecoration } : {}),
        ...(overrides.style.listStyle !== undefined
          ? { listStyle: overrides.style.listStyle }
          : baseStyle.listStyle !== undefined ? { listStyle: baseStyle.listStyle } : {}),
      }
    : baseStyle;

  const candidate: Record<string, unknown> = {
    id: overrides?.id !== undefined ? overrides.id : generateUniqueId(kind),
    kind,
    x: overrides?.x !== undefined ? overrides.x : 0,
    y: overrides?.y !== undefined ? overrides.y : 0,
    width,
    height,
    rotation: overrides?.rotation !== undefined ? overrides.rotation : 0,
    style: mergedStyle,
  };

  if (kind === 'text' && overrides?.text === undefined) {
    candidate.text = 'Text';
  }
  if (kind === 'sticky-note') {
    if (overrides?.text === undefined) candidate.text = '';
    if (overrides?.author === undefined) candidate.author = 'Lokaler Benutzer';
  }
  if ((kind === 'connector' || kind === 'path') && overrides?.points === undefined) {
    const endX = typeof width === 'number' && Number.isFinite(width) ? normalizeZero(width) : 120;
    const endY = typeof height === 'number' && Number.isFinite(height) ? normalizeZero(height) : 80;
    candidate.points = [
      { x: 0, y: 0 },
      { x: endX === 0 && endY === 0 ? 40 : endX, y: endY },
    ];
  }
  if (kind === 'connector') {
    candidate.connectorRouting = overrides?.connectorRouting ?? DEFAULT_CONNECTOR_ROUTING;
    candidate.startMarker = overrides?.startMarker ?? DEFAULT_START_MARKER;
    candidate.endMarker = overrides?.endMarker ?? DEFAULT_END_MARKER;
  }
  if (kind === 'image' && overrides?.assetId === undefined) {
    candidate.assetId = 'asset:default';
  }
  if (kind === 'component' && overrides?.componentType === undefined) {
    candidate.componentType = 'generic.component';
  }

  if (overrides) {
    for (const optKey of [
      'label',
      'description',
      'text',
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
    ] as const) {
      if (Object.prototype.hasOwnProperty.call(overrides, optKey) && overrides[optKey] !== undefined) {
        candidate[optKey] = overrides[optKey];
      }
    }
  }

  validateElementIntrinsic(candidate, '', new Set<object>(), issues);
  if (issues.length > 0) {
    throw new DomainValidationError(issues);
  }

  return cloneElement(candidate as unknown as SketchElement);
}

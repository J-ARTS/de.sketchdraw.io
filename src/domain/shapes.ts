import type { ElementKind, ShapeVariant, SketchElement } from './types';

export const SHAPE_VARIANTS: readonly ShapeVariant[] = [
  'circle', 'square', 'diamond', 'triangle', 'triangle-down', 'rounded',
  'chevron', 'process', 'document', 'documents', 'manual-input', 'hexagon',
  'parallelogram', 'parallelogram-reverse', 'cylinder', 'tube',
  'internal-storage', 'trapezoid', 'summing', 'or', 'off-page',
  'folder', 'note', 'pentagon', 'loop-limit',
];

const CIRCLE = 'M12 4a8 8 0 1 0 0 16 8 8 0 0 0 0-16z';
/** Canonical normalized 24×24 vector outlines used by renderer and portable SVG export. */
export const SHAPE_PATHS: Readonly<Record<ShapeVariant, readonly string[]>> = {
  circle: [CIRCLE], square: ['M5 5h14v14H5z'], diamond: ['M12 3l9 9-9 9-9-9z'],
  triangle: ['M12 4l9 16H3z'], 'triangle-down': ['M3 4h18l-9 16z'],
  rounded: ['M8 5h8a3 3 0 0 1 3 3v8a3 3 0 0 1-3 3H8a3 3 0 0 1-3-3V8a3 3 0 0 1 3-3z'],
  chevron: ['M3 6h14l4 6-4 6H3l4-6z'], process: ['M3 6h18v12H3z', 'M6 6v12', 'M18 6v12'],
  document: ['M4 4h16v12c-2.7-1.3-5.3-1.3-8 0s-5.3 1.3-8 0z'],
  documents: ['M3 7h14v10c-2.3-1.1-4.7-1.1-7 0s-4.7 1.1-7 0z', 'M6 7V4h15v10h-4'],
  'manual-input': ['M4 10l16-4v13H4z'], hexagon: ['M7 5h10l4 7-4 7H7l-4-7z'],
  parallelogram: ['M7 5h14l-4 14H3z'], 'parallelogram-reverse': ['M3 5h14l4 14H7z'],
  cylinder: ['M5 6c0-1.7 3.1-3 7-3s7 1.3 7 3v12c0 1.7-3.1 3-7 3s-7-1.3-7-3z', 'M5 6c0 1.7 3.1 3 7 3s7-1.3 7-3'],
  tube: ['M6 6h12c1.7 0 3 2.7 3 6s-1.3 6-3 6H6c-1.7 0-3-2.7-3-6s1.3-6 3-6z', 'M18 6c-1.7 0-3 2.7-3 6s1.3 6 3 6'],
  'internal-storage': ['M4 5h16v14H4z', 'M8 5v14', 'M4 9h16'], trapezoid: ['M3 6h18l-4 12H7z'],
  summing: [CIRCLE, 'M6.3 6.3l11.4 11.4', 'M17.7 6.3L6.3 17.7'], or: [CIRCLE, 'M12 4v16', 'M4 12h16'],
  'off-page': ['M5 4h14v10l-7 6-7-6z'], folder: ['M3 8h18v12H3z', 'M4 8l2-3h6l2 3'],
  note: ['M5 3h10l4 4v14H5z', 'M15 3v4h4'], pentagon: ['M12 3l9 7-3.5 11h-11L3 10z'],
  'loop-limit': ['M8 4h8l4 4v12H4V8z'],
};

export const SHAPE_KINDS: ReadonlySet<ElementKind> = new Set(['rectangle', 'ellipse', 'diamond']);

export function legacyShapeVariant(kind: ElementKind): ShapeVariant | null {
  if (kind === 'ellipse') return 'circle';
  if (kind === 'rectangle') return 'square';
  if (kind === 'diamond') return 'diamond';
  return null;
}

export function effectiveShapeVariant(element: Pick<SketchElement, 'kind' | 'shapeVariant'>): ShapeVariant | null {
  return element.shapeVariant ?? legacyShapeVariant(element.kind);
}

export function shapeBaseKind(variant: ShapeVariant): 'rectangle' | 'ellipse' | 'diamond' {
  if (variant === 'circle') return 'ellipse';
  if (variant === 'diamond') return 'diamond';
  return 'rectangle';
}

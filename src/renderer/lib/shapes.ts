import type { ElementKind } from '@/domain/types';

/** Kinds the current document model can swap between (#40); further variants need #39. */
export type SwappableKind = 'ellipse' | 'rectangle' | 'diamond';
export const SWAPPABLE_KINDS: ReadonlySet<ElementKind> = new Set<ElementKind>(['ellipse', 'rectangle', 'diamond']);

export interface ShapeEntry {
  id: string;
  label: string;
  /** Extra search terms, including English names. */
  keywords: string;
  /** Domain kind the entry maps to today; null until shape variants land (#39). */
  kind: SwappableKind | null;
  /** 24×24 stroke paths for the picker icon. */
  icon: readonly string[];
}

const CIRCLE = 'M12 4a8 8 0 1 0 0 16 8 8 0 0 0 0-16z';

export const SHAPE_CATALOG: readonly ShapeEntry[] = [
  { id: 'circle', label: 'Kreis', keywords: 'circle ellipse oval rund', kind: 'ellipse', icon: [CIRCLE] },
  { id: 'square', label: 'Quadrat', keywords: 'square rectangle rechteck box', kind: 'rectangle', icon: ['M5 5h14v14H5z'] },
  { id: 'diamond', label: 'Raute', keywords: 'diamond rhombus entscheidung decision', kind: 'diamond', icon: ['M12 3l9 9-9 9-9-9z'] },
  { id: 'triangle', label: 'Dreieck', keywords: 'triangle', kind: null, icon: ['M12 4l9 16H3z'] },
  { id: 'triangle-down', label: 'Dreieck abwärts', keywords: 'triangle down merge', kind: null, icon: ['M3 4h18l-9 16z'] },
  { id: 'rounded', label: 'Abgerundetes Rechteck', keywords: 'rounded rectangle terminator', kind: null, icon: ['M8 5h8a3 3 0 0 1 3 3v8a3 3 0 0 1-3 3H8a3 3 0 0 1-3-3V8a3 3 0 0 1 3-3z'] },
  { id: 'chevron', label: 'Prozessschritt', keywords: 'chevron step pfeil', kind: null, icon: ['M3 6h14l4 6-4 6H3l4-6z'] },
  { id: 'process', label: 'Vordefinierter Prozess', keywords: 'predefined process subroutine', kind: null, icon: ['M3 6h18v12H3z', 'M6 6v12', 'M18 6v12'] },
  { id: 'document', label: 'Dokument', keywords: 'document datei', kind: null, icon: ['M4 4h16v12c-2.7-1.3-5.3-1.3-8 0s-5.3 1.3-8 0z'] },
  { id: 'documents', label: 'Mehrere Dokumente', keywords: 'multiple documents', kind: null, icon: ['M3 7h14v10c-2.3-1.1-4.7-1.1-7 0s-4.7 1.1-7 0z', 'M6 7V4h15v10h-4'] },
  { id: 'manual-input', label: 'Manuelle Eingabe', keywords: 'manual input', kind: null, icon: ['M4 10l16-4v13H4z'] },
  { id: 'hexagon', label: 'Sechseck', keywords: 'hexagon preparation', kind: null, icon: ['M7 5h10l4 7-4 7H7l-4-7z'] },
  { id: 'parallelogram', label: 'Parallelogramm', keywords: 'parallelogram data input output', kind: null, icon: ['M7 5h14l-4 14H3z'] },
  { id: 'parallelogram-reverse', label: 'Parallelogramm gespiegelt', keywords: 'parallelogram reverse', kind: null, icon: ['M3 5h14l4 14H7z'] },
  { id: 'cylinder', label: 'Zylinder', keywords: 'cylinder database datenbank', kind: null, icon: ['M5 6c0-1.7 3.1-3 7-3s7 1.3 7 3v12c0 1.7-3.1 3-7 3s-7-1.3-7-3z', 'M5 6c0 1.7 3.1 3 7 3s7-1.3 7-3'] },
  { id: 'tube', label: 'Liegender Zylinder', keywords: 'horizontal cylinder direct access storage', kind: null, icon: ['M6 6h12c1.7 0 3 2.7 3 6s-1.3 6-3 6H6c-1.7 0-3-2.7-3-6s1.3-6 3-6z', 'M18 6c-1.7 0-3 2.7-3 6s1.3 6 3 6'] },
  { id: 'internal-storage', label: 'Interner Speicher', keywords: 'internal storage window card', kind: null, icon: ['M4 5h16v14H4z', 'M8 5v14', 'M4 9h16'] },
  { id: 'trapezoid', label: 'Trapez', keywords: 'trapezoid manual operation', kind: null, icon: ['M3 6h18l-4 12H7z'] },
  { id: 'summing', label: 'Summierung', keywords: 'summing junction x', kind: null, icon: [CIRCLE, 'M6.3 6.3l11.4 11.4', 'M17.7 6.3L6.3 17.7'] },
  { id: 'or', label: 'Oder', keywords: 'or plus', kind: null, icon: [CIRCLE, 'M12 4v16', 'M4 12h16'] },
  { id: 'off-page', label: 'Seitenverbinder', keywords: 'off page connector shield', kind: null, icon: ['M5 4h14v10l-7 6-7-6z'] },
  { id: 'folder', label: 'Ordner', keywords: 'folder tab', kind: null, icon: ['M3 8h18v12H3z', 'M4 8l2-3h6l2 3'] },
  { id: 'note', label: 'Notiz', keywords: 'note page corner', kind: null, icon: ['M5 3h10l4 4v14H5z', 'M15 3v4h4'] },
  { id: 'pentagon', label: 'Fünfeck', keywords: 'pentagon', kind: null, icon: ['M12 3l9 7-3.5 11h-11L3 10z'] },
  { id: 'loop-limit', label: 'Schleifenbegrenzung', keywords: 'loop limit octagon', kind: null, icon: ['M8 4h8l4 4v12H4V8z'] },
];

export function matchesShape(entry: ShapeEntry, query: string): boolean {
  const text = query.trim().toLowerCase();
  return !text || `${entry.label} ${entry.keywords}`.toLowerCase().includes(text);
}

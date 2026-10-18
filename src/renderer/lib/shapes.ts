import { effectiveShapeVariant, SHAPE_KINDS, SHAPE_PATHS, type ShapeVariant, type SketchElement } from '@/domain';

import { L, t } from '@/renderer/i18n';
export { SHAPE_KINDS as SWAPPABLE_KINDS };

export interface ShapeEntry {
  id: ShapeVariant;
  label: string;
  /** Extra search terms, including English names. */
  keywords: string;
  /** 24×24 stroke paths for the picker icon. */
  icon: readonly string[];
}


export const SHAPE_CATALOG: readonly ShapeEntry[] = [
  { id: 'circle', label: L('Kreis'), keywords: 'circle ellipse oval rund', icon: SHAPE_PATHS['circle'] },
  { id: 'square', label: L('Quadrat'), keywords: 'square rectangle rechteck box', icon: SHAPE_PATHS['square'] },
  { id: 'diamond', label: L('Raute'), keywords: 'diamond rhombus entscheidung decision', icon: SHAPE_PATHS['diamond'] },
  { id: 'triangle', label: L('Dreieck'), keywords: 'triangle', icon: SHAPE_PATHS['triangle'] },
  { id: 'triangle-down', label: L('Dreieck abwärts'), keywords: 'triangle down merge', icon: SHAPE_PATHS['triangle-down'] },
  { id: 'rounded', label: L('Abgerundetes Rechteck'), keywords: 'rounded rectangle terminator', icon: SHAPE_PATHS['rounded'] },
  { id: 'chevron', label: L('Prozessschritt'), keywords: 'chevron step pfeil', icon: SHAPE_PATHS['chevron'] },
  { id: 'process', label: L('Vordefinierter Prozess'), keywords: 'predefined process subroutine', icon: SHAPE_PATHS['process'] },
  { id: 'document', label: L('Dokument'), keywords: t('document datei'), icon: SHAPE_PATHS['document'] },
  { id: 'documents', label: L('Mehrere Dokumente'), keywords: 'multiple documents', icon: SHAPE_PATHS['documents'] },
  { id: 'manual-input', label: L('Manuelle Eingabe'), keywords: 'manual input', icon: SHAPE_PATHS['manual-input'] },
  { id: 'hexagon', label: L('Sechseck'), keywords: 'hexagon preparation', icon: SHAPE_PATHS['hexagon'] },
  { id: 'parallelogram', label: L('Parallelogramm'), keywords: 'parallelogram data input output', icon: SHAPE_PATHS['parallelogram'] },
  { id: 'parallelogram-reverse', label: L('Parallelogramm gespiegelt'), keywords: 'parallelogram reverse', icon: SHAPE_PATHS['parallelogram-reverse'] },
  { id: 'cylinder', label: L('Zylinder'), keywords: 'cylinder database datenbank', icon: SHAPE_PATHS['cylinder'] },
  { id: 'tube', label: L('Liegender Zylinder'), keywords: 'horizontal cylinder direct access storage', icon: SHAPE_PATHS['tube'] },
  { id: 'internal-storage', label: L('Interner Speicher'), keywords: 'internal storage window card', icon: SHAPE_PATHS['internal-storage'] },
  { id: 'trapezoid', label: L('Trapez'), keywords: 'trapezoid manual operation', icon: SHAPE_PATHS['trapezoid'] },
  { id: 'summing', label: L('Summierung'), keywords: 'summing junction x', icon: SHAPE_PATHS['summing'] },
  { id: 'or', label: L('Oder'), keywords: 'or plus', icon: SHAPE_PATHS['or'] },
  { id: 'off-page', label: L('Seitenverbinder'), keywords: 'off page connector shield', icon: SHAPE_PATHS['off-page'] },
  { id: 'folder', label: L('Ordner'), keywords: 'folder tab', icon: SHAPE_PATHS['folder'] },
  { id: 'note', label: L('Notiz'), keywords: 'note page corner', icon: SHAPE_PATHS['note'] },
  { id: 'pentagon', label: L('Fünfeck'), keywords: 'pentagon', icon: SHAPE_PATHS['pentagon'] },
  { id: 'loop-limit', label: L('Schleifenbegrenzung'), keywords: 'loop limit octagon', icon: SHAPE_PATHS['loop-limit'] },
];

export function shapeEntry(id: ShapeVariant | null | undefined): ShapeEntry | undefined {
  return id ? SHAPE_CATALOG.find((entry) => entry.id === id) : undefined;
}

export function shapeEntryForElement(element: Pick<SketchElement, 'kind' | 'shapeVariant'>): ShapeEntry | undefined {
  return shapeEntry(effectiveShapeVariant(element));
}

export function matchesShape(entry: ShapeEntry, query: string): boolean {
  const text = query.trim().toLowerCase();
  return !text || `${entry.label} ${entry.keywords}`.toLowerCase().includes(text);
}

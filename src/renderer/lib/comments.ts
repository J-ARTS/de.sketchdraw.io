import { resolveAnchorWorldPoint, type CommentTarget, type Point, type SketchDocument } from '@/domain';

export function commentTargetPoint(target: CommentTarget, document: SketchDocument): Point {
  const element = target.elementId
    ? document.elements.find((entry) => entry.id === target.elementId)
    : undefined;
  return element ? resolveAnchorWorldPoint(element, target.anchor) : target.fallback;
}

export function commentTargetLabel(target: CommentTarget, document: SketchDocument): string {
  if (!target.elementId) return 'Zeichenfläche';
  const element = target.elementId
    ? document.elements.find((entry) => entry.id === target.elementId)
    : undefined;
  if (!element) return 'Gelöschtes Ziel';
  if (target.tableCellId && element.kind === 'table' && element.table) {
    const cell = element.table.cells.find((entry) => entry.id === target.tableCellId);
    if (cell) {
      const row = element.table.rows.findIndex((entry) => entry.id === cell.rowId) + 1;
      const column = element.table.columns.findIndex((entry) => entry.id === cell.columnId) + 1;
      return `Tabelle · Zelle ${row}/${column}`;
    }
    return 'Tabelle · gelöschte Zelle';
  }
  return element.label || element.text?.split(/\r?\n/)[0]?.slice(0, 50) || element.kind;
}

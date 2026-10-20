import { resolveAnchorWorldPoint, type CommentTarget, type Point, type SketchDocument } from '@/domain';

import { t } from '@/renderer/i18n';
/** The page a comment belongs to: the page of its element, else its own page, else the first page. */
export function commentPageId(target: CommentTarget, document: SketchDocument): string {
  const element = target.elementId ? document.elements.find((entry) => entry.id === target.elementId) : undefined;
  return element?.pageId ?? target.pageId ?? document.pages[0]!.id;
}

export function commentTargetPoint(target: CommentTarget, document: SketchDocument): Point {
  const element = target.elementId
    ? document.elements.find((entry) => entry.id === target.elementId)
    : undefined;
  return element ? resolveAnchorWorldPoint(element, target.anchor) : target.fallback;
}

export function commentTargetLabel(target: CommentTarget, document: SketchDocument): string {
  if (!target.elementId) return t('Zeichenfläche');
  const element = target.elementId
    ? document.elements.find((entry) => entry.id === target.elementId)
    : undefined;
  if (!element) return t('Gelöschtes Ziel');
  if (target.tableCellId && element.kind === 'table' && element.table) {
    const cell = element.table.cells.find((entry) => entry.id === target.tableCellId);
    if (cell) {
      const row = element.table.rows.findIndex((entry) => entry.id === cell.rowId) + 1;
      const column = element.table.columns.findIndex((entry) => entry.id === cell.columnId) + 1;
      return t('Tabelle · Zelle {row}/{column}', { row, column });
    }
    return t('Tabelle · gelöschte Zelle');
  }
  return element.label || element.text?.split(/\r?\n/)[0]?.slice(0, 50) || element.kind;
}

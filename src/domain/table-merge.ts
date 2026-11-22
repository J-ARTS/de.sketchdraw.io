import type { SketchElement, TableCell, TableDocument } from './types';

/**
 * Merged table cells (#197). A merge is a rectangle of cells that is drawn and edited as one cell: text and
 * format come from its top left cell, the other cells keep their content and show it again after unmerging.
 * The merges are kept in the table element's metadata as pairs of cell ids (top left, bottom right), so the
 * table model itself is untouched. Entries that no longer fit the table are ignored.
 */
export const TABLE_MERGES_KEY = 'table:merges';
const MAX_MERGES = 100;

export interface TableMerge { anchorId: string; endId: string }
export interface MergeRegion {
  /** The top left cell: its text and format stand for the whole region. */
  anchor: TableCell;
  /** The bottom right cell. */
  end: TableCell;
  row: number;
  column: number;
  rowSpan: number;
  columnSpan: number;
  cellIds: string[];
}

type Merged = Pick<SketchElement, 'metadata'>;

export function parseTableMerges(element: Merged): TableMerge[] {
  const raw = element.metadata?.[TABLE_MERGES_KEY];
  if (!raw) return [];
  return raw.split(';').slice(0, MAX_MERGES).flatMap((entry) => {
    const [anchorId, endId, rest] = entry.split('>');
    return anchorId && endId && rest === undefined ? [{ anchorId, endId }] : [];
  });
}
/** The metadata value for a list of merges; null removes the entry. */
export function formatTableMerges(merges: readonly TableMerge[]): string | null {
  return merges.length ? merges.slice(0, MAX_MERGES).map((merge) => `${merge.anchorId}>${merge.endId}`).join(';') : null;
}

interface Position { row: number; column: number }
function positions(table: TableDocument): Map<string, Position> {
  const rows = new Map(table.rows.map((row, index) => [row.id, index]));
  const columns = new Map(table.columns.map((column, index) => [column.id, index]));
  const result = new Map<string, Position>();
  for (const cell of table.cells) {
    const row = rows.get(cell.rowId);
    const column = columns.get(cell.columnId);
    if (row !== undefined && column !== undefined) result.set(cell.id, { row, column });
  }
  return result;
}
function cellAt(table: TableDocument, row: number, column: number): TableCell | undefined {
  const rowId = table.rows[row]?.id;
  const columnId = table.columns[column]?.id;
  return table.cells.find((cell) => cell.rowId === rowId && cell.columnId === columnId);
}
function regionOf(table: TableDocument, top: number, left: number, bottom: number, right: number): MergeRegion | null {
  const anchor = cellAt(table, top, left);
  const end = cellAt(table, bottom, right);
  if (!anchor || !end || (top === bottom && left === right)) return null;
  const cellIds: string[] = [];
  for (let row = top; row <= bottom; row += 1) for (let column = left; column <= right; column += 1) { const cell = cellAt(table, row, column); if (cell) cellIds.push(cell.id); }
  return { anchor, end, row: top, column: left, rowSpan: bottom - top + 1, columnSpan: right - left + 1, cellIds };
}
/** The rectangle that holds all the given cells. */
function boundingRegion(table: TableDocument, cellIds: readonly string[]): MergeRegion | null {
  const where = positions(table);
  const found = cellIds.flatMap((id) => { const position = where.get(id); return position ? [position] : []; });
  if (!found.length) return null;
  return regionOf(table, Math.min(...found.map((p) => p.row)), Math.min(...found.map((p) => p.column)), Math.max(...found.map((p) => p.row)), Math.max(...found.map((p) => p.column)));
}

/** The merges that fit the table, in their stored order; a merge that overlaps an earlier one is ignored. */
export function mergeRegions(element: Merged, table: TableDocument | undefined): MergeRegion[] {
  if (!table) return [];
  const taken = new Set<string>();
  const regions: MergeRegion[] = [];
  for (const merge of parseTableMerges(element)) {
    const region = boundingRegion(table, [merge.anchorId, merge.endId]);
    if (!region || region.cellIds.some((id) => taken.has(id))) continue;
    region.cellIds.forEach((id) => taken.add(id));
    regions.push(region);
  }
  return regions;
}

export interface MergeLayout {
  /** Region by the id of its top left cell. */
  anchors: Map<string, MergeRegion>;
  /** Cells that are part of a region without being its top left cell: they are not drawn. */
  covered: Set<string>;
}
export function mergeLayout(element: Merged, table: TableDocument | undefined): MergeLayout {
  const anchors = new Map<string, MergeRegion>();
  const covered = new Set<string>();
  for (const region of mergeRegions(element, table)) {
    anchors.set(region.anchor.id, region);
    for (const id of region.cellIds) if (id !== region.anchor.id) covered.add(id);
  }
  return { anchors, covered };
}

const toMerges = (regions: readonly MergeRegion[]): TableMerge[] => regions.map((region) => ({ anchorId: region.anchor.id, endId: region.end.id }));

/** The cells of the rectangle between two cells, grown so that it holds every merge it touches. */
export function cellRange(element: Merged, table: TableDocument, fromId: string, toId: string): string[] {
  let region = boundingRegion(table, [fromId, toId]);
  if (!region) return table.cells.some((cell) => cell.id === fromId) ? [fromId] : [];
  const merges = mergeRegions(element, table);
  for (let pass = 0; pass < merges.length + 1; pass += 1) {
    const inside = new Set(region.cellIds);
    const touched = merges.filter((merge) => merge.cellIds.some((id) => inside.has(id)) && merge.cellIds.some((id) => !inside.has(id)));
    if (!touched.length) break;
    const grown = boundingRegion(table, [...region.cellIds, ...touched.flatMap((merge) => merge.cellIds)]);
    if (!grown) break;
    region = grown;
  }
  return region.cellIds;
}

/** Merges the rectangle around the selected cells; merges inside it are absorbed. Null when there is nothing to merge. */
export function mergeCells(element: Merged, table: TableDocument, cellIds: readonly string[]): TableMerge[] | null {
  const region = boundingRegion(table, cellIds);
  if (!region) return null;
  const inside = new Set(region.cellIds);
  const kept = mergeRegions(element, table).filter((existing) => !existing.cellIds.some((id) => inside.has(id)));
  return toMerges([...kept, region]);
}
/** Removes every merge that holds one of the selected cells. Null when none does. */
export function unmergeCells(element: Merged, table: TableDocument, cellIds: readonly string[]): TableMerge[] | null {
  const selected = new Set(cellIds);
  const regions = mergeRegions(element, table);
  const kept = regions.filter((region) => !region.cellIds.some((id) => selected.has(id)));
  return kept.length === regions.length ? null : toMerges(kept);
}
export function selectionHasMerge(element: Merged, table: TableDocument | undefined, cellIds: readonly string[]): boolean {
  const selected = new Set(cellIds);
  return mergeRegions(element, table).some((region) => region.cellIds.some((id) => selected.has(id)));
}

/**
 * The merges after rows or columns were inserted, moved or deleted. A merge keeps the cells it still has; one
 * that ran over the whole width (height) of the table keeps doing so, so a merged header row also covers a
 * new column.
 */
export function adjustTableMerges(element: Merged, before: TableDocument, after: TableDocument): TableMerge[] {
  const exists = new Set(after.cells.map((cell) => cell.id));
  const where = positions(after);
  const result: MergeRegion[] = [];
  for (const region of mergeRegions(element, before)) {
    const remaining = region.cellIds.filter((id) => exists.has(id));
    const spots = remaining.flatMap((id) => { const position = where.get(id); return position ? [position] : []; });
    if (!spots.length) continue;
    const fullWidth = region.column === 0 && region.columnSpan === before.columns.length;
    const fullHeight = region.row === 0 && region.rowSpan === before.rows.length;
    const next = regionOf(
      after,
      fullHeight ? 0 : Math.min(...spots.map((p) => p.row)),
      fullWidth ? 0 : Math.min(...spots.map((p) => p.column)),
      fullHeight ? after.rows.length - 1 : Math.max(...spots.map((p) => p.row)),
      fullWidth ? after.columns.length - 1 : Math.max(...spots.map((p) => p.column)),
    );
    if (next) result.push(next);
  }
  return toMerges(result);
}

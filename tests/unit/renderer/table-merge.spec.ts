import { describe, expect, test } from 'vitest';
import { createTableDocument, deleteTableColumn, deleteTableRow, insertTableColumn, insertTableRow, moveTableColumn, type TableDocument } from '@/domain';
import { adjustTableMerges, cellRange, formatTableMerges, mergeCells, mergeLayout, mergeRegions, parseTableMerges, selectionHasMerge, TABLE_MERGES_KEY, unmergeCells } from '@/renderer/lib/table-merge';

const at = (table: TableDocument, row: number, column: number) => table.cells.find((cell) => cell.rowId === table.rows[row]!.id && cell.columnId === table.columns[column]!.id)!;
const withMerges = (value: string | null): { metadata: Record<string, string> } => ({ metadata: value ? { [TABLE_MERGES_KEY]: value } : {} });
/** Regions as "row,column rows×columns", which reads well in expectations. */
const shapes = (element: { metadata?: Record<string, string> }, table: TableDocument) => mergeRegions(element, table).map((region) => `${region.row},${region.column} ${region.rowSpan}x${region.columnSpan}`);

describe('merged table cells (#197)', () => {
  test('selected cells merge into the rectangle around them, and merges are stored as pairs of cell ids', () => {
    const table = createTableDocument(3, 4);
    const merges = mergeCells(withMerges(null), table, [at(table, 0, 0).id, at(table, 0, 3).id])!;
    expect(merges).toEqual([{ anchorId: at(table, 0, 0).id, endId: at(table, 0, 3).id }]);
    const stored = formatTableMerges(merges)!;
    expect(parseTableMerges(withMerges(stored))).toEqual(merges);
    expect(shapes(withMerges(stored), table)).toEqual(['0,0 1x4']);

    // The corners may come in any order: the region is the rectangle between them.
    const diagonal = formatTableMerges(mergeCells(withMerges(null), table, [at(table, 2, 2).id, at(table, 1, 1).id])!)!;
    expect(shapes(withMerges(diagonal), table)).toEqual(['1,1 2x2']);
    const layout = mergeLayout(withMerges(diagonal), table);
    expect([...layout.anchors.keys()]).toEqual([at(table, 1, 1).id]);
    expect([...layout.covered].sort()).toEqual([at(table, 1, 2).id, at(table, 2, 1).id, at(table, 2, 2).id].sort());

    expect(mergeCells(withMerges(null), table, [at(table, 0, 0).id])).toBeNull();
    expect(mergeCells(withMerges(null), table, ['nope'])).toBeNull();
    expect(formatTableMerges([])).toBeNull();
  });

  test('a new merge absorbs the merges it covers, and unmerging removes the merge of any selected cell', () => {
    const table = createTableDocument(3, 3);
    let element = withMerges(formatTableMerges(mergeCells(withMerges(null), table, [at(table, 0, 0).id, at(table, 0, 1).id])!));
    element = withMerges(formatTableMerges(mergeCells(element, table, [at(table, 2, 0).id, at(table, 2, 2).id])!));
    expect(shapes(element, table)).toEqual(['0,0 1x2', '2,0 1x3']);
    // Merging the first two rows swallows the small merge in the first row.
    element = withMerges(formatTableMerges(mergeCells(element, table, [at(table, 0, 0).id, at(table, 1, 2).id])!));
    expect(shapes(element, table)).toEqual(['2,0 1x3', '0,0 2x3']);

    expect(selectionHasMerge(element, table, [at(table, 1, 1).id])).toBe(true);
    // A covered cell is enough to name the merge.
    element = withMerges(formatTableMerges(unmergeCells(element, table, [at(table, 1, 1).id])!));
    expect(shapes(element, table)).toEqual(['2,0 1x3']);
    expect(unmergeCells(element, table, [at(table, 0, 0).id])).toBeNull();
    expect(selectionHasMerge(element, table, [at(table, 0, 0).id])).toBe(false);
  });

  test('broken, overlapping and single-cell entries are ignored', () => {
    const table = createTableDocument(2, 3);
    const a = at(table, 0, 0).id; const b = at(table, 0, 1).id; const c = at(table, 0, 2).id;
    expect(shapes(withMerges(`${a}>${b};${b}>${c};gone>${c};${c}>${c};${a};${a}>${b}>${c}`), table)).toEqual(['0,0 1x2']);
    expect(shapes(withMerges(''), table)).toEqual([]);
    expect(mergeRegions(withMerges(`${a}>${b}`), undefined)).toEqual([]);
  });

  test('a range between two cells grows to hold every merge it touches', () => {
    const table = createTableDocument(3, 3);
    const element = withMerges(formatTableMerges(mergeCells(withMerges(null), table, [at(table, 0, 1).id, at(table, 1, 2).id])!));
    expect(cellRange(withMerges(null), table, at(table, 0, 0).id, at(table, 0, 1).id)).toHaveLength(2);
    // From the first cell to the merge's top left cell: the whole merge belongs to the range.
    expect(cellRange(element, table, at(table, 0, 0).id, at(table, 0, 1).id)).toHaveLength(6);
    expect(cellRange(element, table, at(table, 2, 0).id, at(table, 2, 0).id)).toEqual([at(table, 2, 0).id]);
  });

  test('a merge over the whole width keeps covering new columns; other merges keep the cells they still have', () => {
    const table = createTableDocument(4, 2);
    const header = formatTableMerges(mergeCells(withMerges(null), table, [at(table, 0, 0).id, at(table, 0, 1).id])!)!;
    // A column at the right edge, as with the table's "add column" button.
    let next = insertTableColumn(table, 2);
    let merges = formatTableMerges(adjustTableMerges(withMerges(header), table, next))!;
    expect(shapes(withMerges(merges), next)).toEqual(['0,0 1x3']);
    // A column at the left edge, and one moved.
    const wider = insertTableColumn(next, 0);
    merges = formatTableMerges(adjustTableMerges(withMerges(merges), next, wider))!;
    expect(shapes(withMerges(merges), wider)).toEqual(['0,0 1x4']);
    const moved = moveTableColumn(wider, 0, 1);
    expect(shapes(withMerges(formatTableMerges(adjustTableMerges(withMerges(merges), wider, moved))), moved)).toEqual(['0,0 1x4']);
    // Rows do not widen a row merge, and deleting the merged row removes the merge.
    const taller = insertTableRow(wider, 0);
    expect(shapes(withMerges(formatTableMerges(adjustTableMerges(withMerges(merges), wider, taller))), taller)).toEqual(['1,0 1x4']);
    const without = deleteTableRow(wider, 0);
    expect(adjustTableMerges(withMerges(merges), wider, without)).toEqual([]);

    // A merge inside the table shrinks with a deleted column and vanishes when one cell is left.
    const grid = createTableDocument(3, 4);
    const inner = formatTableMerges(mergeCells(withMerges(null), grid, [at(grid, 1, 1).id, at(grid, 1, 2).id])!)!;
    const smaller = deleteTableColumn(grid, 2);
    expect(adjustTableMerges(withMerges(inner), grid, smaller)).toEqual([]);
    const three = formatTableMerges(mergeCells(withMerges(null), grid, [at(grid, 1, 1).id, at(grid, 1, 3).id])!)!;
    expect(shapes(withMerges(formatTableMerges(adjustTableMerges(withMerges(three), grid, smaller))), smaller)).toEqual(['1,1 1x2']);
  });
});

import type { TableCell, TableCellStyle, TableDocument } from './types';

export const MAX_TABLE_CELLS = 500;

export const DEFAULT_TABLE_CELL_STYLE: Readonly<TableCellStyle> = Object.freeze({
  fill: '#ffffff',
  color: '#242424',
  fontSize: 16,
  fontFamily: 'sans',
  fontWeight: 'normal',
  textDecoration: 'none',
  listStyle: 'none',
  textAlign: 'left',
});

let tableIdCounter = 0;
function tableId(prefix: string): string {
  if (typeof globalThis.crypto !== 'undefined' && typeof globalThis.crypto.randomUUID === 'function') return `${prefix}:${globalThis.crypto.randomUUID()}`;
  tableIdCounter += 1;
  return `${prefix}:local-${tableIdCounter}-${Math.random().toString(36).slice(2, 8)}`;
}

function cell(rowId: string, columnId: string): TableCell {
  return { id: tableId('cell'), rowId, columnId, text: '', style: { ...DEFAULT_TABLE_CELL_STYLE } };
}

export function createTableDocument(rowCount = 3, columnCount = 3): TableDocument {
  const rows = Array.from({ length: rowCount }, () => ({ id: tableId('row'), height: 80 }));
  const columns = Array.from({ length: columnCount }, () => ({ id: tableId('column'), width: 160 }));
  return {
    version: 1,
    rows,
    columns,
    cells: rows.flatMap((row) => columns.map((column) => cell(row.id, column.id))),
  };
}

export function cloneTableDocument(table: TableDocument): TableDocument {
  return {
    version: 1,
    rows: table.rows.map((row) => ({ ...row })),
    columns: table.columns.map((column) => ({ ...column })),
    cells: table.cells.map((entry) => ({ ...entry, style: { ...entry.style } })),
  };
}

export function tablePlainText(table: TableDocument): string {
  const byPosition = new Map(table.cells.map((entry) => [`${entry.rowId}\u0000${entry.columnId}`, entry.text]));
  return table.rows.map((row) => table.columns.map((column) => byPosition.get(`${row.id}\u0000${column.id}`) ?? '').join('\t')).join('\n');
}

export function areTableDocumentsEqual(a: TableDocument | undefined, b: TableDocument | undefined): boolean {
  if (a === b) return true;
  if (!a || !b) return false;
  return JSON.stringify(a) === JSON.stringify(b);
}

export function tableCell(table: TableDocument, rowIndex: number, columnIndex: number): TableCell | undefined {
  const row = table.rows[rowIndex];
  const column = table.columns[columnIndex];
  return row && column ? table.cells.find((entry) => entry.rowId === row.id && entry.columnId === column.id) : undefined;
}

export function formatTableCells(table: TableDocument, cellIds: readonly string[], patch: Partial<TableCellStyle>): TableDocument {
  const ids = new Set(cellIds.length ? cellIds : table.cells.map((entry) => entry.id));
  return { ...cloneTableDocument(table), cells: table.cells.map((entry) => ids.has(entry.id) ? { ...entry, style: { ...entry.style, ...patch } } : { ...entry, style: { ...entry.style } }) };
}

export function setTableCellText(table: TableDocument, cellId: string, text: string): TableDocument {
  return { ...cloneTableDocument(table), cells: table.cells.map((entry) => entry.id === cellId ? { ...entry, text } : { ...entry, style: { ...entry.style } }) };
}

export function insertTableRow(table: TableDocument, index: number): TableDocument {
  if ((table.rows.length + 1) * table.columns.length > MAX_TABLE_CELLS) return cloneTableDocument(table);
  const next = cloneTableDocument(table);
  const row = { id: tableId('row'), height: 80 };
  next.rows.splice(Math.max(0, Math.min(index, next.rows.length)), 0, row);
  next.cells.push(...next.columns.map((column) => cell(row.id, column.id)));
  return next;
}

export function insertTableColumn(table: TableDocument, index: number): TableDocument {
  if (table.rows.length * (table.columns.length + 1) > MAX_TABLE_CELLS) return cloneTableDocument(table);
  const next = cloneTableDocument(table);
  const column = { id: tableId('column'), width: 160 };
  next.columns.splice(Math.max(0, Math.min(index, next.columns.length)), 0, column);
  next.cells.push(...next.rows.map((row) => cell(row.id, column.id)));
  return next;
}

export function deleteTableRow(table: TableDocument, index: number): TableDocument {
  if (table.rows.length <= 1 || !table.rows[index]) return cloneTableDocument(table);
  const next = cloneTableDocument(table);
  const removed = next.rows.splice(index, 1)[0]!;
  next.cells = next.cells.filter((entry) => entry.rowId !== removed.id);
  return next;
}

export function deleteTableColumn(table: TableDocument, index: number): TableDocument {
  if (table.columns.length <= 1 || !table.columns[index]) return cloneTableDocument(table);
  const next = cloneTableDocument(table);
  const removed = next.columns.splice(index, 1)[0]!;
  next.cells = next.cells.filter((entry) => entry.columnId !== removed.id);
  return next;
}

export function duplicateTableRow(table: TableDocument, index: number): TableDocument {
  if (!table.rows[index] || (table.rows.length + 1) * table.columns.length > MAX_TABLE_CELLS) return cloneTableDocument(table);
  const next = cloneTableDocument(table);
  const source = next.rows[index]!;
  const row = { id: tableId('row'), height: source.height };
  next.rows.splice(index + 1, 0, row);
  for (const column of next.columns) {
    const sourceCell = next.cells.find((entry) => entry.rowId === source.id && entry.columnId === column.id)!;
    next.cells.push({ ...sourceCell, id: tableId('cell'), rowId: row.id, style: { ...sourceCell.style } });
  }
  return next;
}

export function duplicateTableColumn(table: TableDocument, index: number): TableDocument {
  if (!table.columns[index] || table.rows.length * (table.columns.length + 1) > MAX_TABLE_CELLS) return cloneTableDocument(table);
  const next = cloneTableDocument(table);
  const source = next.columns[index]!;
  const column = { id: tableId('column'), width: source.width };
  next.columns.splice(index + 1, 0, column);
  for (const row of next.rows) {
    const sourceCell = next.cells.find((entry) => entry.columnId === source.id && entry.rowId === row.id)!;
    next.cells.push({ ...sourceCell, id: tableId('cell'), columnId: column.id, style: { ...sourceCell.style } });
  }
  return next;
}

export function moveTableRow(table: TableDocument, index: number, delta: -1 | 1): TableDocument {
  const target = index + delta;
  if (!table.rows[index] || target < 0 || target >= table.rows.length) return cloneTableDocument(table);
  const next = cloneTableDocument(table);
  const current = next.rows[index]!; next.rows[index] = next.rows[target]!; next.rows[target] = current;
  return next;
}

export function moveTableColumn(table: TableDocument, index: number, delta: -1 | 1): TableDocument {
  const target = index + delta;
  if (!table.columns[index] || target < 0 || target >= table.columns.length) return cloneTableDocument(table);
  const next = cloneTableDocument(table);
  const current = next.columns[index]!; next.columns[index] = next.columns[target]!; next.columns[target] = current;
  return next;
}

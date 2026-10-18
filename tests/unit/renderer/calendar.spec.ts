import { describe, expect, it } from 'vitest';
import { addDays, addMonths, formatDate, monthGrid, parseIsoDate, todayIso, weekdayIndex } from '@/renderer/lib/calendar';

describe('calendar helpers', () => {
  it('parses only real ISO dates', () => {
    expect(parseIsoDate('2026-10-18')).toMatchObject({ year: 2026, month: 10, day: 18 });
    for (const bad of ['2026-02-30', '2026-13-01', '18.10.2026', '', undefined, null]) expect(parseIsoDate(bad as string)).toBeNull();
  });
  it('moves across month and year boundaries', () => {
    expect(addDays('2026-12-31', 1)).toBe('2027-01-01');
    expect(addDays('2026-03-01', -1)).toBe('2026-02-28');
    expect(addMonths('2026-01-31', 1)).toBe('2026-02-28');
    expect(addMonths('2024-01-31', 1)).toBe('2024-02-29');
    expect(addMonths('2026-01-15', -1)).toBe('2025-12-15');
  });
  it('builds six Monday-first weeks', () => {
    const grid = monthGrid('2026-10-18');
    expect(grid).toHaveLength(6);
    expect(grid.every((week) => week.length === 7)).toBe(true);
    expect(weekdayIndex(grid[0]![0]!.iso)).toBe(0);
    expect(grid.flat().filter((day) => day.month === 10)).toHaveLength(31);
    expect(grid[0]![3]!.iso).toBe('2026-10-01');
  });
  it('formats German dates and today', () => {
    expect(formatDate('2026-10-18')).toBe('18.10.2026');
    expect(formatDate('')).toBe('');
    expect(todayIso(new Date(2026, 9, 18, 23, 59))).toBe('2026-10-18');
  });
});

import { describe, expect, it } from 'vitest';
import { ROUNDABLE_POLYGONS, roundedPolygonPath } from '@/renderer/lib/geometry';

describe('roundedPolygonPath', () => {
  it('offers diamond and both triangles', () => {
    expect(ROUNDABLE_POLYGONS).toEqual(['diamond', 'triangle', 'triangle-down']);
  });

  it('keeps sharp corners at radius 0 (every curve control equals its end point)', () => {
    const path = roundedPolygonPath('diamond', 100, 60, 0);
    const curves = [...path.matchAll(/Q([\d.]+) ([\d.]+) ([\d.]+) ([\d.]+)/g)];
    expect(curves).toHaveLength(4);
    for (const [, cx, cy, x, y] of curves) { expect([cx, cy]).toEqual([x, y]); }
  });

  it('rounds each corner and caps the radius to half of the adjacent edges', () => {
    const rounded = roundedPolygonPath('triangle', 120, 80, 10);
    expect(rounded.startsWith('M')).toBe(true);
    expect(rounded.endsWith('Z')).toBe(true);
    expect((rounded.match(/Q/g) ?? []).length).toBe(3);
    const capped = roundedPolygonPath('triangle', 120, 80, 10_000);
    const numbers = [...capped.matchAll(/-?\d+(?:\.\d+)?/g)].map((match) => Number(match[0]));
    expect(numbers.every((value) => value >= -0.001 && value <= 120.001)).toBe(true);
  });

  it('returns an empty path for shapes without polygon geometry', () => {
    expect(roundedPolygonPath('circle', 10, 10, 4)).toBe('');
  });
});

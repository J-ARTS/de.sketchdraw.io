import { describe, expect, it } from 'vitest';
import {
  DEFAULT_SHAPE_FAVORITES, SHAPE_TOOLBAR_STORAGE_KEY, loadShapeFavorites,
  saveShapeFavorites, validateShapeFavorites,
} from '../../../src/renderer/lib/shape-toolbar-preferences';

function memory(initial?: string) {
  let value = initial ?? null;
  return { getItem: () => value, setItem: (_key: string, next: string) => { value = next; }, value: () => value };
}

describe('shape toolbar preferences (#52)', () => {
  it('accepts only unique allowlisted non-empty favorites', () => {
    expect(validateShapeFavorites(['square', 'circle'])).toEqual(['square', 'circle']);
    expect(validateShapeFavorites([])).toBeNull();
    expect(validateShapeFavorites(['square', 'square'])).toBeNull();
    expect(validateShapeFavorites(['unknown'])).toBeNull();
  });

  it('persists a versioned value and safely falls back for corrupt input', () => {
    const storage = memory();
    expect(saveShapeFavorites(['hexagon', 'circle'], storage)).toBe(true);
    expect(storage.value()).toContain(SHAPE_TOOLBAR_STORAGE_KEY.slice(0, 0));
    expect(loadShapeFavorites(storage)).toEqual(['hexagon', 'circle']);
    expect(loadShapeFavorites(memory('{broken'))).toEqual([...DEFAULT_SHAPE_FAVORITES]);
    expect(loadShapeFavorites(memory(JSON.stringify({ version: 2, favorites: ['hexagon'] })))).toEqual([...DEFAULT_SHAPE_FAVORITES]);
  });
});

import { SHAPE_VARIANTS, type ShapeVariant } from '@/domain';

export const SHAPE_TOOLBAR_STORAGE_KEY = 'sketchdraw.shape-toolbar.v1';
export const DEFAULT_SHAPE_FAVORITES: readonly ShapeVariant[] = [
  'square', 'circle', 'diamond', 'triangle', 'triangle-down', 'rounded', 'cylinder',
];
export const MAX_SHAPE_FAVORITES = 12;

interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

const allowed = new Set(SHAPE_VARIANTS);

export function validateShapeFavorites(value: unknown): ShapeVariant[] | null {
  if (!Array.isArray(value) || value.length < 1 || value.length > MAX_SHAPE_FAVORITES) return null;
  const unique = new Set<ShapeVariant>();
  for (const item of value) {
    if (typeof item !== 'string' || !allowed.has(item as ShapeVariant) || unique.has(item as ShapeVariant)) return null;
    unique.add(item as ShapeVariant);
  }
  return [...unique];
}

export function loadShapeFavorites(storage: StorageLike | undefined = typeof localStorage === 'undefined' ? undefined : localStorage): ShapeVariant[] {
  if (!storage) return [...DEFAULT_SHAPE_FAVORITES];
  try {
    const raw = storage.getItem(SHAPE_TOOLBAR_STORAGE_KEY);
    if (!raw) return [...DEFAULT_SHAPE_FAVORITES];
    const parsed = JSON.parse(raw) as { version?: unknown; favorites?: unknown };
    return parsed?.version === 1 ? validateShapeFavorites(parsed.favorites) ?? [...DEFAULT_SHAPE_FAVORITES] : [...DEFAULT_SHAPE_FAVORITES];
  } catch {
    return [...DEFAULT_SHAPE_FAVORITES];
  }
}

export function saveShapeFavorites(favorites: readonly ShapeVariant[], storage: StorageLike | undefined = typeof localStorage === 'undefined' ? undefined : localStorage): boolean {
  const validated = validateShapeFavorites([...favorites]);
  if (!storage || !validated) return false;
  try {
    storage.setItem(SHAPE_TOOLBAR_STORAGE_KEY, JSON.stringify({ version: 1, favorites: validated }));
    return true;
  } catch {
    return false;
  }
}

import { ref, type Ref } from 'vue';
import type { ShapeVariant } from '@/domain';
import { shapeEntry } from './shapes';
import {
  DEFAULT_SHAPE_FAVORITES,
  MAX_SHAPE_FAVORITES,
  loadShapeFavorites,
  saveShapeFavorites,
} from './shape-toolbar-preferences';

const favorites = ref<ShapeVariant[]>(loadShapeFavorites());
const editing = ref(false);
const announcement = ref('');

function label(id: ShapeVariant): string {
  return shapeEntry(id)?.label ?? id;
}

function persist(message: string): void {
  saveShapeFavorites(favorites.value);
  announcement.value = message;
}

function moveFavorite(from: number, to: number): void {
  if (from < 0 || from >= favorites.value.length) return;
  const bounded = Math.max(0, Math.min(to, favorites.value.length - 1));
  if (from === bounded) return;
  const next = [...favorites.value];
  const [item] = next.splice(from, 1);
  next.splice(bounded, 0, item!);
  favorites.value = next;
  persist(`${label(item!)} steht jetzt an Position ${bounded + 1}.`);
}

function addFavorite(id: ShapeVariant, index = favorites.value.length): void {
  const existing = favorites.value.indexOf(id);
  if (existing >= 0) {
    moveFavorite(existing, Math.min(index, favorites.value.length - 1));
    return;
  }
  if (favorites.value.length >= MAX_SHAPE_FAVORITES) {
    announcement.value = `Die Leiste kann höchstens ${MAX_SHAPE_FAVORITES} Formen enthalten.`;
    return;
  }
  const next = [...favorites.value];
  next.splice(Math.max(0, Math.min(index, next.length)), 0, id);
  favorites.value = next;
  persist(`${label(id)} wurde zur Leiste hinzugefügt.`);
}

function removeFavorite(id: ShapeVariant): void {
  if (favorites.value.length <= 1) {
    announcement.value = 'Mindestens eine Form muss in der Leiste bleiben.';
    return;
  }
  favorites.value = favorites.value.filter((favorite) => favorite !== id);
  persist(`${label(id)} wurde aus der Leiste entfernt.`);
}

function resetFavorites(): void {
  favorites.value = [...DEFAULT_SHAPE_FAVORITES];
  persist('Die Standardformen wurden wiederhergestellt.');
}

function startEditing(): void {
  editing.value = true;
  announcement.value = 'Bearbeitungsmodus für die Formenleiste aktiviert.';
}

function stopEditing(): void {
  editing.value = false;
  announcement.value = 'Bearbeitungsmodus beendet.';
}

export interface ShapeToolbarState {
  favorites: Ref<ShapeVariant[]>;
  editing: Ref<boolean>;
  announcement: Ref<string>;
  addFavorite(id: ShapeVariant, index?: number): void;
  moveFavorite(from: number, to: number): void;
  removeFavorite(id: ShapeVariant): void;
  resetFavorites(): void;
  startEditing(): void;
  stopEditing(): void;
}

export function useShapeToolbarState(): ShapeToolbarState {
  return {
    favorites,
    editing,
    announcement,
    addFavorite,
    moveFavorite,
    removeFavorite,
    resetFavorites,
    startEditing,
    stopEditing,
  };
}

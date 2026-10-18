import type { ThemeName } from './theme';

import { L } from '@/renderer/i18n';
export const PREFERENCES_KEY = 'sketchdraw.preferences.v1';

export type LanguageCode = 'de' | 'en';
/** `available: false` entries are listed but cannot be chosen until their translation exists. */
export const LANGUAGES: ReadonlyArray<{ code: LanguageCode; label: string; available: boolean }> = [
  { code: 'de', label: 'Deutsch', available: true },
  { code: 'en', label: 'English', available: true },
];

/** Canvas background presets; each has a tuned variant per theme. `default` keeps the theme's own canvas color. */
export const CANVAS_BACKGROUNDS: ReadonlyArray<{ id: string; label: string; light: string | null; dark: string | null }> = [
  { id: 'default', label: L('Standard'), light: null, dark: null },
  { id: 'white', label: L('Weiß'), light: '#ffffff', dark: '#121212' },
  { id: 'gray', label: L('Hellgrau'), light: '#f1f3f5', dark: '#1a1c1f' },
  { id: 'blue', label: L('Hellblau'), light: '#eef5ff', dark: '#111a26' },
  { id: 'yellow', label: L('Hellgelb'), light: '#fffbe6', dark: '#211e0f' },
  { id: 'warm', label: L('Warm'), light: '#fbf4f0', dark: '#221a16' },
];

export interface Preferences {
  theme: ThemeName | null;
  /** A preset id or a `#rrggbb` color; null = the theme's default canvas. */
  canvasBackground: string | null;
  language: LanguageCode;
}

export const DEFAULT_PREFERENCES: Readonly<Preferences> = { theme: null, canvasBackground: null, language: 'de' };

const HEX = /^#[0-9a-f]{6}$/i;
const PRESET_IDS = new Set(CANVAS_BACKGROUNDS.map((entry) => entry.id));

export function isCanvasBackground(value: unknown): value is string {
  return typeof value === 'string' && (PRESET_IDS.has(value) || HEX.test(value));
}

/** The concrete CSS color for a stored value in the active theme, or null for the theme default. */
export function resolveCanvasBackground(value: string | null, theme: ThemeName): string | null {
  if (!value || value === 'default') return null;
  const preset = CANVAS_BACKGROUNDS.find((entry) => entry.id === value);
  if (preset) return preset[theme];
  return HEX.test(value) ? value.toLowerCase() : null;
}

interface StorageLike { getItem(key: string): string | null; setItem(key: string, value: string): void }
const browserStorage = (): StorageLike | undefined => (typeof localStorage === 'undefined' ? undefined : localStorage);

export function loadPreferences(storage: StorageLike | undefined = browserStorage()): Preferences {
  const fallback: Preferences = { ...DEFAULT_PREFERENCES };
  if (!storage) return fallback;
  try {
    const parsed = JSON.parse(storage.getItem(PREFERENCES_KEY) ?? 'null') as Partial<Record<keyof Preferences, unknown>> | null;
    if (!parsed || typeof parsed !== 'object') return fallback;
    return {
      theme: parsed.theme === 'light' || parsed.theme === 'dark' ? parsed.theme : null,
      canvasBackground: isCanvasBackground(parsed.canvasBackground) && parsed.canvasBackground !== 'default' ? parsed.canvasBackground : null,
      language: LANGUAGES.some((entry) => entry.code === parsed.language && entry.available) ? parsed.language as LanguageCode : 'de',
    };
  } catch {
    return fallback;
  }
}

export function savePreferences(preferences: Preferences, storage: StorageLike | undefined = browserStorage()): boolean {
  if (!storage) return false;
  try { storage.setItem(PREFERENCES_KEY, JSON.stringify(preferences)); return true; } catch { return false; }
}

/** The canvas colors of the design tokens (`--surface-canvas`), for swatches that must not follow a custom background. */
export const THEME_CANVAS: Readonly<Record<ThemeName, string>> = { light: '#f4f3f9', dark: '#121119' };

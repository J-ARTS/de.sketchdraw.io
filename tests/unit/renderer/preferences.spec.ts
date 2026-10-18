import { describe, expect, it } from 'vitest';
import { DEFAULT_PREFERENCES, isCanvasBackground, loadPreferences, PREFERENCES_KEY, resolveCanvasBackground, savePreferences } from '@/renderer/lib/preferences';

function memory(initial?: string) {
  const data = new Map<string, string>(initial === undefined ? [] : [[PREFERENCES_KEY, initial]]);
  return { getItem: (key: string) => data.get(key) ?? null, setItem: (key: string, value: string) => { data.set(key, value); } };
}

describe('preferences', () => {
  it('falls back to defaults for missing, broken or foreign data', () => {
    expect(loadPreferences(memory())).toEqual(DEFAULT_PREFERENCES);
    expect(loadPreferences(memory('{kaputt'))).toEqual(DEFAULT_PREFERENCES);
    expect(loadPreferences(memory(JSON.stringify({ theme: 'neon', canvasBackground: 'javascript:1', language: 'fr' })))).toEqual(DEFAULT_PREFERENCES);
    expect(loadPreferences(undefined)).toEqual(DEFAULT_PREFERENCES);
  });
  it('round-trips valid values and never restores an unavailable language', () => {
    const storage = memory();
    expect(savePreferences({ theme: 'dark', canvasBackground: '#a1b2c3', language: 'de' }, storage)).toBe(true);
    expect(loadPreferences(storage)).toEqual({ theme: 'dark', canvasBackground: '#a1b2c3', language: 'de' });
    expect(loadPreferences(memory(JSON.stringify({ language: 'en' }))).language).toBe('de');
  });
  it('resolves presets per theme and validates colors', () => {
    expect(resolveCanvasBackground('yellow', 'light')).not.toBe(resolveCanvasBackground('yellow', 'dark'));
    expect(resolveCanvasBackground('default', 'light')).toBeNull();
    expect(resolveCanvasBackground(null, 'dark')).toBeNull();
    expect(resolveCanvasBackground('#ABCDEF', 'light')).toBe('#abcdef');
    expect(resolveCanvasBackground('red', 'light')).toBeNull();
    expect(isCanvasBackground('#12345g')).toBe(false);
    expect(isCanvasBackground('warm')).toBe(true);
  });
});

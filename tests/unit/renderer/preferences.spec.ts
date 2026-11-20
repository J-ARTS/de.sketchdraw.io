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
  it('round-trips valid values including English and never restores an unknown language', () => {
    const storage = memory();
    expect(savePreferences({ theme: 'dark', canvasBackground: '#a1b2c3', language: 'de', smartGuides: false, paperPattern: 'grid' }, storage)).toBe(true);
    expect(loadPreferences(storage)).toEqual({ theme: 'dark', canvasBackground: '#a1b2c3', language: 'de', smartGuides: false, paperPattern: 'grid' });
    // Guides are on unless they were switched off; preferences stored before they existed keep them on.
    expect(loadPreferences(memory(JSON.stringify({ theme: 'dark' }))).smartGuides).toBe(true);
    expect(loadPreferences(memory(JSON.stringify({ smartGuides: 'no' }))).smartGuides).toBe(true);
    // The paper pattern is dots unless another known one was chosen (#247).
    expect(loadPreferences(memory(JSON.stringify({ theme: 'dark' }))).paperPattern).toBe('dots');
    expect(loadPreferences(memory(JSON.stringify({ paperPattern: 'plain' }))).paperPattern).toBe('plain');
    expect(loadPreferences(memory(JSON.stringify({ paperPattern: 'stripes' }))).paperPattern).toBe('dots');
    expect(loadPreferences(memory(JSON.stringify({ language: 'en' }))).language).toBe('en');
    expect(loadPreferences(memory(JSON.stringify({ language: 'fr' }))).language).toBe('de');
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
  it('keeps the lines of the grid apart when zoomed out (#247)', async () => {
    const { paperGridStep, PAPER_STEP } = await import('@/renderer/lib/preferences');
    expect(paperGridStep(1)).toBe(PAPER_STEP);
    expect(paperGridStep(2)).toBe(PAPER_STEP * 2);
    expect(paperGridStep(0.5)).toBe(12);
    // Below the minimum distance every second line is left out, again and again.
    expect(paperGridStep(0.25)).toBe(12);
    expect(paperGridStep(0.1)).toBeCloseTo(19.2);
    expect(paperGridStep(0)).toBe(PAPER_STEP);
    expect(paperGridStep(Number.NaN)).toBe(PAPER_STEP);
  });
});

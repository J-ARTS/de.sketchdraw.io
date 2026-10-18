import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, test } from 'vitest';
import { CATALOG_LIMITS, validateComponentSet } from '@/catalog';
import { OFFICIAL_PROVIDERS, toOfficialComponentSets, type RawOfficialLibrary } from '@/catalog/official-sets';

// #92: every generated official set must pass the same validation as an imported component set.
const dir = join(__dirname, '../../../src/catalog/official');
const manifest = JSON.parse(readFileSync(join(dir, 'manifest.json'), 'utf8')) as { providers: Record<string, { count: number }> };
const MINIMUM = { aws: 700, azure: 650, gcp: 200, kubernetes: 39 } as const;

describe.each(OFFICIAL_PROVIDERS)('official %s library', (provider) => {
  const raw = JSON.parse(readFileSync(join(dir, `${provider}.json`), 'utf8')) as RawOfficialLibrary;
  const sets = toOfficialComponentSets(raw);

  test('matches the manifest and covers the full package', () => {
    const count = sets.reduce((sum, set) => sum + set.components.length, 0);
    expect(count).toBe(manifest.providers[provider]!.count);
    expect(count).toBeGreaterThanOrEqual(MINIMUM[provider]);
  });

  test('each category set validates and stays within the per-set limits', () => {
    for (const set of sets) {
      expect(() => validateComponentSet(set), set.id).not.toThrow();
      expect(JSON.stringify(set).length, set.id).toBeLessThan(CATALOG_LIMITS.MAX_COMPONENT_SET_JSON_BYTES);
      expect(set.id.startsWith(`sketchdraw.${provider}.`)).toBe(true);
      for (const component of set.components) {
        expect(component.provider).toBe(provider);
        expect(component.metadata?.provenance).toBe('official-architecture-icon');
        expect(component.defaultWidth).toBe(168);
        expect(component.defaultHeight).toBe(168);
      }
    }
  });

  test('component types and set ids are unique', () => {
    const types = sets.flatMap((set) => set.components.map((component) => component.type));
    expect(new Set(types).size).toBe(types.length);
    expect(new Set(sets.map((set) => set.id)).size).toBe(sets.length);
  });
});

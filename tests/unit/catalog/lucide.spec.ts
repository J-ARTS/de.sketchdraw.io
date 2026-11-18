import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { COMPONENT_PRESENTATION_KEY, instantiateComponent, isIconFigure, parseSafeIconSvg, validateComponentSet } from '@/catalog';
import { isLucideComponent, LUCIDE_SET_PREFIX, toLucideComponentSets, type RawLucideLibrary } from '@/catalog/lucide-sets';
import { applyCommand, createDocument, serializeDocument, deserializeDocument } from '@/domain';
import { prepareSvgExport } from '@/interop';

const raw = JSON.parse(readFileSync(new URL('../../../src/catalog/lucide/lucide.json', import.meta.url), 'utf8')) as RawLucideLibrary;
const manifest = JSON.parse(readFileSync(new URL('../../../src/catalog/lucide/manifest.json', import.meta.url), 'utf8')) as { package: string; license: string; count: number; categories: { id: string; name: string; count: number }[] };
const sets = toLucideComponentSets(raw);
const all = sets.flatMap((set) => set.components);

describe('Lucide icon library (#227)', () => {
  it('holds the whole imported release, filed by category', () => {
    expect(raw.package).toMatch(/^lucide-static@\d+\.\d+\.\d+$/);
    expect(raw.license).toBe('ISC');
    expect(all.length).toBe(manifest.count);
    expect(all.length).toBeGreaterThan(1500);
    expect(sets.length).toBeGreaterThan(30);
    expect(manifest.categories.map((category) => [category.id, category.count])).toEqual(sets.map((set) => [set.id, set.components.length]));
    for (const set of sets) {
      expect(set.id.startsWith(LUCIDE_SET_PREFIX)).toBe(true);
      expect(set.name.startsWith('Lucide · ')).toBe(true);
      expect(set.components.length).toBeGreaterThan(0);
    }
    expect(new Set(all.map((component) => component.type)).size).toBe(all.length);
  });

  it('is valid for the catalogue and for a document: every set and every icon', () => {
    for (const set of sets) expect(() => validateComponentSet(JSON.parse(JSON.stringify(set))), set.id).not.toThrow();
    for (const component of all) {
      const parsed = parseSafeIconSvg(component.iconSvg!);
      expect(parsed.ok, `${component.type}: ${parsed.ok ? '' : parsed.message}`).toBe(true);
    }
  });

  it('describes each icon as a generic free-standing figure whose lines follow the colour of the element', () => {
    for (const component of all) {
      expect(component.type).toMatch(/^generic\.lucide\.[a-z0-9-]+$/);
      expect(component.provider).toBe('generic');
      expect(component.metadata?.[COMPONENT_PRESENTATION_KEY]).toBe('icon');
      expect(isLucideComponent(component)).toBe(true);
      expect(component.iconSvg).toContain('stroke="currentColor"');
      expect(component.iconSvg).toContain('viewBox="0 0 24 24"');
      expect(component.aliases).toContain('lucide');
      expect(component.name).toMatch(/^[A-Z0-9]/);
    }
    expect(all.find((component) => component.type === 'generic.lucide.chevron-down')).toMatchObject({ name: 'Chevron Down', category: 'Arrows' });
  });

  it('writes arc flags out so that the app reads every path', () => {
    // "a2 2 0 01-2 2" is valid SVG, but the icon check wants seven separate numbers per arc.
    for (const component of all) for (const [, d] of component.iconSvg!.matchAll(/ d="([^"]+)"/g)) {
      for (const [, numbers] of d!.matchAll(/[aA]([^a-zA-Z]*)/g)) expect(numbers!.trim().split(/\s+/).length % 7, `${component.type}: ${d}`).toBe(0);
    }
  });

  it('places an icon as a figure, embeds only its category and survives saving and export', () => {
    const set = sets.find((entry) => entry.id === 'sketchdraw.lucide.arrows')!;
    const base = createDocument('Icons');
    const { element, command } = instantiateComponent(base, { set, type: 'generic.lucide.chevron-down', id: 'component:chevron', pageId: base.pages[0]!.id, at: { x: 100, y: 100 } });
    const document = applyCommand(base, command);
    expect(isIconFigure(element)).toBe(true);
    expect(element).toMatchObject({ width: 64, height: 82, label: 'Chevron Down' });
    expect(document.componentSets.map((entry) => entry.id)).toEqual(['sketchdraw.lucide.arrows']);
    const reopened = deserializeDocument(serializeDocument(document));
    expect(reopened.elements[0]).toMatchObject({ componentType: 'generic.lucide.chevron-down' });
    const svg = prepareSvgExport(document).contents;
    // The exported icon carries the colour of the element for its lines.
    expect(svg).toContain('stroke="currentColor"');
    expect(svg).toMatch(/color="#1e293b"/i);
    expect(svg).toContain('Chevron Down');
  });
});

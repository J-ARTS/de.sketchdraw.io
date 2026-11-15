import { describe, expect, it } from 'vitest';
import { builtInComponentSets, COMPONENT_PRESENTATION_KEY, figureLayout, instantiateComponent, isIconFigure, ISOMETRIC_ICONS, ISOMETRIC_SET_ID, parseSafeIconSvg, searchCatalogComponents, validateComponentSet } from '@/catalog';
import { applyCommand, createDocument } from '@/domain';
import { prepareSvgExport } from '@/interop';

const set = builtInComponentSets.find((entry) => entry.id === ISOMETRIC_SET_ID)!;

describe('isometric icon library (#212)', () => {
  it('is a valid built-in component set', () => {
    expect(set).toBeDefined();
    expect(() => validateComponentSet(JSON.parse(JSON.stringify(set)))).not.toThrow();
    expect(set.components).toHaveLength(ISOMETRIC_ICONS.length);
    expect(set.components.length).toBeGreaterThanOrEqual(25);
    expect(new Set(set.components.map((component) => component.type)).size).toBe(set.components.length);
    expect(new Set(set.components.map((component) => component.name)).size).toBe(set.components.length);
  });

  it('draws every symbol as a safe icon, not as the fallback', () => {
    for (const icon of ISOMETRIC_ICONS) {
      const parsed = parseSafeIconSvg(icon.svg);
      expect(parsed.ok, `${icon.id}: ${parsed.ok ? '' : parsed.message}`).toBe(true);
      expect(icon.svg).toContain('viewBox="0 0 96 96"');
    }
  });

  it('keeps gradient names apart between icons, so that two icons on one page do not share paint', () => {
    const owners = new Map<string, string>();
    for (const icon of ISOMETRIC_ICONS) {
      for (const [, id] of icon.svg.matchAll(/ id="([^"]+)"/g)) {
        expect(id!.startsWith(`iso-${icon.id}-`), `${id} in ${icon.id}`).toBe(true);
        expect(owners.get(id!) ?? icon.id).toBe(icon.id);
        owners.set(id!, icon.id);
      }
      for (const [, id] of icon.svg.matchAll(/url\(#([^)]+)\)/g)) expect(owners.get(id!), `${id} is defined`).toBe(icon.id);
    }
  });

  it('stays inside its view box', () => {
    for (const icon of ISOMETRIC_ICONS) {
      const numbers = [...icon.svg.matchAll(/points="([^"]+)"/g)].flatMap(([, points]) => points!.split(/[ ,]/).map(Number));
      for (const [, cx, cy, rx, ry] of icon.svg.matchAll(/<ellipse cx="([\d.-]+)" cy="([\d.-]+)" rx="([\d.-]+)" ry="([\d.-]+)"/g)) numbers.push(Number(cx) - Number(rx), Number(cx) + Number(rx), Number(cy) - Number(ry), Number(cy) + Number(ry));
      expect(numbers.length, icon.id).toBeGreaterThan(0);
      expect(Math.min(...numbers), icon.id).toBeGreaterThanOrEqual(0);
      expect(Math.max(...numbers), icon.id).toBeLessThanOrEqual(96);
    }
  });

  it('marks its components as free-standing figures and offers both colour families', () => {
    for (const component of set.components) {
      expect(component.type.startsWith('generic.isometric.')).toBe(true);
      expect(component.metadata?.[COMPONENT_PRESENTATION_KEY]).toBe('icon');
    }
    expect(new Set(set.components.map((component) => component.category))).toEqual(new Set(['Services and data', 'Compute and network', 'Clients and environment']));
    const svg = (id: string): string => ISOMETRIC_ICONS.find((icon) => icon.id === id)!.svg;
    expect(svg('instance')).toContain('#e8833a');
    expect(svg('server-stack')).toContain('#525e7c');
  });

  it('is found by German and English words', () => {
    const found = (query: string): string[] => searchCatalogComponents([set], query, 'generic').map((item) => item.component.type);
    expect(found('datenbank')).toContain('generic.isometric.database');
    expect(found('queue')).toContain('generic.isometric.queue');
    expect(found('isometrisch')).toHaveLength(set.components.length);
  });
});

describe('free-standing component figures (#212)', () => {
  const style = { stroke: '#1e293b', fill: 'transparent', strokeWidth: 0, opacity: 1, fontSize: 14, textAlign: 'center', strokeDash: 'solid' } as const;

  it('recognises a figure by the metadata of the element', () => {
    expect(isIconFigure({ kind: 'component', metadata: { [COMPONENT_PRESENTATION_KEY]: 'icon' } })).toBe(true);
    expect(isIconFigure({ kind: 'component', metadata: {} })).toBe(false);
    expect(isIconFigure({ kind: 'rectangle', metadata: { [COMPONENT_PRESENTATION_KEY]: 'icon' } })).toBe(false);
  });

  it('puts the symbol above the label, centred, and gives a second line room', () => {
    const one = figureLayout({ width: 120, height: 132, style }, 1);
    expect(one.icon.size).toBeCloseTo(110.5);
    expect(one.icon.x).toBeCloseTo((120 - 110.5) / 2);
    expect(one.icon.y + one.icon.size).toBeLessThanOrEqual(one.labelTop);
    const two = figureLayout({ width: 120, height: 132, style }, 2);
    expect(two.icon.size).toBeLessThan(one.icon.size);
    expect(two.labelTop).toBeLessThan(one.labelTop);
    // A wide box centres the symbol; a flat box never lets the label take more than half.
    expect(figureLayout({ width: 300, height: 132, style }, 1).icon.x).toBeCloseTo((300 - 110.5) / 2);
    expect(figureLayout({ width: 120, height: 30, style }, 3).icon.size).toBe(15);
  });

  it('exports a figure to SVG with the symbol at its size and the label below', () => {
    const document = createDocument('Figure');
    const { command } = instantiateComponent(document, { set, type: 'generic.isometric.database', id: 'component:db', at: { x: 0, y: 0 } });
    const svg = prepareSvgExport(applyCommand(document, command)).contents;
    expect(svg).toMatch(/<svg[^>]*width="110.5"[^>]*height="110.5"/);
    expect(svg).toContain('iso-database-g1');
    const y = Number(/<tspan x="60" y="([\d.]+)">Database/.exec(svg)?.[1]);
    expect(y).toBeGreaterThan(110);
  });
});

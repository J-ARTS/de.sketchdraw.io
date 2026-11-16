import { describe, expect, it } from 'vitest';
import { createDocument, createElement, type SketchDocument } from '@/domain';
import { parseXmlDocument } from '@/interop/xml';
import { renderLivePages } from '@/renderer/lib/confluence-live-image';

const TEXT = { empty: 'Diese Seite ist leer.' };

function architecture(): SketchDocument {
  const document = createDocument('Plattform <Prod> & "Netz"');
  document.pages = [{ id: 'page:overview', name: 'Übersicht' }, { id: 'page:network', name: 'Netz' }, { id: 'page:empty', name: 'Offen' }];
  document.elements = [
    createElement('rectangle', { id: 'el:gateway', pageId: 'page:overview', x: 40, y: 40, width: 220, height: 110, text: 'API Gateway' }),
    createElement('rectangle', { id: 'el:vpc', pageId: 'page:network', x: -300, y: -120, width: 420, height: 180, text: 'VPC privat' }),
  ];
  return document;
}

describe('rendered diagram pages for Confluence (#210)', () => {
  it('draws every page as a well-formed, self-describing image without the embedded document', async () => {
    const pages = await renderLivePages(architecture(), TEXT);
    expect(pages.map((page) => [page.pageId, page.name])).toEqual([['page:overview', 'Übersicht'], ['page:network', 'Netz'], ['page:empty', 'Offen']]);
    for (const page of pages) {
      // The same strict parser that guards imports accepts the image.
      expect(() => parseXmlDocument(page.svg)).not.toThrow();
      expect(page.svg.startsWith(`<svg xmlns="http://www.w3.org/2000/svg" width="${page.width}" height="${page.height}"`)).toBe(true);
      expect(page.svg).toContain('<rect width="');
      expect(page.svg).not.toMatch(/<script|<metadata|<foreignObject|sketchdraw-interop|href="http/);
      expect(page.hash).toMatch(/^[0-9a-f]{64}$/);
      expect(page.width).toBeGreaterThanOrEqual(480);
    }
    expect(pages[0]!.svg).toContain('Plattform &lt;Prod&gt; &amp; "Netz" · Übersicht');
    expect(pages[1]!.svg).toContain('VPC privat');
    expect(pages[1]!.svg).not.toContain('sd-1');
    // The diagram keeps its own coordinates inside the sheet, including negative ones.
    expect(pages[1]!.svg).toMatch(/<svg x="[\d.]+" y="56" width="[\d.]+" height="[\d.]+" viewBox="-\d/);
    expect(pages[2]!.svg).toContain('Diese Seite ist leer.');
    expect(pages[1]!.width).toBeGreaterThan(420);
    expect(pages[1]!.height).toBeGreaterThan(180 + 56);
  });

  it('gives the same diagram the same digest and a changed page a new one, page by page', async () => {
    const before = await renderLivePages(architecture(), TEXT);
    const again = await renderLivePages(architecture(), TEXT);
    expect(again.map((page) => page.hash)).toEqual(before.map((page) => page.hash));

    const changed = architecture();
    changed.elements = changed.elements.map((element) => element.id === 'el:vpc' ? { ...element, text: 'VPC öffentlich' } : element);
    const after = await renderLivePages(changed, TEXT);
    expect(after[0]!.hash).toBe(before[0]!.hash);
    expect(after[1]!.hash).not.toBe(before[1]!.hash);
    expect(after[2]!.hash).toBe(before[2]!.hash);

    const renamed = architecture(); renamed.title = 'Plattform 2';
    expect((await renderLivePages(renamed, TEXT)).every((page, index) => page.hash !== before[index]!.hash)).toBe(true);
  });

  it('names a single-page diagram by its title alone and shortens very long headings', async () => {
    const document = createDocument('T'.repeat(400));
    document.elements = [createElement('rectangle', { pageId: document.pages[0]!.id, x: 0, y: 0, width: 100, height: 60 })];
    const [page] = await renderLivePages(document, TEXT);
    expect(page!.svg).not.toContain(' · ');
    // The heading fits the sheet; the full title stays in the picture's own <title>.
    expect(page!.svg).toMatch(/fill="#1f2330">T{10,60}…<\/text>/);
  });
});

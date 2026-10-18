import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  createController,
  createDocument,
  createElement,
  deserializeDocument,
  DomainValidationError,
  parseWebEmbedUrl,
  serializeDocument,
  validateDocument,
  type DesktopBridge,
} from '@/domain';
import { formatDiagram, parseDiagram } from '@/codec';
import { importDrawio, importSvg, prepareDrawioExport, prepareSvgExport } from '@/interop';
import { createWhiteboardStore } from '@/renderer/state/whiteboard';
import type { WhiteboardStore } from '@/renderer/state/contract';

const stores: WhiteboardStore[] = [];
afterEach(() => { for (const store of stores.splice(0)) store.dispose(); });

const bridge: DesktopBridge = {
  platform: 'electron',
  openDocument: vi.fn<DesktopBridge['openDocument']>(async () => ({ status: 'cancelled' })),
  saveDocument: vi.fn<DesktopBridge['saveDocument']>(async () => ({ status: 'cancelled' })),
  exportFile: vi.fn<DesktopBridge['exportFile']>(async () => ({ status: 'cancelled' })),
  openExternal: vi.fn(async () => {}),
  onCloseRequested: () => () => {},
  respondToClose: vi.fn(async () => {}),
  onMenuCommand: () => () => {},
};

describe('web embed contract', () => {
  it('accepts only absolute HTTP(S) URLs without credentials', () => {
    expect(parseWebEmbedUrl(' https://example.com/path?q=1 ')).toEqual({ ok: true, url: 'https://example.com/path?q=1' });
    expect(parseWebEmbedUrl('http://localhost:4173/demo')).toEqual({ ok: true, url: 'http://localhost:4173/demo' });
    for (const value of ['', 'example.com', 'javascript:alert(1)', 'file:///tmp/page.html', 'https://user:secret@example.com/']) {
      expect(parseWebEmbedUrl(value).ok, value).toBe(false);
    }

    expect(() => createElement('rectangle', { embedUrl: 'https://example.com/' })).toThrow(DomainValidationError);
    expect(() => createElement('web-embed', { embedUrl: 'javascript:alert(1)' })).toThrow(DomainValidationError);
    const missing = createElement('web-embed');
    delete missing.embedUrl;
    expect(() => validateDocument({ ...createDocument('Missing'), elements: [missing] })).toThrow(DomainValidationError);
  });

  it('roundtrips URL and geometry through JSON and Diagram as Code', () => {
    const document = createDocument('Embeds');
    const embed = createElement('web-embed', {
      id: 'web-embed:one', x: 40, y: 70, width: 640, height: 400,
      embedUrl: 'https://example.com/dashboard?mode=readonly', label: 'example.com',
    });
    document.elements = [embed];
    expect(deserializeDocument(serializeDocument(document)).elements[0]).toEqual(embed);
    const parsed = parseDiagram(formatDiagram(document));
    expect(parsed.ok).toBe(true);
    if (parsed.ok) expect(parsed.document.elements[0]).toEqual(embed);
  });

  it('exports a static linked card without copying remote page content', () => {
    const document = createDocument('Embeds');
    document.elements = [createElement('web-embed', {
      id: 'web-embed:one', embedUrl: 'https://example.com/private', label: 'example.com',
    })];
    const before = serializeDocument(document);
    const svgResult = prepareSvgExport(document);
    const drawioResult = prepareDrawioExport(document);
    expect(svgResult.contents).toContain('href="https://example.com/private"');
    expect(svgResult.contents).not.toContain('<iframe');
    expect(svgResult.diagnostics).toEqual(expect.arrayContaining([expect.objectContaining({ code: 'WEB_EMBED_PROJECTED_AS_LINK' })]));
    expect(drawioResult.contents).toContain('sketchdrawKind=web-embed');
    expect(drawioResult.contents).not.toContain('<iframe');
    expect(serializeDocument(importSvg(svgResult.contents).document)).toBe(before);
    expect(serializeDocument(importDrawio(drawioResult.contents).document)).toBe(before);
  });

  it('adds, duplicates, undoes and redoes embeds through the shared document authority', async () => {
    const store = createWhiteboardStore({ bridge, controller: createController(createDocument('Store')) });
    stores.push(store);
    store.setViewportSize(1200, 800);
    expect(await store.addWebEmbed('https://example.com/app')).toBe(true);
    await store.whenIdle();
    const original = store.state.document.elements[0]!;
    expect(original).toMatchObject({ kind: 'web-embed', embedUrl: 'https://example.com/app', label: 'example.com', width: 640, height: 400 });
    expect(store.state.selection).toEqual([original.id]);
    store.duplicateSelection(); await store.whenIdle();
    expect(store.state.document.elements).toHaveLength(2);
    expect(store.state.document.elements[1]).toMatchObject({ kind: 'web-embed', embedUrl: original.embedUrl });
    store.undo(); await store.whenIdle(); expect(store.state.document.elements).toHaveLength(1);
    store.undo(); await store.whenIdle(); expect(store.state.document.elements).toHaveLength(0);
    store.redo(); await store.whenIdle(); expect(store.state.document.elements).toHaveLength(1);
  });
});

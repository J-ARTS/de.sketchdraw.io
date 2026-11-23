import { mkdtemp, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { strFromU8, unzipSync } from 'fflate';
import { SaxesParser } from 'saxes';
import { describe, expect, it, vi } from 'vitest';
import { validateExportFileRequest } from '../../../electron/ipc-contract';
import { DocumentPersistenceService } from '../../../electron/persistence';
import { createDocument, createElement, type SketchElement } from '../../../src/domain';
import { createBrowserDesktopBridge } from '../../../src/platform/browser-bridge';
import { buildPptx, bytesToBase64, pptxSlideSize, type PptxSlide } from '../../../src/renderer/lib/pptx';
import { buildSlideDeck, renderSlidePictures, slideFontFamilies, slideFontStyle, withSlideFonts } from '../../../src/renderer/lib/slide-export';
import { SLIDE_NOTES_KEY } from '../../../src/renderer/lib/slide-notes';

/** A real PNG of one pixel. */
const PNG = Uint8Array.from(Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64'));
const CREATED = new Date('2026-11-22T12:00:00.000Z');
const OPTIONS = { title: 'Architektur <v2> & mehr', language: 'de-DE', created: CREATED };
const SLIDES: PptxSlide[] = [
  { name: 'Einführung & <Ziele>', png: PNG, width: 960, height: 540, notes: 'Erste Zeile\n\nDritte "Zeile" & mehr' },
  { name: 'Hochformat', png: PNG, width: 400, height: 800, notes: '' },
];

function parts(bytes: Uint8Array): Map<string, Uint8Array> { return new Map(Object.entries(unzipSync(bytes))); }
function xml(files: Map<string, Uint8Array>, name: string): string {
  const bytes = files.get(name);
  if (!bytes) throw new Error(`The package has no part ${name}.`);
  return strFromU8(bytes);
}
/** Throws for XML that is not well formed. */
function wellFormed(text: string): void {
  const parser = new SaxesParser({ xmlns: true });
  parser.on('error', (error) => { throw error; });
  parser.write(text).close();
}
/** The relationships of a part: id → the part its target names. */
function relationships(files: Map<string, Uint8Array>, part: string): Map<string, { type: string; target: string }> {
  const folder = path.posix.dirname(part);
  const name = path.posix.join(folder, '_rels', `${path.posix.basename(part)}.rels`);
  const found = new Map<string, { type: string; target: string }>();
  for (const match of xml(files, name).matchAll(/<Relationship Id="([^"]+)" Type="([^"]+)" Target="([^"]+)"\/>/g)) {
    found.set(match[1]!, { type: match[2]!.split('/').at(-1)!, target: path.posix.normalize(path.posix.join(folder, match[3]!)) });
  }
  return found;
}

describe('PowerPoint package (#266)', () => {
  const files = parts(buildPptx(SLIDES, OPTIONS));

  it('is a ZIP package whose parts are well formed, typed and linked to parts that exist', () => {
    const bytes = buildPptx(SLIDES, OPTIONS);
    expect([...bytes.subarray(0, 4)]).toEqual([0x50, 0x4b, 0x03, 0x04]);
    expect([...files.keys()][0]).toBe('[Content_Types].xml');

    const types = xml(files, '[Content_Types].xml');
    const overrides = new Map([...types.matchAll(/<Override PartName="([^"]+)" ContentType="([^"]+)"\/>/g)].map((match) => [match[1]!.slice(1), match[2]!]));
    for (const [name, contents] of files) {
      if (name.endsWith('.png')) { expect(types).toContain('<Default Extension="png" ContentType="image/png"/>'); continue; }
      wellFormed(strFromU8(contents));
      if (name === '[Content_Types].xml' || name.endsWith('.rels')) continue;
      expect(overrides.has(name), `content type of ${name}`).toBe(true);
    }
    for (const name of overrides.keys()) expect(files.has(name), `part ${name}`).toBe(true);

    const linked = ['ppt/presentation.xml', 'ppt/slideMasters/slideMaster1.xml', 'ppt/slideLayouts/slideLayout1.xml', 'ppt/notesMasters/notesMaster1.xml', 'ppt/slides/slide1.xml', 'ppt/slides/slide2.xml', 'ppt/notesSlides/notesSlide1.xml'];
    for (const part of linked) for (const [id, relation] of relationships(files, part)) expect(files.has(relation.target), `${part} ${id} → ${relation.target}`).toBe(true);
    const root = xml(files, '_rels/.rels');
    for (const target of ['ppt/presentation.xml', 'docProps/core.xml', 'docProps/app.xml']) expect(root).toContain(`Target="${target}"`);
    // Every relationship id used in a part is declared for it.
    for (const part of linked) {
      const declared = relationships(files, part);
      for (const match of xml(files, part).matchAll(/r:(?:id|embed)="([^"]+)"/g)) expect(declared.has(match[1]!), `${part} uses ${match[1]}`).toBe(true);
    }
  });

  it('holds one slide per picture in the given order, at the proportion of the first one', () => {
    const presentation = xml(files, 'ppt/presentation.xml');
    expect(presentation).toContain('<p:sldSz cx="12192000" cy="6858000"/>');
    const ids = [...presentation.matchAll(/<p:sldId id="(\d+)" r:id="([^"]+)"\/>/g)];
    expect(ids.map((match) => match[1])).toEqual(['256', '257']);
    const targets = relationships(files, 'ppt/presentation.xml');
    expect(ids.map((match) => targets.get(match[2]!)?.target)).toEqual(['ppt/slides/slide1.xml', 'ppt/slides/slide2.xml']);
    expect(xml(files, 'docProps/app.xml')).toContain('<Slides>2</Slides>');
    expect(xml(files, 'docProps/core.xml')).toContain('<dc:title>Architektur &lt;v2&gt; &amp; mehr</dc:title>');

    // The first picture fills its slide; a picture of another proportion is as large as the slide allows, in its middle.
    const first = xml(files, 'ppt/slides/slide1.xml');
    expect(first).toContain('<a:off x="0" y="0"/><a:ext cx="12192000" cy="6858000"/>');
    expect(first).toContain('name="Einführung &amp; &lt;Ziele&gt;"');
    expect(relationships(files, 'ppt/slides/slide1.xml').get('rId2')).toEqual({ type: 'image', target: 'ppt/media/image1.png' });
    expect(xml(files, 'ppt/slides/slide2.xml')).toContain('<a:off x="4381500" y="0"/><a:ext cx="3429000" cy="6858000"/>');
    expect(files.get('ppt/media/image1.png')).toEqual(PNG);
    expect(files.get('ppt/media/image2.png')).toEqual(PNG);
  });

  it('writes the speaker notes as the notes page of their slide, one paragraph per line', () => {
    const notes = xml(files, 'ppt/notesSlides/notesSlide1.xml');
    expect([...notes.matchAll(/<a:p>(.*?)<\/a:p>/g)].map((match) => /<a:t>(.*)<\/a:t>/.exec(match[1]!)?.[1] ?? '')).toEqual(['Erste Zeile', '', 'Dritte &quot;Zeile&quot; &amp; mehr']);
    expect(notes).toContain('lang="de-DE"');
    expect([...relationships(files, 'ppt/notesSlides/notesSlide1.xml').values()]).toEqual([{ type: 'notesMaster', target: 'ppt/notesMasters/notesMaster1.xml' }, { type: 'slide', target: 'ppt/slides/slide1.xml' }]);
    expect(relationships(files, 'ppt/slides/slide1.xml').get('rId3')).toEqual({ type: 'notesSlide', target: 'ppt/notesSlides/notesSlide1.xml' });
    // A slide without notes has no notes page.
    expect(files.has('ppt/notesSlides/notesSlide2.xml')).toBe(false);
    expect([...relationships(files, 'ppt/slides/slide2.xml').values()].map((relation) => relation.type)).toEqual(['slideLayout', 'image']);

    const plain = parts(buildPptx(SLIDES.map((slide) => ({ ...slide, notes: '  ' })), OPTIONS));
    expect([...plain.keys()].filter((name) => /notes|theme2/.test(name))).toEqual([]);
    expect(xml(plain, 'ppt/presentation.xml')).not.toContain('notesMasterIdLst');
    expect(xml(plain, '[Content_Types].xml')).not.toContain('notes');
  });

  it('gives the same bytes for the same slides, drops characters XML cannot hold and refuses an empty deck', () => {
    expect(buildPptx(SLIDES, OPTIONS)).toEqual(buildPptx(SLIDES, OPTIONS));
    const odd = parts(buildPptx([{ ...SLIDES[0]!, name: 'A\u0000B\u0008C\ud800', notes: 'x\u000by' }], OPTIONS));
    expect(xml(odd, 'ppt/slides/slide1.xml')).toContain('name="ABC"');
    expect(xml(odd, 'ppt/notesSlides/notesSlide1.xml')).toContain('<a:t>xy</a:t>');
    wellFormed(xml(odd, 'ppt/slides/slide1.xml'));
    expect(() => buildPptx([], OPTIONS)).toThrow();
    expect(pptxSlideSize(400, 800)).toEqual({ cx: 6096000, cy: 12192000 });
    expect(pptxSlideSize(4000, 10)).toEqual({ cx: 12192000, cy: 914400 });
    expect(pptxSlideSize(0, 0)).toEqual({ cx: 12192000, cy: 6858000 });
  });
});

function deckDocument() {
  const document = createDocument('Quartalsbericht');
  const page = document.pages[0]!.id;
  document.pages.push({ ...document.pages[0]!, id: 'page:other', name: 'Anhang' });
  const element = (kind: SketchElement['kind'], id: string, values: Partial<SketchElement>) => createElement(kind, { id, pageId: page, ...values });
  const frames = [
    element('frame', 'frame:intro', { x: 0, y: 0, width: 960, height: 540, label: 'Einführung', metadata: { [SLIDE_NOTES_KEY]: 'Begrüßung\nAgenda' } }),
    element('frame', 'frame:second', { x: 1200, y: 100.5, width: 800, height: 600, label: '  ' }),
  ];
  document.elements = [
    ...frames,
    element('rectangle', 'shape:inside', { x: 100, y: 100, width: 200, height: 100, text: 'Umsatz', parentId: 'frame:intro' }),
    element('text', 'text:second', { x: 1300, y: 200, width: 300, height: 40, text: 'Łódź wächst', style: { ...createElement('text').style, fontFamily: 'scribbled' } }),
    createElement('rectangle', { id: 'shape:other-page', pageId: 'page:other', x: 0, y: 0, width: 50, height: 50, text: 'Nur im Anhang' }),
  ];
  return { document, page, frames };
}

describe('slides as pictures (#266)', () => {
  it('cuts each picture at its frame, leaves the frames out and keeps other pages and hidden data away', () => {
    const { document, page, frames } = deckDocument();
    const pictures = renderSlidePictures(document, page, frames, (index) => `Folie ${index + 1}`);
    expect(pictures.map(({ frameId, name, notes, width, height }) => ({ frameId, name, notes, width, height }))).toEqual([
      { frameId: 'frame:intro', name: 'Einführung', notes: 'Begrüßung\nAgenda', width: 960, height: 540 },
      { frameId: 'frame:second', name: 'Folie 2', notes: '', width: 800, height: 600 },
    ]);
    expect(pictures[0]!.svg.startsWith('<svg xmlns="http://www.w3.org/2000/svg" width="960" height="540" viewBox="0 0 960 540"><rect x="0" y="0" width="960" height="540" fill="#ffffff"/>')).toBe(true);
    expect(pictures[1]!.svg).toContain('viewBox="1200 100.5 800 600"');
    for (const picture of pictures) {
      // PowerPoint shows a picture; it must be a document of its own.
      const parser = new SaxesParser({ xmlns: true });
      parser.on('error', (error) => { throw error; });
      parser.write(picture.svg).close();
      expect(picture.svg).toContain('Umsatz');
      expect(picture.svg).toContain('Łódź wächst');
      expect(picture.svg).not.toContain('Nur im Anhang');
      expect(picture.svg).not.toContain('Einführung');
      expect(picture.svg).not.toContain('Begrüßung');
      expect(picture.svg).not.toContain('<metadata');
      expect(picture.svg).not.toContain('stroke-dasharray="10 7"');
    }
    expect(renderSlidePictures(document, page, [], () => '')).toEqual([]);
    // A page that holds nothing but frames still gives its slides, as empty sheets.
    const empty = renderSlidePictures({ ...document, elements: frames }, page, frames, (index) => `Folie ${index + 1}`);
    expect(empty[0]!.svg).toBe('<svg xmlns="http://www.w3.org/2000/svg" width="960" height="540" viewBox="0 0 960 540"><rect x="0" y="0" width="960" height="540" fill="#ffffff"/></svg>');
  });

  it('puts the fonts the pictures name into them, Latin Extended only when a text needs it', async () => {
    const { document, page, frames } = deckDocument();
    const pictures = renderSlidePictures(document, page, frames, () => '');
    expect(slideFontFamilies(pictures[0]!.svg)).toEqual(['Inter', 'Caveat']);
    const load = vi.fn(async (family: string, subset: string) => (family === 'Caveat' && subset === 'latin-ext' ? null : `${family}/${subset}`));
    const style = await slideFontStyle(pictures, load);
    expect(load.mock.calls).toEqual([['Inter', 'latin'], ['Inter', 'latin-ext'], ['Caveat', 'latin'], ['Caveat', 'latin-ext']]);
    expect(style.match(/@font-face/g)).toHaveLength(3);
    expect(style).toContain('font-family:"Inter";font-style:normal;font-weight:100 900;src:url(data:font/woff2;base64,Inter/latin) format("woff2")');
    expect(withSlideFonts(pictures[0]!, style).startsWith(`<svg xmlns="http://www.w3.org/2000/svg" width="960" height="540" viewBox="0 0 960 540"><style>@font-face`)).toBe(true);

    const latin = renderSlidePictures({ ...document, elements: document.elements.filter((entry) => entry.id !== 'text:second') }, page, frames, () => '');
    const onlyLatin = vi.fn(async () => { throw new Error('offline'); });
    expect(await slideFontStyle(latin, onlyLatin)).toBe('');
    expect(onlyLatin.mock.calls).toEqual([['Inter', 'latin']]);
    expect(withSlideFonts(latin[0]!, '')).toBe(latin[0]!.svg);
  });

  it('builds the deck from the frames in their order, with the pictures the renderer returns', async () => {
    const { document, page, frames } = deckDocument();
    const drawn: Array<{ width: number; height: number; fonts: boolean }> = [];
    const deck = await buildSlideDeck(document, page, [frames[1]!, frames[0]!], {
      title: document.title, language: 'en-US', created: CREATED, slideName: (index) => `Slide ${index + 1}`,
      rasterize: async (svg, width, height) => { drawn.push({ width, height, fonts: svg.includes('@font-face') }); return PNG; },
      loadFont: async () => 'AAAA',
    });
    expect(drawn).toEqual([{ width: 800, height: 600, fonts: true }, { width: 960, height: 540, fonts: true }]);
    const files = parts(deck);
    expect(xml(files, 'ppt/presentation.xml')).toContain('<p:sldSz cx="12192000" cy="9144000"/>');
    expect(xml(files, 'ppt/slides/slide1.xml')).toContain('name="Slide 1"');
    expect(xml(files, 'ppt/slides/slide2.xml')).toContain('name="Einführung"');
    expect(xml(files, 'ppt/notesSlides/notesSlide2.xml')).toContain('<a:t>Begrüßung</a:t>');
    expect(files.has('ppt/notesSlides/notesSlide1.xml')).toBe(false);
  });
});

describe('PowerPoint through the export bridge (#266)', () => {
  const deck = buildPptx(SLIDES, OPTIONS);
  const base64 = bytesToBase64(deck);

  it('is base64 at the IPC boundary and written as its bytes with a .pptx suggestion', async () => {
    expect(base64).toBe(Buffer.from(deck).toString('base64'));
    expect(validateExportFileRequest({ contents: base64, suggestedName: 'Deck', format: 'pptx' }).ok).toBe(true);
    expect(validateExportFileRequest({ contents: 'not base64!', suggestedName: 'Deck', format: 'pptx' })).toMatchObject({ ok: false, error: { code: 'INVALID_REQUEST' } });
    expect(validateExportFileRequest({ contents: 'abc', suggestedName: 'Deck', format: 'pptx' })).toMatchObject({ ok: false });

    const directory = await mkdtemp(path.join(os.tmpdir(), 'sketchdraw-pptx-export-'));
    const destination = path.join(directory, 'actual.pptx');
    let request: unknown;
    try {
      const service = new DocumentPersistenceService({ dialogs: {
        showOpenDialog: async () => ({ canceled: true, filePaths: [] }),
        showSaveDialog: async (options) => { request = options; return { canceled: false, filePath: destination }; },
      } });
      expect(await service.exportFile({ contents: base64, suggestedName: '../Quartalsbericht.pptx', format: 'pptx' })).toEqual({ status: 'exported', name: 'actual.pptx' });
      expect(request).toMatchObject({ title: 'Folien exportieren', defaultPath: 'Quartalsbericht.pptx', filters: [{ name: 'PowerPoint Presentation', extensions: ['pptx'] }] });
      expect(new Uint8Array(await readFile(destination))).toEqual(deck);
      // Base64 of something that is not a package is refused before the dialog opens.
      request = undefined;
      expect(await service.exportFile({ contents: Buffer.from('<html></html>').toString('base64'), suggestedName: 'Deck', format: 'pptx' })).toMatchObject({ status: 'error', code: 'INVALID_EXPORT' });
      expect(await service.exportFile({ contents: '', suggestedName: 'Deck', format: 'pptx' })).toMatchObject({ status: 'error', code: 'EMPTY_EXPORT' });
      expect(request).toBeUndefined();
    } finally { await rm(directory, { recursive: true, force: true }); }
  });

  it('is downloaded in the browser as a PowerPoint file with the same bytes', async () => {
    let blob: Blob | undefined; let clicked = 0;
    const anchor = { href: '', download: '', rel: '', style: { display: '' }, click: () => { clicked += 1; }, remove: () => {} };
    const bridge = createBrowserDesktopBridge({ dom: {
      createDownloadAnchor: () => anchor,
      createObjectUrl: (value) => { blob = value; return 'blob:pptx'; },
      revokeObjectUrl: () => {}, scheduleRevoke: () => {},
    } });
    expect(await bridge.exportFile(base64, '../Quartalsbericht', 'pptx')).toEqual({ status: 'download-initiated', name: 'Quartalsbericht.pptx' });
    expect(blob?.type).toBe('application/vnd.openxmlformats-officedocument.presentationml.presentation');
    expect(new Uint8Array(await blob!.arrayBuffer())).toEqual(deck);
    expect(await bridge.exportFile('not base64!', 'Deck', 'pptx')).toMatchObject({ status: 'error', code: 'INVALID_REQUEST' });
    expect(await bridge.exportFile(btoa('<html></html>'), 'Deck', 'pptx')).toMatchObject({ status: 'error', code: 'INVALID_EXPORT' });
    expect(clicked).toBe(1);
  });
});

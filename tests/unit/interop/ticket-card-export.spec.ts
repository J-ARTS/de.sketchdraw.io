import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { createDocument, createElement, readTicketCard, type SketchDocument } from '@/domain';
import { importDrawio, importMermaid, importSvg, prepareDrawioExport, prepareMermaidExport, prepareSvgExport } from '@/interop';

// #283: a ticket card is exported as the card of the canvas (svg-v4, drawio-v6) and as a node with key and title
// (mermaid-v3). Build 66857f3 wrote cards as rectangles with the title under the numbers before; its files are in
// tests/fixtures/interop/intermediate and still come back as their own documents.
const file = (name: string) => readFileSync(`tests/fixtures/interop/intermediate/tickets-66857f3.${name}`, 'utf8');
const projectionOf = (envelope: string) => JSON.parse(Buffer.from(envelope, 'base64').toString('utf8')).projection as string;
const svgProjection = (svg: string) => projectionOf(/<sd:document[^>]*>([^<]+)</.exec(svg)![1]!);
const drawioProjection = (drawio: string) => projectionOf(/sketchdrawInterop="([^"]+)"/.exec(drawio)![1]!);
const mermaidProjection = (mermaid: string) => projectionOf(/^%% sketchdraw-mermaid-v1 \d+ (\S+)$/m.exec(mermaid)![1]!);
const cards = (document: SketchDocument) => document.elements.flatMap((element) => { const data = readTicketCard(element); return data ? [data] : []; });
/** The document of the fixtures: a Jira card with every field, an Azure card with a title only, a plain rectangle. */
const document = (): SketchDocument => importSvg(file('svg')).document;
const codes = (result: { diagnostics: ReadonlyArray<{ code: string }> }) => result.diagnostics.map((entry) => entry.code);

describe('ticket cards in exports (#283)', () => {
  it('the SVG shows the card of the canvas: key, state, title, assignee, estimate, labels, components and the time of the read', () => {
    const svg = prepareSvgExport(document()).contents;
    expect(svgProjection(svg)).toBe('svg-v4');
    const visible = svg.replace(/<metadata>.*<\/metadata>/s, '');
    for (const text of ['>ARCH-12<', '>In Progress<', 'Warenkorb übersteht den', 'Mara Lind  ·  Schätzung: 5', '>checkout<', '>q1<', '>Storefront<', '>Stand 2026-11-22 08:12 UTC<', '>#4711<', '>New<', '>Checkout absichern<', '>Niemand zugewiesen<', '>Form<'])
      expect(visible, text).toContain(text);
    // The marks of the trackers, and no second copy of the title as the text of the rectangle.
    expect(visible).toContain('fill="#1868db"'); expect(visible).toContain('fill="#0078d4"');
    expect(visible.match(/Checkout absichern/g)).toHaveLength(1);
    const back = importSvg(svg);
    expect(back.fidelity).toBe('own-roundtrip');
    expect(cards(back.document).map((card) => card.key)).toEqual(['ARCH-12', '4711']);
    expect(cards(back.document)[0]).toMatchObject({ status: 'doing', assignee: 'Mara Lind', labels: ['checkout', 'q1'], components: ['Storefront'], estimate: '5', description: 'Der Warenkorb wird am Konto gespeichert.' });
  });

  it('a rounded rectangle fills its box with its corner radius, as on the canvas, and comes back as one', () => {
    const svg = prepareSvgExport(document()).contents;
    // The card is 320 × 176 with a radius of 12; before picture 4 its outline was the smaller toolbar symbol.
    expect(svg).toContain('<rect x="0" y="0" width="320" height="176" rx="12" ry="12" data-sketchdraw-shape="rounded"');
    expect(file('svg')).not.toContain('<rect x="0" y="0" width="320" height="176" rx="12"');
    // Without the embedded document the visible rectangle is still a rounded rectangle with its radius.
    const base = createDocument('Rund');
    const plain = { ...base, elements: [createElement('rectangle', { id: 'r', pageId: base.pages[0]!.id, x: 10, y: 20, width: 240, height: 120, shapeVariant: 'rounded', style: { ...createElement('rectangle').style, cornerRadius: 20 } })] };
    const visible = importSvg(prepareSvgExport(plain).contents.replace(/<metadata>.*<\/metadata>/s, ''));
    expect(visible.document.elements.filter((element) => element.kind === 'rectangle').map((element) => [element.kind, element.shapeVariant, element.width, element.height, element.style.cornerRadius, element.text])).toEqual([['rectangle', 'rounded', 240, 120, 20, undefined]]);
    expect(visible.diagnostics.map((entry) => entry.code)).not.toContain('STYLE_APPROXIMATED');
  });

  it('the picture does not depend on language or time zone of the device', () => {
    const first = prepareSvgExport(document()).contents;
    const zone = process.env.TZ;
    try { process.env.TZ = 'Pacific/Auckland'; expect(prepareSvgExport(document()).contents).toBe(first); }
    finally { if (zone === undefined) delete process.env.TZ; else process.env.TZ = zone; }
  });

  it('draw.io gets the card as a picture with key and title as its hidden text', () => {
    const drawio = prepareDrawioExport(document()).contents;
    expect(drawioProjection(drawio)).toBe('drawio-v6');
    const cell = /<mxCell [^>]*value="ARCH-12: Warenkorb übersteht den Gerätewechsel"[^>]*>/.exec(drawio)![0];
    expect(cell).toContain('shape=image'); expect(cell).toContain('image=data:image/svg+xml,'); expect(cell).toContain('noLabel=1');
    // The picture is the card: its key is drawn inside.
    const picture = Buffer.from(/image=data:image\/svg\+xml,([A-Za-z0-9+/=]+)/.exec(cell)![1]!, 'base64').toString('utf8');
    expect(picture).toContain('>ARCH-12<'); expect(picture).toContain('>In Progress<');
    // A plain rectangle stays a shape of draw.io.
    expect(/<mxCell [^>]*value="Form"[^>]*>/.exec(drawio)![0]).not.toContain('shape=image');
    const back = importDrawio(drawio);
    expect(back.fidelity).toBe('own-roundtrip');
    expect(cards(back.document)).toHaveLength(2);
  });

  it('Mermaid names the card by key and title', () => {
    const mermaid = prepareMermaidExport(document()).contents;
    expect(mermaidProjection(mermaid)).toBe('mermaid-v3');
    // A colon is written as its entity, like in every label of the Mermaid export.
    expect(mermaid).toContain('n0("ARCH-12#58; Warenkorb übersteht den Gerätewechsel")');
    expect(mermaid).toContain('n1("4711#58; Checkout absichern")');
    const back = importMermaid(mermaid);
    expect(back.fidelity).toBe('own-roundtrip');
    expect(cards(back.document)).toHaveLength(2);
  });

  it('a card that was changed outside is noticed in every format', () => {
    const svg = prepareSvgExport(document()).contents, drawio = prepareDrawioExport(document()).contents, mermaid = prepareMermaidExport(document()).contents;
    expect(codes(importSvg(svg.replace('>In Progress<', '>Done<')))).toContain('EMBEDDED_MODEL_STALE');
    // In draw.io the card is its picture: another picture in its place is another card.
    const pictures = [...drawio.matchAll(/image=data:image\/svg\+xml,([A-Za-z0-9+/=]+)/g)].map((match) => match[1]!);
    expect(pictures).toHaveLength(2);
    expect(codes(importDrawio(drawio.replace(pictures[0]!, pictures[1]!)))).toContain('EMBEDDED_MODEL_STALE');
    expect(codes(importMermaid(mermaid.replace('4711#58; Checkout absichern', '4711#58; Checkout öffnen')))).toContain('EMBEDDED_MODEL_STALE');
  });

  it('the files of build 66857f3 name the earlier pictures and come back as the whole document', () => {
    expect(svgProjection(file('svg'))).toBe('svg-v3');
    expect(drawioProjection(file('drawio'))).toBe('drawio-v5');
    expect(mermaidProjection(file('mmd'))).toBe('mermaid-v2');
    for (const [name, result] of [['svg', importSvg(file('svg'))], ['drawio', importDrawio(file('drawio'))], ['mmd', importMermaid(file('mmd'))]] as const) {
      expect(result.fidelity, name).toBe('own-roundtrip');
      expect(codes(result), name).not.toContain('EMBEDDED_MODEL_STALE');
      expect(cards(result.document).map((card) => card.key), name).toEqual(['ARCH-12', '4711']);
    }
    // There the card was a rectangle with its title.
    expect(file('svg')).not.toContain('>ARCH-12<');
    expect(/<mxCell [^>]*value="Warenkorb übersteht den Gerätewechsel"[^>]*>/.exec(file('drawio'))![0]).not.toContain('shape=image');
    expect(codes(importSvg(file('svg').replace('Checkout absichern', 'Checkout öffnen')))).toContain('EMBEDDED_MODEL_STALE');
  });
});

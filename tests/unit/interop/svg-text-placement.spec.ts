import { describe, expect, it } from 'vitest';
import { createDocument, createElement, type ElementStyle, type SketchElement } from '@/domain';
import { importSvg, prepareDrawioExport, prepareSvgExport } from '@/interop';
import { svgProjectionForValidation } from '@/interop/export';

// #277: the SVG export places the text of shapes and of free text as the canvas does.
function page(elements: Array<Partial<SketchElement> & { kind: SketchElement['kind'] }>) {
  const document = createDocument('Test');
  return { ...document, elements: elements.map(({ kind, ...rest }, index) => createElement(kind, { id: `e${index}`, pageId: document.pages[0]!.id, x: index * 200, y: 0, width: 160, height: 90, ...rest })) };
}
const style = (value: Partial<ElementStyle>) => value as ElementStyle;
/** The lines of the text of element `index`: position and characters. */
function lines(svg: string, index: number) {
  const group = new RegExp(`<g id="sd-${index}"[^>]*>(.*?)</g>`, 's').exec(svg)![1]!;
  return [...group.matchAll(/<tspan x="([^"]+)" y="([^"]+)">([^<]*)<\/tspan>/g)].map((match) => ({ x: Number(match[1]), y: Number(match[2]), text: match[3]! }));
}
const anchor = (svg: string, index: number) => new RegExp(`<g id="sd-${index}"[^>]*>.*?text-anchor="([a-z]+)"`, 's').exec(svg)![1];
const BASELINE = 16 * .93;

describe('SVG export: text of shapes', () => {
  it('stands in the middle of a shape, across and down', () => {
    const svg = prepareSvgExport(page([{ kind: 'rectangle', text: 'API', style: style({ textAlign: 'center' }) }]), { embedDocument: false }).contents;
    expect(lines(svg, 0)).toEqual([{ x: 80, y: (90 - 20) / 2 + BASELINE, text: 'API' }]);
    expect(anchor(svg, 0)).toBe('middle');
  });

  it('follows the three alignments across, 8 px from the side', () => {
    const svg = prepareSvgExport(page([
      { kind: 'rectangle', text: 'API', style: style({ textAlign: 'left' }) },
      { kind: 'ellipse', text: 'API', style: style({ textAlign: 'center' }) },
      { kind: 'diamond', text: 'API', style: style({ textAlign: 'right' }) },
    ]), { embedDocument: false }).contents;
    expect([0, 1, 2].map((index) => lines(svg, index)[0]!.x)).toEqual([8, 80, 152]);
    expect([0, 1, 2].map((index) => anchor(svg, index))).toEqual(['start', 'middle', 'end']);
  });

  it('follows the three alignments down, 4 px from the edge', () => {
    const svg = prepareSvgExport(page([
      { kind: 'rectangle', text: 'API', style: style({ verticalAlign: 'top' }) },
      { kind: 'rectangle', text: 'API', style: style({ verticalAlign: 'middle' }) },
      { kind: 'rectangle', text: 'API', style: style({ verticalAlign: 'bottom' }) },
    ]), { embedDocument: false }).contents;
    expect([0, 1, 2].map((index) => lines(svg, index)[0]!.y)).toEqual([4 + BASELINE, 35 + BASELINE, 66 + BASELINE]);
  });

  it('breaks long text between words into the lines of the canvas, 1.25 line height, and stops where the shape ends', () => {
    // 160 wide, 16 px: (160 - 16) / 9.6 = 15 characters per line; 90 high: 4 lines of 20.
    const text = 'Ein langer Text, der umbrochen wird, und noch viel mehr Text danach, der nicht passt';
    const svg = prepareSvgExport(page([{ kind: 'rectangle', text, style: style({ textAlign: 'left' }) }]), { embedDocument: false }).contents;
    const drawn = lines(svg, 0);
    expect(drawn.map((line) => line.text)).toEqual(['Ein langer', 'Text, der', 'umbrochen wird,', 'und noch viel']);
    expect(drawn.map((line) => line.y)).toEqual([0, 1, 2, 3].map((index) => 5 + BASELINE + index * 20));
  });

  it('keeps the line breaks of the text', () => {
    const svg = prepareSvgExport(page([{ kind: 'rectangle', text: 'A\n\nB', style: style({ textAlign: 'center' }) }]), { embedDocument: false }).contents;
    expect(lines(svg, 0).map((line) => line.text)).toEqual(['A', '', 'B']);
  });

  it('free text starts at its left edge and at the top unless it says otherwise', () => {
    const svg = prepareSvgExport(page([
      { kind: 'text', text: 'Frei', height: 80 },
      { kind: 'text', text: 'Frei', height: 80, style: style({ textAlign: 'center', verticalAlign: 'middle' }) },
    ]), { embedDocument: false }).contents;
    expect(lines(svg, 0)).toEqual([{ x: 0, y: BASELINE, text: 'Frei' }]);
    expect(lines(svg, 1)).toEqual([{ x: 80, y: 30 + BASELINE, text: 'Frei' }]);
  });

  it('pictures 1 and 2 are still drawn as they were, for files written with them', () => {
    const document = page([{ kind: 'rectangle', text: 'API', style: style({ textAlign: 'left' }) }]);
    const before = svgProjectionForValidation(document, 2), now = svgProjectionForValidation(document, 3);
    expect(lines(before, 0)).toEqual([{ x: 0, y: 16, text: 'API' }]);
    expect(lines(now, 0)).toEqual([{ x: 8, y: 35 + BASELINE, text: 'API' }]);
  });

  it('a file of today comes back from its embedded document', () => {
    const document = page([{ kind: 'rectangle', text: 'Ein langer Text, der umbrochen wird', style: style({ verticalAlign: 'bottom' }) }]);
    const result = importSvg(prepareSvgExport(document).contents);
    expect(result.fidelity).toBe('own-roundtrip');
    expect(result.document.elements[0]).toMatchObject({ text: 'Ein langer Text, der umbrochen wird', style: { verticalAlign: 'bottom' } });
  });

  it('notes and components keep their picture; the pictures inside a draw.io file do not follow the SVG picture', () => {
    const document = page([{ kind: 'sticky-note', width: 240, height: 240, text: 'Eine Notiz mit einem langen Text, der im Bild nicht umbrochen wird', author: 'Ada' }]);
    expect(lines(svgProjectionForValidation(document, 3), 0)).toEqual(lines(svgProjectionForValidation(document, 2), 0));
    const picture = /image=data:image\/svg\+xml,([^;"]+)/.exec(prepareDrawioExport(document, { embedDocument: false }).contents)![1]!;
    const inner = Buffer.from(picture, 'base64').toString('utf8');
    expect(inner).toContain('<svg');
  });
});

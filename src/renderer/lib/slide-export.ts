import type { SketchDocument, SketchElement } from '@/domain';
import { prepareSvgExport } from '@/interop';
import { buildPptx, type PptxSlide } from './pptx';
import { slideNotes } from './slide-notes';

/** One slide as a picture: the part of the page inside its frame, on a white sheet, as the SVG export draws it. */
export interface SlidePicture {
  frameId: string;
  name: string;
  notes: string;
  svg: string;
  /** Size in CSS pixels: the size of the frame. */
  width: number;
  height: number;
}

const SVG_NS = 'http://www.w3.org/2000/svg';
const number = (value: number): string => String(Math.round(value * 100) / 100);

/**
 * The slides of a page as pictures (#266), in the order given. The frames themselves are not drawn, as in the
 * presentation: a slide shows what lies inside its frame, cut at the edge of the frame. The export runs without the
 * embedded document, so comments, tasks and notes never reach the pictures.
 */
export function renderSlidePictures(document: SketchDocument, pageId: string, frames: readonly SketchElement[], slideName: (index: number) => string): SlidePicture[] {
  if (!frames.length) return [];
  const frameIds = new Set(document.elements.filter((element) => element.kind === 'frame').map((element) => element.id));
  const elements = document.elements.filter((element) => !frameIds.has(element.id)).map((element) => {
    if (!element.parentId || !frameIds.has(element.parentId)) return element;
    const { parentId: _frame, ...free } = element;
    return free as SketchElement;
  });
  let inner = '';
  if (elements.some((element) => element.pageId === pageId)) {
    const exported = prepareSvgExport({ ...document, elements }, { pageId, embedDocument: false }).contents;
    const root = /^<svg xmlns="[^"]*" viewBox="[^"]*">/.exec(exported);
    if (!root || !exported.endsWith('</svg>')) throw new Error('The SVG export has an unexpected shape.');
    inner = exported.slice(root[0].length, -'</svg>'.length).replace(/^<title>[^<]*<\/title>/, '');
  }
  return frames.map((frame, index) => {
    const width = Math.max(1, frame.width); const height = Math.max(1, frame.height);
    const box = `x="${number(frame.x)}" y="${number(frame.y)}" width="${number(width)}" height="${number(height)}"`;
    return {
      frameId: frame.id,
      name: frame.label?.trim() || slideName(index),
      notes: slideNotes(frame),
      svg: `<svg xmlns="${SVG_NS}" width="${number(width)}" height="${number(height)}" viewBox="${number(frame.x)} ${number(frame.y)} ${number(width)} ${number(height)}"><rect ${box} fill="#ffffff"/>${inner}</svg>`,
      width,
      height,
    };
  });
}

/**
 * The SVG export names its fonts by family (`Inter`, `Caveat`, …). A picture loaded from an SVG cannot reach the fonts
 * of the page, so without them the text would be drawn in whatever the computer has. The fonts the picture uses are
 * therefore put into it. Characters outside Latin and Latin Extended fall back to a font of the system.
 */
export const SLIDE_FONT_FAMILIES = ['Inter', 'JetBrains Mono', 'Roboto', 'Caveat'] as const;
export type SlideFontFamily = (typeof SLIDE_FONT_FAMILIES)[number];
export type SlideFontSubset = 'latin' | 'latin-ext';
/** Gives one font file as base64 (WOFF2), or null when it cannot be had; the picture then uses a font of the system. */
export type SlideFontLoader = (family: SlideFontFamily, subset: SlideFontSubset) => Promise<string | null>;

const LATIN_RANGE = 'U+0000-00FF,U+0131,U+0152-0153,U+02BB-02BC,U+02C6,U+02DA,U+02DC,U+0304,U+0308,U+0329,U+2000-206F,U+20AC,U+2122,U+2191,U+2193,U+2212,U+2215,U+FEFF,U+FFFD';
const LATIN_EXT_RANGE = 'U+0100-02BA,U+02BD-02C5,U+02C7-02CC,U+02CE-02D7,U+02DD-02FF,U+1D00-1DBF,U+1E00-1E9F,U+1EF2-1EFF,U+2020,U+20A0-20AB,U+20AD-20C0,U+2113,U+2C60-2C7F,U+A720-A7FF';
const NEEDS_LATIN_EXT = /[Ā-ʺḀ-ỿⱠ-Ɀ꜠-ꟿ]/;

/** The families whose name stands first in a `font-family` of the picture. */
export function slideFontFamilies(svg: string): SlideFontFamily[] {
  const used = new Set<string>();
  for (const match of svg.matchAll(/font-family="([^",]+)/g)) used.add(match[1]!.trim());
  return SLIDE_FONT_FAMILIES.filter((family) => used.has(family));
}

/** The `<style>` with the fonts of these pictures; empty when no picture names one of our fonts or none could be loaded. */
export async function slideFontStyle(pictures: readonly SlidePicture[], load: SlideFontLoader): Promise<string> {
  const all = pictures.map((picture) => picture.svg).join('');
  const subsets: SlideFontSubset[] = NEEDS_LATIN_EXT.test(all) ? ['latin', 'latin-ext'] : ['latin'];
  const rules: string[] = [];
  for (const family of slideFontFamilies(all)) {
    for (const subset of subsets) {
      const data = await load(family, subset).catch(() => null);
      if (data) rules.push(`@font-face{font-family:"${family}";font-style:normal;font-weight:100 900;src:url(data:font/woff2;base64,${data}) format("woff2");unicode-range:${subset === 'latin' ? LATIN_RANGE : LATIN_EXT_RANGE}}`);
    }
  }
  return rules.length ? `<style>${rules.join('')}</style>` : '';
}

/** The picture with the fonts in it. */
export function withSlideFonts(picture: SlidePicture, style: string): string {
  return style ? picture.svg.replace(/^<svg [^>]*>/, (root) => `${root}${style}`) : picture.svg;
}

export interface SlideDeckOptions {
  title: string;
  /** Language of the speaker notes, e.g. `de-DE`. */
  language: string;
  slideName: (index: number) => string;
  created: Date;
  /** Draws an SVG into a PNG of the given size in CSS pixels. */
  rasterize: (svg: string, width: number, height: number) => Promise<Uint8Array>;
  loadFont: SlideFontLoader;
}

/** The slides of a page as a PowerPoint file: one picture per frame in the order given, speaker notes as notes (#266). */
export async function buildSlideDeck(document: SketchDocument, pageId: string, frames: readonly SketchElement[], options: SlideDeckOptions): Promise<Uint8Array> {
  const pictures = renderSlidePictures(document, pageId, frames, options.slideName);
  const fonts = await slideFontStyle(pictures, options.loadFont);
  const slides: PptxSlide[] = [];
  for (const picture of pictures) {
    slides.push({ name: picture.name, png: await options.rasterize(withSlideFonts(picture, fonts), picture.width, picture.height), width: picture.width, height: picture.height, notes: picture.notes });
  }
  return buildPptx(slides, { title: options.title, language: options.language, created: options.created });
}

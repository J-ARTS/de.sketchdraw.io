import type { ElementKind, ElementStyle, VerticalAlign } from './types';

/** Line height of plain element text, as a multiple of the font size. */
export const TEXT_LINE_HEIGHT = 1.25;
/** Average glyph width as a multiple of the font size; long lines are broken by this estimate. */
export const TEXT_CHAR_WIDTH = 0.6;
/** Distance between the text of a shape and its left or right side when it is aligned to that side. */
export const SHAPE_TEXT_SIDE_INSET = 8;

/** One drawn line: its characters and where they start in the whole text (for links on parts of the text). */
export interface TextLine { text: string; from: number }

/**
 * Breaks one line at word boundaries so that no chunk exceeds `max` characters; words longer than `max` are split.
 * `from` is the offset of the line in the whole text, each chunk reports its own start offset (for text links).
 * Spaces at a break are dropped.
 */
export function wrapWords(line: string, from: number, max: number): TextLine[] {
  const chunks: TextLine[] = [];
  let current = ''; let currentFrom = from; let at = from;
  const flush = () => { if (current !== '') chunks.push({ text: current.replace(/\s+$/, ''), from: currentFrom }); current = ''; };
  for (const token of line.match(/\S+|\s+/g) ?? []) {
    if (/^\s/.test(token)) {
      if (current !== '') current += token;
      at += token.length;
      continue;
    }
    const letters = Array.from(token);
    if (current !== '' && Array.from(current).length + letters.length > max) flush();
    if (current === '') currentFrom = at;
    if (letters.length > max) {
      for (let index = 0; index < letters.length; index += max) {
        const part = letters.slice(index, index + max).join('');
        if (current !== '') flush();
        currentFrom = at; current = part; at += part.length;
      }
    } else { current += token; at += token.length; }
  }
  flush();
  return chunks.length ? chunks : [{ text: '', from }];
}

/**
 * The lines plain element text is drawn in: the line breaks of the text, and every line that is longer than
 * `width - inset` broken at a word boundary (a word longer than a line is split). `charWidth` is the estimated
 * width of a character as a multiple of the font size. Canvas and SVG export share it, so an exported shape shows
 * the lines the canvas shows (#277).
 */
export function wrapTextLines(text: string, width: number, fontSize: number, inset: number, charWidth = TEXT_CHAR_WIDTH): TextLine[] {
  const max = Math.max(1, Math.floor((width - inset) / (fontSize * charWidth)));
  let offset = 0;
  return text.split('\n').flatMap((line) => { const chunks = wrapWords(line, offset, max); offset += line.length + 1; return chunks; });
}

/** How many lines of text an element of `height` shows; at least one. */
export function visibleLineCount(height: number, fontSize: number): number {
  return Math.max(1, Math.floor(height / (fontSize * TEXT_LINE_HEIGHT)));
}

/**
 * Kinds whose text can stand at the top, in the middle or at the bottom of the element. Every other kind has a
 * fixed place for its text: a title bar, a line below a symbol, the lines of a card or a note.
 */
const VERTICAL_ALIGN_KINDS: ReadonlySet<ElementKind> = new Set<ElementKind>(['text', 'rectangle', 'ellipse', 'diamond']);

/** Distance between the text and the edge it is aligned to, in document units. Free text has no frame and no distance. */
const SHAPE_TEXT_INSET = 4;

export function supportsVerticalAlign(kind: ElementKind): boolean {
  return VERTICAL_ALIGN_KINDS.has(kind);
}

/**
 * The vertical alignment of an element's text. An element without the field keeps what its kind has always
 * shown: shapes centre their text, free text starts at the top.
 */
export function verticalAlignOf(element: { kind: ElementKind; style: Pick<ElementStyle, 'verticalAlign'> }): VerticalAlign {
  return element.style.verticalAlign ?? (element.kind === 'text' ? 'top' : 'middle');
}

/** Distance between text and the edge it is aligned to for a kind that supports vertical alignment. */
export function verticalTextInset(kind: ElementKind): number {
  return kind === 'text' ? 0 : SHAPE_TEXT_INSET;
}

/**
 * Top of a block of text of `textHeight` inside an element of `height`. Text that is higher than its element
 * starts at the top edge distance instead of leaving the element upwards.
 */
export function alignedTextTop(align: VerticalAlign, height: number, textHeight: number, inset: number): number {
  const free = height - textHeight;
  return Math.max(inset, align === 'top' ? inset : align === 'bottom' ? free - inset : free / 2);
}

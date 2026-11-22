import type { ElementKind, ElementStyle, VerticalAlign } from './types';

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

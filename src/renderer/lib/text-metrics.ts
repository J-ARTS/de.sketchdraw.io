import { TEXT_CHAR_WIDTH, TEXT_LINE_HEIGHT, wrapTextLines, wrapWords } from '@/domain';

export { TEXT_CHAR_WIDTH, TEXT_LINE_HEIGHT, wrapWords };

/** Number of rendered lines of a text for a given box width: explicit line breaks plus wrapping of long lines. */
export function textLineCount(text: string, width: number, fontSize: number, inset: number): number {
  return wrapTextLines(text, width, fontSize, inset).length;
}

/** Height an auto-sizing free text needs so that every line is visible. */
export function fittedTextHeight(text: string, width: number, fontSize: number): number {
  return Math.max(Math.ceil(fontSize * TEXT_LINE_HEIGHT + 8), Math.ceil(textLineCount(text, width, fontSize, 0) * fontSize * TEXT_LINE_HEIGHT + 8));
}

/** Whether a free text is exactly as high as its lines need: nobody made its box higher or lower by hand. */
export function hasFittedTextHeight(element: { text?: string | null; width: number; height: number; style: { fontSize: number } }): boolean {
  return Math.abs(element.height - fittedTextHeight(element.text ?? '', element.width, element.style.fontSize)) <= 0.5;
}

/**
 * Height of a free text once it shows `text` in `fontSize`. A box that fitted its lines keeps following them;
 * a box the user made higher keeps its height, so the text has room to stand in the middle or at the bottom,
 * and only grows when the lines no longer fit.
 */
export function freeTextHeight(existing: { text?: string | null; width: number; height: number; style: { fontSize: number } } | null | undefined, text: string, width: number, fontSize: number): number {
  const fitted = fittedTextHeight(text, width, fontSize);
  return !existing || hasFittedTextHeight(existing) ? fitted : Math.max(existing.height, fitted);
}

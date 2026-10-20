/** Line height of plain element text, as a multiple of the font size (matches the canvas rendering). */
export const TEXT_LINE_HEIGHT = 1.25;
/** Average glyph width as a multiple of the font size, used to wrap long lines the way the canvas does. */
export const TEXT_CHAR_WIDTH = 0.6;

/** Number of rendered lines of a text for a given box width: explicit line breaks plus wrapping of long lines. */
export function textLineCount(text: string, width: number, fontSize: number, inset: number): number {
  const max = Math.max(1, Math.floor((width - inset) / (fontSize * TEXT_CHAR_WIDTH)));
  return text.split('\n').reduce((total, line) => total + Math.max(1, Math.ceil(Array.from(line).length / max)), 0);
}

/** Height an auto-sizing free text needs so that every line is visible. */
export function fittedTextHeight(text: string, width: number, fontSize: number): number {
  return Math.max(Math.ceil(fontSize * TEXT_LINE_HEIGHT + 8), Math.ceil(textLineCount(text, width, fontSize, 0) * fontSize * TEXT_LINE_HEIGHT + 8));
}

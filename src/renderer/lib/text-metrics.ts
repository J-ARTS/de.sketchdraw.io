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

/**
 * Breaks one line at word boundaries so that no chunk exceeds `max` characters; words longer than `max` are split.
 * `from` is the offset of the line in the whole text, each chunk reports its own start offset (for text links).
 * Spaces at a break are dropped.
 */
export function wrapWords(line: string, from: number, max: number): Array<{ text: string; from: number }> {
  const chunks: Array<{ text: string; from: number }> = [];
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

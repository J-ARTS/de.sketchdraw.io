/** Bullet lists for plain text: only the selected lines get the bullet, the rest of the text stays as it is. */
export const BULLET = '• ';

export interface BulletResult { text: string; start: number; end: number; active: boolean }

interface LineRange { from: number; to: number }

/** Lines touched by the selection; a selection ending right after a line break does not include the next line. */
function selectedLines(text: string, start: number, end: number): LineRange[] {
  const first = text.lastIndexOf('\n', Math.max(0, start) - 1) + 1;
  const last = end > start && text[end - 1] === '\n' ? end - 1 : end;
  const lines: LineRange[] = [];
  let from = first;
  for (;;) {
    const newline = text.indexOf('\n', from);
    const to = newline === -1 ? text.length : newline;
    lines.push({ from, to });
    if (newline === -1 || newline >= last) break;
    from = newline + 1;
  }
  return lines;
}

/** True when every non-empty selected line already starts with a bullet (and at least one line has text). */
export function bulletsActive(text: string, start: number, end: number): boolean {
  const lines = selectedLines(text, start, end).filter((line) => line.to > line.from);
  return lines.length > 0 && lines.every((line) => text.startsWith(BULLET, line.from));
}

/** Adds the bullet to the selected lines, or removes it when all of them are bulleted already. */
export function toggleBullets(text: string, start: number, end: number): BulletResult {
  const lines = selectedLines(text, start, end);
  const remove = bulletsActive(text, start, end);
  const single = lines.length === 1;
  let result = '';
  let cursor = 0;
  let newStart = start;
  let newEnd = end;
  for (const line of lines) {
    result += text.slice(cursor, line.from);
    const body = text.slice(line.from, line.to);
    const hasBullet = body.startsWith(BULLET);
    let next = body;
    let delta = 0;
    if (remove && hasBullet) { next = body.slice(BULLET.length); delta = -BULLET.length; }
    else if (!remove && !hasBullet && (body.length > 0 || single)) { next = BULLET + body; delta = BULLET.length; }
    result += next;
    cursor = line.to;
    if (delta !== 0) {
      if (start > line.from) newStart += Math.max(delta, -(start - line.from));
      if (end > line.from) newEnd += Math.max(delta, -(end - line.from));
    }
  }
  result += text.slice(cursor);
  return { text: result, start: Math.max(0, newStart), end: Math.max(0, newEnd), active: !remove };
}

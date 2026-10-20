/** Hyperlinks on a part of an element's plain text. Stored as JSON in the element metadata (no schema change). */
export const TEXT_LINKS_KEY = 'sketchdraw.text.links';
export const MAX_TEXT_LINKS = 100;

export interface TextLink { start: number; end: number; url: string }

/** Only absolute http(s) addresses without credentials can be linked. */
export function normalizeLinkUrl(input: string): string | null {
  const value = input.trim();
  if (!value) return null;
  try {
    const url = new URL(/^[a-z][a-z0-9+.-]*:/i.test(value) ? value : `https://${value}`);
    if (!['http:', 'https:'].includes(url.protocol) || !url.hostname || url.username || url.password) return null;
    return url.href;
  } catch { return null; }
}

/** Reads the stored links, dropping anything invalid, clamping to the text and sorting by position. */
export function parseTextLinks(metadata: Record<string, string> | undefined, textLength: number): TextLink[] {
  const raw = metadata?.[TEXT_LINKS_KEY];
  if (!raw) return [];
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    const links: TextLink[] = [];
    for (const entry of parsed.slice(0, MAX_TEXT_LINKS)) {
      if (typeof entry !== 'object' || entry === null) continue;
      const { s, e, u } = entry as Record<string, unknown>;
      if (!Number.isInteger(s) || !Number.isInteger(e) || typeof u !== 'string') continue;
      const start = Math.max(0, s as number); const end = Math.min(textLength, e as number);
      const url = normalizeLinkUrl(u);
      if (end > start && url) links.push({ start, end, url });
    }
    return links.sort((a, b) => a.start - b.start).reduce<TextLink[]>((kept, link) => (kept.length && link.start < kept.at(-1)!.end ? kept : [...kept, link]), []);
  } catch { return []; }
}

export function serializeTextLinks(links: readonly TextLink[]): string | null {
  return links.length ? JSON.stringify(links.map((link) => ({ s: link.start, e: link.end, u: link.url }))) : null;
}

export function sameTextLinks(a: readonly TextLink[], b: readonly TextLink[]): boolean {
  return a.length === b.length && a.every((link, index) => link.start === b[index]!.start && link.end === b[index]!.end && link.url === b[index]!.url);
}

/** The link covering the caret (collapsed selection) or overlapping the selection. */
export function linkAt(links: readonly TextLink[], start: number, end: number): TextLink | undefined {
  return end > start ? links.find((link) => link.start < end && link.end > start) : links.find((link) => link.start < start && link.end >= start);
}

/** Puts a link on [start, end): links it overlaps are cut back or replaced. */
export function setLink(links: readonly TextLink[], start: number, end: number, url: string): TextLink[] {
  if (end <= start) return [...links];
  const result: TextLink[] = [];
  for (const link of links) {
    if (link.end <= start || link.start >= end) { result.push(link); continue; }
    if (link.start < start) result.push({ ...link, end: start });
    if (link.end > end) result.push({ ...link, start: end });
  }
  result.push({ start, end, url });
  return result.sort((a, b) => a.start - b.start);
}

/** Removes the link under the caret, or every link touching the selection. */
export function removeLinks(links: readonly TextLink[], start: number, end: number): TextLink[] {
  const hit = end > start ? links.filter((link) => link.start < end && link.end > start) : [linkAt(links, start, end)].filter((link): link is TextLink => Boolean(link));
  return links.filter((link) => !hit.includes(link));
}

/** Keeps links attached to their words when the text is edited: shifts, grows, shrinks or drops them. */
export function shiftLinks(links: readonly TextLink[], before: string, after: string): TextLink[] {
  if (before === after || !links.length) return [...links];
  let prefix = 0;
  const limit = Math.min(before.length, after.length);
  while (prefix < limit && before[prefix] === after[prefix]) prefix += 1;
  let suffix = 0;
  while (suffix < limit - prefix && before[before.length - 1 - suffix] === after[after.length - 1 - suffix]) suffix += 1;
  const removedEnd = before.length - suffix; // old range [prefix, removedEnd) became [prefix, afterEnd)
  const afterEnd = after.length - suffix;
  const delta = afterEnd - removedEnd;
  const result: TextLink[] = [];
  for (const link of links) {
    let { start, end } = link;
    if (end <= prefix) { result.push(link); continue; } // before the change
    if (start >= removedEnd) { result.push({ ...link, start: start + delta, end: end + delta }); continue; } // after the change
    // The change touches the link: keep the part before it, and what follows it moves along (typing inside extends the link).
    start = Math.min(start, prefix);
    end = end > removedEnd ? end + delta : Math.max(afterEnd, start);
    if (end > start) result.push({ ...link, start, end });
  }
  return result;
}

export interface LineSegment { text: string; url?: string }

/** Splits one rendered line (absolute offset `from`) into plain and linked segments. */
export function lineSegments(line: string, from: number, links: readonly TextLink[]): LineSegment[] {
  if (!links.length) return [{ text: line }];
  const to = from + line.length;
  const segments: LineSegment[] = [];
  let cursor = from;
  for (const link of links) {
    if (link.end <= cursor || link.start >= to) continue;
    const start = Math.max(link.start, cursor); const end = Math.min(link.end, to);
    if (start > cursor) segments.push({ text: line.slice(cursor - from, start - from) });
    segments.push({ text: line.slice(start - from, end - from), url: link.url });
    cursor = end;
  }
  if (cursor < to) segments.push({ text: line.slice(cursor - from) });
  return segments.length ? segments : [{ text: line }];
}

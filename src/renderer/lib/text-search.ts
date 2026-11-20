/**
 * Searching and replacing in the text of a field (#245): the rules behind the find bar. Everything here works
 * on plain strings, so the same rules hold for every field the bar is attached to.
 */
export interface TextSearchOptions {
  /** Upper and lower case must match. */
  matchCase: boolean;
  /** A hit must not touch a letter, digit or underscore on either side. */
  wholeWord: boolean;
  /** The query is a regular expression; otherwise it is searched as typed. */
  regex: boolean;
}

export interface TextMatch {
  start: number;
  end: number;
  /** The capture groups of a regular expression, with the whole hit at index 0. */
  groups: ReadonlyArray<string | undefined>;
  named?: Readonly<Record<string, string | undefined>>;
}

/** More hits than this are not collected; the bar then shows the number as a lower bound. */
export const MAX_TEXT_MATCHES = 5000;

export type SearchPattern =
  /** `pattern` is null while there is nothing to search for. */
  | { ok: true; pattern: RegExp | null }
  /** The regular expression cannot be read; `message` is the engine's reason. */
  | { ok: false; message: string };

const escapeLiteral = (text: string): string => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

export function buildSearchPattern(query: string, options: TextSearchOptions): SearchPattern {
  if (!query) return { ok: true, pattern: null };
  const source = options.regex ? query : escapeLiteral(query);
  const flags = `g${options.regex ? 'm' : ''}${options.matchCase ? '' : 'i'}`;
  // Unicode mode knows letters of every script for whole words, but it is stricter about escapes;
  // an expression it refuses is tried again the lenient way before it counts as an error.
  const attempts: Array<[string, string]> = [
    [options.wholeWord ? `(?<![\\p{L}\\p{N}_])(?:${source})(?![\\p{L}\\p{N}_])` : source, `${flags}u`],
    [options.wholeWord ? `(?<![\\w])(?:${source})(?![\\w])` : source, flags],
  ];
  let message = '';
  for (const [pattern, patternFlags] of attempts) {
    try { return { ok: true, pattern: new RegExp(pattern, patternFlags) }; } catch (error) { message ||= error instanceof Error ? error.message : String(error); }
    if (!options.regex) break;
  }
  return { ok: false, message };
}

/** All hits in reading order, at most `limit`. Empty hits (`^`, `a*`) are no places to go to and are left out. */
export function findMatches(text: string, pattern: RegExp | null, limit: number = MAX_TEXT_MATCHES): { matches: TextMatch[]; capped: boolean } {
  const matches: TextMatch[] = [];
  if (!pattern || !text) return { matches, capped: false };
  const search = new RegExp(pattern.source, pattern.flags);
  let found: RegExpExecArray | null;
  while ((found = search.exec(text)) !== null) {
    if (found[0].length === 0) {
      if (search.lastIndex >= text.length) break;
      search.lastIndex += 1;
      continue;
    }
    if (matches.length >= limit) return { matches, capped: true };
    matches.push({ start: found.index, end: found.index + found[0].length, groups: [...found], ...(found.groups ? { named: { ...found.groups } } : {}) });
  }
  return { matches, capped: false };
}

const hasLetters = (text: string): boolean => text.toLocaleLowerCase() !== text.toLocaleUpperCase();

/** Gives the replacement the spelling of what it replaces: all capitals, all small, or a capital first letter. */
export function preserveCase(found: string, replacement: string): string {
  if (!hasLetters(found) || !replacement) return replacement;
  if (found === found.toLocaleUpperCase()) return replacement.toLocaleUpperCase();
  if (found === found.toLocaleLowerCase()) return replacement.toLocaleLowerCase();
  const [first = '', ...rest] = Array.from(found);
  const [head = '', ...tail] = Array.from(replacement);
  if (first === first.toLocaleUpperCase() && first !== first.toLocaleLowerCase()) return head.toLocaleUpperCase() + tail.join('');
  if (first === first.toLocaleLowerCase() && rest.length) return head.toLocaleLowerCase() + tail.join('');
  return replacement;
}

export interface ReplaceOptions {
  /** With a regular expression the replacement may refer to groups (`$1`, `$<name>`, `$&`) and use `\n`, `\t`. */
  regex: boolean;
  preserveCase: boolean;
}

/** The text one hit is replaced with. */
export function replacementFor(match: TextMatch, replacement: string, options: ReplaceOptions): string {
  const found = match.groups[0] ?? '';
  let result = replacement;
  if (options.regex) {
    result = replacement.replace(/\\([ntr\\])|\$(\$|&|\d{1,2}|<([^>]*)>)/g, (whole, escape: string | undefined, reference: string | undefined, name: string | undefined) => {
      if (escape) return escape === 'n' ? '\n' : escape === 't' ? '\t' : escape === 'r' ? '\r' : '\\';
      if (reference === '$') return '$';
      if (reference === '&') return found;
      if (name !== undefined) return match.named && name in match.named ? match.named[name] ?? '' : whole;
      // `$12` means group 12 when there is one, otherwise group 1 followed by "2".
      const digits = reference ?? '';
      const full = Number(digits);
      if (full >= 1 && full < match.groups.length) return match.groups[full] ?? '';
      const single = Number(digits[0]);
      if (digits.length === 2 && single >= 1 && single < match.groups.length) return `${match.groups[single] ?? ''}${digits[1]}`;
      return whole;
    });
  }
  return options.preserveCase ? preserveCase(found, result) : result;
}

/** The text with every given hit replaced; `matches` are the hits of this very text, in reading order. */
export function replaceMatches(text: string, matches: readonly TextMatch[], replacement: string, options: ReplaceOptions): string {
  let result = '';
  let position = 0;
  for (const match of matches) {
    result += text.slice(position, match.start) + replacementFor(match, replacement, options);
    position = match.end;
  }
  return result + text.slice(position);
}

/** The first hit that starts at or after `offset`, wrapping around to the first one; -1 without hits. */
export function matchIndexFrom(matches: readonly TextMatch[], offset: number): number {
  if (!matches.length) return -1;
  const index = matches.findIndex((match) => match.start >= offset);
  return index === -1 ? 0 : index;
}

export interface TextSegment {
  text: string;
  /** Index of the hit this piece is, or -1 for the text between hits. */
  match: number;
}

/** The text cut at the hits, for drawing the marks behind a field. */
export function segmentText(text: string, matches: readonly TextMatch[]): TextSegment[] {
  const segments: TextSegment[] = [];
  let position = 0;
  matches.forEach((match, index) => {
    if (match.start > position) segments.push({ text: text.slice(position, match.start), match: -1 });
    segments.push({ text: text.slice(match.start, match.end), match: index });
    position = match.end;
  });
  if (position < text.length) segments.push({ text: text.slice(position), match: -1 });
  return segments;
}

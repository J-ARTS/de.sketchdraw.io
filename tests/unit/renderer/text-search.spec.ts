import { describe, expect, test } from 'vitest';
import {
  buildSearchPattern, findMatches, matchIndexFrom, MAX_TEXT_MATCHES, preserveCase, replaceMatches, replacementFor, segmentText,
  type TextSearchOptions,
} from '@/renderer/lib/text-search';

const CODE = 'sequenceDiagram\n    participant Client\n    participant Dienst\n    Client->>Dienst: Anfrage\n    Dienst-->>Client: Antwort\n';
const plain: TextSearchOptions = { matchCase: false, wholeWord: false, regex: false };
function hits(text: string, query: string, options: Partial<TextSearchOptions> = {}) {
  const built = buildSearchPattern(query, { ...plain, ...options });
  if (!built.ok) throw new Error(built.message);
  return findMatches(text, built.pattern).matches;
}
const found = (text: string, query: string, options: Partial<TextSearchOptions> = {}) => hits(text, query, options).map((match) => text.slice(match.start, match.end));

describe('search in a text field (#245)', () => {
  test('a query is searched as typed, without regard to case unless asked', () => {
    expect(found(CODE, 'client')).toEqual(['Client', 'Client', 'Client']);
    expect(found(CODE, 'client', { matchCase: true })).toEqual([]);
    expect(found(CODE, 'Client', { matchCase: true })).toHaveLength(3);
    // Characters with a meaning in regular expressions are plain text here.
    expect(found(CODE, '->>')).toEqual(['->>', '->>']);
    expect(found('a.b a+b (a) [a] a\\b $1', 'a.b')).toEqual(['a.b']);
    expect(found('a.b a+b (a) [a] a\\b $1', '(a)')).toEqual(['(a)']);
    expect(found('a.b a+b (a) [a] a\\b $1', 'a\\b')).toEqual(['a\\b']);
    expect(hits(CODE, '')).toEqual([]);
  });

  test('whole words do not touch letters, digits or underscores, in any script', () => {
    expect(found('Dienst Dienste dienst_2 (Dienst) Dienst', 'Dienst', { wholeWord: true })).toEqual(['Dienst', 'Dienst', 'Dienst']);
    expect(found('Größe Größen größe', 'größe', { wholeWord: true })).toEqual(['Größe', 'größe']);
    expect(found('über überall', 'über', { wholeWord: true })).toEqual(['über']);
  });

  test('regular expressions find per line and report what cannot be read', () => {
    expect(found(CODE, '^\\s+participant (\\w+)$', { regex: true })).toEqual(['    participant Client', '    participant Dienst']);
    expect(hits(CODE, '(\\w+)-+>>(\\w+)', { regex: true })[1]!.groups).toEqual(['Dienst-->>Client', 'Dienst', 'Client']);
    expect(hits('a=1', '(?<key>\\w)=(?<value>\\d)', { regex: true })[0]!.named).toEqual({ key: 'a', value: '1' });
    expect(buildSearchPattern('(', { ...plain, regex: true })).toMatchObject({ ok: false });
    expect(buildSearchPattern('[a-', { ...plain, regex: true, wholeWord: true })).toMatchObject({ ok: false });
    // An escape that the strict mode refuses still works.
    expect(found('a-b', 'a\\-b', { regex: true })).toEqual(['a-b']);
    expect(found('a-b a-bc', 'a\\-b', { regex: true, wholeWord: true })).toEqual(['a-b']);
    // Empty hits are no places to go to.
    expect(hits('abc', '^', { regex: true })).toEqual([]);
    expect(found('aa b', 'a*', { regex: true })).toEqual(['aa']);
  });

  test('very many hits are cut off and marked as such', () => {
    const built = buildSearchPattern('a', plain);
    const result = findMatches('a'.repeat(MAX_TEXT_MATCHES + 10), built.ok ? built.pattern : null);
    expect(result.matches).toHaveLength(MAX_TEXT_MATCHES);
    expect(result.capped).toBe(true);
  });

  test('the hit to start with is the first one from the cursor on, wrapping to the top', () => {
    const matches = hits(CODE, 'Client');
    expect(matchIndexFrom(matches, 0)).toBe(0);
    expect(matchIndexFrom(matches, matches[0]!.start + 1)).toBe(1);
    expect(matchIndexFrom(matches, CODE.length)).toBe(0);
    expect(matchIndexFrom([], 0)).toBe(-1);
  });
});

describe('replace in a text field (#245)', () => {
  test('every hit is replaced by the text as typed', () => {
    const matches = hits(CODE, 'Dienst');
    expect(replaceMatches(CODE, matches, 'Server', { regex: false, preserveCase: false }))
      .toBe('sequenceDiagram\n    participant Client\n    participant Server\n    Client->>Server: Anfrage\n    Server-->>Client: Antwort\n');
    // Without a regular expression a dollar sign is a dollar sign.
    expect(replaceMatches('a b', hits('a b', 'a'), '$1\\n', { regex: false, preserveCase: false })).toBe('$1\\n b');
    expect(replaceMatches('abc', hits('abc', 'b'), '', { regex: false, preserveCase: false })).toBe('ac');
  });

  test('with a regular expression the replacement refers to groups and line breaks', () => {
    const text = 'Client->>Dienst: Anfrage';
    const matches = hits(text, '(\\w+)->>(\\w+)', { regex: true });
    expect(replaceMatches(text, matches, '$2->>$1', { regex: true, preserveCase: false })).toBe('Dienst->>Client: Anfrage');
    expect(replacementFor(matches[0]!, '[$&] $$ $3 $10 \\n\\t\\\\', { regex: true, preserveCase: false })).toBe('[Client->>Dienst] $ $3 Client0 \n\t\\');
    const named = hits('a=1', '(?<key>\\w)=(?<value>\\d)', { regex: true });
    expect(replacementFor(named[0]!, '$<value>=$<key> $<missing>', { regex: true, preserveCase: false })).toBe('1=a $<missing>');
  });

  test('the spelling of what is replaced can be kept', () => {
    expect(preserveCase('CLIENT', 'server')).toBe('SERVER');
    expect(preserveCase('client', 'Server')).toBe('server');
    expect(preserveCase('Client', 'server')).toBe('Server');
    expect(preserveCase('cLient', 'Server')).toBe('server');
    expect(preserveCase('123', 'Server')).toBe('Server');
    expect(preserveCase('Client', '')).toBe('');
    const text = 'client Client CLIENT';
    expect(replaceMatches(text, hits(text, 'client'), 'server', { regex: false, preserveCase: true })).toBe('server Server SERVER');
  });

  test('the text is cut at the hits for marking them', () => {
    const text = 'ab ab';
    expect(segmentText(text, hits(text, 'b'))).toEqual([{ text: 'a', match: -1 }, { text: 'b', match: 0 }, { text: ' a', match: -1 }, { text: 'b', match: 1 }]);
    expect(segmentText(text, [])).toEqual([{ text, match: -1 }]);
    expect(segmentText('', [])).toEqual([]);
  });
});

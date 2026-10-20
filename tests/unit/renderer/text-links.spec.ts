import { describe, expect, it } from 'vitest';
import { linkAt, lineSegments, normalizeLinkUrl, parseTextLinks, removeLinks, serializeTextLinks, setLink, shiftLinks, TEXT_LINKS_KEY } from '@/renderer/lib/text-links';

const link = (start: number, end: number, url = 'https://example.com/') => ({ start, end, url });

describe('text links', () => {
  it('accepts only absolute http(s) addresses without credentials', () => {
    expect(normalizeLinkUrl('example.com/a')).toBe('https://example.com/a');
    expect(normalizeLinkUrl('http://example.com')).toBe('http://example.com/');
    expect(normalizeLinkUrl('javascript:alert(1)')).toBeNull();
    expect(normalizeLinkUrl('https://user:pw@example.com')).toBeNull();
    expect(normalizeLinkUrl('  ')).toBeNull();
  });

  it('round-trips through metadata and ignores broken data', () => {
    const stored = serializeTextLinks([link(6, 10)])!;
    expect(parseTextLinks({ [TEXT_LINKS_KEY]: stored }, 20)).toEqual([link(6, 10)]);
    expect(parseTextLinks({ [TEXT_LINKS_KEY]: stored }, 8)).toEqual([link(6, 8)]);
    expect(parseTextLinks({ [TEXT_LINKS_KEY]: 'nope' }, 20)).toEqual([]);
    expect(parseTextLinks({ [TEXT_LINKS_KEY]: JSON.stringify([{ s: 0, e: 3, u: 'javascript:1' }]) }, 20)).toEqual([]);
    expect(parseTextLinks(undefined, 20)).toEqual([]);
    expect(serializeTextLinks([])).toBeNull();
  });

  it('sets, replaces and removes links on a selection', () => {
    const linked = setLink([link(0, 10, 'https://a.example/')], 4, 6, 'https://b.example/');
    expect(linked).toEqual([link(0, 4, 'https://a.example/'), link(4, 6, 'https://b.example/'), link(6, 10, 'https://a.example/')]);
    expect(linkAt(linked, 5, 5)?.url).toBe('https://b.example/');
    expect(linkAt(linked, 3, 5)?.url).toBe('https://a.example/');
    expect(removeLinks(linked, 5, 5)).toEqual([link(0, 4, 'https://a.example/'), link(6, 10, 'https://a.example/')]);
    expect(removeLinks(linked, 0, 10)).toEqual([]);
  });

  it('keeps links on their words while the text is edited', () => {
    // "Hello Test link" with "Test" (6..10) linked
    const links = [link(6, 10)];
    expect(shiftLinks(links, 'Hello Test link', 'Oh Hello Test link')).toEqual([link(9, 13)]);
    expect(shiftLinks(links, 'Hello Test link', 'Hello Test link!!')).toEqual(links);
    expect(shiftLinks(links, 'Hello Test link', 'Hello Tesst link')).toEqual([link(6, 11)]); // typing inside grows the link
    expect(shiftLinks(links, 'Hello Test link', 'Hello  link')).toEqual([]); // the linked word was deleted
    expect(shiftLinks(links, 'Hello Test link', 'Hello Tt link')).toEqual([link(6, 8)]);
  });

  it('splits rendered lines into linked and plain segments', () => {
    expect(lineSegments('Hello Test link', 0, [link(6, 10)])).toEqual([{ text: 'Hello ' }, { text: 'Test', url: 'https://example.com/' }, { text: ' link' }]);
    expect(lineSegments('Test link', 6, [link(6, 10)])).toEqual([{ text: 'Test', url: 'https://example.com/' }, { text: ' link' }]);
    expect(lineSegments('plain', 0, [])).toEqual([{ text: 'plain' }]);
  });
});

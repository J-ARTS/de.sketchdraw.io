import { describe, expect, it } from 'vitest';
import { fittedTextHeight, textLineCount } from '@/renderer/lib/text-metrics';
import { slideNotes, SLIDE_NOTES_KEY } from '@/renderer/lib/slide-notes';

describe('text metrics', () => {
  it('counts explicit line breaks and wrapped lines', () => {
    expect(textLineCount('a\nb\nc', 240, 20, 0)).toBe(3);
    expect(textLineCount('x'.repeat(21), 240, 20, 0)).toBe(2); // 20 chars fit per line
    expect(textLineCount('', 240, 20, 0)).toBe(1);
  });

  it('grows the free-text box with every line', () => {
    const one = fittedTextHeight('a', 240, 20);
    const three = fittedTextHeight('a\nb\nc', 240, 20);
    expect(three - one).toBe(2 * 25);
  });
});

describe('slide notes', () => {
  it('are read from the frame metadata', () => {
    expect(slideNotes(undefined)).toBe('');
    expect(slideNotes({ metadata: { [SLIDE_NOTES_KEY]: 'Agenda' } })).toBe('Agenda');
  });
});

import { describe, expect, it } from 'vitest';
import { bulletsActive, toggleBullets } from '@/renderer/lib/bullets';

describe('bullets for the selected lines only', () => {
  const text = 'Hello\nWorld\nTest';

  it('bullets only the selected lines and keeps the rest untouched', () => {
    const result = toggleBullets(text, 6, 11); // "World"
    expect(result.text).toBe('Hello\n• World\nTest');
    expect(result.active).toBe(true);
    expect(result.start).toBe(6);
    expect(result.end).toBe(13);
  });

  it('bullets every line a multi-line selection touches', () => {
    expect(toggleBullets(text, 3, 8).text).toBe('• Hello\n• World\nTest');
  });

  it('bullets the caret line for a collapsed selection, including an empty one', () => {
    expect(toggleBullets(text, 14, 14).text).toBe('Hello\nWorld\n• Test');
    expect(toggleBullets('', 0, 0).text).toBe('• ');
  });

  it('removes the bullets again when all selected lines have one', () => {
    const bulleted = '• Hello\n• World\nTest';
    expect(bulletsActive(bulleted, 0, 15)).toBe(true);
    const removed = toggleBullets(bulleted, 0, 15);
    expect(removed.text).toBe('Hello\nWorld\nTest');
    expect(removed.active).toBe(false);
    expect(bulletsActive(bulleted, 0, bulleted.length)).toBe(false);
  });

  it('does not include the following line when the selection ends after a line break, and skips blank lines', () => {
    expect(toggleBullets('A\n\nB', 0, 2).text).toBe('• A\n\nB');
    expect(toggleBullets('A\n\nB', 0, 4).text).toBe('• A\n\n• B');
  });
});

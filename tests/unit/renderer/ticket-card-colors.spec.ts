import { describe, expect, it } from 'vitest';
import { contrastRatio, themeColor } from '@/renderer/lib/theme';
import { ticketCardColors } from '@/renderer/lib/ticket-card-colors';

describe('colours of a ticket card (#283)', () => {
  for (const theme of ['light', 'dark'] as const) {
    it(`keeps every text of the card readable in the ${theme} theme`, () => {
      const colors = ticketCardColors(theme);
      // The rectangle of a new card is white in the document; the canvas maps it for the dark theme.
      const surface = themeColor('#ffffff', theme);
      expect(colors.surface).toBe(surface);
      const pairs: Array<[string, string, string]> = [
        ['title', colors.ink, surface], ['key and details', colors.muted, surface],
        ...Object.entries(colors.state).map(([name, tone]): [string, string, string] => [`state ${name}`, tone.ink, tone.fill]),
        ['label', colors.label.ink, colors.label.fill], ['component', colors.component.ink, colors.component.fill],
      ];
      const weak = pairs.filter(([, ink, fill]) => contrastRatio(ink, fill) < 4.5).map(([name, ink, fill]) => `${name}: ${contrastRatio(ink, fill).toFixed(2)}`);
      expect(weak).toEqual([]);
    });
  }
});

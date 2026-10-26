import { describe, expect, it } from 'vitest';
import { wrapWords } from '../../../src/renderer/lib/text-metrics';

describe('wrapWords', () => {
  it('keeps a line that fits', () => {
    expect(wrapWords('Private subnet', 0, 20)).toEqual([{ text: 'Private subnet', from: 0 }]);
    expect(wrapWords('', 7, 10)).toEqual([{ text: '', from: 7 }]);
  });

  it('breaks at spaces and reports where every chunk starts in the whole text', () => {
    expect(wrapWords('Corporate data center', 0, 14)).toEqual([{ text: 'Corporate data', from: 0 }, { text: 'center', from: 15 }]);
    expect(wrapWords('AWS Step Functions workflow', 10, 12)).toEqual([{ text: 'AWS Step', from: 10 }, { text: 'Functions', from: 19 }, { text: 'workflow', from: 29 }]);
  });

  it('splits a word that is longer than a line and ignores extra spaces at breaks', () => {
    expect(wrapWords('Supercalifragilistic go', 0, 8)).toEqual([{ text: 'Supercal', from: 0 }, { text: 'ifragili', from: 8 }, { text: 'stic go', from: 16 }]);
    expect(wrapWords('aaaa     bbbb', 0, 6)).toEqual([{ text: 'aaaa', from: 0 }, { text: 'bbbb', from: 9 }]);
  });
});

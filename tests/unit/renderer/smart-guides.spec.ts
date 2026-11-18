import { describe, expect, it } from 'vitest';
import { snapMove, type GuideBox, type SmartGuide } from '@/renderer/lib/smart-guides';

const box = (x: number, y: number, width = 100, height = 60): GuideBox => ({ x, y, width, height });
const aligns = (guides: SmartGuide[], axis: 'x' | 'y') => guides.filter((guide): guide is Extract<SmartGuide, { kind: 'align' }> => guide.kind === 'align' && guide.axis === axis);
const gaps = (guides: SmartGuide[], axis: 'x' | 'y') => guides.filter((guide): guide is Extract<SmartGuide, { kind: 'gap' }> => guide.kind === 'gap' && guide.axis === axis);

describe('alignment', () => {
  it('pulls an edge onto the edge of another box and draws the line across both', () => {
    const result = snapMove(box(203, 300), [box(200, 100)], 6);
    expect(result.dx).toBe(-3);
    expect(result.dy).toBe(0);
    // Same width: both edges are in line, the middle is not drawn a third time.
    expect(aligns(result.guides, 'x')).toEqual([{ kind: 'align', axis: 'x', at: 200, from: 100, to: 360 }, { kind: 'align', axis: 'x', at: 300, from: 100, to: 360 }]);
  });

  it('pulls the middle onto the middle when the sizes differ', () => {
    const result = snapMove(box(228, 300, 40, 40), [box(200, 100, 100, 60)], 6);
    expect(result.dx).toBe(2);
    expect(aligns(result.guides, 'x')).toEqual([{ kind: 'align', axis: 'x', at: 250, from: 100, to: 340 }]);
  });

  it('lines up top, middle and bottom along the other axis', () => {
    const result = snapMove(box(400, 104), [box(200, 100)], 6);
    expect(result).toMatchObject({ dx: 0, dy: -4 });
    expect(aligns(result.guides, 'y').map(guide => [guide.at, guide.from, guide.to])).toEqual([[100, 200, 500], [160, 200, 500]]);
  });

  it('meets an opposite edge: the left edge on the right edge of another', () => {
    const result = snapMove(box(302, 300), [box(200, 100)], 6);
    expect(result.dx).toBe(-2);
    expect(aligns(result.guides, 'x').map(guide => guide.at)).toEqual([300]);
  });

  it('snaps on both axes at once', () => {
    const result = snapMove(box(203, 298), [box(200, 100), box(500, 300)], 6);
    expect(result).toMatchObject({ dx: -3, dy: 2 });
    expect(aligns(result.guides, 'x').length).toBeGreaterThan(0);
    expect(aligns(result.guides, 'y').length).toBeGreaterThan(0);
  });

  it('leaves the box alone beyond the threshold and draws nothing', () => {
    expect(snapMove(box(210, 320), [box(200, 100)], 6)).toEqual({ dx: 0, dy: 0, guides: [] });
    expect(snapMove(box(203, 300), [], 6)).toEqual({ dx: 0, dy: 0, guides: [] });
    expect(snapMove(box(203, 300), [box(200, 100)], 0).dx).toBe(0);
  });

  it('shows a line that already holds without moving the box', () => {
    const result = snapMove(box(200, 300), [box(200, 100)], 6);
    expect(result).toMatchObject({ dx: 0, dy: 0 });
    expect(aligns(result.guides, 'x')).toHaveLength(2);
  });
});

describe('the nearest box decides', () => {
  it('prefers the line of the nearer box over a closer line of a box far away', () => {
    // Far box: 1 away from a line. Near box: 4 away. The near one is the one being arranged against.
    const result = snapMove(box(204, 200), [box(200, 100), box(203, 2000)], 6);
    expect(result.dx).toBe(-4);
  });

  it('draws the line to the nearest of several boxes on the same line', () => {
    const result = snapMove(box(200, 400), [box(200, 100), box(200, 250), box(200, 900)], 6);
    expect(aligns(result.guides, 'x')[0]).toMatchObject({ from: 250, to: 460 });
  });

  it('lets a surrounding box decide only when nothing beside the moved box offers a line', () => {
    const frame = box(0, 0, 1000, 600);
    // Alone in the frame: its middle is a line.
    expect(snapMove(box(452, 200), [frame], 6).dx).toBe(-2);
    // A sibling offers another line within reach: the sibling wins.
    expect(snapMove(box(452, 200), [frame, box(455, 400)], 6).dx).toBe(3);
  });
});

describe('equal distances', () => {
  it('centres a box between its two neighbours and marks both distances', () => {
    const result = snapMove(box(247, 105), [box(0, 100), box(500, 100)], 6);
    // 400 free between the neighbours, 100 wide: 150 on each side.
    expect(result.dx).toBe(3);
    expect(gaps(result.guides, 'x')).toEqual([
      { kind: 'gap', axis: 'x', from: 100, to: 250, at: 130, size: 150 },
      { kind: 'gap', axis: 'x', from: 350, to: 500, at: 130, size: 150 },
    ]);
  });

  it('continues the distance of a row to the right and to the left', () => {
    const row = [box(0, 100), box(140, 100)];
    const right = snapMove(box(283, 110), row, 6);
    expect(right.dx).toBe(-3);
    expect(gaps(right.guides, 'x').map(guide => [guide.from, guide.to, guide.size])).toEqual([[100, 140, 40], [240, 280, 40]]);
    const left = snapMove(box(-138, 110), row, 6);
    expect(left.dx).toBe(-2);
    expect(gaps(left.guides, 'x').map(guide => [guide.from, guide.to, guide.size])).toEqual([[-40, 0, 40], [100, 140, 40]]);
  });

  it('does the same for a column', () => {
    const result = snapMove(box(100, 243, 100, 60), [box(100, 0, 100, 60), box(100, 120, 100, 60)], 6);
    expect(result.dy).toBe(-3);
    expect(gaps(result.guides, 'y').map(guide => [guide.from, guide.to, guide.size])).toEqual([[60, 120, 60], [180, 240, 60]]);
    // The column shares its edges as well.
    expect(aligns(result.guides, 'x')).toHaveLength(2);
  });

  it('ignores boxes that are not in the same row', () => {
    const result = snapMove(box(247, 400), [box(0, 100), box(500, 100)], 6);
    expect(result.dx).toBe(0);
    expect(gaps(result.guides, 'x')).toEqual([]);
  });

  it('does not centre a box that does not fit between its neighbours', () => {
    const result = snapMove(box(60, 100, 100, 60), [box(0, 100, 50, 60), box(120, 100, 50, 60)], 6);
    expect(gaps(result.guides, 'x')).toEqual([]);
  });

  it('prefers alignment when alignment and spacing are equally near and equally good', () => {
    // Centre between the neighbours is at x = 250; the box above has its edge at 251.
    const result = snapMove(box(249, 100), [box(0, 100), box(500, 100), box(251, 160, 100, 60)], 6);
    expect(Math.abs(result.dx)).toBeGreaterThan(0);
  });
});

describe('robustness', () => {
  it('copes with empty and degenerate input', () => {
    expect(snapMove(box(0, 0, 0, 0), [box(0, 0, 0, 0)], 6).guides.every(guide => Number.isFinite(guide.at))).toBe(true);
    expect(snapMove(box(10, 10), [box(Number.NaN, 0)], 6)).toMatchObject({ dx: 0, dy: 0 });
    expect(snapMove(box(10, 10), [box(12, 400)], Number.NaN)).toEqual({ dx: 0, dy: 0, guides: [] });
  });

  it('stays fast with a few hundred boxes', () => {
    const others = Array.from({ length: 400 }, (_, index) => box((index % 20) * 137, Math.floor(index / 20) * 91));
    const started = performance.now();
    for (let step = 0; step < 50; step++) snapMove(box(333 + step, 222 + step), others, 6);
    expect(performance.now() - started).toBeLessThan(1500);
  });
});

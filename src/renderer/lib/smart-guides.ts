/**
 * Guides while elements are moved (#224): the moved box snaps into line with the nearest other boxes and to equal
 * distances between its neighbours, and reports the lines to draw. Everything here is plain geometry in document
 * coordinates; the store decides which elements take part and how close "close" is.
 */

export interface GuideBox { x: number; y: number; width: number; height: number }

export type SmartGuide =
  /** A line both boxes share. `axis: 'x'` is a vertical line at x = `at` that runs from y = `from` to y = `to`. */
  | { kind: 'align'; axis: 'x' | 'y'; at: number; from: number; to: number }
  /** A distance that equals another one. `axis: 'x'` is a horizontal stretch from x = `from` to x = `to` at y = `at`. */
  | { kind: 'gap'; axis: 'x' | 'y'; from: number; to: number; at: number; size: number };

export interface SnapResult {
  /** What to add to the movement so the box sits exactly on the lines. */
  dx: number;
  dy: number;
  guides: SmartGuide[];
}

/** Two values count as the same line when they differ by less than this (document units). */
const SAME = 0.01;

/** A box seen along one axis: where it starts and ends on that axis and across it. */
interface Span { s: number; e: number; cs: number; ce: number }
const along = (box: GuideBox, axis: 'x' | 'y'): Span => axis === 'x'
  ? { s: box.x, e: box.x + box.width, cs: box.y, ce: box.y + box.height }
  : { s: box.y, e: box.y + box.height, cs: box.x, ce: box.x + box.width };
const mid = (span: Span): number => (span.s + span.e) / 2;
/** How far two boxes are apart across the axis; 0 when they overlap there. */
const crossDistance = (a: Span, b: Span): number => Math.max(0, a.cs - b.ce, b.cs - a.ce);
const alongDistance = (a: Span, b: Span): number => Math.max(0, a.s - b.e, b.s - a.e);
const sameRow = (a: Span, b: Span): boolean => Math.min(a.ce, b.ce) - Math.max(a.cs, b.cs) > SAME;

/** Which line of the moved box meets which line of another: edges meet edges, the middle meets the middle. */
const PAIRS: ReadonlyArray<readonly ['s' | 'm' | 'e', 's' | 'm' | 'e']> = [['s', 's'], ['s', 'e'], ['m', 'm'], ['e', 's'], ['e', 'e']];
const line = (span: Span, which: 's' | 'm' | 'e'): number => which === 's' ? span.s : which === 'e' ? span.e : mid(span);

/** The neighbours of the moved box in its row: the nearest box before it, the nearest after it, and theirs. */
function neighbours(moving: Span, others: readonly Span[]): { before?: Span; beforeThat?: Span; after?: Span; afterThat?: Span } {
  const row = others.filter(other => sameRow(moving, other));
  const centre = mid(moving);
  const nearestBefore = (of: Span, edge: number, list: readonly Span[]) => list.filter(other => other !== of && other.e <= edge + SAME).sort((a, b) => b.e - a.e)[0];
  const nearestAfter = (of: Span, edge: number, list: readonly Span[]) => list.filter(other => other !== of && other.s >= edge - SAME).sort((a, b) => a.s - b.s)[0];
  // A box counts as "before" when it lies on that side of the moved box's middle and does not reach past it.
  const before = row.filter(other => mid(other) < centre && other.e <= moving.e).sort((a, b) => b.e - a.e)[0];
  const after = row.filter(other => mid(other) > centre && other.s >= moving.s).sort((a, b) => a.s - b.s)[0];
  // The rhythm continues with boxes in the row of that neighbour, not necessarily in the row of the moved box.
  const inRowOf = (of: Span) => others.filter(other => sameRow(of, other));
  return {
    ...(before ? { before } : {}),
    ...(after ? { after } : {}),
    ...(before ? (() => { const that = nearestBefore(before, before.s, inRowOf(before)); return that ? { beforeThat: that } : {}; })() : {}),
    ...(after ? (() => { const that = nearestAfter(after, after.e, inRowOf(after)); return that ? { afterThat: that } : {}; })() : {}),
  };
}

/**
 * How far another box is from the moved one. A box that surrounds it (its container, a frame) is always "there";
 * it counts as far away so that it only decides when no box beside the moved one offers a line.
 */
const SURROUNDING = 1e9;
function distanceTo(moving: Span, other: Span): number {
  const surrounds = other.s <= moving.s + SAME && other.e >= moving.e - SAME && other.cs <= moving.cs + SAME && other.ce >= moving.ce - SAME;
  return surrounds ? SURROUNDING : crossDistance(moving, other) + alongDistance(moving, other);
}

/**
 * The correction along one axis. Of everything within reach the nearest box decides, as that is the one the user is
 * arranging against; between equally near ones the smaller correction wins, and alignment before spacing.
 */
function bestDelta(moving: Span, others: readonly Span[], threshold: number): number {
  let best: { delta: number; rank: number; distance: number } | null = null as { delta: number; rank: number; distance: number } | null;
  const offer = (delta: number, rank: number, distance: number) => {
    if (!Number.isFinite(delta) || Math.abs(delta) > threshold) return;
    const closer = !best || distance < best.distance - SAME
      || (Math.abs(distance - best.distance) <= SAME && (Math.abs(delta) < Math.abs(best.delta) - SAME || (Math.abs(Math.abs(delta) - Math.abs(best.delta)) <= SAME && rank < best.rank)));
    if (closer) best = { delta, rank, distance };
  };
  for (const other of others) {
    const distance = distanceTo(moving, other);
    for (const [mine, theirs] of PAIRS) offer(line(other, theirs) - line(moving, mine), 0, distance);
  }
  const { before, beforeThat, after, afterThat } = neighbours(moving, others);
  const size = moving.e - moving.s;
  const toBefore = before ? Math.max(0, moving.s - before.e) : Number.POSITIVE_INFINITY;
  const toAfter = after ? Math.max(0, after.s - moving.e) : Number.POSITIVE_INFINITY;
  // Centred between the two neighbours.
  if (before && after && after.s - before.e >= size) offer(before.e + (after.s - before.e - size) / 2 - moving.s, 1, Math.min(toBefore, toAfter));
  // The same distance the neighbour keeps to the box behind it.
  if (before && beforeThat && before.s - beforeThat.e > SAME) offer(before.e + (before.s - beforeThat.e) - moving.s, 1, toBefore);
  if (after && afterThat && afterThat.s - after.e > SAME) offer(after.s - (afterThat.s - after.e) - moving.e, 1, toAfter);
  return best?.delta ?? 0;
}

function alignGuides(moving: Span, others: readonly Span[], axis: 'x' | 'y'): SmartGuide[] {
  const found = new Map<'s' | 'm' | 'e', { other: Span; distance: number }>();
  for (const other of others) {
    const distance = distanceTo(moving, other);
    for (const [mine, theirs] of PAIRS) {
      if (Math.abs(line(other, theirs) - line(moving, mine)) > SAME) continue;
      const current = found.get(mine);
      // Several boxes may share the line; the nearest one is the one the user is arranging against.
      if (!current || distance < current.distance) found.set(mine, { other, distance });
    }
  }
  // Both edges in line already say that the middles are: one line less to read.
  if (found.has('s') && found.has('e')) found.delete('m');
  return Array.from(found, ([mine, { other }]) => ({ kind: 'align' as const, axis, at: line(moving, mine), from: Math.min(moving.cs, other.cs), to: Math.max(moving.ce, other.ce) }));
}

function gapGuides(moving: Span, others: readonly Span[], axis: 'x' | 'y'): SmartGuide[] {
  const { before, beforeThat, after, afterThat } = neighbours(moving, others);
  const guides: SmartGuide[] = [];
  const seen = new Set<string>();
  const gap = (first: Span, second: Span) => {
    const key = `${first.e}:${second.s}:${first.cs}:${second.cs}`;
    if (seen.has(key)) return;
    seen.add(key);
    // Drawn where the two boxes face each other; boxes that do not overlap there get the line between them.
    const low = Math.max(first.cs, second.cs), high = Math.min(first.ce, second.ce);
    guides.push({ kind: 'gap', axis, from: first.e, to: second.s, at: (low + high) / 2, size: second.s - first.e });
  };
  const equal = (a: number, b: number) => a > SAME && Math.abs(a - b) <= SAME;
  if (before && after && equal(moving.s - before.e, after.s - moving.e)) { gap(before, moving); gap(moving, after); }
  if (before && beforeThat && equal(moving.s - before.e, before.s - beforeThat.e)) { gap(beforeThat, before); gap(before, moving); }
  if (after && afterThat && equal(after.s - moving.e, afterThat.s - after.e)) { gap(moving, after); gap(after, afterThat); }
  return guides;
}

/**
 * Snaps a moved box against the others.
 *
 * @param moving    The box where the pointer has taken it, before snapping.
 * @param others    The boxes it may line up with; the caller leaves out what moves along and what is out of sight.
 * @param threshold How far the box may be pulled, in document units (a fixed number of screen pixels at any zoom).
 */
export function snapMove(moving: GuideBox, others: readonly GuideBox[], threshold: number): SnapResult {
  if (!others.length || !(threshold >= 0)) return { dx: 0, dy: 0, guides: [] };
  const dx = bestDelta(along(moving, 'x'), others.map(other => along(other, 'x')), threshold);
  const dy = bestDelta(along(moving, 'y'), others.map(other => along(other, 'y')), threshold);
  const placed: GuideBox = { ...moving, x: moving.x + dx, y: moving.y + dy };
  const guides: SmartGuide[] = [];
  for (const axis of ['x', 'y'] as const) {
    const box = along(placed, axis), rest = others.map(other => along(other, axis));
    guides.push(...alignGuides(box, rest, axis), ...gapGuides(box, rest, axis));
  }
  return { dx, dy, guides };
}

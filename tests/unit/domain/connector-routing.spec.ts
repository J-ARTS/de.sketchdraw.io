import { describe, expect, it } from 'vitest';
import { connectorRoutePoints, type Point } from '@/domain';

// Elbowed connectors must meet both borders at a right angle, whatever the relative position of the shapes.
const SIDES: ReadonlyArray<{ name: string; anchor: Point; normal: Point }> = [
  { name: 'left', anchor: { x: 0, y: .5 }, normal: { x: -1, y: 0 } },
  { name: 'right', anchor: { x: 1, y: .5 }, normal: { x: 1, y: 0 } },
  { name: 'top', anchor: { x: .5, y: 0 }, normal: { x: 0, y: -1 } },
  { name: 'bottom', anchor: { x: .5, y: 1 }, normal: { x: 0, y: 1 } },
];
const OFFSETS: readonly Point[] = [
  { x: 300, y: 120 }, { x: 300, y: -120 }, { x: -300, y: 120 }, { x: -300, y: -120 },
  { x: 0, y: 300 }, { x: 300, y: 0 }, { x: -300, y: 0 }, { x: 0, y: -300 }, { x: 40, y: 300 }, { x: -40, y: -300 }, { x: 300, y: 10 }, { x: 10, y: 300 }, { x: 60, y: 60 },
];

describe('elbowed connector routing', () => {
  for (const from of SIDES) for (const to of SIDES) {
    it(`leaves ${from.name} and arrives at ${to.name} perpendicularly`, () => {
      for (const offset of OFFSETS) {
        const route = connectorRoutePoints({
          connectorRouting: 'elbowed',
          points: [{ x: 0, y: 0 }, offset],
          from: { elementId: 'a', anchor: from.anchor },
          to: { elementId: 'b', anchor: to.anchor },
        });
        const label = `${from.name}→${to.name} @${offset.x},${offset.y}`;
        // Same side and exactly in line would have to cross the target shape; without its bounds there is no valid detour.
        const sameSide = from.normal.x === to.normal.x && from.normal.y === to.normal.y;
        if (sameSide && (from.normal.x !== 0 ? offset.y === 0 : offset.x === 0)) continue;
        for (let index = 1; index < route.length; index += 1) {
          const a = route[index - 1]!; const b = route[index]!;
          expect(Math.abs(a.x - b.x) < .01 || Math.abs(a.y - b.y) < .01, `${label}: segment ${index} is not orthogonal`).toBe(true);
        }
        const last = route.at(-1)!; const before = route.at(-2)!;
        const arrivesAlongX = Math.abs(last.y - before.y) < .01;
        expect(arrivesAlongX, `${label}: last segment must run along the target normal`).toBe(to.normal.x !== 0);
        // Arriving from outside: the last segment points against the target's outward normal.
        const step = arrivesAlongX ? Math.sign(last.x - before.x) : Math.sign(last.y - before.y);
        expect(step, `${label}: arrives from inside the target`).toBe(-(arrivesAlongX ? to.normal.x : to.normal.y));
        const first = route[1]!; const origin = route[0]!;
        const leavesAlongX = Math.abs(first.y - origin.y) < .01;
        expect(leavesAlongX, `${label}: first segment must run along the start normal`).toBe(from.normal.x !== 0);
      }
    });
  }
});

import { describe, expect, test } from 'vitest';
import { appendLaserPoint, LASER_DECAY_MS, LASER_MAX_POINTS, laserSegments, liveLaserPoints, type LaserPoint } from '@/renderer/lib/laser-pointer';

describe('laser pointer trail', () => {
  test('streamlines input and bounds the temporary point history', () => {
    let points: LaserPoint[] = [{ x: 0, y: 0, createdAt: 0 }];
    points = appendLaserPoint(points, { x: 10, y: 20, createdAt: 10 });
    expect(points[1]).toMatchObject({ x: 6, y: 12, createdAt: 10 });
    for (let index = 0; index < LASER_MAX_POINTS + 20; index++) {
      points = appendLaserPoint(points, { x: 20 + index, y: index, createdAt: 20 + index });
    }
    expect(points).toHaveLength(LASER_MAX_POINTS);
  });

  test('fades from tail to head and removes samples after one second', () => {
    const points = [
      { x: 0, y: 0, createdAt: 0 },
      { x: 10, y: 0, createdAt: 250 },
      { x: 20, y: 0, createdAt: 500 },
    ];
    const segments = laserSegments(points, 600);
    expect(segments).toHaveLength(2);
    expect(segments[0]!.opacity).toBeGreaterThan(0);
    expect(segments[1]!.opacity).toBeGreaterThan(segments[0]!.opacity);
    expect(liveLaserPoints(points, LASER_DECAY_MS)).toEqual(points.slice(1));
    expect(liveLaserPoints(points, LASER_DECAY_MS + 500)).toEqual([]);
  });

  test('ignores duplicate pointer samples', () => {
    const points = [{ x: 5, y: 7, createdAt: 10 }];
    expect(appendLaserPoint(points, { x: 5, y: 7, createdAt: 20 })).toEqual(points);
  });
});

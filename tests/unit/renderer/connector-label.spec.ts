import { describe, expect, test } from 'vitest';
import { createElement } from '@/domain';
import { connectorLabelPosition, CONNECTOR_LABEL_POSITION_KEY, formatConnectorLabelPosition, nearestConnectorPosition, pointOnConnector } from '@/renderer/lib/connector-label';

const straight = { points: [{ x: 0, y: 0 }, { x: 200, y: 0 }], connectorRouting: 'straight' as const };
const elbowed = { points: [{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 100, y: 100 }, { x: 200, y: 100 }], connectorRouting: 'elbowed' as const };
const curved = { points: [{ x: 0, y: 0 }, { x: 200, y: 160 }], connectorRouting: 'curved' as const, from: { elementId: 'a', anchor: { x: 1, y: 0.5 } }, to: { elementId: 'b', anchor: { x: 0, y: 0.5 } } };

describe('connector text position (#195)', () => {
  test('the position comes from metadata, is clamped, and defaults to the middle', () => {
    const at = (value?: string) => connectorLabelPosition(createElement('connector', { id: 'c', points: [{ x: 0, y: 0 }, { x: 10, y: 0 }], ...(value === undefined ? {} : { metadata: { [CONNECTOR_LABEL_POSITION_KEY]: value } }) }));
    expect(at()).toBe(0.5);
    expect(at('0.2')).toBe(0.2);
    expect(at('7')).toBe(1);
    expect(at('-3')).toBe(0);
    expect(at('abc')).toBe(0.5);
    expect(at(' ')).toBe(0.5);
    expect(formatConnectorLabelPosition(0.123456)).toBe('0.123');
    expect(formatConnectorLabelPosition(2)).toBe('1');
  });

  test('points follow the drawn line of straight and elbowed connectors by length', () => {
    expect(pointOnConnector(straight, 0.25)).toEqual({ x: 50, y: 0 });
    expect(pointOnConnector(straight, 1)).toEqual({ x: 200, y: 0 });
    // 300 long: a quarter is on the first leg, the middle on the vertical leg, three quarters on the last.
    expect(pointOnConnector(elbowed, 0.25)).toEqual({ x: 75, y: 0 });
    expect(pointOnConnector(elbowed, 0.5)).toEqual({ x: 100, y: 50 });
    expect(pointOnConnector(elbowed, 0.75)).toEqual({ x: 125, y: 100 });
  });

  test('on a curve the point lies on the curve, not on the chord, and the ends are exact', () => {
    expect(pointOnConnector(curved, 0)).toEqual({ x: 0, y: 0 });
    const end = pointOnConnector(curved, 1);
    expect(end.x).toBeCloseTo(200, 6);
    expect(end.y).toBeCloseTo(160, 6);
    const middle = pointOnConnector(curved, 0.5);
    expect(middle.x).toBeCloseTo(100, 0);
    expect(middle.y).toBeCloseTo(80, 0);
    // An S-curve leaves horizontally: a quarter along it is still well above the straight chord.
    const quarter = pointOnConnector(curved, 0.25);
    expect(quarter.y).toBeLessThan(quarter.x * 0.8 - 10);
  });

  test('the nearest position inverts the point, also beside the line and beyond its ends', () => {
    expect(nearestConnectorPosition(straight, { x: 50, y: 30 })).toBeCloseTo(0.25, 6);
    expect(nearestConnectorPosition(straight, { x: -40, y: 0 })).toBe(0);
    expect(nearestConnectorPosition(straight, { x: 900, y: 5 })).toBe(1);
    expect(nearestConnectorPosition(elbowed, { x: 110, y: 50 })).toBeCloseTo(0.5, 6);
    for (const position of [0.1, 0.37, 0.8]) expect(nearestConnectorPosition(curved, pointOnConnector(curved, position))).toBeCloseTo(position, 2);
  });
});

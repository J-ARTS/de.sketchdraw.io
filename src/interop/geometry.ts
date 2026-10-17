import type { Point } from '../domain';
import { fail, number } from './common';
import { INTEROP_LIMITS as L } from './limits';
export type Matrix = readonly [
  number,
  number,
  number,
  number,
  number,
  number
];
export const IDENTITY: Matrix = [1, 0, 0, 1, 0, 0];
export function multiply(a: Matrix, b: Matrix): Matrix { return [a[0] * b[0] + a[2] * b[1], a[1] * b[0] + a[3] * b[1], a[0] * b[2] + a[2] * b[3], a[1] * b[2] + a[3] * b[3], a[0] * b[4] + a[2] * b[5] + a[4], a[1] * b[4] + a[3] * b[5] + a[5]]; }
export function transformPoint(m: Matrix, p: Point): Point { return { x: number(String(m[0] * p.x + m[2] * p.y + m[4])), y: number(String(m[1] * p.x + m[3] * p.y + m[5])) }; }
const numberPattern = /^[+-]?(?:\d+\.?\d*|\.\d+)(?:e[+-]?\d+)?/i;
export function parseNumbers(source: string): number[] { const out: number[] = []; let i = 0; while (i < source.length) {
  while (/[\s,]/.test(source[i] ?? '') && i < source.length)
    i++;
  if (i === source.length)
    break;
  const m = numberPattern.exec(source.slice(i));
  if (!m)
    fail('INVALID_GEOMETRY', 'Invalid numeric sequence.');
  out.push(number(m[0]));
  i += m[0].length;
  if (out.length > 30000)
    fail('LIMIT_EXCEEDED', 'Numeric sequence too long.');
} return out; }
export function parseTransform(source: string | undefined): Matrix {
  if (!source)
    return IDENTITY;
  let result: Matrix = IDENTITY, index = 0, count = 0;
  const pattern = /\s*([A-Za-z]+)\s*\(([^()]*)\)\s*,?\s*/gy;
  while (index < source.length) {
    pattern.lastIndex = index;
    const match = pattern.exec(source);
    if (!match)
      fail('INVALID_GEOMETRY', 'Malformed SVG transform.');
    index = pattern.lastIndex;
    if (++count > 64)
      fail('LIMIT_EXCEEDED', 'Too many transforms.');
    const a = parseNumbers(match[2]!);
    let next: Matrix;
    switch (match[1]) {
      case 'matrix':
        if (a.length !== 6)
          fail('INVALID_GEOMETRY', 'matrix requires six numbers.');
        next = a as unknown as Matrix;
        break;
      case 'translate':
        if (a.length < 1 || a.length > 2)
          fail('INVALID_GEOMETRY', 'translate requires one or two numbers.');
        next = [1, 0, 0, 1, a[0]!, a[1] ?? 0];
        break;
      case 'scale':
        if (a.length < 1 || a.length > 2)
          fail('INVALID_GEOMETRY', 'scale requires one or two numbers.');
        next = [a[0]!, 0, 0, a[1] ?? a[0]!, 0, 0];
        break;
      case 'rotate': {
        if (a.length !== 1 && a.length !== 3)
          fail('INVALID_GEOMETRY', 'rotate requires one or three numbers.');
        const angle = a[0]! * Math.PI / 180, c = Math.cos(angle), s = Math.sin(angle), x = a[1] ?? 0, y = a[2] ?? 0;
        next = [c, s, -s, c, x - c * x + s * y, y - s * x - c * y];
        break;
      }
      case 'skewX':
      case 'skewY': {
        if (a.length !== 1)
          fail('INVALID_GEOMETRY', 'skew requires one number.');
        const t = Math.tan(a[0]! * Math.PI / 180);
        if (!Number.isFinite(t))
          fail('INVALID_GEOMETRY', 'Invalid skew.');
        next = match[1] === 'skewX' ? [1, 0, t, 1, 0, 0] : [1, t, 0, 1, 0, 0];
        break;
      }
      default: return fail('INVALID_GEOMETRY', 'Unsupported transform function.');
    }
    result = multiply(result, next);
    if (result.some(n => !Number.isFinite(n) || Math.abs(n) > 1e12))
      fail('LIMIT_EXCEEDED', 'Transform exceeds numeric limits.');
  }
  return result;
}
export function rectangleTransform(m: Matrix, x: number, y: number, width: number, height: number): {
  x: number;
  y: number;
  width: number;
  height: number;
  rotation: number;
} | undefined {
  const sx = Math.hypot(m[0], m[1]), sy = Math.hypot(m[2], m[3]);
  if (sx === 0 || sy === 0 || m[0] * m[3] - m[1] * m[2] <= 0 || Math.abs(m[0] * m[2] + m[1] * m[3]) > 1e-8 * sx * sy)
    return;
  const center = transformPoint(m, { x: x + width / 2, y: y + height / 2 });
  return { x: center.x - width * sx / 2, y: center.y - height * sy / 2, width: width * sx, height: height * sy, rotation: Math.atan2(m[1], m[0]) * 180 / Math.PI };
}
function distance(p: Point, a: Point, b: Point): number { const dx = b.x - a.x, dy = b.y - a.y, dd = dx * dx + dy * dy, t = dd ? Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / dd)) : 0; return Math.hypot(p.x - a.x - t * dx, p.y - a.y - t * dy); }
const mid = (a: Point, b: Point): Point => ({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 });
export interface FlattenedPath {
  subpaths: Point[][];
  curved: boolean;
  closed: boolean[];
}
export function flattenPath(source: string, m: Matrix = IDENTITY, maxPoints = L.MAX_GENERATED_POINTS): FlattenedPath {
  let cursor = 0, commands = 0, total = 0, command = '', previous = '', position: Point = { x: 0, y: 0 }, start: Point = position, lastCubic: Point | undefined, lastQuadratic: Point | undefined;
  const subpaths: Point[][] = [], closed: boolean[] = [];
  let current: Point[] = [];
  let curved = false;
  function skip() { while (cursor < source.length && /[\s,]/.test(source[cursor]!))
    cursor++; }
  function read(flag = false): number { skip(); if (flag) {
    const c = source[cursor++];
    if (c !== '0' && c !== '1')
      return fail('INVALID_GEOMETRY', 'Arc flags must be 0 or 1.');
    return Number(c);
  } const match = numberPattern.exec(source.slice(cursor)); if (!match)
    return fail('INVALID_GEOMETRY', 'Missing path argument.'); cursor += match[0].length; return number(match[0]); }
  function append(p: Point) { if (++total > maxPoints)
    fail('PATH_COMPLEXITY_LIMIT', 'Path point budget exceeded.'); current.push(transformPoint(m, p)); }
  function flush() { if (current.length) {
    subpaths.push(current);
    closed.push(false);
    current = [];
  } }
  function cubic(a: Point, b: Point, c: Point, d: Point, depth = 0) { const aa = transformPoint(m, a), bb = transformPoint(m, b), cc = transformPoint(m, c), dd = transformPoint(m, d); if (Math.max(distance(bb, aa, dd), distance(cc, aa, dd)) <= .25) {
    append(d);
    return;
  } if (depth >= L.MAX_CURVE_SUBDIVISION_DEPTH)
    fail('PATH_COMPLEXITY_LIMIT', 'Curve tolerance cannot be met.'); const ab = mid(a, b), bc = mid(b, c), cd = mid(c, d), abc = mid(ab, bc), bcd = mid(bc, cd), center = mid(abc, bcd); cubic(a, ab, abc, center, depth + 1); cubic(center, bcd, cd, d, depth + 1); }
  function arc(rx: number, ry: number, angle: number, large: number, sweep: number, end: Point) {
    rx = Math.abs(rx);
    ry = Math.abs(ry);
    if (!rx || !ry) {
      append(end);
      return;
    }
    if (position.x === end.x && position.y === end.y)
      return;
    const phi = angle * Math.PI / 180, co = Math.cos(phi), si = Math.sin(phi), dx = (position.x - end.x) / 2, dy = (position.y - end.y) / 2, x = co * dx + si * dy, y = -si * dx + co * dy;
    const lambda = x * x / (rx * rx) + y * y / (ry * ry);
    if (lambda > 1) {
      rx *= Math.sqrt(lambda);
      ry *= Math.sqrt(lambda);
    }
    const denominator = rx * rx * y * y + ry * ry * x * x;
    const factor = (large === sweep ? -1 : 1) * Math.sqrt(Math.max(0, (rx * rx * ry * ry - denominator) / denominator));
    const cxp = factor * rx * y / ry, cyp = -factor * ry * x / rx, cx = co * cxp - si * cyp + (position.x + end.x) / 2, cy = si * cxp + co * cyp + (position.y + end.y) / 2;
    const ux = (x - cxp) / rx, uy = (y - cyp) / ry, vx = (-x - cxp) / rx, vy = (-y - cyp) / ry;
    const theta = Math.atan2(uy, ux);
    let delta = Math.atan2(ux * vy - uy * vx, ux * vx + uy * vy);
    if (!sweep && delta > 0)
      delta -= 2 * Math.PI;
    if (sweep && delta < 0)
      delta += 2 * Math.PI;
    const radius = Math.max(rx, ry) * Math.hypot(m[0], m[1], m[2], m[3]);
    const step = radius <= .25 ? Math.PI / 2 : Math.min(Math.PI / 2, 2 * Math.acos(Math.max(-1, 1 - .25 / radius)));
    const count = Math.max(1, Math.ceil(Math.abs(delta) / step));
    if (!Number.isFinite(count) || count + total > maxPoints)
      fail('PATH_COMPLEXITY_LIMIT', 'Arc tolerance exceeds point budget.');
    for (let i = 1; i <= count; i++) {
      const a = theta + delta * i / count;
      append(i === count ? end : { x: cx + co * rx * Math.cos(a) - si * ry * Math.sin(a), y: cy + si * rx * Math.cos(a) + co * ry * Math.sin(a) });
    }
  }
  while (true) {
    skip();
    if (cursor >= source.length)
      break;
    const letter = source[cursor]!;
    if (/[A-Za-z]/.test(letter)) {
      command = letter;
      cursor++;
    }
    else if (!command)
      fail('INVALID_GEOMETRY', 'Path requires a command.');
    if (++commands > L.MAX_PATH_COMMANDS)
      fail('PATH_COMPLEXITY_LIMIT', 'Too many path commands.');
    const op = command.toUpperCase(), relative = command !== op;
    const point = (): Point => ({ x: read() + (relative ? position.x : 0), y: read() + (relative ? position.y : 0) });
    if (op === 'M') {
      const p = point();
      flush();
      position = p;
      start = p;
      append(p);
      command = relative ? 'l' : 'L';
    }
    else if (op === 'Z') {
      if (!current.length)
        fail('INVALID_GEOMETRY', 'Close without a subpath.');
      if (position.x !== start.x || position.y !== start.y)
        append(start);
      position = start;
      flush();
      closed[closed.length - 1] = true;
      command = '';
    }
    else {
      if (!current.length && previous === 'Z') append(position);
      if (!current.length)
        fail('INVALID_GEOMETRY', 'Path must start with moveto.');
      if (op === 'L') {
        position = point();
        append(position);
      }
      else if (op === 'H') {
        position = { x: read() + (relative ? position.x : 0), y: position.y };
        append(position);
      }
      else if (op === 'V') {
        position = { x: position.x, y: read() + (relative ? position.y : 0) };
        append(position);
      }
      else if (op === 'C' || op === 'S') {
        const control = op === 'C' ? point() : lastCubic && ['C', 'S'].includes(previous) ? { x: 2 * position.x - lastCubic.x, y: 2 * position.y - lastCubic.y } : position;
        const second = point(), end = point();
        cubic(position, control, second, end);
        lastCubic = second;
        position = end;
        curved = true;
      }
      else if (op === 'Q' || op === 'T') {
        const control = op === 'Q' ? point() : lastQuadratic && ['Q', 'T'].includes(previous) ? { x: 2 * position.x - lastQuadratic.x, y: 2 * position.y - lastQuadratic.y } : position;
        const end = point();
        cubic(position, { x: position.x + (control.x - position.x) * 2 / 3, y: position.y + (control.y - position.y) * 2 / 3 }, { x: end.x + (control.x - end.x) * 2 / 3, y: end.y + (control.y - end.y) * 2 / 3 }, end);
        lastQuadratic = control;
        position = end;
        curved = true;
      }
      else if (op === 'A') {
        const rx = read(), ry = read(), angle = read(), large = read(true), sweep = read(true), end = point();
        arc(rx, ry, angle, large, sweep, end);
        position = end;
        curved = true;
      }
      else
        fail('INVALID_GEOMETRY', `Unsupported path command ${command}.`);
    }
    if (!['C', 'S'].includes(op))
      lastCubic = undefined;
    if (!['Q', 'T'].includes(op))
      lastQuadratic = undefined;
    previous = op;
  }
  flush();
  return { subpaths, curved, closed };
}

/**
 * Isometric icons for IT components, drawn by code so that every icon shares one projection, one line weight
 * and two families of colour: orange wireframe hulls with a solid core (services and data) and solid slate
 * blocks (compute, network, clients). Own drawings made for de.sketchdraw.io; no vendor artwork.
 *
 * A new icon is a few lines in ISOMETRIC_ICONS: build a scene from boxes, hulls, cylinders and marks, back to
 * front. The scene fits itself into the view box.
 */
import type { ComponentDefinition } from '../domain/types';

type Point2 = readonly [number, number];
interface Shape {
  kind: 'poly' | 'line' | 'ellipse';
  points?: Point2[];
  centre?: Point2;
  radii?: Point2;
  fill?: string;
  stroke?: string;
  width?: number;
  opacity?: number;
  closed?: boolean;
}
interface Palette { top: [string, string]; left: [string, string]; right: [string, string]; line: string }

const COS = Math.cos(Math.PI / 6);
const SIN = 0.5;
/** x runs to the lower right, y to the lower left, z up. */
const iso = (x: number, y: number, z: number): Point2 => [(x - y) * COS, (x + y) * SIN - z];

export const ISO_ORANGE: Palette = { top: ['#fbd3ac', '#f6b983'], left: ['#f7c08e', '#ee9c5b'], right: ['#f0a465', '#e2813a'], line: '#e8833a' };
export const ISO_SLATE: Palette = { top: ['#8d99b8', '#73809f'], left: ['#65728f', '#525e7c'], right: ['#525e7c', '#414c68'], line: '#3d4863' };
const WHITE = '#ffffff';

class Scene {
  readonly shapes: Shape[] = [];
  private readonly gradients = new Map<string, string>();
  private readonly id: string;
  constructor(id: string) { this.id = id; }

  gradient(colours: readonly [string, string], direction: 'down' | 'right' = 'down'): string {
    const key = `${colours[0]}${colours[1]}${direction}`;
    let name = this.gradients.get(key);
    if (!name) {
      name = `${this.id}-g${this.gradients.size + 1}`;
      this.gradients.set(key, name);
      this.defs.push(`<linearGradient id="${name}" x1="0" y1="0" x2="${direction === 'right' ? 1 : 0}" y2="${direction === 'right' ? 0 : 1}"><stop offset="0" stop-color="${colours[0]}"/><stop offset="1" stop-color="${colours[1]}"/></linearGradient>`);
    }
    return `url(#${name})`;
  }
  readonly defs: string[] = [];

  /** A solid block: top, left and right face, edges softened by a stroke in the colour of the face. */
  box(x: number, y: number, z: number, w: number, d: number, h: number, palette: Palette): this {
    const faces: Array<[Point2[], [string, string]]> = [
      [[iso(x, y + d, z + h), iso(x + w, y + d, z + h), iso(x + w, y + d, z), iso(x, y + d, z)], palette.left],
      [[iso(x + w, y, z + h), iso(x + w, y + d, z + h), iso(x + w, y + d, z), iso(x + w, y, z)], palette.right],
      [[iso(x, y, z + h), iso(x + w, y, z + h), iso(x + w, y + d, z + h), iso(x, y + d, z + h)], palette.top],
    ];
    for (const [points, colours] of faces) this.shapes.push({ kind: 'poly', points, fill: this.gradient(colours), stroke: colours[1], width: 0.9, closed: true });
    return this;
  }
  /** A wireframe hull: the three faces towards the viewer as outlines. */
  wire(x: number, y: number, z: number, w: number, d: number, h: number, colour = ISO_ORANGE.line): this {
    const faces = [
      [iso(x, y + d, z + h), iso(x + w, y + d, z + h), iso(x + w, y + d, z), iso(x, y + d, z)],
      [iso(x + w, y, z + h), iso(x + w, y + d, z + h), iso(x + w, y + d, z), iso(x + w, y, z)],
      [iso(x, y, z + h), iso(x + w, y, z + h), iso(x + w, y + d, z + h), iso(x, y + d, z + h)],
    ];
    for (const points of faces) this.shapes.push({ kind: 'poly', points, fill: 'none', stroke: colour, width: 1.6, closed: true });
    return this;
  }
  /** A flat mark on a face, given in the coordinates of the scene. */
  mark(points: Array<readonly [number, number, number]>, options: { fill?: string; stroke?: string; width?: number; closed?: boolean; opacity?: number } = {}): this {
    this.shapes.push({ kind: options.closed === false ? 'line' : 'poly', points: points.map(([x, y, z]) => iso(x, y, z)), fill: options.fill ?? (options.closed === false ? 'none' : WHITE), stroke: options.stroke, width: options.width, opacity: options.opacity, closed: options.closed !== false });
    return this;
  }
  /** The small status light on the left face of a block. */
  light(x: number, y: number, z: number): this {
    const centre = iso(x, y, z);
    this.shapes.push({ kind: 'ellipse', centre, radii: [0.035, 0.045], fill: WHITE });
    return this;
  }
  /** A circle lying flat at height z. */
  disc(cx: number, cy: number, z: number, r: number, options: { fill?: string; stroke?: string; width?: number; opacity?: number }): this {
    this.shapes.push({ kind: 'ellipse', centre: iso(cx, cy, z), radii: [r * Math.SQRT2 * COS, r * Math.SQRT2 * SIN], ...options });
    return this;
  }
  /** An upright cylinder, solid or as a wireframe. */
  cylinder(cx: number, cy: number, z: number, r: number, h: number, palette: Palette | 'wire'): this {
    const rx = r * Math.SQRT2 * COS;
    const [bx, by] = iso(cx, cy, z);
    const top = by - h;
    if (palette === 'wire') {
      const line = ISO_ORANGE.line;
      this.disc(cx, cy, z, r, { fill: 'none', stroke: line, width: 1.6 });
      this.shapes.push({ kind: 'line', points: [[bx - rx, by], [bx - rx, top]], stroke: line, width: 1.6 }, { kind: 'line', points: [[bx + rx, by], [bx + rx, top]], stroke: line, width: 1.6 });
      this.disc(cx, cy, z + h, r, { fill: 'none', stroke: line, width: 1.6 });
      return this;
    }
    const side = this.gradient([palette.left[0], palette.right[1]], 'right');
    this.disc(cx, cy, z, r, { fill: side, stroke: palette.right[1], width: 0.9 });
    this.shapes.push({ kind: 'poly', points: [[bx - rx, by], [bx - rx, top], [bx + rx, top], [bx + rx, by]], fill: side, closed: true });
    this.shapes.push({ kind: 'line', points: [[bx - rx, by], [bx - rx, top]], stroke: palette.left[1], width: 0.9 }, { kind: 'line', points: [[bx + rx, by], [bx + rx, top]], stroke: palette.right[1], width: 0.9 });
    this.disc(cx, cy, z + h, r, { fill: this.gradient(palette.top), stroke: palette.top[1], width: 0.9 });
    return this;
  }
  /** A soft shadow on the ground under solid blocks. */
  shadow(cx: number, cy: number, r: number): this {
    const name = `${this.id}-shadow`;
    if (!this.defs.some((entry) => entry.includes(name))) this.defs.push(`<radialGradient id="${name}" cx="0.5" cy="0.5" r="0.5"><stop offset="0" stop-color="#3d4863" stop-opacity="0.34"/><stop offset="1" stop-color="#3d4863" stop-opacity="0"/></radialGradient>`);
    this.shapes.unshift({ kind: 'ellipse', centre: iso(cx, cy, -0.06), radii: [r * Math.SQRT2 * COS, r * Math.SQRT2 * SIN], fill: `url(#${name})` });
    return this;
  }
  circle(centre: Point2, r: number, options: { fill?: string; stroke?: string; width?: number }): this {
    this.shapes.push({ kind: 'ellipse', centre, radii: [r, r], ...options });
    return this;
  }
  ellipse(centre: Point2, radii: Point2, options: { fill?: string; stroke?: string; width?: number }): this {
    this.shapes.push({ kind: 'ellipse', centre, radii, ...options });
    return this;
  }

  /** The finished icon, fitted into a square view box. */
  svg(size = 96, padding = 6): string {
    let minX = Infinity; let minY = Infinity; let maxX = -Infinity; let maxY = -Infinity;
    for (const shape of this.shapes) {
      const points = shape.kind === 'ellipse' ? [[shape.centre![0] - shape.radii![0], shape.centre![1] - shape.radii![1]], [shape.centre![0] + shape.radii![0], shape.centre![1] + shape.radii![1]]] : shape.points!;
      for (const [x, y] of points) { minX = Math.min(minX, x); maxX = Math.max(maxX, x); minY = Math.min(minY, y); maxY = Math.max(maxY, y); }
    }
    const scale = (size - 2 * padding) / Math.max(maxX - minX, maxY - minY);
    const dx = (size - (maxX - minX) * scale) / 2 - minX * scale;
    const dy = (size - (maxY - minY) * scale) / 2 - minY * scale;
    const n = (value: number): string => String(Math.round(value * 100) / 100);
    const place = ([x, y]: Point2): string => `${n(x * scale + dx)},${n(y * scale + dy)}`;
    const paint = (shape: Shape): string => `${shape.fill ? ` fill="${shape.fill}"` : ' fill="none"'}${shape.stroke ? ` stroke="${shape.stroke}" stroke-width="${n(shape.width ?? 1)}" stroke-linejoin="round" stroke-linecap="round"` : ''}${shape.opacity !== undefined ? ` opacity="${n(shape.opacity)}"` : ''}`;
    const body = this.shapes.map((shape) => {
      if (shape.kind === 'ellipse') return `<ellipse cx="${n(shape.centre![0] * scale + dx)}" cy="${n(shape.centre![1] * scale + dy)}" rx="${n(shape.radii![0] * scale)}" ry="${n(shape.radii![1] * scale)}"${paint(shape)}/>`;
      return `<${shape.closed ? 'polygon' : 'polyline'} points="${shape.points!.map(place).join(' ')}"${paint(shape)}/>`;
    }).join('');
    return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${size} ${size}"><defs>${this.defs.join('')}</defs>${body}</svg>`;
  }
}

const O = ISO_ORANGE;
const S = ISO_SLATE;
const scene = (id: string): Scene => new Scene(`iso-${id}`);
/** A hull with a solid core in its middle, the basic figure of the orange family. */
const cored = (target: Scene, x: number, y: number, z: number, size: number, core = 0.5): Scene => {
  const inset = (size - size * core) / 2;
  return target.wire(x, y, z, size, size, size).box(x + inset, y + inset, z + inset, size * core, size * core, size * core, O);
};
const slab = (target: Scene, z: number, height = 0.3): Scene => target.box(0, 0, z, 1, 1, height, S).light(0.84, 1, z + height / 2);
/** An arrow lying on a top face from a to b. */
const arrow = (target: Scene, a: readonly [number, number], b: readonly [number, number], z: number, head = 0.11): Scene => {
  const length = Math.hypot(b[0] - a[0], b[1] - a[1]);
  const ux = (b[0] - a[0]) / length; const uy = (b[1] - a[1]) / length;
  target.mark([[a[0], a[1], z], [b[0], b[1], z]], { closed: false, stroke: WHITE, width: 1.5 });
  return target.mark([[b[0] - ux * head - uy * head * 0.7, b[1] - uy * head + ux * head * 0.7, z], [b[0], b[1], z], [b[0] - ux * head + uy * head * 0.7, b[1] - uy * head - ux * head * 0.7, z]], { closed: false, stroke: WHITE, width: 1.5 });
};

export interface IsometricIcon { id: string; name: string; category: string; aliases: string[]; svg: string }
/** How a component is drawn on the canvas; `icon` means the symbol stands free with its label below. */
export const COMPONENT_PRESENTATION_KEY = 'component:presentation';
export const ISOMETRIC_SET_ID = 'sketchdraw.isometric';
const SERVICES = 'Services and data';
const COMPUTE = 'Compute and network';
const CLIENTS = 'Clients and environment';

export const ISOMETRIC_ICONS: readonly IsometricIcon[] = [
  { id: 'instance', name: 'Instance', category: SERVICES, aliases: ['instanz', 'service', 'dienst', 'instance', 'node', 'cube', 'würfel'], svg: cored(scene('instance'), 0, 0, 0, 1).svg() },
  { id: 'cluster', name: 'Cluster', category: SERVICES, aliases: ['cluster', 'verbund', 'replica', 'nodes'], svg: cored(cored(cored(scene('cluster'), 0, 0, 1, 1), 0, 1, 0, 1), 1, 0, 0, 1).svg() },
  { id: 'microservices', name: 'Microservices', category: SERVICES, aliases: ['microservice', 'services', 'pod', 'container', 'kubernetes'], svg: (() => {
    const s = scene('microservices').wire(0, 0, 0, 1, 1, 1);
    for (const [x, y, z] of [[0.14, 0.14, 0.14], [0.56, 0.14, 0.14], [0.14, 0.56, 0.14], [0.56, 0.56, 0.14], [0.35, 0.35, 0.52]] as const) s.box(x, y, z, 0.3, 0.3, 0.3, O);
    return s.svg();
  })() },
  { id: 'database', name: 'Database', category: SERVICES, aliases: ['datenbank', 'database', 'db', 'sql', 'postgres', 'mysql', 'relational'], svg: (() => {
    const s = scene('database').cylinder(0, 0, 0, 0.5, 1.05, 'wire');
    for (const z of [0.12, 0.42, 0.72]) s.cylinder(0, 0, z, 0.3, 0.2, O);
    return s.svg();
  })() },
  { id: 'storage', name: 'Object Storage', category: SERVICES, aliases: ['objektspeicher', 'storage', 'bucket', 'blob', 's3', 'speicher', 'object'], svg: (() => {
    const s = scene('storage').wire(0, 0, 0, 1, 1, 0.8);
    for (const z of [0.1, 0.33, 0.56]) s.box(0.16, 0.16, z, 0.68, 0.68, 0.14, O);
    return s.svg();
  })() },
  { id: 'queue', name: 'Message Queue', category: SERVICES, aliases: ['queue', 'broker', 'kafka', 'rabbitmq', 'warteschlange', 'messages', 'event'], svg: (() => {
    const s = scene('queue').wire(0, 0, 0, 2, 0.8, 0.8);
    for (const x of [0.2, 0.8, 1.4]) s.box(x, 0.2, 0.2, 0.4, 0.4, 0.4, O);
    return s.svg();
  })() },
  { id: 'cache', name: 'Cache', category: SERVICES, aliases: ['cache', 'redis', 'memcached', 'memory', 'zwischenspeicher'], svg: (() => {
    const s = scene('cache').wire(0, 0, 0, 1, 1, 1).box(0.2, 0.2, 0.2, 0.6, 0.6, 0.6, O);
    return s.mark([[0.56, 0.3, 0.8], [0.36, 0.52, 0.8], [0.5, 0.52, 0.8], [0.44, 0.7, 0.8], [0.64, 0.46, 0.8], [0.5, 0.46, 0.8]], { fill: WHITE }).svg();
  })() },
  { id: 'gateway', name: 'API Gateway', category: SERVICES, aliases: ['gateway', 'api', 'ingress', 'proxy', 'schnittstelle'], svg: (() => {
    const s = scene('gateway').wire(0, 0, 0, 1, 1, 0.7).box(0.15, 0.15, 0.2, 0.7, 0.7, 0.3, O);
    arrow(s, [0.3, 0.38], [0.7, 0.38], 0.5); arrow(s, [0.7, 0.62], [0.3, 0.62], 0.5);
    return s.svg();
  })() },
  { id: 'function', name: 'Function', category: SERVICES, aliases: ['funktion', 'function', 'lambda', 'serverless', 'faas', 'job', 'code'], svg: (() => {
    const s = scene('function').wire(0, 0, 0, 1, 1, 1).box(0.2, 0.2, 0.2, 0.6, 0.6, 0.6, O);
    const stroke = { closed: false, stroke: WHITE, width: 1.5 } as const;
    // The brackets sit on the left face, where a mark reads upright.
    return s.mark([[0.42, 0.8, 0.64], [0.3, 0.8, 0.5], [0.42, 0.8, 0.36]], stroke).mark([[0.58, 0.8, 0.64], [0.7, 0.8, 0.5], [0.58, 0.8, 0.36]], stroke).svg();
  })() },
  { id: 'model', name: 'AI Model', category: SERVICES, aliases: ['ki-modell', 'ai', 'ki', 'model', 'modell', 'llm', 'ml', 'inference', 'agent'], svg: (() => {
    const s = scene('model').wire(0, 0, 0, 1, 1, 1).box(0.2, 0.2, 0.2, 0.6, 0.6, 0.6, O);
    const c = 0.5; const long = 0.2; const short = 0.055;
    return s.mark([[c, c - long, 0.8], [c + short, c - short, 0.8], [c + long, c, 0.8], [c + short, c + short, 0.8], [c, c + long, 0.8], [c - short, c + short, 0.8], [c - long, c, 0.8], [c - short, c - short, 0.8]], { fill: WHITE }).svg();
  })() },
  { id: 'warehouse', name: 'Data Warehouse', category: SERVICES, aliases: ['warehouse', 'data lake', 'lakehouse', 'analytics', 'bigquery', 'snowflake', 'databricks', 'olap'], svg: (() => {
    const s = scene('warehouse').wire(0, 0, 0, 1.3, 1.3, 0.8);
    for (const [x, y] of [[0.36, 0.36], [0.94, 0.36], [0.36, 0.94], [0.94, 0.94]] as const) s.cylinder(x, y, 0.1, 0.2, 0.42, O);
    return s.svg();
  })() },
  { id: 'monitoring', name: 'Monitoring', category: SERVICES, aliases: ['monitoring', 'metrics', 'analytics', 'logs', 'elk', 'grafana', 'observability', 'dashboard'], svg: (() => {
    const s = scene('monitoring').wire(0, 0, 0, 1.3, 0.7, 0.12);
    s.box(0.14, 0.2, 0.12, 0.26, 0.3, 0.35, O).box(0.52, 0.2, 0.12, 0.26, 0.3, 0.75, O).box(0.9, 0.2, 0.12, 0.26, 0.3, 0.52, O);
    return s.svg();
  })() },
  { id: 'internet', name: 'Internet', category: SERVICES, aliases: ['internet', 'web', 'cdn', 'globe', 'dns', 'world', 'netz'], svg: (() => {
    const s = scene('internet');
    s.circle([0, 0], 1, { fill: 'none', stroke: O.line, width: 1.6 }).ellipse([0, 0], [1, 0.36], { fill: 'none', stroke: O.line, width: 1.6 }).ellipse([0, 0], [0.42, 1], { fill: 'none', stroke: O.line, width: 1.6 });
    return s.circle([0, 0], 0.4, { fill: s.gradient([O.top[0], O.right[1]]), stroke: O.right[1], width: 0.9 }).svg();
  })() },

  { id: 'server', name: 'Server', category: COMPUTE, aliases: ['server', 'worker', 'host', 'vm', 'machine', 'rechner'], svg: slab(scene('server').shadow(0.5, 0.5, 0.62), 0).svg() },
  { id: 'server-stack', name: 'App Server', category: COMPUTE, aliases: ['anwendungsserver', 'app', 'application', 'server', 'stack', 'backend', 'anwendung'], svg: slab(slab(slab(scene('server-stack').shadow(0.5, 0.5, 0.62), 0), 0.34), 0.68).svg() },
  { id: 'rack', name: 'Rack', category: COMPUTE, aliases: ['rack', 'datacenter', 'rechenzentrum', 'tower', 'mainframe'], svg: (() => {
    const s = scene('rack').shadow(0.4, 0.5, 0.6).box(0, 0, 0, 0.8, 1, 1.7, S);
    for (const z of [0.3, 0.62, 0.94, 1.26]) s.mark([[0.12, 1, z], [0.68, 1, z], [0.68, 1, z + 0.14], [0.12, 1, z + 0.14]], { fill: WHITE, opacity: 0.28 }).light(0.6, 1, z + 0.07);
    return s.svg();
  })() },
  { id: 'load-balancer', name: 'Load Balancer', category: COMPUTE, aliases: ['load balancer', 'lb', 'lastverteiler', 'balancer', 'traffic'], svg: (() => {
    const s = slab(scene('load-balancer').shadow(0.5, 0.5, 0.62), 0);
    s.mark([[0.5, 0.82, 0.3], [0.5, 0.52, 0.3]], { closed: false, stroke: WHITE, width: 1.5 });
    arrow(s, [0.5, 0.52], [0.22, 0.2], 0.3); arrow(s, [0.5, 0.52], [0.78, 0.2], 0.3);
    return s.svg();
  })() },
  { id: 'router', name: 'Router', category: COMPUTE, aliases: ['router', 'switch', 'network', 'netzwerk', 'vpn', 'routing'], svg: (() => {
    const s = slab(scene('router').shadow(0.5, 0.5, 0.62), 0);
    arrow(s, [0.5, 0.42], [0.5, 0.16], 0.3); arrow(s, [0.5, 0.58], [0.5, 0.84], 0.3); arrow(s, [0.42, 0.5], [0.16, 0.5], 0.3); arrow(s, [0.58, 0.5], [0.84, 0.5], 0.3);
    return s.svg();
  })() },
  { id: 'firewall', name: 'Firewall', category: COMPUTE, aliases: ['firewall', 'waf', 'security', 'sicherheit', 'schutz', 'wall'], svg: (() => {
    const s = scene('firewall').shadow(0.7, 0.2, 0.7).box(0, 0, 0, 1.4, 0.3, 1, S);
    const line = { closed: false, stroke: WHITE, width: 1.1, opacity: 0.55 } as const;
    for (const z of [0.25, 0.5, 0.75]) s.mark([[0, 0.3, z], [1.4, 0.3, z]], line);
    for (const [x, z] of [[0.35, 0], [1.05, 0], [0.7, 0.25], [0.35, 0.5], [1.05, 0.5], [0.7, 0.75]] as const) s.mark([[x, 0.3, z], [x, 0.3, z + 0.25]], line);
    return s.svg();
  })() },
  { id: 'disk', name: 'Disk', category: COMPUTE, aliases: ['datenträger', 'disk', 'volume', 'ssd', 'festplatte', 'block storage', 'laufwerk'], svg: (() => {
    const s = scene('disk').shadow(0, 0, 0.62);
    return s.cylinder(0, 0, 0, 0.5, 0.22, S).cylinder(0, 0, 0.3, 0.5, 0.22, S).cylinder(0, 0, 0.6, 0.5, 0.22, S).svg();
  })() },
  { id: 'vault', name: 'Secrets', category: COMPUTE, aliases: ['secrets', 'vault', 'key', 'schlüssel', 'kms', 'lock', 'tresor'], svg: (() => {
    const s = scene('vault').shadow(0.5, 0.5, 0.62).box(0, 0, 0, 1, 1, 1, S);
    s.ellipse(iso(0.5, 1, 0.6), [0.12, 0.14], { fill: WHITE });
    return s.mark([[0.44, 1, 0.56], [0.56, 1, 0.56], [0.6, 1, 0.3], [0.4, 1, 0.3]], { fill: WHITE }).svg();
  })() },

  { id: 'identity', name: 'Identity', category: COMPUTE, aliases: ['identity', 'iam', 'auth', 'login', 'sso', 'oauth', 'anmeldung', 'identität'], svg: (() => {
    const s = scene('identity').shadow(0.5, 0.5, 0.62).box(0, 0, 0, 1, 1, 1, S);
    s.ellipse(iso(0.5, 1, 0.66), [0.11, 0.13], { fill: WHITE });
    return s.mark([[0.3, 1, 0.24], [0.34, 1, 0.42], [0.44, 1, 0.48], [0.56, 1, 0.48], [0.66, 1, 0.42], [0.7, 1, 0.24]], { fill: WHITE }).svg();
  })() },
  { id: 'mail', name: 'Mail', category: COMPUTE, aliases: ['e-mail', 'mail', 'email', 'smtp', 'notification', 'benachrichtigung', 'nachricht'], svg: (() => {
    const s = scene('mail').shadow(0.6, 0.4, 0.62).box(0, 0, 0, 1.2, 0.8, 0.16, S);
    const stroke = { closed: false, stroke: WHITE, width: 1.4 } as const;
    return s.mark([[0.14, 0.14, 0.16], [1.06, 0.14, 0.16], [1.06, 0.66, 0.16], [0.14, 0.66, 0.16]], { fill: 'none', stroke: WHITE, width: 1.4 }).mark([[0.14, 0.14, 0.16], [0.6, 0.44, 0.16], [1.06, 0.14, 0.16]], stroke).svg();
  })() },
  { id: 'scheduler', name: 'Scheduler', category: COMPUTE, aliases: ['scheduler', 'cron', 'timer', 'zeitplan', 'job', 'batch', 'uhr'], svg: (() => {
    const s = scene('scheduler').shadow(0, 0, 0.62).cylinder(0, 0, 0, 0.5, 0.26, S);
    s.disc(0, 0, 0.26, 0.36, { fill: 'none', stroke: WHITE, width: 1.3 });
    return s.mark([[0, -0.24, 0.26], [0, 0, 0.26], [0.16, 0.1, 0.26]], { closed: false, stroke: WHITE, width: 1.5 }).svg();
  })() },

  { id: 'desktop', name: 'Desktop Client', category: CLIENTS, aliases: ['arbeitsplatz', 'client', 'desktop', 'pc', 'browser', 'monitor', 'workstation'], svg: (() => {
    const s = scene('desktop').shadow(0.55, 0.45, 0.62).box(0.25, 0.25, 0, 0.6, 0.4, 0.06, S).box(0.5, 0.4, 0.06, 0.1, 0.1, 0.3, S).box(0, 0.38, 0.36, 1.1, 0.1, 0.72, S);
    return s.mark([[0.07, 0.48, 0.44], [1.03, 0.48, 0.44], [1.03, 0.48, 1], [0.07, 0.48, 1]], { fill: WHITE, opacity: 0.3 }).svg();
  })() },
  { id: 'laptop', name: 'Laptop', category: CLIENTS, aliases: ['laptop', 'notebook', 'client', 'developer', 'entwickler'], svg: (() => {
    const s = scene('laptop').shadow(0.55, 0.4, 0.62).box(0, 0, 0.08, 1.1, 0.08, 0.7, S).box(0, 0, 0, 1.1, 0.8, 0.08, S);
    return s.mark([[0.07, 0.08, 0.16], [1.03, 0.08, 0.16], [1.03, 0.08, 0.7], [0.07, 0.08, 0.7]], { fill: WHITE, opacity: 0.3 }).mark([[0.12, 0.2, 0.08], [0.98, 0.2, 0.08], [0.98, 0.52, 0.08], [0.12, 0.52, 0.08]], { fill: WHITE, opacity: 0.2 }).svg();
  })() },
  { id: 'mobile', name: 'Smartphone', category: CLIENTS, aliases: ['mobile', 'phone', 'smartphone', 'app', 'handy', 'ios', 'android'], svg: (() => {
    const s = scene('mobile').shadow(0.3, 0.06, 0.4).box(0, 0, 0, 0.6, 0.1, 1.15, S);
    return s.mark([[0.06, 0.1, 0.14], [0.54, 0.1, 0.14], [0.54, 0.1, 1.03], [0.06, 0.1, 1.03]], { fill: WHITE, opacity: 0.3 }).svg();
  })() },
  { id: 'user', name: 'User', category: CLIENTS, aliases: ['user', 'benutzer', 'person', 'kunde', 'customer', 'actor', 'akteur'], svg: (() => {
    const s = scene('user').shadow(0, 0, 0.5).cylinder(0, 0, 0, 0.36, 0.62, S);
    const [hx, hy] = iso(0, 0, 1.02);
    return s.circle([hx, hy], 0.3, { fill: s.gradient([S.top[0], S.right[1]]), stroke: S.right[1], width: 0.9 }).svg();
  })() },
  { id: 'zone', name: 'Zone', category: CLIENTS, aliases: ['zone', 'region', 'vpc', 'network', 'umgebung', 'plattform', 'platform', 'namespace'], svg: scene('zone').wire(0, 0, 0, 1.6, 1.6, 0.1).mark([[0.25, 0.25, 0.1], [1.35, 0.25, 0.1], [1.35, 1.35, 0.1], [0.25, 1.35, 0.1]], { fill: 'none', stroke: O.line, width: 1.1, opacity: 0.6 }).svg() },
];

/** Aliases are identifiers in the catalogue: ASCII without spaces. */
const aliasId = (alias: string): string => alias.replace(/ä/g, 'ae').replace(/ö/g, 'oe').replace(/ü/g, 'ue').replace(/ß/g, 'ss').replace(/\s+/g, '-');

export const ISOMETRIC_COMPONENTS: ComponentDefinition[] = ISOMETRIC_ICONS.map((icon) => ({
  type: `generic.isometric.${icon.id}`,
  name: icon.name,
  provider: 'generic',
  category: icon.category,
  aliases: ['isometric', 'isometrisch', '3d', ...icon.aliases.map(aliasId)],
  defaultWidth: 120,
  defaultHeight: 132,
  style: { stroke: '#1e293b', fill: 'transparent', strokeWidth: 0, fontSize: 14, textAlign: 'center' },
  metadata: { provenance: 'sketchdraw-isometric-symbol', [COMPONENT_PRESENTATION_KEY]: 'icon' },
  iconSvg: icon.svg,
}));


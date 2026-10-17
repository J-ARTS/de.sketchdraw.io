import type { ElementKind, ElementStyle } from '@/domain/types';
import type { Size, Tool } from '@/renderer/state/contract';

export const ZOOM_MIN = 0.1;
export const ZOOM_MAX = 4;

export const MIN_DIMENSION = 1;
/** Drawn shapes smaller than this (document units) are treated as an accidental click. */
export const MIN_DRAWN_SIZE = 8;
export const DRAG_THRESHOLD_PX = 3;

/** Only free-form content keeps the canvas rotate handle; shapes and components resize only (#36). */
export const ROTATABLE_KINDS: ReadonlySet<ElementKind> = new Set<ElementKind>(['text', 'image', 'path']);
/** Kinds that offer quick-connect handles to create a connected copy (#36). */
export const QUICK_CONNECT_KINDS: ReadonlySet<ElementKind> = new Set<ElementKind>(['rectangle', 'ellipse', 'diamond', 'component']);

/** Screen-pixel values; callers divide by zoom where document units are needed. */
export const HIT_TOLERANCE_PX = 8;
export const HANDLE_VISUAL_PX = 10;
export const HANDLE_HIT_PX = 24;
export const ROTATE_HANDLE_OFFSET_PX = 28;

export const NUDGE_SMALL = 1;
export const NUDGE_LARGE = 10;
export const ROTATE_SNAP_DEG = 15;

export const ACTOR_ID = 'local-user';

/** The domain stores colors as plain strings; 'transparent' is the documented "no fill" value (contracts-s2). */
export const NO_FILL = 'transparent';

export const DEFAULT_STYLE: Readonly<ElementStyle> = {
  stroke: '#1e1e1e',
  fill: NO_FILL,
  strokeWidth: 2,
  opacity: 1,
  fontSize: 20,
  textAlign: 'left',
  strokeDash: 'solid',
  fontFamily: 'sans',
};

/** Overrides applied on top of DEFAULT_STYLE when a new element of that kind is created. */
export const STYLE_BY_KIND: Readonly<Partial<Record<ElementKind, Readonly<Partial<ElementStyle>>>>> = {
  container: { stroke: '#868e96', strokeDash: 'dashed', strokeWidth: 1 },
  // Text color is style.stroke; 1 instead of 0 because the domain's accepted lower bound for strokeWidth is unverified.
  text: { strokeWidth: 1 },
};

export const DEFAULT_SIZES: Readonly<Partial<Record<Tool, Readonly<Size>>>> = {
  rectangle: { width: 160, height: 100 },
  ellipse: { width: 160, height: 100 },
  diamond: { width: 160, height: 120 },
  container: { width: 360, height: 240 },
  text: { width: 240, height: 36 },
};

export interface NamedColor { name: string; value: string }

export const STROKE_COLORS: readonly NamedColor[] = [
  { name: 'Schwarz', value: '#1e1e1e' },
  { name: 'Grau', value: '#868e96' },
  { name: 'Rot', value: '#e03131' },
  { name: 'Orange', value: '#e8590c' },
  { name: 'Grün', value: '#2f9e44' },
  { name: 'Türkis', value: '#0c8599' },
  { name: 'Blau', value: '#1971c2' },
  { name: 'Violett', value: '#6741d9' },
];

export const FILL_COLORS: readonly NamedColor[] = [
  { name: 'Keine Füllung', value: NO_FILL },
  { name: 'Hellgrau', value: '#e9ecef' },
  { name: 'Hellrot', value: '#ffc9c9' },
  { name: 'Hellorange', value: '#ffd8a8' },
  { name: 'Hellgelb', value: '#ffec99' },
  { name: 'Hellgrün', value: '#b2f2bb' },
  { name: 'Hellblau', value: '#a5d8ff' },
  { name: 'Hellviolett', value: '#d0bfff' },
];

export const FONT_FAMILY_CSS: Readonly<Record<'sans' | 'mono', string>> = {
  sans: "'Inter Variable', system-ui, sans-serif",
  mono: "'JetBrains Mono Variable', ui-monospace, monospace",
};

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
  // Labels inside shapes start centered, matching the in-place editor (#41).
  rectangle: { textAlign: 'center' },
  ellipse: { textAlign: 'center' },
  diamond: { textAlign: 'center' },
};

export const DEFAULT_SIZES: Readonly<Partial<Record<Tool, Readonly<Size>>>> = {
  rectangle: { width: 160, height: 100 },
  ellipse: { width: 160, height: 100 },
  diamond: { width: 160, height: 120 },
  container: { width: 360, height: 240 },
  text: { width: 240, height: 36 },
};

export interface NamedColor { name: string; value: string }

/** Shared stroke and fill palette (#38): strong colors, then their light tints. */
export const PALETTE: readonly NamedColor[] = [
  { name: 'Schwarz', value: '#1e1e1e' },
  { name: 'Grau', value: '#757575' },
  { name: 'Rot', value: '#e5533a' },
  { name: 'Orange', value: '#f2a65a' },
  { name: 'Gelb', value: '#f9cc5f' },
  { name: 'Grün', value: '#82d283' },
  { name: 'Türkis', value: '#7fd8cc' },
  { name: 'Blau', value: '#5aabf7' },
  { name: 'Violett', value: '#8558f0' },
  { name: 'Pink', value: '#e05cbf' },
  { name: 'Weiß', value: '#ffffff' },
  { name: 'Hellgrau', value: '#b4b4b4' },
  { name: 'Silber', value: '#dcdcdc' },
  { name: 'Hellrot', value: '#f6c9c4' },
  { name: 'Pfirsich', value: '#fcdfc3' },
  { name: 'Hellgelb', value: '#fdefc6' },
  { name: 'Hellgrün', value: '#d6f2d6' },
  { name: 'Helltürkis', value: '#d2f5f2' },
  { name: 'Hellblau', value: '#cfe3fb' },
  { name: 'Hellviolett', value: '#ddd3fa' },
  { name: 'Hellpink', value: '#f6cde8' },
];

export const FONT_FAMILY_CSS: Readonly<Record<'sans' | 'mono', string>> = {
  sans: "'Inter Variable', system-ui, sans-serif",
  mono: "'JetBrains Mono Variable', ui-monospace, monospace",
};

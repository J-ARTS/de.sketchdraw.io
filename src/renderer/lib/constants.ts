import type { ElementKind, ElementStyle } from '@/domain/types';
import type { Size, Tool } from '@/renderer/state/contract';

import { L } from '@/renderer/i18n';
export const ZOOM_MIN = 0.1;
export const ZOOM_MAX = 4;

export const MIN_DIMENSION = 1;
/** Drawn shapes smaller than this (document units) are treated as an accidental click. */
export const MIN_DRAWN_SIZE = 8;
export const DRAG_THRESHOLD_PX = 3;

/** Only free-form content keeps the canvas rotate handle; shapes and components resize only (#36). */
export const ROTATABLE_KINDS: ReadonlySet<ElementKind> = new Set<ElementKind>(['text', 'sticky-note', 'annotation', 'image', 'path']);
/** Kinds that offer quick-connect handles to create a connected copy (#36). */
export const QUICK_CONNECT_KINDS: ReadonlySet<ElementKind> = new Set<ElementKind>(['rectangle', 'ellipse', 'diamond', 'component', 'sticky-note', 'annotation']);

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
  // Legacy text inherits style.stroke until the user chooses an independent style.textColor.
  // 1 instead of 0 because the domain's accepted lower bound for strokeWidth is unverified.
  text: { strokeWidth: 1 },
  // Labels inside shapes start centered, matching the in-place editor (#41).
  rectangle: { textAlign: 'center' },
  ellipse: { textAlign: 'center' },
  diamond: { textAlign: 'center' },
  'sticky-note': {
    fill: '#aeeebd', stroke: '#53675a', strokeWidth: 0, fontSize: 20,
    textAlign: 'left', fontFamily: 'sans', fontWeight: 'normal', textDecoration: 'none', listStyle: 'none',
  },
  annotation: {
    fill: '#ffffff', stroke: '#242424', strokeWidth: 1, fontSize: 18,
    textAlign: 'left', fontFamily: 'sans', fontWeight: 'normal', textDecoration: 'none', listStyle: 'none',
  },
  table: {
    fill: '#ffffff', stroke: '#cbd5e1', strokeWidth: 1, fontSize: 16,
    textAlign: 'left', fontFamily: 'sans', fontWeight: 'normal', textDecoration: 'none', listStyle: 'none',
  },
  frame: {
    fill: 'transparent', stroke: '#8558f0', strokeWidth: 2, strokeDash: 'dashed', fontSize: 16,
    textAlign: 'left', fontFamily: 'sans', fontWeight: 'normal', textDecoration: 'none', listStyle: 'none',
  },
};

export const DEFAULT_SIZES: Readonly<Partial<Record<Tool, Readonly<Size>>>> = {
  rectangle: { width: 160, height: 100 },
  ellipse: { width: 160, height: 100 },
  diamond: { width: 160, height: 120 },
  container: { width: 360, height: 240 },
  text: { width: 240, height: 36 },
  'sticky-note': { width: 240, height: 240 },
  annotation: { width: 520, height: 320 },
  table: { width: 480, height: 240 },
  frame: { width: 1280, height: 720 },
};

export interface NamedColor { name: string; value: string }

/** Shared stroke and fill palette (#38): strong colors, then their light tints. */
export const PALETTE: readonly NamedColor[] = [
  { name: L('Schwarz'), value: '#1e1e1e' },
  { name: L('Grau'), value: '#757575' },
  { name: L('Rot'), value: '#e5533a' },
  { name: L('Orange'), value: '#f2a65a' },
  { name: L('Gelb'), value: '#f9cc5f' },
  { name: L('Grün'), value: '#82d283' },
  { name: L('Türkis'), value: '#7fd8cc' },
  { name: L('Blau'), value: '#5aabf7' },
  { name: L('Violett'), value: '#8558f0' },
  { name: L('Pink'), value: '#e05cbf' },
  { name: L('Weiß'), value: '#ffffff' },
  { name: L('Hellgrau'), value: '#b4b4b4' },
  { name: L('Silber'), value: '#dcdcdc' },
  { name: L('Hellrot'), value: '#f6c9c4' },
  { name: L('Pfirsich'), value: '#fcdfc3' },
  { name: L('Hellgelb'), value: '#fdefc6' },
  { name: L('Hellgrün'), value: '#d6f2d6' },
  { name: L('Helltürkis'), value: '#d2f5f2' },
  { name: L('Hellblau'), value: '#cfe3fb' },
  { name: L('Hellviolett'), value: '#ddd3fa' },
  { name: L('Hellpink'), value: '#f6cde8' },
];

/** Single source of truth for rendering an element's fontFamily (canvas text and inline editor). */
export function fontFamilyCss(family: ElementStyle['fontFamily']): string {
  return FONT_FAMILY_CSS[family ?? 'sans'];
}

export const FONT_FAMILY_CSS: Readonly<Record<NonNullable<ElementStyle['fontFamily']>, string>> = {
  sans: "'Inter Variable', system-ui, sans-serif",
  mono: "'JetBrains Mono Variable', ui-monospace, monospace",
  roboto: "'Roboto Variable', Roboto, system-ui, sans-serif",
  scribbled: "'Caveat Variable', Caveat, cursive",
};

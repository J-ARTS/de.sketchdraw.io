import { NO_FILL } from './constants';

export type ThemeName = 'light' | 'dark';

export interface Rgba { r: number; g: number; b: number; a: number }

/** Reference canvas colors for contrast checks; the CSS surface.canvas tokens should use the same values. */
export const CANVAS_BACKGROUND: Readonly<Record<ThemeName, string>> = {
  light: '#ffffff',
  dark: '#1b1d22',
};

const HEX_PATTERN = /^#(?:[0-9a-f]{3,4}|[0-9a-f]{6}|[0-9a-f]{8})$/i;

/** Colors below this HSL saturation count as neutral. */
const NEUTRAL_SATURATION = 0.2;
/** Chromatic colors outside this lightness band (pastel fills, near-black tints) are flipped instead of just lightened. */
const BAND_MIN = 0.2;
const BAND_MAX = 0.7;
const LIGHTEN_SHARE = 0.15;
const CHROMATIC_FLIP_SATURATION = 0.6;

export function parseColor(input: string): Rgba | null {
  const text = input.trim();
  if (!HEX_PATTERN.test(text)) return null;
  let hex = text.slice(1);
  if (hex.length <= 4) hex = Array.from(hex, (digit) => digit + digit).join('');
  const channel = (offset: number): number => parseInt(hex.slice(offset, offset + 2), 16);
  return {
    r: channel(0),
    g: channel(2),
    b: channel(4),
    a: hex.length === 8 ? channel(6) / 255 : 1,
  };
}

function linearize(channel: number): number {
  const c = channel / 255;
  return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
}

export function relativeLuminance(color: Pick<Rgba, 'r' | 'g' | 'b'>): number {
  return 0.2126 * linearize(color.r) + 0.7152 * linearize(color.g) + 0.0722 * linearize(color.b);
}

/** Returns 1 (no contrast) for unparsable input so a bad color is never reported as readable. */
export function contrastRatio(a: string, b: string): number {
  const first = parseColor(a);
  const second = parseColor(b);
  if (first === null || second === null) return 1;
  const l1 = relativeLuminance(first);
  const l2 = relativeLuminance(second);
  return (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05);
}

interface Hsl { h: number; s: number; l: number }

function rgbToHsl(r: number, g: number, b: number): Hsl {
  const rn = r / 255;
  const gn = g / 255;
  const bn = b / 255;
  const max = Math.max(rn, gn, bn);
  const min = Math.min(rn, gn, bn);
  const l = (max + min) / 2;
  const d = max - min;
  if (d === 0) return { h: 0, s: 0, l };
  const s = d / (1 - Math.abs(2 * l - 1));
  let h: number;
  if (max === rn) h = ((gn - bn) / d) % 6;
  else if (max === gn) h = (bn - rn) / d + 2;
  else h = (rn - gn) / d + 4;
  return { h: (h * 60 + 360) % 360, s, l };
}

function hslToRgb(h: number, s: number, l: number): [number, number, number] {
  const c = (1 - Math.abs(2 * l - 1)) * s;
  const hp = (((h % 360) + 360) % 360) / 60;
  const x = c * (1 - Math.abs((hp % 2) - 1));
  let r = 0;
  let g = 0;
  let b = 0;
  if (hp < 1) { r = c; g = x; }
  else if (hp < 2) { r = x; g = c; }
  else if (hp < 3) { g = c; b = x; }
  else if (hp < 4) { g = x; b = c; }
  else if (hp < 5) { r = x; b = c; }
  else { r = c; b = x; }
  const m = l - c / 2;
  return [(r + m) * 255, (g + m) * 255, (b + m) * 255];
}

function hexByte(value: number): string {
  const clamped = Math.min(255, Math.max(0, Math.round(value)));
  return clamped.toString(16).padStart(2, '0');
}

/** Mirrors lightness into 0.14..0.94 so inverted white stays distinguishable from the dark canvas. */
function mirrorNeutral(l: number): number {
  return 0.14 + (1 - l) * 0.8;
}

/** Flipped pastel fills stay dark enough (about 0.12..0.3) for light text on top to keep 4.5:1. */
function mirrorChromatic(l: number): number {
  return 0.12 + (1 - l) * 0.6;
}

/**
 * Maps a stored (light-theme) color to its display color. The stored value is never rewritten.
 * Dark: neutrals and very light/dark colors are mirrored in lightness; mid-lightness saturated colors are lightened slightly.
 */
export function themeColor(color: string, theme: ThemeName): string {
  if (theme === 'light' || color === NO_FILL) return color;
  const parsed = parseColor(color);
  if (parsed === null) return color;

  const { h, s, l } = rgbToHsl(parsed.r, parsed.g, parsed.b);
  let nextS = s;
  let nextL: number;
  if (s < NEUTRAL_SATURATION) {
    nextL = mirrorNeutral(l);
  } else if (l < BAND_MIN || l > BAND_MAX) {
    nextL = mirrorChromatic(l);
    nextS = s * CHROMATIC_FLIP_SATURATION;
  } else {
    nextL = l + (1 - l) * LIGHTEN_SHARE;
  }

  const [r, g, b] = hslToRgb(h, nextS, nextL);
  const alpha = parsed.a < 1 ? hexByte(parsed.a * 255) : '';
  return `#${hexByte(r)}${hexByte(g)}${hexByte(b)}${alpha}`;
}

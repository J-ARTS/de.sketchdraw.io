/** Color helpers for the toolbar palette and picker (#38). Colors stay plain strings in the document. */

export interface Hsv { h: number; s: number; v: number }
export type FillMode = 'fill' | 'semi' | 'none';

export const NO_COLOR = 'transparent';
/** Alpha suffix of a semi-transparent fill (#rrggbb + 4d ≈ 30 %). */
export const SEMI_ALPHA = '4d';

/** Accepts #rgb, #rrggbb and #rrggbbaa (with or without #); returns lowercase #rrggbb or null. */
export function normalizeHex(input: string): string | null {
  const text = input.trim().replace(/^#/, '').toLowerCase();
  if (/^[\da-f]{3}$/.test(text)) return `#${Array.from(text, (digit) => digit + digit).join('')}`;
  if (/^[\da-f]{6}([\da-f]{2})?$/.test(text)) return `#${text.slice(0, 6)}`;
  return null;
}

export function fillMode(fill: string | undefined): FillMode {
  if (!fill || fill === NO_COLOR) return 'none';
  return /^#[\da-f]{8}$/i.test(fill) && !/ff$/i.test(fill) ? 'semi' : 'fill';
}

export function withFillMode(color: string, mode: FillMode): string {
  if (mode === 'none') return NO_COLOR;
  const base = normalizeHex(color) ?? color;
  return mode === 'semi' ? `${base}${SEMI_ALPHA}` : base;
}

export function hexToHsv(hex: string): Hsv | null {
  const value = normalizeHex(hex);
  if (!value) return null;
  const [r, g, b] = [1, 3, 5].map((offset) => parseInt(value.slice(offset, offset + 2), 16) / 255) as [number, number, number];
  const max = Math.max(r, g, b);
  const delta = max - Math.min(r, g, b);
  let h = 0;
  if (delta) {
    if (max === r) h = ((g - b) / delta) % 6;
    else if (max === g) h = (b - r) / delta + 2;
    else h = (r - g) / delta + 4;
  }
  return { h: (h * 60 + 360) % 360, s: max ? delta / max : 0, v: max };
}

export function hsvToHex({ h, s, v }: Hsv): string {
  const chroma = v * s;
  const x = chroma * (1 - Math.abs(((h / 60) % 2) - 1));
  const m = v - chroma;
  const [r, g, b] = h < 60 ? [chroma, x, 0] : h < 120 ? [x, chroma, 0] : h < 180 ? [0, chroma, x] : h < 240 ? [0, x, chroma] : h < 300 ? [x, 0, chroma] : [chroma, 0, x];
  return `#${[r, g, b].map((channel) => Math.round((channel + m) * 255).toString(16).padStart(2, '0')).join('')}`;
}

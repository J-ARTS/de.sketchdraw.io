import { bytesToBase64 } from './pptx';
import type { SlideFontFamily, SlideFontLoader } from './slide-export';

/** The font files the app ships for Latin and Latin Extended. They live in node_modules, hence `exhaustive`. */
const files = import.meta.glob<string>([
  '/node_modules/@fontsource-variable/{inter,jetbrains-mono,roboto,caveat}/files/*-latin-wght-normal.woff2',
  '/node_modules/@fontsource-variable/{inter,jetbrains-mono,roboto,caveat}/files/*-latin-ext-wght-normal.woff2',
], { query: '?url', import: 'default', exhaustive: true });
const PACKAGE: Record<SlideFontFamily, string> = { Inter: 'inter', 'JetBrains Mono': 'jetbrains-mono', Roboto: 'roboto', Caveat: 'caveat' };

/** Reads a font of the app for the slide pictures (#266). The file comes from the app itself, never from the network. */
export const loadSlideFont: SlideFontLoader = async (family, subset) => {
  const suffix = `/${PACKAGE[family]}-${subset}-wght-normal.woff2`;
  const key = Object.keys(files).find((path) => path.endsWith(suffix));
  if (!key) return null;
  const response = await fetch(await files[key]!());
  return response.ok ? bytesToBase64(new Uint8Array(await response.arrayBuffer())) : null;
};

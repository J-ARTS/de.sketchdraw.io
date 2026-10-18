import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

// #83: an undefined custom property silently invalidates its declaration (no hover, no shadow, no background).
const RENDERER = join(process.cwd(), 'src/renderer');

function sources(directory: string): string[] {
  return readdirSync(directory).flatMap((name) => {
    const path = join(directory, name);
    if (statSync(path).isDirectory()) return sources(path);
    return /\.(vue|css|ts)$/.test(name) ? [path] : [];
  });
}

const files = sources(RENDERER).map((path) => ({ path: path.slice(process.cwd().length + 1), text: readFileSync(path, 'utf8') }));

describe('renderer design tokens', () => {
  it('defines every custom property the renderer reads', () => {
    // Defined in a stylesheet (`--name:`) or set from a component style binding (`'--name'`).
    const defined = new Set(files.flatMap(({ text }) => [...text.matchAll(/(?:^|[\s{;'"])(--[a-z0-9-]+)\s*['"]?\s*:/gi)].map((match) => match[1])));
    const missing = files.flatMap(({ path, text }) => [...text.matchAll(/var\((--[a-z0-9-]+)/gi)]
      .map((match) => match[1]!)
      .filter((name) => !defined.has(name))
      .map((name) => `${path}: ${name}`));
    expect([...new Set(missing)]).toEqual([]);
  });

  it('never puts fixed white text on the theme accent', () => {
    // In dark mode the accent is light (#b3a1ff); text on it must use --accent-contrast.
    const offenders = files.flatMap(({ path, text }) => [...text.matchAll(/\{[^{}]*\}/g)]
      .map((match) => match[0])
      .filter((rule) => /background:\s*var\(--accent\)/.test(rule) && /(?:^|[;{])\s*color:\s*(?:#fff\b|#ffffff\b|white\b)/i.test(rule))
      .map((rule) => `${path}: ${rule.slice(0, 80)}`));
    expect(offenders).toEqual([]);
  });

  it('keeps menus and popovers on theme surfaces instead of fixed dark colors', () => {
    const comments = files.find(({ path }) => path.endsWith('CommentsLayer.vue'))!.text;
    const menuRule = /\.thread-menu\{[^}]*\}/.exec(comments)?.[0] ?? '';
    expect(menuRule).toContain('var(--menu-surface)');
    expect(menuRule).not.toMatch(/#[0-9a-f]{3,6}\b/i);
  });
});

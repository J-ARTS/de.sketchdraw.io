/**
 * Vendor logos for the plugin tiles. The repository ships none: a file named after the plugin id in
 * `assets/plugin-logos` is shown when the project owner adds the official artwork; otherwise the tile keeps its letter.
 */
const files = import.meta.glob<string>('../assets/plugin-logos/*.{svg,png}', { import: 'default', eager: true });

/** Maps `…/<id>.svg|png` to its URL; SVG wins over PNG for the same id. */
export function logosById(entries: Readonly<Record<string, string>>): ReadonlyMap<string, string> {
  const logos = new Map<string, string>();
  for (const path of Object.keys(entries).sort((a, b) => Number(a.endsWith('.svg')) - Number(b.endsWith('.svg')))) {
    const match = /\/([a-z0-9-]+)\.(?:svg|png)$/.exec(path);
    if (match) logos.set(match[1]!, entries[path]!);
  }
  return logos;
}

const logos = logosById(files);
export function pluginLogoUrl(id: string): string | null { return logos.get(id) ?? null; }

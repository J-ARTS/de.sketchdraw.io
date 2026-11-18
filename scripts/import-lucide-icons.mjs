#!/usr/bin/env node
/**
 * Imports the Lucide icons (https://github.com/lucide-icons/lucide, ISC) as category component sets (#227).
 *
 *   node scripts/import-lucide-icons.mjs --package <dir> --repo <dir> [--retrieved YYYY-MM-DD]
 *
 * --package  the extracted npm package `lucide-static` (icons/*.svg, package.json)
 * --repo     a checkout of lucide-icons/lucide at the same version (icons/*.json and categories/*.json carry the
 *            categories and search words, which the npm package does not)
 *
 * Every icon is rebuilt from its drawing elements and checked with the app's own validateSafeIconSvg; icons that
 * fail are reported and skipped. Output: src/catalog/lucide/lucide.json and manifest.json. See THIRD_PARTY_ICONS.md.
 */
import { build } from 'esbuild';
import { mkdtemp, mkdir, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = join(ROOT, 'src/catalog/lucide');
const args = Object.fromEntries(process.argv.slice(2).reduce((pairs, value, index, all) => (value.startsWith('--') ? [...pairs, [value.slice(2), all[index + 1]]] : pairs), []));
if (!args.package || !args.repo) { console.error('Usage: node scripts/import-lucide-icons.mjs --package <lucide-static dir> --repo <lucide repo dir> [--retrieved YYYY-MM-DD]'); process.exit(2); }
const RETRIEVED = args.retrieved ?? new Date().toISOString().slice(0, 10);
/** Search words kept per icon; Lucide lists up to several dozen. */
const MAX_WORDS = 12;

async function loadValidator() {
  const dir = await mkdtemp(join(tmpdir(), 'sketchdraw-icon-validator-'));
  const file = join(dir, 'icon.mjs');
  await build({ entryPoints: [join(ROOT, 'src/catalog/icon.ts')], bundle: true, platform: 'node', format: 'esm', outfile: file, logLevel: 'error' });
  const module = await import(pathToFileURL(file).href);
  return { validate: module.validateSafeIconSvg, cleanup: () => rm(dir, { recursive: true, force: true }) };
}
const json = async (file) => JSON.parse(await readFile(file, 'utf8'));

/** Only the drawing elements Lucide uses, with their geometry; everything else of the file is dropped. */
const GEOMETRY = { path: ['d'], circle: ['cx', 'cy', 'r'], rect: ['x', 'y', 'width', 'height', 'rx', 'ry'], line: ['x1', 'y1', 'x2', 'y2'], ellipse: ['cx', 'cy', 'rx', 'ry'], polyline: ['points'], polygon: ['points'] };
/**
 * Lucide writes the two flags of an arc without separators ("a2 2 0 01-2 2"). That is valid SVG, but the app's
 * icon check reads plain number lists; every argument is written out on its own.
 */
function spellOutPath(d) {
  const number = /^[+-]?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?/;
  let out = '', command = '', index = 0;
  for (let at = 0; at < d.length;) {
    const char = d[at];
    if (/[\s,]/.test(char)) { at += 1; continue; }
    if (/[a-zA-Z]/.test(char)) { command = char; index = 0; out += char; at += 1; continue; }
    const flag = (command === 'a' || command === 'A') && (index % 7 === 3 || index % 7 === 4);
    const token = flag ? (char === '0' || char === '1' ? char : null) : number.exec(d.slice(at))?.[0];
    if (!token) throw new Error(`unreadable path at ${at}`);
    out += (index === 0 ? '' : ' ') + token;
    at += token.length; index += 1;
  }
  return out;
}
function rebuild(svg) {
  const body = svg.replace(/<!--[\s\S]*?-->/g, '').replace(/^[\s\S]*?<svg[^>]*>/, '').replace(/<\/svg>\s*$/, '');
  const parts = [];
  for (const match of body.matchAll(/<([a-z]+)\b([^>]*?)\/?>/g)) {
    const [, tag, raw] = match;
    const allowed = GEOMETRY[tag];
    if (!allowed) throw new Error(`unexpected element <${tag}>`);
    const attributes = [];
    for (const [, name, value] of raw.matchAll(/([a-zA-Z][a-zA-Z0-9:-]*)="([^"]*)"/g)) {
      if (allowed.includes(name)) attributes.push(`${name}="${name === 'd' ? spellOutPath(value) : value.replace(/\s+/g, ' ').trim()}"`);
      else if (name !== 'fill' || value !== 'none') { if (name !== 'fill') throw new Error(`unexpected attribute ${name} on <${tag}>`); attributes.push(`fill="${value}"`); }
    }
    parts.push(`<${tag} ${attributes.join(' ')}/>`);
  }
  if (!parts.length) throw new Error('no drawing elements');
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${parts.join('')}</svg>`;
}

const titleOf = (name) => name.split('-').map((word) => (/^\d/.test(word) ? word : word[0].toUpperCase() + word.slice(1))).join(' ');
/** Aliases are ID-like in the catalogue contract: ASCII letters, digits, ".", "_", ":" and "-". */
const aliasId = (word) => word.normalize('NFKD').replace(/[̀-ͯ]/g, '').replace(/[^A-Za-z0-9._:-]+/g, '-').replace(/^-+|-+$/g, '').toLowerCase();

const pkg = await json(join(args.package, 'package.json'));
const names = (await readdir(join(args.repo, 'icons'))).filter((file) => file.endsWith('.json')).map((file) => file.slice(0, -5)).sort();
const meta = new Map(await Promise.all(names.map(async (name) => [name, await json(join(args.repo, 'icons', `${name}.json`))])));
/** An icon may take its categories from another one ("$extends:<icon>"); the first real category files it. */
function categoriesOf(name, seen = new Set()) {
  if (seen.has(name)) return [];
  seen.add(name);
  return (meta.get(name)?.categories ?? []).flatMap((entry) => (entry.startsWith('$extends:') ? categoriesOf(entry.slice('$extends:'.length), seen) : [entry]));
}
function wordsOf(name, seen = new Set()) {
  if (seen.has(name)) return [];
  seen.add(name);
  return (meta.get(name)?.tags ?? []).flatMap((entry) => (entry.startsWith('$extends:') ? wordsOf(entry.slice('$extends:'.length), seen) : [entry]));
}
const categoryTitles = new Map(await Promise.all((await readdir(join(args.repo, 'categories'))).filter((file) => file.endsWith('.json')).map(async (file) => [file.slice(0, -5), (await json(join(args.repo, 'categories', file))).title])));

const { validate, cleanup } = await loadValidator();
const byCategory = new Map();
const skipped = [];
try {
  for (const name of names) {
    let iconSvg;
    try {
      iconSvg = rebuild(await readFile(join(args.package, 'icons', `${name}.svg`), 'utf8'));
      const issues = validate(iconSvg);
      if (issues.length) throw new Error(issues.map((issue) => issue.code ?? issue.message).join(', '));
    } catch (error) { skipped.push(`${name}: ${error.message}`); continue; }
    const category = categoriesOf(name)[0] ?? 'other';
    const aliases = [...new Set(['lucide', ...(meta.get(name)?.aliases ?? []).map((alias) => (typeof alias === 'string' ? alias : alias.name)), ...wordsOf(name)].filter(Boolean).map(aliasId).filter(Boolean))].slice(0, MAX_WORDS + 1);
    if (!byCategory.has(category)) byCategory.set(category, []);
    byCategory.get(category).push({ type: `generic.lucide.${name}`, name: titleOf(name), aliases, iconSvg });
  }
} finally { await cleanup(); }

const sets = [...byCategory].map(([category, components]) => {
  const title = categoryTitles.get(category) ?? titleOf(category);
  return { id: `sketchdraw.lucide.${category}`, name: `Lucide · ${title}`, version: pkg.version, category: title, components };
}).sort((a, b) => a.category.localeCompare(b.category, 'en'));
const count = sets.reduce((sum, set) => sum + set.components.length, 0);
await mkdir(OUT, { recursive: true });
await writeFile(join(OUT, 'lucide.json'), `${JSON.stringify({ package: `lucide-static@${pkg.version}`, license: pkg.license, retrieved: RETRIEVED, sets })}\n`);
await writeFile(join(OUT, 'manifest.json'), `${JSON.stringify({ package: `lucide-static@${pkg.version}`, license: pkg.license, retrieved: RETRIEVED, count, categories: sets.map((set) => ({ id: set.id, name: set.category, count: set.components.length })) }, null, 2)}\n`);
console.log(`Lucide ${pkg.version}: ${count} icons in ${sets.length} categories${skipped.length ? `, ${skipped.length} skipped` : ''}`);
for (const line of skipped) console.log(`  skipped ${line}`);

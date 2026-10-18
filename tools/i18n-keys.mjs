#!/usr/bin/env node
// Collects every translation key used in the renderer: t('…'), tn(n, '…', '…'), L('…') and the catalog ids in de.ts.
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    if (name === 'node_modules') continue;
    const path = join(dir, name);
    if (statSync(path).isDirectory()) walk(path, out);
    else if (/\.(vue|ts)$/.test(name) && !/\.d\.ts$/.test(name)) out.push(path);
  }
  return out;
}
const STR = String.raw`(?:'((?:[^'\\\n]|\\.)*)'|"((?:[^"\\\n]|\\.)*)")`;
const unescape = (value) => value.replace(/\\(['"\\])/g, '$1').replace(/\\n/g, '\n');

export function collectKeys(files = walk(join(ROOT, 'src')).filter((file) => !/[\\/]i18n[\\/](en|index)\.ts$/.test(file))) {
  const keys = new Map(); // key → first location
  const add = (raw, file, line) => { const key = unescape(raw); if (!keys.has(key)) keys.set(key, `${relative(ROOT, file)}:${line}`); };
  for (const file of files) {
    if (/[\\/]i18n[\\/]de\.ts$/.test(file)) continue;
    const source = readFileSync(file, 'utf8');
    const lineOf = (index) => source.slice(0, index).split('\n').length;
    for (const m of source.matchAll(new RegExp(String.raw`(?<![\w.$])(?:t|L)\(\s*${STR}`, 'g'))) add(m[1] ?? m[2], file, lineOf(m.index));
    for (const m of source.matchAll(new RegExp(String.raw`(?<![\w.$])tn\(\s*[^,]+,\s*${STR}\s*,\s*${STR}`, 'g'))) {
      add(m[1] ?? m[2], file, lineOf(m.index)); add(m[3] ?? m[4], file, lineOf(m.index));
    }
  }
  return keys;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const keys = collectKeys();
  for (const [key, where] of keys) console.log(JSON.stringify(key), where);
  console.error(`${keys.size} keys`);
}

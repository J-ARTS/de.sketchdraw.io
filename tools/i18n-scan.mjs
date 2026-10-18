#!/usr/bin/env node
// Lists user-visible German text that is not routed through t(): template text, text attributes and
// string literals that look like German prose. Used as a worklist and by the i18n coverage test.
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

const ROOT = new URL('..', import.meta.url).pathname;
const GERMAN_WORDS = new Set(`abbrechen allen ansehen aufgabe ausrichtung auswahl bearbeiten beenden beitreten bitte datei diese diesem dieser dieses dokument dünn ebene eine einem einen einer eines einfügen einladung entwurf farbe fehler fläche formen füllung für gebogen gemeinsam gespeichert größe hinten hintergrund jeder kein keine keinen keiner kommentar kontur kopiert können leiste löschen neue neuen neuer neues nicht oder rechtwinklig rückgängig schließen seite sind spalte speichern starten suchen und ungespeichert verbinden verbunden verlassen verwerfen vom vorn werden werkzeug werkzeuge wiederholen wird wurde zeichenfläche zeichnen zeile zugriff zum zur zurück ändern änderung änderungen öffnen über übernehmen`.split(/\s+/));
const CODEISH = /^(?:[.#:@\/\\\-_]|https?:|data:|rgb|var\(|calc\(|translate|rotate|scale|url\(|\d)/;

function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    if (name === 'node_modules') continue;
    const path = join(dir, name);
    if (statSync(path).isDirectory()) walk(path, out);
    else if (/\.(vue|ts)$/.test(name) && !/\.d\.ts$/.test(name)) out.push(path);
  }
  return out;
}

function looksGerman(text) {
  const value = text.trim();
  if (value.length < 2 || CODEISH.test(value)) return false;
  if (/\b(?:t|L|tn)\(\s*['"`]/.test(value)) return false; // an expression that is already translated
  if (/[äöüÄÖÜß]/.test(value)) return true;
  const words = value.toLowerCase().split(/[^a-zäöüß]+/).filter(Boolean);
  return words.some((word) => GERMAN_WORDS.has(word));
}

export function scan(files, { includeCatalog = false } = {}) {
  const found = [];
  for (const file of files) {
    const rel = relative(ROOT, file);
    if (!includeCatalog && /\/i18n\//.test(rel)) continue;
    const source = readFileSync(file, 'utf8');
    const lines = source.split('\n');
    lines.forEach((line, index) => {
      if (/^\s*(\/\/|\*|\/\*)/.test(line)) return;
      // String literals (single, double, template without ${}) and Vue template text/attributes on the same line.
      const literals = [...line.matchAll(/'((?:[^'\\]|\\.)*)'|"((?:[^"\\]|\\.)*)"|`((?:[^`\\]|\\.)*)`/g)].map((m) => m[1] ?? m[2] ?? m[3] ?? '');
      for (const text of literals) if (looksGerman(text) && !/\b(?:t|L)\(\s*['"`]$/.test(line.slice(0, line.indexOf(text))) && !/\btn\([^'"`]*['"`][^'"`]*['"`]\s*,\s*['"`]$|\btn\([^,]*,\s*['"`]$/.test(line.slice(0, line.indexOf(text)))) found.push({ file: rel, line: index + 1, text });
      if (file.endsWith('.vue')) {
        for (const m of line.matchAll(/>([^<>{}]*[A-Za-zÄÖÜäöüß][^<>{}]*)</g)) if (looksGerman(m[1])) found.push({ file: rel, line: index + 1, text: m[1].trim() });
      }
    });
  }
  return found;
}

if (process.argv[1] === new URL(import.meta.url).pathname) {
  const skip = /\/(domain|interop|codec|crdt|mcp|session|collaboration|agent-access)\//;
  const results = scan(walk(join(ROOT, 'src')).concat(walk(join(ROOT, 'electron'))).filter((file) => !skip.test(file)));
  const unwrapped = results.filter((entry, i, all) => all.findIndex((other) => other.file === entry.file && other.line === entry.line && other.text === entry.text) === i);
  const byFile = new Map();
  for (const entry of unwrapped) byFile.set(entry.file, (byFile.get(entry.file) ?? 0) + 1);
  if (process.argv.includes('--list')) for (const entry of unwrapped) console.log(`${entry.file}:${entry.line}: ${entry.text}`);
  else for (const [file, count] of [...byFile].sort((a, b) => b[1] - a[1])) console.log(String(count).padStart(4), file);
  console.log(`total ${unwrapped.length} in ${byFile.size} files`);
}

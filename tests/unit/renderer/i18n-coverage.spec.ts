import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { MESSAGES } from '@/renderer/i18n/de';
import { EN } from '@/renderer/i18n/en';
import { intlLocale, L, setLocale, t, tm, tn } from '@/renderer/i18n';
// @ts-expect-error plain ESM tool script without type declarations
import { collectKeys } from '../../../tools/i18n-keys.mjs';
// @ts-expect-error plain ESM tool script without type declarations
import { scan } from '../../../tools/i18n-scan.mjs';

const ROOT = join(__dirname, '../../..');
function sourceFiles(dir = join(ROOT, 'src'), out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) sourceFiles(path, out);
    else if (/\.(vue|ts)$/.test(name) && !/i18n\/en\.ts$/.test(path)) out.push(path);
  }
  return dir === join(ROOT, 'src') ? out.concat(sourceFiles(join(ROOT, 'electron'))) : out;
}

const placeholders = (text: string): string[] => [...text.matchAll(/\{(\w+)\}/g)].map((match) => match[1]!).sort();
const catalog = MESSAGES as Readonly<Record<string, string>>;

afterEach(() => { setLocale('de'); });

describe('English translation', () => {
  const keys = [...(collectKeys() as Map<string, string>)];

  it('covers every translation key used in the renderer', () => {
    const missing = keys
      .map(([key, where]) => ({ german: catalog[key] ?? key, key, where }))
      .filter(({ german }) => EN[german] === undefined);
    expect(missing.map(({ german, where }) => `${where}: ${german}`)).toEqual([]);
  });

  it('keeps every placeholder of the German source in the English text', () => {
    const broken = Object.entries(EN).filter(([german, english]) => placeholders(german).join() !== placeholders(english).join());
    expect(broken.map(([german]) => german)).toEqual([]);
  });

  it('has no English entry whose German source text is gone', () => {
    const files = sourceFiles();
    const text = files.map((file) => readFileSync(file, 'utf8')).join('\n');
    const known = new Set<string>(keys.map(([key]) => catalog[key] ?? key));
    for (const value of Object.values(catalog)) known.add(value);
    const stale = Object.keys(EN).filter((german) => {
      if (known.has(german)) return false;
      // Texts of the main process or validators are translated by tm(); they must still occur in the sources.
      const pattern = german.replace(/[.*+?^$()|[\]\\]/g, '\\$&').replace(/\{\w+\}/g, '\\$\\{[^}]*\\}|\\{\\w+\\}|.+?');
      return !new RegExp(pattern).test(text);
    });
    expect(stale).toEqual([]);
  });

  it('translates messages that arrive from the main process or validators', () => {
    const untranslated: string[] = [];
    setLocale('en');
    for (const file of ['electron/plugin-service.ts', 'electron/main.ts', 'src/catalog/resource-card.ts', 'src/domain/web-embed.ts']) {
      for (const entry of scan([join(ROOT, file)]) as Array<{ text: string }>) {
        const sample = entry.text.replace(/\$\{[^}]*\}/g, 'X');
        if (['prüfung', 'Datei', 'Öffnen…', 'Speichern', 'Speichern unter…', 'Bearbeiten', 'Rückgängig', 'Wiederholen'].includes(sample)) continue; // matching keywords, native menu (electron/i18n.ts)
        if (tm(sample) === sample) untranslated.push(`${file}: ${sample}`);
      }
    }
    expect(untranslated).toEqual([]);
    expect(tm('Atlassian antwortete mit 502.')).toBe('Atlassian responded with 502.');
    expect(tm('API-Token ist ungültig.')).toBe('API token is invalid.');
    expect(tm('Jira: Verbindung fehlgeschlagen')).toBe('Jira: Connection failed');
    expect(tm('Unbekannte Meldung')).toBe('Unbekannte Meldung');
    setLocale('de');
    expect(tm('Atlassian antwortete mit 502.')).toBe('Atlassian antwortete mit 502.');
  });

  it('translates texts, catalog ids, parameters and plurals', () => {
    setLocale('en');
    expect(t('Schließen')).toBe('Close');
    expect(t('common.close')).toBe('Close');
    expect(t('{count} Elemente · {fidelity}', { count: 3, fidelity: 'x' })).toBe('3 elements · x');
    expect(tn(1, '{count} Objekt', '{count} Objekte')).toBe('1 object');
    expect(tn(2, '{count} Objekt', '{count} Objekte')).toBe('2 objects');
    expect(L('Rechteck')).toBe('Rechteck');
    expect(t(L('Rechteck'))).toBe('Rectangle');
    expect(intlLocale()).toBe('en-US');
    expect(t('Nicht übersetzter Text')).toBe('Nicht übersetzter Text');
    setLocale('de');
    expect(t('Schließen')).toBe('Schließen');
    expect(intlLocale()).toBe('de-DE');
  });
});

import { ref } from 'vue';
import { MESSAGES, shortcutGroupKey, type MessageParams } from './de';
import { EN } from './en';

export type Locale = 'de' | 'en';
export type { MessageParams };

/** The active UI language. Templates call `t()` while rendering, so changing it re-renders every translated text. */
export const locale = ref<Locale>('de');
export function setLocale(next: Locale): void { locale.value = next; }

/** `de-DE` / `en-US`: the Intl locale for dates, relative times and sorting. */
export function intlLocale(): string { return locale.value === 'en' ? 'en-US' : 'de-DE'; }

/**
 * Translates a message. The key is either a catalog id (`file.save`) or the German source text itself
 * (`Schließen`), so unknown text stays readable. German is the source language; `en.ts` maps both id and
 * German text to English. Placeholders use `{name}`.
 */
export function t(key: string, params?: MessageParams): string {
  const german = (MESSAGES as Readonly<Record<string, string>>)[key] ?? key;
  const text = locale.value === 'en' ? (EN[key] ?? EN[german] ?? german) : german;
  if (!params) return text;
  return text.replace(/\{(\w+)\}/g, (match: string, name: string) => {
    const value = params[name];
    return value === undefined ? match : String(value);
  });
}

let patterns: Array<{ regex: RegExp; names: string[]; german: string }> | null = null;
function messagePatterns(): Array<{ regex: RegExp; names: string[]; german: string }> {
  // Longest literal text first, so `{name} ist ungültig.` wins over placeholder-only templates like `{a} {b}`.
  const literal = (key: string): number => key.replace(/\{\w+\}/g, '').length;
  patterns ??= Object.keys(EN).filter((key) => /\{\w+\}/.test(key) && literal(key) >= 4).sort((a, b) => literal(b) - literal(a)).map((german) => {
    const names: string[] = [];
    const source = german.replace(/[.*+?^$()|[\]\\]/g, '\\$&').replace(/\{(\w+)\}/g, (_match, name: string) => { names.push(name); return '(.+?)'; });
    return { regex: new RegExp(`^${source}$`, 's'), names, german };
  });
  return patterns;
}

/**
 * Translates a finished German message that arrives from outside the renderer (main process, validators) and
 * may already contain its parameters. Exact texts are looked up directly; texts with parameters are matched
 * against the `{name}` templates in en.ts. Unknown text is returned unchanged.
 */
export function tm(message: string): string {
  if (locale.value !== 'en' || message === '') return message;
  const exact = EN[message];
  if (exact !== undefined) return exact;
  for (const { regex, names, german } of messagePatterns()) {
    const match = regex.exec(message);
    if (match) return t(german, Object.fromEntries(names.map((name, index) => [name, tm(match[index + 1] ?? '')])));
  }
  return message;
}

/** Plural by count with German source texts: `tn(n, '{count} Seite', '{count} Seiten')`; `{count}` is filled in. */
export function tn(count: number, one: string, other: string, params?: MessageParams): string {
  return t(count === 1 ? one : other, { ...params, count });
}

/** Picks `<base>.one` or `<base>.other` and fills `{count}`. */
export function tCount(base: string, count: number): string {
  return t(`${base}.${count === 1 ? 'one' : 'other'}`, { count });
}

export function shortcutGroupTitle(group: string): string { return t(shortcutGroupKey(group)); }

/**
 * Marks a German source text that is translated later, where it is displayed (`t(item.label)`). It returns the
 * text unchanged; the i18n coverage test collects these markers like `t()` calls.
 */
export const L = (text: string): string => text;

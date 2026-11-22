import { DOMAIN_LIMITS, createDocument, validateDocument, type ComponentSet, type SketchAsset, type SketchDocument, type SketchElement, type SketchPage } from '@/domain';
import { usedComponentSets } from './element-clipboard';
import type { PageSummary } from './contract';
import { t } from '@/renderer/i18n';

export const MAX_PAGE_NAME_LENGTH = DOMAIN_LIMITS.MAX_PAGE_NAME_LENGTH;
export const MAX_PAGES = DOMAIN_LIMITS.MAX_PAGES;

export function pageSummaries(document: SketchDocument): PageSummary[] {
  const counts = new Map<string, number>();
  for (const element of document.elements) counts.set(element.pageId, (counts.get(element.pageId) ?? 0) + 1);
  return document.pages.map((page) => ({ id: page.id, name: page.name, elementCount: counts.get(page.id) ?? 0 }));
}

/** The page that stays active when `active` disappeared (deleted here, by a peer or by undo): the nearest remaining one. */
export function resolveActivePage(before: SketchDocument, after: SketchDocument, active: string): string {
  if (after.pages.some((page) => page.id === active)) return active;
  const index = Math.max(0, before.pages.findIndex((page) => page.id === active));
  return after.pages[Math.min(index, after.pages.length - 1)]!.id;
}

export function nextPageName(pages: readonly Pick<SketchPage, 'name'>[]): string {
  let number = pages.length + 1;
  const names = new Set(pages.map((page) => page.name));
  while (names.has(t('Seite {number}', { number }))) number += 1;
  return t('Seite {number}', { number });
}

/** Clipboard envelope for "Inhalt kopieren". Pasting treats it as untrusted input. */
export interface PageClipboardPayload {
  format: 'sketchdraw.page';
  version: 1;
  name: string;
  elements: SketchElement[];
  assets: Record<string, SketchAsset>;
  /** The definitions of the library components on the page (#269). Payloads written before that have none. */
  componentSets?: ComponentSet[];
}

const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;

export function pageClipboardPayload(name: string, elements: readonly SketchElement[], assets: Readonly<Record<string, SketchAsset>>, componentSets: readonly ComponentSet[] = []): PageClipboardPayload {
  const used: Record<string, SketchAsset> = {};
  for (const element of elements) {
    const asset = element.assetId ? assets[element.assetId] : undefined;
    if (asset && element.assetId) used[element.assetId] = asset;
  }
  // Like the clipboard for elements, the page carries the definitions its components need: without them a page
  // with a library component is not a valid document on its own and could not be pasted anywhere (#269).
  return { format: 'sketchdraw.page', version: 1, name, elements: clone([...elements]), assets: clone(used), componentSets: usedComponentSets({ componentSets: [...componentSets] }, elements) };
}

/** Parses and validates clipboard text; anything that is not a valid page payload yields null. */
export function parsePageClipboard(text: string): { name: string; elements: SketchElement[]; assets: Record<string, SketchAsset>; componentSets: ComponentSet[] } | null {
  let raw: unknown;
  try { raw = JSON.parse(text); } catch { return null; }
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return null;
  const payload = raw as Record<string, unknown>;
  if (payload['format'] !== 'sketchdraw.page' || payload['version'] !== 1 || typeof payload['name'] !== 'string' || !Array.isArray(payload['elements'])) return null;
  try {
    const base = createDocument('clipboard');
    const validated = validateDocument({
      ...base,
      pages: [{ id: base.pages[0]!.id, name: payload['name'].trim().slice(0, MAX_PAGE_NAME_LENGTH) || t('Seite 1') }],
      elements: payload['elements'].map((element) => (typeof element === 'object' && element !== null ? { ...(element as object), pageId: base.pages[0]!.id } : element)),
      assets: typeof payload['assets'] === 'object' && payload['assets'] !== null ? payload['assets'] : {},
      componentSets: Array.isArray(payload['componentSets']) ? payload['componentSets'] : [],
    });
    return { name: validated.pages[0]!.name, elements: validated.elements, assets: validated.assets, componentSets: validated.componentSets };
  } catch { return null; }
}

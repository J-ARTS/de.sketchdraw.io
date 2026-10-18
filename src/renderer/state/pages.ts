import { validateDocument, type SketchAsset, type SketchDocument, type SketchElement } from '@/domain';
import type { PageSummary } from './contract';

import { L, t } from '@/renderer/i18n';
export const SINGLE_PAGE_ID = 'page:1';
export const SINGLE_PAGE_NAME = L('Seite 1');
export const SINGLE_PAGE_NAME_METADATA_KEY = 'sketchdraw.page.v1.name';
/** Compatibility store used while the public schema-v2 contract is completed in #33/#34. */
export const PAGE_STATE_METADATA_KEY = 'sketchdraw.pages.compat.v1';
export const MAX_PAGE_NAME_LENGTH = 120;
export const MAX_PAGES = 100;

export interface PageSnapshot {
  id: string;
  name: string;
  elements: SketchElement[];
}

interface StoredPage { id: string; name: string; elements?: SketchElement[] }
interface StoredPageState { version: 1; activePageId: string; pages: StoredPage[] }

const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;

export function singlePageName(document: SketchDocument): string {
  const persisted = document.metadata[SINGLE_PAGE_NAME_METADATA_KEY]?.trim();
  return persisted && persisted.length <= MAX_PAGE_NAME_LENGTH ? persisted : t(SINGLE_PAGE_NAME);
}

function validName(value: unknown): value is string {
  return typeof value === 'string' && Boolean(value.trim()) && value.trim().length <= MAX_PAGE_NAME_LENGTH;
}

function validateElements(document: SketchDocument, elements: unknown): SketchElement[] | null {
  if (!Array.isArray(elements)) return null;
  try {
    return validateDocument({ ...document, elements, metadata: { ...document.metadata, [PAGE_STATE_METADATA_KEY]: '' } }).elements;
  } catch { return null; }
}

/** Returns a validated renderer page model. The active page always comes from document.elements. */
export function pageState(document: SketchDocument): { activePageId: string; pages: PageSnapshot[] } {
  const raw = document.metadata[PAGE_STATE_METADATA_KEY];
  if (raw) {
    try {
      const parsed = JSON.parse(raw) as Partial<StoredPageState>;
      if (parsed.version === 1 && typeof parsed.activePageId === 'string' && Array.isArray(parsed.pages) && parsed.pages.length > 0 && parsed.pages.length <= MAX_PAGES) {
        const seen = new Set<string>();
        const pages: PageSnapshot[] = [];
        for (const candidate of parsed.pages) {
          if (!candidate || typeof candidate.id !== 'string' || !candidate.id || seen.has(candidate.id) || !validName(candidate.name)) throw new Error('invalid page');
          seen.add(candidate.id);
          const elements = candidate.id === parsed.activePageId ? clone(document.elements) : validateElements(document, candidate.elements);
          if (!elements) throw new Error('invalid elements');
          pages.push({ id: candidate.id, name: candidate.name.trim(), elements: clone(elements) });
        }
        if (seen.has(parsed.activePageId)) return { activePageId: parsed.activePageId, pages };
      }
    } catch { /* Invalid compatibility metadata falls back to the legacy page. */ }
  }
  return { activePageId: SINGLE_PAGE_ID, pages: [{ id: SINGLE_PAGE_ID, name: singlePageName(document), elements: clone(document.elements) }] };
}

export function pageSummaries(document: SketchDocument): PageSummary[] {
  return pageState(document).pages.map((page) => ({ id: page.id, name: page.name, elementCount: page.elements.length }));
}

export function activePageId(document: SketchDocument): string { return pageState(document).activePageId; }

/** Builds one atomic replacement document while keeping inactive pages persisted and the active page canonical. */
export function documentWithPages(document: SketchDocument, pages: readonly PageSnapshot[], activeId: string): SketchDocument {
  const active = pages.find((page) => page.id === activeId);
  if (!active || !pages.length || pages.length > MAX_PAGES) return document;
  const stored: StoredPageState = {
    version: 1,
    activePageId: activeId,
    pages: pages.map((page) => page.id === activeId
      ? { id: page.id, name: page.name }
      : { id: page.id, name: page.name, elements: clone(page.elements) }),
  };
  const metadata: Record<string, string> = { ...document.metadata, [PAGE_STATE_METADATA_KEY]: JSON.stringify(stored) };
  delete metadata[SINGLE_PAGE_NAME_METADATA_KEY];
  return validateDocument({ ...document, elements: clone(active.elements), metadata });
}

export function nextPageName(pages: readonly PageSnapshot[]): string {
  let number = pages.length + 1;
  const names = new Set(pages.map((page) => page.name));
  while (names.has(t('Seite {number}', { number }))) number += 1;
  return t('Seite {number}', { number });
}

export function clonePage(page: PageSnapshot, idFactory: (prefix: string) => string): PageSnapshot {
  const ids = new Map(page.elements.map((element) => [element.id, idFactory(element.kind)]));
  const elements = page.elements.map((element) => {
    const copied = clone(element);
    copied.id = ids.get(element.id)!;
    if (copied.parentId) copied.parentId = ids.get(copied.parentId) ?? copied.parentId;
    if (copied.from) copied.from.elementId = ids.get(copied.from.elementId) ?? copied.from.elementId;
    if (copied.to) copied.to.elementId = ids.get(copied.to.elementId) ?? copied.to.elementId;
    return copied;
  });
  return { id: idFactory('page'), name: t('{name} Kopie', { name: page.name }).slice(0, MAX_PAGE_NAME_LENGTH), elements };
}

/** Clipboard envelope for "Inhalt kopieren". Pasting treats it as untrusted input. */
export interface PageClipboardPayload {
  format: 'sketchdraw.page';
  version: 1;
  name: string;
  elements: SketchElement[];
  assets: Record<string, SketchAsset>;
}

export function pageClipboardPayload(name: string, elements: readonly SketchElement[], assets: Readonly<Record<string, SketchAsset>>): PageClipboardPayload {
  const used: Record<string, SketchAsset> = {};
  for (const element of elements) {
    const asset = element.assetId ? assets[element.assetId] : undefined;
    if (asset && element.assetId) used[element.assetId] = asset;
  }
  return { format: 'sketchdraw.page', version: 1, name, elements: clone([...elements]), assets: clone(used) };
}

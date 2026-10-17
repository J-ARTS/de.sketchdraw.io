import type { SketchAsset, SketchDocument, SketchElement } from '@/domain';
import type { PageSummary } from './contract';

/**
 * Renderer view of document pages. Until the multi-page schema lands (#34) a v1
 * document is shown as exactly one page; see docs/reviews/multi-page-proposal.md.
 */
export const SINGLE_PAGE_ID = 'page:1';
export const SINGLE_PAGE_NAME = 'Seite 1';
/** Compatibility key removed by the schema-v2 migration after it becomes the first page's name. */
export const SINGLE_PAGE_NAME_METADATA_KEY = 'sketchdraw.page.v1.name';
export const MAX_PAGE_NAME_LENGTH = 120;

export function singlePageName(document: SketchDocument): string {
  const persisted = document.metadata[SINGLE_PAGE_NAME_METADATA_KEY]?.trim();
  return persisted && persisted.length <= MAX_PAGE_NAME_LENGTH ? persisted : SINGLE_PAGE_NAME;
}

export function pageSummaries(document: SketchDocument): PageSummary[] {
  return [{ id: SINGLE_PAGE_ID, name: singlePageName(document), elementCount: document.elements.length }];
}

/** Clipboard envelope for "Inhalt kopieren" (proposal §3.8). Pasting treats it as untrusted input. */
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
  return { format: 'sketchdraw.page', version: 1, name, elements: [...elements], assets: used };
}

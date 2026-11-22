import { cloneElement, cloneAsset } from './geometry';
import { DOMAIN_LIMITS } from './limits';
import type { SketchAsset, SketchDocument, SketchElement, SketchPage } from './types';

/** Elements of one page in stacking order. */
export function pageElements(document: SketchDocument, pageId: string): SketchElement[] {
  return document.elements.filter((element) => element.pageId === pageId);
}

/**
 * A standalone single-page document for one page of `document`: used by single-page exports (SVG) and the clipboard.
 * Comments and tasks keep their text but lose references to elements of other pages.
 */
export function extractPage(document: SketchDocument, pageId: string): SketchDocument {
  const page = document.pages.find((entry) => entry.id === pageId);
  if (!page) throw new Error(`Unknown page "${pageId}".`);
  const elements = pageElements(document, pageId).map(cloneElement);
  const ids = new Set(elements.map((element) => element.id));
  const usedAssets = new Set(elements.flatMap((element) => (element.assetId ? [element.assetId] : [])));
  const assets: Record<string, SketchAsset> = {};
  for (const id of Object.keys(document.assets)) if (usedAssets.has(id)) assets[id] = cloneAsset(document.assets[id]!);
  const result: SketchDocument = {
    ...document,
    pages: [{ id: page.id, name: page.name }],
    elements,
    assets,
    componentSets: document.componentSets,
    metadata: { ...document.metadata },
  };
  // A comment belongs to one page: to the page of its element, or as a free comment to the page it names (the
  // first page when it names none). Only the comments of the extracted page come along. A comment of another page
  // would name a page the result does not have (#291), or show up on this page as if it had been made here.
  const firstPageId = document.pages[0]?.id;
  const keptThreads = new Set<string>();
  if (document.commentThreads) {
    result.commentThreads = document.commentThreads.filter((thread) => thread.target.elementId !== undefined
      ? ids.has(thread.target.elementId)
      : (thread.target.pageId ?? firstPageId) === pageId);
    for (const thread of result.commentThreads) keptThreads.add(thread.id);
  }
  if (document.tasks) {
    // Tasks belong to the document and stay; what they point to on another page is no longer named.
    result.tasks = document.tasks.map((task) => {
      const lostElement = task.sourceElementId !== undefined && !ids.has(task.sourceElementId);
      const lostThread = task.sourceThreadId !== undefined && !keptThreads.has(task.sourceThreadId);
      if (!lostElement && !lostThread) return task;
      const detached = { ...task };
      if (lostElement) delete detached.sourceElementId;
      if (lostThread) delete detached.sourceThreadId;
      return detached;
    });
  }
  return result;
}

export interface PageCopy {
  page: SketchPage;
  elements: SketchElement[];
  assets: SketchAsset[];
}

/**
 * Copies the content of a page with fresh element ids for `add-page` (duplicate, paste). parentId and connector
 * endpoints are rewritten through the same id table; the copy lives on a new page id.
 */
export function copyPageContent(
  source: { name: string; elements: readonly SketchElement[]; assets?: Readonly<Record<string, SketchAsset>> },
  idFactory: (prefix: string) => string,
  name = source.name,
): PageCopy {
  const pageId = idFactory('page');
  const ids = new Map(source.elements.map((element) => [element.id, idFactory(element.kind)]));
  const elements = source.elements.map((element) => {
    const copied = cloneElement(element);
    copied.id = ids.get(element.id)!;
    copied.pageId = pageId;
    if (copied.parentId) copied.parentId = ids.get(copied.parentId) ?? copied.parentId;
    if (copied.from) copied.from.elementId = ids.get(copied.from.elementId) ?? copied.from.elementId;
    if (copied.to) copied.to.elementId = ids.get(copied.to.elementId) ?? copied.to.elementId;
    return copied;
  });
  const used = new Set(elements.flatMap((element) => (element.assetId ? [element.assetId] : [])));
  const assets = [...used].flatMap((id) => (source.assets?.[id] ? [cloneAsset(source.assets[id]!)] : []));
  return { page: { id: pageId, name: name.slice(0, DOMAIN_LIMITS.MAX_PAGE_NAME_LENGTH) }, elements, assets };
}

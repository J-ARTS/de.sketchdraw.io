import type { ComponentDefinition, ComponentSet, SketchDocument, SketchElement } from '@/domain';
import { createDocument, validateDocument } from '@/domain';
import { COMPONENT_PRESENTATION_KEY, instantiateComponent } from '@/catalog';
import type { OfficialProvider } from '@/catalog/official-sets';
import { DRAWIO_LIBRARY_ICON_KEY } from '@/interop';

/**
 * A file written by draw.io names the icons of draw.io's own libraries instead of carrying them
 * (`image=img/lib/azure2/general/Blob_Block.svg`, `shape=mxgraph.kubernetes.icon2;prIcon=api`). The import leaves
 * such a cell as a labelled box and notes the name it found (#280). This module looks the name up in the official
 * icon library of the app and turns the box into that icon, drawn as draw.io draws it: the symbol with its text
 * below. It runs in the renderer, after the file was read,
 * because the libraries are loaded on demand.
 */
export interface LibraryIconResolution {
  document: SketchDocument;
  /** Boxes that became an icon of the app. */
  resolved: number;
  /** Boxes whose icon the app does not have; they stay labelled boxes. */
  unresolved: number;
}

/** Which draw.io library belongs to which library of the app. */
const PROVIDER_OF: Readonly<Record<string, OfficialProvider>> = { azure: 'azure', azure2: 'azure', kubernetes: 'kubernetes' };
/** A label wider than this wraps under its icon instead of widening the element further. */
const LABEL_MAX_WIDTH = 220;
/** Names draw.io uses for something the app calls differently. */
const KUBERNETES_NAMES: Readonly<Record<string, string>> = { master: 'control-plane' };

/** Letters and digits only, so `Blob_Block`, `blob-block` and `Blob Block` are the same name. */
const plain = (value: string): string => value.normalize('NFKD').toLowerCase().replace(/[^a-z0-9]+/g, '');
/** As `plain`, with the separators kept as single hyphens: `c_c_m` and `c-c-m` are the same, `cm` is another. */
const dashed = (value: string): string => value.normalize('NFKD').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');

function references(document: SketchDocument): Array<{ element: SketchElement; library: string; name: string }> {
  return document.elements.flatMap((element) => {
    const reference = element.metadata?.[DRAWIO_LIBRARY_ICON_KEY];
    const split = reference?.indexOf('/') ?? -1;
    return reference && split > 0 ? [{ element, library: reference.slice(0, split), name: reference.slice(split + 1) }] : [];
  });
}

/** The libraries of the app the imported document asks for; empty when it names no library icon. */
export function drawioLibraryProviders(document: SketchDocument): OfficialProvider[] {
  return [...new Set(references(document).flatMap(({ library }) => (PROVIDER_OF[library] ? [PROVIDER_OF[library]!] : [])))];
}

/** How many cells of the document name an icon of a draw.io library. */
export function drawioLibraryIconCount(document: SketchDocument): number { return references(document).length; }

function find(sets: readonly ComponentSet[], library: string, name: string): { set: ComponentSet; definition: ComponentDefinition } | undefined {
  const provider = PROVIDER_OF[library];
  if (!provider) return undefined;
  const candidates = sets.flatMap((set) => set.components.filter((definition) => definition.provider === provider).map((definition) => ({ set, definition })));
  if (provider === 'kubernetes') {
    // draw.io names a Kubernetes icon by the short name of the resource (`deploy`, `c_c_m`); the app keeps it as an alias.
    const wanted = KUBERNETES_NAMES[dashed(name)] ?? dashed(name);
    return candidates.find(({ definition }) => (definition.aliases ?? []).some((alias) => dashed(alias) === wanted))
      ?? candidates.find(({ definition }) => dashed(definition.name) === wanted);
  }
  // Azure: `general/Blob_Block` – the file name is the name of the service, the folder its category.
  const parts = name.split('/');
  const wanted = plain(parts.at(-1) ?? '');
  const folder = dashed(parts.slice(0, -1).join('-'));
  if (!wanted) return undefined;
  const short = (value: string): string => plain(value).replace(/^(?:azure|microsoft)(?=.)/, '');
  const matches = candidates.filter(({ definition }) => [definition.name, ...(definition.aliases ?? [])].some((label) => plain(label) === wanted || short(label) === short(wanted)));
  // The same name can live in two categories; the folder of the file decides, otherwise the first one.
  return matches.find(({ definition }) => definition.type.split('.')[1] === folder) ?? matches[0];
}

/**
 * Turns every box whose library icon the given sets hold into that icon, at the place and size of the box and with
 * its text. The sets a document then needs travel with it, as for an icon dropped from the library. A box whose icon
 * is not in the sets stays a box; its note is removed either way, so the document carries nothing about draw.io.
 */
export function resolveLibraryIcons(document: SketchDocument, sets: readonly ComponentSet[]): LibraryIconResolution {
  const found = references(document);
  if (!found.length) return { document, resolved: 0, unresolved: 0 };
  const scratch = createDocument('icons');
  const needed = new Map<string, ComponentSet>();
  const replaced = new Map<string, SketchElement>();
  let unresolved = 0;
  for (const { element, library, name } of found) {
    const { [DRAWIO_LIBRARY_ICON_KEY]: _note, ...metadata } = element.metadata ?? {};
    const match = find(sets, library, name);
    if (!match) {
      unresolved += 1;
      const { metadata: _all, ...box } = element;
      replaced.set(element.id, Object.keys(metadata).length ? { ...box, metadata } : box);
      continue;
    }
    // The text of the cell is what the icon says; a cell without one takes the name of the icon.
    const label = (element.text || element.label || '').trim() || match.definition.name;
    // draw.io draws such an icon as a picture with its text below. The app has that look as well: the symbol fills
    // the box and the label stands under it. The box of the cell is the symbol, so the element grows downwards by
    // the lines of the label and sideways, around the same middle, by what the label needs.
    const template = instantiateComponent(scratch, { set: match.set, type: match.definition.type, id: element.id, at: { x: element.x, y: element.y }, label, metadata: { ...metadata, [COMPONENT_PRESENTATION_KEY]: 'icon' } }).element;
    const fontSize = element.style.fontSize;
    const lines = label.split('\n');
    const width = Math.max(element.width, Math.min(LABEL_MAX_WIDTH, Math.ceil(Math.max(...lines.map((line) => line.length)) * fontSize * 0.6 + 8)));
    replaced.set(element.id, {
      ...template,
      text: label,
      label,
      pageId: element.pageId,
      x: element.x - (width - element.width) / 2,
      width,
      height: element.height + Math.ceil(lines.length * fontSize * 1.25 + 4),
      rotation: element.rotation,
      style: { ...template.style, opacity: element.style.opacity, fontSize },
      ...(element.parentId ? { parentId: element.parentId } : {}),
    });
    needed.set(match.set.id, match.set);
  }
  const present = new Set(document.componentSets.map((set) => set.id));
  const next: SketchDocument = {
    ...document,
    elements: document.elements.map((element) => replaced.get(element.id) ?? element),
    componentSets: [...document.componentSets, ...[...needed.values()].filter((set) => !present.has(set.id)).map((set) => structuredClone(set) as ComponentSet)],
  };
  return { document: validateDocument(next), resolved: found.length - unresolved, unresolved };
}

/** Loads the libraries the document asks for and resolves its icons. A library that cannot be loaded resolves nothing. */
export async function resolveDrawioLibraryIcons(document: SketchDocument, load: (provider: OfficialProvider) => Promise<ComponentSet[]>): Promise<LibraryIconResolution> {
  const providers = drawioLibraryProviders(document);
  const sets = (await Promise.all(providers.map((provider) => load(provider).catch(() => [] as ComponentSet[])))).flat();
  return resolveLibraryIcons(document, sets);
}

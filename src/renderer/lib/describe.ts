import type { ElementKind, Endpoint, SketchDocument, SketchElement } from '@/domain/types';

import { L, t, tn } from '@/renderer/i18n';
export const KIND_LABELS: Record<ElementKind, string> = {
  rectangle: L('Rechteck'),
  ellipse: L('Ellipse'),
  diamond: L('Raute'),
  text: L('Text'),
  path: L('Freihand'),
  image: L('Bild'),
  connector: L('Verbindung'),
  container: L('Container'),
  component: L('Komponente'),
  'sticky-note': L('Notiz'),
  annotation: L('Annotation'),
  table: L('Tabelle'),
  'web-embed': L('Web-Embed'),
  frame: L('Frame'),
};

const MAX_TEXT_NAME_LENGTH = 40;
const MAX_ANNOUNCED_NAMES = 3;

interface NameParts {
  name: string;
  /** The name already contains the kind label (generated names). */
  includesKind: boolean;
  includesPosition: boolean;
}

export function elementCountLabel(count: number): string {
  return tn(count, '{count} Element', '{count} Elemente');
}

function collapse(value: string | undefined): string {
  return value === undefined ? '' : value.replace(/\s+/g, ' ').trim();
}

function truncate(text: string, max: number): string {
  const chars = Array.from(text);
  if (chars.length <= max) return text;
  return `${chars.slice(0, max - 1).join('').trimEnd()}…`;
}

function position(x: number, y: number): string {
  return `${Math.round(x)}, ${Math.round(y)}`;
}

// Documents are immutable snapshots, so the id index is cached per elements array.
const indexCache = new WeakMap<readonly SketchElement[], Map<string, SketchElement>>();

function findElement(doc: SketchDocument, id: string): SketchElement | undefined {
  let index = indexCache.get(doc.elements);
  if (index === undefined) {
    index = new Map(doc.elements.map((element): [string, SketchElement] => [element.id, element]));
    indexCache.set(doc.elements, index);
  }
  return index.get(id);
}

function componentName(doc: SketchDocument, componentType: string): string {
  for (const set of doc.componentSets) {
    const definition = set.components.find((component) => component.type === componentType);
    if (definition !== undefined) return collapse(definition.name);
  }
  return '';
}

function endpointName(
  endpoint: Endpoint | undefined,
  point: { x: number; y: number } | undefined,
  doc: SketchDocument,
  depth: number,
): string {
  if (endpoint !== undefined) {
    const target = findElement(doc, endpoint.elementId);
    if (target === undefined) return t('Unbekannt');
    // A connector pointing at another connector would otherwise recurse.
    if (target.kind === 'connector' && depth > 0) return t(KIND_LABELS.connector);
    return nameParts(target, doc, depth + 1).name;
  }
  return point === undefined ? t('offenes Ende') : t('Punkt {position}', { position: position(point.x, point.y) });
}

function nameParts(element: SketchElement, doc: SketchDocument, depth: number): NameParts {
  const label = collapse(element.label);
  if (label !== '') return { name: label, includesKind: false, includesPosition: false };

  const text = collapse(element.text);
  if (text !== '') {
    return { name: truncate(text, MAX_TEXT_NAME_LENGTH), includesKind: false, includesPosition: false };
  }

  if (element.kind === 'component' && element.componentType !== undefined) {
    const name = componentName(doc, element.componentType) || collapse(element.componentType);
    if (name !== '') return { name, includesKind: false, includesPosition: false };
  }

  if (element.kind === 'image' && element.assetId !== undefined && Object.hasOwn(doc.assets, element.assetId)) {
    const name = collapse(doc.assets[element.assetId]?.name);
    if (name !== '') return { name, includesKind: false, includesPosition: false };
  }

  if (element.kind === 'web-embed' && element.embedUrl) {
    try {
      return { name: new URL(element.embedUrl).hostname, includesKind: false, includesPosition: false };
    } catch { /* validated documents cannot reach this fallback */ }
  }

  if (element.kind === 'connector') {
    const first = element.points?.[0];
    const last = element.points?.[(element.points?.length ?? 0) - 1];
    const from = endpointName(
      element.from,
      first === undefined ? undefined : { x: element.x + first.x, y: element.y + first.y },
      doc,
      depth,
    );
    const to = endpointName(
      element.to,
      last === undefined ? undefined : { x: element.x + last.x, y: element.y + last.y },
      doc,
      depth,
    );
    return { name: t('Verbindung von {from} nach {to}', { from, to }), includesKind: true, includesPosition: false };
  }

  return {
    name: t('{kind} bei {position}', { kind: t(KIND_LABELS[element.kind]), position: position(element.x, element.y) }),
    includesKind: true,
    includesPosition: true,
  };
}

/** Accessible name without the kind label: label, text start, component or asset name, else kind plus position. */
export function describeElement(el: SketchElement, doc: SketchDocument): string {
  return nameParts(el, doc, 0).name;
}

/** Live announcement for the current selection: name, kind and rounded position for one element, names for several. */
export function describeSelection(elements: readonly SketchElement[], doc: SketchDocument): string {
  const [first] = elements;
  if (first === undefined) return t('Nichts ausgewählt');
  if (elements.length === 1) {
    const parts = nameParts(first, doc, 0);
    let text = parts.name;
    if (!parts.includesKind) text += `, ${t(KIND_LABELS[first.kind])}`;
    if (!parts.includesPosition) text += `, ${t('bei {position}', { position: position(first.x, first.y) })}`;
    return text;
  }
  const names = elements.slice(0, MAX_ANNOUNCED_NAMES).map((element) => describeElement(element, doc));
  const rest = elements.length - names.length;
  const more = rest > 0 ? ` ${t('und {count} weitere', { count: rest })}` : '';
  return t('{elements} ausgewählt: {names}{more}', { elements: elementCountLabel(elements.length), names: names.join(', '), more });
}

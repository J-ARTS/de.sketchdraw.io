import type { SketchElement } from '@/domain';
import { validateDocumentationUrl } from '@/domain/validation';

export const RESOURCE_CARD_COMPONENT_TYPE = 'generic.resource-card';
export const RESOURCE_CARD_ICON_KEY = 'resource-card:icon';
export const RESOURCE_CARD_LINK_ORDER_KEY = 'resource-card:link-order';
export const MAX_RESOURCE_CARD_LINKS = 5;
/** Card text without a chosen text colour: black, independent of the frame colour (#189). */
export const RESOURCE_CARD_TEXT_COLOR = '#1e1e1e';

const LINK_PREFIX = 'resource-card:link:';
const LINK_ID = /^[a-z0-9][a-z0-9-]{0,31}$/i;

export interface ResourceCardLink {
  id: string;
  label: string;
  url: string;
}

const linkKey = (id: string, field: 'label' | 'url') => `${LINK_PREFIX}${id}:${field}`;

export function isResourceCard(element: SketchElement | undefined): boolean {
  return element?.kind === 'component' && element.componentType === RESOURCE_CARD_COMPONENT_TYPE;
}

export function isSafeResourceLinkUrl(url: string): boolean {
  const issues: Parameters<typeof validateDocumentationUrl>[2] = [];
  return validateDocumentationUrl(url.trim(), 'url', issues) && issues.length === 0;
}

export function resourceLinkFallbackLabel(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, '') || 'Link';
  } catch {
    return 'Link';
  }
}

export function resourceCardIconType(element: SketchElement | undefined): string {
  const value = element?.metadata?.[RESOURCE_CARD_ICON_KEY]?.trim();
  return value || 'generic.service';
}

export function resourceCardLinks(element: SketchElement | undefined): ResourceCardLink[] {
  const metadata = element?.metadata;
  if (!metadata) return [];
  const ids = (metadata[RESOURCE_CARD_LINK_ORDER_KEY] ?? '')
    .split(',')
    .map((id) => id.trim())
    .filter((id, index, all) => LINK_ID.test(id) && all.indexOf(id) === index)
    .slice(0, MAX_RESOURCE_CARD_LINKS);
  const links: ResourceCardLink[] = [];
  for (const id of ids) {
    const url = metadata[linkKey(id, 'url')]?.trim() ?? '';
    if (!isSafeResourceLinkUrl(url)) continue;
    const label = metadata[linkKey(id, 'label')]?.trim() || resourceLinkFallbackLabel(url);
    links.push({ id, label, url });
  }
  return links;
}

/** Builds a merge patch while preserving unrelated component metadata. */
export function resourceCardMetadataPatch(
  previous: Record<string, string> | undefined,
  iconType: string,
  links: readonly ResourceCardLink[],
): Record<string, string | null> {
  if (!iconType.trim()) throw new Error('Bitte ein Icon auswählen.');
  if (links.length > MAX_RESOURCE_CARD_LINKS) {
    throw new Error(`Maximal ${MAX_RESOURCE_CARD_LINKS} Links sind möglich.`);
  }
  const patch: Record<string, string | null> = {};
  for (const key of Object.keys(previous ?? {})) {
    if (key === RESOURCE_CARD_ICON_KEY || key === RESOURCE_CARD_LINK_ORDER_KEY || key.startsWith(LINK_PREFIX)) {
      patch[key] = null;
    }
  }
  const normalized = links.map((link, index) => {
    const id = LINK_ID.test(link.id) ? link.id : `link-${index + 1}`;
    const url = link.url.trim();
    if (!isSafeResourceLinkUrl(url)) throw new Error(`Der Link „${link.label || index + 1}“ braucht eine gültige HTTP- oder HTTPS-Adresse.`);
    return { id, label: link.label.trim() || resourceLinkFallbackLabel(url), url };
  });
  if (new Set(normalized.map((link) => link.id)).size !== normalized.length) {
    throw new Error('Jeder Link braucht eine eindeutige Kennung.');
  }
  patch[RESOURCE_CARD_ICON_KEY] = iconType.trim();
  patch[RESOURCE_CARD_LINK_ORDER_KEY] = normalized.map((link) => link.id).join(',');
  for (const link of normalized) {
    patch[linkKey(link.id, 'label')] = link.label;
    patch[linkKey(link.id, 'url')] = link.url;
  }
  return patch;
}

export function nextResourceCardLinkId(links: readonly ResourceCardLink[]): string {
  const used = new Set(links.map((link) => link.id));
  for (let index = 1; index <= MAX_RESOURCE_CARD_LINKS + 1; index += 1) {
    const id = `link-${index}`;
    if (!used.has(id)) return id;
  }
  return `link-${links.length + 1}`;
}

/** The two texts of a resource card that can be edited on the canvas (#189). */
export type ResourceCardField = 'title' | 'description';

export interface ResourceCardLayout {
  footerHeight: number;
  bodyHeight: number;
  iconSize: number;
  /** Left edge of both text lines. */
  textX: number;
  /** Vertical centre and font size of each line, in the card's own coordinates. */
  title: { y: number; fontSize: number };
  description: { y: number; fontSize: number };
}

type CardGeometry = { width: number; height: number; style: { fontSize: number } };

/** Where a resource card draws its parts; the one source for drawing, hit-testing and the text editor. */
export function resourceCardLayout(element: CardGeometry): ResourceCardLayout {
  const { fontSize } = element.style;
  const footerHeight = Math.max(28, Math.min(36, element.height * 0.24));
  const bodyHeight = Math.max(0, element.height - footerHeight);
  const iconSize = Math.max(28, Math.min(52, bodyHeight * 0.48, element.width * 0.16));
  return {
    footerHeight,
    bodyHeight,
    iconSize,
    textX: 20 + iconSize + 18,
    title: { y: bodyHeight / 2 - Math.max(5, fontSize * 0.25), fontSize: Math.max(14, fontSize) },
    description: { y: bodyHeight / 2 + Math.max(16, fontSize * 0.85), fontSize: Math.max(10, fontSize * 0.65) },
  };
}

/** The rectangle of one text line in the card's own coordinates: from the text's left edge to the card's right padding. */
export function resourceCardFieldBox(element: CardGeometry, field: ResourceCardField): { x: number; y: number; width: number; height: number } {
  const layout = resourceCardLayout(element);
  const line = layout[field];
  const height = line.fontSize * 1.3;
  return { x: layout.textX, y: line.y - height / 2, width: Math.max(24, element.width - layout.textX - 12), height };
}

/** The text line at a point given in the card's own coordinates, or null beside the texts. */
export function resourceCardFieldAt(element: CardGeometry, point: { x: number; y: number }): ResourceCardField | null {
  for (const field of ['title', 'description'] as const) {
    const box = resourceCardFieldBox(element, field);
    if (point.x >= box.x && point.x <= box.x + box.width && point.y >= box.y && point.y <= box.y + box.height) return field;
  }
  return null;
}

import type { SketchElement } from '@/domain';
import { validateDocumentationUrl } from '@/domain/validation';

export const RESOURCE_CARD_COMPONENT_TYPE = 'generic.resource-card';
export const RESOURCE_CARD_ICON_KEY = 'resource-card:icon';
export const RESOURCE_CARD_LINK_ORDER_KEY = 'resource-card:link-order';
export const MAX_RESOURCE_CARD_LINKS = 5;

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

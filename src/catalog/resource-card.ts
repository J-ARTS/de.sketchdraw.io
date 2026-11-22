import type { ComponentSet, ElementStyle, SketchElement } from '@/domain';
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

export type CloudProvider = 'aws' | 'azure' | 'gcp' | 'kubernetes';
const CLOUD_PROVIDERS: readonly string[] = ['aws', 'azure', 'gcp', 'kubernetes'];

/** The cloud provider a component belongs to, by its definition in the document's component sets. */
export function cloudProviderOf(element: SketchElement | undefined, componentSets: readonly ComponentSet[]): CloudProvider | null {
  if (element?.kind !== 'component' || !element.componentType) return null;
  for (const set of componentSets) {
    const definition = set.components.find((component) => component.type === element.componentType);
    if (definition) return CLOUD_PROVIDERS.includes(definition.provider) ? definition.provider as CloudProvider : null;
  }
  return null;
}

/**
 * The colour a card's text has while no text colour is chosen. Resource cards (#189) and cloud components (#246)
 * are black, like their tiles in the library; everything else follows its line colour.
 */
export function defaultCardTextColor(element: SketchElement | undefined, componentSets: readonly ComponentSet[]): string | null {
  return isResourceCard(element) || cloudProviderOf(element, componentSets) ? RESOURCE_CARD_TEXT_COLOR : null;
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

/**
 * How a card is drawn (#257). `solid` is the card as it always was: a closed frame and a tinted footer across its
 * whole width. `dashed` has a dashed frame and, set in from it, a bar in the colour of the frame that lists the links.
 */
export type ResourceCardLook = 'solid' | 'dashed';
export const RESOURCE_CARD_LOOK_KEY = 'resource-card:look';
export const RESOURCE_CARD_LOOKS: readonly ResourceCardLook[] = ['solid', 'dashed'];
export function resourceCardLook(element: Pick<SketchElement, 'metadata'> | undefined): ResourceCardLook {
  return element?.metadata?.[RESOURCE_CARD_LOOK_KEY] === 'dashed' ? 'dashed' : 'solid';
}
/** Frame, text and line style a card gets together with the dashed look; every value can be changed afterwards. The text colour keeps a contrast of 4.5:1 on the card in the light and in the dark theme. */
export const DASHED_CARD_STYLE = { stroke: '#9fb8bd', strokeDash: 'dashed', textColor: '#64748b' } as const;
/** The frame colour of the classic card, as its definition sets it. */
const SOLID_CARD_STROKE = '#cbd5e1';

/**
 * What changes when a card gets another look. The dashed look brings its frame and text colour along; going back
 * takes them away again only where they are still the ones the look brought, so colours the user chose stay.
 */
export function resourceCardLookPatch(element: Pick<SketchElement, 'style'> | undefined, look: ResourceCardLook): { metadata: Record<string, string | null>; style: Partial<ElementStyle> } {
  if (look === 'dashed') return { metadata: { [RESOURCE_CARD_LOOK_KEY]: 'dashed' }, style: { ...DASHED_CARD_STYLE } };
  const style: Partial<ElementStyle> = { strokeDash: 'solid' };
  if (element?.style.stroke === DASHED_CARD_STYLE.stroke) style.stroke = SOLID_CARD_STROKE;
  if (element?.style.textColor === DASHED_CARD_STYLE.textColor) style.textColor = RESOURCE_CARD_TEXT_COLOR;
  return { metadata: { [RESOURCE_CARD_LOOK_KEY]: null }, style };
}

/** Most lines a title or description is drawn with; what follows is cut, so a pasted page cannot blow a card up. */
export const MAX_RESOURCE_CARD_LINES = 12;
/** The lines of a title or description as they are drawn: at least one, without empty lines at the end. */
export function resourceCardLines(value: string | null | undefined): string[] {
  const lines = (value ?? '').replace(/\r\n?/g, '\n').split('\n').map((line) => line.replace(/\s+$/u, ''));
  while (lines.length > 1 && !lines.at(-1)) lines.pop();
  return lines.slice(0, MAX_RESOURCE_CARD_LINES);
}
/** A title or description as it is stored: line ends unified, no spaces at the ends of lines, no empty lines around it. */
export function normalizeResourceCardText(value: string): string {
  return value.replace(/\r\n?/g, '\n').split('\n').map((line) => line.replace(/[^\S\n]+/gu, ' ').trim()).join('\n').replace(/^\n+|\n+$/g, '');
}

export interface ResourceCardTextBlock {
  /** Vertical centre of the first line, in the card's own coordinates. */
  y: number;
  fontSize: number;
  /** Distance from one line to the next. */
  lineHeight: number;
  /** Number of lines that are drawn. */
  lines: number;
}

export interface ResourceCardLayout {
  look: ResourceCardLook;
  /** The bar at the bottom that lists the links. */
  footer: { x: number; y: number; width: number; height: number };
  footerHeight: number;
  /** Height of the part above the footer, with icon and texts. */
  bodyHeight: number;
  iconSize: number;
  icon: { x: number; y: number };
  /** Left edge of all text lines. */
  textX: number;
  title: ResourceCardTextBlock;
  description: ResourceCardTextBlock;
  /** Height the lines beyond the first of each text add; a card grows by this (#254). */
  extraHeight: number;
}

type CardGeometry = { width: number; height: number; style: { fontSize: number } } & Partial<Pick<SketchElement, 'text' | 'label' | 'description' | 'metadata'>>;

const TITLE_LINE_HEIGHT = 1.25;
const DESCRIPTION_LINE_HEIGHT = 1.4;
/** Space between the dashed frame and the bar of links. */
const DASHED_INSET = 10;

/** Where a resource card draws its parts; the one source for drawing, export, hit-testing and the text editor. */
export function resourceCardLayout(element: CardGeometry): ResourceCardLayout {
  const { fontSize } = element.style;
  const look = resourceCardLook(element);
  const title = { fontSize: Math.max(14, fontSize), lines: resourceCardLines(element.text || element.label).length };
  const description = { fontSize: Math.max(10, fontSize * 0.65), lines: resourceCardLines(element.description).length };
  const titleLine = title.fontSize * TITLE_LINE_HEIGHT;
  const descriptionLine = description.fontSize * DESCRIPTION_LINE_HEIGHT;
  const extraTitle = (title.lines - 1) * titleLine;
  const extraHeight = extraTitle + (description.lines - 1) * descriptionLine;
  // Footer and icon are sized from the card without its extra lines, so that a card which grew by exactly those
  // lines keeps the same footer, the same icon and the same space above and below its texts.
  const baseHeight = Math.max(0, element.height - extraHeight);
  const inset = look === 'dashed' ? DASHED_INSET : 0;
  const footerHeight = Math.max(28, Math.min(36, baseHeight * 0.24));
  const footer = { x: inset, y: element.height - inset - footerHeight, width: Math.max(0, element.width - 2 * inset), height: footerHeight };
  const bodyHeight = Math.max(0, footer.y - (inset ? 4 : 0));
  const baseBody = Math.max(0, bodyHeight - extraHeight);
  const iconSize = Math.max(28, Math.min(52, baseBody * 0.48, element.width * 0.16));
  const middle = bodyHeight / 2;
  return {
    look,
    footer,
    footerHeight,
    bodyHeight,
    iconSize,
    icon: { x: 20, y: Math.max(10, (bodyHeight - iconSize) / 2) },
    textX: 20 + iconSize + 18,
    title: { y: middle - Math.max(5, fontSize * 0.25) - extraHeight / 2, fontSize: title.fontSize, lineHeight: titleLine, lines: title.lines },
    description: { y: middle + Math.max(16, fontSize * 0.85) - extraHeight / 2 + extraTitle, fontSize: description.fontSize, lineHeight: descriptionLine, lines: description.lines },
    extraHeight,
  };
}

/**
 * The height a card has after one of its texts changed: it grows and shrinks by the lines that were added or
 * removed, and keeps whatever extra height the user gave it (#254).
 */
export function resourceCardHeightFor(element: CardGeometry, next: { text?: string | null; description?: string | null }): number {
  const before = resourceCardLayout(element).extraHeight;
  const after = resourceCardLayout({ ...element, ...('text' in next ? { text: next.text ?? undefined, label: next.text ?? undefined } : {}), ...('description' in next ? { description: next.description ?? undefined } : {}) }).extraHeight;
  return Math.max(60, Math.round((element.height + after - before) * 100) / 100);
}

/** The card as it looks while one of its texts is being typed: with the draft in place and the height that goes with it. */
export function resourceCardWithDraft<T extends SketchElement>(element: T, field: ResourceCardField, draft: string): T {
  const next = field === 'title' ? { text: draft } : { description: draft };
  const height = resourceCardHeightFor(element, next);
  return field === 'title' ? { ...element, text: draft, label: draft, height } : { ...element, description: draft, height };
}

/** The rectangle of one text in the card's own coordinates: from the text's left edge to the card's right padding, over all its lines. */
export function resourceCardFieldBox(element: CardGeometry, field: ResourceCardField): { x: number; y: number; width: number; height: number } {
  const layout = resourceCardLayout(element);
  const block = layout[field];
  // The first line keeps the height it always had; every further line adds its distance.
  const first = block.fontSize * 1.3;
  return { x: layout.textX, y: block.y - first / 2, width: Math.max(24, element.width - layout.textX - 12), height: first + (block.lines - 1) * block.lineHeight };
}

/** The text at a point given in the card's own coordinates, or null beside the texts. */
export function resourceCardFieldAt(element: CardGeometry, point: { x: number; y: number }): ResourceCardField | null {
  for (const field of ['title', 'description'] as const) {
    const box = resourceCardFieldBox(element, field);
    if (point.x >= box.x && point.x <= box.x + box.width && point.y >= box.y && point.y <= box.y + box.height) return field;
  }
  return null;
}

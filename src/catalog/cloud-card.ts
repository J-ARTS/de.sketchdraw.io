import type { ComponentDefinition, ComponentSet, SketchElement } from '@/domain';
import { cloudProviderOf, RESOURCE_CARD_TEXT_COLOR, type CloudProvider } from './resource-card';

/**
 * The card of a cloud component (AWS, Azure, GCP, Kubernetes): a rounded surface with the service icon in the
 * middle, the name under it and the provider below. The one source for the canvas and the exports (#259), so that
 * an exported diagram shows the card the canvas shows.
 */
export const CLOUD_CARD_RADIUS = 14;
export const CLOUD_CARD_TITLE_SIZE = 14;
export const CLOUD_CARD_PROVIDER_SIZE = 12;
const TITLE_LINE_HEIGHT = 18;
const PROVIDER_GAP = 24;
/** Components are created with these style defaults; as long as they are untouched the card keeps its themed surface. */
const COMPONENT_DEFAULT_FILL = '#ffffff';
const COMPONENT_DEFAULT_STROKE = '#1e293b';

/** A component of a cloud provider that is large enough to be drawn as a card. */
export function isCloudCard(element: SketchElement | undefined, componentSets: readonly ComponentSet[]): boolean {
  return Boolean(element && cloudProviderOf(element, componentSets) && element.width >= 120 && element.height >= 120);
}

export function cloudProviderLabel(provider: CloudProvider): string {
  return provider === 'gcp' ? 'GCP' : provider.toUpperCase();
}

/** The name in at most two lines, broken at words; what does not fit is cut. */
export function cloudCardTitleLines(value: string, width: number): string[] {
  const max = Math.max(8, Math.floor((width - 24) / 8));
  const words = value.trim().split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  for (const word of words) {
    if (!lines.length) { lines.push(word); continue; }
    const candidate = `${lines[lines.length - 1]} ${word}`;
    if (candidate.length <= max || lines.length >= 2) lines[lines.length - 1] = candidate;
    else lines.push(word);
  }
  return lines.slice(0, 2).map((line) => line.length > max ? `${line.slice(0, Math.max(1, max - 1))}…` : line);
}

export interface CloudCardLayout {
  radius: number;
  icon: { x: number; y: number; size: number };
  /** The lines of the name, centred at `x`; `y` is the baseline of the first one. */
  title: { x: number; y: number; lineHeight: number; lines: string[] };
  /** Baseline of the provider line, centred at the same `x`. */
  providerY: number;
}

export function cloudCardLayout(element: Pick<SketchElement, 'width' | 'height'>, name: string): CloudCardLayout {
  const size = Math.max(40, Math.min(64, element.width * 0.38, element.height * 0.38));
  const lines = cloudCardTitleLines(name, element.width);
  const titleY = lines.length > 1 ? Math.max(94, 24 + size) : Math.max(104, 30 + size);
  return {
    radius: CLOUD_CARD_RADIUS,
    icon: { x: element.width / 2 - size / 2, y: 16, size },
    title: { x: element.width / 2, y: titleY, lineHeight: TITLE_LINE_HEIGHT, lines },
    providerY: Math.min(element.height - 12, titleY + (lines.length - 1) * TITLE_LINE_HEIGHT + PROVIDER_GAP),
  };
}

/**
 * Whether the card still has the fill and frame it was created with. Then the canvas draws it with the surface of
 * the theme instead; a colour the user chose is drawn as chosen.
 */
export function cloudCardUsesThemeSurface(element: Pick<SketchElement, 'style'>, definition: Pick<ComponentDefinition, 'style'> | undefined): { fill: boolean; stroke: boolean } {
  return {
    fill: [COMPONENT_DEFAULT_FILL, definition?.style?.fill].includes(element.style.fill),
    stroke: [COMPONENT_DEFAULT_STROKE, definition?.style?.stroke].includes(element.style.stroke),
  };
}

/** The colours of the light theme for what the canvas takes from the theme; an export has no theme to ask. */
export const CLOUD_CARD_EXPORT_COLORS = { surface: '#f3f1fa', border: '#ebe9f3', provider: '#5f5c74', text: RESOURCE_CARD_TEXT_COLOR } as const;

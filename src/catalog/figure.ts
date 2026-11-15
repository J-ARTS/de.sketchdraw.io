import type { SketchElement } from '../domain/types';
import { COMPONENT_PRESENTATION_KEY } from './isometric';

/**
 * A component drawn as a free-standing figure: its symbol fills the box and its label stands below, without the
 * card that other components have. The isometric icons are drawn this way.
 */
export function isIconFigure(element: Pick<SketchElement, 'kind' | 'metadata'>): boolean {
  return element.kind === 'component' && element.metadata?.[COMPONENT_PRESENTATION_KEY] === 'icon';
}

export interface FigureLayout { icon: { x: number; y: number; size: number }; labelTop: number }

/** Where the symbol and the label of a figure go; the label keeps room for the lines it has (at least one). */
export function figureLayout(element: Pick<SketchElement, 'width' | 'height' | 'style'>, lineCount: number): FigureLayout {
  const lineHeight = element.style.fontSize * 1.25;
  const labelHeight = Math.min(element.height / 2, Math.max(1, lineCount) * lineHeight + 4);
  const size = Math.max(8, Math.min(element.width, element.height - labelHeight));
  return { icon: { x: (element.width - size) / 2, y: Math.max(0, (element.height - labelHeight - size) / 2), size }, labelTop: element.height - labelHeight + 2 };
}

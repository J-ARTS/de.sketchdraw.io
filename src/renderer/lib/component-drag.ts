import type { ComponentSet, ElementPatch } from '@/domain';

export const COMPONENT_DRAG_MIME = 'application/x-sketchdraw-component';

export interface ComponentDragPayload {
  set: ComponentSet;
  type: string;
  /** Changes the new element gets on top of its definition, for a tile that offers a variant of a component. */
  variant?: ElementPatch;
}

let activePayload: ComponentDragPayload | null = null;

export function beginComponentDrag(payload: ComponentDragPayload): void {
  activePayload = payload;
}

export function peekComponentDrag(): ComponentDragPayload | null {
  return activePayload;
}

export function takeComponentDrag(): ComponentDragPayload | null {
  const payload = activePayload;
  activePayload = null;
  return payload;
}

export function clearComponentDrag(): void {
  activePayload = null;
}

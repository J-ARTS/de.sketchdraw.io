import type { ComponentSet } from '@/domain';

export const COMPONENT_DRAG_MIME = 'application/x-sketchdraw-component';

export interface ComponentDragPayload {
  set: ComponentSet;
  type: string;
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

import type { SketchElement } from '@/domain';

/** Speaker notes live in the frame's metadata: they are not part of the drawing and never shown outside the presenter view. */
export const SLIDE_NOTES_KEY = 'sketchdraw.slide.notes';
export const MAX_SLIDE_NOTES_LENGTH = 5000;

export function slideNotes(frame: Pick<SketchElement, 'metadata'> | undefined): string {
  return frame?.metadata?.[SLIDE_NOTES_KEY] ?? '';
}

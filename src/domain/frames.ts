import type { SketchDocument, SketchElement } from './types';

/** Stable document metadata key used by codecs, agents and peers. */
export const FRAME_ORDER_METADATA_KEY = 'sketchdraw.frames.v1.order';

function storedFrameIds(document: SketchDocument): string[] {
  const raw = document.metadata[FRAME_ORDER_METADATA_KEY];
  if (!raw) return [];
  try {
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) && parsed.every((id) => typeof id === 'string') ? parsed : [];
  } catch {
    return [];
  }
}

/** Frames are viewports, not parents. Unknown/stale ids are ignored and new frames append in z-order. */
export function orderedFrames(document: SketchDocument): SketchElement[] {
  const frames = document.elements.filter((element) => element.kind === 'frame');
  const byId = new Map(frames.map((frame) => [frame.id, frame]));
  const result: SketchElement[] = [];
  const seen = new Set<string>();
  for (const id of storedFrameIds(document)) {
    const frame = byId.get(id);
    if (frame && !seen.has(id)) { result.push(frame); seen.add(id); }
  }
  for (const frame of frames) if (!seen.has(frame.id)) result.push(frame);
  return result;
}

export function frameOrderMetadata(ids: readonly string[]): string | null {
  return ids.length ? JSON.stringify([...new Set(ids)]) : null;
}

export function nextFrameLabel(document: SketchDocument): string {
  const labels = new Set(orderedFrames(document).map((frame) => frame.label?.trim().toLocaleLowerCase('de') ?? ''));
  let index = 1;
  while (labels.has(`folie ${index}`)) index += 1;
  return `Folie ${index}`;
}

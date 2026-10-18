import type { EraserSize, PencilPreset } from '@/renderer/state/contract';

export interface PencilOption {
  value: PencilPreset;
  label: string;
  strokeWidth: number;
  opacity: number;
}

export interface EraserOption {
  value: EraserSize;
  label: string;
  /** Screen-pixel radius; the store converts it to document units using the current zoom. */
  radius: number;
  previewSize: number;
}

export const PENCIL_OPTIONS: readonly PencilOption[] = [
  { value: 'fine', label: 'Fein', strokeWidth: 2, opacity: 1 },
  { value: 'pencil', label: 'Stift', strokeWidth: 4, opacity: 1 },
  { value: 'marker', label: 'Marker', strokeWidth: 10, opacity: 0.55 },
];

export const ERASER_OPTIONS: readonly EraserOption[] = [
  { value: 'small', label: 'Klein', radius: 8, previewSize: 10 },
  { value: 'medium', label: 'Mittel', radius: 18, previewSize: 18 },
  { value: 'large', label: 'Groß', radius: 32, previewSize: 28 },
];

export function pencilOption(value: PencilPreset): PencilOption {
  return PENCIL_OPTIONS.find((option) => option.value === value) ?? PENCIL_OPTIONS[0]!;
}

export function eraserOption(value: EraserSize): EraserOption {
  return ERASER_OPTIONS.find((option) => option.value === value) ?? ERASER_OPTIONS[1]!;
}

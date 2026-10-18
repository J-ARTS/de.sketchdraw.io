import type { PencilPreset } from '@/renderer/state/contract';

import { L } from '@/renderer/i18n';
export interface PencilOption {
  value: PencilPreset;
  label: string;
  strokeWidth: number;
  opacity: number;
}

export const PENCIL_OPTIONS: readonly PencilOption[] = [
  { value: 'fine', label: L('Fein'), strokeWidth: 2, opacity: 1 },
  { value: 'pencil', label: L('Stift'), strokeWidth: 4, opacity: 1 },
  { value: 'marker', label: L('Marker'), strokeWidth: 10, opacity: 0.55 },
];

export const PENCIL_SIZE_MIN = 1;
export const PENCIL_SIZE_MAX = 500;
export const PENCIL_SIZE_DEFAULT = PENCIL_OPTIONS[0]!.strokeWidth;
export const PENCIL_OPACITY_MIN = 0;
export const PENCIL_OPACITY_MAX = 100;
export const PENCIL_OPACITY_DEFAULT = Math.round(PENCIL_OPTIONS[0]!.opacity * 100);
export const ERASER_RADIUS_MIN = 1;
export const ERASER_RADIUS_MAX = 500;
export const ERASER_RADIUS_DEFAULT = 18;

export function pencilOption(value: PencilPreset): PencilOption {
  return PENCIL_OPTIONS.find((option) => option.value === value) ?? PENCIL_OPTIONS[0]!;
}

export function clampPencilSize(value: number): number {
  return Math.min(PENCIL_SIZE_MAX, Math.max(PENCIL_SIZE_MIN, Math.round(value)));
}

export function clampPencilOpacity(value: number): number {
  return Math.min(PENCIL_OPACITY_MAX, Math.max(PENCIL_OPACITY_MIN, Math.round(value)));
}

export function clampEraserRadius(value: number): number {
  return Math.min(ERASER_RADIUS_MAX, Math.max(ERASER_RADIUS_MIN, Math.round(value)));
}

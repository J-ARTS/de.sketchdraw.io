/**
 * The colours of the people in a session, in the order the host hands them out. Each is a token with a light and a
 * dark value; text on them uses `--presence-ink`. The badge in the list and the pointer on the canvas use the same
 * entry, which is what ties the two together.
 */
export const PRESENCE_COLORS = [
  'var(--presence-1)', 'var(--presence-2)', 'var(--presence-3)', 'var(--presence-4)',
  'var(--presence-5)', 'var(--presence-6)', 'var(--presence-7)', 'var(--presence-8)',
] as const;

/** The colour for a participant's colour index; numbers outside the range wrap around. */
export function presenceColor(index: number): string {
  const count = PRESENCE_COLORS.length;
  return PRESENCE_COLORS[((Math.trunc(Number.isFinite(index) ? index : 0) % count) + count) % count]!;
}

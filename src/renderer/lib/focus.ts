const FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]):not([type="hidden"]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

/** Visible, keyboard-reachable descendants of `container` in tab order. */
export function focusableWithin(container: HTMLElement): HTMLElement[] {
  return Array.from(container.querySelectorAll<HTMLElement>(FOCUSABLE))
    .filter((element) => element.tabIndex >= 0 && element.getClientRects().length > 0);
}

/**
 * Wraps Tab and Shift+Tab at the edges of a modal, so focus cycles inside it instead of leaving the
 * document (browsers move it to their own chrome after the last element of a native modal dialog).
 */
export function wrapTabFocus(event: KeyboardEvent, container: HTMLElement): void {
  if (event.key !== 'Tab' || event.altKey || event.ctrlKey || event.metaKey) return;
  const items = focusableWithin(container);
  const first = items[0];
  const last = items[items.length - 1];
  if (!first || !last) return;
  const active = document.activeElement;
  if (event.shiftKey && (active === first || !container.contains(active))) { event.preventDefault(); last.focus(); }
  else if (!event.shiftKey && (active === last || !container.contains(active))) { event.preventDefault(); first.focus(); }
}

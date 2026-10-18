import { t } from '@/renderer/i18n';

export function isMacPlatform(): boolean {
  return typeof navigator !== 'undefined' && /Mac/i.test(navigator.userAgent);
}

/** Display text for a Ctrl/Cmd shortcut, for example modHint(false, 'S', true) is "Strg+Umschalt+S". */
export function modHint(isMac: boolean, key: string, shift = false): string {
  if (isMac) return `${shift ? '⇧' : ''}⌘${key}`;
  return `${t('Strg')}+${shift ? `${t('Umschalt')}+` : ''}${key}`;
}

const FOCUSABLE_SELECTOR = [
  'a[href]',
  'button:not([disabled])',
  'input:not([disabled]):not([type="hidden"])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  '[tabindex]:not([tabindex="-1"])',
].join(',');

export function getFocusable(root: HTMLElement): HTMLElement[] {
  return Array.from(root.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR)).filter(
    (el) => !el.hasAttribute('hidden') && el.getClientRects().length > 0,
  );
}

/** Restores focus only if the element is still in the document and nothing else took focus meanwhile. */
export function restoreFocus(target: HTMLElement | null): void {
  if (!target || !target.isConnected) return;
  const active = document.activeElement;
  if (active && active !== document.body && active !== target && !active.closest('[data-focus-scope]')) return;
  target.focus({ preventScroll: true });
}

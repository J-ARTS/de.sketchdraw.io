/**
 * Copying text on request (#250). The desktop app refuses every browser permission, the one for writing to the
 * clipboard included, so `navigator.clipboard` fails there. Copying a selection the way Ctrl+C does needs no
 * permission; it is the second way.
 */

/** Copies `value` by selecting it in a field that is not shown; `true` when the copy was made. */
export function copyBySelection(value: string): boolean {
  if (typeof document === 'undefined' || typeof document.execCommand !== 'function') return false;
  const active = document.activeElement instanceof HTMLElement ? document.activeElement : null;
  // Inside a modal dialog everything outside it is inert, so the field has to live in the dialog.
  const host = active?.closest('dialog[open]') ?? document.body;
  const area = document.createElement('textarea');
  area.value = value;
  area.readOnly = true;
  area.setAttribute('aria-hidden', 'true');
  area.tabIndex = -1;
  area.style.cssText = 'position:fixed;top:0;left:0;width:1px;height:1px;padding:0;border:0;opacity:0;pointer-events:none';
  host.append(area);
  let copied = false;
  try {
    area.select();
    area.setSelectionRange(0, value.length);
    copied = document.execCommand('copy');
  } catch {
    copied = false;
  } finally {
    area.remove();
    active?.focus({ preventScroll: true });
  }
  return copied;
}

/** Puts `value` on the clipboard; `true` when it is there. */
export async function copyText(value: string): Promise<boolean> {
  try {
    if (typeof navigator !== 'undefined' && navigator.clipboard) { await navigator.clipboard.writeText(value); return true; }
  } catch { /* no permission: the second way follows */ }
  return copyBySelection(value);
}

import { nextTick, ref, type Ref } from 'vue';
import { useEventListener } from '@vueuse/core';

/**
 * Fixed-position popover anchored below (or, when it does not fit, above) its trigger. Fixed positioning keeps it
 * from being clipped by scrolling ancestors such as a dialog's field area; it still works inside a modal <dialog>.
 */
export function useAnchoredPopover(trigger: Ref<HTMLElement | null>, popover: Ref<HTMLElement | null>, isOpen: () => boolean, minWidth = 0) {
  const style = ref<Record<string, string>>({});

  function place(): void {
    const anchor = trigger.value?.getBoundingClientRect();
    if (!anchor) return;
    const natural = popover.value?.scrollHeight ?? 0;
    const margin = 8;
    const below = window.innerHeight - anchor.bottom - margin * 2;
    const above = anchor.top - margin * 2;
    const openDown = natural <= below || below >= above;
    const maxHeight = Math.max(120, Math.floor(openDown ? below : above));
    const width = Math.max(anchor.width, minWidth);
    const left = Math.max(margin, Math.min(anchor.left, window.innerWidth - width - margin));
    style.value = {
      left: `${left}px`,
      minWidth: `${width}px`,
      maxHeight: `${maxHeight}px`,
      ...(openDown ? { top: `${anchor.bottom + 4}px`, bottom: 'auto' } : { bottom: `${window.innerHeight - anchor.top + 4}px`, top: 'auto' }),
    };
  }

  async function show(): Promise<void> { await nextTick(); place(); }

  useEventListener(window, 'resize', () => { if (isOpen()) place(); });
  useEventListener(window, 'scroll', () => { if (isOpen()) place(); }, { capture: true, passive: true });

  return { style, place, show };
}

import { nextTick, ref, type Ref } from 'vue';
import { useEventListener } from '@vueuse/core';

/**
 * Viewport coordinates for a popover anchored below (or, when it does not fit, above) its trigger.
 * A caller inside a transformed/clipping ancestor must promote its element to the top layer (see AppSelect).
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
    // The list must fit on its chosen side even in short windows; its options scroll inside this space.
    const maxHeight = Math.max(0, Math.floor(openDown ? below : above));
    const width = Math.max(anchor.width, minWidth);
    // Use the rendered width (long labels widen the popover) so it is not pushed past the right viewport edge.
    const rendered = Math.min(popover.value?.offsetWidth ?? 0, window.innerWidth - margin * 2);
    const left = Math.max(margin, Math.min(anchor.left, window.innerWidth - Math.max(width, rendered) - margin));
    style.value = {
      left: `${left}px`,
      minWidth: `${Math.min(width, window.innerWidth - margin * 2)}px`,
      maxWidth: `${window.innerWidth - margin * 2}px`,
      maxHeight: `${maxHeight}px`,
      ...(openDown ? { top: `${anchor.bottom + 4}px`, bottom: 'auto' } : { bottom: `${window.innerHeight - anchor.top + 4}px`, top: 'auto' }),
    };
  }

  async function show(): Promise<void> { await nextTick(); place(); }

  useEventListener(window, 'resize', () => { if (isOpen()) place(); });
  useEventListener(window, 'scroll', () => { if (isOpen()) place(); }, { capture: true, passive: true });

  return { style, place, show };
}

import { onMounted, ref, type Ref } from 'vue';
import { useEventListener, useMutationObserver, useResizeObserver } from '@vueuse/core';

/**
 * Makes a horizontally scrolling bar discoverable (#78): reports whether content is hidden at either end,
 * pages through it for the edge buttons and maps a vertical mouse wheel to horizontal scrolling.
 */
export function useHorizontalOverflow(scroller: Ref<HTMLElement | null>) {
  const start = ref(false);
  const end = ref(false);

  function update(): void {
    const element = scroller.value;
    if (!element) { start.value = false; end.value = false; return; }
    const max = element.scrollWidth - element.clientWidth;
    start.value = element.scrollLeft > 1;
    end.value = element.scrollLeft < max - 1;
  }

  function page(direction: 1 | -1): void {
    const element = scroller.value;
    if (!element) return;
    element.scrollBy({ left: direction * Math.max(80, element.clientWidth * 0.75), behavior: 'smooth' });
  }

  function onWheel(event: WheelEvent): void {
    const element = scroller.value;
    if (!element || event.ctrlKey || event.metaKey || element.scrollWidth <= element.clientWidth) return;
    if (Math.abs(event.deltaY) <= Math.abs(event.deltaX)) return;
    element.scrollLeft += event.deltaY;
    event.preventDefault();
  }

  /** Scrolls the item into view only when it is (partly) hidden, so the bar does not jump needlessly. */
  function reveal(item: Element | null | undefined): void {
    if (item instanceof HTMLElement && scroller.value?.contains(item)) item.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  }

  useResizeObserver(scroller, update);
  useMutationObserver(scroller, update, { childList: true, subtree: true });
  useEventListener(scroller, 'scroll', update, { passive: true });
  useEventListener(scroller, 'wheel', onWheel, { passive: false });
  onMounted(update);

  return { start, end, page, reveal, update };
}

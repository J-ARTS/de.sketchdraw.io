import { onMounted, ref, type Ref } from 'vue';
import { useEventListener, useMutationObserver, useResizeObserver } from '@vueuse/core';

/**
 * Makes a horizontally scrolling bar discoverable (#78): reports whether content is hidden at either end,
 * pages through it for the edge buttons and maps a vertical mouse wheel to horizontal scrolling.
 */
export function useHorizontalOverflow(scroller: Ref<HTMLElement | null>) {
  const start = ref(false);
  const end = ref(false);
  /** The item that was last brought into view on purpose; it must stay in view when the bar changes its width. */
  let kept: HTMLElement | null = null;

  function update(): void {
    const element = scroller.value;
    if (!element) { start.value = false; end.value = false; return; }
    const max = element.scrollWidth - element.clientWidth;
    // Only the padding of the bar hidden at an end is nothing to scroll to: no button for it.
    const style = getComputedStyle(element);
    start.value = element.scrollLeft > 1 + (Number.parseFloat(style.paddingLeft) || 0);
    end.value = element.scrollLeft < max - 1 - (Number.parseFloat(style.paddingRight) || 0);
  }

  /**
   * The edge buttons take their room from the bar. When one appears, the bar gets narrower and the item that was
   * just brought into view (the last tool after End, for example) would slide out again: it is brought back.
   */
  function onResize(): void {
    const element = scroller.value;
    if (element && kept?.isConnected && element.contains(kept)) kept.scrollIntoView({ block: 'nearest', inline: 'nearest' });
    update();
  }

  function page(direction: 1 | -1): void {
    const element = scroller.value;
    if (!element) return;
    // The user looks at another part of the bar now; nothing is held in view against that.
    kept = null;
    element.scrollBy({ left: direction * Math.max(80, element.clientWidth * 0.75), behavior: 'smooth' });
  }

  function onWheel(event: WheelEvent): void {
    const element = scroller.value;
    if (!element || event.ctrlKey || event.metaKey || element.scrollWidth <= element.clientWidth) return;
    kept = null;
    if (Math.abs(event.deltaY) <= Math.abs(event.deltaX)) return;
    element.scrollLeft += event.deltaY;
    event.preventDefault();
  }

  /** Scrolls the item into view only when it is (partly) hidden, so the bar does not jump needlessly. */
  function reveal(item: Element | null | undefined): void {
    if (!(item instanceof HTMLElement) || !scroller.value?.contains(item)) return;
    kept = item;
    item.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  }

  useResizeObserver(scroller, onResize);
  useEventListener(scroller, 'touchstart', () => { kept = null; }, { passive: true });
  useMutationObserver(scroller, update, { childList: true, subtree: true });
  useEventListener(scroller, 'scroll', update, { passive: true });
  useEventListener(scroller, 'wheel', onWheel, { passive: false });
  onMounted(update);

  return { start, end, page, reveal, update };
}

import { computed, nextTick, reactive, ref, watch, type Ref } from 'vue';
import { useEventListener, useResizeObserver } from '@vueuse/core';
import { buildSearchPattern, findMatches, matchIndexFrom, replacementFor, replaceMatches, segmentText, type TextMatch } from '@/renderer/lib/text-search';

/**
 * Search and replace for a multi-line text field (#245): the state behind `FindReplaceBar` and the marks that
 * are drawn over the field. The field stays an ordinary `<textarea>`; what is replaced goes through it as an
 * input, so the owner hears about it like about typing and the field's own undo keeps working.
 *
 * `field` is the textarea, `marks` the layer over it that shows the hits (see `markStyle`), `text` its
 * current text and `canWrite` whether replacing is allowed.
 */
export function useTextSearch(field: Ref<HTMLTextAreaElement | undefined>, marks: Ref<HTMLElement | undefined>, text: () => string, canWrite: () => boolean) {
  const open = ref(false);
  const replaceOpen = ref(false);
  const query = ref('');
  const replacement = ref('');
  const options = reactive({ matchCase: false, wholeWord: false, regex: false, preserveCase: false });
  /** What the last "replace all" did, for screen readers and the bar. */
  const message = ref('');

  const built = computed(() => (open.value ? buildSearchPattern(query.value, options) : { ok: true as const, pattern: null }));
  const invalid = computed(() => !built.value.ok);
  const found = computed(() => (built.value.ok ? findMatches(text(), built.value.pattern) : { matches: [] as TextMatch[], capped: false }));
  const matches = computed(() => found.value.matches);
  const capped = computed(() => found.value.capped);
  const segments = computed(() => (open.value && matches.value.length ? segmentText(text(), matches.value) : []));

  /** The place the search goes on from: the cursor when the bar opened, then the hit that was visited last. */
  let origin = 0;
  const current = ref(-1);
  watch(matches, (now) => { current.value = matchIndexFrom(now, origin); void reveal(); });

  // --- The layer with the marks lies over the text area of the field and follows its scrolling ---
  const box = ref({ width: 0, height: 0, left: 0, top: 0 });
  const scroll = ref({ left: 0, top: 0 });
  function measure(): void {
    const el = field.value;
    if (!el) return;
    box.value = { width: el.clientWidth, height: el.clientHeight, left: el.offsetLeft + el.clientLeft, top: el.offsetTop + el.clientTop };
    scroll.value = { left: el.scrollLeft, top: el.scrollTop };
  }
  useEventListener(field, 'scroll', measure, { passive: true });
  useResizeObserver(field, measure);
  /** Position and size of the layer; its content is moved by `shiftStyle`. */
  const markStyle = computed(() => ({ left: `${box.value.left}px`, top: `${box.value.top}px`, width: `${box.value.width}px`, height: `${box.value.height}px` }));
  const shiftStyle = computed(() => ({ transform: `translate(${-scroll.value.left}px, ${-scroll.value.top}px)` }));

  /** Scrolls the field so that the current hit is in view. */
  async function reveal(): Promise<void> {
    await nextTick();
    const el = field.value;
    const mark = marks.value?.querySelector<HTMLElement>('[data-current="true"]');
    if (!el || !mark) { measure(); return; }
    const margin = 24;
    const top = mark.offsetTop;
    const left = mark.offsetLeft;
    if (top < el.scrollTop + margin) el.scrollTop = Math.max(0, top - margin);
    else if (top + mark.offsetHeight > el.scrollTop + el.clientHeight - margin) el.scrollTop = top + mark.offsetHeight - el.clientHeight + margin;
    if (left < el.scrollLeft + margin) el.scrollLeft = Math.max(0, left - margin);
    else if (left + mark.offsetWidth > el.scrollLeft + el.clientWidth - margin) el.scrollLeft = left + mark.offsetWidth - el.clientWidth + margin;
    measure();
  }

  function go(step: 1 | -1): void {
    const total = matches.value.length;
    if (!total) return;
    current.value = (Math.max(0, current.value) + step + total) % total;
    origin = matches.value[current.value]!.start;
    message.value = '';
    void reveal();
  }

  /**
   * Opens the bar. A selection on one line becomes the search text, as in an editor; with `replace` the
   * second row is shown as well.
   */
  function show(mode: 'find' | 'replace'): void {
    const el = field.value;
    // Called again from inside the open bar, the search keeps its text and its place.
    if (el && (!open.value || document.activeElement === el)) {
      const selected = el.value.slice(el.selectionStart, el.selectionEnd);
      if (selected && selected.length <= 200 && !selected.includes('\n')) query.value = options.regex ? selected.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') : selected;
      origin = Math.min(el.selectionStart, el.selectionEnd);
    }
    if (mode === 'replace') replaceOpen.value = true;
    message.value = '';
    open.value = true;
    current.value = matchIndexFrom(matches.value, origin);
    void reveal();
  }

  /** Closes the bar; the field gets the focus back, with the current hit selected. */
  function close(): void {
    const match = matches.value[current.value];
    open.value = false;
    message.value = '';
    const el = field.value;
    if (!el) return;
    el.focus({ preventScroll: true });
    if (match) el.setSelectionRange(match.start, match.end);
  }

  /** Replaces a range of the field as if it had been typed there; the focus returns to where it was. */
  function write(start: number, end: number, insert: string): boolean {
    const el = field.value;
    if (!el || !canWrite() || el.readOnly) return false;
    const expected = el.value.slice(0, start) + insert + el.value.slice(end);
    if (expected === el.value) return true;
    const active = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const position = { left: el.scrollLeft, top: el.scrollTop };
    el.focus({ preventScroll: true });
    el.setSelectionRange(start, end);
    // The editing command keeps the field's undo history; where it is not available the text is set directly.
    try { document.execCommand(insert ? 'insertText' : 'delete', false, insert); } catch { /* falls through to the direct way */ }
    if (el.value !== expected) {
      el.value = expected;
      el.setSelectionRange(start + insert.length, start + insert.length);
      el.dispatchEvent(new Event('input', { bubbles: true }));
    }
    el.scrollLeft = position.left;
    el.scrollTop = position.top;
    if (active && active !== el) active.focus({ preventScroll: true });
    return true;
  }

  /** Replaces the current hit and moves on to the next one. */
  function replaceCurrent(): void {
    const match = matches.value[current.value];
    if (!match) return;
    const insert = replacementFor(match, replacement.value, { regex: options.regex, preserveCase: options.preserveCase });
    message.value = '';
    if (!write(match.start, match.end, insert)) return;
    origin = match.start + insert.length;
    // A replacement that changes nothing leaves the hits as they are; the search still moves on.
    void nextTick(() => { current.value = matchIndexFrom(matches.value, origin); void reveal(); });
  }

  /** Replaces every hit in one step and returns how many there were. */
  function replaceAll(): number {
    if (!built.value.ok || !built.value.pattern) return 0;
    const before = text();
    const all = findMatches(before, built.value.pattern, Number.POSITIVE_INFINITY).matches;
    if (!all.length) return 0;
    const after = replaceMatches(before, all, replacement.value, { regex: options.regex, preserveCase: options.preserveCase });
    origin = 0;
    if (!write(0, before.length, after)) return 0;
    return all.length;
  }

  return { open, replaceOpen, query, replacement, options, message, invalid, matches, capped, current, segments, markStyle, shiftStyle, show, close, next: () => go(1), previous: () => go(-1), replaceCurrent, replaceAll, measure };
}

import { defineComponent, h, onBeforeUnmount, provide } from 'vue';
import type { Decorator } from '@storybook/vue3-vite';
import { WHITEBOARD_KEY, type WhiteboardStore } from '@/renderer/state/contract';
import { createWhiteboardStore } from '@/renderer/state/whiteboard';

/**
 * Gives a story a whiteboard store of its own, as the workspace page provides it to the app. Organisms read
 * and change the application state through it; `prepare` puts the store into the state the story shows.
 */
export function withWhiteboard(prepare?: (store: WhiteboardStore) => void | Promise<void>): Decorator {
  return (story) => defineComponent({
    name: 'WithWhiteboard',
    setup() {
      const store = createWhiteboardStore();
      provide(WHITEBOARD_KEY, store);
      void prepare?.(store);
      onBeforeUnmount(() => store.dispose());
      return () => h(story());
    },
  });
}

/** A positioned area for organisms that float over the canvas in the app. */
export const stage = (minHeight = 360): Decorator => (story) => defineComponent({
  name: 'Stage',
  setup: () => () => h('div', { style: `position:relative;width:min(1100px,92vw);min-height:${minHeight}px` }, [h(story())]),
});

import { inject } from 'vue';
import { WHITEBOARD_KEY } from '@/renderer/state/contract';
import type { WhiteboardStore } from '@/renderer/state/contract';

export function useWhiteboard(): WhiteboardStore {
  const store = inject(WHITEBOARD_KEY, null);
  if (!store) {
    throw new Error('useWhiteboard() was called without a provider: the app root must call provide(WHITEBOARD_KEY, store).');
  }
  return store;
}

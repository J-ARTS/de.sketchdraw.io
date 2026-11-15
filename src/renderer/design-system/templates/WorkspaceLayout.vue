<script setup lang="ts">
/**
 * The frame of the workspace: one full-window region for the canvas and everything floating over it, and a
 * place for what must stay usable while that region is blocked (the live region for announcements, modal
 * dialogs, the presenter). It holds no content of its own; the page fills its two slots.
 */
withDefaults(defineProps<{
  /** The accessible name of the workspace landmark. */
  label: string;
  /** Blocks the content region for pointer and keyboard, while a transition runs or something covers it. */
  inert?: boolean;
  /** Height in pixels that feedback at the bottom takes; side panels end above it. */
  feedbackHeight?: number;
}>(), { inert: false, feedbackHeight: 0 });
defineSlots<{
  /** Canvas, bars, panels and feedback: everything that belongs to the working surface. */
  default(): unknown;
  /** What stays reachable while the content is blocked: announcements, dialogs, full-screen modes. */
  overlays(): unknown;
}>();
</script>

<template>
  <main class="workspace" :aria-label="label">
    <div class="workspace-content" :inert="inert || undefined" :style="{ '--feedback-height': `${feedbackHeight}px` }"><slot /></div>
    <slot name="overlays" />
  </main>
</template>

<style scoped>
.workspace,.workspace-content{position:absolute;inset:0;overflow:hidden}
/* Re-resolved here so the measured --feedback-height (set on this element) takes effect. */
.workspace-content{--panel-bottom:calc(var(--panel-bottom-base) + var(--feedback-height, 0px) + var(--space-2))}
</style>

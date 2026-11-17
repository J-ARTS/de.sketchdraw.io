<!-- @component The badge of a person in a session: one or two initials on that person's colour. The same colour and letters mark the person's pointer on the canvas. The badge is decoration: put the name next to it. -->
<script setup lang="ts">
import { computed } from 'vue';
import { participantInitials } from '@/collaboration/presence';
import { presenceColor } from '@/renderer/design-system/atoms/presence-colors';

const props = withDefaults(defineProps<{
  /** The name the initials are taken from. */
  name: string;
  /** Which of the participant colours, 0 to 7; other numbers wrap around. */
  color: number;
  /** Edge length: `md` for lists, `sm` next to running text. */
  size?: 'sm' | 'md';
  /** The person is not reachable at the moment. */
  away?: boolean;
}>(), { size: 'md', away: false });

const initials = computed(() => participantInitials(props.name));
</script>

<template>
  <span class="app-avatar" :data-size="size" :data-away="away || undefined" :style="{ '--avatar-color': presenceColor(color) }" aria-hidden="true">{{ initials }}</span>
</template>

<style scoped>
/* The squared corner is where the badge hangs on the pointer; the list keeps the same outline. */
.app-avatar{flex:none;display:inline-grid;place-items:center;width:28px;height:28px;border-radius:4px 14px 14px 14px;background:var(--avatar-color);color:var(--presence-ink);font:700 11px/1 var(--font-sans);letter-spacing:.02em;user-select:none}
.app-avatar[data-size='sm']{width:22px;height:22px;border-radius:3px 11px 11px 11px;font-size:10px}
.app-avatar[data-away]{background:transparent;color:var(--text-muted);box-shadow:inset 0 0 0 1.5px var(--avatar-color)}
@media(forced-colors:active){.app-avatar{border:1px solid CanvasText}}
</style>

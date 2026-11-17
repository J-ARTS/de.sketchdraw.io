<!-- @component The pointers of the other people in a session, drawn over the canvas: an arrow in the person's colour with their initials. Only pointers on the page that is open are shown. It belongs inside the canvas `<svg>`. -->
<script setup lang="ts">
import { computed, inject } from 'vue';
import { t } from '@/renderer/i18n';
import { WHITEBOARD_KEY } from '@/renderer/state/contract';
import { participantInitials } from '@/collaboration/presence';
import { presenceColor } from '@/renderer/design-system/atoms/presence-colors';

const store = inject(WHITEBOARD_KEY)!;
const s = store.state;

const pointers = computed(() => {
  const people = new Map(s.presence.participants.map(person => [person.id, person]));
  return s.presence.cursors.flatMap(cursor => {
    const person = people.get(cursor.id);
    if (!person || person.self || cursor.pageId !== s.activePageId) return [];
    const name = person.name || (person.role === 'owner' ? t('Gastgeber') : t('Gast {number}', { number: person.number }));
    return [{ id: cursor.id, x: cursor.x, y: cursor.y, color: presenceColor(person.color), initials: participantInitials(name) }];
  });
});
</script>

<template>
  <!-- Positions are document coordinates, so panning moves the pointers with the drawing; the inverse scale keeps their size. -->
  <g v-if="pointers.length" class="remote-cursors" data-testid="remote-cursors" :transform="`translate(${s.viewport.panX} ${s.viewport.panY}) scale(${s.viewport.zoom})`" pointer-events="none" aria-hidden="true">
    <g v-for="pointer in pointers" :key="pointer.id" class="remote-cursor" data-testid="remote-cursor" :data-participant="pointer.id" :data-x="pointer.x" :data-y="pointer.y" :style="{ transform: `translate(${pointer.x}px, ${pointer.y}px) scale(${1 / s.viewport.zoom})` }">
      <path class="arrow" d="M0 0 L0 15.2 L4.3 11.4 L7.1 17.6 L9.7 16.4 L6.9 10.3 L12.4 10.3 Z" :fill="pointer.color" />
      <path class="tag" d="M12 15 h11 a11 11 0 0 1 11 11 a11 11 0 0 1 -11 11 a11 11 0 0 1 -11 -11 Z" :fill="pointer.color" />
      <text x="23" y="26" text-anchor="middle" dominant-baseline="central">{{ pointer.initials }}</text>
    </g>
  </g>
</template>

<style scoped>
.remote-cursor{transition:transform 90ms linear}
.arrow,.tag{stroke:var(--surface-panel);stroke-width:1.5;stroke-linejoin:round;paint-order:stroke}
text{fill:var(--presence-ink);font:700 10px var(--font-sans);letter-spacing:.02em;user-select:none}
@media(prefers-reduced-motion:reduce){.remote-cursor{transition:none}}
</style>

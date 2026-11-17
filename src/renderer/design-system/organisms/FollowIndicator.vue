<!-- @component Shown over the workspace while the user follows someone in a session: a frame in that person's colour and a bar that names the person and ends following. -->
<script setup lang="ts">
import { computed } from 'vue';
import AppAvatar from '@/renderer/design-system/atoms/AppAvatar.vue';
import AppButton from '@/renderer/design-system/atoms/AppButton.vue';
import { presenceColor } from '@/renderer/design-system/atoms/presence-colors';
import { useWhiteboard } from '@/renderer/design-system/composables/use-whiteboard';
import { participantLabel } from '@/renderer/lib/participant-label';
import { t } from '@/renderer/i18n';

const store = useWhiteboard();
const s = store.state;
const person = computed(() => s.presence.participants.find(entry => entry.id === s.following) ?? null);
</script>

<template>
  <div v-if="person" class="follow" data-testid="follow-indicator" :data-participant="person.id" :style="{ '--follow-color': presenceColor(person.color) }">
    <div class="follow-frame" aria-hidden="true" />
    <div class="follow-bar sd-panel">
      <AppAvatar :name="participantLabel(person)" :color="person.color" size="sm" />
      <p class="follow-text" role="status">{{ t('Du folgst {name}', { name: participantLabel(person) }) }}</p>
      <AppButton class="follow-stop" data-testid="follow-stop" @click="store.followParticipant(null)">{{ t('Nicht mehr folgen') }}</AppButton>
    </div>
  </div>
</template>

<style scoped>
.follow{position:absolute;inset:0;z-index:35;pointer-events:none}
.follow-frame{position:absolute;inset:0;box-shadow:inset 0 0 0 3px var(--follow-color)}
/* A floating bar like the others: same height, same control size. */
.follow-bar{position:absolute;left:50%;bottom:var(--space-4);transform:translateX(-50%);display:flex;align-items:center;gap:var(--space-3);height:var(--chrome-height);max-width:calc(100% - 2 * var(--space-4));padding:0 var(--space-2) 0 var(--space-4);pointer-events:auto;box-shadow:var(--shadow-panel),inset 0 0 0 1.5px var(--follow-color)}
.follow-text{margin:0;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:var(--font-size-m);font-weight:600;line-height:1.3;color:var(--text-primary)}
.follow-stop{flex:none;height:var(--chrome-control)}
/* Up to 760 px the zoom bar takes the bottom row; the bar sits above it. */
@media(max-width:760px){.follow-bar{bottom:calc(var(--space-3) + var(--chrome-height) + var(--space-2))}}
/* In a very narrow window the name gets a second line instead of being cut off. */
@media(max-width:480px){.follow-text{display:-webkit-box;-webkit-box-orient:vertical;-webkit-line-clamp:2;white-space:normal}}
@media(forced-colors:active){.follow-frame{box-shadow:inset 0 0 0 3px Highlight}}
</style>

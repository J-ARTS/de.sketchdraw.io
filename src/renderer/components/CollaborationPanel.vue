<script setup lang="ts">
import { t } from '@/renderer/i18n';
import AppIcon from './AppIcon.vue';
import HdhtSession from './HdhtSession.vue';

defineProps<{
  open: boolean;
  /** A session link the app was opened with; it is prefilled for the PIN join. */
  inviteLink?: string | null;
}>();
const emit = defineEmits<{ close: []; 'link-consumed': [] }>();
</script>

<template>
  <aside v-show="open" class="peer-panel sd-panel" :aria-label="t('Zusammenarbeiten')" data-testid="collaboration-panel">
    <header><h2 class="sd-panel-title">{{ t('Zusammenarbeiten') }}</h2><button class="sd-icon-btn sd-panel-close" :aria-label="t('Zusammenarbeit schließen')" @click="emit('close')"><AppIcon name="close" /></button></header>
    <div class="body">
      <HdhtSession :invite-link="inviteLink" @link-consumed="emit('link-consumed')" />
    </div>
  </aside>
</template>

<style scoped>
.peer-panel{position:absolute;right:12px;top:var(--panel-top);bottom:72px;width:360px;z-index:22;display:flex;flex-direction:column;overflow:hidden}header{padding:8px 12px;display:flex;justify-content:space-between;align-items:center;border-bottom:1px solid var(--border-subtle)}.body{padding:16px;overflow:auto}@media(max-width:860px){.peer-panel{width:min(360px,calc(100vw - 24px))}}
</style>

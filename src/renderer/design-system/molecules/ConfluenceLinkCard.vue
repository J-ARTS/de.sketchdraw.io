<!-- @component The live link of one diagram page to a Confluence page: where it goes, what the publication is doing right now, and the actions on it. It shows what it is given and reports what the user chose; linking and publishing happen in the store. -->
<script setup lang="ts">
import { computed } from 'vue';
import AppButton from '@/renderer/design-system/atoms/AppButton.vue';
import { t } from '@/renderer/i18n';
import { confluenceLiveStatusText, confluenceLiveTime, type ConfluenceLiveStatus } from '@/renderer/lib/confluence-live-text';

const props = withDefaults(defineProps<{
  /** Title of the linked Confluence page. */
  title: string;
  /** The Atlassian site the page is on. */
  siteUrl: string;
  /** What the publication of this page is doing. */
  status: ConfluenceLiveStatus;
  /** Time of the last confirmed publication as stored with the link; `status.syncedAt` wins when it is newer knowledge. */
  lastSyncedAt?: string;
  /** Another operation is running: no action can start. */
  busy?: boolean;
}>(), { busy: false });
const emit = defineEmits<{
  /** Publish now instead of after the next change. */
  sync: [];
  /** Open the linked page in the browser. */
  open: [];
  /** Remove the link. */
  unlink: [];
}>();

const statusText = computed(() => confluenceLiveStatusText(props.status));
/** A pause the server asked for is shown with its end, so waiting is never mistaken for a hang. */
const retryText = computed(() => { const time = confluenceLiveTime(props.status.retryAt); return time ? t('Nächster Versuch nicht vor {time}', { time }) : ''; });
const syncedText = computed(() => { const time = confluenceLiveTime(props.status.syncedAt ?? props.lastSyncedAt); return time ? t('Zuletzt übertragen: {time}', { time }) : ''; });
const cannotSync = computed(() => props.busy || props.status.state === 'off' || props.status.state === 'paused' || props.status.state === 'syncing');
</script>

<template>
  <div class="link-card" data-testid="confluence-link-card">
    <div class="link-target"><span class="link-label">{{ t('Verknüpft mit') }}</span><strong data-testid="confluence-link-target">{{ title || t('Confluence-Seite') }}</strong><span>{{ siteUrl }}</span></div>
    <p class="link-status" :class="`link-status--${status.state}`" :role="status.state === 'error' ? 'alert' : 'status'" data-testid="confluence-link-status"><span class="link-dot" aria-hidden="true"></span><span>{{ statusText }}</span></p>
    <p v-if="retryText" class="link-time" data-testid="confluence-link-retry-at">{{ retryText }}</p>
    <p v-if="syncedText" class="link-time" data-testid="confluence-link-synced-at">{{ syncedText }}</p>
    <div class="link-actions">
      <AppButton intent="primary" data-testid="confluence-link-sync-now" :disabled="cannotSync" @click="emit('sync')">{{ t('Jetzt synchronisieren') }}</AppButton>
      <AppButton data-testid="confluence-link-open" @click="emit('open')">{{ t('In Confluence öffnen') }} ↗</AppButton>
      <AppButton class="link-unlink" intent="danger" data-testid="confluence-link-unlink" :disabled="busy" @click="emit('unlink')">{{ t('Verknüpfung lösen') }}</AppButton>
    </div>
  </div>
</template>

<style scoped>
.link-card{display:grid;gap:var(--space-2);padding:var(--space-3);border:1px solid color-mix(in srgb,var(--accent) 28%,var(--border-subtle));border-radius:var(--radius-1);background:color-mix(in srgb,var(--accent) 5%,var(--surface-raised))}
.link-target{display:grid;gap:2px;min-width:0}
.link-target strong{overflow-wrap:anywhere;font-size:var(--font-size-l)}
.link-target span,.link-time{color:var(--text-muted);font-size:var(--font-size-s)}
.link-label{font-weight:650}
.link-status{display:flex;align-items:flex-start;gap:var(--space-2);margin:0;font-size:var(--font-size-s);line-height:1.45}
.link-dot{flex:0 0 auto;width:var(--space-2);height:var(--space-2);margin-top:var(--space-1);border-radius:50%;background:var(--text-muted)}
.link-status--synced .link-dot{background:var(--status-ok)}
.link-status--error{color:var(--status-error)}
.link-status--error .link-dot{background:var(--status-error)}
.link-status--syncing .link-dot,.link-status--pending .link-dot,.link-status--retrying .link-dot{background:var(--accent)}
.link-time{margin:0}
.link-actions{display:flex;flex-wrap:wrap;gap:var(--space-2);margin-top:var(--space-1)}
.link-unlink{margin-left:auto}
@media(forced-colors:active){.link-card{border-color:CanvasText}.link-dot{forced-color-adjust:none;background:CanvasText}}
</style>

<!-- @component The update section of the settings: installed version, what the last check found, the action that fits it and the switch for the automatic check. It only shows a status and reports what the user chose; checking and installing happen in the desktop app. -->
<script setup lang="ts">
import { computed } from 'vue';
import type { UpdateStatus } from '@/domain';
import { t } from '@/renderer/i18n';
import AppButton from '@/renderer/design-system/atoms/AppButton.vue';
import AppSwitch from '@/renderer/design-system/atoms/AppSwitch.vue';

const props = defineProps<{
  /** Where the update stands, as the desktop app reports it. */
  status: UpdateStatus;
}>();
const emit = defineEmits<{
  /** The user asks for a check. */
  check: [];
  /** The user wants the available version installed now. */
  install: [];
  /** The user wants to see the release page. */
  'release-page': [];
  /** The user switched the automatic check. */
  'update:autoCheck': [enabled: boolean];
}>();

const version = computed(() => props.status.latestVersion ?? '');
const percent = computed(() => Math.round((props.status.progress ?? 0) * 100));
const message = computed(() => {
  const status = props.status;
  if (!status.supported) return t('Updates gibt es nur in der installierten App.');
  switch (status.phase) {
    case 'checking': return t('Sucht nach Updates …');
    case 'current': return t('Sketchdraw ist aktuell.');
    case 'available': return status.canInstall
      ? t('Version {version} ist verfügbar.', { version: version.value })
      : t('Version {version} ist verfügbar. Diese Installation kann sich nicht selbst ersetzen; die neue Version liegt auf der Release-Seite.', { version: version.value });
    case 'downloading': return t('Version {version} wird geladen: {percent} %', { version: version.value, percent: percent.value });
    case 'installing': return t('Version {version} wird installiert …', { version: version.value });
    case 'ready': return t('Version {version} ist bereit. Sketchdraw startet neu, sobald offene Änderungen gesichert sind.', { version: version.value });
    case 'error':
      switch (status.problem) {
        case 'release': return t('Das neueste Release ließ sich nicht lesen.');
        case 'checksum': return t('Die geladene Datei passt nicht zur Prüfsumme des Releases und wurde verworfen.');
        case 'install': return t('Die neue Version ließ sich nicht installieren. Auf der Release-Seite kannst du sie von Hand laden.');
        case 'cancelled': return t('Die Installation wurde abgebrochen.');
        default: return t('GitHub war nicht erreichbar. Versuche es später noch einmal.');
      }
    default: return '';
  }
});
/** The one action that fits the status; nothing while the app is busy. */
const action = computed<'check' | 'install' | 'release-page' | null>(() => {
  const status = props.status;
  if (!status.supported) return null;
  if (status.phase === 'available') return status.canInstall ? 'install' : 'release-page';
  if (status.phase === 'idle' || status.phase === 'current' || status.phase === 'error') return 'check';
  return null;
});
const offersPage = computed(() => props.status.phase === 'error' && (props.status.problem === 'install' || props.status.problem === 'checksum'));
</script>

<template>
  <div class="update-settings" data-testid="update-settings" :data-phase="status.phase">
    <div class="update-row">
      <div class="update-text">
        <p class="update-version" data-testid="update-version">{{ t('Version {version}', { version: status.currentVersion }) }}</p>
        <p class="update-message" :class="{ 'is-problem': status.phase === 'error' }" role="status" data-testid="update-message">{{ message }}</p>
      </div>
      <div class="update-actions">
        <AppButton v-if="offersPage" data-testid="update-release-page" @click="emit('release-page')">{{ t('Release-Seite öffnen') }}</AppButton>
        <AppButton v-if="action === 'check'" data-testid="update-check" @click="emit('check')">{{ t('Nach Updates suchen') }}</AppButton>
        <AppButton v-else-if="action === 'install'" intent="primary" data-testid="update-install" @click="emit('install')">{{ t('Jetzt aktualisieren') }}</AppButton>
        <AppButton v-else-if="action === 'release-page'" intent="primary" data-testid="update-release-page" @click="emit('release-page')">{{ t('Release-Seite öffnen') }}</AppButton>
      </div>
    </div>
    <div v-if="status.phase === 'downloading'" class="update-progress" role="progressbar" aria-valuemin="0" aria-valuemax="100" :aria-valuenow="percent" :aria-label="t('Fortschritt des Downloads')"><span :style="{ width: `${percent}%` }" /></div>
    <AppSwitch v-if="status.supported" class="update-auto" data-testid="update-auto-check" :model-value="status.autoCheck" @update:model-value="emit('update:autoCheck', $event)">
      {{ t('Automatisch nach Updates suchen') }}
      <template #description>{{ t('Beim Start und danach alle paar Stunden fragt Sketchdraw bei GitHub nach dem neuesten Release. Aus deinen Dokumenten wird dabei nichts übertragen.') }}</template>
    </AppSwitch>
  </div>
</template>

<style scoped>
.update-settings{display:flex;flex-direction:column;gap:var(--space-2)}
.update-row{display:flex;flex-wrap:wrap;align-items:flex-start;justify-content:space-between;gap:var(--space-2) var(--space-4)}
.update-text{flex:1 1 180px;min-width:0}
.update-version{margin:0;font-size:14px;font-weight:650;font-variant-numeric:tabular-nums}
.update-message{margin:2px 0 0;min-height:18px;color:var(--text-muted);font-size:12px;line-height:1.5}
.update-message.is-problem{color:var(--text-primary)}
.update-actions{display:flex;flex:0 1 auto;flex-wrap:wrap;gap:var(--space-2)}
.update-progress{height:6px;border-radius:999px;background:var(--surface-raised);overflow:hidden}
.update-progress span{display:block;height:100%;border-radius:inherit;background:var(--accent);transition:width .2s linear}
.update-auto{margin:0 calc(var(--space-3) * -1);width:calc(100% + var(--space-3) * 2)}
@media(prefers-reduced-motion:reduce){.update-progress span{transition:none}}
@media(forced-colors:active){.update-progress{border:1px solid CanvasText}.update-progress span{background:Highlight}}
</style>

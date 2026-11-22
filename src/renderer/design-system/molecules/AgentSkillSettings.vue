<!-- @component The agent section of the settings: the switch that lets the desktop app keep its skill in the skill folders of Claude Code, Codex and Antigravity up to date, and where the skill stands for each of them. It only shows a status and reports what the user chose; the desktop app does the writing. -->
<script setup lang="ts">
import type { AgentSkillClient, AgentSkillClientId, AgentSkillStatus } from '@/domain';
import { t } from '@/renderer/i18n';
import AppButton from '@/renderer/design-system/atoms/AppButton.vue';
import AppSwitch from '@/renderer/design-system/atoms/AppSwitch.vue';

defineProps<{
  /** Where the skill stands, as the desktop app reports it. */
  status: AgentSkillStatus;
}>();
const emit = defineEmits<{
  /** The user switched the automatic setup. */
  'update:automatic': [enabled: boolean];
  /** The user wants the skill of this version in the folder of one agent, whatever is there now. */
  replace: [client: AgentSkillClientId];
}>();

function stateText(client: AgentSkillClient): string {
  switch (client.state) {
    case 'absent': return t('Nicht auf diesem Computer gefunden');
    case 'missing': return t('Nicht eingerichtet');
    case 'current': return t('Aktuell');
    case 'outdated': return t('Ältere Fassung');
    default: return t('Geändert oder von Hand abgelegt – wird nicht automatisch ersetzt');
  }
}
/** The one action that fits the state of an agent; none where there is nothing to do. */
function action(client: AgentSkillClient): string | null {
  switch (client.state) {
    case 'missing': return t('Einrichten');
    case 'outdated': return t('Aktualisieren');
    case 'modified': return t('Ersetzen');
    default: return null;
  }
}
</script>

<template>
  <div class="agent-skill" data-testid="agent-skill-settings">
    <p v-if="!status.supported" class="agent-skill-note" role="status" data-testid="agent-skill-unsupported">{{ t('Den Skill richtet nur die installierte App ein.') }}</p>
    <AppSwitch v-else class="agent-skill-switch" data-testid="agent-skill-automatic" :model-value="status.automatic === true" @update:model-value="emit('update:automatic', $event)">
      {{ t('Skill für KI-Agenten aktuell halten') }}
      <template #description>{{ t('Sketchdraw legt seine Anleitung in die Skill-Ordner der Agenten und erneuert sie bei jedem Update. Es schreibt nur in den eigenen Ordner „sketchdraw-desktop“. Ausschalten lässt vorhandene Ordner unverändert.') }}</template>
    </AppSwitch>
    <ul class="agent-skill-clients" :aria-label="t('Skill je Agent')">
      <li v-for="client in status.clients" :key="client.id" :data-testid="`agent-skill-${client.id}`" :data-state="client.state">
        <div class="agent-skill-text">
          <p class="agent-skill-name">{{ client.name }}</p>
          <p class="agent-skill-state" :class="{ 'is-attention': client.state === 'modified' }">{{ stateText(client) }}</p>
          <p class="agent-skill-folder">{{ client.folder }}</p>
        </div>
        <AppButton v-if="status.supported && action(client)" :data-testid="`agent-skill-replace-${client.id}`" :aria-label="t('{action}: Skill für {name}', { action: action(client) ?? '', name: client.name })" @click="emit('replace', client.id)">{{ action(client) }}</AppButton>
      </li>
    </ul>
  </div>
</template>

<style scoped>
.agent-skill{display:flex;flex-direction:column;gap:var(--space-2)}
.agent-skill-note{margin:0;color:var(--text-muted);font-size:12px;line-height:1.5}
.agent-skill-switch{margin:0 calc(var(--space-3) * -1);width:calc(100% + var(--space-3) * 2)}
.agent-skill-clients{display:grid;gap:var(--space-2);margin:0;padding:0;list-style:none}
.agent-skill-clients li{display:flex;flex-wrap:wrap;align-items:center;justify-content:space-between;gap:var(--space-2) var(--space-4);padding:var(--space-2) var(--space-3);border:1px solid var(--border-subtle);border-radius:var(--radius-2);background:var(--surface-raised)}
.agent-skill-clients li[data-state='absent']{background:transparent}
.agent-skill-text{flex:1 1 200px;min-width:0}
.agent-skill-name{margin:0;font-size:14px;font-weight:650}
.agent-skill-state{margin:2px 0 0;color:var(--text-muted);font-size:12px;line-height:1.5}
.agent-skill-state.is-attention{color:var(--text-primary)}
.agent-skill-folder{margin:2px 0 0;color:var(--text-muted);font:11px/1.5 var(--font-mono);overflow-wrap:anywhere}
</style>

<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from 'vue';
import { attachRendererAgentSession, type RendererAgentSession } from '@/agent-access/renderer-session';
import type { AgentGrantSummary, AgentPermission } from '@/agent-access/types';
import type { DocumentAuthority } from '@/session';
import { useWhiteboard } from './use-whiteboard';

const props = defineProps<{ open: boolean }>();
const emit = defineEmits<{ close: [] }>();
const store = useWhiteboard();
const bridge = window.sketchdrawAgentAccess;
const available = Boolean(bridge?.isAvailable);
const label = ref(''); const permission = ref<AgentPermission>('read');
const grants = ref<AgentGrantSummary[]>([]); const ready = ref(false); const busy = ref(false);
const error = ref(''); const status = ref(''); const shownGrant = ref<string | null>(null);
const pendingRevocations = ref<string[]>([]); const configField = ref<HTMLTextAreaElement>();
// Capabilities live only in this component's transient closure. Never persist, log or auto-copy.
const configurations = new Map<string, string>();
let manager: RendererAgentSession | null = null;
const configuration = computed(() => shownGrant.value ? configurations.get(shownGrant.value) ?? '' : '');
function clearPrivateState() { shownGrant.value = null; configurations.clear(); grants.value = []; pendingRevocations.value = []; label.value = ''; permission.value = 'read'; error.value = ''; status.value = ''; ready.value = false; busy.value = false; }
function reportFailure(value: unknown) {
  const code = value && typeof value === 'object' && 'code' in value ? value.code : '';
  error.value = code === 'SESSION_CHANGED' ? 'Das Dokument wurde gewechselt. Bitte mit dem aktuellen Dokument fortfahren.'
    : code === 'REQUEST_TIMEOUT' ? 'Die Bestätigung dauert zu lange. Bitte erneut prüfen. Ein lokal gesperrter Zugriff bleibt gesperrt.'
      : code === 'BUSY' ? 'Der Zugriff ist gerade beschäftigt. Bitte die Aktion erneut versuchen.'
        : 'Der Agentenzugriff konnte nicht bestätigt werden. Bitte die Desktop-Verbindung prüfen und erneut versuchen.';
}
async function refresh() {
  const owner = manager; if (!owner) return;
  try {
    const list = await owner.listGrants();
    if (owner === manager) {
      grants.value = list;
      for (const id of configurations.keys()) if (!list.some(grant => grant.grantId === id && grant.active && !grant.revoked)) configurations.delete(id);
      if (shownGrant.value && !configurations.has(shownGrant.value)) shownGrant.value = null;
    }
  }
  catch (value) { if (owner === manager) reportFailure(value); }
}
function attach(authority: DocumentAuthority | null) {
  const previous = manager; manager = null; clearPrivateState();
  try { previous?.dispose(); } catch { /* Old authority may already be stopped; private UI data is cleared first. */ }
  if (!available || !bridge || !authority) return;
  try {
    const owner = attachRendererAgentSession(authority, bridge); manager = owner;
    void owner.ready.then(async () => { if (manager === owner) { ready.value = true; await refresh(); } }, value => { if (manager === owner) reportFailure(value); });
  } catch (value) { reportFailure(value); }
}
attach(store.getAuthority());
const unsubscribe = store.subscribeAuthority(attach);
watch(() => props.open, open => { shownGrant.value = null; if (open && ready.value) void refresh(); });
async function createGrant() {
  const owner = manager; if (!owner || !ready.value || busy.value) return;
  busy.value = true; error.value = ''; shownGrant.value = null;
  try {
    const result = await owner.createGrant(permission.value, label.value.trim() || undefined);
    if (manager !== owner) return;
    if (result.clientConfiguration) configurations.set(result.grant.grantId, JSON.stringify({ mcpServers: { sketchdraw: result.clientConfiguration } }, null, 2));
    status.value = result.clientConfiguration ? 'Freigabe erstellt. Zeige die Konfiguration ausdrücklich an, um deinen lokalen Agenten zu verbinden.' : 'Freigabe erstellt. Für diese Installation ist noch kein Client-Startbefehl verfügbar.';
    label.value = ''; await refresh();
  } catch (value) { if (manager === owner) reportFailure(value); }
  finally { if (manager === owner) busy.value = false; }
}
async function revoke(grantId: string) {
  const owner = manager; if (!owner || busy.value) return;
  // Remove visible/private connection data synchronously before the manager's local revoke + IPC.
  if (shownGrant.value === grantId) shownGrant.value = null;
  configurations.delete(grantId); pendingRevocations.value = [...new Set([...pendingRevocations.value, grantId])];
  busy.value = true; error.value = '';
  try {
    await owner.revokeGrant(grantId);
    if (manager !== owner) return;
    pendingRevocations.value = pendingRevocations.value.filter(id => id !== grantId);
    status.value = 'Freigabe widerrufen. Dieser Agent hat keinen Zugriff mehr.'; await refresh();
  } catch (value) { if (manager === owner) reportFailure(value); }
  finally { if (manager === owner) busy.value = false; }
}
async function copyConfiguration() {
  const value = configuration.value; if (!value) return;
  try { await navigator.clipboard.writeText(value); if (configuration.value === value) status.value = 'Konfiguration in die Zwischenablage kopiert.'; }
  catch { configField.value?.focus(); configField.value?.select(); status.value = 'Bitte die markierte Konfiguration mit dem üblichen Tastenkürzel kopieren.'; }
}
onBeforeUnmount(() => { unsubscribe(); const previous = manager; manager = null; clearPrivateState();
  try { previous?.dispose(); } catch { /* Old authority may already be stopped; private UI data is cleared first. */ } });
</script>

<template>
  <aside v-if="open" class="agent-panel sd-panel" aria-label="Agentenzugriff" data-testid="agent-access-panel">
    <div class="heading"><h2>Agentenzugriff</h2><button class="sd-icon-btn" aria-label="Agentenzugriff schließen" @click="emit('close')">×</button></div>
    <div class="panel-body">
      <p class="intro">Verbinde einen lokalen KI-Agenten mit diesem geöffneten Dokument. Du entscheidest, was er darf.</p>
      <p v-if="store.state.collaboration" class="desktop-note">Für ein Gastdokument ist lokaler Agentenzugriff gesperrt. Die Freigaben werden beim Gastgeber verwaltet.</p>
      <p v-else-if="!available" class="desktop-note">Agentenzugriff ist in der Desktop-Anwendung verfügbar. Diese Browseransicht erteilt keine Freigaben.</p>
      <template v-else>
        <p v-if="!ready && !error" role="status">Lokale Verbindung wird vorbereitet …</p>
        <form @submit.prevent="createGrant">
          <fieldset :disabled="!ready || busy || store.state.transitioning">
            <legend>Neue Freigabe</legend>
            <label class="sd-field-label" for="agent-label">Name des Agenten <span>(optional)</span></label><input id="agent-label" v-model="label" class="sd-input" placeholder="z. B. Claude Code" maxlength="80" autocomplete="off" />
            <label class="permission"><input v-model="permission" type="radio" value="read" name="agent-permission" /><span><strong>Nur lesen</strong><small>Diagramm und Code verstehen und analysieren.</small></span></label>
            <label class="permission"><input v-model="permission" type="radio" value="write" name="agent-permission" /><span><strong>Lesen und bearbeiten</strong><small>Der Agent darf Elemente und Code ändern. Änderungen bleiben zunächst ungespeichert.</small></span></label>
            <button class="sd-btn sd-btn--primary full" type="submit">Freigabe erstellen</button>
          </fieldset>
        </form>
        <div class="list-heading"><h3>Freigaben für dieses Dokument</h3><button class="sd-btn" :disabled="!ready || busy" @click="refresh">Aktualisieren</button></div>
        <p v-if="ready && !grants.length" class="empty">Noch keine Freigaben. Standardmäßig hat kein Agent Zugriff.</p>
        <ul class="grant-list"><li v-for="grant in grants" :key="grant.grantId" :data-grant-id="grant.grantId"><div class="grant-heading"><strong>{{ grant.label || 'Lokaler Agent' }}</strong><span>{{ grant.permission === 'write' ? 'Lesen & bearbeiten' : 'Nur lesen' }}</span></div><p>{{ pendingRevocations.includes(grant.grantId) ? 'Lokal gesperrt · Bestätigung ausstehend' : grant.revoked || !grant.active ? 'Widerrufen' : 'Aktiv' }}</p><div class="grant-actions"><button v-if="configurations.has(grant.grantId) && grant.active && !grant.revoked" class="sd-btn" :disabled="busy" @click="shownGrant = shownGrant === grant.grantId ? null : grant.grantId">{{ shownGrant === grant.grantId ? 'Konfiguration verbergen' : 'Konfiguration anzeigen' }}</button><button v-if="grant.active && !grant.revoked || pendingRevocations.includes(grant.grantId)" class="sd-btn sd-btn--danger" :disabled="busy" @click="revoke(grant.grantId)">Widerrufen</button></div></li></ul>
        <section v-if="configuration" class="configuration" aria-label="Lokale Client-Konfiguration"><h3>Client-Konfiguration</h3><p>Enthält den Zugangsschlüssel für diese Freigabe. Füge sie nur in die Konfiguration des gewünschten lokalen Agenten ein.</p><textarea ref="configField" :value="configuration" readonly spellcheck="false" class="sd-textarea" aria-label="MCP-Client-Konfiguration" data-testid="agent-configuration" /><button class="sd-btn full" @click="copyConfiguration">Konfiguration kopieren</button></section>
        <p class="scope-note">Freigaben gelten nur für diese Öffnung des Dokuments. Beim Dokumentwechsel werden sie beendet.</p>
      </template>
      <p v-if="error" class="error" role="alert">{{ error }}</p><button v-if="available && error && !ready" class="sd-btn full" @click="attach(store.getAuthority())">Verbindung erneut aufbauen</button><p v-if="status" class="status" role="status">{{ status }}</p>
    </div>
  </aside>
</template>

<style scoped>
.agent-panel{position:absolute;right:12px;top:96px;bottom:72px;width:360px;z-index:8;display:flex;flex-direction:column;overflow:hidden}.heading{padding:8px 12px;display:flex;align-items:center;justify-content:space-between;border-bottom:1px solid var(--border-subtle)}h2{font-size:13px;font-weight:650}.panel-body{overflow:auto;padding:16px;flex:1}.intro,.desktop-note,.scope-note,.empty{font-size:12px;line-height:1.7;color:var(--text-muted)}.intro{margin-bottom:16px}.desktop-note{background:var(--surface-raised);padding:12px;border-radius:6px}fieldset{border:0;padding:0;margin:0}legend{font-size:12px;font-weight:650;margin-bottom:12px}.sd-field-label span{font-weight:400}.permission{display:flex;gap:9px;align-items:flex-start;margin:12px 0;cursor:pointer}.permission input{margin-top:4px;accent-color:var(--accent)}.permission strong{font-size:12px;display:block}.permission small{font-size:11px;color:var(--text-muted);display:block;line-height:1.6}.full{width:100%}.list-heading{display:flex;align-items:center;justify-content:space-between;gap:8px;margin:22px 0 12px}h3{font-size:12px}.list-heading button{font-size:10px;padding:0 7px}.grant-list li{padding:12px 0;border-top:1px solid var(--border-subtle)}.grant-heading{display:flex;align-items:center;justify-content:space-between;gap:8px}.grant-heading strong{font-size:12px;overflow-wrap:anywhere}.grant-heading span,.grant-list p{font-size:10px;color:var(--text-muted)}.grant-list p{margin:5px 0 8px}.grant-actions{display:flex;gap:6px;flex-wrap:wrap}.grant-actions button{font-size:11px;padding:0 8px}.configuration{border:1px solid var(--border-default);border-radius:6px;padding:12px;margin-top:12px}.configuration p{font-size:11px;line-height:1.6;color:var(--text-muted);margin:8px 0}.configuration textarea{font:10px/1.5 var(--font-mono);height:180px;resize:vertical;white-space:pre;margin-bottom:8px}.scope-note{margin-top:18px}.error,.status{font-size:12px;line-height:1.6;margin-top:14px}.error{color:var(--status-error)}@media(max-width:860px){.agent-panel{top:188px;width:min(360px,calc(100vw - 24px));bottom:72px}}
</style>

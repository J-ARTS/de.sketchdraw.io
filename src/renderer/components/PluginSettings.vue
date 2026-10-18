<script setup lang="ts">
import { t, tm } from '@/renderer/i18n';
import { computed, nextTick, onBeforeUnmount, ref, watch } from 'vue';
import type { ConfigureAtlassianPluginInput, ConfigureGitPluginInput } from '@/domain';
import { wrapTabFocus } from '@/renderer/lib/focus';
import AppIcon from './AppIcon.vue';
import { useWhiteboard } from './use-whiteboard';

const props = defineProps<{ open: boolean }>();
const emit = defineEmits<{ close: [] }>();
const store = useWhiteboard(); const s = store.state;
const git = ref<ConfigureGitPluginInput>({ enabled: false, autoCommit: true, autoPush: false, autoPull: true, remote: 'origin' });
const atlassian = ref<ConfigureAtlassianPluginInput>({ enabled: false, siteUrl: '', email: '', apiToken: '', confluenceSpaceKey: '', jiraProjectKey: '', jiraIssueType: 'Task' });
const confluenceQuery = ref('');
const closeButton = ref<HTMLButtonElement | null>(null);
const dialog = ref<HTMLDialogElement | null>(null);
let opener: HTMLElement | null = null;
const linkedPages = computed(() => s.document.elements.filter((element) => element.kind === 'annotation' && element.metadata?.['sketchdraw.atlassian.pageId']));

watch(() => s.pluginSettings, (settings) => {
  if (!settings) return;
  git.value = { enabled: settings.git.enabled, autoCommit: settings.git.autoCommit, autoPush: settings.git.autoPush, autoPull: settings.git.autoPull, remote: settings.git.remote };
  atlassian.value = { enabled: settings.atlassian.enabled, siteUrl: settings.atlassian.siteUrl, email: settings.atlassian.email, apiToken: '', confluenceSpaceKey: settings.atlassian.confluenceSpaceKey, jiraProjectKey: settings.atlassian.jiraProjectKey, jiraIssueType: settings.atlassian.jiraIssueType };
}, { immediate: true });

/** A native modal dialog keeps focus inside, makes the workspace inert and closes on Escape (#79). */
watch(() => props.open, async (open) => {
  await nextTick();
  if (open) {
    opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    if (!dialog.value?.open) dialog.value?.showModal();
    closeButton.value?.focus();
    void store.refreshPluginSettings();
  } else {
    dialog.value?.close();
    if (opener?.isConnected) opener.focus();
    opener = null;
  }
}, { immediate: true });
onBeforeUnmount(() => dialog.value?.close());
async function searchPages(): Promise<void> { await store.searchConfluencePages(confluenceQuery.value); }
</script>

<template>
  <dialog ref="dialog" class="plugin-dialog" aria-labelledby="plugin-title" @cancel.prevent="emit('close')" @pointerdown.self="emit('close')" @keydown.stop="dialog && wrapTabFocus($event, dialog)">
    <div class="plugin-panel sd-panel">
      <header class="panel-head"><div><span class="eyebrow">DESKTOP-INTEGRATIONEN</span><h1 id="plugin-title" class="sd-panel-title">{{ t('Plugins') }}</h1></div><button ref="closeButton" class="sd-icon-btn sd-panel-close" type="button" :aria-label="t('Plugin-Einstellungen schließen')" @click="emit('close')"><AppIcon name="close" /></button></header>
      <p v-if="!s.pluginSettings?.available" class="desktop-note" role="status">{{ t('Git und Atlassian sind in der Electron-Desktop-App verfügbar. Die Browser-Version speichert keine Systemzugänge.') }}</p>

      <section class="plugin-card" :data-health="s.pluginSettings?.git.health ?? 'disabled'">
        <header><div class="plugin-mark git-mark" aria-hidden="true">⑂</div><div><h2>Git</h2><p>{{ tm(s.pluginSettings?.git.message ?? '') }}</p></div><label class="switch"><input v-model="git.enabled" type="checkbox" :disabled="!s.pluginSettings?.available" /><span>{{ t('Aktiv') }}</span></label></header>
        <div class="form-grid">
          <label>{{ t('Remote') }}<input v-model="git.remote" maxlength="128" autocomplete="off" /></label>
          <label class="check"><input v-model="git.autoCommit" type="checkbox" /> {{ t('Dokument nach dem Speichern committen') }}</label>
          <label class="check"><input v-model="git.autoPull" type="checkbox" /> {{ t('Änderungen automatisch abrufen') }}</label>
          <label class="check"><input v-model="git.autoPush" type="checkbox" /> {{ t('Erfolgreiche Commits pushen') }}</label>
        </div>
        <dl v-if="s.pluginSettings?.git.repositoryName" class="status-grid"><div><dt>{{ t('Repository') }}</dt><dd>{{ s.pluginSettings.git.repositoryName }}</dd></div><div><dt>{{ t('Branch') }}</dt><dd>{{ s.pluginSettings.git.branch }}</dd></div><div><dt>{{ t('Änderungen') }}</dt><dd>{{ s.pluginSettings.git.changedFiles ?? 0 }}</dd></div><div><dt>{{ t('Remote') }}</dt><dd>↑ {{ s.pluginSettings.git.ahead ?? 0 }} · ↓ {{ s.pluginSettings.git.behind ?? 0 }}</dd></div></dl>
        <div v-if="s.pendingExternalDocument" class="conflict" role="alert"><strong>{{ t('Externe Änderung wartet') }}</strong><span>{{ t('Lokale Entwürfe wurden nicht überschrieben.') }}</span><button class="sd-btn" :disabled="s.saveStatus === 'dirty'" @click="store.acceptExternalDocument()">{{ t('Externe Version laden') }}</button></div>
        <footer><button class="sd-btn" :disabled="s.pluginBusy || !s.file.handle" @click="store.refreshGitStatus()">{{ t('Status prüfen') }}</button><button class="sd-btn" :disabled="s.pluginBusy || !s.file.handle" @click="store.syncGit()">{{ t('Jetzt synchronisieren') }}</button><button class="sd-btn sd-btn--primary" :disabled="s.pluginBusy || !s.pluginSettings?.available" @click="store.configureGitPlugin(git)">{{ t('Speichern') }}</button></footer>
      </section>

      <section class="plugin-card" :data-health="s.pluginSettings?.atlassian.health ?? 'disabled'">
        <header><div class="plugin-mark atlas-mark" aria-hidden="true">A</div><div><h2>{{ t('Atlassian') }}</h2><p>{{ tm(s.pluginSettings?.atlassian.message ?? '') }}</p></div><label class="switch"><input v-model="atlassian.enabled" type="checkbox" :disabled="!s.pluginSettings?.available" /><span>{{ t('Aktiv') }}</span></label></header>
        <div class="form-grid two">
          <label class="wide">{{ t('Atlassian-URL') }}<input v-model="atlassian.siteUrl" type="url" placeholder="https://example.atlassian.net" autocomplete="url" /></label>
          <label>{{ t('E-Mail') }}<input v-model="atlassian.email" type="email" autocomplete="username" /></label>
          <label>{{ t('API-Token') }}<input v-model="atlassian.apiToken" type="password" :placeholder="s.pluginSettings?.atlassian.credentialStored ? t('Gespeichert – leer lassen zum Behalten') : t('API-Token')" autocomplete="new-password" /></label>
          <label>{{ t('Confluence-Space') }}<input v-model="atlassian.confluenceSpaceKey" placeholder="SPACE" autocomplete="off" /></label>
          <label>{{ t('Jira-Projekt') }}<input v-model="atlassian.jiraProjectKey" placeholder="PROJ" autocomplete="off" /></label>
          <label>{{ t('Jira-Vorgangstyp') }}<input v-model="atlassian.jiraIssueType" :placeholder="t('Task')" autocomplete="off" /></label>
        </div>
        <p class="security-copy">{{ t('Das Token wird verschlüsselt im Betriebssystemspeicher der Desktop-App abgelegt. Es wird nicht in Diagramme, Git oder die Oberfläche zurückgegeben.') }}</p>
        <footer><button class="sd-btn" :disabled="s.pluginBusy || !s.pluginSettings?.atlassian.credentialStored" @click="store.testAtlassianPlugin()">{{ t('Verbindung testen') }}</button><button class="sd-btn" :disabled="s.pluginBusy || !s.pluginSettings?.atlassian.enabled" @click="store.syncJiraTasks()">{{ t('Jira-Board synchronisieren') }}</button><button class="sd-btn sd-btn--primary" :disabled="s.pluginBusy || !s.pluginSettings?.available" @click="store.configureAtlassianPlugin(atlassian)">{{ t('Speichern') }}</button></footer>

        <div class="integration-section"><h3>{{ t('Confluence Live Docs') }}</h3><form class="search-row" @submit.prevent="searchPages"><input v-model="confluenceQuery" type="search" :placeholder="t('Seiten suchen')" :aria-label="t('Confluence-Seiten suchen')" /><button class="sd-btn" :disabled="s.pluginBusy || !s.pluginSettings?.atlassian.enabled">{{ t('Suchen') }}</button></form>
          <ul v-if="s.confluencePages.length" class="result-list"><li v-for="page in s.confluencePages" :key="page.id"><div><strong>{{ page.title }}</strong><span>{{ t('Version {version}', { version: page.version }) }}</span></div><button class="sd-btn" @click="store.insertConfluencePage(page.id)">{{ t('Einbinden') }}</button></li></ul>
          <p v-else class="empty">{{ t('Suche nach Seiten, um sie als editierbare Annotation einzubinden.') }}</p>
        </div>
        <div v-if="linkedPages.length" class="integration-section"><h3>{{ t('Verknüpfte Seiten') }}</h3><ul class="result-list"><li v-for="element in linkedPages" :key="element.id"><div><strong>{{ element.label || t('Confluence-Seite') }}</strong><span>{{ t('Version {version}', { version: String(element.metadata?.['sketchdraw.atlassian.pageVersion'] ?? '') }) }}</span></div><span class="row-actions"><button class="sd-btn" @click="store.refreshConfluenceElement(element.id)">{{ t('Neu laden') }}</button><button class="sd-btn" @click="store.syncConfluenceElement(element.id)">{{ t('Senden') }}</button></span></li></ul></div>
      </section>
    </div>
  </dialog>
</template>

<style scoped>
.plugin-dialog{width:min(620px,100vw);max-width:100vw;height:100%;max-height:100%;margin:0 0 0 auto;padding:0;border:0;background:transparent;color:var(--text-primary);overflow:visible}.plugin-dialog::backdrop{background:var(--scrim)}.plugin-panel{width:100%;height:100%;overflow:auto;padding:24px;border-radius:0;border-block:0;border-right:0}.panel-head,.plugin-card>header,.plugin-card>footer,.search-row,.result-list li{display:flex;align-items:center}.panel-head{justify-content:space-between;margin-bottom:18px}.eyebrow{font-size:10px;font-weight:750;letter-spacing:.14em;color:var(--accent)}.panel-head h1{margin:4px 0 0}.desktop-note,.plugin-card,.conflict{padding:16px;border:1px solid var(--border-subtle);border-radius:16px;background:var(--surface-panel)}.desktop-note{margin-bottom:14px;color:var(--text-muted)}.plugin-card{margin-top:14px}.plugin-card>header{gap:12px}.plugin-card>header>div:nth-child(2){min-width:0;flex:1}.plugin-card h2,.plugin-card h3{margin:0}.plugin-card header p{margin:3px 0 0;color:var(--text-muted);font-size:12px}.plugin-mark{display:grid;place-items:center;width:42px;height:42px;border-radius:12px;font-weight:800}.git-mark{background:#f05032;color:white}.atlas-mark{background:#1868db;color:white}.switch{display:flex;align-items:center;gap:6px;font-size:12px}.form-grid{display:grid;gap:12px;margin-top:16px}.form-grid.two{grid-template-columns:1fr 1fr}.form-grid label{display:grid;gap:6px;color:var(--text-muted);font-size:12px}.form-grid label.wide{grid-column:1/-1}.form-grid label.check{display:flex;align-items:center}.form-grid input,.search-row input{min-height:40px;padding:8px 10px;border:1px solid var(--border-subtle);border-radius:9px;background:var(--surface-raised);color:var(--text-primary)}.status-grid{display:grid;grid-template-columns:repeat(4,1fr);gap:8px;margin:14px 0 0}.status-grid div{padding:9px;border-radius:9px;background:var(--surface-raised)}dt{font-size:10px;color:var(--text-muted)}dd{margin:3px 0 0;font-size:12px;font-weight:650}.plugin-card>footer{justify-content:flex-end;gap:8px;margin-top:16px}.security-copy,.empty{color:var(--text-muted);font-size:12px;line-height:1.5}.conflict{display:grid;gap:5px;margin-top:14px;border-color:var(--status-error)}.conflict button{justify-self:start}.integration-section{margin-top:20px;padding-top:16px;border-top:1px solid var(--border-subtle)}.integration-section h3{margin-bottom:10px}.search-row{gap:8px}.search-row input{min-width:0;flex:1}.result-list{display:grid;gap:7px;margin:10px 0 0;padding:0;list-style:none}.result-list li{justify-content:space-between;gap:12px;padding:9px;border-radius:10px;background:var(--surface-raised)}.result-list li div{display:grid}.result-list span{font-size:11px;color:var(--text-muted)}@media(max-width:620px){.form-grid.two,.status-grid{grid-template-columns:1fr}.form-grid label.wide{grid-column:auto}.plugin-panel{padding:16px}.plugin-card>header{align-items:flex-start;flex-wrap:wrap}}
.row-actions{display:flex;gap:6px}
</style>

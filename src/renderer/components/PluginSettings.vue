<script setup lang="ts">
import { t, tm } from '@/renderer/i18n';
import { computed, nextTick, onBeforeUnmount, ref, watch } from 'vue';
import { PLUGIN_PROFILE_LIMIT, PLUGIN_PROFILE_NAME_MAX, type ConfigureAtlassianPluginInput, type ConfigureGitPluginInput, type PluginId } from '@/domain';
import { wrapTabFocus } from '@/renderer/lib/focus';
import { pluginLogoUrl } from '@/renderer/lib/plugin-logos';
import AppIcon from './AppIcon.vue';
import AppSelect from './AppSelect.vue';
import { useWhiteboard } from './use-whiteboard';

type PluginTab = 'marketplace' | 'installed';

const props = defineProps<{ open: boolean }>();
const emit = defineEmits<{ close: [] }>();
const store = useWhiteboard(); const s = store.state;
const activeTab = ref<PluginTab>('installed');
const selectedPlugin = ref<PluginId>('git');
const search = ref('');
const git = ref<ConfigureGitPluginInput>({ enabled: false, autoCommit: true, autoPush: false, autoPull: true, remote: 'origin', remoteUrl: '', authMode: 'system', username: '', accessToken: '' });
const atlassian = ref<ConfigureAtlassianPluginInput>({ enabled: false, siteUrl: '', email: '', apiToken: '', confluenceSpaceKey: '', jiraProjectKey: '', jiraIssueType: 'Task', jqlFilter: '' });
const confluenceQuery = ref('');
const closeButton = ref<HTMLButtonElement | null>(null);
const dialog = ref<HTMLDialogElement | null>(null);
let opener: HTMLElement | null = null;

const catalog = computed(() => [
  { id: 'git' as const, title: 'Git', category: t('Versionierung'), summary: t('Diagramme im Projektordner versionieren und automatisch synchronisieren.'), badge: 'G' },
  { id: 'jira' as const, title: 'Jira', category: t('Aufgaben & Dokumentation'), summary: t('Jira-Tickets laden, erstellen und mit dem Aufgabenboard synchronisieren.'), badge: 'J' },
]);
const installedIds = computed<PluginId[]>(() => {
  const ids: PluginId[] = [];
  if (s.pluginSettings?.git.installed) ids.push('git');
  if (s.pluginSettings?.atlassian.installed) ids.push('jira');
  return ids;
});
const visiblePlugins = computed(() => catalog.value.filter((plugin) => {
  if (activeTab.value === 'installed' && !installedIds.value.includes(plugin.id)) return false;
  const needle = search.value.trim().toLocaleLowerCase();
  return !needle || `${plugin.title} ${plugin.category} ${plugin.summary}`.toLocaleLowerCase().includes(needle);
}));
const selectedCatalogPlugin = computed(() => catalog.value.find((plugin) => plugin.id === selectedPlugin.value) ?? catalog.value[0]!);
const selectedInstalled = computed(() => installedIds.value.includes(selectedPlugin.value));
const linkedPages = computed(() => s.document.elements.filter((element) => element.kind === 'annotation' && element.metadata?.['sketchdraw.atlassian.pageId']));
/** Plugin settings belong to the active profile of the editor, so they can be edited without an open project (#168). */
const canConfigure = computed(() => Boolean(s.pluginSettings?.available));
const profiles = computed(() => s.pluginSettings?.profiles ?? []);
const activeProfile = computed(() => profiles.value.find((profile) => profile.id === s.pluginSettings?.activeProfileId) ?? null);
const profileOptions = computed(() => profiles.value.map((profile) => ({ value: profile.id, label: profile.name })));
const profileLimitReached = computed(() => profiles.value.length >= PLUGIN_PROFILE_LIMIT);
type ProfileForm = 'create' | 'copy' | 'rename';
const profileForm = ref<ProfileForm | null>(null);
const profileName = ref('');
const confirmProfileDelete = ref(false);
const profileNameInput = ref<HTMLInputElement | null>(null);

const pending = ref(false);
const feedback = ref<{ kind: 'info' | 'error'; text: string } | null>(null);
const gitBaseline = ref('');
const jiraBaseline = ref('');
const gitDirty = computed(() => JSON.stringify(git.value) !== gitBaseline.value);
const jiraDirty = computed(() => JSON.stringify(atlassian.value) !== jiraBaseline.value);
const busy = computed(() => pending.value || s.pluginBusy);
const controlsDisabled = computed(() => busy.value || !canConfigure.value);
let contextKey = '';
let operationEpoch = 0;
let pendingOperation = 0;
let dialogEpoch = 0;

function seedGit(): void {
  const settings = s.pluginSettings?.git;
  git.value = { enabled: settings?.enabled ?? false, autoCommit: settings?.autoCommit ?? true, autoPush: settings?.autoPush ?? false, autoPull: settings?.autoPull ?? true, remote: settings?.remote ?? 'origin', remoteUrl: settings?.remoteUrl ?? '', authMode: settings?.authMode ?? 'system', username: settings?.username ?? '', accessToken: '' };
  gitBaseline.value = JSON.stringify(git.value);
}
function seedJira(): void {
  const settings = s.pluginSettings?.atlassian;
  atlassian.value = { enabled: settings?.enabled ?? false, siteUrl: settings?.siteUrl ?? '', email: settings?.email ?? '', apiToken: '', confluenceSpaceKey: settings?.confluenceSpaceKey ?? '', jiraProjectKey: settings?.jiraProjectKey ?? '', jiraIssueType: settings?.jiraIssueType ?? 'Task', jqlFilter: settings?.jqlFilter ?? '' };
  jiraBaseline.value = JSON.stringify(atlassian.value);
}
watch(() => s.pluginSettings, (settings) => {
  const key = settings ? `${settings.available}:${settings.projectFolder}:${settings.activeProfileId}` : '';
  if (key !== contextKey) {
    contextKey = key; operationEpoch++; pendingOperation++; pending.value = false; feedback.value = null; confluenceQuery.value = ''; closeProfileForm();
    seedGit(); seedJira();
  } else {
    // Health refreshes must not replace either unsaved draft.
    if (!gitDirty.value) seedGit();
    if (!jiraDirty.value) seedJira();
  }
}, { immediate: true });

watch(activeTab, (tab) => {
  search.value = '';
  if (tab === 'installed' && !installedIds.value.includes(selectedPlugin.value) && installedIds.value[0]) selectedPlugin.value = installedIds.value[0];
});
watch(visiblePlugins, (plugins) => {
  if (plugins.length && !plugins.some(plugin => plugin.id === selectedPlugin.value)) selectedPlugin.value = plugins[0]!.id;
});

/** The native modal keeps focus inside and makes the workspace inert. */
watch(() => props.open, async (open) => {
  operationEpoch++; dialogEpoch++; pendingOperation++; pending.value = false; feedback.value = null; closeProfileForm(); seedGit(); seedJira();
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
onBeforeUnmount(() => { operationEpoch++; dialogEpoch++; dialog.value?.close(); });

function isInstalled(id: PluginId): boolean { return installedIds.value.includes(id); }
function selectPlugin(id: PluginId): void { selectedPlugin.value = id; }
function tabKeydown(event: KeyboardEvent): void {
  if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
  event.preventDefault();
  activeTab.value = event.key === 'Home' ? 'marketplace' : event.key === 'End' ? 'installed' : activeTab.value === 'installed' ? 'marketplace' : 'installed';
  void nextTick(() => dialog.value?.querySelector<HTMLButtonElement>(`#plugin-tab-${activeTab.value}`)?.focus());
}
function focusDetail(): void { void nextTick(() => dialog.value?.querySelector<HTMLElement>('.plugin-detail h2')?.focus()); }
function configureSelected(): void { activeTab.value = 'installed'; focusDetail(); }
async function runOperation(action: () => Promise<unknown>, success: string): Promise<boolean> {
  if (busy.value || !canConfigure.value) return false;
  const epoch = operationEpoch; const request = ++pendingOperation; const noticeId = s.notices.at(-1)?.id;
  pending.value = true; feedback.value = null;
  try {
    const result = await action();
    if (epoch !== operationEpoch || !props.open) return false;
    const notice = s.notices.at(-1);
    feedback.value = notice && notice.id !== noticeId ? { kind: notice.kind, text: notice.text } : { kind: result === false ? 'error' : 'info', text: result === false ? t('Die Aktion konnte nicht abgeschlossen werden.') : success };
    return result !== false && feedback.value.kind !== 'error';
  } catch (error) {
    if (epoch === operationEpoch && props.open) feedback.value = { kind: 'error', text: tm(error instanceof Error ? error.message : t('Die Aktion konnte nicht abgeschlossen werden.')) };
    return false;
  } finally { if (request === pendingOperation) pending.value = false; }
}
async function saveProject(): Promise<void> {
  if (busy.value || !s.pluginSettings?.available) return;
  const request = ++pendingOperation; const opened = dialogEpoch;
  const documentId = s.document.id; const noticeId = s.notices.at(-1)?.id;
  const isCurrent = () => props.open && opened === dialogEpoch && documentId === s.document.id;
  pending.value = true; feedback.value = null;
  try {
    await store.save();
    if (!isCurrent()) return;
    if (s.dialog) { emit('close'); return; }
    const notice = s.notices.at(-1);
    // Draft validation can stop saving before persistence sets file.lastError.
    if (notice?.kind === 'error' && notice.id !== noticeId) {
      feedback.value = { kind: 'error', text: notice.text }; return;
    }
    await store.refreshPluginSettings();
    if (!isCurrent()) return;
    feedback.value = s.pluginSettings?.projectFolder
      ? { kind: 'info', text: t('Diagramm gespeichert. Git arbeitet jetzt in diesem Ordner.') }
      : { kind: s.file.lastError ? 'error' : 'info', text: s.file.lastError ? tm(s.file.lastError) : s.file.handle ? t('Öffne die gespeicherte Kopie lokal, um Git in ihrem Ordner zu nutzen.') : t('Speichern abgebrochen. Git braucht einen Ordner für das Diagramm.') };
  } catch (error) {
    if (isCurrent()) feedback.value = { kind: 'error', text: tm(error instanceof Error ? error.message : t('Die Aktion konnte nicht abgeschlossen werden.')) };
  } finally { if (request === pendingOperation) pending.value = false; }
}
async function saveGit(): Promise<void> { if (await runOperation(() => store.configureGitPlugin(git.value), t('Git-Plugin gespeichert.'))) seedGit(); }
async function saveJira(): Promise<void> { if (await runOperation(() => store.configureAtlassianPlugin(atlassian.value), t('Atlassian-Plugin gespeichert.'))) seedJira(); }
async function installPlugin(id: PluginId): Promise<void> {
  if (await runOperation(() => store.setPluginInstalled(id, true), t('Installiert'))) { selectedPlugin.value = id; activeTab.value = 'installed'; focusDetail(); }
}
async function uninstallPlugin(id: PluginId): Promise<void> {
  if (await runOperation(() => store.setPluginInstalled(id, false), t('Deinstallieren'))) { activeTab.value = 'marketplace'; selectedPlugin.value = id; id === 'git' ? seedGit() : seedJira(); focusDetail(); }
}
function closeProfileForm(): void { profileForm.value = null; confirmProfileDelete.value = false; profileName.value = ''; }
function focusProfileBar(): void { void nextTick(() => dialog.value?.querySelector<HTMLElement>('.profile-bar [role=combobox], .profile-bar button')?.focus()); }
function openProfileForm(kind: ProfileForm): void {
  if (busy.value || !activeProfile.value) return;
  confirmProfileDelete.value = false; feedback.value = null;
  profileName.value = kind === 'rename' ? activeProfile.value.name : kind === 'copy' ? t('{name} (Kopie)', { name: activeProfile.value.name }).slice(0, PLUGIN_PROFILE_NAME_MAX) : '';
  profileForm.value = kind;
  void nextTick(() => { profileNameInput.value?.focus(); profileNameInput.value?.select(); });
}
function cancelProfileForm(): void { closeProfileForm(); focusProfileBar(); }
/**
 * A profile change replaces the settings this dialog shows, which resets the forms and any older feedback. Its own
 * result is therefore reported after that reset instead of being dropped with it.
 */
async function runProfileOperation(action: () => Promise<boolean>, success: string): Promise<boolean> {
  if (busy.value || !canConfigure.value) return false;
  const opened = dialogEpoch; const noticeId = s.notices.at(-1)?.id;
  pending.value = true; feedback.value = null;
  try {
    const done = await action();
    await nextTick();
    if (opened !== dialogEpoch || !props.open) return false;
    const notice = s.notices.at(-1);
    feedback.value = notice && notice.id !== noticeId ? { kind: notice.kind, text: notice.text } : { kind: done ? 'info' : 'error', text: done ? success : t('Die Aktion konnte nicht abgeschlossen werden.') };
    return done && feedback.value.kind !== 'error';
  } catch (error) {
    if (opened === dialogEpoch && props.open) feedback.value = { kind: 'error', text: tm(error instanceof Error ? error.message : t('Die Aktion konnte nicht abgeschlossen werden.')) };
    return false;
  } finally { pending.value = false; }
}
async function submitProfileForm(): Promise<void> {
  const kind = profileForm.value; const current = activeProfile.value; const name = profileName.value.trim();
  if (!kind || !current || !name) return;
  const done = await runProfileOperation(
    () => kind === 'rename' ? store.renamePluginProfile(current.id, name) : store.createPluginProfile(name, kind === 'copy' ? current.id : undefined),
    kind === 'rename' ? t('Profil umbenannt.') : kind === 'copy' ? t('Profil „{name}“ kopiert.', { name }) : t('Profil „{name}“ angelegt.', { name }),
  );
  if (done) { closeProfileForm(); focusProfileBar(); }
}
async function switchProfile(id: string): Promise<void> {
  if (id === s.pluginSettings?.activeProfileId) return;
  await runProfileOperation(() => store.selectPluginProfile(id), t('Profil gewechselt.'));
}
async function deleteProfile(): Promise<void> {
  const current = activeProfile.value;
  if (!current) return;
  await runProfileOperation(() => store.deletePluginProfile(current.id), t('Profil gelöscht.'));
  closeProfileForm(); focusProfileBar();
}
async function searchPages(): Promise<void> { await runOperation(() => store.searchConfluencePages(confluenceQuery.value), t('Suche abgeschlossen.')); }
</script>

<template>
  <dialog ref="dialog" class="plugin-dialog" aria-labelledby="plugin-title" @cancel.prevent="emit('close')" @pointerdown.self="emit('close')" @keydown.stop="dialog && wrapTabFocus($event, dialog)">
    <div class="plugin-shell sd-panel">
      <header class="plugin-header">
        <div class="heading-block">
          <span class="eyebrow">{{ t('INTEGRATIONEN') }}</span>
          <h1 id="plugin-title" class="sd-panel-title">{{ t('Plugins') }}</h1>
        </div>
        <nav class="plugin-tabs" role="tablist" @keydown="tabKeydown" :aria-label="t('Plugin-Bereiche')">
          <button id="plugin-tab-marketplace" type="button" role="tab" :aria-controls="activeTab === 'marketplace' ? 'plugin-panel-marketplace' : undefined" :aria-selected="activeTab === 'marketplace'" :tabindex="activeTab === 'marketplace' ? 0 : -1" @click="activeTab = 'marketplace'">{{ t('Marketplace') }}</button>
          <button id="plugin-tab-installed" type="button" role="tab" :aria-controls="activeTab === 'installed' ? 'plugin-panel-installed' : undefined" :aria-selected="activeTab === 'installed'" :tabindex="activeTab === 'installed' ? 0 : -1" @click="activeTab = 'installed'">{{ t('Installiert') }} <span class="tab-count">{{ installedIds.length }}</span></button>
        </nav>
        <button ref="closeButton" class="sd-icon-btn sd-panel-close" type="button" :aria-label="t('Plugin-Einstellungen schließen')" @click="emit('close')"><AppIcon name="close" /></button>
      </header>

      <div v-if="!s.pluginSettings" class="context-note" role="status">{{ t('Plugin-Einstellungen werden geladen…') }}</div>
      <div v-else-if="!s.pluginSettings.available" class="context-note" role="status"><AppIcon name="info" /><span>{{ t('Plugins können in der Electron-Desktop-App installiert und konfiguriert werden.') }}</span></div>
      <template v-else>
        <section class="profile-bar" :aria-label="t('Plugin-Profil')" data-testid="plugin-profiles">
          <template v-if="profileForm">
            <label class="profile-name"><span>{{ profileForm === 'rename' ? t('Neuer Name für „{name}“', { name: activeProfile?.name ?? '' }) : profileForm === 'copy' ? t('Name der Kopie von „{name}“', { name: activeProfile?.name ?? '' }) : t('Name des neuen Profils') }}</span><input ref="profileNameInput" v-model="profileName" data-testid="plugin-profile-name" :maxlength="PLUGIN_PROFILE_NAME_MAX" autocomplete="off" spellcheck="false" :disabled="busy" @keydown.enter.prevent="submitProfileForm" @keydown.esc.stop.prevent="cancelProfileForm" /></label>
            <button class="sd-btn sd-btn--primary" type="button" :disabled="busy || !profileName.trim()" @click="submitProfileForm">{{ profileForm === 'rename' ? t('Umbenennen') : profileForm === 'copy' ? t('Kopie anlegen') : t('Profil anlegen') }}</button>
            <button class="sd-btn" type="button" :disabled="busy" @click="cancelProfileForm">{{ t('Abbrechen') }}</button>
          </template>
          <template v-else-if="confirmProfileDelete">
            <p class="profile-confirm" role="alert">{{ t('Profil „{name}“ mit seinen Plugin-Einstellungen und Tokens löschen?', { name: activeProfile?.name ?? '' }) }}</p>
            <button class="sd-btn danger" type="button" data-testid="plugin-profile-delete-confirm" :disabled="busy" @click="deleteProfile">{{ t('Profil löschen') }}</button>
            <button class="sd-btn" type="button" :disabled="busy" @click="cancelProfileForm">{{ t('Abbrechen') }}</button>
          </template>
          <template v-else>
            <AppSelect class="profile-select" :label="t('Profil')" :model-value="s.pluginSettings.activeProfileId" :options="profileOptions" :disabled="busy" @update:model-value="switchProfile($event)" />
            <div class="profile-actions">
              <button class="sd-btn" type="button" data-testid="plugin-profile-create" :disabled="busy || profileLimitReached" :title="profileLimitReached ? t('Es sind höchstens zwölf Profile möglich.') : undefined" @click="openProfileForm('create')">{{ t('Neues Profil') }}</button>
              <button class="sd-btn" type="button" data-testid="plugin-profile-copy" :disabled="busy || profileLimitReached" :title="profileLimitReached ? t('Es sind höchstens zwölf Profile möglich.') : undefined" @click="openProfileForm('copy')">{{ t('Kopieren') }}</button>
              <button class="sd-btn" type="button" data-testid="plugin-profile-rename" :disabled="busy" @click="openProfileForm('rename')">{{ t('Umbenennen') }}</button>
              <button class="sd-btn" type="button" data-testid="plugin-profile-delete" :disabled="busy || profiles.length < 2" :title="profiles.length < 2 ? t('Das letzte Profil kann nicht gelöscht werden.') : undefined" @click="confirmProfileDelete = true">{{ t('Löschen') }}</button>
            </div>
          </template>
        </section>
        <div v-if="!s.pluginSettings.projectFolder" class="context-note" role="status"><AppIcon name="folder-open" /><span>{{ t('Die Plugin-Einstellungen gehören zum Profil. Git arbeitet im Ordner des gespeicherten Diagramms – speichere es, um Git hier zu nutzen.') }}</span><button class="sd-btn sd-btn--primary" :disabled="busy" @click="saveProject">{{ t('Diagramm speichern') }}</button></div>
        <div v-else class="project-context" :title="s.pluginSettings.projectFolder"><AppIcon name="folder-open" /><span>{{ t('Projektordner') }}</span><strong>{{ s.pluginSettings.projectFolder }}</strong></div>
      </template>

      <div v-if="feedback" class="plugin-feedback" :class="{ error: feedback.kind === 'error' }" :role="feedback.kind === 'error' ? 'alert' : 'status'">{{ feedback.text }}</div>
      <div class="plugin-layout" :id="`plugin-panel-${activeTab}`" role="tabpanel" :aria-labelledby="`plugin-tab-${activeTab}`">
        <aside class="plugin-list" :aria-label="activeTab === 'marketplace' ? t('Marketplace-Plugins') : t('Installierte Plugins')">
          <label class="search-box"><AppIcon name="search" /><span class="sr-only">{{ t('Plugins suchen') }}</span><input v-model="search" type="search" :placeholder="t('Plugins suchen')" /></label>
          <p class="list-label">{{ activeTab === 'marketplace' ? t('Verfügbar') : t('Installiert') }}</p>
          <button v-for="plugin in visiblePlugins" :key="plugin.id" class="plugin-list-item" :class="{ selected: selectedPlugin === plugin.id }" type="button" :aria-current="selectedPlugin === plugin.id ? 'true' : undefined" @click="selectPlugin(plugin.id)">
            <span class="plugin-logo" aria-hidden="true"><img v-if="pluginLogoUrl(plugin.id)" :src="pluginLogoUrl(plugin.id)!" alt="" /><template v-else>{{ plugin.badge }}</template></span>
            <span class="plugin-list-copy"><strong>{{ plugin.title }}</strong><small>{{ plugin.category }}</small></span>
            <span v-if="isInstalled(plugin.id)" class="installed-check" :aria-label="t('Installiert')"><AppIcon name="check" /></span>
          </button>
          <div v-if="!visiblePlugins.length" class="empty-list"><AppIcon name="component" /><span>{{ activeTab === 'installed' ? t('In diesem Profil sind noch keine Plugins installiert.') : t('Keine passenden Plugins gefunden.') }}</span></div>
        </aside>

        <section class="plugin-detail" :aria-labelledby="`plugin-${selectedPlugin}-title`">
          <section v-if="search && !visiblePlugins.length" class="empty-detail"><h2 :id="`plugin-${selectedPlugin}-title`" tabindex="-1">{{ t('Keine passenden Plugins gefunden.') }}</h2></section>
          <template v-else-if="activeTab === 'marketplace'">
            <section class="overview-hero">
              <span class="plugin-logo plugin-logo--large" aria-hidden="true"><img v-if="pluginLogoUrl(selectedCatalogPlugin.id)" :src="pluginLogoUrl(selectedCatalogPlugin.id)!" alt="" /><template v-else>{{ selectedCatalogPlugin.badge }}</template></span>
              <div>
                <span class="category-pill">{{ selectedCatalogPlugin.category }}</span>
                <h2 :id="`plugin-${selectedPlugin}-title`" tabindex="-1">{{ selectedCatalogPlugin.title }}</h2>
                <p>{{ t('Von Sketchdraw') }}</p>
              </div>
              <button v-if="!selectedInstalled" class="sd-btn sd-btn--primary install-button" type="button" :disabled="s.pluginBusy || !canConfigure" @click="installPlugin(selectedPlugin)">{{ t('Installieren') }}</button>
              <button v-else class="sd-btn install-button" type="button" @click="configureSelected">{{ t('Konfigurieren') }}</button>
            </section>
            <div class="detail-tabs"><span>{{ t('Übersicht') }}</span></div>
            <section class="overview-content">
              <h3>{{ selectedCatalogPlugin.summary }}</h3>
              <template v-if="selectedPlugin === 'git'">
                <p>{{ t('Git Sync initialisiert den Ordner deines geöffneten Diagramms bei Bedarf als Repository. Die Konfiguration gehört zum aktiven Profil und gilt für jedes Diagramm, das du mit diesem Profil öffnest.') }}</p>
                <h4>{{ t('Funktionen') }}</h4>
                <ul><li>{{ t('Automatische Commits beim Speichern') }}</li><li>{{ t('Pull und Push über vorhandene Git-Credentials oder einen verschlüsselt gespeicherten Token') }}</li><li>{{ t('Externe Änderungen erkennen und kontrolliert neu laden') }}</li></ul>
              </template>
              <template v-else>
                <p>{{ t('Jira verbindet das Aufgabenboard mit einem frei definierbaren Jira-Filter. Neue Aufgaben werden im Jira-Projekt des aktiven Profils erstellt.') }}</p>
                <h4>{{ t('Funktionen') }}</h4>
                <ul><li>{{ t('Jira-Vorgänge per JQL laden') }}</li><li>{{ t('Aufgaben und Kommentare als Jira-Tickets erstellen') }}</li><li>{{ t('Statusänderungen zwischen Board und Jira synchronisieren') }}</li><li>{{ t('Confluence-Seiten optional als Live Docs einbinden') }}</li></ul>
              </template>
              <div class="security-panel"><AppIcon name="info" /><span>{{ t('Zugangstokens werden verschlüsselt im Profil auf diesem Gerät gespeichert und niemals an das Diagramm oder die Oberfläche zurückgegeben.') }}</span></div>
            </section>
          </template>

          <template v-else-if="selectedInstalled">
            <section class="config-head">
              <span class="plugin-logo" aria-hidden="true"><img v-if="pluginLogoUrl(selectedCatalogPlugin.id)" :src="pluginLogoUrl(selectedCatalogPlugin.id)!" alt="" /><template v-else>{{ selectedCatalogPlugin.badge }}</template></span>
              <div><h2 :id="`plugin-${selectedPlugin}-title`" tabindex="-1">{{ selectedCatalogPlugin.title }}</h2><p>{{ selectedPlugin === 'git' ? tm(s.pluginSettings?.git.message ?? '') : tm(s.pluginSettings?.atlassian.message ?? '') }}</p></div>
              <button class="text-button danger" type="button" :disabled="controlsDisabled" @click="uninstallPlugin(selectedPlugin)">{{ t('Deinstallieren') }}</button>
            </section>

            <fieldset class="config-fields" :disabled="controlsDisabled" :aria-label="t('Plugin-Konfiguration')">
            <section v-if="selectedPlugin === 'git'" class="config-content">
              <div class="section-title"><div><h3>{{ t('Git-Konfiguration') }}</h3><p>{{ t('Diese Einstellungen gehören zum Profil „{name}“. Git arbeitet im Ordner des geöffneten Diagramms.', { name: activeProfile?.name ?? '' }) }}</p></div><label class="switch"><input v-model="git.enabled" type="checkbox" /><span>{{ t('Aktiv') }}</span></label></div>
              <div class="form-grid two">
                <label class="wide">{{ t('Projektordner') }}<input :value="s.pluginSettings?.projectFolder" readonly :placeholder="t('Noch kein gespeichertes Diagramm')" /></label>
                <label>{{ t('Remote') }}<input v-model="git.remote" maxlength="128" autocomplete="off" placeholder="origin" /></label>
                <label>{{ t('Remote-URL') }}<input v-model="git.remoteUrl" autocomplete="url" placeholder="https://github.com/org/repo.git" /></label>
              </div>
              <fieldset class="auth-fieldset"><legend>{{ t('Anmeldung') }}</legend><div class="auth-options"><label :class="{ active: git.authMode === 'system' }"><input v-model="git.authMode" type="radio" value="system" /><strong>{{ t('Git-Credentials verwenden') }}</strong><span>{{ t('Nutzt die bereits auf dem System eingerichtete Git-Anmeldung.') }}</span></label><label :class="{ active: git.authMode === 'token' }"><input v-model="git.authMode" type="radio" value="token" /><strong>{{ t('Username und Token') }}</strong><span>{{ t('Speichert den Token verschlüsselt in diesem Profil.') }}</span></label></div></fieldset>
              <div v-if="git.authMode === 'token'" class="form-grid two"><label>{{ t('Username') }}<input v-model="git.username" autocomplete="username" /></label><label>{{ t('Access-Token') }}<input v-model="git.accessToken" type="password" :placeholder="s.pluginSettings?.git.credentialStored ? t('Gespeichert – leer lassen zum Behalten') : t('Access-Token')" autocomplete="new-password" /></label></div>
              <div class="option-list"><label><input v-model="git.autoCommit" type="checkbox" /> <span><strong>{{ t('Automatisch committen') }}</strong><small>{{ t('Das Diagramm nach jedem Speichern committen.') }}</small></span></label><label><input v-model="git.autoPull" type="checkbox" /> <span><strong>{{ t('Automatisch abrufen') }}</strong><small>{{ t('Änderungen vor dem Synchronisieren per Pull laden.') }}</small></span></label><label><input v-model="git.autoPush" type="checkbox" /> <span><strong>{{ t('Automatisch pushen') }}</strong><small>{{ t('Erfolgreiche Diagramm-Commits zum Remote übertragen.') }}</small></span></label></div>
              <dl v-if="s.pluginSettings?.git.repositoryName" class="status-grid"><div><dt>{{ t('Repository') }}</dt><dd>{{ s.pluginSettings.git.repositoryName }}</dd></div><div><dt>{{ t('Branch') }}</dt><dd>{{ s.pluginSettings.git.branch }}</dd></div><div><dt>{{ t('Änderungen') }}</dt><dd>{{ s.pluginSettings.git.changedFiles ?? 0 }}</dd></div><div><dt>{{ t('Remote') }}</dt><dd>↑ {{ s.pluginSettings.git.ahead ?? 0 }} · ↓ {{ s.pluginSettings.git.behind ?? 0 }}</dd></div></dl>
              <div v-if="s.pendingExternalDocument" class="conflict" role="alert"><strong>{{ t('Externe Änderung wartet') }}</strong><span>{{ t('Lokale Entwürfe wurden nicht überschrieben.') }}</span><button class="sd-btn" :disabled="s.saveStatus === 'dirty'" @click="store.acceptExternalDocument()">{{ t('Externe Version laden') }}</button></div>
              <p v-if="gitDirty" class="draft-hint">{{ t('Ungespeicherte Änderungen. Speichere vor dem Testen oder Synchronisieren.') }}</p><footer class="config-actions"><button class="sd-btn" :disabled="busy || !s.file.handle || !s.pluginSettings?.git.enabled || gitDirty" @click="runOperation(() => store.refreshGitStatus(), t('Status geprüft.'))">{{ t('Status prüfen') }}</button><button class="sd-btn" :disabled="busy || !s.file.handle || !s.pluginSettings?.git.enabled || gitDirty" @click="runOperation(() => store.syncGit(), t('Synchronisierung abgeschlossen.'))">{{ t('Jetzt synchronisieren') }}</button><button class="sd-btn sd-btn--primary" :disabled="s.pluginBusy" @click="saveGit">{{ t('Git speichern') }}</button></footer>
            </section>

            <section v-else class="config-content">
              <div class="section-title"><div><h3>{{ t('Jira-Konfiguration') }}</h3><p>{{ t('Diese Einstellungen gehören zum Profil „{name}“. Tickets werden im Jira-Projekt erstellt und über den JQL-Filter geladen.', { name: activeProfile?.name ?? '' }) }}</p></div><label class="switch"><input v-model="atlassian.enabled" type="checkbox" /><span>{{ t('Aktiv') }}</span></label></div>
              <div class="form-grid two">
                <label class="wide">{{ t('Atlassian-URL') }}<input v-model="atlassian.siteUrl" type="url" placeholder="https://example.atlassian.net" autocomplete="url" /></label>
                <label>{{ t('Username oder E-Mail') }}<input v-model="atlassian.email" autocomplete="username" /></label>
                <label>{{ t('API-Token') }}<input v-model="atlassian.apiToken" type="password" :placeholder="s.pluginSettings?.atlassian.credentialStored ? t('Gespeichert – leer lassen zum Behalten') : t('API-Token')" autocomplete="new-password" /></label>
                <label>{{ t('Jira-Projekt') }}<input v-model="atlassian.jiraProjectKey" placeholder="PROJ" autocomplete="off" /></label>
                <label>{{ t('Jira-Vorgangstyp') }}<input v-model="atlassian.jiraIssueType" :placeholder="t('Task')" autocomplete="off" /></label>
                <label class="wide">{{ t('JQL-Filter') }}<input v-model="atlassian.jqlFilter" :placeholder="t('z. B. project = PROJ AND assignee = currentUser()')" autocomplete="off" /></label>
                <label class="wide">{{ t('Confluence-Space (optional)') }}<input v-model="atlassian.confluenceSpaceKey" placeholder="SPACE" autocomplete="off" /></label>
              </div>
              <p class="security-copy">{{ t('Das Token wird verschlüsselt im Profil auf diesem Gerät abgelegt. Es wird nicht in Diagramme oder Git übernommen.') }}</p>
              <p v-if="jiraDirty" class="draft-hint">{{ t('Ungespeicherte Änderungen. Speichere vor dem Testen oder Synchronisieren.') }}</p><footer class="config-actions"><button class="sd-btn" :disabled="busy || !s.pluginSettings?.atlassian.enabled || !s.pluginSettings?.atlassian.credentialStored || jiraDirty" @click="runOperation(() => store.testAtlassianPlugin(), t('Verbindung getestet.'))">{{ t('Verbindung testen') }}</button><button class="sd-btn" :disabled="busy || !s.pluginSettings?.atlassian.enabled || jiraDirty" @click="runOperation(() => store.syncJiraTasks(), t('Synchronisierung abgeschlossen.'))">{{ t('Jira-Board synchronisieren') }}</button><button class="sd-btn sd-btn--primary" :disabled="s.pluginBusy" @click="saveJira">{{ t('Jira speichern') }}</button></footer>

              <div class="integration-section"><h3>{{ t('Confluence Live Docs') }}</h3><form class="search-row" @submit.prevent="searchPages"><input v-model="confluenceQuery" type="search" :placeholder="t('Seiten suchen')" :aria-label="t('Confluence-Seiten suchen')" /><button class="sd-btn" :disabled="busy || !s.pluginSettings?.atlassian.enabled || jiraDirty">{{ t('Suchen') }}</button></form>
                <ul v-if="s.confluencePages.length" class="result-list"><li v-for="page in s.confluencePages" :key="page.id"><div><strong>{{ page.title }}</strong><span>{{ t('Version {version}', { version: page.version }) }}</span></div><button class="sd-btn" @click="runOperation(() => store.insertConfluencePage(page.id), t('Confluence-Seite eingebunden.'))">{{ t('Einbinden') }}</button></li></ul>
                <p v-else class="empty">{{ t('Suche nach Seiten, um sie als editierbare Annotation einzubinden.') }}</p>
              </div>
              <div v-if="linkedPages.length" class="integration-section"><h3>{{ t('Verknüpfte Seiten') }}</h3><ul class="result-list"><li v-for="element in linkedPages" :key="element.id"><div><strong>{{ element.label || t('Confluence-Seite') }}</strong><span>{{ t('Version {version}', { version: String(element.metadata?.['sketchdraw.atlassian.pageVersion'] ?? '') }) }}</span></div><span class="row-actions"><button class="sd-btn" @click="runOperation(() => store.refreshConfluenceElement(element.id), t('Confluence-Seite neu geladen.'))">{{ t('Neu laden') }}</button><button class="sd-btn" @click="runOperation(() => store.syncConfluenceElement(element.id), t('Confluence-Seite aktualisiert.'))">{{ t('Senden') }}</button></span></li></ul></div>
            </section>
            </fieldset>
          </template>

          <section v-else class="empty-detail"><span class="plugin-logo plugin-logo--large" aria-hidden="true"><img v-if="pluginLogoUrl(selectedCatalogPlugin.id)" :src="pluginLogoUrl(selectedCatalogPlugin.id)!" alt="" /><template v-else>{{ selectedCatalogPlugin.badge }}</template></span><h2>{{ t('Plugin nicht installiert') }}</h2><p>{{ t('Installiere das Plugin zuerst im Marketplace, um es für dieses Projekt zu konfigurieren.') }}</p><button class="sd-btn sd-btn--primary" @click="activeTab = 'marketplace'">{{ t('Zum Marketplace') }}</button></section>
        </section>
      </div>
    </div>
  </dialog>
</template>

<style scoped>
.plugin-dialog{width:min(1060px,calc(100vw - 32px));max-width:none;height:min(800px,calc(100vh - 32px));max-height:none;margin:auto;padding:0;border:0;background:transparent;color:var(--text-primary);overflow:visible}.plugin-dialog::backdrop{background:var(--scrim)}.plugin-shell{display:flex;flex-direction:column;width:100%;height:100%;padding:0;overflow:hidden}.plugin-header{position:relative;display:flex;align-items:flex-end;gap:22px;min-height:82px;padding:16px 24px 0;border-bottom:1px solid var(--border-subtle)}.heading-block{align-self:center;min-width:190px}.eyebrow{font-size:10px;font-weight:750;letter-spacing:.14em;color:var(--accent)}.heading-block h1{margin:4px 0 0}.plugin-tabs{display:flex;align-self:stretch;gap:6px}.plugin-tabs button{position:relative;min-width:126px;padding:16px 16px 14px;border:0;background:transparent;color:var(--text-muted);font:inherit;font-weight:700;cursor:pointer}.plugin-tabs button[aria-selected=true]{color:var(--text-primary)}.plugin-tabs button[aria-selected=true]::after{position:absolute;right:12px;bottom:0;left:12px;height:3px;border-radius:3px 3px 0 0;background:var(--accent);content:""}.tab-count{display:inline-grid;place-items:center;min-width:20px;height:20px;margin-left:5px;padding:0 5px;border-radius:10px;background:var(--surface-raised);font-size:11px}.sd-panel-close{position:absolute;top:20px;right:22px}.context-note,.project-context{display:flex;align-items:center;gap:9px;min-height:42px;padding:9px 24px;border-bottom:1px solid var(--border-subtle);background:color-mix(in srgb,var(--accent) 7%,var(--surface-panel));color:var(--text-muted);font-size:12px}.context-note :deep(svg),.project-context :deep(svg){width:18px;height:18px;flex:0 0 auto}.project-context strong{min-width:0;overflow:hidden;color:var(--text-primary);text-overflow:ellipsis;white-space:nowrap}.plugin-layout{display:grid;grid-template-columns:250px minmax(0,1fr);min-height:0;flex:1}.plugin-list{padding:18px 14px;border-right:1px solid var(--border-subtle);background:var(--surface-raised);overflow:auto}.search-box{display:flex;align-items:center;gap:8px;min-height:42px;padding:0 11px;border:1px solid var(--border-subtle);border-radius:11px;background:var(--surface-panel)}.search-box :deep(svg){width:18px;height:18px;color:var(--text-muted)}.search-box input{min-width:0;flex:1;border:0;outline:0;background:transparent;color:var(--text-primary);font:inherit}.list-label{margin:18px 10px 8px;color:var(--text-muted);font-size:11px;font-weight:800;letter-spacing:.08em;text-transform:uppercase}.plugin-list-item{display:flex;align-items:center;gap:11px;width:100%;min-height:68px;padding:10px;border:1px solid transparent;border-radius:13px;background:transparent;color:var(--text-primary);text-align:left;cursor:pointer}.plugin-list-item:hover{background:var(--surface-panel)}.plugin-list-item.selected{border-color:color-mix(in srgb,var(--accent) 45%,transparent);background:color-mix(in srgb,var(--accent) 11%,var(--surface-panel))}.plugin-logo{display:grid;place-items:center;width:44px;height:44px;flex:0 0 auto;border:1px solid var(--border-subtle);border-radius:12px;background:#fff;color:#1f2330;font-size:20px;font-weight:800}.plugin-logo img{width:68%;height:68%;object-fit:contain}.plugin-logo--large{width:56px;height:56px;border-radius:14px;font-size:26px}.plugin-list-copy{display:grid;min-width:0;gap:3px;flex:1}.plugin-list-copy strong,.plugin-list-copy small{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.plugin-list-copy small{color:var(--text-muted)}.installed-check{display:grid;place-items:center;width:24px;height:24px;border-radius:50%;background:var(--status-ok);color:#fff}.installed-check :deep(svg){width:15px;height:15px}.empty-list{display:grid;place-items:center;gap:8px;padding:34px 18px;color:var(--text-muted);text-align:center;font-size:12px}.plugin-detail{min-width:0;overflow:auto;background:var(--surface-panel)}.overview-hero,.config-head{display:flex;align-items:center;gap:16px;padding:20px 24px}.overview-hero>div,.config-head>div{min-width:0;flex:1}.category-pill{display:inline-flex;padding:4px 8px;border-radius:6px;background:var(--surface-raised);color:var(--text-muted);font-size:11px;font-weight:700}.overview-hero h2,.config-head h2{margin:7px 0 3px;font-size:22px}.overview-hero p,.config-head p{margin:0;color:var(--text-muted)}.install-button{min-width:118px}.detail-tabs{padding:0 32px;border-bottom:1px solid var(--border-subtle)}.detail-tabs span{display:inline-block;padding:12px 2px 10px;border:0;border-bottom:3px solid var(--accent);background:transparent;color:var(--text-primary);font:inherit;font-weight:750}.overview-content,.config-content{padding:20px 24px 24px}.overview-content{max-width:760px}.overview-content h3{max-width:680px;margin:0 0 16px;font-size:19px;line-height:1.35}.overview-content p,.overview-content li{color:var(--text-muted);line-height:1.6}.overview-content h4{margin:26px 0 8px}.overview-content ul{display:grid;gap:7px;padding-left:21px}.security-panel{display:flex;gap:10px;margin-top:28px;padding:14px;border:1px solid color-mix(in srgb,var(--accent) 22%,var(--border-subtle));border-radius:12px;background:color-mix(in srgb,var(--accent) 6%,var(--surface-raised));color:var(--text-muted);font-size:12px;line-height:1.5}.security-panel :deep(svg){width:18px;height:18px;flex:0 0 auto;color:var(--accent)}.config-head{padding-bottom:20px;border-bottom:1px solid var(--border-subtle)}.config-head h2{margin-top:0}.text-button{border:0;background:transparent;color:var(--text-muted);font:inherit;font-weight:700;cursor:pointer}.text-button.danger{color:var(--status-error)}.section-title{display:flex;flex-wrap:wrap;align-items:flex-start;justify-content:space-between;gap:20px}.section-title h3{margin:0;font-size:19px}.section-title p{margin:4px 0 0;color:var(--text-muted);font-size:12px}.switch{display:flex;align-items:center;gap:7px;font-size:12px;font-weight:700}.form-grid{display:grid;gap:14px;margin-top:20px}.form-grid.two{grid-template-columns:minmax(0,1fr) minmax(0,1fr)}.form-grid label{display:grid;gap:7px;color:var(--text-muted);font-size:12px;font-weight:650}.form-grid label.wide{grid-column:1/-1}.form-grid input,.search-row input{min-width:0;width:100%;box-sizing:border-box;min-height:42px;padding:8px 11px;border:1px solid var(--border-subtle);border-radius:10px;outline:0;background:var(--surface-raised);color:var(--text-primary);font:inherit}.form-grid input:focus,.search-row input:focus{border-color:var(--accent);box-shadow:0 0 0 2px color-mix(in srgb,var(--accent) 15%,transparent)}.form-grid input[readonly]{color:var(--text-muted)}.auth-fieldset{margin:22px 0 0;padding:0;border:0}.auth-fieldset legend{margin-bottom:8px;font-size:12px;font-weight:750}.auth-options{display:grid;grid-template-columns:minmax(0,1fr) minmax(0,1fr);gap:10px}.auth-options label{display:grid;grid-template-columns:20px 1fr;gap:3px 7px;padding:12px;border:1px solid var(--border-subtle);border-radius:12px;cursor:pointer}.auth-options label.active{border-color:var(--accent);background:color-mix(in srgb,var(--accent) 7%,var(--surface-raised))}.auth-options input{grid-row:1/3;margin-top:2px}.auth-options span{grid-column:2;color:var(--text-muted);font-size:11px;line-height:1.4}.option-list{display:grid;gap:8px;margin-top:20px}.option-list>label{display:flex;align-items:flex-start;gap:9px;padding:11px;border-radius:10px;background:var(--surface-raised)}.option-list>label span{display:grid;gap:2px}.option-list small,.security-copy,.empty{color:var(--text-muted);font-size:11px;line-height:1.5}.status-grid{display:grid;grid-template-columns:repeat(4,1fr);gap:8px;margin:18px 0 0}.status-grid div{padding:10px;border-radius:10px;background:var(--surface-raised)}dt{font-size:10px;color:var(--text-muted)}dd{margin:3px 0 0;font-size:12px;font-weight:700}.conflict{display:grid;gap:5px;margin-top:14px;padding:14px;border:1px solid var(--status-error);border-radius:12px}.conflict button{justify-self:start}.config-actions{display:flex;flex-wrap:wrap;justify-content:flex-end;gap:8px;margin-top:22px;padding-top:18px;border-top:1px solid var(--border-subtle)}.security-copy{margin:14px 0 0}.integration-section{margin-top:26px;padding-top:20px;border-top:1px solid var(--border-subtle)}.integration-section h3{margin:0 0 10px}.search-row,.result-list li,.row-actions{display:flex;align-items:center}.search-row{gap:8px}.search-row input{min-width:0;flex:1}.result-list{display:grid;gap:7px;margin:10px 0 0;padding:0;list-style:none}.result-list li{justify-content:space-between;gap:12px;padding:10px;border-radius:10px;background:var(--surface-raised)}.result-list li div{display:grid}.result-list span{font-size:11px;color:var(--text-muted)}.row-actions{gap:6px}.empty-detail{display:grid;place-items:center;align-content:center;min-height:100%;padding:40px;text-align:center}.empty-detail h2{margin:18px 0 4px}.empty-detail p{max-width:420px;margin:0 0 18px;color:var(--text-muted)}.sr-only{position:absolute;width:1px;height:1px;padding:0;margin:-1px;overflow:hidden;clip:rect(0,0,0,0);white-space:nowrap;border:0}
.config-fields{min-width:0;margin:0;padding:0;border:0}.context-note{flex-wrap:wrap}.context-note>span{flex:1;min-width:180px}.context-note .sd-btn{flex:0 0 auto}.plugin-feedback{padding:12px 24px;border-bottom:1px solid var(--border-subtle);background:var(--surface-raised);color:var(--text-primary);font-size:13px;line-height:1.45;overflow-wrap:anywhere}.plugin-feedback.error{color:var(--status-error)}.draft-hint{margin:18px 0 0;color:var(--text-muted);font-size:12px}.config-fields:disabled input{cursor:not-allowed;opacity:.65}.plugin-detail h2:focus-visible{outline:2px solid var(--accent);outline-offset:4px}.plugin-tabs button:focus-visible,.plugin-list-item:focus-visible,.text-button:focus-visible{outline:2px solid var(--accent);outline-offset:-3px}.search-box:focus-within{border-color:var(--accent);box-shadow:0 0 0 2px color-mix(in srgb,var(--accent) 15%,transparent)}.plugin-detail{overflow-wrap:anywhere}.plugin-header{flex-shrink:0}.project-context{flex-shrink:0}
.profile-bar{display:flex;flex-wrap:wrap;align-items:flex-end;gap:10px 12px;flex-shrink:0;padding:12px 24px;border-bottom:1px solid var(--border-subtle);background:var(--surface-panel)}
.profile-select{flex:0 1 260px;min-width:180px}
.profile-actions{display:flex;flex-wrap:wrap;gap:8px}
.profile-name{display:grid;gap:5px;flex:1 1 260px;min-width:200px;color:var(--text-muted);font-size:12px;font-weight:600}
.profile-name input{height:36px;padding:0 10px;border:1px solid var(--border-subtle);border-radius:var(--radius-2);background:var(--surface-canvas);color:var(--text-primary);font:inherit;font-weight:400}
.profile-name input:focus-visible{outline:2px solid var(--focus-ring);outline-offset:1px}
.profile-confirm{flex:1 1 260px;margin:0;align-self:center;color:var(--text-primary);font-size:13px}
.profile-bar .sd-btn.danger{border-color:var(--status-error);color:var(--status-error)}.plugin-feedback{flex-shrink:0}.plugin-layout{overflow:hidden}
@media(max-width:800px){.plugin-dialog{width:100vw;height:100vh}.plugin-header{align-items:center;flex-wrap:wrap;gap:8px;padding:16px}.heading-block{min-width:0;flex:1}.plugin-tabs{order:3;width:100%;height:46px}.plugin-tabs button{flex:1}.plugin-layout{grid-template-columns:1fr;grid-template-rows:auto minmax(0,1fr)}.plugin-list{max-height:180px;border-right:0;border-bottom:1px solid var(--border-subtle)}.plugin-detail{min-height:0}.form-grid.two,.auth-options,.status-grid{grid-template-columns:1fr}.form-grid label.wide{grid-column:auto}.overview-hero,.config-head,.overview-content,.config-content{padding-right:20px;padding-left:20px}}
@media(max-width:480px){.plugin-header{padding:12px}.plugin-tabs button{min-width:0;padding:10px}.context-note,.project-context,.plugin-feedback{padding:10px 16px}.overview-hero,.config-head{flex-wrap:wrap;gap:10px}.overview-hero>div,.config-head>div{min-width:120px}.install-button{width:100%}.config-actions .sd-btn{flex:1 1 100%}.config-head .text-button{margin-left:auto}.plugin-list{padding:10px;max-height:166px}.plugin-list-item{min-height:52px;padding:6px}.plugin-logo{width:34px;height:34px;font-size:17px}.list-label{margin:8px}.plugin-detail .config-content{padding:16px}.search-row,.result-list li{flex-wrap:wrap}.option-list>label{padding:8px}.heading-block{padding-right:38px}}
</style>

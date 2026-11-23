<!-- @component The modal dialog of ticket cards (#283): find a ticket of Jira or Azure Boards and put it on the canvas as a card, or edit the ticket of a card. Opened through `store.openTicketInsert` and `store.openTicketCard`; mounted once in the workspace page. -->
<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, ref, watch } from 'vue';
import AppButton from '@/renderer/design-system/atoms/AppButton.vue';
import AppFieldLabel from '@/renderer/design-system/atoms/AppFieldLabel.vue';
import AppIconButton from '@/renderer/design-system/atoms/AppIconButton.vue';
import AppTextarea from '@/renderer/design-system/atoms/AppTextarea.vue';
import AppTextField from '@/renderer/design-system/atoms/AppTextField.vue';
import AppSelect from '@/renderer/design-system/molecules/AppSelect.vue';
import AppTagField from '@/renderer/design-system/molecules/AppTagField.vue';
import { useWhiteboard } from '@/renderer/design-system/composables/use-whiteboard';
import { L, t } from '@/renderer/i18n';
import { wrapTabFocus } from '@/renderer/lib/focus';
import { pluginLogoUrl } from '@/renderer/lib/plugin-logos';
import { readTicketCard, TICKET_PROVIDER_NAME, TICKET_TYPE_STYLE, ticketTypeKind, type TaskStatus, type TicketProvider, type UpdateWorkItemFieldsInput, type WorkItemSummary, type WorkItemUser, type WorkItemValueField } from '@/domain';

const store = useWhiteboard();
const s = store.state;
const dialog = ref<HTMLDialogElement | null>(null);
let opener: HTMLElement | null = null;

const mode = computed(() => s.ticketDialog?.mode ?? null);
const elementId = computed(() => (s.ticketDialog?.mode === 'edit' ? s.ticketDialog.elementId : null));
const ticket = computed(() => readTicketCard(s.document.elements.find((element) => element.id === elementId.value)));
const access = computed(() => { void s.pluginSettings; void s.canWrite; return elementId.value ? store.ticketCardAccess(elementId.value) : 'offline'; });
const trackerName = computed(() => (ticket.value ? TICKET_PROVIDER_NAME[ticket.value.provider] : ''));
const busy = computed(() => s.ticketBusy);
const trackerLogo = computed(() => (ticket.value ? pluginLogoUrl(ticket.value.provider) : null));

// --- Insert ---------------------------------------------------------------------------------------------------
/**
 * The list tickets are picked from. It opens with the tickets that changed last and searches while the text is
 * typed; type and state narrow what was found. Any number of tickets can be ticked and added as cards at once.
 */
const provider = ref<TicketProvider>('jira');
const query = ref('');
const results = ref<WorkItemSummary[] | null>(null);
const searching = ref(false);
const picked = ref<Set<string>>(new Set());
const projectFilter = ref('');
const typeFilter = ref('');
const statusFilter = ref('');
let session = 0;
let searchTimer: ReturnType<typeof setTimeout> | undefined;
const SEARCH_DELAY_MS = 300;
const providerOptions = computed(() => s.ticketReaders.map((entry) => ({ value: entry.id, label: entry.name })));
const site = computed(() => (provider.value === 'azure-devops' ? s.pluginSettings?.azureDevOps?.organizationUrl : s.pluginSettings?.atlassian.siteUrl) ?? '');
const isAddress = computed(() => /^https:\/\/\S+$/i.test(query.value.trim()));
const optionsOf = (values: Array<string | undefined>, all: string) => [{ value: '', label: all }, ...[...new Set(values.filter((value): value is string => Boolean(value)))].sort((a, b) => a.localeCompare(b)).map((value) => ({ value, label: value }))];
/** A Jira key names its project (`SHOP-12`); the work items of Azure Boards all belong to the one connected project. */
const projectOf = (entry: WorkItemSummary): string => (entry.provider === 'jira' ? entry.key.replace(/-\d+$/, '') : '');
const projectOptions = computed(() => optionsOf((results.value ?? []).map(projectOf), t('Alle Projekte')));
const typeOptions = computed(() => optionsOf((results.value ?? []).map((entry) => entry.issueType), t('Alle Typen')));
const statusOptions2 = computed(() => optionsOf((results.value ?? []).map((entry) => entry.remoteStatus), t('Alle Status')));
const shown = computed(() => (results.value ?? []).filter((entry) => (!projectFilter.value || projectOf(entry) === projectFilter.value) && (!typeFilter.value || entry.issueType === typeFilter.value) && (!statusFilter.value || entry.remoteStatus === statusFilter.value)));
const pickedKeys = computed(() => shown.value.filter((entry) => picked.value.has(entry.key)).map((entry) => entry.key));
const allPicked = computed(() => shown.value.length > 0 && pickedKeys.value.length === shown.value.length);
const typeStyle = (name: string | undefined) => TICKET_TYPE_STYLE[ticketTypeKind(name ?? '')];
async function runSearch(): Promise<void> {
  clearTimeout(searchTimer);
  if (isAddress.value) return;
  const current = ++session;
  searching.value = true;
  const found = await store.searchTickets(provider.value, query.value.trim());
  if (current !== session) return;
  searching.value = false; results.value = found ?? [];
  // A filter that names nothing of the new list would hide all of it.
  if (!projectOptions.value.some((option) => option.value === projectFilter.value)) projectFilter.value = '';
  if (!typeOptions.value.some((option) => option.value === typeFilter.value)) typeFilter.value = '';
  if (!statusOptions2.value.some((option) => option.value === statusFilter.value)) statusFilter.value = '';
  picked.value = new Set([...picked.value].filter((key) => (found ?? []).some((entry) => entry.key === key)));
}
/** Every letter starts the search anew after a short pause; an address is not searched but added with Enter. */
function onQuery(value: string): void { query.value = value; clearTimeout(searchTimer); if (!isAddress.value) searchTimer = setTimeout(() => { void runSearch(); }, SEARCH_DELAY_MS); }
async function submitQuery(): Promise<void> {
  if (busy.value) return;
  if (isAddress.value) { if (await store.insertTicketCard(provider.value, query.value.trim())) close(); return; }
  await runSearch();
}
function pickProvider(value: string): void { provider.value = value as TicketProvider; results.value = null; picked.value = new Set(); projectFilter.value = ''; typeFilter.value = ''; statusFilter.value = ''; void runSearch(); }
function togglePick(key: string, on: boolean): void { const next = new Set(picked.value); if (on) next.add(key); else next.delete(key); picked.value = next; }
function toggleAll(on: boolean): void { const next = new Set(picked.value); for (const entry of shown.value) { if (on) next.add(entry.key); else next.delete(entry.key); } picked.value = next; }
async function addPicked(): Promise<void> {
  if (busy.value || !pickedKeys.value.length) return;
  if (await store.insertTicketCards(provider.value, pickedKeys.value)) close();
}

// --- Edit -----------------------------------------------------------------------------------------------------
const STATUS: ReadonlyArray<{ value: TaskStatus; label: string }> = [
  { value: 'todo', label: L('Offen') }, { value: 'doing', label: L('In Arbeit') }, { value: 'review', label: L('Prüfung') }, { value: 'done', label: L('Erledigt') },
];
const statusOptions = computed(() => STATUS.map((entry) => ({ value: entry.value, label: t(entry.label) })));
const draft = ref({ title: '', status: 'todo' as TaskStatus, description: '', assignee: '', issueType: '', labels: [] as string[], components: [] as string[], fixVersions: [] as string[], estimate: '' });
/** What the form showed when it opened or was last read: only what the user changed is sent (as in the task form, #273). */
/** A copy of the form with lists of its own; the form itself is reactive and cannot be cloned as a whole. */
const snapshot = (form: typeof draft.value) => ({ ...form, labels: [...form.labels], components: [...form.components], fixVersions: [...form.fixVersions] });
let opened = snapshot(draft.value);
const sameList = (left: readonly string[], right: readonly string[]): boolean => left.length === right.length && left.every((entry, index) => entry === right[index]);
/**
 * What the tracker suggests for type, labels, components and versions. Each field is asked when the dialog opens
 * and again, after a short pause, for every text that is typed into it.
 */
const VALUE_FIELDS: readonly WorkItemValueField[] = ['issueType', 'labels', 'components', 'fixVersions'];
const suggested = ref<Record<WorkItemValueField, string[]>>({ issueType: [], labels: [], components: [], fixVersions: [] });
const valueTimers: Partial<Record<WorkItemValueField, ReturnType<typeof setTimeout>>> = {};
const valueRequests: Record<WorkItemValueField, number> = { issueType: 0, labels: 0, components: 0, fixVersions: 0 };
function searchValues(field: WorkItemValueField, text: string, delay = 250): void {
  clearTimeout(valueTimers[field]);
  const request = ++valueRequests[field], id = elementId.value;
  if (!id || access.value === 'offline') return;
  valueTimers[field] = setTimeout(async () => {
    const found = await store.searchTicketValues(id, field, text.trim());
    if (request === valueRequests[field]) suggested.value = { ...suggested.value, [field]: found };
  }, delay);
}
function resetValues(): void {
  for (const field of VALUE_FIELDS) { clearTimeout(valueTimers[field]); valueRequests[field]++; }
  suggested.value = { issueType: [], labels: [], components: [], fixVersions: [] };
}
const typeChoices = computed(() => [...new Set([...(ticket.value?.issueType ? [ticket.value.issueType] : []), ...suggested.value.issueType])].map((value) => ({ value, label: value })));
function onType(value: string): void { draft.value.issueType = value; }
/**
 * The person a ticket is assigned to is looked up in the tracker while the name is typed. The field stays free
 * text: what the search does not know can still be written, and the tracker decides when the ticket is saved.
 */
const assigneeMatches = ref<WorkItemUser[]>([]);
let assigneeSearch = 0;
let assigneeTimer: ReturnType<typeof setTimeout> | undefined;
/** Two people of one name are told apart by their address, which the tracker then takes as the name. */
const assigneeOptions = computed(() => assigneeMatches.value.map((user) => {
  const shared = assigneeMatches.value.filter((other) => other.name === user.name).length > 1;
  return { value: shared && user.detail ? user.detail : user.name, label: user.detail ? `${user.name} – ${user.detail}` : user.name };
}).filter((option, index, all) => all.findIndex((other) => other.value === option.value) === index));
function onAssignee(value: string): void {
  draft.value.assignee = value;
  clearTimeout(assigneeTimer);
  const request = ++assigneeSearch, id = elementId.value, text = value.trim();
  if (!id || text.length < 2) { assigneeMatches.value = []; return; }
  // A suggestion that was just chosen needs no new search.
  if (assigneeOptions.value.some((option) => option.value === value)) return;
  assigneeTimer = setTimeout(async () => {
    const found = await store.searchTicketUsers(id, text);
    if (request === assigneeSearch) assigneeMatches.value = found;
  }, 250);
}
function seed(): void {
  const data = ticket.value;
  if (!data) return;
  clearTimeout(assigneeTimer); assigneeSearch++; assigneeMatches.value = [];
  draft.value = { title: data.title, status: data.status, description: data.description, assignee: data.assignee, issueType: data.issueType, labels: [...data.labels], components: [...data.components], fixVersions: [...data.fixVersions], estimate: data.estimate };
  opened = snapshot(draft.value);
}
const titleMissing = ref(false);
const readOnly = computed(() => access.value !== 'writable');
async function save(): Promise<void> {
  if (!elementId.value || busy.value || readOnly.value) return;
  const value = draft.value;
  if (!value.title.trim()) { titleMissing.value = true; dialog.value?.querySelector<HTMLElement>('#ticket-title')?.focus(); return; }
  titleMissing.value = false;
  const changes: Omit<UpdateWorkItemFieldsInput, 'provider' | 'key'> = {
    ...(value.title.trim() !== opened.title.trim() ? { title: value.title.trim() } : {}),
    ...(value.status !== opened.status ? { status: value.status } : {}),
    ...(value.description !== opened.description ? { description: value.description } : {}),
    ...(value.assignee.trim() !== opened.assignee.trim() ? { assignee: value.assignee.trim() || null } : {}),
    ...(value.issueType.trim() && value.issueType.trim() !== opened.issueType.trim() ? { issueType: value.issueType.trim() } : {}),
    ...(!sameList(value.labels, opened.labels) ? { labels: [...value.labels] } : {}),
    ...(!sameList(value.components, opened.components) ? { components: [...value.components] } : {}),
    ...(!sameList(value.fixVersions, opened.fixVersions) ? { fixVersions: [...value.fixVersions] } : {}),
    ...(value.estimate.trim() !== opened.estimate.trim() ? { estimate: value.estimate.trim() || null } : {}),
  };
  if (!Object.keys(changes).length) { close(); return; }
  if (await store.saveTicketCard(elementId.value, changes)) close();
}
async function refresh(): Promise<void> {
  if (!elementId.value || busy.value) return;
  if (await store.refreshTicketCard(elementId.value)) seed();
}
function openInTracker(): void { if (ticket.value?.url) void store.openDocumentationLink(ticket.value.url); }

function close(): void { store.closeTicketDialog(); }
watch(() => s.ticketDialog, async (open) => {
  await nextTick();
  if (open) {
    opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    session++; clearTimeout(searchTimer); searching.value = false; results.value = null; query.value = ''; titleMissing.value = false; picked.value = new Set(); projectFilter.value = ''; typeFilter.value = ''; statusFilter.value = '';
    if (open.mode === 'insert' && open.provider && providerOptions.value.some((option) => option.value === open.provider)) provider.value = open.provider;
    if (!providerOptions.value.some((option) => option.value === provider.value)) provider.value = providerOptions.value[0]?.value ?? 'jira';
    if (open.mode === 'insert' && providerOptions.value.length) void runSearch();
    seed(); resetValues();
    if (open.mode === 'edit') for (const field of VALUE_FIELDS) searchValues(field, '', 0);
    if (!dialog.value?.open) dialog.value?.showModal();
    await nextTick();
    dialog.value?.querySelector<HTMLElement>(open.mode === 'insert' ? '#ticket-query' : readOnly.value ? '.sd-panel-close' : '#ticket-title')?.focus();
  } else {
    session++; clearTimeout(searchTimer); resetValues();
    if (dialog.value?.open) dialog.value.close();
    if (opener?.isConnected) opener.focus();
    opener = null;
  }
}, { immediate: true });
// A card that was deleted while its dialog is open has nothing left to edit.
watch(ticket, (current) => { if (mode.value === 'edit' && !current) close(); });
onBeforeUnmount(() => { clearTimeout(searchTimer); clearTimeout(assigneeTimer); resetValues(); dialog.value?.close(); });
</script>

<template>
  <dialog ref="dialog" class="ticket-dialog" data-testid="ticket-dialog" aria-labelledby="ticket-dialog-title" @cancel.prevent="close" @pointerdown.self="close" @keydown.stop="dialog && wrapTabFocus($event, dialog)">
    <div v-if="mode === 'insert'" class="ticket-panel sd-panel picker">
      <header><div><h2 id="ticket-dialog-title" class="sd-panel-title">{{ t('Tickets auswählen') }}</h2><p v-if="site" class="origin" data-testid="ticket-site">{{ site }}</p></div><AppIconButton class="sd-panel-close" icon="close" :label="t('Dialog schließen')" @click="close" /></header>
      <p v-if="!providerOptions.length" class="blocked" role="status">{{ t('Verbinde Jira oder Azure DevOps in den Plugin-Einstellungen und öffne ein gespeichertes Diagramm, um Tickets einzufügen.') }}</p>
      <template v-else>
        <form class="search-row" @submit.prevent="submitQuery">
          <div class="field grow"><AppFieldLabel for="ticket-query">{{ t('Tickets suchen') }}</AppFieldLabel><AppTextField id="ticket-query" :model-value="query" type="search" data-testid="ticket-query" autocomplete="off" maxlength="2048" :placeholder="t('Titel, Schlüssel oder Ticket-Adresse')" @update:model-value="onQuery" /></div>
          <AppButton v-if="isAddress" intent="primary" type="submit" data-testid="ticket-search" :disabled="busy" :aria-busy="busy ? 'true' : undefined">{{ t('Einfügen') }}</AppButton>
        </form>
        <div class="filters">
          <AppSelect v-if="providerOptions.length > 1" id="ticket-provider" compact :label="t('Ticket-System')" :model-value="provider" :options="providerOptions" @update:model-value="pickProvider" />
          <AppSelect v-if="projectOptions.length > 2" id="ticket-filter-project" compact :label="t('Projekt')" :model-value="projectFilter" :options="projectOptions" @update:model-value="projectFilter = $event" />
          <AppSelect id="ticket-filter-type" compact :label="t('Vorgangstyp')" :model-value="typeFilter" :options="typeOptions" @update:model-value="typeFilter = $event" />
          <AppSelect id="ticket-filter-status" compact :label="t('Status')" :model-value="statusFilter" :options="statusOptions2" @update:model-value="statusFilter = $event" />
        </div>
        <p v-if="results === null" class="copy" role="status">{{ t('Tickets werden geladen …') }}</p>
        <p v-else-if="!shown.length" class="copy" role="status" data-testid="ticket-no-results">{{ t('Kein Ticket gefunden.') }}</p>
        <div v-else class="table-scroll">
          <table class="tickets" data-testid="ticket-results" :aria-label="t('Gefundene Tickets')" :aria-busy="searching ? 'true' : undefined">
            <thead><tr>
              <th class="col-pick"><input type="checkbox" :checked="allPicked" :indeterminate="!allPicked && pickedKeys.length > 0" :aria-label="t('Alle Tickets auswählen')" @change="toggleAll(($event.target as HTMLInputElement).checked)"></th>
              <th class="col-type"><span class="visually-hidden">{{ t('Vorgangstyp') }}</span></th><th>{{ t('Schlüssel') }}</th><th>{{ t('Titel') }}</th><th>{{ t('Zugewiesen an') }}</th><th>{{ t('Status') }}</th>
            </tr></thead>
            <tbody>
              <tr v-for="entry in shown" :key="entry.key" :class="{ picked: picked.has(entry.key) }" @click="togglePick(entry.key, !picked.has(entry.key))">
                <td class="col-pick"><input type="checkbox" :checked="picked.has(entry.key)" :aria-label="t('{key} auswählen', { key: entry.key })" @click.stop @change="togglePick(entry.key, ($event.target as HTMLInputElement).checked)"></td>
                <td class="col-type"><svg v-if="entry.issueType" width="18" height="18" viewBox="0 0 22 22" role="img" :aria-label="entry.issueType"><title>{{ entry.issueType }}</title><rect width="22" height="22" rx="5" :fill="typeStyle(entry.issueType).color" /><path v-for="(shape, index) in typeStyle(entry.issueType).shapes" :key="index" :d="shape.d" :fill="shape.filled ? '#ffffff' : 'none'" :stroke="shape.filled ? 'none' : '#ffffff'" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" /></svg></td>
                <td class="col-key">{{ entry.provider === 'azure-devops' ? `#${entry.key}` : entry.key }}</td>
                <td class="col-title" :title="entry.title">{{ entry.title }}</td>
                <td class="col-person" :title="entry.assignee ?? ''">{{ entry.assignee ?? '–' }}</td>
                <td class="col-status" :title="entry.remoteStatus">{{ entry.remoteStatus }}</td>
              </tr>
            </tbody>
          </table>
        </div>
        <footer class="actions">
          <p class="copy grow-copy">{{ t('Die Karten übernehmen den Inhalt der Tickets in das Dokument.') }}</p>
          <AppButton @click="close">{{ t('Abbrechen') }}</AppButton>
          <AppButton intent="primary" data-testid="ticket-add" :disabled="busy || !pickedKeys.length" :aria-busy="busy ? 'true' : undefined" @click="addPicked">{{ pickedKeys.length === 1 ? t('1 Karte hinzufügen') : t('{count} Karten hinzufügen', { count: pickedKeys.length }) }}</AppButton>
        </footer>
      </template>
    </div>

    <form v-else-if="mode === 'edit' && ticket" class="ticket-panel sd-panel editor" @submit.prevent="save">
      <header class="editor-head">
        <img v-if="trackerLogo" class="tracker-logo" :src="trackerLogo" alt="" width="22" height="22">
        <h2 id="ticket-dialog-title" class="sd-panel-title editor-title" :title="`${ticket.key} ${draft.title}`"><span class="editor-key">{{ ticket.provider === 'azure-devops' ? `#${ticket.key}` : ticket.key }}</span> {{ draft.title || ticket.title }}</h2>
        <div class="head-actions">
          <AppIconButton v-if="ticket.url" icon="external-link" :icon-size="18" data-testid="ticket-open" :label="t('In {name} öffnen', { name: trackerName })" @click="openInTracker" />
          <AppIconButton icon="history" :icon-size="18" data-testid="ticket-refresh" :label="t('Neu abrufen')" :disabled="access === 'offline' || busy" :aria-busy="busy ? 'true' : undefined" @click="refresh" />
          <AppIconButton class="sd-panel-close" icon="close" :label="t('Dialog schließen')" @click="close" />
        </div>
      </header>
      <div class="editor-tabs"><span class="editor-tab">{{ t('Details') }}</span></div>
      <div class="editor-body">
        <p v-if="access === 'offline'" class="blocked" role="status" data-testid="ticket-offline">{{ t('Die Karte zeigt den Stand des letzten Abrufs. Zum Bearbeiten und Aktualisieren muss {name} mit der Site dieses Tickets verbunden sein.', { name: trackerName }) }}</p>
        <p v-else-if="access === 'readonly'" class="blocked" role="status" data-testid="ticket-readonly">{{ t('Dieses Ticket lässt sich hier lesen und aktualisieren, aber nicht ändern.') }}</p>
        <fieldset class="fields single" :disabled="readOnly || busy">
          <div class="type-row">
            <svg v-if="draft.issueType" class="type-mark" width="22" height="22" viewBox="0 0 22 22" aria-hidden="true"><rect width="22" height="22" rx="5" :fill="typeStyle(draft.issueType).color" /><path v-for="(shape, index) in typeStyle(draft.issueType).shapes" :key="index" :d="shape.d" :fill="shape.filled ? '#ffffff' : 'none'" :stroke="shape.filled ? 'none' : '#ffffff'" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" /></svg>
            <AppSelect id="ticket-type" class="type-select" data-testid="ticket-type" editable :label="t('Vorgangstyp')" :model-value="draft.issueType" :options="typeChoices" :maxlength="128" :placeholder="t('Typ suchen')" :disabled="readOnly || busy" @update:model-value="onType" />
          </div>
          <div class="field"><AppFieldLabel for="ticket-title" class="required">{{ t('Titel') }}</AppFieldLabel><AppTextField id="ticket-title" v-model="draft.title" maxlength="255" aria-required="true" :invalid="titleMissing" :aria-describedby="titleMissing ? 'ticket-title-error' : undefined" /><p v-if="titleMissing" id="ticket-title-error" class="error" role="alert">{{ t('Ein Ticket braucht einen Titel.') }}</p></div>
          <div class="field"><AppFieldLabel for="ticket-description">{{ t('Beschreibung') }}</AppFieldLabel><AppTextarea id="ticket-description" v-model="draft.description" rows="10" maxlength="50000" aria-describedby="ticket-description-note" /><p id="ticket-description-note" class="note">{{ t('Die Beschreibung wird als einfacher Text gespeichert; Formatierungen im Ticket-System gehen dabei verloren.') }}</p></div>
          <AppSelect id="ticket-assignee" editable :label="t('Zugewiesen an')" :model-value="draft.assignee" :options="assigneeOptions" :maxlength="120" :placeholder="t('Name oder E-Mail suchen')" :disabled="readOnly || busy" @update:model-value="onAssignee" />
          <p v-if="assigneeMatches.length" class="note matches" role="status" data-testid="ticket-assignee-matches">{{ assigneeMatches.length === 1 ? t('1 passende Person') : t('{count} passende Personen', { count: assigneeMatches.length }) }}</p>
          <AppSelect id="ticket-status" :label="t('Status')" :model-value="draft.status" :options="statusOptions" :disabled="readOnly || busy" @update:model-value="draft.status = $event as TaskStatus" />
          <AppTagField id="ticket-labels" v-model="draft.labels" :label="t('Labels')" :options="suggested.labels" :placeholder="t('Label suchen oder eingeben')" :disabled="readOnly || busy" @search="searchValues('labels', $event)" />
          <AppTagField id="ticket-components" v-model="draft.components" :label="ticket.provider === 'azure-devops' ? t('Bereich (Area Path)') : t('Komponenten')" :options="suggested.components" :max="ticket.provider === 'azure-devops' ? 1 : undefined" :placeholder="ticket.provider === 'azure-devops' ? t('Bereich suchen') : t('Komponente suchen')" :disabled="readOnly || busy" @search="searchValues('components', $event)" />
          <AppTagField id="ticket-versions" v-model="draft.fixVersions" data-testid="ticket-versions" :label="ticket.provider === 'azure-devops' ? t('Iteration') : t('Fix Version')" :options="suggested.fixVersions" :max="ticket.provider === 'azure-devops' ? 1 : undefined" :placeholder="ticket.provider === 'azure-devops' ? t('Iteration suchen') : t('Version suchen')" :disabled="readOnly || busy" @search="searchValues('fixVersions', $event)" />
          <div class="field"><AppFieldLabel for="ticket-estimate">{{ t('Schätzung') }}</AppFieldLabel><AppTextField id="ticket-estimate" v-model="draft.estimate" maxlength="40" autocomplete="off" :placeholder="t('z. B. 5 oder 3h')" /></div>
        </fieldset>
      </div>
      <footer class="actions editor-foot">
        <AppButton v-if="!readOnly" intent="primary" type="submit" data-testid="ticket-save" :disabled="busy" :aria-busy="busy ? 'true' : undefined">{{ busy ? t('Wird gespeichert …') : t('Aktualisieren') }}</AppButton>
        <AppButton @click="close">{{ readOnly ? t('Schließen') : t('Abbrechen') }}</AppButton>
      </footer>
    </form>
  </dialog>
</template>

<style scoped>
.ticket-dialog{width:min(620px,calc(100vw - 32px));max-height:calc(100dvh - 32px);padding:0;border:0;background:transparent;color:var(--text-primary);overflow:visible}
.ticket-dialog::backdrop{background:var(--scrim)}
.ticket-panel{display:flex;flex-direction:column;gap:var(--space-3);max-height:calc(100dvh - 32px);overflow:auto;padding:20px}
header{display:flex;align-items:flex-start;justify-content:space-between;gap:var(--space-3)}
header h2{margin:0;overflow-wrap:anywhere}
.origin{margin:2px 0 0;color:var(--text-muted);font-size:var(--font-size-s)}
.copy,.note{margin:0;color:var(--text-muted);font-size:var(--font-size-s);line-height:1.5}
.blocked{margin:0;padding:var(--space-3);border-radius:var(--radius-1);background:var(--surface-raised);font-size:var(--font-size-s);line-height:1.5}
.error{margin:0;color:var(--status-error);font-size:var(--font-size-s)}
.search-row{display:flex;align-items:flex-end;gap:var(--space-2)}
.field{display:grid;gap:var(--space-1);min-width:0}
.field.grow{flex:1}
.fields{display:grid;grid-template-columns:1fr 1fr;align-items:end;gap:var(--space-3);min-width:0;margin:0;padding:0;border:0}
.fields .wide{grid-column:1 / -1}
.results{display:grid;gap:var(--space-1);max-height:280px;margin:0;padding:0;overflow:auto;list-style:none}
.results li{display:flex;align-items:center;justify-content:space-between;gap:var(--space-3);padding:var(--space-2) var(--space-3);border:1px solid var(--border-subtle);border-radius:var(--radius-1)}
.results li div{display:grid;gap:2px;min-width:0}
.results strong{overflow-wrap:anywhere;font-size:var(--font-size-m)}
.results span{color:var(--text-muted);font-size:var(--font-size-s)}
.results li>:last-child{flex:none}
.actions{display:flex;flex-wrap:wrap;align-items:center;gap:var(--space-2)}
.spacer{flex:1}
@media(max-width:520px){.fields{grid-template-columns:1fr}.search-row{flex-direction:column;align-items:stretch}}
.ticket-dialog:has(.picker){width:min(940px,calc(100vw - 32px))}
.filters{display:flex;flex-wrap:wrap;align-items:flex-end;gap:var(--space-2)}
.filters>*{min-width:170px}
.table-scroll{min-height:120px;max-height:min(420px,calc(100dvh - 380px));overflow:auto;border:1px solid var(--border-subtle);border-radius:var(--radius-1)}
.tickets{width:100%;border-collapse:collapse;font-size:var(--font-size-m)}
.tickets th{position:sticky;top:0;z-index:1;padding:var(--space-2) var(--space-3);background:var(--surface-raised);color:var(--text-muted);font-size:var(--font-size-s);font-weight:600;text-align:left;white-space:nowrap}
.tickets td{padding:var(--space-2) var(--space-3);border-top:1px solid var(--border-subtle);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.tickets tbody tr{cursor:pointer}
.tickets tbody tr:hover{background:var(--menu-hover)}
.tickets tbody tr.picked{background:var(--menu-selected)}
.tickets input[type='checkbox']{width:16px;height:16px;margin:0;accent-color:var(--accent);vertical-align:middle}
.col-pick{width:36px}.col-type{width:30px;padding-right:0!important}
.col-type svg{display:block}
.col-key{width:1%;color:var(--text-muted);font-family:var(--font-mono);font-size:var(--font-size-s)}
.col-title{max-width:0;width:55%;font-weight:600}
.col-person{max-width:160px;color:var(--text-muted)}.col-status{max-width:150px}
.grow-copy{flex:1;min-width:180px}
.visually-hidden{position:absolute;width:1px;height:1px;margin:-1px;padding:0;overflow:hidden;clip:rect(0,0,0,0);white-space:nowrap;border:0}
/* The editor of one ticket: a head that names it, the fields in one column that scrolls, the actions below. */
.ticket-dialog:has(.editor){width:min(600px,calc(100vw - 32px))}
.editor{gap:0;padding:0;overflow:hidden}
.editor-head{align-items:center;gap:var(--space-3);padding:var(--space-4) var(--space-4) var(--space-3) var(--space-5)}
.tracker-logo{flex:none;border-radius:5px}
.editor-title{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:var(--font-size-l)}
.editor-key{color:var(--text-muted);font-weight:600}
.head-actions{display:flex;align-items:center;gap:var(--space-1);flex:none}
.editor-tabs{display:flex;padding:0 var(--space-5) var(--space-3);border-bottom:1px solid var(--border-subtle)}
.editor-tab{padding:var(--space-1) var(--space-3);border-radius:var(--radius-1);background:var(--surface-raised);font-size:var(--font-size-m);font-weight:600}
.editor-body{display:flex;flex-direction:column;gap:var(--space-4);min-height:0;padding:var(--space-4) var(--space-5);overflow:auto}
.type-row{display:flex;align-items:flex-end;gap:var(--space-2);min-width:0}
.type-mark{flex:none;margin-bottom:9px}
.type-select{flex:1;min-width:0}
.fields.single{grid-template-columns:minmax(0,1fr);gap:var(--space-4)}
.required::after{content:' *';color:var(--status-error)}
.matches{margin-top:calc(var(--space-3) * -1)}
.editor-foot{justify-content:flex-start;padding:var(--space-3) var(--space-5) var(--space-4);border-top:1px solid var(--border-subtle)}
</style>

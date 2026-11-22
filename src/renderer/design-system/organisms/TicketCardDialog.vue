<!-- @component The modal dialog of ticket cards (#283): find a ticket of Jira or Azure Boards and put it on the canvas as a card, or edit the ticket of a card. Opened through `store.openTicketInsert` and `store.openTicketCard`; mounted once in the workspace page. -->
<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, ref, watch } from 'vue';
import AppButton from '@/renderer/design-system/atoms/AppButton.vue';
import AppFieldLabel from '@/renderer/design-system/atoms/AppFieldLabel.vue';
import AppIconButton from '@/renderer/design-system/atoms/AppIconButton.vue';
import AppTextarea from '@/renderer/design-system/atoms/AppTextarea.vue';
import AppTextField from '@/renderer/design-system/atoms/AppTextField.vue';
import AppSelect from '@/renderer/design-system/molecules/AppSelect.vue';
import { useWhiteboard } from '@/renderer/design-system/composables/use-whiteboard';
import { intlLocale, L, t } from '@/renderer/i18n';
import { wrapTabFocus } from '@/renderer/lib/focus';
import { readTicketCard, TICKET_PROVIDER_NAME, type TaskStatus, type TicketProvider, type UpdateWorkItemFieldsInput, type WorkItemSummary } from '@/domain';

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

// --- Insert ---------------------------------------------------------------------------------------------------
const provider = ref<TicketProvider>('jira');
const query = ref('');
const results = ref<WorkItemSummary[] | null>(null);
const searching = ref(false);
let session = 0;
const providerOptions = computed(() => s.ticketReaders.map((entry) => ({ value: entry.id, label: entry.name })));
const isAddress = computed(() => /^https:\/\/\S+$/i.test(query.value.trim()));
async function search(): Promise<void> {
  const text = query.value.trim();
  if (!text || searching.value || busy.value) return;
  // An address names its ticket itself; everything else is a key, a number or part of a title.
  if (isAddress.value) { if (await store.insertTicketCard(provider.value, text)) close(); return; }
  const current = ++session;
  searching.value = true;
  const found = await store.searchTickets(provider.value, text);
  if (current !== session) return;
  searching.value = false; results.value = found;
}
async function insert(entry: WorkItemSummary): Promise<void> {
  if (busy.value) return;
  if (await store.insertTicketCard(entry.provider, entry.key)) close();
}

// --- Edit -----------------------------------------------------------------------------------------------------
const STATUS: ReadonlyArray<{ value: TaskStatus; label: string }> = [
  { value: 'todo', label: L('Offen') }, { value: 'doing', label: L('In Arbeit') }, { value: 'review', label: L('Prüfung') }, { value: 'done', label: L('Erledigt') },
];
const statusOptions = computed(() => STATUS.map((entry) => ({ value: entry.value, label: t(entry.label) })));
const draft = ref({ title: '', status: 'todo' as TaskStatus, description: '', assignee: '', labels: '', components: '', estimate: '' });
/** What the form showed when it opened or was last read: only what the user changed is sent (as in the task form, #273). */
let opened = { ...draft.value };
const listText = (values: readonly string[]): string => values.join(', ');
const listOf = (text: string): string[] => [...new Set(text.split(',').map((entry) => entry.trim()).filter(Boolean))];
function seed(): void {
  const data = ticket.value;
  if (!data) return;
  draft.value = { title: data.title, status: data.status, description: data.description, assignee: data.assignee, labels: listText(data.labels), components: listText(data.components), estimate: data.estimate };
  opened = { ...draft.value };
}
const titleMissing = ref(false);
const readOnly = computed(() => access.value !== 'writable');
const fetched = computed(() => {
  const time = Date.parse(ticket.value?.fetchedAt ?? '');
  return Number.isFinite(time) ? new Intl.DateTimeFormat(intlLocale(), { dateStyle: 'medium', timeStyle: 'short' }).format(time) : '';
});
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
    ...(listText(listOf(value.labels)) !== listText(listOf(opened.labels)) ? { labels: listOf(value.labels) } : {}),
    ...(listText(listOf(value.components)) !== listText(listOf(opened.components)) ? { components: listOf(value.components) } : {}),
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
    session++; searching.value = false; results.value = null; query.value = ''; titleMissing.value = false;
    if (!providerOptions.value.some((option) => option.value === provider.value)) provider.value = providerOptions.value[0]?.value ?? 'jira';
    seed();
    if (!dialog.value?.open) dialog.value?.showModal();
    await nextTick();
    dialog.value?.querySelector<HTMLElement>(open.mode === 'insert' ? '#ticket-query' : readOnly.value ? '.sd-panel-close' : '#ticket-title')?.focus();
  } else {
    session++;
    if (dialog.value?.open) dialog.value.close();
    if (opener?.isConnected) opener.focus();
    opener = null;
  }
}, { immediate: true });
// A card that was deleted while its dialog is open has nothing left to edit.
watch(ticket, (current) => { if (mode.value === 'edit' && !current) close(); });
onBeforeUnmount(() => dialog.value?.close());
</script>

<template>
  <dialog ref="dialog" class="ticket-dialog" data-testid="ticket-dialog" aria-labelledby="ticket-dialog-title" @cancel.prevent="close" @pointerdown.self="close" @keydown.stop="dialog && wrapTabFocus($event, dialog)">
    <div v-if="mode === 'insert'" class="ticket-panel sd-panel">
      <header><h2 id="ticket-dialog-title" class="sd-panel-title">{{ t('Ticket als Karte einfügen') }}</h2><AppIconButton class="sd-panel-close" icon="close" :label="t('Dialog schließen')" @click="close" /></header>
      <p v-if="!providerOptions.length" class="blocked" role="status">{{ t('Verbinde Jira oder Azure DevOps in den Plugin-Einstellungen und öffne ein gespeichertes Diagramm, um Tickets einzufügen.') }}</p>
      <template v-else>
        <p class="copy">{{ t('Die Karte übernimmt Titel, Status, Beschreibung, Zuständigkeit, Labels, Komponenten und Schätzung des Tickets in das Dokument. Eine Ticket-Adresse lässt sich auch direkt auf der Zeichenfläche einfügen.') }}</p>
        <AppSelect v-if="providerOptions.length > 1" id="ticket-provider" :label="t('Ticket-System')" :model-value="provider" :options="providerOptions" @update:model-value="provider = $event as TicketProvider; results = null" />
        <form class="search-row" @submit.prevent="search">
          <div class="field grow"><AppFieldLabel for="ticket-query">{{ t('Schlüssel, Adresse oder Suchtext') }}</AppFieldLabel><AppTextField id="ticket-query" v-model="query" data-testid="ticket-query" autocomplete="off" maxlength="2048" :placeholder="provider === 'jira' ? 'PROJ-12' : '1234'" /></div>
          <AppButton intent="primary" type="submit" data-testid="ticket-search" :disabled="!query.trim() || searching || busy" :aria-busy="searching || busy ? 'true' : undefined">{{ isAddress ? t('Einfügen') : t('Suchen') }}</AppButton>
        </form>
        <p v-if="results && !results.length" class="copy" role="status" data-testid="ticket-no-results">{{ t('Kein Ticket gefunden.') }}</p>
        <ul v-else-if="results" class="results" data-testid="ticket-results" :aria-label="t('Gefundene Tickets')">
          <li v-for="entry in results" :key="entry.key"><div><strong>{{ entry.title }}</strong><span>{{ entry.key }} · {{ entry.remoteStatus }}</span></div><AppButton :disabled="busy" :aria-label="t('{key} einfügen', { key: entry.key })" @click="insert(entry)">{{ t('Einfügen') }}</AppButton></li>
        </ul>
      </template>
    </div>

    <form v-else-if="mode === 'edit' && ticket" class="ticket-panel sd-panel" @submit.prevent="save">
      <header><div><h2 id="ticket-dialog-title" class="sd-panel-title">{{ t('Ticket {key}', { key: ticket.key }) }}</h2><p class="origin">{{ trackerName }}<template v-if="fetched"> · {{ t('abgerufen {when}', { when: fetched }) }}</template></p></div><AppIconButton class="sd-panel-close" icon="close" :label="t('Dialog schließen')" @click="close" /></header>
      <p v-if="access === 'offline'" class="blocked" role="status" data-testid="ticket-offline">{{ t('Die Karte zeigt den Stand des letzten Abrufs. Zum Bearbeiten und Aktualisieren muss {name} mit der Site dieses Tickets verbunden sein.', { name: trackerName }) }}</p>
      <p v-else-if="access === 'readonly'" class="blocked" role="status" data-testid="ticket-readonly">{{ t('Dieses Ticket lässt sich hier lesen und aktualisieren, aber nicht ändern.') }}</p>
      <fieldset class="fields" :disabled="readOnly || busy">
        <div class="field wide"><AppFieldLabel for="ticket-title">{{ t('Titel') }}</AppFieldLabel><AppTextField id="ticket-title" v-model="draft.title" maxlength="255" :invalid="titleMissing" :aria-describedby="titleMissing ? 'ticket-title-error' : undefined" /><p v-if="titleMissing" id="ticket-title-error" class="error" role="alert">{{ t('Ein Ticket braucht einen Titel.') }}</p></div>
        <AppSelect id="ticket-status" :label="t('Status')" :model-value="draft.status" :options="statusOptions" :disabled="readOnly || busy" @update:model-value="draft.status = $event as TaskStatus" />
        <div class="field"><AppFieldLabel for="ticket-assignee">{{ t('Zugewiesen an') }}</AppFieldLabel><AppTextField id="ticket-assignee" v-model="draft.assignee" maxlength="120" autocomplete="off" /></div>
        <div class="field wide"><AppFieldLabel for="ticket-description">{{ t('Beschreibung') }}</AppFieldLabel><AppTextarea id="ticket-description" v-model="draft.description" rows="5" maxlength="50000" aria-describedby="ticket-description-note" /><p id="ticket-description-note" class="note">{{ t('Die Beschreibung wird als einfacher Text gespeichert; Formatierungen im Ticket-System gehen dabei verloren.') }}</p></div>
        <div class="field"><AppFieldLabel for="ticket-labels">{{ t('Labels') }}</AppFieldLabel><AppTextField id="ticket-labels" v-model="draft.labels" autocomplete="off" :placeholder="t('mit Komma getrennt')" /></div>
        <div class="field"><AppFieldLabel for="ticket-components">{{ ticket.provider === 'azure-devops' ? t('Bereich (Area Path)') : t('Komponenten') }}</AppFieldLabel><AppTextField id="ticket-components" v-model="draft.components" autocomplete="off" :placeholder="ticket.provider === 'azure-devops' ? '' : t('mit Komma getrennt')" /></div>
        <div class="field"><AppFieldLabel for="ticket-estimate">{{ t('Schätzung') }}</AppFieldLabel><AppTextField id="ticket-estimate" v-model="draft.estimate" maxlength="40" autocomplete="off" :placeholder="t('z. B. 5 oder 3h')" /></div>
      </fieldset>
      <footer class="actions">
        <AppButton v-if="ticket.url" data-testid="ticket-open" @click="openInTracker">{{ t('In {name} öffnen', { name: trackerName }) }}</AppButton>
        <AppButton data-testid="ticket-refresh" :disabled="access === 'offline' || busy" :aria-busy="busy ? 'true' : undefined" @click="refresh">{{ t('Neu abrufen') }}</AppButton>
        <span class="spacer" />
        <AppButton @click="close">{{ readOnly ? t('Schließen') : t('Abbrechen') }}</AppButton>
        <AppButton v-if="!readOnly" intent="primary" type="submit" data-testid="ticket-save" :disabled="busy" :aria-busy="busy ? 'true' : undefined">{{ busy ? t('Wird gespeichert …') : t('Speichern') }}</AppButton>
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
</style>

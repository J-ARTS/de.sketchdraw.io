<!-- @component The modal dialog that links one page of the diagram to a page of a wiki, Confluence (#240) or the Azure DevOps wiki (#284): search the target, see what the publication is doing, publish now, remove the link. Opened from the page menu through `store.openConfluencePageLink`; mounted once in the workspace page. -->
<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, ref, watch } from 'vue';
import AppButton from '@/renderer/design-system/atoms/AppButton.vue';
import AppIcon from '@/renderer/design-system/atoms/AppIcon.vue';
import AppIconButton from '@/renderer/design-system/atoms/AppIconButton.vue';
import AppTextField from '@/renderer/design-system/atoms/AppTextField.vue';
import AppSelect from '@/renderer/design-system/molecules/AppSelect.vue';
import ConfluenceLinkCard from '@/renderer/design-system/molecules/ConfluenceLinkCard.vue';
import { useWhiteboard } from '@/renderer/design-system/composables/use-whiteboard';
import { t, tm } from '@/renderer/i18n';
import { wrapTabFocus } from '@/renderer/lib/focus';
import { wikiPageLinks, type WikiPageSummary, type WikiProviderId } from '@/domain';

const store = useWhiteboard();
const s = store.state;
const dialog = ref<HTMLDialogElement | null>(null);
const searchField = ref<InstanceType<typeof AppTextField> | null>(null);
let opener: HTMLElement | null = null;

const diagramPageId = computed(() => s.confluenceLinkPageId);
const page = computed(() => s.pages.find((entry) => entry.id === diagramPageId.value) ?? null);
const link = computed(() => wikiPageLinks(s.pluginSettings).find((entry) => entry.diagramPageId === diagramPageId.value) ?? null);
/** The wiki this dialog works with: the one of the link, else the chosen one of those that are switched on. */
const chosen = ref<WikiProviderId>('confluence');
const provider = computed<WikiProviderId>(() => link.value?.provider ?? (s.wikiProviders.some((entry) => entry.id === chosen.value) ? chosen.value : s.wikiProviders[0]?.id ?? 'confluence'));
const azure = computed(() => provider.value === 'azure-devops');
const providerOptions = computed(() => s.wikiProviders.map((entry) => ({ value: entry.id, label: entry.name })));
/** Azure DevOps is not part of this profile: the dialog speaks of Confluence alone, as before there were two wikis. */
const confluenceOnly = computed(() => !s.pluginSettings?.azureDevOps?.installed && !azure.value);
const status = computed(() => (diagramPageId.value ? s.confluencePageLive[diagramPageId.value] : undefined) ?? { state: 'off' as const, message: '' });
/** Why nothing can be linked right now; empty when linking is possible. */
const blocked = computed(() => {
  if (s.roomGuest) return confluenceOnly.value ? t('Nur wer das Diagramm lokal geöffnet hat, kann Seiten mit Confluence verknüpfen.') : t('Nur wer das Diagramm lokal geöffnet hat, kann Seiten mit einem Wiki verknüpfen.');
  if (!s.wikiProviders.some((entry) => entry.id === provider.value)) return azure.value ? t('Aktiviere das Azure-DevOps-Plugin in den Plugin-Einstellungen, um Seiten mit dem Wiki zu verknüpfen.') : confluenceOnly.value ? t('Aktiviere das Confluence-Plugin in den Plugin-Einstellungen, um Seiten mit Confluence zu verknüpfen.') : t('Aktiviere das Confluence- oder das Azure-DevOps-Plugin in den Plugin-Einstellungen, um Seiten mit einem Wiki zu verknüpfen.');
  if (!s.file.handle || !s.pluginSettings?.projectFolder) return confluenceOnly.value ? t('Speichere das Diagramm lokal, um seine Seiten mit Confluence zu verknüpfen.') : t('Speichere das Diagramm lokal, um seine Seiten mit einem Wiki zu verknüpfen.');
  return '';
});

const query = ref('');
/** The results belong to the search of this dialog; an earlier search elsewhere is not shown as an answer here. */
const results = ref<readonly WikiPageSummary[] | null>(null);
const pending = ref(false);
const feedback = ref<{ kind: 'info' | 'error'; text: string } | null>(null);
const busy = computed(() => pending.value || s.pluginBusy);
let session = 0;

/** Runs a store action and shows what it reported inside the dialog; the notices of the app lie behind it. */
async function run(action: () => Promise<unknown>, success: string): Promise<boolean> {
  if (busy.value) return false;
  const current = session; const lastNotice = s.notices.at(-1)?.id;
  pending.value = true; feedback.value = null;
  try {
    const result = await action();
    if (current !== session) return false;
    const notice = s.notices.at(-1);
    const failed = result === false || (notice && notice.id !== lastNotice && notice.kind === 'error');
    feedback.value = failed
      ? { kind: 'error', text: notice && notice.id !== lastNotice ? notice.text : t('Die Aktion konnte nicht abgeschlossen werden.') }
      : success ? { kind: 'info', text: success } : null;
    return !failed;
  } catch (error) {
    if (current === session) feedback.value = { kind: 'error', text: tm(error instanceof Error ? error.message : t('Die Aktion konnte nicht abgeschlossen werden.')) };
    return false;
  } finally { if (current === session) pending.value = false; }
}

async function search(): Promise<void> {
  let found: WikiPageSummary[] | null = null;
  if (await run(async () => { found = await store.searchWikiPages(provider.value, query.value); return found !== null; }, '')) results.value = found;
}
async function linkTo(target: WikiPageSummary): Promise<void> {
  const id = diagramPageId.value;
  if (!id) return;
  if (await run(() => store.setWikiPageLink(id, target.provider, target.id), t('Verknüpft. Änderungen an dieser Seite werden automatisch übertragen.'))) {
    // "Synchronize now" is where the user goes on, but it is disabled while the first publication runs.
    awaitingSync = true;
    void nextTick(keepFocus);
  }
}

/**
 * Controls are disabled while something runs, and a disabled control cannot hold the focus: it would fall to the
 * page behind the dialog. This brings it back, to "synchronize now" as soon as that can be used after linking.
 */
let awaitingSync = false;
/** Where this function parked the focus itself; from there it may move it on, from anywhere else the user decided. */
let parked: HTMLElement | null = null;
function keepFocus(): void {
  const root = dialog.value;
  if (!diagramPageId.value || !root?.open) return;
  const active = document.activeElement instanceof HTMLElement ? document.activeElement : null;
  // A control that was just disabled may still be reported as focused; it cannot keep the focus.
  const lost = !active || active === document.body || !root.contains(active) || active.matches(':disabled');
  if (!lost && active !== parked) { awaitingSync = false; parked = null; return; }
  const syncButton = root.querySelector<HTMLButtonElement>('[data-testid="confluence-link-sync-now"]');
  const sync = syncButton && !syncButton.disabled ? syncButton : null;
  // "Synchronize now" is disabled for the length of a publication; the focus it held returns to it afterwards.
  if (lost && active === syncButton) awaitingSync = true;
  if (awaitingSync && sync) { awaitingSync = false; parked = null; sync.focus(); return; }
  if (!lost) return;
  parked = sync ?? root.querySelector<HTMLElement>('[data-testid="confluence-link-open"]') ?? root.querySelector<HTMLElement>('[data-testid="confluence-page-link-search"]') ?? root.querySelector<HTMLElement>('.sd-panel-close');
  parked?.focus();
}
async function unlink(): Promise<void> {
  const id = diagramPageId.value;
  if (!id) return;
  // The card is gone afterwards; the focus goes to the search, where the next step is.
  const current = link.value?.provider ?? provider.value;
  if (await run(() => store.setWikiPageLink(id, current, null), current === 'azure-devops' ? t('Verknüpfung gelöst. Das Bild auf der Wiki-Seite bleibt, bis du es dort entfernst.') : t('Verknüpfung gelöst. Das Bild auf der Confluence-Seite bleibt, bis du es dort entfernst.'))) void nextTick(() => searchField.value?.focus());
}
function close(): void { store.closeConfluencePageLink(); }

watch(diagramPageId, async (id) => {
  await nextTick();
  if (id) {
    opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    session++; query.value = ''; results.value = null; feedback.value = null; pending.value = false; awaitingSync = false; parked = null;
    if (!dialog.value?.open) dialog.value?.showModal();
    await nextTick();
    if (link.value) dialog.value?.querySelector<HTMLElement>('[data-testid="confluence-link-sync-now"]')?.focus();
    else if (!blocked.value) searchField.value?.focus();
  } else {
    session++;
    if (dialog.value?.open) dialog.value.close();
    if (opener?.isConnected) opener.focus();
    opener = null;
  }
}, { immediate: true });
watch([busy, () => status.value.state, link], () => { void nextTick(keepFocus); }, { flush: 'post' });
// A page that was deleted while its dialog is open has nothing left to link.
watch(page, (current) => { if (diagramPageId.value && !current) close(); });
onBeforeUnmount(() => dialog.value?.close());
</script>

<template>
  <dialog ref="dialog" class="page-link-dialog" data-testid="confluence-page-link-dialog" aria-labelledby="page-link-title" @cancel.prevent="close" @pointerdown.self="close" @keydown.stop="dialog && wrapTabFocus($event, dialog)">
    <div v-if="page" class="page-link-panel sd-panel">
      <header><h2 id="page-link-title" class="sd-panel-title">{{ confluenceOnly ? t('Confluence-Seite für „{page}“', { page: tm(page.name) }) : t('Wiki-Seite für „{page}“', { page: tm(page.name) }) }}</h2><AppIconButton class="sd-panel-close" icon="close" :label="t('Dialog schließen')" @click="close" /></header>
      <p class="copy">{{ azure ? t('Sketchdraw zeigt diese Seite als Bild auf der gewählten Seite des Azure-DevOps-Wikis und hält es nach jeder Änderung aktuell. Andere Inhalte der Wiki-Seite bleiben unverändert.') : t('Sketchdraw zeigt diese Seite als Bild auf der gewählten Confluence-Seite und hält es nach jeder Änderung aktuell. Andere Inhalte der Confluence-Seite bleiben unverändert.') }}</p>

      <p v-if="feedback" class="feedback" :class="{ error: feedback.kind === 'error' }" :role="feedback.kind === 'error' ? 'alert' : 'status'" data-testid="confluence-page-link-feedback">{{ feedback.text }}</p>
      <p v-if="blocked" class="blocked" role="status" data-testid="confluence-page-link-blocked">{{ blocked }}</p>
      <template v-else>
        <ConfluenceLinkCard
          v-if="link"
          :title="link.pageTitle"
          :site-url="link.siteUrl"
          :status="status"
          :busy="busy"
          :provider="link.provider"
          v-bind="link.lastSyncedAt ? { lastSyncedAt: link.lastSyncedAt } : {}"
          @sync="store.syncConfluencePage(link.diagramPageId)"
          @open="store.openDocumentationLink(link.pageUrl)"
          @unlink="unlink"
        />
        <section class="choose" aria-labelledby="page-link-choose">
          <h3 id="page-link-choose">{{ azure ? (link ? t('Andere Wiki-Seite wählen') : t('Wiki-Seite wählen')) : link ? t('Andere Confluence-Seite wählen') : t('Confluence-Seite wählen') }}</h3>
          <AppSelect v-if="!link && providerOptions.length > 1" id="page-link-wiki" data-testid="page-link-wiki" :label="t('Wiki')" :model-value="provider" :options="providerOptions" :disabled="busy" @update:model-value="chosen = $event as WikiProviderId; results = null" />
          <form class="search-row" @submit.prevent="search">
            <AppTextField ref="searchField" v-model="query" type="search" data-testid="confluence-page-link-search" :placeholder="t('Seiten suchen')" :aria-label="azure ? t('Wiki-Seiten suchen') : t('Confluence-Seiten suchen')" />
            <AppButton type="submit" :disabled="busy">{{ t('Suchen') }}</AppButton>
          </form>
          <ul v-if="results?.length" class="results" data-testid="confluence-page-link-results">
            <li v-for="target in results" :key="target.id">
              <div><strong>{{ target.title }}</strong><span>{{ link?.pageId === target.id ? t('Mit dieser Seite verknüpft') : target.detail }}</span></div>
              <AppButton :disabled="busy || link?.pageId === target.id" :aria-label="t('„{page}“ mit „{title}“ verknüpfen', { page: tm(page.name), title: target.title })" @click="linkTo(target)">{{ t('Verknüpfen') }}</AppButton>
            </li>
          </ul>
          <p v-else class="empty">{{ azure ? (results ? t('Keine Wiki-Seite gefunden.') : t('Suche nach dem Namen oder Pfad der Wiki-Seite, auf der diese Seite erscheinen soll.')) : results ? t('Keine Confluence-Seite gefunden.') : t('Suche nach dem Titel der Confluence-Seite, auf der diese Seite erscheinen soll.') }}</p>
        </section>
      </template>

      <p class="note"><AppIcon name="info" /><span>{{ t('Die Übertragung läuft, solange die Desktop-App mit diesem Diagramm geöffnet ist. Die Verknüpfung gilt für dieses Profil auf diesem Gerät und wird nicht im Diagramm gespeichert.') }}</span></p>
    </div>
  </dialog>
</template>

<style scoped>
.page-link-dialog{width:min(560px,calc(100vw - 32px));max-height:calc(100dvh - 32px);padding:0;border:0;background:transparent;color:var(--text-primary);overflow:visible}
.page-link-dialog::backdrop{background:var(--scrim)}
.page-link-panel{display:flex;flex-direction:column;gap:var(--space-3);max-height:calc(100dvh - 32px);overflow:auto;padding:20px}
header{display:flex;align-items:flex-start;justify-content:space-between;gap:var(--space-3)}
header h2{margin:0;overflow-wrap:anywhere}
.copy,.empty,.blocked{margin:0;color:var(--text-muted);font-size:var(--font-size-s);line-height:1.5}
.blocked{padding:var(--space-3);border-radius:var(--radius-1);background:var(--surface-raised);color:var(--text-primary)}
.feedback{margin:0;padding:var(--space-2) var(--space-3);border-radius:var(--radius-1);background:var(--surface-raised);font-size:var(--font-size-s);line-height:1.5}
.feedback.error{background:var(--status-error-soft);color:var(--status-error)}
.choose{display:grid;gap:var(--space-2)}
.choose h3{margin:0;font-size:var(--font-size-m);font-weight:650}
.search-row{display:flex;gap:var(--space-2)}
.search-row :deep(.sd-input){flex:1;min-width:0}
.results{display:grid;gap:var(--space-1);max-height:240px;margin:0;padding:0;overflow:auto;list-style:none}
.results li{display:flex;align-items:center;justify-content:space-between;gap:var(--space-3);padding:var(--space-2) var(--space-3);border:1px solid var(--border-subtle);border-radius:var(--radius-1)}
.results li div{display:grid;gap:2px;min-width:0}
.results strong{overflow-wrap:anywhere;font-size:var(--font-size-m)}
.results span{color:var(--text-muted);font-size:var(--font-size-s)}
.results li>:last-child{flex:none}
.note{display:flex;gap:var(--space-2);margin:0;color:var(--text-muted);font-size:var(--font-size-s);line-height:1.5}
.note :deep(svg){width:var(--space-4);height:var(--space-4);flex:0 0 auto;margin-top:1px;color:var(--accent)}
@media(max-width:480px){.results li{flex-wrap:wrap}}
</style>

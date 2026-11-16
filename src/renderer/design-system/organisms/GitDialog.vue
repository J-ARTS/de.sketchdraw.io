<!-- @component The modal Git dialog of the Git plugin: see and commit changes, push, fetch the remote state, go back to an old state of the diagram and switch the automatic steps. Opened by the Git button beside help. -->
<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, ref, watch } from 'vue';
import type { GitChange, GitChangeStatus, GitCommitSummary, GitFileDiff, GitWorkbenchResult, GitWorkbenchSnapshot } from '@/domain';
import AppButton from '@/renderer/design-system/atoms/AppButton.vue';
import AppIcon from '@/renderer/design-system/atoms/AppIcon.vue';
import AppIconButton from '@/renderer/design-system/atoms/AppIconButton.vue';
import AppSwitch from '@/renderer/design-system/atoms/AppSwitch.vue';
import AppTextarea from '@/renderer/design-system/atoms/AppTextarea.vue';
import { useWhiteboard } from '@/renderer/design-system/composables/use-whiteboard';
import DiffView from '@/renderer/design-system/molecules/DiffView.vue';
import { intlLocale, L, t, tn } from '@/renderer/i18n';
import { wrapTabFocus } from '@/renderer/lib/focus';
import type { GitAnswer } from '@/renderer/state/contract';

/**
 * The dialog asks the store for everything and keeps only what it shows. It is modal, so results and failures
 * appear in its own status line instead of the notices of the workspace behind it.
 */
const props = defineProps<{
  /** Whether the dialog is shown. */
  open: boolean;
}>();
const emit = defineEmits<{
  /** The user closed the dialog. */
  close: [];
}>();
const store = useWhiteboard();
const s = store.state;

type Tab = 'changes' | 'history' | 'automation';
type Work = '' | 'load' | 'commit' | 'push' | 'update' | 'discard' | 'restore' | 'automation' | 'save';
const TABS: Array<{ id: Tab; label: string }> = [{ id: 'changes', label: L('Änderungen') }, { id: 'history', label: L('Verlauf') }, { id: 'automation', label: L('Automatik') }];
const STATUS: Record<GitChangeStatus, { letter: string; label: string }> = {
  modified: { letter: 'M', label: L('Geändert') }, added: { letter: 'A', label: L('Neu') }, deleted: { letter: 'D', label: L('Gelöscht') },
  untracked: { letter: '?', label: L('Nicht versioniert') }, conflicted: { letter: '!', label: L('Konflikt') },
};

const dialog = ref<HTMLDialogElement | null>(null);
const closeButton = ref<InstanceType<typeof AppIconButton> | null>(null);
let opener: HTMLElement | null = null;

const tab = ref<Tab>('changes');
const work = ref<Work>('');
const workbench = ref<GitWorkbenchSnapshot | null>(null);
const loadError = ref('');
const status = ref<{ ok: boolean; text: string } | null>(null);
const checked = ref<Set<string>>(new Set());
const activePath = ref<string | null>(null);
const diff = ref<GitFileDiff | null>(null);
const diffError = ref('');
const message = ref('');
const confirm = ref<null | { kind: 'discard'; paths: string[] } | { kind: 'restore'; commit: GitCommitSummary }>(null);
const commits = ref<GitCommitSummary[] | null>(null);
const historyError = ref('');
const documentOnly = ref(true);
const activeCommit = ref<GitCommitSummary | null>(null);
const commitDiff = ref<GitFileDiff | null>(null);
let diffRequest = 0;

const git = computed(() => s.pluginSettings?.git ?? null);
const hasProject = computed(() => Boolean(s.file.handle && s.pluginSettings?.projectFolder));
const unsaved = computed(() => s.saveStatus === 'dirty');
const busy = computed(() => work.value !== '');
const changes = computed(() => workbench.value?.changes ?? []);
const checkedPaths = computed(() => changes.value.filter((change) => checked.value.has(change.path)).map((change) => change.path));
const committable = computed(() => checkedPaths.value.length > 0 && message.value.trim().length > 0 && !changes.value.some((change) => checked.value.has(change.path) && change.status === 'conflicted'));
const discardable = computed(() => changes.value.filter((change) => checked.value.has(change.path) && change.status !== 'untracked').map((change) => change.path));
const allChecked = computed(() => changes.value.length > 0 && checkedPaths.value.length === changes.value.length);
const activeChange = computed(() => changes.value.find((change) => change.path === activePath.value) ?? null);
const when = (date: string): string => { const value = new Date(date); return Number.isNaN(value.getTime()) ? '' : new Intl.DateTimeFormat(intlLocale(), { dateStyle: 'medium', timeStyle: 'short' }).format(value); };
const fileName = (path: string): string => path.slice(path.lastIndexOf('/') + 1);
const folderOf = (path: string): string => path.includes('/') ? path.slice(0, path.lastIndexOf('/') + 1) : '';

/**
 * An action can remove the control that started it (the last file is committed, a question is answered). The
 * focus then stays in the dialog, on the selected tab or the close button, so that the keyboard keeps working.
 */
async function keepFocus(): Promise<void> {
  await nextTick();
  if (!props.open || !dialog.value || dialog.value.contains(document.activeElement)) return;
  (dialog.value.querySelector<HTMLElement>('[role="tab"][aria-selected="true"]') ?? dialog.value.querySelector<HTMLElement>('.sd-panel-close'))?.focus();
}

/** Takes over a new state of the repository; ticks and the shown file stay where they still apply. */
function adopt(next: GitWorkbenchSnapshot, preselect = false): void {
  workbench.value = next;
  const known = new Set(next.changes.map((change) => change.path));
  const kept = new Set([...checked.value].filter((path) => known.has(path)));
  if (preselect && known.has(next.documentPath)) kept.add(next.documentPath);
  checked.value = kept;
  if (!activePath.value || !known.has(activePath.value)) activePath.value = next.changes[0]?.path ?? null;
  void showDiff();
}

async function load(preselect = false): Promise<void> {
  if (!hasProject.value) { workbench.value = null; loadError.value = ''; return; }
  work.value = 'load'; loadError.value = '';
  const answer = await store.gitWorkbench();
  work.value = '';
  if (answer.ok) adopt(answer.value, preselect); else { workbench.value = null; loadError.value = answer.message; }
  await keepFocus();
}

async function showDiff(): Promise<void> {
  const request = ++diffRequest; const path = activePath.value;
  diffError.value = '';
  if (!path) { diff.value = null; return; }
  const answer = await store.gitDiff(path);
  if (request !== diffRequest) return;
  if (answer.ok) diff.value = answer.value; else { diff.value = null; diffError.value = answer.message; }
}

function toggle(path: string, on: boolean): void { const next = new Set(checked.value); if (on) next.add(path); else next.delete(path); checked.value = next; }
function toggleAll(on: boolean): void { checked.value = on ? new Set(changes.value.map((change) => change.path)) : new Set(); }
function choose(change: GitChange): void { activePath.value = change.path; void showDiff(); }

/** Runs one changing action and shows what came of it. */
async function run(kind: Work, action: () => Promise<GitAnswer<GitWorkbenchResult>>): Promise<boolean> {
  if (busy.value) return false;
  work.value = kind; status.value = null; confirm.value = null;
  const answer = await action();
  work.value = '';
  if (!answer.ok) { status.value = { ok: false, text: answer.message }; await keepFocus(); return false; }
  status.value = { ok: answer.value.ok, text: answer.value.message };
  commits.value = null; activeCommit.value = null; commitDiff.value = null;
  adopt(answer.value.workbench);
  if (tab.value === 'history') void loadHistory();
  await keepFocus();
  return answer.value.ok;
}

async function commit(push: boolean): Promise<void> {
  if (!committable.value) return;
  if (await run('commit', () => store.gitCommit(message.value, checkedPaths.value, push))) message.value = '';
}
const push = (): Promise<boolean> => run('push', () => store.gitPush());
const update = (): Promise<boolean> => run('update', () => store.gitUpdate());
async function discard(): Promise<void> { const paths = confirm.value?.kind === 'discard' ? confirm.value.paths : []; if (paths.length) await run('discard', () => store.gitDiscard(paths)); }
async function restore(): Promise<void> {
  const commitToRestore = confirm.value?.kind === 'restore' ? confirm.value.commit : null;
  if (commitToRestore && await run('restore', () => store.gitRestoreDocument(commitToRestore.hash))) tab.value = 'changes';
}
/** Saving from the dialog is how a new diagram gets its folder; the first look at the repository then ticks the diagram. */
async function save(): Promise<void> { if (busy.value) return; const first = !workbench.value; work.value = 'save'; await store.save(); work.value = ''; await load(first); }

async function loadHistory(): Promise<void> {
  historyError.value = '';
  const answer = await store.gitLog(documentOnly.value);
  if (!answer.ok) { commits.value = []; historyError.value = answer.message; return; }
  commits.value = answer.value;
  const current = answer.value.find((entry) => entry.hash === activeCommit.value?.hash) ?? answer.value[0] ?? null;
  await chooseCommit(current);
}
async function chooseCommit(entry: GitCommitSummary | null): Promise<void> {
  activeCommit.value = entry; commitDiff.value = null; confirm.value = null;
  const path = workbench.value?.documentPath;
  if (!entry || !path) return;
  const answer = await store.gitDiff(path, entry.hash);
  if (activeCommit.value?.hash === entry.hash) commitDiff.value = answer.ok ? answer.value : null;
}

async function setAutomation(key: 'autoCommit' | 'autoPush' | 'autoPull', value: boolean): Promise<void> {
  const current = git.value; if (!current || busy.value) return;
  work.value = 'automation'; status.value = null;
  const answer = await store.setGitAutomation({ autoCommit: current.autoCommit, autoPush: current.autoPush, autoPull: current.autoPull, [key]: value });
  work.value = '';
  status.value = answer.ok ? { ok: true, text: t('Automatik gespeichert.') } : { ok: false, text: answer.message };
  await keepFocus();
}

function selectTab(next: Tab): void { tab.value = next; confirm.value = null; if (next === 'history' && commits.value === null && workbench.value) void loadHistory(); }
function onTabKey(event: KeyboardEvent): void {
  const step = event.key === 'ArrowRight' ? 1 : event.key === 'ArrowLeft' ? -1 : 0;
  if (!step) return;
  event.preventDefault();
  const next = TABS[(TABS.findIndex((entry) => entry.id === tab.value) + step + TABS.length) % TABS.length]!;
  selectTab(next.id);
  void nextTick(() => dialog.value?.querySelector<HTMLElement>(`#git-tab-${next.id}`)?.focus());
}

watch(documentOnly, () => { if (tab.value === 'history') void loadHistory(); });
watch(() => props.open, async (open) => {
  await nextTick();
  if (open) {
    opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    tab.value = 'changes'; status.value = null; confirm.value = null; commits.value = null; activeCommit.value = null; commitDiff.value = null; checked.value = new Set(); activePath.value = null; diff.value = null;
    if (!dialog.value?.open) dialog.value?.showModal();
    closeButton.value?.focus();
    await load(true);
  } else {
    dialog.value?.close();
    // The Git button is rebuilt when a first save gives the diagram its project; the focus then goes to the new one.
    (opener?.isConnected ? opener : document.querySelector<HTMLElement>('[data-git-opener]'))?.focus();
    opener = null;
  }
}, { immediate: true });
onBeforeUnmount(() => dialog.value?.close());
</script>

<template>
  <dialog ref="dialog" class="git-dialog" data-testid="git-dialog" aria-labelledby="git-title" @cancel.prevent="emit('close')" @pointerdown.self="emit('close')" @keydown.stop="dialog && wrapTabFocus($event, dialog)">
    <div class="git-panel sd-panel">
      <header class="git-header">
        <h2 id="git-title" class="sd-panel-title">{{ t('Git') }}</h2>
        <p v-if="workbench && git" class="repository" data-testid="git-repository">
          <span class="repository-name">{{ git.repositoryName }}</span>
          <span class="branch"><AppIcon name="git" :size="14" />{{ git.branch }}</span>
          <span class="count" :title="tn(git.ahead ?? 0, '{count} Commit noch nicht gepusht', '{count} Commits noch nicht gepusht')"><AppIcon name="arrow-up" :size="14" /><span aria-hidden="true">{{ git.ahead ?? 0 }}</span><span class="visually-hidden">{{ tn(git.ahead ?? 0, '{count} Commit noch nicht gepusht', '{count} Commits noch nicht gepusht') }}</span></span>
          <span class="count" :title="tn(git.behind ?? 0, '{count} neuer Commit auf dem Remote', '{count} neue Commits auf dem Remote')"><AppIcon name="arrow-down" :size="14" /><span aria-hidden="true">{{ git.behind ?? 0 }}</span><span class="visually-hidden">{{ tn(git.behind ?? 0, '{count} neuer Commit auf dem Remote', '{count} neue Commits auf dem Remote') }}</span></span>
        </p>
        <div class="header-actions">
          <AppButton v-if="workbench" data-testid="git-update" :disabled="busy" @click="update"><AppIcon name="arrow-down" :size="16" />{{ t('Aktualisieren') }}</AppButton>
          <AppButton v-if="workbench" data-testid="git-push" :disabled="busy || !(git?.ahead)" @click="push"><AppIcon name="arrow-up" :size="16" />{{ t('Pushen') }}</AppButton>
          <AppIconButton ref="closeButton" class="sd-panel-close" icon="close" :label="t('Git schließen')" @click="emit('close')" />
        </div>
      </header>

      <div v-if="!hasProject" class="blank" data-testid="git-blank">
        <p class="blank-title">{{ t('Dieses Diagramm liegt noch in keinem Ordner.') }}</p>
        <p>{{ t('Speichere es in dem Ordner deines Repositorys, dann zeigt Git hier seine Änderungen.') }}</p>
        <AppButton intent="primary" :disabled="busy" @click="save">{{ t('Diagramm speichern') }}</AppButton>
      </div>
      <div v-else-if="loadError" class="blank" role="alert" data-testid="git-load-error">
        <p class="blank-title">{{ t('Git kann dieses Repository nicht lesen.') }}</p>
        <p>{{ loadError }}</p>
        <AppButton :disabled="busy" @click="load(true)">{{ t('Erneut versuchen') }}</AppButton>
      </div>
      <div v-else-if="!workbench" class="blank"><p>{{ t('Git liest das Repository …') }}</p></div>

      <template v-else>
        <div class="tabs" role="tablist" :aria-label="t('Bereiche des Git-Dialogs')" @keydown="onTabKey">
          <button v-for="entry in TABS" :id="`git-tab-${entry.id}`" :key="entry.id" type="button" role="tab" class="tab" :aria-selected="tab === entry.id" :aria-controls="`git-panel-${entry.id}`" :tabindex="tab === entry.id ? 0 : -1" @click="selectTab(entry.id)">
            {{ t(entry.label) }}<span v-if="entry.id === 'changes' && changes.length" class="tab-count">{{ changes.length }}</span>
          </button>
        </div>

        <section v-show="tab === 'changes'" id="git-panel-changes" class="pane" role="tabpanel" aria-labelledby="git-tab-changes">
          <p v-if="!changes.length" class="blank-inline" data-testid="git-clean">{{ t('Keine Änderungen. Alles ist committet.') }}</p>
          <template v-else>
            <div class="side">
              <div class="selection">
                <label class="select-all"><input type="checkbox" :checked="allChecked" :indeterminate="!allChecked && checkedPaths.length > 0" @change="toggleAll(($event.target as HTMLInputElement).checked)"><span>{{ t('{count} von {total} Dateien ausgewählt', { count: checkedPaths.length, total: changes.length }) }}</span></label>
                <AppButton class="discard" intent="danger" data-testid="git-discard" :disabled="busy || !discardable.length" @click="confirm = { kind: 'discard', paths: discardable }">{{ t('Verwerfen') }}</AppButton>
              </div>
              <ul class="files" data-testid="git-changes">
                <li v-for="change in changes" :key="change.path" class="file" :class="{ active: change.path === activePath }">
                  <input type="checkbox" :checked="checked.has(change.path)" :aria-label="t('{name} für den Commit auswählen', { name: change.path })" @change="toggle(change.path, ($event.target as HTMLInputElement).checked)">
                  <button type="button" class="file-open" :aria-current="change.path === activePath ? 'true' : undefined" @click="choose(change)">
                    <span class="file-status" :class="`is-${change.status}`" :title="t(STATUS[change.status].label)"><span aria-hidden="true">{{ STATUS[change.status].letter }}</span><span class="visually-hidden">{{ t(STATUS[change.status].label) }}</span></span>
                    <span class="file-name" :title="change.path"><span v-if="folderOf(change.path)" class="file-folder">{{ folderOf(change.path) }}</span><span class="file-base">{{ fileName(change.path) }}</span></span>
                    <span v-if="change.document" class="file-tag">{{ t('Dieses Diagramm') }}</span>
                  </button>
                </li>
              </ul>
              <p v-if="unsaved" class="hint warning" data-testid="git-unsaved"><AppIcon name="warning" :size="16" /><span>{{ t('Das Diagramm hat ungespeicherte Änderungen. Sie stehen noch nicht in der Datei.') }}</span><AppButton :disabled="busy" @click="save">{{ t('Speichern') }}</AppButton></p>
              <label class="message-label" for="git-message">{{ t('Commit-Nachricht') }}</label>
              <AppTextarea id="git-message" v-model="message" class="message" rows="3" maxlength="2000" :placeholder="t('Was hat sich geändert?')" @keydown.ctrl.enter.prevent="commit(false)" @keydown.meta.enter.prevent="commit(false)" />
              <div class="commit-actions">
                <AppButton intent="primary" data-testid="git-commit" :disabled="busy || !committable" @click="commit(false)">{{ t('Committen') }}</AppButton>
                <AppButton data-testid="git-commit-push" :disabled="busy || !committable" @click="commit(true)">{{ t('Committen und pushen') }}</AppButton>
              </div>
            </div>
            <div class="main">
              <p class="main-title">{{ activeChange ? activeChange.path : t('Änderungen') }}</p>
              <p v-if="diffError" class="hint error" role="alert">{{ diffError }}</p>
              <DiffView v-else :diff="diff" :label="activeChange ? t('Änderungen an {name}', { name: activeChange.path }) : t('Änderungen')" />
            </div>
          </template>
        </section>

        <section v-show="tab === 'history'" id="git-panel-history" class="pane" role="tabpanel" aria-labelledby="git-tab-history">
          <div class="side">
            <AppSwitch v-model="documentOnly" class="only-document">{{ t('Nur dieses Diagramm') }}</AppSwitch>
            <p v-if="historyError" class="hint error" role="alert">{{ historyError }}</p>
            <p v-else-if="commits && !commits.length" class="blank-inline">{{ t('Noch keine Commits.') }}</p>
            <ul v-else class="commits" data-testid="git-history">
              <li v-for="entry in commits ?? []" :key="entry.hash">
                <button type="button" class="commit" :aria-current="entry.hash === activeCommit?.hash ? 'true' : undefined" @click="chooseCommit(entry)">
                  <span class="commit-subject">{{ entry.subject }}</span>
                  <span class="commit-meta">{{ entry.author }}, {{ when(entry.date) }}</span>
                  <span class="commit-foot"><span class="commit-hash">{{ entry.shortHash }}</span><span v-if="!entry.pushed" class="file-tag">{{ t('nicht gepusht') }}</span></span>
                </button>
              </li>
            </ul>
          </div>
          <div class="main">
            <template v-if="activeCommit">
              <div class="main-head">
                <p class="main-title">{{ activeCommit.subject }}</p>
                <AppButton data-testid="git-restore" :disabled="busy || unsaved" @click="confirm = { kind: 'restore', commit: activeCommit }"><AppIcon name="history" :size="16" />{{ t('Diagramm auf diesen Stand zurücksetzen') }}</AppButton>
              </div>
              <p v-if="unsaved" class="hint warning"><AppIcon name="warning" :size="16" /><span>{{ t('Speichere das Diagramm, bevor du es auf einen alten Stand zurücksetzt.') }}</span><AppButton :disabled="busy" @click="save">{{ t('Speichern') }}</AppButton></p>
              <DiffView :diff="commitDiff" :label="t('Änderungen am Diagramm in {hash}', { hash: activeCommit.shortHash })" :empty-text="t('Dieser Commit hat das Diagramm nicht geändert.')" />
            </template>
            <p v-else class="blank-inline">{{ t('Wähle einen Commit, um zu sehen, was er am Diagramm geändert hat.') }}</p>
          </div>
        </section>

        <section v-show="tab === 'automation'" id="git-panel-automation" class="pane single" role="tabpanel" aria-labelledby="git-tab-automation">
          <div v-if="git" class="automation">
            <AppSwitch data-testid="git-auto-commit" :model-value="git.autoCommit" :disabled="busy" @update:model-value="setAutomation('autoCommit', $event)">{{ t('Beim Speichern committen') }}<template #description>{{ t('Jedes Speichern des Diagramms wird ein Commit.') }}</template></AppSwitch>
            <AppSwitch data-testid="git-auto-push" :model-value="git.autoPush" :disabled="busy" @update:model-value="setAutomation('autoPush', $event)">{{ t('Nach dem Speichern pushen') }}<template #description>{{ t('Nach jedem Speichern gehen die Commits an den Remote „{remote}“.', { remote: git.remote }) }}</template></AppSwitch>
            <AppSwitch data-testid="git-auto-sync" :model-value="git.autoPull" :disabled="busy" @update:model-value="setAutomation('autoPull', $event)">{{ t('Automatisch synchronisieren') }}<template #description>{{ t('Holt jede Minute neue Commits vom Remote und lädt das Diagramm neu.') }}</template></AppSwitch>
            <p class="hint">{{ t('Remote und Anmeldung stellst du in den Plugin-Einstellungen ein.') }}</p>
          </div>
        </section>

        <div v-if="confirm" class="confirm" role="group" aria-labelledby="git-confirm-text" data-testid="git-confirm">
          <p id="git-confirm-text" role="alert">{{ confirm.kind === 'discard'
            ? tn(confirm.paths.length, '{count} Datei auf den letzten Commit zurücksetzen? Die Änderungen sind danach weg.', '{count} Dateien auf den letzten Commit zurücksetzen? Die Änderungen sind danach weg.')
            : t('Das Diagramm auf den Stand von {hash} zurücksetzen? Der jetzige Stand bleibt im Verlauf, und du hältst den alten mit einem Commit fest.', { hash: confirm.commit.shortHash }) }}</p>
          <AppButton @click="confirm = null; keepFocus()">{{ t('Abbrechen') }}</AppButton>
          <AppButton v-if="confirm.kind === 'discard'" intent="danger" data-testid="git-confirm-discard" @click="discard">{{ t('Verwerfen') }}</AppButton>
          <AppButton v-else intent="primary" data-testid="git-confirm-restore" @click="restore">{{ t('Zurücksetzen') }}</AppButton>
        </div>
      </template>

      <p class="status" :class="status ? (status.ok ? 'is-ok' : 'is-error') : ''" role="status" aria-live="polite" data-testid="git-status">
        <template v-if="busy && work !== 'load'">{{ t('Git arbeitet …') }}</template>
        <template v-else-if="status"><AppIcon :name="status.ok ? 'check' : 'warning'" :size="16" />{{ status.text }}</template>
        <template v-else-if="workbench && git">{{ git.message }}</template>
      </p>
    </div>
  </dialog>
</template>

<style scoped>
.git-dialog{width:min(1040px,calc(100vw - 32px));height:min(700px,calc(100dvh - 32px));max-width:none;max-height:none;padding:0;border:0;background:transparent;color:var(--text-primary);overflow:visible}
.git-dialog::backdrop{background:var(--scrim)}
.git-panel{display:flex;flex-direction:column;gap:var(--space-3);height:100%;padding:var(--space-4) var(--space-5) var(--space-3)}
.git-header{display:flex;align-items:center;gap:var(--space-4);min-height:var(--chrome-control)}
.repository{display:flex;align-items:center;gap:var(--space-3);min-width:0;margin:0;color:var(--text-muted);font-size:var(--font-size-m)}
.repository-name{overflow:hidden;color:var(--text-primary);font-weight:600;text-overflow:ellipsis;white-space:nowrap}
.branch,.count{display:inline-flex;align-items:center;gap:4px;white-space:nowrap}
.branch{padding:2px var(--space-2);border-radius:999px;background:var(--accent-soft);color:var(--accent-ink);font-family:var(--font-mono);font-size:var(--font-size-s)}
.count{font-variant-numeric:tabular-nums}
.header-actions{display:flex;align-items:center;gap:var(--space-2);margin-left:auto}
.tabs{display:flex;gap:var(--space-1);border-bottom:1px solid var(--border-subtle)}
.tab{display:inline-flex;align-items:center;gap:var(--space-2);min-height:var(--control-size);margin-bottom:-1px;padding:0 var(--space-3);border:0;border-bottom:2px solid transparent;background:transparent;color:var(--text-muted);font:inherit;font-weight:600;cursor:pointer}
.tab:hover{color:var(--text-primary)}
.tab[aria-selected='true']{border-bottom-color:var(--accent);color:var(--accent-ink)}
.tab:focus-visible{outline:2px solid var(--focus-ring);outline-offset:-2px;border-radius:var(--radius-1)}
.tab-count{min-width:20px;padding:0 6px;border-radius:999px;background:var(--accent-soft);color:var(--accent-ink);font-size:var(--font-size-s);line-height:20px;text-align:center}
.pane{display:grid;grid-template-columns:minmax(260px,340px) minmax(0,1fr);gap:var(--space-4);flex:1;min-height:0}
.pane.single{grid-template-columns:minmax(0,560px)}
.side,.main{display:flex;flex-direction:column;gap:var(--space-2);min-width:0;min-height:0}
.main :deep(.diff-view){flex:1}
.main-head{display:flex;align-items:center;justify-content:space-between;gap:var(--space-3)}
.main-title{overflow:hidden;margin:0;font-weight:600;text-overflow:ellipsis;white-space:nowrap}
.selection{display:flex;align-items:center;justify-content:space-between;gap:var(--space-2);min-height:var(--control-size)}
.select-all{display:flex;align-items:center;gap:var(--space-2);padding:0 var(--space-2);color:var(--text-muted);font-size:var(--font-size-m)}
input[type='checkbox']{flex:none;width:16px;height:16px;margin:0;accent-color:var(--accent)}
.files,.commits{flex:1;min-height:72px;margin:0;padding:var(--space-1);overflow:auto;border:1px solid var(--border-subtle);border-radius:var(--radius-1);list-style:none}
.file{display:flex;align-items:center;gap:var(--space-2);padding-left:var(--space-2);border-radius:6px}
.file.active{background:var(--menu-selected)}
.file-open{display:flex;align-items:center;gap:var(--space-2);flex:1;min-width:0;min-height:var(--control-size-compact);padding:0 var(--space-2) 0 0;border:0;background:transparent;color:inherit;font:inherit;font-size:var(--font-size-m);text-align:left;cursor:pointer}
.file-open:focus-visible,.commit:focus-visible{outline:2px solid var(--focus-ring);outline-offset:-2px;border-radius:6px}
.file-status{flex:none;width:18px;font-family:var(--font-mono);font-weight:700;text-align:center}
.is-modified{color:var(--accent-ink)}.is-added,.is-untracked{color:var(--status-ok)}.is-deleted,.is-conflicted{color:var(--status-error)}
/* The folder gives way first, so the name of the file stays readable in a narrow list. */
.file-name{display:flex;flex:1;min-width:0;white-space:nowrap}
.file-folder{flex:0 1 auto;min-width:0;overflow:hidden;color:var(--text-muted);text-overflow:ellipsis}
.file-base{flex:0 1 auto;min-width:3ch;overflow:hidden;text-overflow:ellipsis}
.file-tag{flex:none;padding:1px var(--space-2);border-radius:999px;background:var(--accent-soft);color:var(--accent-ink);font-size:11px;font-weight:600;white-space:nowrap}
.message-label{font-size:var(--font-size-m);font-weight:600}
.message{flex:none;width:100%;resize:vertical}
.commit-actions{display:flex;flex-wrap:wrap;gap:var(--space-2)}
.commit{display:grid;gap:2px;width:100%;padding:var(--space-2);border:0;border-radius:6px;background:transparent;color:inherit;font:inherit;text-align:left;cursor:pointer}
.commit:hover{background:var(--menu-hover)}
.commit[aria-current='true']{background:var(--menu-selected)}
.commit-subject{overflow:hidden;font-size:var(--font-size-m);font-weight:600;text-overflow:ellipsis;white-space:nowrap}
.commit-meta{color:var(--text-muted);font-size:var(--font-size-s)}
.commit-foot{display:flex;align-items:center;gap:var(--space-2)}
.commit-hash{color:var(--text-muted);font-family:var(--font-mono);font-size:var(--font-size-s)}
.only-document{padding:var(--space-1) var(--space-2)}
.only-document :deep(.app-switch-label){font-size:var(--font-size-m)}
.automation{display:grid;gap:var(--space-1);align-content:start}
.hint{display:flex;align-items:center;gap:var(--space-2);margin:0;color:var(--text-muted);font-size:var(--font-size-m);line-height:1.45}
.automation .hint{padding:var(--space-3)}
.hint.warning{padding:var(--space-2) var(--space-3);border-radius:var(--radius-1);background:var(--surface-raised);color:var(--text-primary)}
.hint.warning span{flex:1}
.hint.error{color:var(--status-error)}
.blank{display:grid;justify-items:start;align-content:center;gap:var(--space-2);flex:1;max-width:520px;margin:0 auto;color:var(--text-muted)}
.blank p,.blank-inline{margin:0;line-height:1.5}
.blank-title{color:var(--text-primary);font-size:var(--font-size-l);font-weight:600}
.blank-inline{grid-column:1/-1;padding:var(--space-4);color:var(--text-muted)}
.confirm{display:flex;align-items:center;gap:var(--space-2);padding:var(--space-3);border:1px solid var(--border-default);border-radius:var(--radius-1);background:var(--surface-raised)}
.confirm p{flex:1;margin:0;font-size:var(--font-size-m);line-height:1.45}
.status{display:flex;align-items:center;gap:var(--space-2);min-height:24px;margin:0;padding-top:var(--space-2);border-top:1px solid var(--border-subtle);color:var(--text-muted);font-size:var(--font-size-m)}
.status.is-ok{color:var(--status-ok)}
.status.is-error{color:var(--status-error)}
@media(max-width:720px){.pane{grid-template-columns:minmax(0,1fr);overflow:auto}.main :deep(.diff-view){min-height:220px}.repository-name{display:none}}
</style>

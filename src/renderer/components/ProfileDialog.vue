<script setup lang="ts">
import { t, tm } from '@/renderer/i18n';
import { computed, nextTick, onBeforeUnmount, ref, watch } from 'vue';
import { PLUGIN_PROFILE_LIMIT, PLUGIN_PROFILE_NAME_MAX } from '@/domain';
import { wrapTabFocus } from '@/renderer/lib/focus';
import AppIcon from './AppIcon.vue';
import { useWhiteboard } from './use-whiteboard';

/**
 * Manages the plugin profiles of the editor (#168, #169): create, copy, rename, delete and activate. The profile itself is
 * chosen in the workspace menu; what a profile contains is edited in the plugin settings.
 */
type Step = { kind: 'create' } | { kind: 'copy' | 'rename' | 'delete'; id: string };

const props = defineProps<{ open: boolean }>();
const emit = defineEmits<{ close: [] }>();
const store = useWhiteboard();
const s = store.state;
const dialog = ref<HTMLDialogElement | null>(null);
const closeButton = ref<HTMLButtonElement | null>(null);
const nameInput = ref<HTMLInputElement | null>(null);
const confirmButton = ref<HTMLButtonElement | null>(null);
const step = ref<Step | null>(null);
const name = ref('');
const pending = ref(false);
const feedback = ref<{ kind: 'info' | 'error'; text: string } | null>(null);
let opener: HTMLElement | null = null;
let stepOpener: HTMLElement | null = null;
let dialogEpoch = 0;

const profiles = computed(() => s.pluginSettings?.available ? s.pluginSettings.profiles : []);
const activeId = computed(() => s.pluginSettings?.activeProfileId ?? '');
const busy = computed(() => pending.value || s.pluginBusy);
const limitReached = computed(() => profiles.value.length >= PLUGIN_PROFILE_LIMIT);
const target = computed(() => { const current = step.value; return current && current.kind !== 'create' ? profiles.value.find((profile) => profile.id === current.id) ?? null : null; });
const formLabel = computed(() => step.value?.kind === 'rename' ? t('Neuer Name für „{name}“', { name: target.value?.name ?? '' }) : step.value?.kind === 'copy' ? t('Name der Kopie von „{name}“', { name: target.value?.name ?? '' }) : t('Name des neuen Profils'));
const submitLabel = computed(() => step.value?.kind === 'rename' ? t('Umbenennen') : step.value?.kind === 'copy' ? t('Kopie anlegen') : t('Profil anlegen'));

watch(() => props.open, async (open) => {
  dialogEpoch++; pending.value = false; feedback.value = null; resetStep();
  await nextTick();
  if (open) {
    opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    if (!dialog.value?.open) dialog.value?.showModal();
    closeButton.value?.focus();
  } else {
    dialog.value?.close();
    if (opener?.isConnected) opener.focus();
    opener = null;
  }
}, { immediate: true });
// A step about a profile that vanished (deleted elsewhere) has nothing left to act on.
watch(target, (profile) => { if (step.value && step.value.kind !== 'create' && !profile) resetStep(); });
onBeforeUnmount(() => { dialogEpoch++; dialog.value?.close(); });

function resetStep(): void { step.value = null; name.value = ''; stepOpener = null; }
function begin(next: Step, event: Event): void {
  if (busy.value) return;
  const profile = next.kind === 'create' ? null : profiles.value.find((entry) => entry.id === next.id);
  stepOpener = event.currentTarget instanceof HTMLElement ? event.currentTarget : null;
  feedback.value = null;
  name.value = next.kind === 'rename' ? profile?.name ?? '' : next.kind === 'copy' ? t('{name} (Kopie)', { name: profile?.name ?? '' }).slice(0, PLUGIN_PROFILE_NAME_MAX) : '';
  step.value = next;
  void nextTick(() => {
    if (next.kind === 'delete') confirmButton.value?.focus();
    else { nameInput.value?.focus(); nameInput.value?.select(); }
  });
}
/** Focus goes back to where the step started; a row that is gone (deleted, re-rendered) falls back to the dialog itself. */
function finishStep(): void {
  const back = stepOpener;
  resetStep();
  void nextTick(() => { if (back?.isConnected && !back.matches(':disabled')) back.focus(); else closeButton.value?.focus(); });
}
/** The store reports a profile change as a notice behind this modal, so its text is repeated here. */
async function run(action: () => Promise<boolean>, success: string): Promise<boolean> {
  if (busy.value || !s.pluginSettings?.available) return false;
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
async function submit(): Promise<void> {
  const current = step.value; const value = name.value.trim();
  if (!current || current.kind === 'delete' || !value) return;
  const done = await run(
    () => current.kind === 'rename' ? store.renamePluginProfile(current.id, value) : store.createPluginProfile(value, current.kind === 'copy' ? current.id : undefined),
    current.kind === 'rename' ? t('Profil umbenannt.') : current.kind === 'copy' ? t('Profil „{name}“ kopiert.', { name: value }) : t('Profil „{name}“ angelegt.', { name: value }),
  );
  if (done) finishStep();
  else void nextTick(() => nameInput.value?.focus());
}
async function remove(): Promise<void> {
  const current = step.value;
  if (!current || current.kind !== 'delete') return;
  await run(() => store.deletePluginProfile(current.id), t('Profil gelöscht.'));
  finishStep();
}
async function activate(id: string): Promise<void> {
  if (id === activeId.value) return;
  resetStep();
  await run(() => store.selectPluginProfile(id), t('Profil gewechselt.'));
  // The pressed button turned into the "Aktiv" mark; focus stays on that row.
  await nextTick();
  if (props.open) (dialog.value?.querySelector<HTMLElement>('.profile-item.active .row-actions button:not(:disabled)') ?? closeButton.value)?.focus();
}
/** Escape leaves an open step first and the dialog only after that; handled on keydown so the dialog gets no cancel request. */
function onKeydown(event: KeyboardEvent): void {
  if (event.key === 'Escape' && step.value) { event.preventDefault(); finishStep(); return; }
  if (dialog.value) wrapTabFocus(event, dialog.value);
}
/** Engines may close a modal without a cancel event (repeated Escape); the owner's state follows. */
function onNativeClose(): void { if (props.open) emit('close'); }
</script>

<template>
  <dialog ref="dialog" class="profile-dialog" data-testid="profile-dialog" aria-labelledby="profile-dialog-title" @cancel.prevent="emit('close')" @close="onNativeClose" @pointerdown.self="emit('close')" @keydown.stop="onKeydown">
    <div class="profile-panel sd-panel">
      <header><h2 id="profile-dialog-title" class="sd-panel-title">{{ t('Profile') }}</h2><button ref="closeButton" type="button" class="sd-icon-btn sd-panel-close" :aria-label="t('Profile schließen')" @click="emit('close')"><AppIcon name="close" /></button></header>
      <p class="hint">{{ t('Ein Profil bündelt deine Plugin-Einstellungen und Tokens. Das aktive Profil gilt für jedes Diagramm; was es enthält, stellst du in den Plugin-Einstellungen ein.') }}</p>

      <ul class="profile-list" :aria-label="t('Profile')">
        <li v-for="profile in profiles" :key="profile.id" class="profile-item" :class="{ active: profile.id === activeId, target: target?.id === profile.id }" :aria-current="profile.id === activeId ? 'true' : undefined">
          <span class="profile-mark" aria-hidden="true"><AppIcon name="component" :size="18" /></span>
          <span class="profile-name">{{ profile.name }}</span>
          <span v-if="profile.id === activeId" class="active-badge"><AppIcon name="check" :size="14" />{{ t('Aktiv') }}</span>
          <button v-else type="button" class="sd-btn activate" :disabled="busy" :aria-label="t('Profil „{name}“ aktivieren', { name: profile.name })" @click="activate(profile.id)">{{ t('Aktivieren') }}</button>
          <span class="row-actions">
            <button type="button" class="sd-icon-btn" :disabled="busy" :aria-label="t('Profil „{name}“ umbenennen', { name: profile.name })" :title="t('Umbenennen')" @click="begin({ kind: 'rename', id: profile.id }, $event)"><AppIcon name="rename" :size="18" /></button>
            <button type="button" class="sd-icon-btn" :disabled="busy || limitReached" :aria-label="t('Profil „{name}“ kopieren', { name: profile.name })" :title="limitReached ? t('Es sind höchstens zwölf Profile möglich.') : t('Kopieren')" @click="begin({ kind: 'copy', id: profile.id }, $event)"><AppIcon name="copy" :size="18" /></button>
            <button type="button" class="sd-icon-btn danger" :disabled="busy || profiles.length < 2" :aria-label="t('Profil „{name}“ löschen', { name: profile.name })" :title="profiles.length < 2 ? t('Das letzte Profil kann nicht gelöscht werden.') : t('Löschen')" @click="begin({ kind: 'delete', id: profile.id }, $event)"><AppIcon name="trash" :size="18" /></button>
          </span>
        </li>
      </ul>

      <form v-if="step && step.kind !== 'delete'" class="step" data-testid="profile-form" @submit.prevent="submit">
        <label class="step-name"><span>{{ formLabel }}</span><input ref="nameInput" v-model="name" data-testid="profile-name" :maxlength="PLUGIN_PROFILE_NAME_MAX" autocomplete="off" spellcheck="false" :disabled="busy" /></label>
        <div class="step-actions"><button type="button" class="sd-btn" :disabled="busy" @click="finishStep">{{ t('Abbrechen') }}</button><button type="submit" class="sd-btn sd-btn--primary" :disabled="busy || !name.trim()">{{ submitLabel }}</button></div>
      </form>
      <div v-else-if="step" class="step" data-testid="profile-delete">
        <p class="step-question" role="alert">{{ t('Profil „{name}“ mit seinen Plugin-Einstellungen und Tokens löschen?', { name: target?.name ?? '' }) }}</p>
        <div class="step-actions"><button type="button" class="sd-btn" :disabled="busy" @click="finishStep">{{ t('Abbrechen') }}</button><button ref="confirmButton" type="button" class="sd-btn sd-btn--danger" data-testid="profile-delete-confirm" :disabled="busy" @click="remove">{{ t('Profil löschen') }}</button></div>
      </div>

      <p v-if="feedback" class="feedback" :class="{ error: feedback.kind === 'error' }" :role="feedback.kind === 'error' ? 'alert' : 'status'">{{ feedback.text }}</p>
      <p v-if="limitReached" class="hint limit">{{ t('Es sind höchstens zwölf Profile möglich.') }}</p>

      <footer>
        <button type="button" class="sd-btn" data-testid="profile-create" :disabled="busy || limitReached" @click="begin({ kind: 'create' }, $event)"><AppIcon name="plus" :size="18" />{{ t('Neues Profil') }}</button>
        <button type="button" class="sd-btn sd-btn--primary" @click="emit('close')">{{ t('Fertig') }}</button>
      </footer>
    </div>
  </dialog>
</template>

<style scoped>
/* Anchored at the top instead of centred: the dialog grows downwards when a step opens, so the rows stay under the pointer. */
.profile-dialog{--dialog-top:clamp(16px,12vh,120px);width:min(520px,calc(100vw - 32px));max-height:calc(100dvh - var(--dialog-top) - 16px);margin:var(--dialog-top) auto auto;padding:0;border:0;background:transparent;color:var(--text-primary);overflow:visible}
.profile-dialog::backdrop{background:var(--scrim)}
.profile-panel{display:flex;flex-direction:column;max-height:calc(100dvh - var(--dialog-top) - 16px);padding:20px}
header{display:flex;align-items:center;justify-content:space-between;margin-bottom:8px}
.hint{margin:0 0 14px;color:var(--text-muted);font-size:12px;line-height:1.5}
.hint.limit{margin:10px 0 0}
.profile-list{display:grid;gap:6px;min-height:0;margin:0;padding:2px;overflow:auto;list-style:none}
.profile-item{display:flex;align-items:center;gap:10px;min-height:52px;padding:6px 6px 6px 10px;border:1px solid var(--border-subtle);border-radius:12px;background:var(--surface-panel)}
.profile-item.active{border-color:color-mix(in srgb,var(--accent) 45%,transparent);background:var(--accent-soft)}
.profile-item.target{box-shadow:0 0 0 2px var(--accent)}
.profile-mark{display:grid;place-items:center;flex:none;width:32px;height:32px;border-radius:9px;background:var(--surface-raised);color:var(--text-muted)}
.profile-item.active .profile-mark{background:var(--surface-panel);color:var(--accent)}
.profile-name{flex:1;min-width:0;overflow:hidden;font-weight:600;text-overflow:ellipsis;white-space:nowrap}
.active-badge{display:inline-flex;align-items:center;gap:4px;flex:none;padding:0 4px;color:var(--accent-ink);font-size:12px;font-weight:700}
.activate{flex:none;min-height:32px;font-size:12px}
.row-actions{display:flex;flex:none;gap:2px}
.row-actions .sd-icon-btn{width:36px;height:36px;border-radius:9px;color:var(--text-muted)}
.row-actions .sd-icon-btn:hover:not(:disabled){color:var(--text-primary)}
.row-actions .sd-icon-btn.danger:hover:not(:disabled){color:var(--status-error)}
.profile-item.active .sd-icon-btn:hover:not(:disabled){background:var(--surface-panel)}
.step{display:grid;gap:10px;margin-top:12px;padding:12px;border:1px solid var(--border-subtle);border-radius:12px;background:var(--surface-raised)}
.step-name{display:grid;gap:6px;color:var(--text-muted);font-size:12px;font-weight:600}
.step-name input{min-width:0;height:40px;padding:0 10px;border:1px solid var(--border-subtle);border-radius:9px;background:var(--surface-panel);color:var(--text-primary);font:inherit;font-weight:400}
.step-name input:focus-visible{outline:2px solid var(--focus-ring);outline-offset:1px;border-color:var(--accent)}
.step-question{margin:0;font-size:13px;line-height:1.5}
.step-actions{display:flex;flex-wrap:wrap;justify-content:flex-end;gap:8px}
.feedback{margin:12px 0 0;font-size:13px;line-height:1.45;overflow-wrap:anywhere}
.feedback.error{color:var(--status-error)}
footer{display:flex;flex-wrap:wrap;align-items:center;justify-content:space-between;gap:8px;margin-top:16px;padding-top:12px;border-top:1px solid var(--border-subtle)}
@media(max-width:480px){.profile-panel{padding:16px}.profile-item{flex-wrap:wrap}.profile-name{flex-basis:calc(100% - 42px)}.row-actions{margin-left:auto}}
@media(forced-colors:active){.profile-item.active,.profile-item.target{outline:2px solid Highlight}}
</style>

<!-- @component The session button of the workspace bar and its menu. It is shown while this device hosts or takes part in a session: the menu lists the people, lets the user follow one of them (the own canvas then shows what that person sees) and ends or leaves the session. -->
<script setup lang="ts">
import { computed, nextTick, ref, useId, watch } from 'vue';
import { useEventListener } from '@vueuse/core';
import AppAvatar from '@/renderer/design-system/atoms/AppAvatar.vue';
import AppIcon from '@/renderer/design-system/atoms/AppIcon.vue';
import AppIconButton from '@/renderer/design-system/atoms/AppIconButton.vue';
import { useWhiteboard } from '@/renderer/design-system/composables/use-whiteboard';
import { participantLabel } from '@/renderer/lib/participant-label';
import { t, tn } from '@/renderer/i18n';

defineProps<{
  /** The side panel "Zusammenarbeiten" is open; the menu then offers no entry to open it. */
  panelOpen?: boolean;
}>();
const emit = defineEmits<{
  /** The user wants the side panel with link, PIN and the full participant list. */
  'open-panel': [];
}>();

const store = useWhiteboard();
const s = store.state;
const menuId = useId();
const open = ref(false);
/** The host is asked once before a session with other people in it ends. */
const confirming = ref(false);
const ending = ref(false);
const root = ref<HTMLElement>();
const trigger = ref<InstanceType<typeof AppIconButton>>();
const list = ref<HTMLElement>();

const people = computed(() => s.presence.participants);
const connected = computed(() => people.value.filter(person => person.state === 'online').length);
const others = computed(() => people.value.filter(person => !person.self && person.state === 'online').length);
const followed = computed(() => people.value.find(person => person.id === s.following) ?? null);
const buttonLabel = computed(() => followed.value ? t('Session: du folgst {name}', { name: participantLabel(followed.value) })
  : connected.value ? tn(connected.value, 'Session, {count} Person verbunden', 'Session, {count} Personen verbunden') : t('Session'));

function items(): HTMLElement[] {
  return Array.from(list.value?.querySelectorAll<HTMLElement>('[role^="menuitem"]:not([aria-disabled="true"])') ?? []);
}
async function show(target: 'first' | 'last' = 'first'): Promise<void> {
  confirming.value = false;
  open.value = true;
  await nextTick();
  const all = items();
  (target === 'last' ? all[all.length - 1] : all[0])?.focus();
}
function hide(returnFocus: boolean): void {
  if (!open.value) return;
  open.value = false; confirming.value = false;
  if (returnFocus) trigger.value?.focus();
}
function onTriggerKeydown(event: KeyboardEvent): void {
  if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return;
  event.preventDefault();
  void show(event.key === 'ArrowUp' ? 'last' : 'first');
}
function onMenuKeydown(event: KeyboardEvent): void {
  const all = items();
  const current = all.findIndex(item => item === document.activeElement);
  let next: number;
  switch (event.key) {
    case 'ArrowDown': next = (current + 1) % all.length; break;
    case 'ArrowUp': next = current < 0 ? all.length - 1 : (current - 1 + all.length) % all.length; break;
    case 'Home': next = 0; break;
    case 'End': next = all.length - 1; break;
    case 'Escape': event.preventDefault(); event.stopPropagation(); hide(true); return;
    case 'Tab': hide(false); return;
    default: return;
  }
  event.preventDefault(); event.stopPropagation();
  all[next]?.focus();
}
function inside(node: unknown): boolean { return node instanceof Node && Boolean(root.value?.contains(node)); }
/** Focus that leaves the menu closes it. An entry that is replaced while it has the focus loses it for a moment; the check waits for the new entry to take it. */
function onFocusOut(event: FocusEvent): void {
  if (!open.value || inside(event.relatedTarget)) return;
  setTimeout(() => { if (open.value && !inside(document.activeElement)) hide(false); }, 0);
}
useEventListener(document, 'pointerdown', (event: PointerEvent) => { if (open.value && !inside(event.target)) hide(false); }, true);

function follow(id: string): void {
  store.followParticipant(s.following === id ? null : id);
  hide(true);
}
function openPanel(): void { hide(true); emit('open-panel'); }
async function askEnd(): Promise<void> {
  if (s.session?.hosting && others.value > 0 && !confirming.value) {
    confirming.value = true;
    await nextTick();
    list.value?.querySelector<HTMLElement>('[data-action="cancel-end"]')?.focus();
    return;
  }
  await end();
}
async function cancelEnd(): Promise<void> {
  confirming.value = false;
  await nextTick();
  list.value?.querySelector<HTMLElement>('[data-action="end"]')?.focus();
}
async function end(): Promise<void> {
  if (ending.value) return;
  ending.value = true;
  hide(false);
  try { await store.endSession(); } finally { ending.value = false; }
}
// The session can end from elsewhere while the menu is open.
watch(() => s.session, session => { if (!session) { open.value = false; confirming.value = false; } });
</script>

<template>
  <span v-if="s.session" ref="root" class="session-entry" @focusout="onFocusOut">
    <span class="session-trigger">
    <AppIconButton
      ref="trigger"
      class="session-btn"
      icon="users"
      data-testid="session-button"
      aria-haspopup="menu"
      :aria-expanded="open"
      :aria-controls="menuId"
      :label="buttonLabel"
      :data-following="s.following ? '' : undefined"
      @click="open ? hide(true) : show()"
      @keydown="onTriggerKeydown"
    />
    <span v-if="connected" class="session-count" data-testid="session-count" aria-hidden="true">{{ connected }}</span>
    </span>
    <div v-if="open" :id="menuId" ref="list" class="session-menu sd-panel" role="menu" data-focus-scope data-testid="session-menu" :aria-label="t('Session')" @keydown="onMenuKeydown">
      <p class="menu-title">{{ s.session.hosting ? t('Deine Session') : t('Session') }}<span v-if="connected" class="menu-count">{{ tn(connected, '{count} Person verbunden', '{count} Personen verbunden') }}</span></p>
      <div v-if="people.length" role="group" :aria-label="t('Ansicht einer Person folgen')" class="people">
        <button
          v-for="person in people"
          :key="person.id"
          type="button"
          role="menuitemcheckbox"
          tabindex="-1"
          class="person"
          data-testid="session-person"
          :data-participant="person.id"
          :aria-checked="s.following === person.id"
          :aria-disabled="person.self || person.state !== 'online' || undefined"
          :aria-label="person.self ? t('{name}, das bist du', { name: participantLabel(person) }) : person.state !== 'online' ? t('{name}, Verbindung unterbrochen', { name: participantLabel(person) }) : t('{name} folgen', { name: participantLabel(person) })"
          @click="person.self || person.state !== 'online' ? undefined : follow(person.id)"
        >
          <AppAvatar :name="participantLabel(person)" :color="person.color" :away="person.state !== 'online'" size="sm" />
          <span class="person-name">{{ participantLabel(person) }}</span>
          <span v-if="person.self" class="person-note">{{ t('Du') }}</span>
          <span v-else-if="person.state !== 'online'" class="person-note">{{ t('Unterbrochen') }}</span>
          <span v-else-if="s.following === person.id" class="person-note following"><AppIcon name="check" :size="14" />{{ t('Folgst du') }}</span>
          <span v-else class="person-note action">{{ t('Folgen') }}</span>
        </button>
      </div>
      <p v-if="s.session.hosting && people.length <= 1" class="menu-hint">{{ t('Noch ist niemand beigetreten.') }}</p>
      <span class="rule" role="separator" />
      <template v-if="confirming">
        <p class="menu-hint" data-testid="session-end-question">{{ tn(others, 'Die Session endet auch für {count} weitere Person.', 'Die Session endet auch für {count} weitere Personen.') }}</p>
        <button type="button" role="menuitem" tabindex="-1" class="menu-item" data-action="cancel-end" @click="cancelEnd"><AppIcon name="undo" :size="18" /><span>{{ t('Weiterlaufen lassen') }}</span></button>
        <button type="button" role="menuitem" tabindex="-1" class="menu-item danger" data-action="confirm-end" data-testid="session-end-confirm" @click="end"><AppIcon name="close" :size="18" /><span>{{ t('Für alle beenden') }}</span></button>
      </template>
      <template v-else>
        <button v-if="!panelOpen" type="button" role="menuitem" tabindex="-1" class="menu-item" data-testid="session-open-panel" @click="openPanel"><AppIcon name="link" :size="18" /><span>{{ s.session.hosting ? t('Link und PIN anzeigen') : t('Zusammenarbeiten öffnen') }}</span></button>
        <button type="button" role="menuitem" tabindex="-1" class="menu-item danger" data-action="end" data-testid="session-end" @click="askEnd"><AppIcon name="close" :size="18" /><span>{{ s.session.hosting ? t('Session beenden') : t('Session verlassen') }}</span></button>
      </template>
    </div>
  </span>
</template>

<style scoped>
.session-entry{display:inline-flex}
.session-trigger{position:relative;display:inline-flex}
/* Same size as the other buttons of the bar. */
.session-btn{width:var(--chrome-control);height:var(--chrome-control);border-radius:10px}
.session-btn[aria-expanded='true'],.session-btn[data-following]{background:var(--accent-soft);color:var(--accent);box-shadow:inset 0 0 0 1px var(--accent)}
/* The count sits on the corner of the button, clear of the symbol. */
.session-count{position:absolute;top:-1px;right:-5px;min-width:8px;height:14px;padding:0 3px;border:2px solid var(--surface-panel);border-radius:9px;background:var(--accent);color:var(--accent-contrast);font:700 10px/14px var(--font-sans);text-align:center;box-sizing:content-box;pointer-events:none}
/* The menu hangs on the right end of the bar (its positioned ancestor), not on the button, so it never leaves a narrow window. */
.session-menu{position:absolute;top:calc(100% + var(--space-2));right:0;z-index:30;width:min(300px,calc(100vw - 2 * var(--chrome-inset)));padding:6px;display:grid;gap:1px}
.menu-title{display:flex;align-items:baseline;justify-content:space-between;gap:var(--space-3);margin:0;padding:6px 10px 8px;font-size:var(--font-size-m);font-weight:600;color:var(--text-primary)}
.menu-count{font-size:var(--font-size-s);font-weight:400;color:var(--text-muted)}
.menu-hint{margin:0;padding:4px 10px 8px;font-size:var(--font-size-s);line-height:1.5;color:var(--text-muted)}
.people{display:grid;gap:1px}
.person,.menu-item{display:flex;align-items:center;gap:10px;width:100%;min-height:var(--control-size);padding:0 10px;border:0;border-radius:var(--radius-1);background:transparent;color:var(--text-primary);font:inherit;font-size:var(--font-size-m);text-align:left;cursor:pointer}
.person{min-height:40px}
.person:hover,.person:focus-visible,.menu-item:hover,.menu-item:focus-visible{background:var(--menu-hover)}
.person:focus-visible,.menu-item:focus-visible{outline:2px solid var(--focus-ring);outline-offset:-2px}
.person[aria-checked='true']{background:var(--menu-selected);color:var(--menu-selected-text)}
.person[aria-disabled='true']{cursor:default}
.person[aria-disabled='true']:hover{background:transparent}
.person-name{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-weight:500}
.person-note{flex:none;display:inline-flex;align-items:center;gap:4px;font-size:var(--font-size-s);color:var(--text-muted)}
.person-note.action{color:var(--accent-ink);font-weight:600}
.person-note.following{color:var(--menu-selected-text);font-weight:600}
.menu-item > .app-icon{color:var(--text-muted)}
.menu-item.danger,.menu-item.danger > .app-icon{color:var(--status-error)}
.rule{display:block;height:1px;margin:5px 4px;background:var(--menu-separator)}
@media(forced-colors:active){.person[aria-checked='true']{outline:2px solid Highlight;outline-offset:-2px}}
</style>

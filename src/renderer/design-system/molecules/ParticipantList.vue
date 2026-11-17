<!-- @component The people in a session, one row each: badge, name and role, or that the connection is interrupted. With `removable` every guest gets a button to take it out of the session; the row asks once before it reports `remove`. -->
<script setup lang="ts">
import { nextTick, ref, watch } from 'vue';
import { t } from '@/renderer/i18n';
import type { SessionParticipant } from '@/collaboration/presence';
import AppAvatar from '@/renderer/design-system/atoms/AppAvatar.vue';
import AppButton from '@/renderer/design-system/atoms/AppButton.vue';
import AppIconButton from '@/renderer/design-system/atoms/AppIconButton.vue';

const props = withDefaults(defineProps<{
  /** The people to list, in the order they joined; the host first. */
  participants: readonly SessionParticipant[];
  /** Offers removing for everyone except the host and this device. */
  removable?: boolean;
}>(), { removable: false });
const emit = defineEmits<{
  /** The user confirmed that this person leaves the session. */
  remove: [id: string];
}>();

const asking = ref<string | null>(null);
const list = ref<HTMLUListElement>();

/** The name as shown everywhere: the chosen one, otherwise a neutral label. */
function label(person: SessionParticipant): string {
  return person.name || (person.role === 'owner' ? t('Gastgeber') : t('Gast {number}', { number: person.number }));
}
function role(person: SessionParticipant): string {
  return person.role === 'owner' ? t('Gastgeber') : person.role === 'editor' ? t('Bearbeitet mit') : t('Sieht zu');
}
/** The second line: what the person may do, or that the connection is interrupted, which matters more. */
function details(person: SessionParticipant): string {
  if (person.state === 'reconnecting') return t('Verbindung unterbrochen');
  const text = role(person);
  return text === label(person) ? '' : text;
}
function focusIn(id: string, selector: string): void {
  void nextTick(() => list.value?.querySelector<HTMLElement>(`[data-participant="${id}"] ${selector}`)?.focus());
}
function ask(id: string): void { asking.value = id; focusIn(id, '[data-action="cancel"]'); }
function cancel(id: string): void { asking.value = null; focusIn(id, '[data-action="ask"]'); }
function confirm(id: string): void { asking.value = null; emit('remove', id); }
// The person may leave while the question is open.
watch(() => props.participants, people => { if (asking.value && !people.some(person => person.id === asking.value)) asking.value = null; });
</script>

<template>
  <ul ref="list" class="participant-list" data-testid="participant-list">
    <li v-for="person in participants" :key="person.id" class="participant" data-testid="participant" :data-participant="person.id" :data-state="person.state" :data-self="person.self || undefined">
      <div class="row">
        <AppAvatar :name="label(person)" :color="person.color" :away="person.state === 'reconnecting'" />
        <span class="who">
          <span class="name"><span class="name-text">{{ label(person) }}</span><span v-if="person.self" class="you">{{ t('Du') }}</span></span>
          <span v-if="details(person)" class="details">{{ details(person) }}</span>
        </span>
        <AppIconButton v-if="removable && !person.self && person.role !== 'owner' && asking !== person.id" class="remove" icon="close" :icon-size="16" data-action="ask" data-testid="participant-remove" :label="t('{name} aus der Session entfernen', { name: label(person) })" @click="ask(person.id)" />
      </div>
      <div v-if="asking === person.id" class="confirm" role="group" :aria-label="t('{name} aus der Session entfernen', { name: label(person) })" @keydown.esc.stop="cancel(person.id)">
        <p>{{ t('{name} verliert sofort den Zugriff und erfährt, dass du die Person entfernt hast.', { name: label(person) }) }}</p>
        <div class="actions">
          <AppButton data-action="cancel" @click="cancel(person.id)">{{ t('Abbrechen') }}</AppButton>
          <AppButton intent="danger" data-action="confirm" data-testid="participant-remove-confirm" @click="confirm(person.id)">{{ t('Entfernen') }}</AppButton>
        </div>
      </div>
    </li>
  </ul>
</template>

<style scoped>
.participant-list{list-style:none;margin:0;padding:0;display:grid;gap:2px}
.participant{border-radius:var(--radius-1)}
.row{display:flex;align-items:center;gap:var(--space-3);min-height:44px;padding:var(--space-1) 0}
.who{flex:1;min-width:0;display:grid;gap:1px}
.name{display:flex;align-items:center;gap:var(--space-2);min-width:0;font-size:var(--font-size-m);font-weight:600;color:var(--text-primary)}
.name-text{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.you{flex:none;padding:1px 6px;border-radius:999px;background:var(--accent-soft);color:var(--accent-ink);font-size:11px;font-weight:600}
.details{font-size:var(--font-size-s);color:var(--text-muted);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.participant[data-state='reconnecting'] .name-text{color:var(--text-muted)}
.remove{flex:none;width:var(--control-size-compact);height:var(--control-size-compact);color:var(--text-muted)}.remove:hover,.remove:focus-visible{color:var(--status-error)}
.confirm{margin:0 0 var(--space-2);padding:var(--space-3);border-radius:var(--radius-1);background:var(--surface-raised)}
.confirm p{margin:0 0 var(--space-3);font-size:var(--font-size-s);line-height:1.5;color:var(--text-primary)}
.actions{display:flex;justify-content:flex-end;gap:var(--space-2)}
</style>

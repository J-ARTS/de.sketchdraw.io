<script setup lang="ts">
import { intlLocale, t } from '@/renderer/i18n';
import { computed } from 'vue';
import type { SketchTask, TaskType } from '@/domain';
import AppIcon from './AppIcon.vue';

/** Visual task card (#105); TaskBoard renders it in columns and, tilted, as the drag ghost (#106). */
const props = defineProps<{ task: SketchTask; menuOpen?: boolean; ghost?: boolean }>();
const emit = defineEmits<{ open: []; menu: [event: MouseEvent] }>();

const TYPE_LABELS: Readonly<Record<TaskType, string>> = { feature: 'Funktion', bug: t('Fehler'), design: 'Design', research: 'Recherche', docs: 'Dokumentation', ops: 'Betrieb' };
// All reach at least 4.5:1 with white initials.
const AVATAR_COLORS = ['#7c3aed', '#be185d', '#c2410c', '#0369a1', '#047857', '#4f46e5', '#be123c', '#0e7490'];

const typeLabel = computed(() => (props.task.type ? TYPE_LABELS[props.task.type] : null));
const initials = computed(() => (props.task.assignee ?? '').trim().split(/\s+/).slice(0, 2).map((part) => part.charAt(0).toLocaleUpperCase('de')).join(''));
const avatarColor = computed(() => {
  let hash = 0;
  for (const char of props.task.assignee ?? '') hash = (hash * 31 + char.charCodeAt(0)) >>> 0;
  return AVATAR_COLORS[hash % AVATAR_COLORS.length];
});
const due = computed(() => {
  if (!props.task.dueDate) return null;
  const date = new Date(`${props.task.dueDate}T00:00:00`);
  const today = new Date(); today.setHours(0, 0, 0, 0);
  return {
    label: new Intl.DateTimeFormat(intlLocale(), { day: '2-digit', month: '2-digit', year: 'numeric' }).format(date),
    overdue: date < today && props.task.status !== 'done',
  };
});
</script>

<template>
  <article class="task-card" :class="{ ghost }" :data-type="task.type ?? 'none'" :aria-hidden="ghost || undefined">
    <div class="card-cover" aria-hidden="true">
      <span v-if="typeLabel" class="cover-type">{{ typeLabel }}</span>
    </div>
    <div class="card-body">
      <div class="card-head">
        <button type="button" class="card-open" :data-task-id="task.id" :tabindex="ghost ? -1 : undefined" @click="emit('open')">
          <strong>{{ task.title }}</strong>
        </button>
        <button
          type="button"
          class="card-menu-btn"
          aria-haspopup="menu"
          :aria-expanded="menuOpen || false"
          :aria-label="t('Aktionen für {title}', { title: task.title })"
          :tabindex="ghost ? -1 : undefined"
          @click.stop="emit('menu', $event)"
        >
          <AppIcon name="more-vertical" :size="20" />
        </button>
      </div>
      <span v-if="task.external" class="external-badge">{{ task.external.key }} · {{ task.external.remoteStatus }}</span>
      <p v-if="task.description" class="card-desc">{{ task.description }}</p>
      <div v-if="due || task.assignee" class="card-meta">
        <span v-if="due" class="due" :class="{ overdue: due.overdue }">
          <AppIcon name="calendar" :size="16" />
          <time :datetime="task.dueDate">{{ due.label }}</time>
          <span v-if="due.overdue" class="visually-hidden">{{ t('(überfällig)') }}</span>
        </span>
        <span v-else aria-hidden="true" />
        <span v-if="task.assignee" class="avatar" :style="{ background: avatarColor }" :title="t('Zugewiesen: {assignee}', { assignee: task.assignee })">
          <span aria-hidden="true">{{ initials }}</span>
          <span class="visually-hidden">{{ t('Zugewiesen an {name}', { name: task.assignee }) }}</span>
        </span>
      </div>
    </div>
  </article>
</template>

<style scoped>
.task-card {
  position: relative;
  overflow: hidden;
  border: 1px solid var(--border-subtle);
  border-radius: 18px;
  background: var(--surface-panel);
  box-shadow: 0 1px 2px rgb(45 35 90 / 5%), 0 6px 18px rgb(45 35 90 / 6%);
  cursor: grab;
  touch-action: none;
  user-select: none;
}

.task-card:focus-within {
  outline: 2px solid var(--focus-ring);
  outline-offset: 2px;
}

.task-card.ghost {
  box-shadow: 0 18px 40px rgb(45 35 90 / 22%), 0 4px 12px rgb(45 35 90 / 12%);
  cursor: grabbing;
}

/* Covers per task type: soft layered gradients evoke the rendered shapes of the reference design. */
.card-cover {
  position: relative;
  height: 96px;
  margin: 8px 8px 0;
  border-radius: 12px;
  background:
    radial-gradient(circle at 25% 30%, #fde2e4 0 22%, transparent 48%),
    radial-gradient(circle at 75% 70%, #e9dcff 0 25%, transparent 55%),
    linear-gradient(135deg, #f7eef6, #ece9fb);
}

.task-card[data-type='feature'] .card-cover {
  background:
    radial-gradient(circle at 70% 35%, #c4b5fd 0 18%, transparent 46%),
    radial-gradient(circle at 30% 75%, #f9a8d4 0 20%, transparent 52%),
    linear-gradient(135deg, #f5d0fe, #c7d2fe 55%, #fbcfe8);
}

.task-card[data-type='bug'] .card-cover {
  background:
    radial-gradient(circle at 30% 35%, #fecaca 0 20%, transparent 50%),
    radial-gradient(circle at 72% 68%, #fdba74 0 18%, transparent 50%),
    linear-gradient(135deg, #fee2e2, #fed7aa 60%, #fbcfe8);
}

.task-card[data-type='design'] .card-cover {
  background:
    radial-gradient(circle at 65% 40%, #f0abfc 0 20%, transparent 50%),
    radial-gradient(circle at 25% 70%, #fda4af 0 22%, transparent 55%),
    linear-gradient(135deg, #fae8ff, #e9d5ff 50%, #ffe4e6);
}

.task-card[data-type='research'] .card-cover {
  background:
    radial-gradient(circle at 35% 40%, #99f6e4 0 20%, transparent 50%),
    radial-gradient(circle at 72% 65%, #bae6fd 0 22%, transparent 55%),
    linear-gradient(135deg, #ccfbf1, #dbeafe 55%, #e0e7ff);
}

.task-card[data-type='docs'] .card-cover {
  background:
    radial-gradient(circle at 30% 35%, #fef08a 0 18%, transparent 48%),
    radial-gradient(circle at 70% 70%, #bbf7d0 0 22%, transparent 55%),
    linear-gradient(135deg, #fefce8, #dcfce7 55%, #ecfccb);
}

.task-card[data-type='ops'] .card-cover {
  background:
    radial-gradient(circle at 68% 35%, #a5b4fc 0 18%, transparent 48%),
    radial-gradient(circle at 30% 70%, #cbd5e1 0 22%, transparent 55%),
    linear-gradient(135deg, #e0e7ff, #e2e8f0 55%, #dbeafe);
}

:global(:root[data-theme='dark']) .card-cover {
  filter: saturate(0.85) brightness(0.72);
}

.cover-type {
  position: absolute;
  left: 10px;
  bottom: 10px;
  padding: 3px 9px;
  border-radius: 999px;
  background: rgb(255 255 255 / 78%);
  color: #2b2540;
  font-size: 11px;
  font-weight: 650;
}

.card-body {
  display: grid;
  gap: 8px;
  padding: 12px 14px 14px;
}

.card-head {
  display: flex;
  align-items: flex-start;
  gap: 6px;
}

.card-open {
  flex: 1;
  min-width: 0;
  padding: 2px 0;
  border: 0;
  background: transparent;
  color: var(--text-primary);
  font: inherit;
  text-align: left;
  cursor: pointer;
}

.card-open strong {
  display: block;
  font-size: 15px;
  font-weight: 700;
  line-height: 1.3;
  overflow-wrap: anywhere;
}

.card-open:focus-visible,
.card-menu-btn:focus-visible {
  outline: 2px solid var(--focus-ring);
  outline-offset: 2px;
}

.card-menu-btn {
  display: grid;
  flex: none;
  width: 28px;
  height: 28px;
  margin: -2px -6px 0 0;
  padding: 0;
  place-items: center;
  border: 0;
  border-radius: 8px;
  background: transparent;
  color: var(--text-muted);
  cursor: pointer;
}

.card-menu-btn :deep(svg) {
  stroke-width: 3;
}

.card-menu-btn:hover,
.card-menu-btn[aria-expanded='true'] {
  background: var(--surface-raised);
  color: var(--text-primary);
}

.card-desc {
  display: -webkit-box;
  margin: 0;
  overflow: hidden;
  color: var(--text-muted);
  font-size: 13px;
  line-height: 1.45;
  -webkit-line-clamp: 3;
  -webkit-box-orient: vertical;
}

.card-meta {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-top: 2px;
}

.due {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  color: var(--text-muted);
  font-size: 12px;
}

.due.overdue {
  color: var(--status-error);
  font-weight: 650;
}

.avatar {
  display: grid;
  width: 30px;
  height: 30px;
  place-items: center;
  border-radius: 50%;
  box-shadow: 0 0 0 2px var(--surface-panel);
  color: #ffffff;
  font-size: 12px;
  font-weight: 700;
}

.external-badge {
  justify-self: start;
  padding: 3px 7px;
  border-radius: 999px;
  background: color-mix(in srgb, #1868db 12%, var(--surface-raised));
  color: color-mix(in srgb, #1868db 70%, var(--text-primary));
  font-size: 10px;
  font-weight: 750;
}

@media (forced-colors: active) {
  .task-card {
    border: 1px solid CanvasText;
  }
}
</style>

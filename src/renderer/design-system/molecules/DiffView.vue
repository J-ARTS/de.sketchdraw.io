<!-- @component The changes of one text file, line by line with old and new line numbers; added and removed lines carry a sign as well as a colour. Used by the Git dialog. -->
<script setup lang="ts">
import type { GitFileDiff } from '@/domain';
import { t } from '@/renderer/i18n';

defineProps<{
  /** The changes to show; null while nothing is chosen. */
  diff: GitFileDiff | null;
  /** The accessible name of the scrollable area, usually the file name. */
  label: string;
  /** What to say when the diff has no lines. */
  emptyText?: string;
}>();
const SIGN = { added: '+', removed: '−', context: '', hunk: '' } as const;
</script>

<template>
  <div class="diff-view" role="region" tabindex="0" :aria-label="label" data-testid="diff-view">
    <p v-if="!diff" class="diff-note">{{ emptyText ?? t('Wähle eine Datei, um ihre Änderungen zu sehen.') }}</p>
    <p v-else-if="diff.binary" class="diff-note">{{ t('Binärdatei – der Inhalt wird nicht angezeigt.') }}</p>
    <p v-else-if="!diff.lines.length" class="diff-note">{{ emptyText ?? t('Keine Änderungen am Inhalt.') }}</p>
    <template v-else>
      <table class="diff-lines">
        <caption class="visually-hidden">{{ label }}</caption>
        <tbody>
          <tr v-for="(line, index) in diff.lines" :key="index" :class="`line-${line.kind}`">
            <template v-if="line.kind === 'hunk'"><td class="number" colspan="3" /><td class="text">{{ line.text }}</td></template>
            <template v-else>
              <td class="number">{{ line.oldLine ?? '' }}</td><td class="number">{{ line.newLine ?? '' }}</td>
              <td class="sign"><span aria-hidden="true">{{ SIGN[line.kind] }}</span><span v-if="line.kind !== 'context'" class="visually-hidden">{{ line.kind === 'added' ? t('hinzugefügt') : t('entfernt') }}</span></td>
              <td class="text">{{ line.text }}</td>
            </template>
          </tr>
        </tbody>
      </table>
      <p v-if="diff.truncated" class="diff-note">{{ t('Die Datei hat mehr Änderungen, als hier gezeigt werden.') }}</p>
    </template>
  </div>
</template>

<style scoped>
.diff-view{min-height:0;overflow:auto;border:1px solid var(--border-subtle);border-radius:var(--radius-1);background:var(--surface-panel);font-family:var(--font-mono);font-size:var(--font-size-s);font-variant-ligatures:none;line-height:1.6}
.diff-view:focus-visible{outline:2px solid var(--focus-ring);outline-offset:2px}
.diff-note{margin:0;padding:var(--space-4);color:var(--text-muted);font-family:var(--font-sans);font-size:var(--font-size-m)}
.diff-lines{width:100%;border-collapse:collapse}
td{padding:0 var(--space-2);vertical-align:top;white-space:pre}
.number{width:1%;min-width:38px;color:var(--text-muted);text-align:right;user-select:none}
.sign{width:1%;padding:0 2px;font-weight:700;user-select:none}
.text{width:100%}
.line-added{background:color-mix(in srgb,var(--status-ok) 14%,transparent)}
.line-added .sign{color:var(--status-ok)}
.line-removed{background:color-mix(in srgb,var(--status-error) 12%,transparent)}
.line-removed .sign{color:var(--status-error)}
.line-hunk{background:var(--surface-raised);color:var(--text-muted)}
.line-hunk td{padding-top:2px;padding-bottom:2px}
@media(forced-colors:active){.line-added,.line-removed{forced-color-adjust:none;background:Canvas}.line-added .sign,.line-removed .sign{color:Highlight}}
</style>

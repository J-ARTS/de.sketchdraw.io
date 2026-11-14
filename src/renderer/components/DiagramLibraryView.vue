<script setup lang="ts">
import { L, t } from '@/renderer/i18n';
import { computed } from 'vue';
import { DIAGRAM_LIBRARIES, TEMPLATE_DRAG_MIME, type DiagramLibrary, type DiagramTemplate } from '@/renderer/lib/diagram-libraries';
import type { ElementClipboardPayload } from '@/renderer/state/element-clipboard';
import PayloadPreview from './PayloadPreview.vue';
import { useWhiteboard } from './use-whiteboard';

/**
 * Templates of the diagram libraries (#191): one library with its sections, or, without `library`, the
 * templates of all libraries that match the search.
 */
const props = defineProps<{ library?: DiagramLibrary; query: string }>();
const store = useWhiteboard();
const s = store.state;

const matches = (template: DiagramTemplate, needle: string): boolean =>
  !needle || `${t(template.name)} ${template.name} ${t(template.section)} ${template.keywords}`.toLocaleLowerCase().includes(needle);
/** Templates are built once; their previews never change. */
const built = new Map<string, ElementClipboardPayload>();
const payloadOf = (template: DiagramTemplate): ElementClipboardPayload => {
  let payload = built.get(template.id);
  if (!payload) { payload = template.build(); built.set(template.id, payload); }
  return payload;
};
const groups = computed(() => {
  const needle = props.query.trim().toLocaleLowerCase();
  const source = props.library ? props.library.templates : DIAGRAM_LIBRARIES.flatMap((library) => library.templates);
  const result = new Map<string, DiagramTemplate[]>();
  for (const template of source) {
    if (!matches(template, needle)) continue;
    const key = props.library ? template.section : L('Diagrammvorlagen');
    result.set(key, [...(result.get(key) ?? []), template]);
  }
  return [...result.entries()].map(([section, templates]) => ({ section, templates }));
});

function insert(template: DiagramTemplate): void {
  void store.insertElements(template.build(), undefined, t(template.name));
}
function drag(event: DragEvent, template: DiagramTemplate): void {
  event.dataTransfer?.setData(TEMPLATE_DRAG_MIME, template.id);
  if (event.dataTransfer) event.dataTransfer.effectAllowed = 'copy';
}
</script>

<template>
  <section v-for="group in groups" :key="group.section" class="template-group" :data-testid="library ? `diagram-library-${library.id}` : 'diagram-template-results'">
    <h3>{{ t(group.section) }}</h3>
    <div class="template-grid">
      <button
        v-for="template in group.templates"
        :key="template.id"
        type="button"
        class="template-tile"
        :data-template-id="template.id"
        :disabled="s.transitioning || !s.canWrite"
        draggable="true"
        :title="t(template.name)"
        @click="insert(template)"
        @dragstart="drag($event, template)"
      >
        <span class="template-preview"><PayloadPreview :payload="payloadOf(template)" :theme="s.theme" /></span>
        <span class="template-name">{{ t(template.name) }}</span>
      </button>
    </div>
  </section>
  <p v-if="library && !groups.length" class="template-empty">{{ t('Keine passende Vorlage gefunden.') }}</p>
</template>

<style scoped>
.template-group{padding:16px 20px 4px}
.template-group h3{margin:0 4px 10px;color:var(--text-muted);font-size:13px;letter-spacing:.04em;text-transform:uppercase}
.template-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:10px;padding-bottom:12px}
.template-tile{display:flex;min-width:0;flex-direction:column;padding:0;border:1px solid var(--border-subtle);border-radius:12px;background:var(--surface-raised);color:var(--text-primary);overflow:hidden;cursor:grab}
.template-tile:active{cursor:grabbing}
.template-tile:hover,.template-tile:focus-visible{border-color:var(--accent)}
.template-tile:focus-visible{outline:2px solid var(--accent);outline-offset:-2px}
.template-tile:disabled{cursor:not-allowed;opacity:.55}
.template-preview{display:block;width:100%;height:92px;box-sizing:border-box;padding:10px;border-bottom:1px solid var(--border-subtle);background:var(--surface-canvas)}
.template-name{display:block;width:100%;box-sizing:border-box;padding:9px 10px;overflow:hidden;font-size:12px;font-weight:600;text-align:left;text-overflow:ellipsis;white-space:nowrap}
.template-empty{padding:18px 24px;color:var(--text-muted);font-size:12px}
@media(max-width:760px){.template-group{padding-inline:14px}}
</style>

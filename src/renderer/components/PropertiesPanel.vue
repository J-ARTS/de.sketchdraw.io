<script setup lang="ts">
import { computed } from 'vue';
import { useWhiteboard } from './use-whiteboard';
import { FILL_COLORS, STROKE_COLORS } from '../lib/constants';
import type { ElementStyle } from '@/domain';

const store = useWhiteboard(); const s = store.state;
const info = computed(() => s.selectionInfo);
const single = computed(() => s.document.elements.find(e => e.id === info.value.singleId));
const definition = computed(() => s.document.componentSets.flatMap(set => set.components).find(c => c.type === single.value?.componentType));
const fields = [['x', 'X'], ['y', 'Y'], ['width', 'Breite'], ['height', 'Höhe'], ['rotation', 'Winkel']] as const;
function style(patch: Partial<ElementStyle>) { store.applyPatch({ style: patch }); }
function number(field: typeof fields[number][0], event: Event) { store.setPropertyDraft({ [field]: (event.target as HTMLInputElement).valueAsNumber }); }
function widget(key: string, value: string) {
  if (single.value) store.setPropertyDraft({ metadata: { ...single.value.metadata, [`widget:${single.value.componentType}:${key}`]: value } });
}
</script>

<template>
  <aside v-if="info.count" class="properties sd-panel" aria-label="Eigenschaften" data-testid="properties-panel">
    <div class="panel-heading"><h2>{{ info.count === 1 ? 'Eigenschaften' : `${info.count} ausgewählt` }}</h2><button class="sd-icon-btn" :aria-label="s.propertiesCollapsed ? 'Eigenschaften ausklappen' : 'Eigenschaften einklappen'" :aria-expanded="!s.propertiesCollapsed" @click="store.togglePropertiesCollapsed()">{{ s.propertiesCollapsed ? '+' : '−' }}</button></div>
    <div v-if="!s.propertiesCollapsed" class="panel-content">
      <fieldset :disabled="s.transitioning || !s.canWrite" @compositionstart="store.setInputComposing(true)" @compositionend="store.setInputComposing(false)">
        <legend class="visually-hidden">Darstellung bearbeiten</legend>
        <div class="geometry-fields"><label v-for="[field, label] in fields" :key="field" class="sd-field-label">{{ label }}<input class="sd-input" type="number" :aria-label="label" :value="info.mixed.includes(field) ? '' : info.values[field]" :placeholder="info.mixed.includes(field) ? 'Verschieden' : undefined" :min="field === 'width' || field === 'height' ? 1 : undefined" :disabled="field === 'rotation' && info.kinds.includes('container')" @input="number(field, $event)" @change="store.commitPropertyDraft()" /></label></div>
        <p class="sd-field-label">Kontur</p><div class="swatches" role="group" aria-label="Konturfarbe"><button v-for="color in STROKE_COLORS" :key="color.value" :style="{ '--swatch': color.value }" :aria-label="`Kontur ${color.name}`" :aria-pressed="info.values.stroke === color.value && !info.mixed.includes('stroke')" class="swatch" @click="style({ stroke: color.value })" /></div>
        <template v-if="info.hasFill"><p class="sd-field-label">Füllung</p><div class="swatches" role="group" aria-label="Füllfarbe"><button v-for="color in FILL_COLORS" :key="color.value" :style="{ '--swatch': color.value }" :aria-label="`Füllung ${color.name}`" :aria-pressed="info.values.fill === color.value && !info.mixed.includes('fill')" class="swatch" :class="{ transparent: color.value === 'transparent' }" @click="style({ fill: color.value })" /></div></template>
        <div class="two-fields"><label class="sd-field-label">Linienstärke<input class="sd-input" type="number" aria-label="Linienstärke" min="0" max="100" :value="info.values.strokeWidth" @input="store.setPropertyDraft({ style: { strokeWidth: ($event.target as HTMLInputElement).valueAsNumber } })" @change="store.commitPropertyDraft()" /></label><label class="sd-field-label">Linie<select class="sd-select" :value="info.values.strokeDash" @change="style({ strokeDash: ($event.target as HTMLSelectElement).value as ElementStyle['strokeDash'] })"><option value="solid">Durchgehend</option><option value="dashed">Gestrichelt</option><option value="dotted">Gepunktet</option></select></label></div>
        <label class="sd-field-label">Deckkraft <input aria-label="Deckkraft" type="range" min="0" max="1" step=".05" :value="info.values.opacity" @change="style({ opacity: ($event.target as HTMLInputElement).valueAsNumber })" /></label>
        <template v-if="info.count === 1"><label class="sd-field-label">Bezeichnung<input class="sd-input" aria-label="Bezeichnung" :value="info.values.label ?? ''" @input="store.setPropertyDraft({ label: ($event.target as HTMLInputElement).value })" @change="store.commitPropertyDraft()" /></label><label class="sd-field-label">Beschreibung<textarea class="sd-textarea" aria-label="Beschreibung" rows="2" :value="info.values.description ?? ''" @input="store.setPropertyDraft({ description: ($event.target as HTMLTextAreaElement).value })" @change="store.commitPropertyDraft()" /></label></template>
        <div class="two-fields"><label class="sd-field-label">Schriftgröße<input aria-label="Schriftgröße" class="sd-input" type="number" min="1" max="1000" :value="info.values.fontSize" @input="store.setPropertyDraft({ style: { fontSize: ($event.target as HTMLInputElement).valueAsNumber } })" @change="store.commitPropertyDraft()" /></label><label class="sd-field-label">Ausrichtung<select aria-label="Textausrichtung" class="sd-select" :value="info.values.textAlign" @change="style({ textAlign: ($event.target as HTMLSelectElement).value as ElementStyle['textAlign'] })"><option value="left">Links</option><option value="center">Mitte</option><option value="right">Rechts</option></select></label></div>
        <button v-if="info.canEditText" class="sd-btn full" @click="store.startTextEdit(info.singleId ?? undefined)">Text bearbeiten</button>
        <template v-for="item in definition?.widgets" :key="item.key"><label class="sd-field-label">{{ item.label }}<select v-if="item.kind === 'select'" class="sd-select" :value="single?.metadata?.[`widget:${single.componentType}:${item.key}`] ?? ''" @change="widget(item.key, ($event.target as HTMLSelectElement).value); store.commitPropertyDraft()"><option value="" disabled>Bitte auswählen</option><option v-for="option in item.options" :key="option">{{ option }}</option></select><input v-else class="sd-input" :type="item.kind === 'number' ? 'number' : 'text'" :value="single?.metadata?.[`widget:${single.componentType}:${item.key}`] ?? ''" @input="widget(item.key, ($event.target as HTMLInputElement).value)" @change="store.commitPropertyDraft()" /></label></template>
        <button v-if="single?.documentationUrl" class="sd-btn full" @click="store.openDocumentationLink(single.documentationUrl)">Dokumentation öffnen ↗</button>
        <div class="actions"><button class="sd-btn" @click="store.duplicateSelection()">Duplizieren</button><button class="sd-btn sd-btn--danger" @click="store.deleteSelection()">Löschen</button><button class="sd-btn" @click="store.reorder('front')">Nach vorne</button><button class="sd-btn" @click="store.reorder('back')">Nach hinten</button><button v-if="info.canGroup" class="sd-btn" @click="store.groupSelection()">Gruppieren</button><button v-if="info.canUngroup" class="sd-btn" @click="store.ungroupSelection()">Gruppe lösen</button><button v-if="info.canConnect" class="sd-btn" @click="store.connectSelection()">Verbinden</button></div>
      </fieldset>
    </div>
  </aside>
</template>

<style scoped>
.properties{position:absolute;left:12px;top:94px;width:248px;max-height:calc(100% - 170px);overflow:auto;z-index:6}.panel-heading{display:flex;align-items:center;justify-content:space-between;padding:8px 12px;border-bottom:1px solid var(--border-subtle)}h2{font-size:13px;font-weight:650}.panel-content{padding:12px}fieldset{border:0;padding:0;margin:0;min-width:0}.geometry-fields{display:grid;grid-template-columns:1fr 1fr;gap:8px}.sd-field-label{margin:0 0 10px}.sd-input,.sd-select,.sd-textarea{margin-top:4px;font-weight:400}.swatches{display:flex;flex-wrap:wrap;gap:4px;margin:-3px 0 14px}.swatch{position:relative;width:24px;height:28px;border:1px solid var(--border-default);background:var(--swatch);border-radius:5px;cursor:pointer}.swatch[aria-pressed=true]{outline:2px solid var(--accent);outline-offset:2px}.transparent{background:linear-gradient(135deg,transparent 47%,var(--status-error) 48%,var(--status-error) 52%,transparent 53%)}.two-fields{display:grid;grid-template-columns:1fr 1fr;gap:8px}input[type=range]{width:100%;accent-color:var(--accent)}.actions{display:grid;grid-template-columns:1fr 1fr;gap:6px;border-top:1px solid var(--border-subtle);padding-top:12px;margin-top:12px}.actions .sd-btn{font-size:11px;padding:0 5px}.full{width:100%;margin-bottom:12px}@media(max-width:760px){.properties{width:210px;top:142px;max-height:calc(100% - 210px)}}
@media (max-width:860px){.properties{top:188px;max-height:calc(100% - 260px)}}
</style>

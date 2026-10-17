<script setup lang="ts">
import { computed, ref } from 'vue';
import { builtInComponentSets, searchCatalogComponents } from '@/catalog';
import type { ComponentDefinition } from '@/domain';
import { useWhiteboard } from './use-whiteboard';
import SafeIcon from './SafeIcon';
const store = useWhiteboard(); const s = store.state;
const query = ref(''); const provider = ref<ComponentDefinition['provider'] | 'all'>('all');
const resetConfirm = ref(false); const codeEditor = ref<HTMLTextAreaElement>();
const sets = computed(() => [...s.document.componentSets, ...builtInComponentSets.filter(set => !s.document.componentSets.some(existing => existing.id === set.id))]);
const components = computed(() => searchCatalogComponents(sets.value, query.value, provider.value));
function diagnostic(line: number, column: number) {
  const offset = s.code.text.split('\n').slice(0, line - 1).reduce((total, text) => total + text.length + 1, 0) + column - 1;
  codeEditor.value?.focus(); codeEditor.value?.setSelectionRange(offset, offset + 1);
}
async function importSet(event: Event) { const input = event.target as HTMLInputElement; if (input.files?.[0]) await store.importComponentSet(input.files[0]); input.value = ''; }
</script>

<template>
  <aside v-if="s.codeOpen" class="workspace-panel code-panel sd-panel" aria-label="Diagramm als Code">
    <div class="heading"><h2>Diagramm als Code <span v-if="s.code.dirty" aria-label="Ungespeicherter Codeentwurf">●</span></h2><button class="sd-icon-btn" aria-label="Codeansicht schließen" @click="store.toggleCode()">×</button></div>
    <p class="panel-intro">Canvas und Code, ein Diagramm. Änderungen werden mit „Übernehmen“ geprüft.</p>
    <p v-if="s.code.dirty && s.code.baseRevision !== s.revision" class="conflict" role="status">Das Canvas hat sich geändert. Dein Code bleibt erhalten. Kopiere deine Änderungen vor dem bewussten Neuladen.</p>
    <textarea ref="codeEditor" class="code-editor sd-textarea" aria-label="Diagrammcode" data-testid="diagram-code" @compositionstart="store.setInputComposing(true)" @compositionend="store.setInputComposing(false)" spellcheck="false" autocapitalize="off" :disabled="s.transitioning || !s.canWrite" :value="s.code.text" @input="store.setCodeDraft(($event.target as HTMLTextAreaElement).value)" />
    <ul v-if="s.code.diagnostics.length" class="diagnostics" aria-label="Codefehler"><li v-for="(item, i) in s.code.diagnostics" :key="i"><button @click="diagnostic(item.line, item.column)">Zeile {{ item.line }}, Spalte {{ item.column }}: {{ item.message }}</button></li></ul>
    <div v-if="resetConfirm" class="reset-confirm"><p>Deinen Codeentwurf verwerfen und den aktuellen Canvas-Code laden?</p><button class="sd-btn sd-btn--danger" @click="store.resetCodeDraft(); resetConfirm = false">Entwurf verwerfen</button><button class="sd-btn" @click="resetConfirm = false">Behalten</button></div>
    <div class="panel-footer"><button class="sd-btn" :disabled="s.transitioning || !s.canWrite" @click="s.code.dirty ? resetConfirm = true : store.resetCodeDraft()">Vom Canvas laden</button><button class="sd-btn sd-btn--primary" :disabled="!s.code.dirty || s.transitioning || !s.canWrite" @click="store.applyCode()">Übernehmen</button></div>
  </aside>
  <aside v-if="s.catalogOpen" class="workspace-panel sd-panel" aria-label="Komponentenbibliothek">
    <div class="heading"><h2>Komponenten</h2><button class="sd-icon-btn" aria-label="Bibliothek schließen" @click="store.toggleCatalog()">×</button></div>
    <div class="catalog-search"><label class="visually-hidden" for="catalog-query">Komponenten suchen</label><input id="catalog-query" v-model="query" class="sd-input" placeholder="Komponente suchen …" /><label class="visually-hidden" for="catalog-provider">Anbieter</label><select id="catalog-provider" v-model="provider" class="sd-select"><option value="all">Alle Anbieter</option><option value="generic">Allgemein</option><option value="aws">AWS</option><option value="azure">Azure</option><option value="gcp">Google Cloud</option><option value="custom">Eigene</option></select></div>
    <p class="catalog-note">Eigene, vereinfachte Symbole · {{ components.length }} Komponenten</p>
    <div class="catalog-list"><button v-for="item in components" :key="`${item.set.id}:${item.component.type}`" class="catalog-item" :disabled="s.transitioning || !s.canWrite" @click="store.insertComponent(item.set, item.component.type)"><SafeIcon :source="item.component.iconSvg" /><span><strong>{{ item.component.name }}</strong><small>{{ item.component.provider.toUpperCase() }} · {{ item.component.category }}</small></span><span aria-hidden="true">+</span></button><p v-if="!components.length" class="panel-intro">Keine passende Komponente gefunden.</p></div>
    <label class="import-set">Eigenes Komponentenset importieren<input type="file" accept=".json,application/json" aria-label="Komponentenset als JSON importieren" :disabled="s.transitioning || !s.canWrite" @change="importSet" /></label>
  </aside>
  <aside v-if="s.objectsOpen && !s.codeOpen && !s.catalogOpen" id="objects-drawer" class="workspace-panel sd-panel" aria-label="Objekte">
    <div class="heading"><h2>Objekte <span>{{ s.objectList.length }}</span></h2><button class="sd-icon-btn" aria-label="Objekte schließen" @click="store.toggleObjects(false)">×</button></div>
    <p v-if="!s.objectList.length" class="panel-intro">Deine Elemente erscheinen hier. Mit einem Klick wählst du sie aus.</p>
    <ul class="object-list"><li v-for="item in s.objectList" :key="item.id"><button :aria-pressed="item.selected" :style="{ paddingLeft: `${12 + Math.min(item.depth, 8) * 12}px` }" @click="store.select([item.id], $event.shiftKey)" @dblclick="store.focusElement(item.id)"><span class="object-dot" aria-hidden="true">{{ item.kind === 'container' ? '▣' : '◇' }}</span>{{ item.name }}</button></li></ul>
  </aside>
</template>

<style scoped>
.workspace-panel{position:absolute;right:12px;top:96px;bottom:72px;width:320px;z-index:7;display:flex;flex-direction:column;overflow:hidden}.code-panel{width:min(520px,calc(100vw - 285px))}.heading{padding:8px 12px;display:flex;justify-content:space-between;align-items:center;border-bottom:1px solid var(--border-subtle);flex-shrink:0}h2{font-size:13px;font-weight:650}h2 span{color:var(--accent);margin-left:8px}.panel-intro{font-size:12px;color:var(--text-muted);padding:12px;line-height:1.6}.code-editor{flex:1;min-height:100px;resize:none;border:0;border-radius:0;background:var(--surface-panel);font:12px/1.7 var(--font-mono);tab-size:2;padding:12px;white-space:pre;overflow:auto}.panel-footer{display:flex;justify-content:space-between;gap:8px;border-top:1px solid var(--border-subtle);padding:12px}.conflict,.reset-confirm{background:var(--status-error-soft);font-size:12px;padding:12px}.reset-confirm button{margin-top:8px}.diagnostics{max-height:160px;overflow:auto;border-top:1px solid var(--border-subtle)}.diagnostics button{background:transparent;border:0;text-align:left;color:var(--status-error);font-size:12px;padding:8px 12px;cursor:pointer;width:100%;min-height:32px}.catalog-search{padding:12px;display:grid;gap:8px}.catalog-note{font-size:10px;color:var(--text-muted);padding:0 12px 12px}.catalog-list,.object-list{overflow:auto;flex:1}.catalog-item{background:transparent;border:0;border-bottom:1px solid var(--border-subtle);width:100%;text-align:left;display:flex;gap:12px;align-items:center;padding:12px;cursor:pointer}.catalog-item:hover,.object-list button:hover{background:var(--surface-raised)}.catalog-item strong{display:block;font-size:12px}.catalog-item small{font-size:10px;color:var(--text-muted)}.catalog-item>span:nth-child(2){flex:1}.catalog-item svg{flex-shrink:0}.import-set{padding:12px;border-top:1px solid var(--border-subtle);font-size:12px;font-weight:600}.import-set input{width:100%;margin-top:8px;font-size:11px}.object-list button{display:flex;align-items:center;gap:10px;min-height:40px;width:100%;padding:8px;border:0;background:transparent;text-align:left;cursor:pointer;font-size:12px;overflow-wrap:anywhere}.object-list button[aria-pressed=true]{background:var(--accent-soft);color:var(--accent)}.object-dot{font-size:20px;flex-shrink:0}@media(max-width:760px){.workspace-panel,.code-panel{top:142px;width:min(320px,calc(100vw - 24px));bottom:72px}}
@media (max-width:860px){.workspace-panel,.code-panel{top:188px;width:min(420px,calc(100vw - 24px));bottom:72px}}
</style>

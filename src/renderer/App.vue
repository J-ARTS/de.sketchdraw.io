<script setup lang="ts">
import { onBeforeUnmount, onMounted, provide, ref, shallowRef, watch } from 'vue';
import { createWhiteboardStore } from './state/whiteboard';
import { WHITEBOARD_KEY, type KeyInput } from './state/contract';
import TitleBar from './components/TitleBar.vue';
import Toolbar from './components/Toolbar.vue';
import WhiteboardCanvas from './components/WhiteboardCanvas.vue';
import PropertiesPanel from './components/PropertiesPanel.vue';
import WorkspacePanels from './components/WorkspacePanels.vue';
import AppDialog from './components/AppDialog.vue';
import InteropPanel from './components/InteropPanel.vue';
import AgentAccessPanel from './components/AgentAccessPanel.vue';
import CollaborationPanel from './components/CollaborationPanel.vue';
import AppIcon from './components/AppIcon.vue';

const store = createWhiteboardStore(); const s = store.state;
provide(WHITEBOARD_KEY, store);
const agentPanelOpen = ref(false), collaborationOpen = ref(false);
const authority = shallowRef(store.getAuthority());
const offAuthority = store.subscribeAuthority(value => { authority.value = value; });
const interopOpen = ref(false); const interopMode = ref<'import' | 'export'>('import');
function openInterop(mode: 'import' | 'export') { collaborationOpen.value = false; if (s.codeOpen) store.toggleCode(); if (s.catalogOpen) store.toggleCatalog(); store.toggleObjects(false); agentPanelOpen.value = false; interopMode.value = mode; interopOpen.value = true; }
function toggleAgents() { collaborationOpen.value = false; interopOpen.value = false; if (!agentPanelOpen.value) { if (s.codeOpen) store.toggleCode(); if (s.catalogOpen) store.toggleCatalog(); store.toggleObjects(false); } agentPanelOpen.value = !agentPanelOpen.value; }
function toggleCollaboration() { interopOpen.value = false; agentPanelOpen.value = false; if (!collaborationOpen.value) { if (s.codeOpen) store.toggleCode(); if (s.catalogOpen) store.toggleCatalog(); store.toggleObjects(false); } collaborationOpen.value = !collaborationOpen.value; }
watch(() => [s.codeOpen, s.catalogOpen, s.objectsOpen], values => { if (values.some(Boolean)) { collaborationOpen.value = false; agentPanelOpen.value = false; interopOpen.value = false; } });
watch(() => s.theme, value => { document.documentElement.dataset.theme = value; }, { immediate: true });
function key(event: KeyboardEvent): KeyInput {
  const target = event.target as Element;
  return { key: event.key, code: event.code, shiftKey: event.shiftKey, altKey: event.altKey, ctrlKey: event.ctrlKey, metaKey: event.metaKey, repeat: event.repeat, isComposing: event.isComposing, scope: target?.closest('input,textarea,[contenteditable=true]') ? 'text' : target?.closest('[data-testid=whiteboard-canvas]') ? 'canvas' : 'other' };
}
function keydown(event: KeyboardEvent) { if (!event.defaultPrevented && store.handleKeyDown(key(event))) event.preventDefault(); }
function keyup(event: KeyboardEvent) { store.handleKeyUp(key(event)); }
function beforeUnload(event: BeforeUnloadEvent) { if (s.bridgePlatform === 'browser' && store.needsCloseWarning()) { event.preventDefault(); event.returnValue = ''; } }
onMounted(() => { window.addEventListener('keydown', keydown); window.addEventListener('keyup', keyup); window.addEventListener('beforeunload', beforeUnload); });
onBeforeUnmount(() => { window.removeEventListener('keydown', keydown); window.removeEventListener('keyup', keyup); window.removeEventListener('beforeunload', beforeUnload); offAuthority(); store.dispose(); });
</script>

<template>
  <main class="workspace" aria-label="Sketchdraw Arbeitsbereich">
    <div class="workspace-content" :inert="s.transitioning || undefined">
      <WhiteboardCanvas /><TitleBar @interop="openInterop" /><Toolbar /><PropertiesPanel /><WorkspacePanels /><InteropPanel :open="interopOpen" :mode="interopMode" @close="interopOpen = false" /><AgentAccessPanel :open="agentPanelOpen" @close="agentPanelOpen = false" /><CollaborationPanel :open="collaborationOpen" :authority="authority" :join-guest="store.joinGuestSession" :leave-guest="store.leaveGuestSession" @close="collaborationOpen = false" />
      <nav class="workspace-switch sd-panel" aria-label="Arbeitsansicht"><button class="sd-btn" :aria-pressed="collaborationOpen" @click="toggleCollaboration">Zusammenarbeiten</button><button class="sd-btn" :aria-pressed="agentPanelOpen" @click="toggleAgents">Agenten</button><button class="sd-btn" :aria-pressed="s.catalogOpen" @click="store.toggleCatalog()"><AppIcon name="component" :size="16" />Bibliothek</button><button class="sd-btn" :aria-pressed="s.codeOpen" @click="store.toggleCode()"><span class="code-icon" aria-hidden="true">&lt;/&gt;</span>Code</button></nav>
      <div class="bottom-tools sd-panel" role="group" aria-label="Ansicht und Verlauf">
        <button class="sd-icon-btn" aria-label="Verkleinern" :disabled="s.viewport.zoom <= .1" @click="store.zoomBy(1 / 1.2)"><AppIcon name="minus" /></button><button class="zoom-value" aria-label="Zoom auf 100 Prozent" @click="store.zoomTo(1)">{{ Math.round(s.viewport.zoom * 100) }} %</button><button class="sd-icon-btn" aria-label="Vergrößern" :disabled="s.viewport.zoom >= 4" @click="store.zoomBy(1.2)"><AppIcon name="plus" /></button><span class="separator" /><button class="sd-icon-btn" aria-label="Alles anzeigen" @click="store.fitAll()"><AppIcon name="fit-all" /></button><span class="separator" /><button class="sd-icon-btn" aria-label="Rückgängig" :disabled="!s.history.canUndo" @click="store.undo()"><AppIcon name="undo" /></button><button class="sd-icon-btn" aria-label="Wiederholen" :disabled="!s.history.canRedo" @click="store.redo()"><AppIcon name="redo" /></button>
      </div>
      <div class="workspace-footnote"><span class="local-dot" />{{ s.bridgePlatform === 'browser' ? 'Lokal im Browser · Speichern als Download' : 'Dein Dokument bleibt bei dir' }}</div>
      <button v-if="s.offscreenChanges" class="external-changes sd-btn" @click="store.revealOffscreenChanges()">{{ s.offscreenChanges }} externe Änderungen anzeigen</button>
      <div class="feedback-stack">
        <div class="notices" role="region" aria-label="Meldungen"><div v-for="notice in s.notices" :key="notice.id" class="notice sd-panel" :class="{ error: notice.kind === 'error' }"><span>{{ notice.text }}</span><button class="sd-icon-btn" aria-label="Meldung schließen" @click="store.dismissNotice(notice.id)">×</button></div></div>
        <div v-if="s.pendingPeerWrite" class="property-draft sd-panel" role="alert"><span>Peer-Änderung noch nicht bestätigt. Dein Entwurf bleibt erhalten.</span><button class="sd-btn" @click="store.resolvePendingWrite()">Ausgang prüfen</button></div>
        <div v-if="s.propertyDraft && !s.pendingPeerWrite" class="property-draft sd-panel" role="status"><span>Eigenschaftenentwurf {{ s.propertyDraft.baseRevision !== s.revision ? '– das Dokument hat sich geändert.' : 'noch nicht übernommen.' }}</span><button class="sd-btn" @click="store.commitPropertyDraft()">Übernehmen</button><button class="sd-btn" @click="store.discardPropertyDraft()">Verwerfen</button></div>
        <div v-if="s.gestureConflict && !s.pendingPeerWrite" class="gesture-conflict sd-panel" role="alert"><p>{{ s.gestureConflict.message }}</p><button class="sd-btn" @click="store.resolveGestureConflict('discard')">Vorschau verwerfen</button><button v-if="s.gestureConflict.canRetry" class="sd-btn" @click="store.resolveGestureConflict('retry')">Meine Änderung übernehmen</button></div>
      </div>
    </div>
    <span class="visually-hidden" role="status" aria-live="polite" aria-atomic="true">{{ s.liveMessage }}</span>
    <AppDialog />
  </main>
</template>

<style scoped>
.workspace,.workspace-content{position:absolute;inset:0;overflow:hidden}.workspace-switch{position:absolute;top:52px;right:12px;display:flex;gap:4px;padding:4px;z-index:9}.workspace-switch .sd-btn{border-color:transparent;min-height:28px;font-size:11px;padding:0 9px}.workspace-switch .sd-btn[aria-pressed=true]{border-color:var(--accent)}.code-icon{font-family:var(--font-mono);font-weight:700}.bottom-tools{position:absolute;bottom:16px;left:16px;display:flex;align-items:center;padding:4px;z-index:9}.zoom-value{border:0;background:none;font-size:12px;min-height:36px;min-width:52px;cursor:pointer}.separator{height:20px;width:1px;background:var(--border-subtle);margin:0 4px}.workspace-footnote{position:absolute;right:20px;bottom:28px;display:flex;gap:7px;align-items:center;color:var(--text-muted);font-size:10px;pointer-events:none}.local-dot{width:6px;height:6px;background:var(--status-ok);border-radius:50%}.feedback-stack{position:absolute;bottom:76px;left:280px;right:16px;z-index:30;display:flex;flex-direction:column;align-items:center;gap:8px;pointer-events:none}.notices{width:min(480px,100%);display:grid;gap:6px;pointer-events:none}.notice{display:flex;gap:12px;align-items:center;padding:4px 4px 4px 12px;font-size:12px;pointer-events:auto}.notice span{flex:1}.notice.error{border-color:var(--status-error)}.gesture-conflict{width:min(640px,100%);padding:14px;pointer-events:auto}.gesture-conflict p{margin-bottom:10px}.external-changes{position:absolute;bottom:78px;left:16px}@media(max-width:1000px){.workspace-footnote{display:none}}@media(max-width:760px){.workspace-switch{top:96px;right:12px}.bottom-tools{bottom:12px;left:12px}}
@media (max-width:860px){.workspace-switch{top:142px;right:12px}}
.property-draft{padding:8px;display:flex;gap:8px;align-items:center;font-size:12px;max-width:100%;flex-wrap:wrap;pointer-events:auto}@media(max-width:860px){.feedback-stack{left:12px;right:12px}}
</style>

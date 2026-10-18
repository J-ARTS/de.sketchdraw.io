<script setup lang="ts">
import { onBeforeUnmount, onMounted, provide, ref, shallowRef, watch } from 'vue';
import { attachRendererAgentSession, type RendererAgentSession } from '../agent-access/renderer-session';
import type { DocumentAuthority } from '../session';
import { createWhiteboardStore } from './state/whiteboard';
import { WHITEBOARD_KEY, type KeyInput } from './state/contract';
import MainMenu from './components/MainMenu.vue';
import Toolbar from './components/Toolbar.vue';
import WhiteboardCanvas from './components/WhiteboardCanvas.vue';
import SelectionToolbar from './components/SelectionToolbar.vue';
import WorkspacePanels from './components/WorkspacePanels.vue';
import AppDialog from './components/AppDialog.vue';
import InteropPanel from './components/InteropPanel.vue';
import CollaborationPanel from './components/CollaborationPanel.vue';
import Minimap from './components/Minimap.vue';
import AppIcon from './components/AppIcon.vue';
import CommentsLayer from './components/CommentsLayer.vue';
import CommentSidebar from './components/CommentSidebar.vue';
import TaskBoard from './components/TaskBoard.vue';
import FrameSidebar from './components/FrameSidebar.vue';
import PresenterMode from './components/PresenterMode.vue';
import PluginSettings from './components/PluginSettings.vue';

const store = createWhiteboardStore(); const s = store.state;
provide(WHITEBOARD_KEY, store);
const collaborationOpen = ref(false);
const pluginsOpen = ref(false);
const authority = shallowRef(store.getAuthority());
let agentSession: RendererAgentSession | undefined;
function attachAgentAccess(value: DocumentAuthority | null) {
  agentSession?.dispose(); agentSession = undefined;
  const bridge = window.sketchdrawAgentAccess;
  if (!value || !bridge?.isAvailable) return;
  try {
    const session = attachRendererAgentSession(value, bridge);
    agentSession = session;
    void session.ready.catch(() => { if (agentSession === session) agentSession = undefined; });
  } catch { agentSession = undefined; }
}
attachAgentAccess(authority.value);
const offAuthority = store.subscribeAuthority(value => { authority.value = value; attachAgentAccess(value); });
const interopOpen = ref(false); const interopMode = ref<'import' | 'export'>('import');
function openInterop(mode: 'import' | 'export') { collaborationOpen.value = false; if (s.codeOpen) store.toggleCode(); if (s.catalogOpen) store.toggleCatalog(); store.toggleObjects(false); interopMode.value = mode; interopOpen.value = true; }
function toggleCollaboration() { interopOpen.value = false; if (!collaborationOpen.value) { if (s.codeOpen) store.toggleCode(); if (s.catalogOpen) store.toggleCatalog(); store.toggleObjects(false); } collaborationOpen.value = !collaborationOpen.value; }
function togglePlugins() { collaborationOpen.value = false; interopOpen.value = false; pluginsOpen.value = !pluginsOpen.value; }
watch(() => [s.codeOpen, s.catalogOpen, s.objectsOpen], values => { if (values.some(Boolean)) { collaborationOpen.value = false; interopOpen.value = false; pluginsOpen.value = false; } });
watch(() => s.theme, value => { document.documentElement.dataset.theme = value; }, { immediate: true });
function key(event: KeyboardEvent): KeyInput {
  const target = event.target as Element;
  return { key: event.key, code: event.code, shiftKey: event.shiftKey, altKey: event.altKey, ctrlKey: event.ctrlKey, metaKey: event.metaKey, repeat: event.repeat, isComposing: event.isComposing, scope: target?.closest('input,textarea,[contenteditable=true]') ? 'text' : target?.closest('[data-testid=whiteboard-canvas]') ? 'canvas' : 'other' };
}
function keydown(event: KeyboardEvent) { if (!event.defaultPrevented && store.handleKeyDown(key(event))) event.preventDefault(); }
function keyup(event: KeyboardEvent) { store.handleKeyUp(key(event)); }
function beforeUnload(event: BeforeUnloadEvent) { if (s.bridgePlatform === 'browser' && store.needsCloseWarning()) { event.preventDefault(); event.returnValue = ''; } }
onMounted(() => { window.addEventListener('keydown', keydown); window.addEventListener('keyup', keyup); window.addEventListener('beforeunload', beforeUnload); });
onBeforeUnmount(() => { window.removeEventListener('keydown', keydown); window.removeEventListener('keyup', keyup); window.removeEventListener('beforeunload', beforeUnload); agentSession?.dispose(); offAuthority(); store.dispose(); });
</script>

<template>
  <main class="workspace" aria-label="Sketchdraw Arbeitsbereich">
    <div class="workspace-content" :inert="s.transitioning || s.presenterOpen || undefined">
      <WhiteboardCanvas v-if="s.workspaceView === 'canvas'" /><TaskBoard v-else /><MainMenu :collaboration-open="collaborationOpen" :plugins-open="pluginsOpen" @interop="openInterop" @collaboration="toggleCollaboration" @plugins="togglePlugins" /><template v-if="s.workspaceView === 'canvas'"><Toolbar /><SelectionToolbar /><WorkspacePanels /><CommentsLayer /><CommentSidebar /><FrameSidebar /></template><InteropPanel :open="interopOpen" :mode="interopMode" @close="interopOpen = false" /><CollaborationPanel :open="collaborationOpen" :authority="authority" :join-guest="store.joinGuestSession" :leave-guest="store.leaveGuestSession" @close="collaborationOpen = false" /><PluginSettings :open="pluginsOpen" @close="pluginsOpen = false" />
      <div v-if="s.workspaceView === 'canvas'" class="bottom-tools sd-panel" role="group" aria-label="Ansicht und Verlauf">
        <button class="sd-icon-btn zoom-btn" aria-label="Verkleinern" :disabled="s.viewport.zoom <= .1" @click="store.zoomBy(1 / 1.2)"><AppIcon name="minus" /></button><button class="zoom-value" aria-label="Zoom auf 100 Prozent" @click="store.zoomTo(1)">{{ Math.round(s.viewport.zoom * 100) }} %</button><button class="sd-icon-btn zoom-btn" aria-label="Vergrößern" :disabled="s.viewport.zoom >= 4" @click="store.zoomBy(1.2)"><AppIcon name="plus" /></button><span class="separator" aria-hidden="true" /><button class="sd-icon-btn zoom-btn" aria-label="Alles anzeigen" @click="store.fitAll()"><AppIcon name="fit-all" /></button><span class="separator" aria-hidden="true" /><button class="sd-icon-btn zoom-btn" aria-label="Rückgängig" :disabled="!s.history.canUndo" @click="store.undo()"><AppIcon name="undo" /></button><button class="sd-icon-btn zoom-btn" aria-label="Wiederholen" :disabled="!s.history.canRedo" @click="store.redo()"><AppIcon name="redo" /></button>
      </div>
      <Minimap v-if="s.workspaceView === 'canvas' && !(s.codeOpen || s.catalogOpen || s.objectsOpen || s.commentSidebarOpen || s.frameSidebarOpen || collaborationOpen || interopOpen)" />
      <button v-if="s.workspaceView === 'canvas' && !(s.frameSidebarOpen || s.codeOpen || s.catalogOpen || s.objectsOpen || s.commentSidebarOpen || collaborationOpen || interopOpen)" class="slides-toggle sd-btn" aria-label="Folienleiste öffnen" @click="store.toggleFrameSidebar(true)"><AppIcon name="pages" /> Folien <span v-if="s.frameSlides.length">{{ s.frameSlides.length }}</span></button>
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
    <PresenterMode v-if="s.presenterOpen" />
  </main>
</template>

<style scoped>
.workspace,.workspace-content{position:absolute;inset:0;overflow:hidden}.bottom-tools{position:absolute;bottom:16px;left:16px;display:flex;align-items:center;gap:2px;height:var(--chrome-height);padding:0 6px;z-index:9}.zoom-btn{width:var(--chrome-control);height:var(--chrome-control);border-radius:10px}.zoom-value{min-width:60px;min-height:var(--chrome-control);padding:0 6px;border:0;border-radius:10px;background:none;font-size:var(--font-size-m);font-weight:500;font-variant-numeric:tabular-nums;cursor:pointer}.zoom-value:hover{background:var(--surface-raised)}.separator{height:24px;width:1px;background:var(--border-subtle);margin:0 6px}.feedback-stack{position:absolute;bottom:76px;left:16px;right:16px;z-index:30;display:flex;flex-direction:column;align-items:center;gap:8px;pointer-events:none}.notices{width:min(480px,100%);display:grid;gap:6px;pointer-events:none}.notice{display:flex;gap:12px;align-items:center;padding:4px 4px 4px 12px;font-size:12px;pointer-events:auto}.notice span{flex:1}.notice.error{border-color:var(--status-error)}.gesture-conflict{width:min(640px,100%);padding:14px;pointer-events:auto}.gesture-conflict p{margin-bottom:10px}.external-changes{position:absolute;bottom:84px;left:16px}@media(max-width:760px){.bottom-tools{bottom:12px;left:12px}}
.property-draft{padding:8px;display:flex;gap:8px;align-items:center;font-size:12px;max-width:100%;flex-wrap:wrap;pointer-events:auto}@media(max-width:860px){.feedback-stack{left:12px;right:12px}}
.slides-toggle{position:absolute;right:16px;bottom:76px;z-index:9;display:flex;align-items:center;gap:7px}.slides-toggle :deep(svg){width:17px}.slides-toggle span{display:grid;place-items:center;min-width:20px;height:20px;padding:0 5px;border-radius:10px;background:var(--accent-soft);color:var(--accent);font-size:10px;font-weight:750}
</style>

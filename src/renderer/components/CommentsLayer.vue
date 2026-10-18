<script setup lang="ts">
import { computed, nextTick, ref, watch } from 'vue';
import type { CommentMessage, CommentThread } from '@/domain';
import { commentTargetPoint } from '../lib/comments';
import { docToScreen } from '../lib/viewport';
import { useWhiteboard } from './use-whiteboard';
import AppIcon from './AppIcon.vue';

const store = useWhiteboard(); const s = store.state;
const draft = ref(''); const reply = ref(''); const menuOpen = ref(false);
const editingId = ref<string | null>(null); const editDraft = ref('');
const composerInput = ref<HTMLTextAreaElement | null>(null);
const threads = computed(() => s.document.commentThreads ?? []);
const active = computed(() => threads.value.find((entry) => entry.id === s.activeCommentId) ?? null);
const tasks = computed(() => s.document.tasks ?? []);
const pins = computed(() => threads.value.map((thread) => ({ thread, point: docToScreen(s.viewport, commentTargetPoint(thread.target, s.document)) })));
const composerPoint = computed(() => s.commentComposerTarget ? docToScreen(s.viewport, commentTargetPoint(s.commentComposerTarget, s.document)) : null);
const activePoint = computed(() => active.value ? docToScreen(s.viewport, commentTargetPoint(active.value.target, s.document)) : null);
const activeTarget = computed(() => active.value?.target.elementId ? s.document.elements.find((entry) => entry.id === active.value!.target.elementId) : undefined);
const highlightStyle = computed(() => {
  const element = activeTarget.value; if (!element) return {};
  const point = docToScreen(s.viewport, element);
  return { left: `${point.x - 5}px`, top: `${point.y - 5}px`, width: `${element.width * s.viewport.zoom + 10}px`, height: `${element.height * s.viewport.zoom + 10}px`, transform: `rotate(${element.rotation}deg)` };
});
const threadStyle = computed(() => {
  const point = activePoint.value; if (!point) return {};
  return { left: `clamp(16px, ${point.x + 28}px, calc(100vw - 720px))`, top: `clamp(92px, ${point.y - 32}px, calc(100vh - 470px))` };
});
function initials(name: string): string { return name.trim().split(/\s+/).map((part) => part[0]).join('').slice(0, 2).toUpperCase() || '?'; }
function relative(iso: string): string {
  const seconds = Math.round((Date.parse(iso) - Date.now()) / 1000); const absolute = Math.abs(seconds);
  const [value, unit] = absolute < 60 ? [seconds, 'second'] : absolute < 3600 ? [Math.round(seconds / 60), 'minute'] : absolute < 86400 ? [Math.round(seconds / 3600), 'hour'] : [Math.round(seconds / 86400), 'day'];
  return new Intl.RelativeTimeFormat('de', { numeric: 'auto' }).format(value, unit as Intl.RelativeTimeFormatUnit);
}
async function submitNew(): Promise<void> { if (await store.createComment(draft.value)) { draft.value = ''; await nextTick(); } }
async function submitReply(): Promise<void> { if (active.value && await store.addCommentReply(active.value.id, reply.value)) reply.value = ''; }
function startEdit(message: CommentMessage): void { editingId.value = message.id; editDraft.value = message.body; }
async function saveEdit(thread: CommentThread, message: CommentMessage): Promise<void> { if (await store.editCommentMessage(thread.id, message.id, editDraft.value)) editingId.value = null; }
async function threadAction(action: 'unread' | 'link' | 'task' | 'delete'): Promise<void> {
  const thread = active.value; if (!thread) return; menuOpen.value = false;
  if (action === 'unread') store.markCommentUnread(thread.id);
  else if (action === 'link') await store.copyCommentLink(thread.id);
  else if (action === 'task') await store.createTaskFromComment(thread.id);
  else await store.deleteCommentThread(thread.id);
}
watch(() => s.commentComposerTarget, async (value) => { if (value) { draft.value = ''; await nextTick(); composerInput.value?.focus(); } });
watch(() => s.activeCommentId, () => { reply.value = ''; editingId.value = null; menuOpen.value = false; });
</script>

<template>
  <div class="comments-layer" role="group" aria-label="Kommentare auf der Zeichenfläche">
    <div v-if="activeTarget" class="target-highlight" :style="highlightStyle" aria-hidden="true" />
    <button v-for="pin in pins" :key="pin.thread.id" type="button" class="comment-pin" :class="{ active: pin.thread.id === s.activeCommentId, resolved: pin.thread.resolved, unread: s.unreadCommentIds.includes(pin.thread.id) }" :style="{ left: `${pin.point.x}px`, top: `${pin.point.y}px` }" :aria-label="`Kommentar von ${pin.thread.messages[0]?.authorName ?? 'Unbekannt'} öffnen`" @click="store.openComment(pin.thread.id)">
      <span class="avatar">{{ initials(pin.thread.messages[0]?.authorName ?? '') }}</span>
      <span class="hover-card" role="tooltip"><strong>{{ pin.thread.messages.at(-1)?.authorName }}</strong><span>{{ relative(pin.thread.updatedAt) }}</span><p>{{ pin.thread.messages.at(-1)?.body }}</p></span>
    </button>

    <form v-if="composerPoint" class="comment-composer sd-panel" :style="{ left: `clamp(16px, ${composerPoint.x + 24}px, calc(100vw - 700px))`, top: `clamp(88px, ${composerPoint.y - 24}px, calc(100vh - 220px))` }" @submit.prevent="submitNew">
      <label for="new-comment">Kommentar</label>
      <textarea id="new-comment" ref="composerInput" v-model="draft" maxlength="50000" placeholder="Schreibe einen Kommentar …" @keydown.escape.prevent="store.cancelComment()" />
      <div><button type="button" class="sd-btn" @click="store.cancelComment()">Abbrechen</button><button type="submit" class="sd-btn primary" :disabled="!draft.trim()">Senden</button></div>
    </form>

    <section v-if="active" class="thread-popover sd-panel" :style="threadStyle" data-testid="comment-thread" aria-label="Kommentar-Thread">
      <header><h2>Kommentar</h2><div class="thread-actions"><button class="sd-icon-btn" :aria-label="active.resolved ? 'Wieder öffnen' : 'Als erledigt markieren'" @click="store.setCommentResolved(active.id, !active.resolved)"><AppIcon name="check" /></button><button class="sd-icon-btn" aria-label="Weitere Kommentaraktionen" aria-haspopup="menu" :aria-expanded="menuOpen" @click="menuOpen = !menuOpen"><AppIcon name="more" /></button><button class="sd-icon-btn" aria-label="Kommentar schließen" @click="store.closeCommentThread()"><AppIcon name="close" /></button></div></header>
      <div v-if="menuOpen" class="thread-menu" role="menu">
        <button role="menuitem" @click="threadAction('unread')">Als ungelesen markieren</button>
        <button role="menuitem" @click="threadAction('link')">Link kopieren</button>
        <button role="menuitem" :disabled="tasks.some((task) => task.sourceThreadId === active!.id)" @click="threadAction('task')">{{ tasks.some((task) => task.sourceThreadId === active!.id) ? 'Aufgabe bereits erstellt' : 'Aufgabe erstellen' }}</button>
        <button role="menuitem" class="danger" @click="threadAction('delete')">Thread löschen</button>
      </div>
      <div class="message-list">
        <article v-for="message in active.messages" :key="message.id" class="message">
          <span class="avatar">{{ initials(message.authorName) }}</span><div><div class="message-head"><strong>{{ message.authorName }}</strong><time :datetime="message.createdAt">{{ relative(message.createdAt) }}</time><button v-if="message.authorId === s.currentActorId && editingId !== message.id" @click="startEdit(message)">Bearbeiten</button></div>
          <template v-if="editingId === message.id"><textarea v-model="editDraft" :aria-label="`Kommentar von ${message.authorName} bearbeiten`" /><div class="edit-actions"><button class="sd-btn" @click="editingId = null">Abbrechen</button><button class="sd-btn primary" @click="saveEdit(active!, message)">Speichern</button></div></template><p v-else>{{ message.body }} <small v-if="message.editedAt">bearbeitet</small></p></div>
        </article>
      </div>
      <form class="reply" @submit.prevent="submitReply"><span class="avatar">{{ initials('Lokaler Benutzer') }}</span><textarea v-model="reply" aria-label="Auf Kommentar antworten" placeholder="Antworten" @keydown.meta.enter.prevent="submitReply" @keydown.ctrl.enter.prevent="submitReply" /><button type="submit" class="send" :disabled="!reply.trim()" aria-label="Antwort senden">↑</button></form>
    </section>
  </div>
</template>

<style scoped>
.comments-layer{position:absolute;inset:0;z-index:18;pointer-events:none}.comment-pin{position:absolute;display:grid;place-items:center;width:38px;height:38px;padding:0;transform:translate(-50%,-50%);border:3px solid var(--surface-panel);border-radius:50%;background:var(--accent);box-shadow:var(--shadow-1);color:white;pointer-events:auto}.comment-pin.active{outline:3px solid color-mix(in srgb,var(--accent) 55%,white);outline-offset:2px}.comment-pin.resolved{opacity:.55}.comment-pin.unread::after{content:'';position:absolute;right:-2px;top:-2px;width:9px;height:9px;border:2px solid var(--surface-panel);border-radius:50%;background:var(--status-error)}.avatar{display:grid;place-items:center;flex:none;width:38px;height:38px;border-radius:50%;background:var(--accent);color:#fff;font-size:14px;font-weight:650}.hover-card{position:absolute;left:48px;top:0;display:none;grid-template-columns:auto auto;gap:2px 8px;width:320px;padding:16px 18px;border:1px solid var(--border-subtle);border-radius:18px;background:var(--surface-panel);box-shadow:var(--shadow-2);color:var(--text-primary);text-align:left}.hover-card p{grid-column:1/-1;margin:5px 0 0;white-space:pre-wrap}.hover-card span{color:var(--text-muted)}.comment-pin:hover .hover-card,.comment-pin:focus-visible .hover-card{display:grid}.comment-composer,.thread-popover{position:absolute;pointer-events:auto}.comment-composer{display:grid;gap:10px;width:min(360px,calc(100vw - 32px));padding:14px}.comment-composer textarea,.message textarea,.reply textarea{width:100%;min-height:74px;padding:10px;border:1px solid var(--border-subtle);border-radius:10px;background:var(--surface-raised);color:var(--text-primary);resize:vertical}.comment-composer>div,.edit-actions{display:flex;justify-content:flex-end;gap:8px}.sd-btn.primary{background:var(--accent);color:#fff}.target-highlight{position:absolute;border:3px solid var(--accent);border-radius:8px;box-shadow:0 0 0 4px color-mix(in srgb,var(--accent) 18%,transparent);transform-origin:center;pointer-events:none}.thread-popover{width:min(520px,calc(100vw - 380px));max-height:min(620px,calc(100vh - 110px));overflow:auto}.thread-popover header{position:sticky;top:0;z-index:2;display:flex;align-items:center;justify-content:space-between;padding:12px 14px;border-bottom:1px solid var(--border-subtle);background:var(--surface-panel)}.thread-popover h2{font-size:15px}.thread-actions{display:flex}.thread-menu{position:absolute;z-index:4;right:52px;top:54px;display:grid;width:230px;padding:8px;border-radius:14px;background:#202020;box-shadow:var(--shadow-2)}.thread-menu button{min-height:40px;padding:0 12px;border:0;border-radius:8px;background:transparent;color:white;text-align:left}.thread-menu button:hover{background:#343434}.thread-menu .danger{color:#ff9a9a}.message-list{display:grid;gap:18px;padding:18px}.message{display:flex;gap:12px}.message>div{flex:1;min-width:0}.message-head{display:flex;align-items:center;gap:8px}.message-head time{color:var(--text-muted)}.message-head button{margin-left:auto;border:0;background:transparent;color:var(--accent);font-size:12px}.message p{margin:8px 0 0;white-space:pre-wrap;word-break:break-word}.message small{color:var(--text-muted)}.reply{display:flex;align-items:flex-start;gap:10px;padding:14px 18px;border-top:1px solid var(--border-subtle)}.reply textarea{min-height:50px}.send{width:38px;height:38px;border:0;border-radius:50%;background:var(--accent);color:#fff}.send:disabled{opacity:.4}@media(max-width:900px){.thread-popover{left:12px!important;right:12px;width:auto}.hover-card{width:240px}.target-highlight{display:none}}
</style>

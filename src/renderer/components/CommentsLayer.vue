<script setup lang="ts">
import { computed, nextTick, ref, useId, watch } from 'vue';
import { useElementSize, useEventListener } from '@vueuse/core';
import type { CommentMessage, CommentThread } from '@/domain';
import { commentTargetPoint } from '../lib/comments';
import { docToScreen } from '../lib/viewport';
import { useWhiteboard } from './use-whiteboard';
import AppIcon from './AppIcon.vue';

const store = useWhiteboard(); const s = store.state;
const draft = ref(''); const reply = ref(''); const menuOpen = ref(false);
const editingId = ref<string | null>(null); const editDraft = ref('');
const composerInput = ref<HTMLTextAreaElement | null>(null);
// #88: composer and thread end above the zoom bar and notices (--panel-bottom), using their measured height.
const PIN_SIZE = 36; const COMPOSER_WIDTH = 360;
const composerEl = ref<HTMLElement | null>(null);
function fitComposer(): void { const input = composerInput.value; if (!input) return; input.style.height = 'auto'; input.style.height = `${Math.min(input.scrollHeight, 160)}px`; }
const threadEl = ref<HTMLElement | null>(null);
const { height: composerHeight } = useElementSize(composerEl, undefined, { box: 'border-box' });
const { height: threadHeight } = useElementSize(threadEl, undefined, { box: 'border-box' });
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
  return { left: `clamp(16px, ${point.x + PIN_SIZE + 8}px, calc(100vw - 720px))`, top: `clamp(var(--panel-top), ${point.y - PIN_SIZE}px, calc(100vh - var(--panel-bottom) - ${Math.ceil(threadHeight.value)}px))` };
});
const composerStyle = computed(() => {
  const point = composerPoint.value; if (!point) return {};
  // Directly right of the pin (its bottom-left tip sits on the target), vertically aligned with the pin.
  return { left: `min(${point.x + PIN_SIZE + 8}px, calc(100vw - ${COMPOSER_WIDTH + 16}px))`, top: `clamp(var(--panel-top), ${point.y - PIN_SIZE}px, calc(100vh - var(--panel-bottom) - ${Math.ceil(composerHeight.value)}px))` };
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
// --- Thread actions menu (#82): ARIA menu button with roving focus, like the file menu. ---
const menuId = `${useId()}-comment-actions`;
const menuTrigger = ref<HTMLButtonElement | null>(null);
const menuEl = ref<HTMLElement | null>(null);
function menuItems(): HTMLElement[] { return Array.from(menuEl.value?.querySelectorAll<HTMLElement>('[role="menuitem"]:not(:disabled)') ?? []); }
async function openMenu(target: 'first' | 'last'): Promise<void> {
  menuOpen.value = true;
  await nextTick();
  const items = menuItems();
  (target === 'last' ? items[items.length - 1] : items[0])?.focus();
}
function closeMenu(returnFocus: boolean): void {
  if (!menuOpen.value) return;
  menuOpen.value = false;
  if (returnFocus) menuTrigger.value?.focus();
}
function toggleMenu(): void { if (menuOpen.value) closeMenu(true); else void openMenu('first'); }
function onMenuTriggerKeydown(event: KeyboardEvent): void {
  if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return;
  event.preventDefault();
  void openMenu(event.key === 'ArrowUp' ? 'last' : 'first');
}
function onMenuKeydown(event: KeyboardEvent): void { rovingMenuKey(event, menuItems(), closeMenu); }
// --- Per-message menu ("…"): Bearbeiten / Löschen for the actor's own messages. ---
const messageMenuFor = ref<string | null>(null);
let messageMenuEl = null as HTMLElement | null;
let messageTrigger = null as HTMLElement | null;
function messageMenuItems(): HTMLElement[] { return Array.from(messageMenuEl?.querySelectorAll<HTMLElement>('[role="menuitem"]') ?? []); }
async function openMessageMenu(message: CommentMessage, event: Event, target: 'first' | 'last' = 'first'): Promise<void> {
  const trigger = event.currentTarget as HTMLElement;
  if (messageMenuFor.value === message.id && event.type === 'click') { closeMessageMenu(true); return; }
  messageTrigger = trigger; messageMenuFor.value = message.id; menuOpen.value = false;
  await nextTick();
  const items = messageMenuItems();
  (target === 'last' ? items[items.length - 1] : items[0])?.focus();
}
function closeMessageMenu(returnFocus: boolean): void {
  if (messageMenuFor.value === null) return;
  messageMenuFor.value = null;
  if (returnFocus) messageTrigger?.focus();
}
function onMessageTriggerKeydown(message: CommentMessage, event: KeyboardEvent): void {
  if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return;
  event.preventDefault();
  void openMessageMenu(message, event, event.key === 'ArrowUp' ? 'last' : 'first');
}
function onMessageMenuKeydown(event: KeyboardEvent): void { rovingMenuKey(event, messageMenuItems(), closeMessageMenu); }
async function messageAction(thread: CommentThread, message: CommentMessage, action: 'edit' | 'delete'): Promise<void> {
  closeMessageMenu(false);
  if (action === 'edit') { startEdit(message); await nextTick(); document.querySelector<HTMLTextAreaElement>('.message textarea')?.focus(); }
  else await store.deleteCommentMessage(thread.id, message.id);
}
useEventListener(document, 'pointerdown', (event: PointerEvent) => { if (messageMenuFor.value !== null && !(event.target instanceof Node && (messageMenuEl?.contains(event.target) || messageTrigger?.contains(event.target)))) messageMenuFor.value = null; }, true);
/** Arrow/Home/End roving focus; Escape and Tab close and return focus to the trigger. */
function rovingMenuKey(event: KeyboardEvent, items: HTMLElement[], close: (returnFocus: boolean) => void): void {
  const current = items.findIndex((item) => item === document.activeElement);
  let next: number;
  switch (event.key) {
    case 'ArrowDown': next = (current + 1) % items.length; break;
    case 'ArrowUp': next = (current - 1 + items.length) % items.length; break;
    case 'Home': next = 0; break;
    case 'End': next = items.length - 1; break;
    case 'Escape':
    case 'Tab':
      event.preventDefault();
      event.stopPropagation();
      close(true);
      return;
    default:
      return;
  }
  event.preventDefault();
  event.stopPropagation();
  items[next]?.focus();
}
function belongsToMenu(node: unknown): boolean {
  return node instanceof Node && Boolean(menuEl.value?.contains(node) || menuTrigger.value?.contains(node));
}
function onMenuFocusOut(event: FocusEvent): void { if (!belongsToMenu(event.relatedTarget)) menuOpen.value = false; }
useEventListener(document, 'pointerdown', (event: PointerEvent) => { if (menuOpen.value && !belongsToMenu(event.target)) menuOpen.value = false; }, true);

async function threadAction(action: 'unread' | 'link' | 'task' | 'delete'): Promise<void> {
  const thread = active.value; if (!thread) return;
  closeMenu(action !== 'delete');
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
    <button v-for="pin in pins" :key="pin.thread.id" type="button" class="comment-pin" :class="{ active: pin.thread.id === s.activeCommentId, resolved: pin.thread.resolved, unread: s.unreadCommentIds.includes(pin.thread.id) }" :style="{ left: `${pin.point.x}px`, top: `${pin.point.y}px` }" :aria-label="`Kommentar von ${pin.thread.messages[0]?.authorName ?? 'Unbekannt'} öffnen`" @click="store.openComment(pin.thread.id, { reveal: false })">
      <span class="pin-initials" aria-hidden="true">{{ initials(pin.thread.messages[0]?.authorName ?? '') }}</span>
      <span class="hover-card" role="tooltip"><strong>{{ pin.thread.messages.at(-1)?.authorName }}</strong><span>{{ relative(pin.thread.updatedAt) }}</span><p>{{ pin.thread.messages.at(-1)?.body }}</p></span>
    </button>

    <span v-if="composerPoint" class="comment-pin comment-pin--draft" :style="{ left: `${composerPoint.x}px`, top: `${composerPoint.y}px` }" data-testid="comment-draft-pin" aria-hidden="true">
      <span class="pin-initials">{{ initials('Lokaler Benutzer') }}</span>
    </span>

    <form v-if="composerPoint" ref="composerEl" class="comment-composer" :style="composerStyle" @submit.prevent="submitNew">
      <label class="visually-hidden" for="new-comment">Kommentar</label>
      <textarea id="new-comment" ref="composerInput" v-model="draft" rows="1" maxlength="50000" placeholder="Kommentar hinzufügen …" @input="fitComposer" @keydown.escape.prevent="store.cancelComment()" @keydown.enter.exact.prevent="submitNew" />
      <button type="button" class="composer-cancel" aria-label="Abbrechen" title="Abbrechen (Esc)" @click="store.cancelComment()"><AppIcon name="close" :size="16" /></button>
      <button type="submit" class="composer-send" aria-label="Senden" title="Senden (Enter)" :disabled="!draft.trim()"><AppIcon name="arrow-up" :size="18" /></button>
    </form>

    <section v-if="active" ref="threadEl" class="thread-popover sd-panel" :style="threadStyle" data-testid="comment-thread" aria-label="Kommentar-Thread">
      <header><h2>Kommentar</h2><div class="thread-actions"><button class="sd-icon-btn" :aria-label="active.resolved ? 'Wieder öffnen' : 'Als erledigt markieren'" @click="store.setCommentResolved(active.id, !active.resolved)"><AppIcon name="check" /></button><button ref="menuTrigger" class="sd-icon-btn" aria-label="Weitere Kommentaraktionen" aria-haspopup="menu" :aria-expanded="menuOpen" :aria-controls="menuOpen ? menuId : undefined" @click="toggleMenu" @keydown="onMenuTriggerKeydown"><AppIcon name="more" /></button><button class="sd-icon-btn" aria-label="Kommentar schließen" @click="store.closeCommentThread()"><AppIcon name="close" /></button></div></header>
      <div v-if="menuOpen" :id="menuId" ref="menuEl" class="thread-menu" role="menu" aria-label="Kommentaraktionen" @keydown="onMenuKeydown" @focusout="onMenuFocusOut">
        <button type="button" role="menuitem" tabindex="-1" @click="threadAction('unread')">Als ungelesen markieren</button>
        <button type="button" role="menuitem" tabindex="-1" @click="threadAction('link')">Link kopieren</button>
        <button type="button" role="menuitem" tabindex="-1" :disabled="tasks.some((task) => task.sourceThreadId === active!.id)" @click="threadAction('task')">{{ tasks.some((task) => task.sourceThreadId === active!.id) ? 'Aufgabe bereits erstellt' : 'Aufgabe erstellen' }}</button>
        <button type="button" role="menuitem" tabindex="-1" class="danger" @click="threadAction('delete')">Thread löschen</button>
      </div>
      <div class="message-list">
        <article v-for="message in active.messages" :key="message.id" class="message">
          <span class="avatar">{{ initials(message.authorName) }}</span><div><div class="message-head"><strong>{{ message.authorName }}</strong><time :datetime="message.createdAt">{{ relative(message.createdAt) }}</time><span v-if="message.authorId === s.currentActorId && editingId !== message.id" class="message-more"><button type="button" class="message-menu-btn" :aria-label="`Aktionen für Kommentar von ${message.authorName}`" aria-haspopup="menu" :aria-expanded="messageMenuFor === message.id" @click="openMessageMenu(message, $event)" @keydown="onMessageTriggerKeydown(message, $event)"><AppIcon name="more" :size="18" /></button><span v-if="messageMenuFor === message.id" :ref="(el) => { messageMenuEl = el as HTMLElement | null; }" class="thread-menu message-menu" role="menu" aria-label="Kommentaraktionen" @keydown="onMessageMenuKeydown"><button type="button" role="menuitem" tabindex="-1" @click="messageAction(active!, message, 'edit')">Bearbeiten</button><button type="button" role="menuitem" tabindex="-1" class="danger" @click="messageAction(active!, message, 'delete')">Löschen</button></span></span></div>
          <template v-if="editingId === message.id"><textarea v-model="editDraft" :aria-label="`Kommentar von ${message.authorName} bearbeiten`" /><div class="edit-actions"><button class="sd-btn" @click="editingId = null">Abbrechen</button><button class="sd-btn sd-btn--primary" @click="saveEdit(active!, message)">Speichern</button></div></template><p v-else>{{ message.body }} <small v-if="message.editedAt">bearbeitet</small></p></div>
        </article>
      </div>
      <form class="reply" @submit.prevent="submitReply"><span class="avatar">{{ initials('Lokaler Benutzer') }}</span><textarea v-model="reply" aria-label="Auf Kommentar antworten" placeholder="Antworten" @keydown.meta.enter.prevent="submitReply" @keydown.ctrl.enter.prevent="submitReply" /><button type="submit" class="send" :disabled="!reply.trim()" aria-label="Antwort senden"><AppIcon name="arrow-up" :size="18" /></button></form>
    </section>
  </div>
</template>

<style scoped>
.comments-layer{position:absolute;inset:0;z-index:18;pointer-events:none}/* Speech-bubble pin: a circle whose bottom-left corner is square and marks the target. States only change box-shadow/opacity, so nothing moves. */
.comment-pin{position:absolute;display:grid;place-items:center;box-sizing:border-box;width:36px;height:36px;padding:0;transform:translateY(-100%);border:0;border-radius:50% 50% 50% 0;background:var(--accent);box-shadow:0 0 0 2px var(--surface-panel),0 4px 12px rgb(45 35 90 / 28%);color:var(--accent-contrast);cursor:pointer;pointer-events:auto}.pin-initials{font-size:13px;font-weight:650;line-height:1;letter-spacing:.01em;user-select:none}.comment-pin:hover{box-shadow:0 0 0 2px var(--surface-panel),0 0 0 4px color-mix(in srgb,var(--accent) 35%,transparent),0 4px 12px rgb(45 35 90 / 28%)}.comment-pin:focus-visible{outline:2px solid var(--focus-ring);outline-offset:4px}.comment-pin--draft{opacity:.88;pointer-events:none}.comment-pin.active{box-shadow:0 0 0 2px var(--surface-panel),0 0 0 5px var(--accent),0 4px 12px rgb(45 35 90 / 28%)}.comment-pin.resolved{opacity:.55}.comment-pin.unread::after{content:'';position:absolute;right:-3px;top:-3px;width:10px;height:10px;border:2px solid var(--surface-panel);border-radius:50%;background:var(--status-error)}.avatar{display:grid;place-items:center;flex:none;width:38px;height:38px;border-radius:50%;background:var(--accent);color:var(--accent-contrast);font-size:14px;font-weight:650}.hover-card{position:absolute;left:46px;top:0;z-index:3;display:none;grid-template-columns:auto auto;gap:2px 8px;width:320px;padding:16px 18px;border:1px solid var(--border-subtle);border-radius:18px;background:var(--surface-panel);box-shadow:var(--shadow-panel);color:var(--text-primary);text-align:left}.hover-card p{grid-column:1/-1;margin:5px 0 0;white-space:pre-wrap}.hover-card span{color:var(--text-muted)}.comment-pin:hover .hover-card,.comment-pin:focus-visible .hover-card{display:grid}.comment-composer,.thread-popover{position:absolute;pointer-events:auto}.comment-composer{display:flex;align-items:flex-end;gap:4px;box-sizing:border-box;width:min(360px,calc(100vw - 32px));min-height:36px;padding:3px 3px 3px 14px;border:2px solid var(--accent);border-radius:20px;background:var(--surface-panel);box-shadow:var(--shadow-panel)}.comment-composer textarea{flex:1;min-width:0;min-height:0;height:26px;margin:4px 0;padding:0;border:0;border-radius:0;background:transparent;color:var(--text-primary);font:inherit;line-height:26px;resize:none;outline:0;overflow-y:auto}.comment-composer textarea::placeholder{color:var(--text-muted)}.composer-cancel,.composer-send{display:grid;flex:none;place-items:center;width:30px;height:30px;margin:0;padding:0;border:0;border-radius:50%;cursor:pointer}.composer-cancel{background:transparent;color:var(--text-muted)}.composer-cancel:hover{background:var(--surface-raised);color:var(--text-primary)}.composer-send{background:var(--accent);color:var(--accent-contrast)}.composer-send:disabled{background:var(--surface-raised);color:var(--text-subtle);cursor:not-allowed}.comment-composer button:focus-visible{outline:2px solid var(--focus-ring);outline-offset:1px}.message textarea,.reply textarea{width:100%;min-height:74px;padding:10px;border:1px solid var(--border-subtle);border-radius:10px;background:var(--surface-raised);color:var(--text-primary);resize:vertical}.comment-composer>div,.edit-actions{display:flex;justify-content:flex-end;gap:8px}.target-highlight{position:absolute;border:3px solid var(--accent);border-radius:8px;box-shadow:0 0 0 4px color-mix(in srgb,var(--accent) 18%,transparent);transform-origin:center;pointer-events:none}.thread-popover{width:min(520px,calc(100vw - 380px));max-height:min(620px,calc(100vh - var(--panel-top) - var(--panel-bottom)));overflow:auto}.thread-popover header{position:sticky;top:0;z-index:2;display:flex;align-items:center;justify-content:space-between;padding:12px 14px;border-bottom:1px solid var(--border-subtle);background:var(--surface-panel)}.thread-popover h2{font-size:15px}.thread-actions{display:flex}.thread-menu{position:absolute;z-index:4;right:52px;top:54px;display:grid;width:230px;padding:8px;border:1px solid var(--border-subtle);border-radius:14px;background:var(--menu-surface);box-shadow:var(--shadow-panel)}.thread-menu button{min-height:40px;padding:0 12px;border:0;border-radius:8px;background:transparent;color:var(--menu-text);text-align:left;cursor:pointer}.thread-menu button:hover:not(:disabled),.thread-menu button:focus-visible{background:var(--menu-hover)}.thread-menu button:focus-visible{outline:2px solid var(--menu-focus);outline-offset:-2px}.thread-menu button:disabled{color:var(--menu-muted);cursor:not-allowed}.thread-menu .danger{color:var(--status-error)}.message-list{display:grid;gap:18px;padding:18px}.message{display:flex;gap:12px}.message>div{flex:1;min-width:0}.message-head{display:flex;align-items:center;gap:8px}.message-head time{color:var(--text-muted)}.message-more{position:relative;margin-left:auto}.message-menu-btn{display:grid;place-items:center;width:30px;height:30px;padding:0;border:0;border-radius:8px;background:transparent;color:var(--text-muted);cursor:pointer}.message-menu-btn:hover,.message-menu-btn[aria-expanded='true']{background:var(--surface-raised);color:var(--text-primary)}.message-menu-btn:focus-visible{outline:2px solid var(--focus-ring);outline-offset:1px}.message-menu{right:0;top:34px;width:170px}.message p{margin:8px 0 0;white-space:pre-wrap;word-break:break-word}.message small{color:var(--text-muted)}.reply{display:flex;align-items:flex-start;gap:10px;padding:14px 18px;border-top:1px solid var(--border-subtle)}.reply textarea{min-height:50px}.send{display:grid;flex:none;place-items:center;align-self:center;width:38px;height:38px;min-width:0;min-height:0;padding:0;border:0;border-radius:50%;background:var(--accent);color:var(--accent-contrast);cursor:pointer}.send:disabled{opacity:.4}@media(max-width:900px){.thread-popover{left:12px!important;right:12px;width:auto}.hover-card{width:240px}.target-highlight{display:none}}
</style>

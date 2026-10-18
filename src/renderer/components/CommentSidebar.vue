<script setup lang="ts">
import { computed, ref } from 'vue';
import { commentTargetLabel } from '../lib/comments';
import { useWhiteboard } from './use-whiteboard';
import AppIcon from './AppIcon.vue';

const store = useWhiteboard(); const s = store.state;
const query = ref(''); const filter = ref<'open' | 'resolved' | 'all'>('open');
const threads = computed(() => (s.document.commentThreads ?? []).filter((thread) => {
  if (filter.value === 'open' && thread.resolved) return false;
  if (filter.value === 'resolved' && !thread.resolved) return false;
  const term = query.value.trim().toLocaleLowerCase('de');
  return !term || thread.messages.some((message) => `${message.authorName} ${message.body}`.toLocaleLowerCase('de').includes(term)) || commentTargetLabel(thread.target, s.document).toLocaleLowerCase('de').includes(term);
}).sort((a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt)));
function initials(name: string): string { return name.trim().split(/\s+/).map((part) => part[0]).join('').slice(0, 2).toUpperCase() || '?'; }
</script>

<template>
  <aside v-if="s.commentSidebarOpen && s.workspaceView === 'canvas'" class="comment-sidebar sd-panel" data-testid="comment-sidebar" aria-label="Alle Kommentare">
    <header><h2 class="sd-panel-title">Kommentare</h2><button class="sd-icon-btn sd-panel-close" aria-label="Kommentarleiste schließen" @click="store.closeCommentSidebar()"><AppIcon name="close" /></button></header>
    <div class="search"><AppIcon name="search" :size="18" /><input v-model="query" type="search" placeholder="Kommentare suchen" aria-label="Kommentare suchen" /></div>
    <div class="filters" role="group" aria-label="Kommentare filtern"><button v-for="entry in ([['open','Offen'],['resolved','Erledigt'],['all','Alle']] as const)" :key="entry[0]" :aria-pressed="filter === entry[0]" @click="filter = entry[0]">{{ entry[1] }}</button></div>
    <ol class="comment-list">
      <li v-for="thread in threads" :key="thread.id"><button :class="{ active: thread.id === s.activeCommentId, unread: s.unreadCommentIds.includes(thread.id) }" @click="store.openComment(thread.id)"><span class="avatar">{{ initials(thread.messages.at(-1)?.authorName ?? '') }}</span><span class="summary"><span class="target">{{ commentTargetLabel(thread.target, s.document) }}</span><strong>{{ thread.messages.at(-1)?.authorName }}</strong><span class="body">{{ thread.messages.at(-1)?.body }}</span><small>{{ thread.resolved ? 'Erledigt' : `${thread.messages.length} Beitrag${thread.messages.length === 1 ? '' : 'e'}` }}</small></span></button></li>
    </ol>
    <p v-if="!threads.length" class="empty">Keine passenden Kommentare.</p>
  </aside>
</template>

<style scoped>
.comment-sidebar{position:absolute;z-index:17;top:var(--panel-top);right:16px;bottom:16px;width:min(340px,calc(100vw - 32px));display:flex;flex-direction:column;overflow:hidden}.comment-sidebar header{display:flex;align-items:center;justify-content:space-between;padding:14px 12px 10px 18px;border-bottom:1px solid var(--border-subtle)}.search{display:flex;align-items:center;gap:8px;margin:12px;padding:0 10px;border-radius:10px;background:var(--surface-raised)}.search:focus-within{outline:2px solid var(--focus-ring);outline-offset:2px}.search input{width:100%;height:40px;border:0;background:transparent;color:var(--text-primary);outline:0}.filters{display:flex;gap:4px;padding:0 12px 10px}.filters button{min-height:32px;padding:0 10px;border:0;border-radius:8px;background:transparent;color:var(--text-muted)}.filters button[aria-pressed='true']{background:var(--accent-soft);color:var(--accent-ink)}.comment-list{overflow:auto;padding:0 8px 14px}.comment-list li>button{display:flex;gap:10px;width:100%;padding:12px;border:0;border-radius:12px;background:transparent;color:var(--text-primary);text-align:left}.comment-list li>button:hover,.comment-list li>button.active{background:var(--surface-raised)}.comment-list li>button.active{box-shadow:inset 3px 0 var(--accent)}.avatar{display:grid;place-items:center;flex:none;width:36px;height:36px;border-radius:50%;background:var(--accent);color:var(--accent-contrast);font-size:12px}.summary{display:grid;gap:3px;min-width:0}.target,.body{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.target,small{color:var(--text-muted);font-size:11px}.summary strong{font-size:13px}.body{font-size:13px}.unread .summary strong::after{content:' · Neu';color:var(--accent)}.empty{margin:auto;color:var(--text-muted)}
</style>

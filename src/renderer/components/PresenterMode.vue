<script setup lang="ts">
import { t } from '@/renderer/i18n';
import { computed, onMounted, ref, watch } from 'vue';
import { useEventListener } from '@vueuse/core';
import AppIcon from './AppIcon.vue';
import FramePreview from './FramePreview.vue';
import { useWhiteboard } from './use-whiteboard';
import { slideNotes, MAX_SLIDE_NOTES_LENGTH } from '../lib/slide-notes';

const store = useWhiteboard();
const s = store.state;
const root = ref<HTMLElement | null>(null);
const frame = computed(() => s.frameSlides[s.presenterIndex]);
let pointerStart: { x: number; y: number } | null = null;

function stop(): void {
  store.stopPresentation();
  if (document.fullscreenElement) void document.exitFullscreen().catch(() => {});
}
const notesDraft = ref('');
watch(() => [frame.value?.id, frame.value ? slideNotes(frame.value) : ''] as const, () => { notesDraft.value = slideNotes(frame.value); }, { immediate: true });
function commitNotes(): void { if (frame.value) store.setSlideNotes(frame.value.id, notesDraft.value); }
function keydown(event: KeyboardEvent): void {
  if (!s.presenterOpen) return;
  // Typing in the notes must not flip slides; Escape only leaves the field.
  if (event.target instanceof HTMLTextAreaElement) {
    if (event.key === 'Escape') { event.preventDefault(); event.stopImmediatePropagation(); commitNotes(); root.value?.focus(); }
    return;
  }
  let next: number | null = null;
  if (['ArrowRight', 'ArrowDown', 'PageDown', ' '].includes(event.key)) next = s.presenterIndex + 1;
  else if (['ArrowLeft', 'ArrowUp', 'PageUp'].includes(event.key)) next = s.presenterIndex - 1;
  else if (event.key === 'Home') next = 0;
  else if (event.key === 'End') next = s.frameSlides.length - 1;
  else if (event.key === 'Escape') { event.preventDefault(); event.stopImmediatePropagation(); stop(); return; }
  if (next !== null) { event.preventDefault(); event.stopImmediatePropagation(); store.goToPresentation(next); }
}
function pointerDown(event: PointerEvent): void { pointerStart = { x: event.clientX, y: event.clientY }; }
function pointerUp(event: PointerEvent): void {
  if (!pointerStart) return;
  const dx = event.clientX - pointerStart.x; const dy = event.clientY - pointerStart.y; pointerStart = null;
  if (Math.abs(dx) > 60 && Math.abs(dx) > Math.abs(dy)) store.goToPresentation(s.presenterIndex + (dx < 0 ? 1 : -1));
}
function fullscreen(): void { if (!document.fullscreenElement) void root.value?.requestFullscreen().catch(() => {}); else void document.exitFullscreen(); }
useEventListener(window, 'keydown', keydown, true);
onMounted(() => root.value?.focus());
</script>

<template>
  <section ref="root" class="presenter" :class="{ 'with-notes': s.presenterNotes }" role="dialog" aria-modal="true" :aria-label="t('Presenter Mode')" tabindex="-1" @pointerdown="pointerDown" @pointerup="pointerUp">
    <header><div><span>{{ frame?.label || t('Folie {presenterIndex}', { presenterIndex: s.presenterIndex + 1 }) }}</span><small>{{ s.presenterIndex + 1 }} / {{ s.frameSlides.length }}</small></div><nav :aria-label="t('Präsentationsaktionen')"><button class="presenter-btn" :class="{ on: s.presenterNotes }" :aria-pressed="s.presenterNotes" :aria-label="t('Presenter-Ansicht mit Notizen')" :title="t('Presenter-Ansicht mit Notizen')" data-testid="presenter-notes-toggle" @click="store.setPresenterNotes(!s.presenterNotes)"><AppIcon name="text" /></button><button class="presenter-btn" :aria-label="t('Vollbild umschalten')" @click="fullscreen"><AppIcon name="maximize" /></button><button class="presenter-btn" :aria-label="t('Präsentation beenden')" @click="stop"><AppIcon name="close" /></button></nav></header>
    <div v-if="frame" class="stage"><FramePreview :frame="frame" :document="s.document" :theme="s.theme" :title="frame.label || t('Folie {presenterIndex}', { presenterIndex: s.presenterIndex + 1 })" /></div>
    <aside v-if="s.presenterNotes && frame" class="notes" data-testid="presenter-notes" :aria-label="t('Notizen zur Folie')">
      <h2>{{ t('Notizen zur Folie') }}</h2>
      <textarea v-model="notesDraft" :maxlength="MAX_SLIDE_NOTES_LENGTH" :placeholder="t('Notizen nur für dich – in der normalen Ansicht nicht sichtbar')" :aria-label="t('Notizen zur Folie')" :disabled="!s.canWrite" @blur="commitNotes" @pointerdown.stop @pointerup.stop />
    </aside>
    <button class="nav previous" :disabled="s.presenterIndex === 0" :aria-label="t('Vorherige Folie')" @click="store.goToPresentation(s.presenterIndex - 1)"><AppIcon name="chevron-left" /></button>
    <button class="nav next" :disabled="s.presenterIndex >= s.frameSlides.length - 1" :aria-label="t('Nächste Folie')" @click="store.goToPresentation(s.presenterIndex + 1)"><AppIcon name="chevron-right" /></button>
    <footer><button v-for="(slide, index) in s.frameSlides" :key="slide.id" :class="{ active: index === s.presenterIndex }" :aria-label="t('Zu {name} wechseln', { name: slide.label || t('Folie {index}', { index: index + 1 }) })" :aria-current="index === s.presenterIndex ? 'step' : undefined" @click="store.goToPresentation(index)">{{ index + 1 }}</button></footer>
  </section>
</template>

<style scoped>
.presenter{position:fixed;inset:0;z-index:200;display:grid;grid-template-rows:58px minmax(0,1fr) 50px;background:#090b10;color:#fff;outline:none;user-select:none}.presenter header{display:flex;align-items:center;justify-content:space-between;padding:0 18px;background:#10131a;border-bottom:1px solid #272b35}.presenter header>div{display:flex;align-items:baseline;gap:10px;font-weight:650}.presenter small{color:#9ba3b5;font-weight:500}.presenter nav{display:flex;gap:5px}.presenter-btn,.nav,.presenter footer button{display:grid;place-items:center;border:0;color:#fff;background:#202530;cursor:pointer}.presenter-btn{width:38px;height:38px;border-radius:9px}.stage{min-width:0;min-height:0;margin:18px 74px;box-shadow:0 24px 70px #0008;background:#fff}.nav{position:absolute;top:50%;width:46px;height:64px;border-radius:12px;transform:translateY(-50%)}.nav.previous{left:14px}.nav.next{right:14px}.nav:disabled{opacity:.25;cursor:default}.presenter footer{display:flex;align-items:center;justify-content:center;gap:7px}.presenter footer button{min-width:28px;height:28px;padding:0 8px;border-radius:14px;font-size:11px}.presenter footer button.active{background:#8558f0}@media(max-width:760px){.stage{margin:12px 48px}.nav{width:38px}.nav.previous{left:5px}.nav.next{right:5px}}
.presenter.with-notes{grid-template-columns:minmax(0,1fr) 340px}.presenter header,.presenter footer{grid-column:1/-1}.presenter.with-notes .nav.next{right:354px}.notes{grid-column:2;grid-row:2;display:flex;flex-direction:column;gap:8px;margin:18px 18px 18px 0;padding:14px;border-radius:12px;background:#10131a;border:1px solid #272b35;user-select:text;min-height:0}.notes h2{margin:0;font-size:12px;letter-spacing:.08em;text-transform:uppercase;color:#9ba3b5;font-weight:650}.notes textarea{flex:1;min-height:0;resize:none;border:1px solid #272b35;border-radius:10px;background:#0b0e14;color:#f4f6fb;padding:12px;font:15px/1.55 var(--font-sans)}.notes textarea:focus{outline:2px solid #8558f0}.presenter-btn.on{background:#8558f0}.presenter-btn:focus-visible,.nav:focus-visible,.presenter footer button:focus-visible{outline:2px solid #b3a1ff;outline-offset:2px}
</style>

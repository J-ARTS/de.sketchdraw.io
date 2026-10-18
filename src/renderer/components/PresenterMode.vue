<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { useEventListener } from '@vueuse/core';
import AppIcon from './AppIcon.vue';
import FramePreview from './FramePreview.vue';
import { useWhiteboard } from './use-whiteboard';

const store = useWhiteboard();
const s = store.state;
const root = ref<HTMLElement | null>(null);
const frame = computed(() => s.frameSlides[s.presenterIndex]);
let pointerStart: { x: number; y: number } | null = null;

function stop(): void {
  store.stopPresentation();
  if (document.fullscreenElement) void document.exitFullscreen().catch(() => {});
}
function keydown(event: KeyboardEvent): void {
  if (!s.presenterOpen) return;
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
  <section ref="root" class="presenter" role="dialog" aria-modal="true" aria-label="Presenter Mode" tabindex="-1" @pointerdown="pointerDown" @pointerup="pointerUp">
    <header><div><span>{{ frame?.label || `Folie ${s.presenterIndex + 1}` }}</span><small>{{ s.presenterIndex + 1 }} / {{ s.frameSlides.length }}</small></div><nav aria-label="Präsentationsaktionen"><button class="presenter-btn" aria-label="Vollbild umschalten" @click="fullscreen"><AppIcon name="maximize" /></button><button class="presenter-btn" aria-label="Präsentation beenden" @click="stop"><AppIcon name="close" /></button></nav></header>
    <div v-if="frame" class="stage"><FramePreview :frame="frame" :document="s.document" :theme="s.theme" :title="frame.label || `Folie ${s.presenterIndex + 1}`" /></div>
    <button class="nav previous" :disabled="s.presenterIndex === 0" aria-label="Vorherige Folie" @click="store.goToPresentation(s.presenterIndex - 1)"><AppIcon name="chevron-left" /></button>
    <button class="nav next" :disabled="s.presenterIndex >= s.frameSlides.length - 1" aria-label="Nächste Folie" @click="store.goToPresentation(s.presenterIndex + 1)"><AppIcon name="chevron-right" /></button>
    <footer><button v-for="(slide, index) in s.frameSlides" :key="slide.id" :class="{ active: index === s.presenterIndex }" :aria-label="`Zu ${slide.label || `Folie ${index + 1}`} wechseln`" :aria-current="index === s.presenterIndex ? 'step' : undefined" @click="store.goToPresentation(index)">{{ index + 1 }}</button></footer>
  </section>
</template>

<style scoped>
.presenter{position:fixed;inset:0;z-index:200;display:grid;grid-template-rows:58px minmax(0,1fr) 50px;background:#090b10;color:#fff;outline:none;user-select:none}.presenter header{display:flex;align-items:center;justify-content:space-between;padding:0 18px;background:#10131a;border-bottom:1px solid #272b35}.presenter header>div{display:flex;align-items:baseline;gap:10px;font-weight:650}.presenter small{color:#9ba3b5;font-weight:500}.presenter nav{display:flex;gap:5px}.presenter-btn,.nav,.presenter footer button{display:grid;place-items:center;border:0;color:#fff;background:#202530;cursor:pointer}.presenter-btn{width:38px;height:38px;border-radius:9px}.stage{min-width:0;min-height:0;margin:18px 74px;box-shadow:0 24px 70px #0008;background:#fff}.nav{position:absolute;top:50%;width:46px;height:64px;border-radius:12px;transform:translateY(-50%)}.nav.previous{left:14px}.nav.next{right:14px}.nav:disabled{opacity:.25;cursor:default}.presenter footer{display:flex;align-items:center;justify-content:center;gap:7px}.presenter footer button{min-width:28px;height:28px;padding:0 8px;border-radius:14px;font-size:11px}.presenter footer button.active{background:#8558f0}@media(max-width:760px){.stage{margin:12px 48px}.nav{width:38px}.nav.previous{left:5px}.nav.next{right:5px}}
</style>

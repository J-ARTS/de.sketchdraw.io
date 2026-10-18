<script setup lang="ts">
import { computed, onBeforeUnmount, ref } from 'vue';
import { appendLaserPoint, laserSegments, liveLaserPoints, type LaserPoint } from '../lib/laser-pointer';

const points = ref<LaserPoint[]>([]);
const active = ref(false);
const now = ref(0);
let frame: number | null = null;
const reducedMotion = typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

const segments = computed(() => reducedMotion ? [] : laserSegments(points.value, now.value));
const head = computed(() => active.value ? points.value.at(-1) ?? null : null);
const visible = computed(() => Boolean(head.value || segments.value.length));

function stopFrame(): void {
  if (frame !== null) cancelAnimationFrame(frame);
  frame = null;
}
function animate(timestamp: number): void {
  now.value = timestamp;
  if (!reducedMotion) points.value = liveLaserPoints(points.value, timestamp);
  if (active.value || points.value.length) frame = requestAnimationFrame(animate);
  else stopFrame();
}
function ensureFrame(): void {
  if (frame === null) frame = requestAnimationFrame(animate);
}
function start(point: { x: number; y: number }): void {
  const timestamp = performance.now();
  active.value = true;
  now.value = timestamp;
  points.value = [{ ...point, createdAt: timestamp }];
  ensureFrame();
}
function add(point: { x: number; y: number }): void {
  if (!active.value) return;
  const timestamp = performance.now();
  now.value = timestamp;
  const next = { ...point, createdAt: timestamp };
  points.value = reducedMotion ? [next] : appendLaserPoint(points.value, next);
}
function end(point?: { x: number; y: number }): void {
  if (!active.value) return;
  if (point) add(point);
  active.value = false;
  if (reducedMotion) {
    points.value = [];
    stopFrame();
  } else ensureFrame();
}
function cancel(): void { end(); }

onBeforeUnmount(stopFrame);
defineExpose({ start, add, end, cancel });
</script>

<template>
  <g v-if="visible" data-testid="laser-pointer-layer" class="laser-pointer-layer" pointer-events="none" aria-hidden="true">
    <template v-for="(segment, index) in segments" :key="index">
      <line class="laser-glow" :x1="segment.from.x" :y1="segment.from.y" :x2="segment.to.x" :y2="segment.to.y" :opacity="segment.opacity * 0.34" />
      <line class="laser-core" :x1="segment.from.x" :y1="segment.from.y" :x2="segment.to.x" :y2="segment.to.y" :opacity="segment.opacity" />
    </template>
    <circle v-if="head" data-testid="laser-pointer-head" class="laser-head-glow" :cx="head.x" :cy="head.y" r="9" />
    <circle v-if="head" class="laser-head" :cx="head.x" :cy="head.y" r="3.5" />
  </g>
</template>

<style scoped>
.laser-pointer-layer{isolation:isolate}.laser-glow,.laser-core{stroke-linecap:round;stroke-linejoin:round}.laser-glow{stroke:#ff5a5f;stroke-width:13;filter:blur(4px)}.laser-core{stroke:#e03131;stroke-width:5}.laser-head-glow{fill:#ff5a5f;opacity:.28;filter:blur(3px)}.laser-head{fill:#e03131;stroke:#fff;stroke-width:1.25}
@media (prefers-reduced-motion:reduce){.laser-head-glow{display:none}.laser-head{filter:none}}
</style>

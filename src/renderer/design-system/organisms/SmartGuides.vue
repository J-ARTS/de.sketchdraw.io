<!-- @component The guides of a move in progress, drawn over the canvas: lines where the moved element is in line with another one, and marked distances where it keeps the same distance as its neighbours. It belongs inside the canvas `<svg>`. -->
<script setup lang="ts">
import { computed } from 'vue';
import { useWhiteboard } from '@/renderer/design-system/composables/use-whiteboard';

const store = useWhiteboard();
const s = store.state;

/** Lines keep their width and labels their size on screen: everything is laid out in screen pixels. */
const shapes = computed(() => {
  const { panX, panY, zoom } = s.viewport;
  const sx = (x: number) => x * zoom + panX, sy = (y: number) => y * zoom + panY;
  const lines: { key: string; x1: number; y1: number; x2: number; y2: number }[] = [];
  const gaps: { key: string; x1: number; y1: number; x2: number; y2: number; vertical: boolean; label: string; lx: number; ly: number; width: number }[] = [];
  s.guides.forEach((guide, index) => {
    if (guide.kind === 'align') {
      // A little longer than the boxes, so the line reads as a line and not as an edge.
      const from = (guide.axis === 'x' ? sy(guide.from) : sx(guide.from)) - 12, to = (guide.axis === 'x' ? sy(guide.to) : sx(guide.to)) + 12;
      lines.push(guide.axis === 'x' ? { key: `a${index}`, x1: sx(guide.at), y1: from, x2: sx(guide.at), y2: to } : { key: `a${index}`, x1: from, y1: sy(guide.at), x2: to, y2: sy(guide.at) });
      return;
    }
    const vertical = guide.axis === 'y';
    const label = String(Math.round(guide.size));
    const width = Math.max(22, label.length * 6.5 + 10);
    const from = vertical ? sy(guide.from) : sx(guide.from), to = vertical ? sy(guide.to) : sx(guide.to), at = vertical ? sx(guide.at) : sy(guide.at);
    const middle = (from + to) / 2;
    gaps.push(vertical
      ? { key: `g${index}`, x1: at, y1: from, x2: at, y2: to, vertical, label, lx: at + 6 + width / 2, ly: middle, width }
      : { key: `g${index}`, x1: from, y1: at, x2: to, y2: at, vertical, label, lx: middle, ly: at - 14, width });
  });
  return { lines, gaps };
});
</script>

<template>
  <g v-if="s.guides.length" class="smart-guides" data-testid="smart-guides" pointer-events="none" aria-hidden="true">
    <line v-for="line in shapes.lines" :key="line.key" class="guide-line" data-testid="guide-align" :x1="line.x1" :y1="line.y1" :x2="line.x2" :y2="line.y2" />
    <g v-for="gap in shapes.gaps" :key="gap.key" class="guide-gap" data-testid="guide-gap" :data-size="gap.label">
      <line class="guide-line" :x1="gap.x1" :y1="gap.y1" :x2="gap.x2" :y2="gap.y2" />
      <!-- Short strokes at both ends show where the distance is measured. -->
      <line v-if="gap.vertical" class="guide-line" :x1="gap.x1 - 4" :y1="gap.y1" :x2="gap.x1 + 4" :y2="gap.y1" />
      <line v-if="gap.vertical" class="guide-line" :x1="gap.x2 - 4" :y1="gap.y2" :x2="gap.x2 + 4" :y2="gap.y2" />
      <line v-if="!gap.vertical" class="guide-line" :x1="gap.x1" :y1="gap.y1 - 4" :x2="gap.x1" :y2="gap.y1 + 4" />
      <line v-if="!gap.vertical" class="guide-line" :x1="gap.x2" :y1="gap.y2 - 4" :x2="gap.x2" :y2="gap.y2 + 4" />
      <rect class="guide-label" :x="gap.lx - gap.width / 2" :y="gap.ly - 8" :width="gap.width" height="16" rx="8" />
      <text :x="gap.lx" :y="gap.ly" text-anchor="middle" dominant-baseline="central">{{ gap.label }}</text>
    </g>
  </g>
</template>

<style scoped>
.guide-line{stroke:var(--guide);stroke-width:1;shape-rendering:crispEdges}
.guide-label{fill:var(--guide)}
text{fill:var(--guide-ink);font:600 10px var(--font-sans);font-variant-numeric:tabular-nums;user-select:none}
@media(forced-colors:active){.guide-line{stroke:Highlight}.guide-label{fill:Highlight}text{fill:HighlightText}}
</style>

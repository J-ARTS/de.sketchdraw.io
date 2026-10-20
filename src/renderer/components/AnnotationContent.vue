<script setup lang="ts">
import type { AnnotationBlock, AnnotationDocument } from '@/domain';

const props = defineProps<{ document: AnnotationDocument }>();

function tag(block: AnnotationBlock): string {
  return block.type === 'heading-1' ? 'h1'
    : block.type === 'heading-2' ? 'h2'
      : block.type === 'heading-3' ? 'h3'
        : block.type === 'heading-4' ? 'h4'
          : block.type === 'quote' ? 'blockquote' : 'p';
}
function numberAt(index: number): number {
  let value = 1;
  for (let i = index - 1; i >= 0 && props.document.blocks[i]?.type === 'numbered'; i -= 1) value += 1;
  return value;
}
</script>

<template>
  <div class="annotation-content">
    <component
      :is="tag(block)"
      v-for="(block, index) in document.blocks"
      :key="index"
      :class="[`block-${block.type}`, { listed: block.type === 'bullet' || block.type === 'numbered' }]"
      :data-prefix="block.type === 'bullet' ? '•' : block.type === 'numbered' ? `${numberAt(index)}.` : undefined"
    ><span v-for="(run, runIndex) in block.runs" :key="runIndex" :style="{ fontWeight: run.bold ? '700' : undefined, fontStyle: run.italic ? 'italic' : undefined, textDecoration: run.underline ? 'underline' : undefined, color: run.color }">{{ run.text }}</span></component>
  </div>
</template>

<style scoped>
.annotation-content{height:100%;overflow:hidden;color:inherit;font:inherit;line-height:1.5;overflow-wrap:anywhere;white-space:pre-wrap}.annotation-content :where(p,h1,h2,h3,h4,blockquote){margin:0 0 .72em}.annotation-content h1{font-size:1.8em;line-height:1.16;font-weight:750;letter-spacing:-.025em}.annotation-content h2{font-size:1.5em;line-height:1.2;font-weight:720}.annotation-content h3{font-size:1.28em;line-height:1.25;font-weight:700}.annotation-content h4{font-size:1.12em;line-height:1.3;font-weight:680}.annotation-content blockquote{padding:.35em 1em;border-left:.25em solid #1d4ed8;border-radius:0 8px 8px 0;background:#e3efff;color:#1e293b}.listed{position:relative;padding-left:1.45em}.listed::before{position:absolute;left:0;content:attr(data-prefix);font-variant-numeric:tabular-nums}
</style>

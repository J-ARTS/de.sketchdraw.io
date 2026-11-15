<script setup lang="ts">
import { computed } from 'vue';
import type { SketchElement } from '@/domain';
import { fontFamilyCss } from '@/renderer/lib/constants';
import { themeColor } from '@/renderer/lib/theme';
import { mergeLayout } from '@/renderer/lib/table-merge';

const props = defineProps<{ element: SketchElement; theme: 'light' | 'dark' }>();
const cells = computed(() => {
  const table = props.element.table;
  if (!table) return [];
  const totalWidth = table.columns.reduce((sum, column) => sum + column.width, 0) || 1;
  const totalHeight = table.rows.reduce((sum, row) => sum + row.height, 0) || 1;
  const widths = table.columns.map((column) => props.element.width * column.width / totalWidth);
  const heights = table.rows.map((row) => props.element.height * row.height / totalHeight);
  const lefts = widths.map((_, index) => widths.slice(0, index).reduce((sum, width) => sum + width, 0));
  const tops = heights.map((_, index) => heights.slice(0, index).reduce((sum, height) => sum + height, 0));
  // Merged cells (#197) are drawn once, over their whole region, with the text and format of their top left cell.
  const merges = mergeLayout(props.element, table);
  return table.rows.flatMap((row, rowIndex) => table.columns.flatMap((column, columnIndex) => {
    const cell = table.cells.find((entry) => entry.rowId === row.id && entry.columnId === column.id)!;
    if (merges.covered.has(cell.id)) return [];
    const region = merges.anchors.get(cell.id);
    const width = widths.slice(columnIndex, columnIndex + (region?.columnSpan ?? 1)).reduce((sum, value) => sum + value, 0);
    const height = heights.slice(rowIndex, rowIndex + (region?.rowSpan ?? 1)).reduce((sum, value) => sum + value, 0);
    const maxChars = Math.max(1, Math.floor((width - 20) / (cell.style.fontSize * .58)));
    const lines = cell.text.split('\n').flatMap((line) => {
      const value = cell.style.listStyle === 'bullet' && line ? `• ${line}` : line;
      const chars = Array.from(value); const wrapped: string[] = [];
      for (let index = 0; index < chars.length; index += maxChars) wrapped.push(chars.slice(index, index + maxChars).join(''));
      return wrapped.length ? wrapped : [''];
    }).slice(0, Math.max(1, Math.floor((height - 16) / (cell.style.fontSize * 1.25))));
    return [{ cell, x: lefts[columnIndex]!, y: tops[rowIndex]!, width, height, lines, merged: Boolean(region) }];
  }));
});
</script>

<template>
  <g data-testid="table-surface">
    <g v-for="entry in cells" :key="entry.cell.id" :data-merged="entry.merged ? 'true' : undefined">
      <rect :x="entry.x" :y="entry.y" :width="entry.width" :height="entry.height" :fill="themeColor(entry.cell.style.fill, theme)" stroke="var(--border-default)" stroke-width="1" />
      <text :x="entry.cell.style.textAlign === 'center' ? entry.x + entry.width / 2 : entry.cell.style.textAlign === 'right' ? entry.x + entry.width - 10 : entry.x + 10" :y="entry.y + 10" :fill="themeColor(entry.cell.style.color, theme)" :font-size="entry.cell.style.fontSize" :font-family="fontFamilyCss(entry.cell.style.fontFamily)" :font-weight="entry.cell.style.fontWeight" :text-decoration="entry.cell.style.textDecoration" :text-anchor="entry.cell.style.textAlign === 'center' ? 'middle' : entry.cell.style.textAlign === 'right' ? 'end' : 'start'" dominant-baseline="text-before-edge" stroke="none" pointer-events="none">
        <tspan v-for="(line, index) in entry.lines" :key="index" :x="entry.cell.style.textAlign === 'center' ? entry.x + entry.width / 2 : entry.cell.style.textAlign === 'right' ? entry.x + entry.width - 10 : entry.x + 10" :y="entry.y + 10 + index * entry.cell.style.fontSize * 1.25">{{ line }}</tspan>
      </text>
    </g>
  </g>
</template>

<script setup lang="ts">
import { computed } from 'vue';
import type { SketchElement } from '@/domain';
import { fontFamilyCss } from '../lib/constants';
import { themeColor } from '../lib/theme';

const props = defineProps<{ element: SketchElement; theme: 'light' | 'dark' }>();
const cells = computed(() => {
  const table = props.element.table;
  if (!table) return [];
  const totalWidth = table.columns.reduce((sum, column) => sum + column.width, 0) || 1;
  const totalHeight = table.rows.reduce((sum, row) => sum + row.height, 0) || 1;
  let y = 0;
  return table.rows.flatMap((row) => {
    const height = props.element.height * row.height / totalHeight;
    let x = 0;
    const result = table.columns.map((column) => {
      const width = props.element.width * column.width / totalWidth;
      const cell = table.cells.find((entry) => entry.rowId === row.id && entry.columnId === column.id)!;
      const maxChars = Math.max(1, Math.floor((width - 20) / (cell.style.fontSize * .58)));
      const lines = cell.text.split('\n').flatMap((line) => {
        const value = cell.style.listStyle === 'bullet' && line ? `• ${line}` : line;
        const chars = Array.from(value); const wrapped: string[] = [];
        for (let index = 0; index < chars.length; index += maxChars) wrapped.push(chars.slice(index, index + maxChars).join(''));
        return wrapped.length ? wrapped : [''];
      }).slice(0, Math.max(1, Math.floor((height - 16) / (cell.style.fontSize * 1.25))));
      const value = { cell, x, y, width, height, lines };
      x += width;
      return value;
    });
    y += height;
    return result;
  });
});
</script>

<template>
  <g data-testid="table-surface">
    <g v-for="entry in cells" :key="entry.cell.id">
      <rect :x="entry.x" :y="entry.y" :width="entry.width" :height="entry.height" :fill="themeColor(entry.cell.style.fill, theme)" stroke="var(--border-default)" stroke-width="1" />
      <text :x="entry.cell.style.textAlign === 'center' ? entry.x + entry.width / 2 : entry.cell.style.textAlign === 'right' ? entry.x + entry.width - 10 : entry.x + 10" :y="entry.y + 10" :fill="themeColor(entry.cell.style.color, theme)" :font-size="entry.cell.style.fontSize" :font-family="fontFamilyCss(entry.cell.style.fontFamily)" :font-weight="entry.cell.style.fontWeight" :text-decoration="entry.cell.style.textDecoration" :text-anchor="entry.cell.style.textAlign === 'center' ? 'middle' : entry.cell.style.textAlign === 'right' ? 'end' : 'start'" dominant-baseline="text-before-edge" stroke="none" pointer-events="none">
        <tspan v-for="(line, index) in entry.lines" :key="index" :x="entry.cell.style.textAlign === 'center' ? entry.x + entry.width / 2 : entry.cell.style.textAlign === 'right' ? entry.x + entry.width - 10 : entry.x + 10" :y="entry.y + 10 + index * entry.cell.style.fontSize * 1.25">{{ line }}</tspan>
      </text>
    </g>
  </g>
</template>

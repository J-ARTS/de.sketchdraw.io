import { ref } from 'vue';
import type { Meta, StoryObj } from '@storybook/vue3-vite';
import ColorPicker from '@/renderer/design-system/molecules/ColorPicker.vue';

const meta = {
  title: 'Molecules/ColorPicker',
  component: ColorPicker,
  args: { color: '#e8590c', label: 'Füllfarbe' },
  render: (args) => ({ components: { ColorPicker }, setup: () => { const color = ref(args.color); return { args, color }; }, template: '<div style="min-height:420px"><ColorPicker v-bind="args" :color="color" @pick="color = $event" /></div>' }),
} satisfies Meta<typeof ColorPicker>;
export default meta;
export const Default: StoryObj<typeof meta> = {};

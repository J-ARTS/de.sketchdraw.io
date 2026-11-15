import { ref } from 'vue';
import type { Meta, StoryObj } from '@storybook/vue3-vite';
import ColorPalette from '@/renderer/design-system/molecules/ColorPalette.vue';

const meta = {
  title: 'Molecules/ColorPalette',
  component: ColorPalette,
  args: { value: '#1c7ed6', prefix: 'story', groupLabel: 'Linienfarbe' },
  render: (args) => ({ components: { ColorPalette }, setup: () => { const value = ref(args.value); return { args, value }; }, template: '<ColorPalette v-bind="args" :value="value" @pick="value = $event" />' }),
} satisfies Meta<typeof ColorPalette>;
export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};
/** Several elements with different colours are selected: no swatch is marked. */
export const Mixed: Story = { args: { value: null, mixed: true } };

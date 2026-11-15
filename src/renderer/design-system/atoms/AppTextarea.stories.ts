import { ref } from 'vue';
import type { Meta, StoryObj } from '@storybook/vue3-vite';
import AppTextarea from '@/renderer/design-system/atoms/AppTextarea.vue';

const meta = {
  title: 'Atoms/AppTextarea',
  component: AppTextarea,
  args: { modelValue: 'Nimmt Zahlungen an und meldet das Ergebnis an den Shop.', invalid: false },
  render: (args) => ({ components: { AppTextarea }, setup: () => { const value = ref(args.modelValue); return { args, value }; }, template: '<AppTextarea v-bind="args" v-model="value" aria-label="Beschreibung" rows="4" style="width:320px" />' }),
} satisfies Meta<typeof AppTextarea>;
export default meta;
type Story = StoryObj<typeof meta>;

export const Filled: Story = {};
export const Invalid: Story = { args: { invalid: true } };

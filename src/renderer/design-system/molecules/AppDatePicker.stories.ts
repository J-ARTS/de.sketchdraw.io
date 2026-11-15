import { ref } from 'vue';
import type { Meta, StoryObj } from '@storybook/vue3-vite';
import AppDatePicker from '@/renderer/design-system/molecules/AppDatePicker.vue';

const meta = {
  title: 'Molecules/AppDatePicker',
  component: AppDatePicker,
  args: { label: 'Fällig am', modelValue: '2026-11-20' },
  render: (args) => ({ components: { AppDatePicker }, setup: () => { const value = ref(args.modelValue); return { args, value }; }, template: '<div style="width:260px;min-height:380px"><AppDatePicker v-bind="args" v-model="value" /></div>' }),
} satisfies Meta<typeof AppDatePicker>;
export default meta;
type Story = StoryObj<typeof meta>;

export const WithDate: Story = {};
export const Empty: Story = { args: { modelValue: '' } };
export const Disabled: Story = { args: { disabled: true } };

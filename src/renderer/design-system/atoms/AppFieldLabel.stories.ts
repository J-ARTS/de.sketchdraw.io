import type { Meta, StoryObj } from '@storybook/vue3-vite';
import AppFieldLabel from '@/renderer/design-system/atoms/AppFieldLabel.vue';

const meta = {
  title: 'Atoms/AppFieldLabel',
  component: AppFieldLabel,
  render: (args) => ({ components: { AppFieldLabel }, setup: () => ({ args }), template: '<AppFieldLabel v-bind="args">Beschreibung</AppFieldLabel>' }),
} satisfies Meta<typeof AppFieldLabel>;
export default meta;
export const Default: StoryObj<typeof meta> = {};

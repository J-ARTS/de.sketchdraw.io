import type { Meta, StoryObj } from '@storybook/vue3-vite';
import AppIconButton from '@/renderer/design-system/atoms/AppIconButton.vue';
import { ICON_PATHS } from '@/renderer/design-system/atoms/icons';

const meta = {
  title: 'Atoms/AppIconButton',
  component: AppIconButton,
  argTypes: { icon: { control: 'select', options: Object.keys(ICON_PATHS) } },
  args: { icon: 'close', label: 'Dialog schließen' },
} satisfies Meta<typeof AppIconButton>;
export default meta;
type Story = StoryObj<typeof meta>;

export const Action: Story = {};
/** A switch: `pressed` tells assistive technology whether it is on. */
export const Pressed: Story = { args: { icon: 'code', label: 'Mermaid-Code anzeigen', pressed: true } };
export const Disabled: Story = { render: (args) => ({ components: { AppIconButton }, setup: () => ({ args }), template: '<AppIconButton v-bind="args" disabled />' }) };

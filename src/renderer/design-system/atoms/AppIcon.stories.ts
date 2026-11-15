import type { Meta, StoryObj } from '@storybook/vue3-vite';
import AppIcon from '@/renderer/design-system/atoms/AppIcon.vue';
import { ICON_PATHS, type IconName } from '@/renderer/design-system/atoms/icons';

const meta = {
  title: 'Atoms/AppIcon',
  component: AppIcon,
  argTypes: { name: { control: 'select', options: Object.keys(ICON_PATHS) }, size: { control: { type: 'range', min: 12, max: 48, step: 2 } } },
  args: { name: 'select', size: 24 },
} satisfies Meta<typeof AppIcon>;
export default meta;
type Story = StoryObj<typeof meta>;

export const Single: Story = {};
/** Every symbol of the set with its name. A new symbol is added in `icons.ts`. */
export const AllIcons: Story = {
  parameters: { layout: 'padded' },
  render: () => ({
    components: { AppIcon },
    setup: () => ({ names: Object.keys(ICON_PATHS) as IconName[] }),
    template: '<ul style="display:grid;grid-template-columns:repeat(auto-fill,minmax(130px,1fr));gap:12px;margin:0;padding:0;list-style:none"><li v-for="name in names" :key="name" style="display:flex;align-items:center;gap:8px;font-size:12px;color:var(--text-muted)"><AppIcon :name="name" style="color:var(--text-primary)" />{{ name }}</li></ul>',
  }),
};

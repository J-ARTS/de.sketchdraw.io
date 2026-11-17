import type { Meta, StoryObj } from '@storybook/vue3-vite';
import AppAvatar from '@/renderer/design-system/atoms/AppAvatar.vue';

const meta = {
  title: 'Atoms/AppAvatar',
  component: AppAvatar,
  args: { name: 'Jeremy Teichmann', color: 0 },
} satisfies Meta<typeof AppAvatar>;
export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};
export const Small: Story = { args: { size: 'sm' } };
/** The connection of the person dropped; the colour remains as an outline. */
export const Away: Story = { args: { away: true } };
/** All eight colours; a ninth person shares a colour with the first. */
export const Colours: Story = {
  render: () => ({
    components: { AppAvatar },
    setup: () => ({ people: ['Jeremy Teichmann', 'Anna Lena', 'Ben', 'Gast 3', 'Chiara Rossi', 'Deniz', 'Émile Dupont', 'Farah Khan'] }),
    template: '<div style="display:flex;gap:8px"><AppAvatar v-for="(name, index) in people" :key="name" :name="name" :color="index" /></div>',
  }),
};

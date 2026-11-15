import type { Meta, StoryObj } from '@storybook/vue3-vite';
import AppKbd from '@/renderer/design-system/atoms/AppKbd.vue';

const meta = {
  title: 'Atoms/AppKbd',
  component: AppKbd,
  render: () => ({ components: { AppKbd }, template: '<span style="display:inline-flex;gap:6px;align-items:center;font-size:13px">Rückgängig <AppKbd>Strg</AppKbd><AppKbd>Z</AppKbd></span>' }),
} satisfies Meta<typeof AppKbd>;
export default meta;
export const Shortcut: StoryObj<typeof meta> = {};

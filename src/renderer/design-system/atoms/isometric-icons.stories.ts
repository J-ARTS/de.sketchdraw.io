import type { Meta, StoryObj } from '@storybook/vue3-vite';
import { ISOMETRIC_ICONS } from '@/catalog';
import SafeIcon from '@/renderer/design-system/atoms/SafeIcon';

/**
 * The isometric icon library (`src/catalog/isometric.ts`): one projection, one line weight and two families of
 * colour. Orange wireframe hulls with a solid core stand for services and data, solid slate blocks for compute,
 * network and clients. The icons are drawn by code; a new one is a few lines in `ISOMETRIC_ICONS`.
 */
const meta = { title: 'Atoms/Isometric icons', parameters: { layout: 'padded' } } satisfies Meta;
export default meta;
type Story = StoryObj<typeof meta>;

const categories = [...new Set(ISOMETRIC_ICONS.map((icon) => icon.category))].map((category) => ({ category, icons: ISOMETRIC_ICONS.filter((icon) => icon.category === category) }));

/** Every icon by category, at the size it has on the canvas. */
export const Library: Story = {
  render: () => ({
    components: { SafeIcon },
    setup: () => ({ categories }),
    template: `<div style="display:grid;gap:28px"><section v-for="group in categories" :key="group.category">
      <h3 style="margin:0 0 12px;font-size:12px;letter-spacing:.08em;text-transform:uppercase;color:var(--text-muted)">{{ group.category }}</h3>
      <ul style="display:grid;grid-template-columns:repeat(auto-fill,minmax(128px,1fr));gap:16px;margin:0;padding:0;list-style:none">
        <li v-for="icon in group.icons" :key="icon.id" style="display:grid;justify-items:center;gap:6px;font-size:13px"><SafeIcon :source="icon.svg" :size="96" />{{ icon.name }}</li>
      </ul></section></div>`,
  }),
};
/** The same drawing from tile size to poster size: the icons are vectors and keep their line weight in proportion. */
export const Sizes: Story = {
  render: () => ({
    components: { SafeIcon },
    setup: () => ({ icons: ['instance', 'server-stack', 'database'].map((id) => ISOMETRIC_ICONS.find((icon) => icon.id === id)!), sizes: [32, 56, 96, 160] }),
    template: '<div style="display:grid;gap:16px"><div v-for="icon in icons" :key="icon.id" style="display:flex;align-items:flex-end;gap:24px"><SafeIcon v-for="size in sizes" :key="size" :source="icon.svg" :size="size" /></div></div>',
  }),
};

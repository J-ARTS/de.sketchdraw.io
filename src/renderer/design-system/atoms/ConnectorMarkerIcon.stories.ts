import type { Meta, StoryObj } from '@storybook/vue3-vite';
import type { ConnectorMarker } from '@/domain';
import ConnectorMarkerIcon from '@/renderer/design-system/atoms/ConnectorMarkerIcon.vue';

const MARKERS: ConnectorMarker[] = ['none', 'solid-arrow', 'line-arrow', 'triangle', 'circle', 'diamond'];
const meta = {
  title: 'Atoms/ConnectorMarkerIcon',
  component: ConnectorMarkerIcon,
  argTypes: { marker: { control: 'select', options: MARKERS } },
  args: { marker: 'solid-arrow' },
} satisfies Meta<typeof ConnectorMarkerIcon>;
export default meta;
type Story = StoryObj<typeof meta>;

export const Single: Story = {};
export const AllMarkers: Story = {
  render: () => ({ components: { ConnectorMarkerIcon }, setup: () => ({ MARKERS }), template: '<div style="display:flex;gap:16px"><span v-for="marker in MARKERS" :key="marker" :title="marker"><ConnectorMarkerIcon :marker="marker" /></span></div>' }),
};

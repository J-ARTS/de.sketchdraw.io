import type { Meta, StoryObj } from '@storybook/vue3-vite';
import SmartGuides from '@/renderer/design-system/organisms/SmartGuides.vue';
import { withWhiteboard } from '@/renderer/design-system/storybook/with-whiteboard';

// The store fills `guides` only while a move is in progress; the stories set them directly to show the drawing.
const meta = {
  title: 'Organisms/SmartGuides',
  component: SmartGuides,
  render: () => ({
    components: { SmartGuides },
    template: `<svg width="640" height="320" style="display:block;background:var(--surface-canvas);border-radius:8px">
      <g fill="var(--surface-panel)" stroke="var(--border-default)" stroke-width="1.5">
        <rect x="60" y="60" width="120" height="70" rx="6" /><rect x="260" y="60" width="120" height="70" rx="6" /><rect x="460" y="60" width="120" height="70" rx="6" stroke="var(--accent)" />
        <rect x="460" y="210" width="120" height="70" rx="6" />
      </g>
      <SmartGuides />
    </svg>`,
  }),
} satisfies Meta<typeof SmartGuides>;
export default meta;
type Story = StoryObj<typeof meta>;

/** The moved box (outlined in the accent) continues the distance of the row and is in line with the box below it. */
export const AlignedWithEqualDistances: Story = {
  decorators: [withWhiteboard((store) => {
    (store.state as { guides: unknown }).guides = [
      { kind: 'align', axis: 'y', at: 60, from: 60, to: 580 },
      { kind: 'align', axis: 'y', at: 130, from: 60, to: 580 },
      { kind: 'align', axis: 'x', at: 460, from: 60, to: 280 },
      { kind: 'align', axis: 'x', at: 580, from: 60, to: 280 },
      { kind: 'gap', axis: 'x', from: 180, to: 260, at: 95, size: 80 },
      { kind: 'gap', axis: 'x', from: 380, to: 460, at: 95, size: 80 },
    ];
  })],
};
/** Equal distances in a column. */
export const Column: Story = {
  decorators: [withWhiteboard((store) => {
    (store.state as { guides: unknown }).guides = [
      { kind: 'gap', axis: 'y', from: 130, to: 210, at: 520, size: 80 },
      { kind: 'align', axis: 'x', at: 520, from: 60, to: 280 },
    ];
  })],
};

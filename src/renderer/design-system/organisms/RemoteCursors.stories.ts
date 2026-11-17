import type { Meta, StoryObj } from '@storybook/vue3-vite';
import RemoteCursors from '@/renderer/design-system/organisms/RemoteCursors.vue';
import { withWhiteboard } from '@/renderer/design-system/storybook/with-whiteboard';
import type { SessionParticipant } from '@/collaboration/presence';

const people: SessionParticipant[] = [
  { id: 'a00000000001', name: 'Jeremy Teichmann', number: 0, role: 'owner', color: 0, state: 'online', self: true },
  { id: 'a00000000002', name: 'Anna Lena', number: 1, role: 'editor', color: 1, state: 'online', self: false },
  { id: 'a00000000003', name: '', number: 2, role: 'viewer', color: 2, state: 'online', self: false },
  { id: 'a00000000004', name: 'Ben', number: 3, role: 'editor', color: 3, state: 'online', self: false },
];
const meta = {
  title: 'Organisms/RemoteCursors',
  component: RemoteCursors,
  render: () => ({ components: { RemoteCursors }, template: '<svg width="640" height="320" style="display:block;background:var(--surface-canvas);border-radius:8px"><RemoteCursors /></svg>' }),
} satisfies Meta<typeof RemoteCursors>;
export default meta;
type Story = StoryObj<typeof meta>;

/** Three other people point at the page; the own pointer is not drawn. */
export const Pointers: Story = {
  decorators: [withWhiteboard((store) => {
    const pageId = store.state.activePageId;
    store.setPresence({ participants: people, cursors: [
      { id: 'a00000000001', pageId, x: 40, y: 40 },
      { id: 'a00000000002', pageId, x: 140, y: 90 },
      { id: 'a00000000003', pageId, x: 330, y: 190 },
      { id: 'a00000000004', pageId, x: 470, y: 70 },
    ] });
  })],
};
/** A pointer on another page stays hidden. */
export const OtherPage: Story = {
  decorators: [withWhiteboard((store) => {
    store.setPresence({ participants: people, cursors: [{ id: 'a00000000002', pageId: store.state.activePageId, x: 140, y: 90 }, { id: 'a00000000004', pageId: 'another-page', x: 300, y: 120 }] });
  })],
};

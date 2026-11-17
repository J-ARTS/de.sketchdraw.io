import type { Meta, StoryObj } from '@storybook/vue3-vite';
import FollowIndicator from '@/renderer/design-system/organisms/FollowIndicator.vue';
import { stage, withWhiteboard } from '@/renderer/design-system/storybook/with-whiteboard';
import type { SessionParticipant } from '@/collaboration/presence';

const people: SessionParticipant[] = [
  { id: 'a00000000001', name: 'Jeremy Teichmann', number: 0, role: 'owner', color: 0, state: 'online', self: true },
  { id: 'a00000000002', name: 'Anna Lena Hoffmann', number: 1, role: 'editor', color: 1, state: 'online', self: false },
  { id: 'a00000000003', name: '', number: 2, role: 'viewer', color: 3, state: 'online', self: false },
];
const following = (id: string) => withWhiteboard(store => {
  store.setPresence({ participants: people, cursors: [], views: [{ id, pageId: store.state.activePageId, x: 0, y: 0, width: 960, height: 600 }] });
  store.followParticipant(id);
});
const meta = {
  title: 'Organisms/FollowIndicator',
  component: FollowIndicator,
} satisfies Meta<typeof FollowIndicator>;
export default meta;
type Story = StoryObj<typeof meta>;

/** Frame and bar take the colour of the person. */
export const Following: Story = { decorators: [following('a00000000002'), stage(360)] };
/** A guest without a name. */
export const FollowingGuest: Story = { decorators: [following('a00000000003'), stage(360)] };

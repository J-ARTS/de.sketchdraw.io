import type { Meta, StoryObj } from '@storybook/vue3-vite';
import SessionMenu from '@/renderer/design-system/organisms/SessionMenu.vue';
import { withWhiteboard } from '@/renderer/design-system/storybook/with-whiteboard';
import type { SessionParticipant } from '@/collaboration/presence';
import type { WhiteboardStore } from '@/renderer/state/contract';

const people: SessionParticipant[] = [
  { id: 'a00000000001', name: 'Jeremy Teichmann', number: 0, role: 'owner', color: 0, state: 'online', self: true },
  { id: 'a00000000002', name: 'Anna Lena Hoffmann', number: 1, role: 'editor', color: 1, state: 'online', self: false },
  { id: 'a00000000003', name: '', number: 2, role: 'viewer', color: 2, state: 'online', self: false },
  { id: 'a00000000004', name: 'Ben', number: 3, role: 'editor', color: 3, state: 'reconnecting', self: false },
];
function session(store: WhiteboardStore, hosting: boolean, list = people): void {
  store.setSession({ hosting, end: () => store.setSession(null) });
  store.setPresence({ participants: list, cursors: [], views: list.filter(person => !person.self && person.state === 'online').map(person => ({ id: person.id, pageId: store.state.activePageId, x: 0, y: 0, width: 960, height: 600 })) });
}
const meta = {
  title: 'Organisms/SessionMenu',
  component: SessionMenu,
  // The menu hangs on the right end of the workspace bar; the story stands in for the bar.
  render: (args) => ({ components: { SessionMenu }, setup: () => ({ args }), template: '<div class="sd-panel" style="position:relative;display:flex;justify-content:flex-end;align-items:center;width:340px;height:56px;padding:0 8px;margin-bottom:340px"><SessionMenu v-bind="args" /></div>' }),
  play: async ({ canvasElement }) => { canvasElement.querySelector<HTMLButtonElement>('[data-testid="session-button"]')?.click(); },
} satisfies Meta<typeof SessionMenu>;
export default meta;
type Story = StoryObj<typeof meta>;

/** The host with three guests, one of them interrupted. */
export const Host: Story = { decorators: [withWhiteboard(store => session(store, true))] };
/** The user follows a guest: the row is marked and the button in the bar stays highlighted. */
export const Following: Story = { decorators: [withWhiteboard(store => { session(store, true); store.followParticipant('a00000000002'); })] };
/** A guest can leave, not end the session; with the side panel open there is no entry for it. */
export const Guest: Story = { args: { panelOpen: true }, decorators: [withWhiteboard(store => session(store, false, people.map((person, index) => ({ ...person, self: index === 1 }))))] };
/** Before anyone joined. */
export const Alone: Story = { decorators: [withWhiteboard(store => session(store, true, people.slice(0, 1)))] };
/** Without a session there is no button. */
export const NoSession: Story = { play: async () => {}, decorators: [withWhiteboard()] };

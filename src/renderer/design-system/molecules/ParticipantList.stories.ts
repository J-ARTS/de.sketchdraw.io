import type { Meta, StoryObj } from '@storybook/vue3-vite';
import type { SessionParticipant } from '@/collaboration/presence';
import ParticipantList from '@/renderer/design-system/molecules/ParticipantList.vue';

const people: SessionParticipant[] = [
  { id: 'a00000000001', name: 'Jeremy Teichmann', number: 0, role: 'owner', color: 0, state: 'online', self: true },
  { id: 'a00000000002', name: 'Anna Lena Hoffmann', number: 1, role: 'editor', color: 1, state: 'online', self: false },
  { id: 'a00000000003', name: '', number: 2, role: 'viewer', color: 2, state: 'online', self: false },
  { id: 'a00000000004', name: 'Ben', number: 3, role: 'editor', color: 3, state: 'reconnecting', self: false },
];
const meta = {
  title: 'Molecules/ParticipantList',
  component: ParticipantList,
  args: { participants: people, removable: true },
  render: (args) => ({ components: { ParticipantList }, setup: () => ({ args }), template: '<div style="width:328px"><ParticipantList v-bind="args" /></div>' }),
} satisfies Meta<typeof ParticipantList>;
export default meta;
type Story = StoryObj<typeof meta>;

/** What the host sees: every guest can be removed. */
export const Host: Story = {};
/** What a guest sees: the same people, nothing to remove. */
export const Guest: Story = { args: { removable: false, participants: people.map((person, index) => ({ ...person, self: index === 1 })) } };
/** Before anyone joined. */
export const Alone: Story = { args: { participants: people.slice(0, 1) } };
/** A host that gave no name, and a long name in a narrow panel. */
export const NeutralAndLongNames: Story = { args: { participants: [{ ...people[0]!, name: '' }, { ...people[1]!, name: 'Maximiliane Alexandra von Hohenstein' }] } };

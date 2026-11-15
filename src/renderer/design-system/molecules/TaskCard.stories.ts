import type { Meta, StoryObj } from '@storybook/vue3-vite';
import type { SketchTask } from '@/domain';
import TaskCard from '@/renderer/design-system/molecules/TaskCard.vue';

const task: SketchTask = { id: 'task:1', title: 'Zahlungsdienst an die Bank anbinden', description: 'Autorisierung und Rückmeldung an den Shop.', status: 'doing', rank: 1, createdAt: '2026-11-10T09:00:00.000Z', updatedAt: '2026-11-14T15:30:00.000Z', assignee: 'Mira', dueDate: '2026-11-20' };
const meta = {
  title: 'Molecules/TaskCard',
  component: TaskCard,
  args: { task },
  render: (args) => ({ components: { TaskCard }, setup: () => ({ args }), template: '<div style="width:300px"><TaskCard v-bind="args" /></div>' }),
} satisfies Meta<typeof TaskCard>;
export default meta;
type Story = StoryObj<typeof meta>;

export const InProgress: Story = {};
export const Minimal: Story = { args: { task: { ...task, id: 'task:2', title: 'Aufräumen', description: '', status: 'todo', assignee: undefined, dueDate: undefined } as SketchTask } };
export const Done: Story = { args: { task: { ...task, id: 'task:3', status: 'done' } } };
/** The placeholder shown where a dragged card would land. */
export const Ghost: Story = { args: { ghost: true } };

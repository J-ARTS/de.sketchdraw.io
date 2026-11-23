import type { Meta, StoryObj } from '@storybook/vue3-vite';
import type { AgentSkillClient, AgentSkillStatus } from '@/domain';
import AgentSkillSettings from '@/renderer/design-system/molecules/AgentSkillSettings.vue';

const clients: AgentSkillClient[] = [
  { id: 'claude', name: 'Claude Code', folder: '~/.claude/skills/sketchdraw-desktop', state: 'current' },
  { id: 'codex', name: 'Codex', folder: '~/.codex/skills/sketchdraw-desktop', state: 'current' },
  { id: 'antigravity', name: 'Antigravity', folder: '~/.gemini/config/skills/sketchdraw-desktop', state: 'absent' },
];
const status: AgentSkillStatus = { supported: true, automatic: true, clients };
const meta = {
  title: 'Molecules/AgentSkillSettings',
  component: AgentSkillSettings,
  args: { status },
  render: (args) => ({ components: { AgentSkillSettings }, setup: () => ({ args }), template: '<div class="sd-panel" style="width:420px;padding:20px"><AgentSkillSettings v-bind="args" /></div>' }),
} satisfies Meta<typeof AgentSkillSettings>;
export default meta;
type Story = StoryObj<typeof meta>;

/** The skill is kept up to date for the two agents found on this computer. */
export const Automatic: Story = {};
/** Before the user has decided, and after switching it off: nothing is written; each agent offers its own action. */
export const Off: Story = { args: { status: { ...status, automatic: false, clients: clients.map((client, index) => ({ ...client, state: index === 0 ? 'missing' : index === 1 ? 'outdated' : 'absent' })) } } };
/** A copy the user changed is left alone; "Ersetzen" asks for the skill of this version. */
export const ChangedByTheUser: Story = { args: { status: { ...status, clients: clients.map((client, index) => ({ ...client, state: index === 0 ? 'modified' : client.state })) } } };
/** A start from the sources: the status is shown, nothing can be set up. */
export const DevelopmentStart: Story = { args: { status: { ...status, supported: false, automatic: null, clients: clients.map((client) => ({ ...client, state: client.state === 'absent' ? 'absent' : 'missing' })) } } };

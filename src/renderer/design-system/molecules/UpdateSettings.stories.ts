import type { Meta, StoryObj } from '@storybook/vue3-vite';
import type { UpdateStatus } from '@/domain';
import UpdateSettings from '@/renderer/design-system/molecules/UpdateSettings.vue';

const status: UpdateStatus = { supported: true, canInstall: true, autoCheck: true, currentVersion: '0.1.6', phase: 'idle', latestVersion: null, progress: null, problem: null };
const meta = {
  title: 'Molecules/UpdateSettings',
  component: UpdateSettings,
  args: { status },
  render: (args) => ({ components: { UpdateSettings }, setup: () => ({ args }), template: '<div class="sd-panel" style="width:420px;padding:20px"><UpdateSettings v-bind="args" /></div>' }),
} satisfies Meta<typeof UpdateSettings>;
export default meta;
type Story = StoryObj<typeof meta>;

/** Before the first check of a session. */
export const Idle: Story = {};
export const Checking: Story = { args: { status: { ...status, phase: 'checking' } } };
export const UpToDate: Story = { args: { status: { ...status, phase: 'current', latestVersion: '0.1.6' } } };
/** A newer release exists; the primary action installs it. */
export const Available: Story = { args: { status: { ...status, phase: 'available', latestVersion: '0.1.7' } } };
/** The installation cannot replace itself (unpacked copy, read-only folder): only the release page is offered. */
export const AvailableWithoutInstaller: Story = { args: { status: { ...status, phase: 'available', latestVersion: '0.1.7', canInstall: false } } };
export const Downloading: Story = { args: { status: { ...status, phase: 'downloading', latestVersion: '0.1.7', progress: 0.42 } } };
export const Installing: Story = { args: { status: { ...status, phase: 'installing', latestVersion: '0.1.7' } } };
export const Ready: Story = { args: { status: { ...status, phase: 'ready', latestVersion: '0.1.7' } } };
export const Offline: Story = { args: { status: { ...status, phase: 'error', problem: 'network' } } };
/** The download did not match the checksum of the release: it was discarded, the release page is offered. */
export const ChecksumMismatch: Story = { args: { status: { ...status, phase: 'error', problem: 'checksum', latestVersion: '0.1.7' } } };
export const AutoCheckOff: Story = { args: { status: { ...status, autoCheck: false, phase: 'current', latestVersion: '0.1.6' } } };
/** A start from the sources: there is nothing to check or install. */
export const DevelopmentStart: Story = { args: { status: { ...status, supported: false, canInstall: false } } };

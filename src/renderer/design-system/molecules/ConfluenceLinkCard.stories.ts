import type { Meta, StoryObj } from '@storybook/vue3-vite';
import ConfluenceLinkCard from '@/renderer/design-system/molecules/ConfluenceLinkCard.vue';

const meta = {
  title: 'Molecules/ConfluenceLinkCard',
  component: ConfluenceLinkCard,
  args: { title: 'Architektur – Übersicht', siteUrl: 'https://example.atlassian.net', status: { state: 'synced', message: '', syncedAt: '2026-11-20T08:12:00.000Z' } },
  render: (args) => ({ components: { ConfluenceLinkCard }, setup: () => ({ args }), template: '<div class="sd-panel" style="width:460px;padding:20px"><ConfluenceLinkCard v-bind="args" /></div>' }),
} satisfies Meta<typeof ConfluenceLinkCard>;
export default meta;
type Story = StoryObj<typeof meta>;

/** Confluence confirmed the last publication. */
export const Synced: Story = {};
/** A change is waiting for the pause in typing to end. */
export const Pending: Story = { args: { status: { state: 'pending', message: '', syncedAt: '2026-11-20T08:12:00.000Z' } } };
export const Syncing: Story = { args: { status: { state: 'syncing', message: '' } } };
/** The server asked for a pause; the end of it is shown. */
export const WaitingForServer: Story = { args: { status: { state: 'retrying', message: 'Confluence hat um eine Pause gebeten. Die Veröffentlichung wird danach automatisch fortgesetzt.', retryAt: '2026-11-20T08:20:00.000Z' } } };
/** Needs the user: the account may not write the page. */
export const AccessDenied: Story = { args: { status: { state: 'error', message: 'Confluence verweigert den Zugriff. Prüfe das API-Token und die Rechte für die Seite.' } } };
/** The plugin is switched off; nothing is transmitted until it is on again. */
export const Paused: Story = { args: { status: { state: 'paused', message: 'Das Jira-Plugin ist deaktiviert. Aktiviere es, damit Änderungen wieder nach Confluence übertragen werden.' }, lastSyncedAt: '2026-11-19T17:40:00.000Z' } };
export const Busy: Story = { args: { busy: true } };
/** A long title wraps inside the card. */
export const LongTitle: Story = { args: { title: 'Referenzarchitektur AWS Bedrock AgentCore mit Gateway, Identity, Memory und Observability – Zielbild 2027' } };

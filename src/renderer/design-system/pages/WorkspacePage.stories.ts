import type { Meta, StoryObj } from '@storybook/vue3-vite';
import WorkspacePage from '@/renderer/design-system/pages/WorkspacePage.vue';

/** The whole application as it starts: the workspace layout filled with an empty document. */
const meta = {
  title: 'Pages/WorkspacePage',
  component: WorkspacePage,
  parameters: { layout: 'fullscreen', docs: { story: { inline: false, iframeHeight: 720 } } },
  render: () => ({ components: { WorkspacePage }, template: '<div style="position:relative;height:100vh;min-height:640px"><WorkspacePage /></div>' }),
} satisfies Meta<typeof WorkspacePage>;
export default meta;
export const EmptyDocument: StoryObj<typeof meta> = {};

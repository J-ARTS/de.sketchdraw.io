import type { Meta, StoryObj } from '@storybook/vue3-vite';
import { useWhiteboard } from '@/renderer/design-system/composables/use-whiteboard';
import GitDialog from '@/renderer/design-system/organisms/GitDialog.vue';
import { gitDemoBridge } from '@/renderer/design-system/storybook/git-demo';
import { withWhiteboard } from '@/renderer/design-system/storybook/with-whiteboard';
import type { WhiteboardStore } from '@/renderer/state/contract';

/** Opens the demo diagram, so that the store has a file in a repository, and then the dialog. */
const openWithRepository = async (store: WhiteboardStore): Promise<void> => { await store.openDocument(); await store.refreshPluginSettings(); store.toggleGit(true); };

const meta = {
  title: 'Organisms/GitDialog',
  component: GitDialog,
  args: { open: true },
  parameters: { layout: 'fullscreen', docs: { story: { inline: false, iframeHeight: 760 } } },
  render: () => ({ components: { GitDialog }, setup: () => ({ store: useWhiteboard() }), template: '<GitDialog :open="store.state.gitOpen" @close="store.toggleGit(false)" />' }),
} satisfies Meta<typeof GitDialog>;
export default meta;
type Story = StoryObj<typeof meta>;

/** Changed files with the open diagram ticked, its diff, and the commit message. The other tabs hold history and automation. */
export const Changes: Story = { decorators: [withWhiteboard(openWithRepository, () => ({ bridge: gitDemoBridge() }))] };
/** Nothing to commit. */
export const Clean: Story = { decorators: [withWhiteboard(openWithRepository, () => ({ bridge: gitDemoBridge({ clean: true }) }))] };
/** A diagram that was never saved has no folder, so Git has nothing to work in. */
export const NoFolder: Story = { decorators: [withWhiteboard((store) => store.toggleGit(true), () => ({ bridge: gitDemoBridge() }))] };

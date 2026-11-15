import type { Meta, StoryObj } from '@storybook/vue3-vite';
import WorkspacePanels from '@/renderer/design-system/templates/WorkspacePanels.vue';
import { seedDiagram } from '@/renderer/design-system/storybook/seed';
import { withWhiteboard } from '@/renderer/design-system/storybook/with-whiteboard';

const frame = 'position:relative;height:640px;overflow:hidden;--panel-top:16px;--panel-bottom:16px';
const meta = {
  title: 'Templates/WorkspacePanels',
  component: WorkspacePanels,
  parameters: { layout: 'fullscreen' },
  render: () => ({ components: { WorkspacePanels }, template: `<div style="${frame}"><WorkspacePanels /></div>` }),
} satisfies Meta<typeof WorkspacePanels>;
export default meta;
type Story = StoryObj<typeof meta>;

/** The code of the whole page beside the canvas. */
export const DocumentCode: Story = { decorators: [withWhiteboard(async (store) => { await seedDiagram(store); store.toggleCode(); })] };
/** The shape library. */
export const Catalog: Story = { decorators: [withWhiteboard((store) => store.toggleCatalog())] };
/** The list of objects in stacking order. */
export const Objects: Story = { decorators: [withWhiteboard(async (store) => { await seedDiagram(store, 'bpmn.example'); store.toggleObjects(true); })] };

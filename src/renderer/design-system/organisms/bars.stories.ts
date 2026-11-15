import type { Meta, StoryObj } from '@storybook/vue3-vite';
import ConnectorOptionsBar from '@/renderer/design-system/organisms/ConnectorOptionsBar.vue';
import MainMenu from '@/renderer/design-system/organisms/MainMenu.vue';
import Minimap from '@/renderer/design-system/organisms/Minimap.vue';
import PageSwitcher from '@/renderer/design-system/organisms/PageSwitcher.vue';
import Toolbar from '@/renderer/design-system/organisms/Toolbar.vue';
import ToolOptionsBar from '@/renderer/design-system/organisms/ToolOptionsBar.vue';
import { seedDiagram } from '@/renderer/design-system/storybook/seed';
import { stage, withWhiteboard } from '@/renderer/design-system/storybook/with-whiteboard';

/**
 * The floating bars of the workspace. They share one height (`--chrome-height`) and one control size
 * (`--chrome-control`); a new bar takes these tokens instead of its own measures.
 */
const meta = { title: 'Organisms/Bars', parameters: { layout: 'padded' } } satisfies Meta;
export default meta;
type Story = StoryObj<typeof meta>;

export const ToolBar: Story = { name: 'Toolbar', decorators: [stage(120), withWhiteboard()], render: () => ({ components: { Toolbar }, template: '<Toolbar />' }) };
/** The options appear for the active drawing tool, here the rectangle. */
export const ToolOptions: Story = { name: 'ToolOptionsBar', decorators: [stage(160), withWhiteboard((store) => store.setTool('rectangle'))], render: () => ({ components: { ToolOptionsBar }, template: '<ToolOptionsBar />' }) };
export const ConnectorOptions: Story = { name: 'ConnectorOptionsBar', decorators: [stage(160), withWhiteboard((store) => store.setTool('connector'))], render: () => ({ components: { ConnectorOptionsBar }, template: '<ConnectorOptionsBar />' }) };
/** Document card on the left, workspace bar on the right. */
export const Menu: Story = { name: 'MainMenu', decorators: [stage(420), withWhiteboard()], render: () => ({ components: { MainMenu }, template: '<div style="display:flex;justify-content:space-between;gap:16px"><MainMenu :collaboration-open="false" :plugins-open="false" /></div>' }) };
export const Pages: Story = { name: 'PageSwitcher', decorators: [stage(320), withWhiteboard((store) => store.addPage())], render: () => ({ components: { PageSwitcher }, template: '<PageSwitcher />' }) };
export const Overview: Story = { name: 'Minimap', decorators: [stage(240), withWhiteboard((store) => seedDiagram(store))], render: () => ({ components: { Minimap }, template: '<Minimap />' }) };

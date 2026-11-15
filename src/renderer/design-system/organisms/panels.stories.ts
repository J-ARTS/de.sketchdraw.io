import type { Meta, StoryObj } from '@storybook/vue3-vite';
import CollaborationPanel from '@/renderer/design-system/organisms/CollaborationPanel.vue';
import CommentSidebar from '@/renderer/design-system/organisms/CommentSidebar.vue';
import DiagramCodePanel from '@/renderer/design-system/organisms/DiagramCodePanel.vue';
import DiagramLibraryView from '@/renderer/design-system/organisms/DiagramLibraryView.vue';
import FrameSidebar from '@/renderer/design-system/organisms/FrameSidebar.vue';
import InteropPanel from '@/renderer/design-system/organisms/InteropPanel.vue';
import PluginSettings from '@/renderer/design-system/organisms/PluginSettings.vue';
import ShapeLibraryPanel from '@/renderer/design-system/organisms/ShapeLibraryPanel.vue';
import TaskBoard from '@/renderer/design-system/organisms/TaskBoard.vue';
import { diagramLibrary } from '@/renderer/lib/diagram-libraries';
import { seedDiagram, seedTasks } from '@/renderer/design-system/storybook/seed';
import { withWhiteboard } from '@/renderer/design-system/storybook/with-whiteboard';

/** Side panels and views of the workspace. In the app they sit at the edge of the window; here they get a frame of that kind. */
const meta = { title: 'Organisms/Panels', parameters: { layout: 'fullscreen' } } satisfies Meta;
export default meta;
type Story = StoryObj<typeof meta>;

const frame = 'position:relative;height:640px;overflow:hidden;--panel-top:16px;--panel-bottom:16px';
export const ShapeLibrary: Story = { name: 'ShapeLibraryPanel', decorators: [withWhiteboard()], render: () => ({ components: { ShapeLibraryPanel }, template: `<div style="width:360px;height:640px;margin:0 auto;padding:16px;overflow:auto"><ShapeLibraryPanel /></div>` }) };
/** One diagram library with its tiles, as the shape library shows it. */
export const DiagramLibrary: Story = { name: 'DiagramLibraryView', decorators: [withWhiteboard()], render: () => ({ components: { DiagramLibraryView }, setup: () => ({ library: diagramLibrary('sequence') }), template: '<div style="width:340px;margin:0 auto;padding:16px"><DiagramLibraryView :library="library" query="" /></div>' }) };
/** The Mermaid code of the selected sequence diagram; typing changes the diagram. */
export const DiagramCode: Story = { name: 'DiagramCodePanel', decorators: [withWhiteboard(async (store) => { await seedDiagram(store); store.toggleDiagramCode(true); })], render: () => ({ components: { DiagramCodePanel }, template: `<div style="${frame}"><DiagramCodePanel /></div>` }) };
export const Export: Story = { name: 'InteropPanel (Export)', decorators: [withWhiteboard((store) => seedDiagram(store))], render: () => ({ components: { InteropPanel }, template: `<div style="${frame}"><InteropPanel open mode="export" /></div>` }) };
export const Import: Story = { name: 'InteropPanel (Import)', decorators: [withWhiteboard()], render: () => ({ components: { InteropPanel }, template: `<div style="${frame}"><InteropPanel open mode="import" /></div>` }) };
export const Collaboration: Story = { name: 'CollaborationPanel', decorators: [withWhiteboard()], render: () => ({ components: { CollaborationPanel }, template: `<div style="${frame}"><CollaborationPanel open /></div>` }) };
export const Plugins: Story = { name: 'PluginSettings', decorators: [withWhiteboard()], render: () => ({ components: { PluginSettings }, template: `<div style="${frame}"><PluginSettings open /></div>` }) };
/** Opened by starting a comment on the page; the list is empty until the first comment is written. */
export const Comments: Story = { name: 'CommentSidebar', decorators: [withWhiteboard((store) => store.startComment(undefined, undefined, { x: 300, y: 200 }))], render: () => ({ components: { CommentSidebar }, template: `<div style="${frame}"><CommentSidebar /></div>` }) };
export const Frames: Story = { name: 'FrameSidebar', decorators: [withWhiteboard((store) => store.toggleFrameSidebar(true))], render: () => ({ components: { FrameSidebar }, template: `<div style="${frame}"><FrameSidebar /></div>` }) };
/** The task view with tasks in every column. */
export const Tasks: Story = { name: 'TaskBoard', decorators: [withWhiteboard((store) => seedTasks(store))], render: () => ({ components: { TaskBoard }, template: `<div style="${frame}"><TaskBoard /></div>` }) };

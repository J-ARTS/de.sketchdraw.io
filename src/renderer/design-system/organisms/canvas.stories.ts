import { h } from 'vue';
import type { Meta, StoryObj } from '@storybook/vue3-vite';
import { createDocument } from '@/domain';
import ElementView from '@/renderer/design-system/organisms/ElementView.vue';
import PayloadPreview from '@/renderer/design-system/organisms/PayloadPreview.vue';
import SelectionToolbar from '@/renderer/design-system/organisms/SelectionToolbar.vue';
import WhiteboardCanvas from '@/renderer/design-system/organisms/WhiteboardCanvas.vue';
import { diagramTemplate } from '@/renderer/lib/diagram-libraries';
import { seedDiagram } from '@/renderer/design-system/storybook/seed';
import { withWhiteboard } from '@/renderer/design-system/storybook/with-whiteboard';

/** The drawing surface and what belongs to it. */
const meta = { title: 'Organisms/Canvas', parameters: { layout: 'fullscreen' } } satisfies Meta;
export default meta;
type Story = StoryObj<typeof meta>;

const surface = 'position:relative;height:640px;overflow:hidden';
/** The canvas with a sequence diagram from the library. Pan with the space bar or the middle mouse button, zoom with the wheel. */
export const Canvas: Story = { name: 'WhiteboardCanvas', decorators: [withWhiteboard((store) => seedDiagram(store))], render: () => ({ components: { WhiteboardCanvas }, template: `<div style="${surface}"><WhiteboardCanvas /></div>` }) };
/** The bar of the selection: the diagram is selected, so the bar offers what fits a sequence diagram. */
export const Selection: Story = { name: 'SelectionToolbar', decorators: [withWhiteboard((store) => seedDiagram(store))], render: () => ({ components: { WhiteboardCanvas, SelectionToolbar }, template: `<div style="${surface}"><WhiteboardCanvas /><SelectionToolbar /></div>` }) };
/** One element drawn the way the canvas draws it, outside the canvas. */
export const Element: Story = {
  name: 'ElementView',
  parameters: { layout: 'centered' },
  render: () => {
    const document = createDocument('Story');
    const elements = diagramTemplate('bpmn.example')!.build().elements;
    return { setup: () => () => h('svg', { width: 620, height: 120, viewBox: '-20 -20 620 120' }, elements.map((element) => h(ElementView, { key: element.id, element, document, theme: 'light', staticPreview: true }))) };
  },
};
/** The picture of copied elements that the library tiles show. */
export const Preview: Story = {
  name: 'PayloadPreview',
  parameters: { layout: 'centered' },
  render: () => ({ components: { PayloadPreview }, setup: () => ({ payload: diagramTemplate('sequence.example')!.build() }), template: '<div style="width:220px;height:160px;border:1px solid var(--border-default);border-radius:var(--radius-2);background:var(--surface-panel)"><PayloadPreview :payload="payload" theme="light" /></div>' }),
};

import { h } from 'vue';
import type { Meta, StoryObj } from '@storybook/vue3-vite';
import { createDocument } from '@/domain';
import BpmnDecorPart from '@/renderer/design-system/molecules/BpmnDecor.vue';
import SequenceDecorPart from '@/renderer/design-system/molecules/SequenceDecor.vue';
import TableContentPart from '@/renderer/design-system/molecules/TableContent.vue';
import ElementView from '@/renderer/design-system/organisms/ElementView.vue';
import { diagramTemplate } from '@/renderer/lib/diagram-libraries';

/**
 * BpmnDecor, SequenceDecor and TableContent draw inside the SVG of an element and are not used on their own.
 * They are shown here the way they appear: through the element view, with elements from the diagram libraries.
 */
const meta = { title: 'Molecules/Canvas parts', subcomponents: { BpmnDecor: BpmnDecorPart, SequenceDecor: SequenceDecorPart, TableContent: TableContentPart }, parameters: { layout: 'padded' } } satisfies Meta;
export default meta;
type Story = StoryObj<typeof meta>;

const picture = (templates: string[], width: number, height: number) => () => {
  const document = createDocument('Story');
  let x = 20;
  const groups = templates.flatMap((id) => {
    const elements = diagramTemplate(id)!.build().elements;
    const left = Math.min(...elements.map((element) => element.x));
    const right = Math.max(...elements.map((element) => element.x + element.width));
    const top = Math.min(...elements.map((element) => element.y));
    const placed = elements.map((element) => ({ ...element, x: element.x - left + x, y: element.y - top + 20 }));
    x += right - left + 40;
    return placed;
  });
  return { setup: () => () => h('svg', { width, height, viewBox: `0 0 ${width} ${height}`, style: 'max-width:100%;height:auto' }, groups.map((element) => h(ElementView, { key: element.id, element, document, theme: 'light', staticPreview: true }))) };
};

/** Event rings and symbols, gateway markers and the data store. */
export const BpmnDecor: Story = { render: picture(['bpmn.example', 'bpmn.gateway-parallel', 'bpmn.data-store'], 900, 130) };
/** Pool and lane titles. */
export const BpmnSwimlanes: Story = { render: picture(['bpmn.pool-lanes'], 820, 330) };
/** Fragment heading with condition and section, and the actor figure. */
export const SequenceDecor: Story = { render: picture(['sequence.alt', 'sequence.actor'], 700, 470) };
/** Table cells with a merged header row. */
export const TableContent: Story = { render: picture(['er.entity'], 320, 220) };

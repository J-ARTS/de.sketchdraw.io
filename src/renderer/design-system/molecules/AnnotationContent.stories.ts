import type { Meta, StoryObj } from '@storybook/vue3-vite';
import type { AnnotationDocument } from '@/domain';
import AnnotationContent from '@/renderer/design-system/molecules/AnnotationContent.vue';

const document: AnnotationDocument = { version: 1, blocks: [
  { type: 'paragraph', runs: [{ text: 'Der Dienst ist ' }, { text: 'zustandslos', bold: true }, { text: ' und skaliert waagerecht.' }] },
  { type: 'bullet', runs: [{ text: 'Sitzungen liegen im Cache' }] },
  { type: 'bullet', runs: [{ text: 'Uploads im Objektspeicher', italic: true }] },
] };
const meta = {
  title: 'Molecules/AnnotationContent',
  component: AnnotationContent,
  args: { document },
  render: (args) => ({ components: { AnnotationContent }, setup: () => ({ args }), template: '<div style="width:320px;font-size:14px"><AnnotationContent v-bind="args" /></div>' }),
} satisfies Meta<typeof AnnotationContent>;
export default meta;
export const RichText: StoryObj<typeof meta> = {};

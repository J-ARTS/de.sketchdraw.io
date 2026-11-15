import { ref } from 'vue';
import type { Meta, StoryObj } from '@storybook/vue3-vite';
import AppSelect from '@/renderer/design-system/molecules/AppSelect.vue';

const options = [{ value: 'svg', label: 'SVG' }, { value: 'png', label: 'PNG' }, { value: 'drawio', label: 'draw.io' }, { value: 'pdf', label: 'PDF (nicht verfügbar)', disabled: true }];
const meta = {
  title: 'Molecules/AppSelect',
  component: AppSelect,
  args: { label: 'Format', modelValue: 'svg', options },
  render: (args) => ({ components: { AppSelect }, setup: () => { const value = ref(args.modelValue); return { args, value }; }, template: '<div style="width:260px;min-height:220px"><AppSelect v-bind="args" v-model="value" /></div>' }),
} satisfies Meta<typeof AppSelect>;
export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};
export const Placeholder: Story = { args: { modelValue: '', placeholder: 'Format wählen' } };
/** The small form used in the property bars. */
export const Compact: Story = { args: { compact: true } };
/** Free text with suggestions: the value may be something that is not in the list. */
export const Editable: Story = { args: { editable: true, label: 'Zuständig', modelValue: 'Mira', options: [{ value: 'Mira', label: 'Mira' }, { value: 'Jonas', label: 'Jonas' }], maxlength: 120 } };
export const Disabled: Story = { args: { disabled: true } };

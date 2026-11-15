import { ref } from 'vue';
import type { Meta, StoryObj } from '@storybook/vue3-vite';
import AppFieldLabel from '@/renderer/design-system/atoms/AppFieldLabel.vue';
import AppTextField from '@/renderer/design-system/atoms/AppTextField.vue';

const meta = {
  title: 'Atoms/AppTextField',
  component: AppTextField,
  args: { modelValue: 'Zahlungsdienst', type: 'text', invalid: false },
  render: (args) => ({
    components: { AppTextField, AppFieldLabel },
    setup: () => { const value = ref(args.modelValue); return { args, value }; },
    template: '<div style="display:grid;gap:6px;width:280px"><AppFieldLabel for="story-name">Name</AppFieldLabel><AppTextField id="story-name" v-bind="args" v-model="value" /></div>',
  }),
} satisfies Meta<typeof AppTextField>;
export default meta;
type Story = StoryObj<typeof meta>;

export const Filled: Story = {};
export const Empty: Story = { args: { modelValue: '' }, render: (args) => ({ components: { AppTextField }, setup: () => { const value = ref(args.modelValue); return { args, value }; }, template: '<AppTextField v-bind="args" v-model="value" aria-label="Suche" placeholder="Symbole durchsuchen" style="width:280px" />' }) };
/** A value that was not accepted. The message belongs beside the field and is referenced by `aria-describedby`. */
export const Invalid: Story = { args: { modelValue: 'kein-link', invalid: true, type: 'url' } };

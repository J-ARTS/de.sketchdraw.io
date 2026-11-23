import { ref } from 'vue';
import type { Meta, StoryObj } from '@storybook/vue3-vite';
import AppTagField from '@/renderer/design-system/molecules/AppTagField.vue';

const all = ['checkout', 'payments', 'q1', 'q2', 'security', 'storefront'];
const meta = {
  title: 'Molecules/AppTagField',
  component: AppTagField,
  args: { label: 'Labels', modelValue: ['checkout', 'q1'], options: all, placeholder: 'Label suchen oder eingeben' },
  render: (args) => ({
    components: { AppTagField },
    setup: () => { const value = ref([...(args.modelValue as readonly string[])]); const options = ref([...(args.options as readonly string[])]); const search = (text: string) => { options.value = all.filter((entry) => entry.includes(text.toLowerCase())); }; return { args, value, options, search }; },
    template: '<div style="width:320px;min-height:260px"><AppTagField v-bind="args" v-model="value" :options="options" @search="search" /></div>',
  }),
} satisfies Meta<typeof AppTagField>;
export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};
export const Empty: Story = { args: { modelValue: [] } };
/** One value at most: a further one replaces it, as for the area path of Azure Boards. */
export const Single: Story = { args: { label: 'Bereich', modelValue: ['Shop\\Checkout'], options: ['Shop', 'Shop\\Checkout', 'Shop\\Katalog'], max: 1 } };
export const Disabled: Story = { args: { disabled: true } };

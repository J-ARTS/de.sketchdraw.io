import type { Meta, StoryObj } from '@storybook/vue3-vite';
import FindReplaceBar from '@/renderer/design-system/molecules/FindReplaceBar.vue';

const meta = {
  title: 'Molecules/FindReplaceBar',
  component: FindReplaceBar,
  args: { query: 'Dienst', replacement: '', matchCase: false, wholeWord: false, regex: false, preserveCase: false, replaceOpen: false, total: 5, current: 1 },
  render: (args) => ({ components: { FindReplaceBar }, setup: () => ({ args }), template: '<div class="sd-panel" style="width:440px;padding:12px"><FindReplaceBar v-bind="args" /></div>' }),
} satisfies Meta<typeof FindReplaceBar>;
export default meta;
type Story = StoryObj<typeof meta>;

/** Searching only: the position among the hits stands in the field, beside the options. */
export const Find: Story = {};
/** Nothing typed yet. */
export const Empty: Story = { args: { query: '', total: 0, current: -1 } };
export const NoMatches: Story = { args: { query: 'Kunde', total: 0, current: -1 } };
/** The second row replaces the current hit or all of them. */
export const Replace: Story = { args: { replaceOpen: true, replacement: 'Server', preserveCase: true } };
export const WithOptions: Story = { args: { matchCase: true, wholeWord: true, replaceOpen: true, replacement: 'Server' } };
/** A regular expression that cannot be read: nothing is searched, and the reason is named. */
export const InvalidExpression: Story = { args: { query: '(\\w+', regex: true, invalid: true, total: 0, current: -1, replaceOpen: true } };
/** After "replace all". */
export const Replaced: Story = { args: { replaceOpen: true, replacement: 'Server', total: 0, current: -1, message: 'Ersetzte Treffer: 5' } };
/** A write-protected field can be searched, but not changed. */
export const ReadOnly: Story = { args: { replaceOpen: true, readonly: true } };
/** More hits than are counted. */
export const VeryManyMatches: Story = { args: { query: 'e', total: 5000, current: 41, capped: true } };

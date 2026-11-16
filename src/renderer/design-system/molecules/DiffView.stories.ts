import type { Meta, StoryObj } from '@storybook/vue3-vite';
import type { GitFileDiff } from '@/domain';
import DiffView from '@/renderer/design-system/molecules/DiffView.vue';

const diff: GitFileDiff = { path: 'checkout.sketchdraw', binary: false, truncated: false, lines: [
  { kind: 'hunk', text: '@@ -12,5 +12,6 @@ page "Checkout"' },
  { kind: 'context', text: '  rect shop "Shop" at 120,80 size 160x64', oldLine: 12, newLine: 12 },
  { kind: 'removed', text: '  rect pay "Zahlung" at 360,80 size 160x64', oldLine: 13 },
  { kind: 'added', text: '  rect pay "Zahlungsdienst" at 360,80 size 180x64', newLine: 13 },
  { kind: 'added', text: '  cylinder ledger "Buchungen" at 620,72 size 120x80', newLine: 14 },
  { kind: 'context', text: '  arrow shop -> pay "bezahlen"', oldLine: 14, newLine: 15 },
  { kind: 'context', text: '  arrow pay -> shop "Ergebnis" dashed', oldLine: 15, newLine: 16 },
] };
const meta = {
  title: 'Molecules/DiffView',
  component: DiffView,
  args: { diff, label: 'Änderungen an checkout.sketchdraw' },
  render: (args) => ({ components: { DiffView }, setup: () => ({ args }), template: '<div style="width:640px;height:260px;display:grid"><DiffView v-bind="args" /></div>' }),
} satisfies Meta<typeof DiffView>;
export default meta;
type Story = StoryObj<typeof meta>;

export const Changes: Story = {};
export const NothingChosen: Story = { args: { diff: null } };
export const Binary: Story = { args: { diff: { path: 'logo.png', binary: true, truncated: false, lines: [] }, label: 'Änderungen an logo.png' } };
export const Truncated: Story = { args: { diff: { ...diff, truncated: true } } };

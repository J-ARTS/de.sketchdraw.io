import type { Meta, StoryObj } from '@storybook/vue3-vite';
import WorkspaceLayout from '@/renderer/design-system/templates/WorkspaceLayout.vue';

const meta = {
  title: 'Templates/WorkspaceLayout',
  component: WorkspaceLayout,
  parameters: { layout: 'fullscreen' },
  args: { label: 'Arbeitsbereich', inert: false, feedbackHeight: 0 },
  render: (args) => ({
    components: { WorkspaceLayout },
    setup: () => ({ args }),
    template: `<div style="position:relative;height:520px"><WorkspaceLayout v-bind="args">
      <div style="position:absolute;inset:0;display:grid;place-items:center;color:var(--text-muted);background:var(--surface-canvas)">Inhalt: Zeichenfläche, Leisten, Panels</div>
      <div class="sd-panel" style="position:absolute;top:12px;left:12px;height:var(--chrome-height);display:flex;align-items:center;padding:0 16px">Leiste</div>
      <template #overlays><div class="sd-panel" style="position:absolute;right:12px;bottom:12px;padding:8px 16px">Overlay: bleibt bedienbar</div></template>
    </WorkspaceLayout></div>`,
  }),
} satisfies Meta<typeof WorkspaceLayout>;
export default meta;
type Story = StoryObj<typeof meta>;

/** The two regions of the frame, filled with placeholders. */
export const Regions: Story = {};
/** While a transition runs the content is blocked; the overlays stay usable. */
export const ContentBlocked: Story = { args: { inert: true } };

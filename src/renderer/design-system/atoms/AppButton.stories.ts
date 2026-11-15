import type { Meta, StoryObj } from '@storybook/vue3-vite';
import AppButton from '@/renderer/design-system/atoms/AppButton.vue';
import AppIcon from '@/renderer/design-system/atoms/AppIcon.vue';

const meta = {
  title: 'Atoms/AppButton',
  component: AppButton,
  argTypes: { intent: { control: 'inline-radio', options: ['neutral', 'primary', 'danger'] } },
  render: (args) => ({ components: { AppButton }, setup: () => ({ args }), template: '<AppButton v-bind="args">Speichern</AppButton>' }),
} satisfies Meta<typeof AppButton>;
export default meta;
type Story = StoryObj<typeof meta>;

export const Neutral: Story = { args: { intent: 'neutral' } };
export const Primary: Story = { args: { intent: 'primary' } };
export const Danger: Story = { args: { intent: 'danger' }, render: (args) => ({ components: { AppButton }, setup: () => ({ args }), template: '<AppButton v-bind="args">Löschen</AppButton>' }) };
export const Disabled: Story = { render: () => ({ components: { AppButton }, template: '<AppButton disabled>Nicht verfügbar</AppButton>' }) };
/** A symbol before the text; the text stays the name of the action. */
export const WithIcon: Story = { render: () => ({ components: { AppButton, AppIcon }, template: '<AppButton intent="primary"><AppIcon name="plus" :size="16" />Seite hinzufügen</AppButton>' }) };
/** The usual end of a dialog: the main action last. */
export const DialogActions: Story = { render: () => ({ components: { AppButton }, template: '<div style="display:flex;gap:8px"><AppButton>Abbrechen</AppButton><AppButton intent="primary" type="submit">Änderungen speichern</AppButton></div>' }) };

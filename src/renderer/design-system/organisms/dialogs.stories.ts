import type { Meta, StoryObj } from '@storybook/vue3-vite';
import AppDialog from '@/renderer/design-system/organisms/AppDialog.vue';
import ConfluencePageLinkDialog from '@/renderer/design-system/organisms/ConfluencePageLinkDialog.vue';
import ProfileDialog from '@/renderer/design-system/organisms/ProfileDialog.vue';
import SettingsDialog from '@/renderer/design-system/organisms/SettingsDialog.vue';
import { withWhiteboard } from '@/renderer/design-system/storybook/with-whiteboard';

/**
 * Modal dialogs. Help, unsaved changes and save conflicts share `AppDialog`; a new case of that kind extends
 * it. Settings, profiles, web embeds and resource cards have dialogs of their own.
 */
const meta = { title: 'Organisms/Dialogs', parameters: { layout: 'fullscreen', docs: { story: { inline: false, iframeHeight: 620 } } } } satisfies Meta;
export default meta;
type Story = StoryObj<typeof meta>;

export const Help: Story = { name: 'AppDialog (Hilfe)', decorators: [withWhiteboard((store) => store.openHelp())], render: () => ({ components: { AppDialog }, template: '<AppDialog />' }) };
export const Settings: Story = { name: 'SettingsDialog', decorators: [withWhiteboard()], render: () => ({ components: { SettingsDialog }, template: '<SettingsDialog open />' }) };
export const Profiles: Story = { name: 'ProfileDialog', decorators: [withWhiteboard()], render: () => ({ components: { ProfileDialog }, template: '<ProfileDialog open />' }) };
/** Opened from the menu of a page. Without the desktop app and an active Confluence plugin it says what is missing; the linked state is in `Molecules/ConfluenceLinkCard`. */
export const ConfluencePageLink: Story = { name: 'ConfluencePageLinkDialog', decorators: [withWhiteboard((store) => store.openConfluencePageLink(store.state.pages[0]!.id))], render: () => ({ components: { ConfluencePageLinkDialog }, template: '<ConfluencePageLinkDialog />' }) };

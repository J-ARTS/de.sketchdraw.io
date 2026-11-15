/**
 * The Sketchdraw design system: every UI component of the renderer, ordered by Atomic Design.
 *
 * - atoms: the smallest parts, built from nothing but HTML and tokens (a button, a symbol, a text field)
 * - molecules: a few atoms that do one thing together (a select, a colour picker)
 * - organisms: self-contained sections of the interface (a toolbar, a dialog, the canvas)
 * - templates: arrangements of organisms without content of their own
 * - pages: a template filled with the real application state
 *
 * A level only uses the levels before it. Import from here or from the file of the component; add new
 * components to the level they belong to and to this list (a test checks that the list is complete).
 */

// atoms
export { default as AppButton } from './atoms/AppButton.vue';
export { default as AppFieldLabel } from './atoms/AppFieldLabel.vue';
export { default as AppIcon } from './atoms/AppIcon.vue';
export { default as AppIconButton } from './atoms/AppIconButton.vue';
export { default as AppKbd } from './atoms/AppKbd.vue';
export { default as AppTextField } from './atoms/AppTextField.vue';
export { default as AppTextarea } from './atoms/AppTextarea.vue';
export { default as ConnectorMarkerIcon } from './atoms/ConnectorMarkerIcon.vue';

// molecules
export { default as AnnotationContent } from './molecules/AnnotationContent.vue';
export { default as AppDatePicker } from './molecules/AppDatePicker.vue';
export { default as AppSelect } from './molecules/AppSelect.vue';
export { default as BpmnDecor } from './molecules/BpmnDecor.vue';
export { default as ColorPalette } from './molecules/ColorPalette.vue';
export { default as ColorPicker } from './molecules/ColorPicker.vue';
export { default as ImageFileInput } from './molecules/ImageFileInput.vue';
export { default as SequenceDecor } from './molecules/SequenceDecor.vue';
export { default as TableContent } from './molecules/TableContent.vue';
export { default as TaskCard } from './molecules/TaskCard.vue';

// organisms
export { default as AnnotationEditor } from './organisms/AnnotationEditor.vue';
export { default as AppDialog } from './organisms/AppDialog.vue';
export { default as CollaborationPanel } from './organisms/CollaborationPanel.vue';
export { default as CommentSidebar } from './organisms/CommentSidebar.vue';
export { default as CommentsLayer } from './organisms/CommentsLayer.vue';
export { default as ConnectorOptionsBar } from './organisms/ConnectorOptionsBar.vue';
export { default as CustomComponentsTab } from './organisms/CustomComponentsTab.vue';
export { default as DiagramCodePanel } from './organisms/DiagramCodePanel.vue';
export { default as DiagramLibraryView } from './organisms/DiagramLibraryView.vue';
export { default as ElementView } from './organisms/ElementView.vue';
export { default as FramePreview } from './organisms/FramePreview.vue';
export { default as FrameSidebar } from './organisms/FrameSidebar.vue';
export { default as HdhtSession } from './organisms/HdhtSession.vue';
export { default as InteropPanel } from './organisms/InteropPanel.vue';
export { default as LaserPointerOverlay } from './organisms/LaserPointerOverlay.vue';
export { default as MainMenu } from './organisms/MainMenu.vue';
export { default as Minimap } from './organisms/Minimap.vue';
export { default as PageSwitcher } from './organisms/PageSwitcher.vue';
export { default as PayloadPreview } from './organisms/PayloadPreview.vue';
export { default as PluginSettings } from './organisms/PluginSettings.vue';
export { default as PresenterMode } from './organisms/PresenterMode.vue';
export { default as ProfileDialog } from './organisms/ProfileDialog.vue';
export { default as QuickConnect } from './organisms/QuickConnect.vue';
export { default as ResourceCardEditor } from './organisms/ResourceCardEditor.vue';
export { default as SelectionToolbar } from './organisms/SelectionToolbar.vue';
export { default as SettingsDialog } from './organisms/SettingsDialog.vue';
export { default as ShapeLibraryPanel } from './organisms/ShapeLibraryPanel.vue';
export { default as TableOverlay } from './organisms/TableOverlay.vue';
export { default as TaskBoard } from './organisms/TaskBoard.vue';
export { default as ToolOptionsBar } from './organisms/ToolOptionsBar.vue';
export { default as Toolbar } from './organisms/Toolbar.vue';
export { default as WebEmbedDialog } from './organisms/WebEmbedDialog.vue';
export { default as WhiteboardCanvas } from './organisms/WhiteboardCanvas.vue';

// templates
export { default as WorkspaceLayout } from './templates/WorkspaceLayout.vue';
export { default as WorkspacePanels } from './templates/WorkspacePanels.vue';

// pages
export { default as WorkspacePage } from './pages/WorkspacePage.vue';

// what the components share
export { buttonVariants, type ButtonIntent, type ButtonVariants } from './atoms/button.variants';
export { ICON_PATHS, type IconName } from './atoms/icons';
export { useWhiteboard } from './composables/use-whiteboard';
export { useAnchoredPopover } from './composables/use-anchored-popover';
export { useHorizontalOverflow } from './composables/use-horizontal-overflow';

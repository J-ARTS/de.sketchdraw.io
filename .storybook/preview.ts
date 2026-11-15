import type { Preview } from '@storybook/vue3-vite';
import '../src/renderer/styles/fonts.css';
import '../src/renderer/styles/tokens.css';
import '../src/renderer/styles/base.css';

/** Every story is shown in the theme chosen in the toolbar, the same way the app switches it. */
const preview: Preview = {
  globalTypes: {
    theme: { description: 'Theme of the app', toolbar: { title: 'Theme', icon: 'mirror', items: [{ value: 'light', title: 'Light' }, { value: 'dark', title: 'Dark' }], dynamicTitle: true } },
  },
  initialGlobals: { theme: 'light' },
  decorators: [
    (story, context) => {
      document.documentElement.dataset.theme = String(context.globals.theme ?? 'light');
      document.body.style.background = 'var(--surface-canvas)';
      document.body.style.color = 'var(--text-primary)';
      return { components: { story }, template: '<story />' };
    },
  ],
  parameters: {
    layout: 'centered',
    controls: { expanded: true },
    options: { storySort: { order: ['Atoms', 'Molecules', 'Organisms', 'Templates', 'Pages'] } },
    a11y: { test: 'todo' },
  },
  tags: ['autodocs'],
};
export default preview;

import type { StorybookConfig } from '@storybook/vue3-vite';

/** The catalogue of the design system: every story beside its component in src/renderer/design-system. */
const config: StorybookConfig = {
  stories: ['../src/renderer/design-system/**/*.stories.ts'],
  addons: ['@storybook/addon-docs', '@storybook/addon-a11y'],
  core: { disableTelemetry: true },
  framework: { name: '@storybook/vue3-vite', options: { docgen: 'vue-component-meta' } },
  // The app pins its dev port; the catalogue runs beside it on a port of its own.
  viteFinal: (viteConfig) => ({ ...viteConfig, server: { ...viteConfig.server, strictPort: false } }),
};
export default config;

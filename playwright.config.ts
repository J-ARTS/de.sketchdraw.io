import { defineConfig, devices } from '@playwright/test';

const isElectronOnly = process.argv.some((arg) => arg === '--project=electron');

export default defineConfig({
  fullyParallel: false,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 1 : 0,
  workers: 1,
  reporter: process.env.CI ? [['list'], ['html', { open: 'never' }]] : 'list',
  use: {
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  projects: [
    {
      name: 'ui',
      testDir: './tests/ui',
      testMatch: /.*\.(test|spec)\.ts$/,
      use: {
        ...devices['Desktop Chrome'],
        baseURL: 'http://127.0.0.1:5173',
        viewport: { width: 1280, height: 800 },
      },
    },
    {
      name: 'electron',
      testDir: './tests/electron',
      testMatch: /.*\.(test|spec)\.ts$/,
    },
  ],
  webServer: isElectronOnly
    ? undefined
    : {
        command: 'npm run dev:browser',
        url: 'http://127.0.0.1:5173',
        reuseExistingServer: !process.env.CI,
        timeout: 30_000,
      },
});

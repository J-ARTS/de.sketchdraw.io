import { fileURLToPath } from 'node:url';
import { defineConfig } from '@playwright/test';
export default defineConfig({
  testDir: '.', testMatch: /native\.spec\.ts$/, timeout: 70000, workers: 1, retries: 0,
  outputDir: '../../test-results/p2p', reporter: 'list',
  use: { baseURL: 'http://127.0.0.1:5184', headless: true },
  webServer: { cwd: fileURLToPath(new URL('../../', import.meta.url)), command: 'npx vite --host 127.0.0.1 --port 5184 --strictPort',
    url: 'http://127.0.0.1:5184/tests/p2p/fixture.html', reuseExistingServer: false, timeout: 30000 },
});

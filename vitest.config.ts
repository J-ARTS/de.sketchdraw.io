import { fileURLToPath, URL } from 'node:url';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  test: {
    name: 'unit',
    environment: 'node',
    include: ['tests/unit/**/*.test.ts', 'tests/unit/**/*.spec.ts'],
    exclude: [
      'tests/ui/**',
      'tests/electron/**',
      'node_modules/**',
      'dist/**',
      'dist-electron/**',
      'release/**',
    ],
    // Trystero must go through Vite so tests can replace its MQTT client (tests/unit/collaboration/automatic-signaling.spec.ts).
    server: { deps: { inline: [/@trystero-p2p\//] } },
    passWithNoTests: false,
    clearMocks: true,
    restoreMocks: true,
  },
});

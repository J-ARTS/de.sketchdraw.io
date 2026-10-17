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
    passWithNoTests: false,
    clearMocks: true,
    restoreMocks: true,
  },
});

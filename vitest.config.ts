import { defineConfig } from 'vitest/config';
import path from 'path';

export default defineConfig({
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
    coverage: {
      provider: 'v8',
      // Only the logic worth asserting on. UI components and the sync pipeline
      // are excluded deliberately — they need integration tests, not units.
      include: ['src/utils/**', 'src/services/dataProcessor.ts'],
      reporter: ['text', 'html'],
    },
  },
});

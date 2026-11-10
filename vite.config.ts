import { defineConfig } from 'vite';

export default defineConfig({
  base: './',
  test: { environment: 'node', testTimeout: 60000 },
} as any);

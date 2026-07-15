import { defineConfig } from 'vitest/config';
import { resolve } from 'path';

export default defineConfig({
  resolve: {
    alias: { '@': resolve(__dirname, 'src') },
  },
  test: {
    environment: 'node',
    globals: false,
    include: ['src/**/*.test.ts', 'tests/unit/**/*.test.ts'],
  },
});

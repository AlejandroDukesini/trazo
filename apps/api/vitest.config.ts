import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    env: process.loadEnvFile ? (() => { try { process.loadEnvFile('.env'); } catch { /* sin .env */ } return {}; })() : {},
    testTimeout: 30_000,
    hookTimeout: 60_000,
    fileParallelism: false,
  },
});

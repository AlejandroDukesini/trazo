import { defineConfig, devices } from '@playwright/test';
import { readFileSync } from 'node:fs';

// La API de pruebas usa una base de datos dedicada (trazo_e2e) derivada de apps/api/.env.
function e2eDatabaseUrl() {
  if (process.env.E2E_DATABASE_URL) return process.env.E2E_DATABASE_URL;
  const env = readFileSync(new URL('../api/.env', import.meta.url), 'utf8');
  const url = /^DATABASE_URL=(.+)$/m.exec(env)?.[1]?.trim();
  if (!url) throw new Error('Define E2E_DATABASE_URL o DATABASE_URL en apps/api/.env');
  return url.replace(/\/[^/]+$/, '/trazo_e2e');
}

const API_PORT = 3100;
const WEB_PORT = 4173;

export default defineConfig({
  testDir: './e2e',
  timeout: 60_000,
  expect: { timeout: 10_000 },
  fullyParallel: false,
  workers: 1,
  reporter: [['list']],
  use: {
    baseURL: `http://127.0.0.1:${WEB_PORT}`,
    channel: process.env.PW_CHANNEL ?? 'msedge',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    locale: 'es-ES',
    timezoneId: 'Europe/Madrid',
  },
  projects: [
    { name: 'desktop', use: { ...devices['Desktop Edge'], viewport: { width: 1440, height: 900 } } },
    { name: 'mobile', use: { ...devices['Pixel 7'], channel: process.env.PW_CHANNEL ?? 'msedge' }, grep: /@mobile/ },
  ],
  webServer: [
    {
      command: 'pnpm --filter @trazo/api exec tsx src/server.ts',
      url: `http://127.0.0.1:${API_PORT}/api/health`,
      reuseExistingServer: false,
      timeout: 60_000,
      env: {
        NODE_ENV: 'development',
        PORT: String(API_PORT),
        DATABASE_URL: e2eDatabaseUrl(),
        APP_URL: `http://127.0.0.1:${WEB_PORT}`,
        CORS_ORIGINS: `http://127.0.0.1:${WEB_PORT}`,
        AUTH_RATE_LIMIT_MAX: '1000',
        RATE_LIMIT_MAX: '5000',
        UPLOAD_DIR: '../../.e2e-uploads',
        PHOTON_URL: 'http://127.0.0.1:9',
      },
    },
    {
      command: `pnpm exec vite preview --port ${WEB_PORT} --host 127.0.0.1 --strictPort`,
      url: `http://127.0.0.1:${WEB_PORT}`,
      reuseExistingServer: false,
      env: { API_PROXY: `http://127.0.0.1:${API_PORT}` },
    },
  ],
});

import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './tests/e2e',
  fullyParallel: false,
  workers: 1,
  retries: process.env.CI ? 1 : 0,
  reporter: [['list'], ['html', { open: 'never' }]],
  use: { baseURL: 'http://localhost:5173', trace: 'retain-on-failure', screenshot: 'only-on-failure', video: 'retain-on-failure' },
  webServer: [
    { command: 'LOG_LEVEL=silent npx tsx tests/e2e/server.ts', url: 'http://localhost:4000/health', reuseExistingServer: false, timeout: 120_000 },
    { command: 'VITE_API_URL=http://localhost:4000 npm run dev -w @campus-market/web -- --host 127.0.0.1', url: 'http://localhost:5173', reuseExistingServer: false, timeout: 120_000 }
  ],
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }]
});

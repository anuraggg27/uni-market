import { defineConfig, devices } from '@playwright/test';

const apiPort = Number(process.env.E2E_API_PORT ?? '4000');
const webPort = Number(process.env.E2E_WEB_PORT ?? '5173');
const apiUrl = `http://127.0.0.1:${apiPort}`;
const webUrl = `http://127.0.0.1:${webPort}`;

export default defineConfig({
  testDir: './tests/e2e',
  fullyParallel: false,
  workers: 1,
  retries: process.env.CI ? 1 : 0,
  reporter: [['list'], ['html', { open: 'never' }]],
  use: { baseURL: webUrl, trace: 'retain-on-failure', screenshot: 'only-on-failure', video: 'retain-on-failure' },
  webServer: [
    {
      command: 'npx tsx tests/e2e/server.ts',
      env: { LOG_LEVEL: 'silent', E2E_API_PORT: String(apiPort), E2E_WEB_PORT: String(webPort) },
      url: `${apiUrl}/health`,
      reuseExistingServer: false,
      timeout: 120_000,
    },
    {
      command: `npm run dev -w @campus-market/web -- --host 127.0.0.1 --port ${webPort}`,
      env: { VITE_API_URL: apiUrl },
      url: `${webUrl}/marketplace/`,
      reuseExistingServer: false,
      timeout: 120_000,
    },
  ],
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }]
});

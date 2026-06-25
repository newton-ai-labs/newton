import { defineConfig, devices } from '@playwright/test'

export default defineConfig({
  testDir: './tests/e2e',
  fullyParallel: false,
  timeout: 30_000,
  expect: {
    timeout: 10_000,
  },
  reporter: 'list',
  use: {
    baseURL: 'http://localhost:5273',
    trace: 'on-first-retry',
    ...devices['Desktop Chrome'],
  },
  webServer: {
    command: 'NEWTON_CLIENT_PORT=5273 NEWTON_PORT=5274 npm run dev',
    url: 'http://localhost:5273/api/health',
    reuseExistingServer: false,
    timeout: 120_000,
  },
})

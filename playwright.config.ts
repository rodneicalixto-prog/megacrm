import { defineConfig, devices } from '@playwright/test';

// Wizard-only E2E harness. Boots the app via vite.config.test.ts (offline /api
// shim) and drives ONLY the /setup wizard. No post-login features are touched.
const PORT = 4317;
const BASE_URL = `http://localhost:${PORT}`;

export default defineConfig({
  testDir: './tests/specs',
  outputDir: './tests/.artifacts/output',
  fullyParallel: false,
  workers: 1,
  // GitHub runners occasionally lose a navigation while Vite is warming up.
  // Retry once only in CI; local runs remain strict and expose deterministic
  // regressions immediately.
  retries: process.env.CI ? 1 : 0,
  reporter: [
    ['list'],
    ['json', { outputFile: './tests/.artifacts/results.json' }],
    ['html', { outputFolder: './tests/.artifacts/html', open: 'never' }],
  ],
  timeout: 30_000,
  expect: { timeout: 7_000 },
  use: {
    baseURL: BASE_URL,
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
    video: 'off',
  },
  projects: [
    { name: 'desktop', use: { ...devices['Desktop Chrome'], viewport: { width: 1280, height: 900 } } },
  ],
  webServer: {
    command: 'npx vite --config vite.config.test.ts',
    url: BASE_URL,
    reuseExistingServer: true,
    timeout: 60_000,
  },
});

// playwright.config.js
// @ts-check
const { defineConfig, devices } = require('@playwright/test');

module.exports = defineConfig({
  testDir: './e2e',
  timeout: 60000,
  expect: {
    timeout: 10000,
  },
  fullyParallel: false,
  workers: 1, // Sequential execution for stateful E2E scenarios
  retries: 0,
  reporter: [
    ['list'],
    ['html', { outputFolder: 'playwright-report', open: 'never' }]
  ],
  use: {
    baseURL: 'http://127.0.0.1:8435',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
    actionTimeout: 10000,
    navigationTimeout: 20000,
  },
  projects: [
    {
      name: 'chromium',
      use: { 
        ...devices['Desktop Chrome'],
        viewport: { width: 1400, height: 900 }
      },
    },
  ],
  webServer: {
    command: 'powershell -ExecutionPolicy Bypass -Command "$env:OMNIBANK_DATA_DIR=\'./data/e2e_test_data\'; $env:PYTHONPATH=\'.\'; .\\venv\\Scripts\\python.exe -m uvicorn app.main:app --host 127.0.0.1 --port 8435"',
    url: 'http://127.0.0.1:8435/api/health',
    reuseExistingServer: true,
    timeout: 30000,
  },
});

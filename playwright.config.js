// End-to-end tests run in Playwright's own Chrome for Testing build, never the everyday
// Chrome app. The backend is faked in tests/e2e/fake-backend.js from the ops-api contract.
const { defineConfig } = require('@playwright/test');

module.exports = defineConfig({
  testDir: 'tests/e2e',
  timeout: 60000,
  fullyParallel: false,
  workers: 1,
  reporter: [['list']],
  use: {
    baseURL: 'http://localhost:4517',
    browserName: 'chromium',
    hasTouch: true,
    screenshot: 'only-on-failure'
  },
  projects: [
    { name: 'ipad-landscape', use: { viewport: { width: 1180, height: 820 } } },
    { name: 'ipad-portrait', use: { viewport: { width: 820, height: 1180 } } }
  ],
  webServer: { command: 'node tests/serve.js', port: 4517, reuseExistingServer: true }
});

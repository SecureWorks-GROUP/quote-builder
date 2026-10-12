// End-to-end tests run in Playwright's own Chrome for Testing build, never the everyday
// Chrome app. The backend is faked in tests/e2e/fake-backend.js from the ops-api contract.
// The tests start their own server and never reuse one already on the port: it may be
// another checkout's code. Set PORT when 4517 is taken.
const { defineConfig } = require('@playwright/test');
const port = Number(process.env.PORT || 4517);

module.exports = defineConfig({
  testDir: 'tests/e2e',
  timeout: 60000,
  fullyParallel: false,
  workers: 1,
  reporter: [['list']],
  use: {
    baseURL: 'http://localhost:' + port,
    browserName: 'chromium',
    hasTouch: true,
    screenshot: 'only-on-failure'
  },
  projects: [
    { name: 'ipad-landscape', use: { viewport: { width: 1180, height: 820 } } },
    { name: 'ipad-portrait', use: { viewport: { width: 820, height: 1180 } } }
  ],
  webServer: { command: 'node tests/serve.js', port: port, reuseExistingServer: false }
});

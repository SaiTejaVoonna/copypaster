// @ts-check
const { defineConfig, devices } = require("@playwright/test");

const PORT = 8790;

module.exports = defineConfig({
  testDir: "tests",
  timeout: 30000,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [["list"], ["html", { open: "never" }]] : "list",
  use: {
    baseURL: "http://localhost:" + PORT + "/",
    trace: "retain-on-failure",
    // Code colors load from a CDN; tests must not depend on the network.
    serviceWorkers: "block",
  },
  projects: [
    {
      name: "desktop",
      testIgnore: /\.phone\.spec\.js$/,
      use: { ...devices["Desktop Chrome"], viewport: { width: 1280, height: 860 } },
    },
    {
      name: "phone",
      testMatch: /\.phone\.spec\.js$/,
      use: { ...devices["Desktop Chrome"], viewport: { width: 390, height: 664 }, hasTouch: true, isMobile: true },
    },
  ],
  webServer: {
    command: "node tests/server.js",
    port: PORT,
    reuseExistingServer: !process.env.CI,
  },
});

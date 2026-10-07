import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./tests",
  timeout: 4 * 60 * 60 * 1000,
  expect: { timeout: 15_000 },
  fullyParallel: true,
  workers: 4,
  globalSetup: "./global-setup.ts",
  globalTeardown: "./global-teardown.ts",
  retries: 0,
  forbidOnly: false,
  reporter: [
    ["list"],
    ["html", { outputFolder: "test-results/playwright-report", open: "never" }],
  ],
  outputDir: "test-results/artifacts",
  use: {
    headless: true,
    viewport: { width: 1440, height: 900 },
    deviceScaleFactor: 1,
    actionTimeout: 20_000,
    navigationTimeout: 60_000,
    screenshot: "only-on-failure",
    trace: "off",
    video: "off",
    ignoreHTTPSErrors: true,
  },
});

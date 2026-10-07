import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./tests",
  testMatch: "game-launcher.regression.spec.ts",
  timeout: 6 * 60 * 1000,
  expect: { timeout: 15_000 },
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: [
    ["list"],
    ["html", { outputFolder: "test-results/playwright-report", open: "never" }],
  ],
  outputDir: "test-results/chaos/artifacts",
  use: {
    headless: true,
    viewport: { width: 1440, height: 900 },
    actionTimeout: 20_000,
    navigationTimeout: 60_000,
    screenshot: "off",
    trace: "off",
    video: "off",
    ignoreHTTPSErrors: true,
  },
});

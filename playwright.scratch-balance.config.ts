import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./scratch-tests",
  testMatch: "scratch-balance.spec.ts",
  globalSetup: "./live-global-setup.ts",
  timeout: 18 * 60 * 1000,
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: [["list"]],
  outputDir: "test-results/scratch-balance-artifacts",
  use: {
    headless: true,
    viewport: { width: 1440, height: 900 },
    actionTimeout: 20_000,
    navigationTimeout: 60_000,
    trace: "off",
    video: "off",
  },
});

import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./tests",
  testMatch: "balance-validation.spec.ts",
  globalSetup: "./src/balance/globalSetup.ts",
  timeout: 16 * 60 * 1000,
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: [["list"]],
  outputDir: "test-results/balance-artifacts",
  use: {
    headless: false,
    viewport: { width: 1440, height: 900 },
    actionTimeout: 20_000,
    navigationTimeout: 60_000,
    trace: "off",
    video: "off",
  },
});

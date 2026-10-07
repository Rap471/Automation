import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./scratch-tests",
  testMatch: "scratch-game.spec.ts",
  globalSetup: "./scratch-global-setup.ts",
  globalTeardown: "./scratch-global-teardown.ts",
  timeout: 6 * 60 * 1000,
  fullyParallel: true,
  workers: 4,
  retries: 0,
  reporter: [["list"]],
  outputDir: "test-results/scratch-artifacts",
  use: {
    headless: false,
    viewport: { width: 1440, height: 900 },
    actionTimeout: 20_000,
    navigationTimeout: 60_000,
    trace: "off",
    video: "off",
  },
});

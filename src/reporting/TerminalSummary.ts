import type { ReportModel } from "../types";
import { summarize } from "./stats";

export function formatTerminalSummary(model: ReportModel): string {
  const stats = summarize(model);
  const pad = (value: number) => String(value).padStart(3, " ");
  return [
    "====================================================",
    "DIJOKER GAME REGRESSION COMPLETE",
    "====================================================",
    "",
    `Games Discovered:    ${pad(stats.discovered)}`,
    `Games Tested:        ${pad(stats.tested)}`,
    `Passed:              ${pad(stats.passed)}`,
    `Failed:              ${pad(stats.failed)}`,
    `Blocked:             ${pad(stats.blocked)}`,
    "",
    `Total Spins:        ${pad(stats.spins)}`,
    `Total Wins:          ${pad(stats.wins)}`,
    "",
    `FE/BE Comparisons: ${pad(stats.comparisons)}`,
    `FE/BE Mismatches:    ${pad(stats.mismatchSpins)}`,
    "",
    `Console Errors:      ${pad(stats.consoleErrors)}`,
    `Network Errors:      ${pad(stats.networkErrors)}`,
    "",
    "Dashboard:",
    "test-results/index.html",
    "",
    "Fail and blocked record:",
    "test-results/review.txt",
    "",
    "Playwright Report:",
    "test-results/playwright-report/",
    "",
    "Excel:",
    "test-results/Game-Regression-Summary.xlsx",
    "",
    "====================================================",
  ].join("\n");
}

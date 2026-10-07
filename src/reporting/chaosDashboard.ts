import { regressionConfig } from "../config/regression.config";
import type { CapturedError, CheckStatus, GameResult, ReportModel, SpinValidation } from "../types";

export interface ChaosDashboardCase {
  scenario: string;
  technique: string;
  game: string;
  playerId: string;
  preconditions: string;
  steps: string[];
  expected: string;
  actual: string;
  severity: string;
  status: "PASS" | "FAIL" | "BLOCKED" | "NOT APPLICABLE";
  bet?: number;
  balanceAfter?: number;
  frontend: unknown;
  backend: unknown;
  consoleErrors: string[];
  networkErrors: string[];
  screenshot?: string;
  recommendedFix: string;
}

function redactText(value: string): string {
  return value
    .replace(/access_token=[^&\s'")]+/gi, "access_token=[redacted]")
    .replace(/eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/g, "[redacted-jwt]");
}

function chaosDetails(item: ChaosDashboardCase): string {
  const steps = item.steps.map((step, index) => `${index + 1}. ${step}`).join("\n");
  return [
    "[[stg]]",
    `How staging was manipulated: ${item.technique}`,
    `Preconditions: ${item.preconditions}`,
    steps,
    "[[/stg]]",
    `${item.severity}. ${item.actual}`,
    `Expected: ${item.expected}`,
    `Fix: ${item.recommendedFix}`,
  ].join("\n");
}

function dashboardStatus(status: ChaosDashboardCase["status"]): CheckStatus {
  if (status === "FAIL") return "FAIL";
  if (status === "BLOCKED") return "BLOCKED";
  if (status === "NOT APPLICABLE") return "NOT APPLICABLE";
  return "PASS";
}

function dashboardError(gameName: string, spinNumber: number, type: string, message: string): CapturedError {
  return { gameName, timestamp: new Date().toISOString(), type, message: redactText(message), spinNumber };
}

function numberOrUndefined(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function dashboardSpin(item: ChaosDashboardCase, gameName: string, spinNumber: number): SpinValidation {
  const frontend = item.frontend && typeof item.frontend === "object" ? item.frontend as Record<string, unknown> : {};
  const rows = Array.isArray(item.backend) ? item.backend : [];
  const backend = rows.find((row) => row && typeof row === "object") as Record<string, unknown> | undefined;
  const response = backend?.response && typeof backend.response === "object" ? backend.response as Record<string, unknown> : undefined;
  const slot = response?.slot && typeof response.slot === "object" ? response.slot as Record<string, unknown> : undefined;
  const totalWin = numberOrUndefined(backend?.totalWin) ?? numberOrUndefined(slot?.totalWin) ?? numberOrUndefined(response?.totalWin);
  const backendBalance = numberOrUndefined(backend?.balanceAfter) ?? numberOrUndefined(response?.balance);
  const frontendBalance = numberOrUndefined(frontend.balance) ?? item.balanceAfter;
  const frontendWin = numberOrUndefined(frontend.winDisplay);
  const balanceMismatch = item.status === "FAIL" && /balance|win|disagree/i.test(item.actual);
  const mismatches = balanceMismatch
    ? [{ field: "balance", frontend: frontendBalance ?? null, backend: backendBalance ?? null, difference: item.actual }]
    : [];
  const compared = backendBalance != null && frontendBalance != null;
  return {
    gameName,
    spinNumber,
    trigger: item.scenario,
    frontend: {
      bet: numberOrUndefined(frontend.bet) ?? item.bet,
      balance: frontendBalance,
      totalWin: frontendWin,
      feature: typeof frontend.feature === "string" ? frontend.feature : undefined,
      freeSpins: numberOrUndefined(frontend.freeSpins),
      multiplier: numberOrUndefined(frontend.multiplier),
    },
    backend: {
      bet: numberOrUndefined(backend?.betSize) ?? item.bet,
      balance: backendBalance,
      totalWin,
      feature: typeof response?.transactionState === "string" ? response.transactionState : undefined,
    },
    comparisons: [
      {
        field: "balance",
        frontend: frontendBalance ?? null,
        backend: backendBalance ?? null,
        result: balanceMismatch ? "MISMATCH" : compared ? "MATCH" : "NOT COMPARED",
      },
      {
        field: "totalWin",
        frontend: frontendWin ?? null,
        backend: totalWin ?? null,
        result: frontendWin != null && totalWin != null ? (frontendWin === totalWin ? "MATCH" : "MISMATCH") : "NOT COMPARED",
      },
    ],
    mismatches,
    passed: item.status !== "FAIL",
    sampled: Boolean(backend),
    correlation: balanceMismatch ? "FAIL" : backend ? "PASS" : "NOT SAMPLED",
    network: backend ? {
      spinId: `${gameName}-${spinNumber}`,
      gameName,
      timestamp: new Date().toISOString(),
      requestPayload: backend.request,
      responseBody: backend.response,
      status: numberOrUndefined(backend.status) ?? 0,
      betSize: numberOrUndefined(backend.betSize),
      balanceAfter: backendBalance,
      totalWin,
    } : undefined,
    sawSpinning: Boolean(backend),
    returnedToIdle: item.status !== "FAIL",
    duplicateRequests: 0,
    notes: [item.actual, `Expected: ${item.expected}`, `Fix: ${item.recommendedFix}`],
    screenshot: item.screenshot,
    failureScreenshot: item.status === "FAIL" ? item.screenshot : undefined,
    win: (totalWin ?? 0) > 0,
  };
}

export function chaosDashboardModel(cases: ChaosDashboardCase[]): ReportModel {
  const groups = new Map<string, ChaosDashboardCase[]>();
  for (const item of cases) {
    const gameName = (item.game.split(" via ")[0] || "launcher").trim();
    const list = groups.get(gameName) ?? [];
    list.push(item);
    groups.set(gameName, list);
  }
  const games: GameResult[] = [...groups.entries()].map(([gameName, items], index) => {
    const gameId = gameName.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "launcher";
    const checks = items.map((item, spinIndex) => ({
      id: `chaos-${index + 1}-${spinIndex + 1}`,
      name: item.scenario,
      status: dashboardStatus(item.status),
      details: chaosDetails(item),
      spinNumber: spinIndex + 1,
      gameName,
    }));
    const spins = items.map((item, spinIndex) => dashboardSpin(item, gameName, spinIndex + 1));
    const failed = checks.some((check) => check.status === "FAIL");
    const blocked = checks.length > 0 && checks.every((check) => check.status === "BLOCKED");
    const result: GameResult["result"] = failed ? "FAIL" : blocked ? "BLOCKED" : "PASS";
    return {
      gameName,
      gameId,
      index,
      launch: blocked ? "BLOCKED" : "PASS",
      result,
      spinCount: spins.filter((spin) => spin.sampled).length,
      winCount: spins.filter((spin) => spin.win).length,
      checks,
      spins,
      consoleErrors: items.flatMap((item, spinIndex) => item.consoleErrors.map((message) => dashboardError(gameName, spinIndex + 1, "Console Error", message))),
      networkErrors: items.flatMap((item, spinIndex) => item.networkErrors.map((message) => dashboardError(gameName, spinIndex + 1, "Failed Request", message))),
      feBeMismatches: spins.filter((spin) => spin.mismatches.length > 0).length,
      notes: items.map((item) => `${item.scenario}: ${item.actual}`),
      critical: items
        .filter((item) => item.status === "FAIL" && (item.severity === "Critical" || item.severity === "High"))
        .map((item) => `${item.severity}: ${gameName} - ${item.scenario} - ${item.actual}`),
      reviewShot: items.find((item) => item.screenshot)?.screenshot,
    };
  });
  return {
    generatedAt: new Date().toISOString(),
    playerId: [...new Set(cases.map((item) => item.playerId))].join(", ") || regressionConfig.playerId,
    launcherUrl: regressionConfig.launcherUrl,
    config: { suite: "chaos", games: games.map((game) => game.gameName) },
    discovered: games.map((game) => ({ gameName: game.gameName, gameId: game.gameId, index: game.index, locatorDescription: "chaos suite" })),
    games,
    attempted: games.length,
    completed: games.filter((game) => game.launch === "PASS").length,
  };
}

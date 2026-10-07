import type { GameResult, ReportModel, SpinValidation } from "../types";

export interface ReportStats {
  discovered: number;
  tested: number;
  passed: number;
  failed: number;
  blocked: number;
  completed: number;
  spins: number;
  wins: number;
  comparisons: number;
  mismatchSpins: number;
  fieldMismatches: number;
  fieldBreakdown: Array<{ field: string; count: number }>;
  consoleErrors: number;
  networkErrors: number;
  checksPassed: number;
  checksFailed: number;
  checksSkipped: number;
  checksNotApplicable: number;
  checksBlocked: number;
  critical: string[];
  matchRate: number;
}

export function collectSpins(model: ReportModel): SpinValidation[] {
  return model.games.flatMap((game) => game.spins);
}

export function summarize(model: ReportModel): ReportStats {
  const spins = collectSpins(model);
  const sampled = spins.filter((spin) => spin.sampled);
  const mismatchRows = spins.flatMap((spin) => spin.mismatches.map((mismatch) => ({ ...mismatch, spin })));
  const fields = new Map<string, number>();
  for (const row of mismatchRows) fields.set(row.field, (fields.get(row.field) ?? 0) + 1);
  const checks = model.games.flatMap((game) => game.checks);
  const mismatchSpins = sampled.filter((spin) => spin.mismatches.length > 0).length;
  return {
    discovered: model.discovered.length,
    tested: model.games.length,
    passed: model.games.filter((game) => game.result === "PASS").length,
    failed: model.games.filter((game) => game.result === "FAIL").length,
    blocked: model.games.filter((game) => game.result === "BLOCKED").length,
    completed: model.games.filter((game) => game.launch === "PASS").length,
    spins: spins.length,
    wins: spins.filter((spin) => spin.win).length,
    comparisons: sampled.length,
    mismatchSpins,
    fieldMismatches: mismatchRows.length,
    fieldBreakdown: [...fields.entries()].map(([field, count]) => ({ field, count })).sort((a, b) => b.count - a.count),
    consoleErrors: model.games.reduce((sum, game) => sum + game.consoleErrors.length, 0),
    networkErrors: model.games.reduce((sum, game) => sum + game.networkErrors.length, 0),
    checksPassed: checks.filter((check) => check.status === "PASS").length,
    checksFailed: checks.filter((check) => check.status === "FAIL").length,
    checksSkipped: checks.filter((check) => check.status === "SKIPPED" || check.status === "MANUAL").length,
    checksNotApplicable: checks.filter((check) => check.status === "NOT APPLICABLE").length,
    checksBlocked: checks.filter((check) => check.status === "BLOCKED").length,
    critical: model.games.flatMap((game) => game.critical),
    matchRate: sampled.length ? ((sampled.length - mismatchSpins) / sampled.length) * 100 : 0,
  };
}

export function regressionPercent(game: GameResult): string {
  const executed = game.checks.filter((check) => check.status === "PASS" || check.status === "FAIL");
  if (!executed.length) return "n/a";
  const passed = executed.filter((check) => check.status === "PASS").length;
  return `${Math.round((passed / executed.length) * 100)}%`;
}

export function syncLabel(game: GameResult): string {
  return game.feBeMismatches ? `FAIL (${game.feBeMismatches})` : game.spinCount ? "PASS" : "n/a";
}

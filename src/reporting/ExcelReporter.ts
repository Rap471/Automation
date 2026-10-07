import ExcelJS from "exceljs";
import type { ReportModel } from "../types";
import { regressionPercent, summarize, syncLabel } from "./stats";

export async function writeExcelReport(model: ReportModel, filePath: string): Promise<void> {
  const stats = summarize(model);
  const workbook = new ExcelJS.Workbook();
  workbook.creator = "DIJOKER Game Regression";
  workbook.created = new Date(model.generatedAt);

  const summary = workbook.addWorksheet("Summary");
  summary.addRows([
    ["DIJOKER GAME REGRESSION"],
    ["Generated", model.generatedAt],
    ["Player", model.playerId],
    ["Launcher", model.launcherUrl],
    [],
    ["Games discovered", stats.discovered],
    ["Games tested", stats.tested],
    ["Games passed", stats.passed],
    ["Games failed", stats.failed],
    ["Games blocked", stats.blocked],
    ["Total spins", stats.spins],
    ["Total wins", stats.wins],
    ["FE/BE comparisons", stats.comparisons],
    ["FE/BE mismatch spins", stats.mismatchSpins],
    ["FE/BE field mismatches", stats.fieldMismatches],
    ["Console errors", stats.consoleErrors],
    ["Network errors", stats.networkErrors],
    ["Regression passed", stats.checksPassed],
    ["Regression failed", stats.checksFailed],
    ["Regression skipped", stats.checksSkipped],
    ["Regression not applicable", stats.checksNotApplicable],
  ]);

  const games = workbook.addWorksheet("Game Results");
  games.addRow(["Game", "Game ID", "Launch", "Spins", "Wins", "FE/BE Sync", "Regression", "Console Errors", "Network Errors", "Result"]);
  for (const game of model.games) {
    games.addRow([game.gameName, game.gameId, game.launch, game.spinCount, game.winCount, syncLabel(game), regressionPercent(game), game.consoleErrors.length, game.networkErrors.length, game.result]);
  }

  const regression = workbook.addWorksheet("Regression Results");
  regression.addRow(["Test Case", "Game", "Status", "Spin", "Details"]);
  for (const game of model.games) {
    for (const check of game.checks) regression.addRow([check.name, game.gameName, check.status, check.spinNumber ?? "", check.details]);
  }

  const spinSheet = workbook.addWorksheet("Spin Results");
  spinSheet.addRow(["Game", "Spin", "Trigger", "Bet", "Backend Win", "FE Win", "Balance BE", "Balance FE", "Status", "Notes"]);
  for (const game of model.games) {
    for (const spin of game.spins) {
      spinSheet.addRow([
        game.gameName,
        spin.spinNumber,
        spin.trigger,
        spin.backend.bet ?? "",
        spin.backend.totalWin ?? "",
        spin.frontend.totalWin ?? "",
        spin.backend.balance ?? "",
        spin.frontend.balance ?? "",
        spin.correlation,
        spin.notes.join(" | "),
      ]);
    }
  }

  const mismatchSheet = workbook.addWorksheet("FE-BE Mismatches");
  mismatchSheet.addRow(["Game", "Spin", "Field", "Frontend", "Backend", "Difference"]);
  for (const game of model.games) {
    for (const spin of game.spins) {
      for (const mismatch of spin.mismatches) {
        mismatchSheet.addRow([game.gameName, spin.spinNumber, mismatch.field, JSON.stringify(mismatch.frontend), JSON.stringify(mismatch.backend), mismatch.difference ?? ""]);
      }
    }
  }

  const wins = workbook.addWorksheet("Wins");
  wins.addRow(["Game", "Spin", "Bet", "Total Win", "Screenshot", "Request", "Response"]);
  for (const game of model.games) {
    for (const spin of game.spins.filter((item) => item.win)) {
      wins.addRow([game.gameName, spin.spinNumber, spin.backend.bet ?? "", spin.backend.totalWin ?? "", spin.screenshot ?? "", spin.network?.requestPath ?? "", spin.network?.responsePath ?? ""]);
    }
  }

  const failures = workbook.addWorksheet("Failures");
  failures.addRow(["Game", "Test Case", "Spin", "Status", "Details"]);
  for (const game of model.games) {
    for (const check of game.checks.filter((item) => item.status === "FAIL" || item.status === "BLOCKED")) {
      failures.addRow([game.gameName, check.name, check.spinNumber ?? "", check.status, check.details]);
    }
  }

  await workbook.xlsx.writeFile(filePath);
}

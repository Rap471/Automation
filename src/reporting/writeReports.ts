import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { writeExcelReport } from "./ExcelReporter";
import { renderDashboard } from "./HtmlDashboard";
import { writeReview } from "./writeReview";
import { summarize } from "./stats";
import type { ReportModel } from "../types";

export async function writeReports(model: ReportModel, root = path.join(process.cwd(), "test-results")): Promise<void> {
  fs.mkdirSync(path.join(root, "data"), { recursive: true });
  const stats = summarize(model);
  const spins = model.games.flatMap((game) => game.spins.map((spin) => ({ ...spin, gameId: game.gameId })));
  fs.writeFileSync(path.join(root, "data", "test-summary.json"), JSON.stringify({ ...stats, generatedAt: model.generatedAt, playerId: model.playerId, launcherUrl: model.launcherUrl, config: model.config, critical: stats.critical }, null, 2));
  fs.writeFileSync(path.join(root, "data", "game-results.json"), JSON.stringify(model.games, null, 2));
  fs.writeFileSync(path.join(root, "data", "spin-results.json"), JSON.stringify(spins, null, 2));
  fs.writeFileSync(path.join(root, "index.html"), renderDashboard(model));
  writeReview(model, root);
  await writeExcelReport(model, path.join(root, "Game-Regression-Summary.xlsx"));
}

export function openDashboard(root = path.join(process.cwd(), "test-results")): void {
  const target = path.join(root, "index.html");
  if (!fs.existsSync(target)) return;
  if (process.platform === "win32") {
    spawn("cmd", ["/c", "start", "", target], { detached: true, stdio: "ignore" }).unref();
    return;
  }
  const command = process.platform === "darwin" ? "open" : "xdg-open";
  spawn(command, [target], { detached: true, stdio: "ignore" }).unref();
}

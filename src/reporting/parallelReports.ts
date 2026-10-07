import fs from "node:fs";
import path from "node:path";
import { regressionConfig } from "../config/regression.config";
import type { GameInfo, GameResult, ReportModel } from "../types";
import { sanitizeFileName } from "../utils/sanitize";
import { formatTerminalSummary } from "./TerminalSummary";
import { openDashboard, writeReports } from "./writeReports";

export interface PartialGameReport {
  order: number;
  playerId: string;
  info: GameInfo;
  result: GameResult;
}

const root = path.join(process.cwd(), "test-results");

export function partialsDirectory(): string {
  return path.join(root, "data", "partials");
}

export function clearPartials(): void {
  fs.rmSync(partialsDirectory(), { recursive: true, force: true });
}

export function writePartial(report: PartialGameReport): void {
  const directory = partialsDirectory();
  fs.mkdirSync(directory, { recursive: true });
  const fileName = `${String(report.order).padStart(3, "0")}-${sanitizeFileName(report.result.gameId || report.result.gameName)}.json`;
  fs.writeFileSync(path.join(directory, fileName), JSON.stringify(report, null, 2));
}

export function readPartials(): PartialGameReport[] {
  const directory = partialsDirectory();
  if (!fs.existsSync(directory)) return [];
  return fs.readdirSync(directory)
    .filter((file) => file.endsWith(".json"))
    .sort()
    .map((file) => JSON.parse(fs.readFileSync(path.join(directory, file), "utf8")) as PartialGameReport)
    .sort((left, right) => left.order - right.order);
}

export async function mergePartials(): Promise<void> {
  const partials = readPartials();
  if (!partials.length) return;
  const model: ReportModel = {
    generatedAt: new Date().toISOString(),
    playerId: [...new Set(partials.map((partial) => partial.playerId))].join(", "),
    launcherUrl: regressionConfig.launcherUrl,
    config: { ...regressionConfig, workers: 4 },
    discovered: partials.map((partial) => partial.info),
    games: partials.map((partial) => partial.result),
    attempted: partials.length,
    completed: partials.filter((partial) => partial.result.launch === "PASS").length,
  };
  await writeReports(model, root);
  const summary = formatTerminalSummary(model);
  console.log(summary);
  openDashboard(root);
}

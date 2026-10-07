import fs from "node:fs";
import path from "node:path";
import type { RegressionCheck, ReportModel, SpinValidation } from "../types";
import { sanitizeFileName } from "../utils/sanitize";

interface ReviewItem {
  gameName: string;
  status: RegressionCheck["status"];
  id: string;
  name: string;
  spinNumber?: number;
  details: string;
  screenAtEnd?: string;
  trigger?: string;
  frontend?: SpinValidation["frontend"];
  backend?: SpinValidation["backend"];
  mismatches?: SpinValidation["mismatches"];
  request?: unknown;
  screenshot?: string;
  failureScreenshot?: string;
  requestPath?: string;
  responsePath?: string;
}

function spinEvidence(spin: SpinValidation | undefined): Omit<ReviewItem, "gameName" | "status" | "id" | "name" | "spinNumber" | "details" | "screenAtEnd"> {
  if (!spin) return {};
  return {
    trigger: spin.trigger,
    frontend: spin.frontend,
    backend: spin.backend,
    mismatches: spin.mismatches,
    request: spin.network?.requestPayload,
    screenshot: spin.screenshot,
    failureScreenshot: spin.failureScreenshot,
    requestPath: spin.network?.requestPath,
    responsePath: spin.network?.responsePath,
  };
}

export function reviewItems(model: ReportModel): ReviewItem[] {
  return model.games.flatMap((game) => game.checks
    .filter((check) => check.status === "FAIL" || check.status === "BLOCKED")
    .map((check) => {
      const spin = game.spins.find((item) => item.spinNumber === check.spinNumber);
      return {
        gameName: game.gameName,
        status: check.status,
        id: check.id,
        name: check.name,
        spinNumber: check.spinNumber,
        details: check.details,
        screenAtEnd: game.reviewShot,
        ...spinEvidence(spin),
      };
    }));
}

function plainDetails(details: string): string {
  return details
    .replace(/\[\[stg\]\]\s*/g, "\nHow staging was manipulated:\n")
    .replace(/\[\[\/stg\]\]\s*/g, "\n")
    .trim();
}

function textRecord(items: ReviewItem[]): string {
  if (!items.length) return "No failed or blocked checks.\n";
  return items.map((item, index) => {
    const lines = [
      `${index + 1}. ${item.status}  ${item.gameName}  ${item.name}`,
      `Spin: ${item.spinNumber ?? "n/a"}`,
      `Details: ${plainDetails(item.details)}`,
    ];
    if (item.trigger) lines.push(`Trigger: ${item.trigger}`);
    if (item.frontend) lines.push(`Frontend: bet ${item.frontend.bet ?? "n/a"}, balance ${item.frontend.balance ?? "n/a"}, win ${item.frontend.totalWin ?? "n/a"}, feature ${item.frontend.feature ?? "n/a"}`);
    if (item.backend) lines.push(`Backend: bet ${item.backend.bet ?? "n/a"}, balance ${item.backend.balance ?? "n/a"}, win ${item.backend.totalWin ?? "n/a"}, feature ${item.backend.feature ?? "n/a"}`);
    if (item.mismatches?.length) lines.push(`Mismatches: ${item.mismatches.map((row) => `${row.field} FE ${JSON.stringify(row.frontend)} vs BE ${JSON.stringify(row.backend)}`).join("; ")}`);
    if (item.request) lines.push(`Request: ${JSON.stringify(item.request)}`);
    if (item.screenshot) lines.push(`Screenshot: ${item.screenshot}`);
    if (item.failureScreenshot) lines.push(`Failure screenshot: ${item.failureScreenshot}`);
    if (item.screenAtEnd) lines.push(`Screen at end: ${item.screenAtEnd}`);
    if (item.requestPath) lines.push(`Request file: ${item.requestPath}`);
    if (item.responsePath) lines.push(`Response file: ${item.responsePath}`);
    return lines.join("\n");
  }).join("\n\n") + "\n";
}

export function writeReview(model: ReportModel, root: string): void {
  const items = reviewItems(model);
  const payload = { generatedAt: model.generatedAt, playerId: model.playerId, count: items.length, items };
  fs.mkdirSync(root, { recursive: true });
  fs.writeFileSync(path.join(root, "review.json"), JSON.stringify(payload, null, 2));
  fs.writeFileSync(path.join(root, "review.txt"), textRecord(items));
  for (const game of model.games) {
    const gameItems = items.filter((item) => item.gameName === game.gameName);
    if (!gameItems.length) continue;
    const folder = path.join(root, "failures", sanitizeFileName(game.gameName));
    fs.mkdirSync(folder, { recursive: true });
    fs.writeFileSync(path.join(folder, "review.json"), JSON.stringify({ gameName: game.gameName, items: gameItems }, null, 2));
  }
}

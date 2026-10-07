import fs from "node:fs";
import path from "node:path";
import { writeReports } from "../src/reporting/writeReports";
import { sanitizeFileName, spinFolder } from "../src/utils/sanitize";
import type { GameInfo, GameResult, ReportModel } from "../src/types";

async function main(): Promise<void> {
  const root = path.join(process.cwd(), "test-results");
  const summary = JSON.parse(fs.readFileSync(path.join(root, "data", "test-summary.json"), "utf8")) as {
    generatedAt: string;
    playerId: string;
    launcherUrl: string;
    config: Record<string, unknown>;
    completed: number;
    tested: number;
  };
  const games = JSON.parse(fs.readFileSync(path.join(root, "data", "game-results.json"), "utf8")) as GameResult[];
  const discovered: GameInfo[] = games.map((game) => ({
    gameName: game.gameName,
    gameId: game.gameId,
    index: game.index,
    locatorDescription: "grid card",
  }));
  const model: ReportModel = {
    generatedAt: summary.generatedAt,
    playerId: summary.playerId,
    launcherUrl: summary.launcherUrl,
    config: summary.config,
    discovered,
    games,
    attempted: summary.tested,
    completed: summary.completed,
  };
  await writeReports(model, root);
  let failures = 0;
  for (const game of games) {
    for (const spin of game.spins) {
      if (!spin.sampled || spin.passed) continue;
      const folder = path.join(root, "failures", sanitizeFileName(game.gameName), spinFolder(spin.spinNumber));
      fs.mkdirSync(folder, { recursive: true });
      fs.writeFileSync(path.join(folder, "fe-be.json"), JSON.stringify({
        frontend: spin.frontend,
        backend: spin.backend,
        mismatches: spin.mismatches,
        request: spin.network?.requestPayload,
        response: spin.network?.responseBody,
      }, null, 2));
      failures += 1;
    }
  }
  console.log(`Regenerated dashboard for ${games.length} games. Failure files: ${failures}.`);
}

main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
